import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Type } from '@earendil-works/pi-ai';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { createAgent, defineAgent } from '../../dist/index.js';
import { startModelServer, writeModelConfig, lastUserText } from '../fixtures/model-server.mjs';

async function setup(t, handler) {
  const root = await mkdtemp(join(tmpdir(), 'agent-core-runtime-'));
  const server = await startModelServer(handler);
  const agentDir = join(root, '.test-agent');
  await writeModelConfig(agentDir, server.baseUrl);
  t.after(async () => { await server.close(); await rm(root, { recursive: true, force: true }); });
  return { root, server, native: { agentDir, sessionManager: SessionManager.create(root, join(agentDir, 'sessions')) } };
}

const response = { text: 'Fixture complete.' };

test('real Pi discovers AGENTS, skill and TS extension; persists and resumes native history', async t => {
  const { root, server, native } = await setup(t, request =>
    request.messages.at(-1).role === 'tool' || request.messages.some(m => m.content === 'Resume marker')
      ? response : { toolCalls: [{ name: 'greet', arguments: { name: 'Ada' } }] });
  await mkdir(join(root, '.pi/extensions'), { recursive: true });
  await mkdir(join(root, '.pi/skills/test-skill'), { recursive: true });
  await writeFile(join(root, 'AGENTS.md'), 'PROJECT_DISCOVERY_MARKER: use the native tools.\n');
  await writeFile(join(root, '.pi/skills/test-skill/SKILL.md'),
    '---\nname: test-skill\ndescription: SKILL_DISCOVERY_MARKER for fixture tasks\n---\nRead the actual inputs.\n');
  await writeFile(join(root, '.pi/extensions/greet.ts'), `export default function(pi) {
    pi.on('session_start', async (_event, ctx) => {
      pi.appendEntry('fixture-start', { cwd: ctx.cwd });
    });
    pi.registerTool({ name: 'greet', label: 'Greet', description: 'Return a greeting',
      parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
      async execute(_id, args) { return { content: [{ type: 'text', text: 'Hello ' + args.name }], details: {} }; }
    });
  }`);
  const agent = await createAgent(defineAgent({ root }), native);
  t.after(() => agent.dispose());
  const events = [];
  const unsubscribe = agent.session.subscribe(event => events.push(event));
  const run = await agent.run('Greet Ada');
  unsubscribe();
  assert.equal(run.execution, 'completed');
  assert.equal(run.delivery, 'not_checked');
  assert.equal(run.text, response.text);
  assert.ok(agent.session.getAllTools().some(tool => tool.name === 'greet'));
  assert.ok(events.some(event => event.type === 'tool_execution_end' && event.toolName === 'greet'));
  const system = JSON.stringify(server.requests[0].messages.filter(m => m.role === 'system' || m.role === 'developer'));
  assert.match(system, /PROJECT_DISCOVERY_MARKER/);
  assert.match(system, /SKILL_DISCOVERY_MARKER/);
  const transcript = await readFile(run.session.file, 'utf8');
  assert.match(transcript, /Hello Ada/);
  assert.match(transcript, /fixture-start/);
  const persisted = JSON.parse(await readFile(join(run.directory, 'run.json'), 'utf8'));
  assert.equal(persisted.session.id, agent.session.sessionId);
  await agent.dispose();
  const resumed = await createAgent({ root }, { ...native, sessionManager: SessionManager.open(run.session.file) });
  t.after(() => resumed.dispose());
  assert.equal(resumed.session.sessionId, run.session.id);
  await resumed.session.prompt('Resume marker');
  assert.ok(server.requests.at(-1).messages.some(m => m.role === 'tool' && JSON.stringify(m).includes('Hello Ada')));
});

test('programmatic native customTools execute without Core wrappers', async t => {
  let executed;
  const { root, native } = await setup(t, request => request.messages.at(-1).role === 'tool'
    ? response : { toolCalls: [{ name: 'multiply', arguments: { a: 6, b: 7 } }] });
  const agent = await createAgent({ root }, { ...native, customTools: [{
    name: 'multiply', label: 'Multiply', description: 'Multiply integers',
    parameters: Type.Object({ a: Type.Integer(), b: Type.Integer() }),
    async execute(_id, { a, b }) {
      executed = a * b;
      return { content: [{ type: 'text', text: String(executed) }], details: { result: executed } };
    },
  }] });
  t.after(() => agent.dispose());
  assert.equal((await agent.run('Multiply')).execution, 'completed');
  assert.equal(executed, 42);
});

test('model HTTP failure cannot become successful execution or delivery', async t => {
  const { root, native } = await setup(t, () => ({ status: 400, text: 'Intentional fixture rejection' }));
  const agent = await createAgent({ root }, native);
  t.after(() => agent.dispose());
  await assert.rejects(agent.run('Fail'), /Intentional fixture rejection/);
  const [id] = await readdir(join(root, 'runs'));
  const run = JSON.parse(await readFile(join(root, 'runs', id, 'run.json'), 'utf8'));
  assert.equal(run.execution, 'failed');
  assert.notEqual(run.delivery, 'passed');
  assert.match(run.error, /Intentional fixture rejection/);
});

test('native abort ends an active run and prevents concurrent Core runs', async t => {
  let requested;
  const requestArrived = new Promise(resolve => { requested = resolve; });
  const { root, native } = await setup(t, () => { requested(); return { text: 'Too late', delayMs: 30000 }; });
  const agent = await createAgent({ root }, native);
  t.after(() => agent.dispose());
  const pending = agent.run('Wait');
  await requestArrived;
  await assert.rejects(agent.run('Concurrent'), /running|active|sequential|progress|busy/i);
  await agent.session.abort();
  const run = await pending;
  assert.equal(run.execution, 'aborted');
  assert.notEqual(run.delivery, 'passed');
});

async function writeExtension(root, source) {
  await mkdir(join(root, '.pi/extensions'), { recursive: true });
  await writeFile(join(root, '.pi/extensions/lifecycle.ts'), source);
}

async function recordedRun(root) {
  const [id] = await readdir(join(root, 'runs'));
  return JSON.parse(await readFile(join(root, 'runs', id, 'run.json'), 'utf8'));
}

test('dispose aborts streaming, waits for native async shutdown and emits it exactly once', async t => {
  let requested;
  const requestArrived = new Promise(resolve => { requested = resolve; });
  const { root, native } = await setup(t, () => { requested(); return { text: 'Too late', delayMs: 30000 }; });
  await writeExtension(root, `import { appendFile } from 'node:fs/promises';
export default function(pi) {
  pi.on('session_shutdown', async (_event, ctx) => {
    await new Promise(resolve => setTimeout(resolve, 20));
    await appendFile(ctx.cwd + '/shutdown.txt', 'closed\\n');
  });
}`);
  const agent = await createAgent({ root }, native);
  const pending = agent.run('Wait until disposed');
  await requestArrived;
  await Promise.all([agent.dispose(), agent.dispose()]);
  assert.equal((await pending).execution, 'aborted');
  await agent.dispose();
  assert.equal(await readFile(join(root, 'shutdown.txt'), 'utf8'), 'closed\n');
  await assert.rejects(agent.run('Already closed'), /disposed/i);
});

test('throwing session_start rejects creation and awaits extension teardown', async t => {
  const { root, native } = await setup(t);
  await writeExtension(root, `import { writeFile } from 'node:fs/promises';
export default function(pi) {
  pi.on('session_start', async () => { throw new Error('Fixture startup failure'); });
  pi.on('session_shutdown', async (_event, ctx) => {
    await new Promise(resolve => setTimeout(resolve, 20));
    await writeFile(ctx.cwd + '/teardown.txt', 'released');
  });
}`);
  await assert.rejects(createAgent({ root }, native), /Fixture startup failure/);
  assert.equal(await readFile(join(root, 'teardown.txt'), 'utf8'), 'released');
});

test('missing output directory does not mask a model error or leave a running record', async t => {
  const { root, native } = await setup(t, request => request.messages.at(-1).role === 'tool'
    ? { status: 400, text: 'Fixture failure after output removal' }
    : { toolCalls: [{ name: 'bash', arguments: {
      command: `rmdir '${lastUserText(request).match(/Save deliverable files in: ([^\n]+)/)[1]}'`,
    } }] });
  const agent = await createAgent({ root }, native);
  t.after(() => agent.dispose());
  await assert.rejects(agent.run('Remove empty output then fail'), /Fixture failure after output removal/);
  const run = await recordedRun(root);
  assert.equal(run.execution, 'failed');
  assert.match(run.error, /Fixture failure after output removal/);
  assert.notEqual(run.delivery, 'passed');
  assert.deepEqual(run.artifacts, []);
});

test('runtime extension errors cannot silently produce a successful run', async t => {
  const { root, native } = await setup(t);
  await writeExtension(root, `export default function(pi) {
  pi.on('agent_start', async () => { throw new Error('Fixture runtime extension failure'); });
}`);
  const agent = await createAgent({ root }, native);
  t.after(() => agent.dispose());
  await assert.rejects(agent.run('Trigger extension'), /Fixture runtime extension failure/);
  const run = await recordedRun(root);
  assert.equal(run.execution, 'failed');
  assert.match(run.error, /Fixture runtime extension failure/);
  assert.notEqual(run.delivery, 'passed');
});
