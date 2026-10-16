import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { ProjectTrustStore } from '@earendil-works/pi-coding-agent';
import { createAgent, RunError } from '../../dist/index.js';
import { createRun, writeRun, checkRun } from '../../dist/delivery.js';
import { launchUI } from '../../dist/ui.js';
import { inspectSession } from '../../dist/inspect.js';
import { startModelServer, writeModelConfig } from '../fixtures/model-server.mjs';

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));
const mcpServer = fileURLToPath(new URL('../fixtures/mcp-server.mjs', import.meta.url));
async function setup(t, handler) {
  const root = await mkdtemp(join(tmpdir(), 'lab-runtime-boundaries-'));
  const agentDir = join(root, 'agent-dir');
  const model = await startModelServer(handler);
  await writeModelConfig(agentDir, model.baseUrl);
  await writeFile(join(root, 'agent.config.ts'), 'export default {root:import.meta.dirname};\n');
  const env = { ...process.env, PI_CODING_AGENT_DIR: agentDir };
  t.after(async () => { await model.close(); await rm(root, { recursive: true, force: true }); });
  async function invoke(...args) {
    try { return { ...(await exec(process.execPath, [cli, ...args, '--root', root, '--json'], { env })), code: 0 }; }
    catch (error) { if (typeof error.code === 'number') return { code: error.code, stdout: error.stdout, stderr: error.stderr }; throw error; }
  }
  return { root, agentDir, model, env, invoke };
}

test('trust is explicit, gates config evaluation and SDK/UI startup, and can be revoked', async t => {
  const { root, agentDir, invoke } = await setup(t);
  const marker = join(root, 'config-evaluated');
  await writeFile(join(root, 'agent.config.ts'), `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(marker)},'evaluated');export default {root:import.meta.dirname};`);
  const denied = await invoke('config');
  assert.equal(denied.code, 1);
  assert.match(JSON.parse(denied.stdout).error.message, /not trusted/);
  await assert.rejects(readFile(marker), { code: 'ENOENT' });
  await assert.rejects(createAgent({ root }, { agentDir }), /not trusted/);
  assert.equal((await invoke('trust')).code, 0);
  await assert.rejects(readFile(marker), { code: 'ENOENT' }, 'trust must not evaluate project code');
  assert.equal((await invoke('config')).code, 0);
  assert.equal(await readFile(marker, 'utf8'), 'evaluated');
  assert.equal((await invoke('trust', '--revoke')).code, 0);
  await assert.rejects(createAgent({ root }, { agentDir }), /not trusted/);
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  try { await assert.rejects(launchUI({ root }), /not trusted/); }
  finally { if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous; }
});

test('SDK RunError and CLI JSON retain failed run records; setup errors use an error object', async t => {
  const { root, agentDir, invoke } = await setup(t, () => ({ status: 400, text: 'Expected model failure' }));
  new ProjectTrustStore(agentDir).set(root, true);
  const agent = await createAgent({ root }, { agentDir });
  try {
    await assert.rejects(agent.run('Fail with a persisted record'), error => {
      assert.ok(error instanceof RunError);
      assert.equal(error.run.execution, 'failed');
      assert.match(error.run.error, /Expected model failure/);
      return true;
    });
  } finally { await agent.dispose(); }
  const failed = await invoke('run', 'Fail through CLI');
  assert.equal(failed.code, 1);
  const run = JSON.parse(failed.stdout);
  assert.equal(run.execution, 'failed');
  assert.equal(JSON.parse(await readFile(join(run.directory, 'run.json'), 'utf8')).id, run.id);
  const invalid = await invoke('run', 'Invalid setup', '--provider', 'unknown', '--model', 'missing');
  assert.equal(invalid.code, 1);
  assert.match(JSON.parse(invalid.stdout).error.message, /Unknown model/);
});

test('run/check paths reject external projects, prefix siblings and symlink escapes before a checker runs', async t => {
  const { root } = await setup(t);
  const outside = await mkdtemp(join(tmpdir(), 'lab-foreign-runs-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  const run = await createRun(root, 'Own run', { id: 'own' });
  run.execution = 'completed'; await writeRun(run);
  const foreign = await createRun(outside, 'Foreign run', { id: 'foreign' });
  foreign.execution = 'completed'; await writeRun(foreign);
  const original = await readFile(join(foreign.directory, 'run.json'), 'utf8');
  const marker = join(root, 'checker-ran');
  const config = { root, validation: { command: [process.execPath, '-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)},'ran')`] } };
  await assert.rejects(checkRun(config, foreign.directory), /inside this project/);
  await symlink(foreign.directory, join(root, 'runs', 'escape'));
  await assert.rejects(checkRun(config, 'runs/escape'), /inside this project/);
  await mkdir(join(root, 'runs-sibling'));
  await writeFile(join(root, 'runs-sibling/run.json'), original);
  await assert.rejects(checkRun(config, 'runs-sibling'), /inside this project/);
  await assert.rejects(readFile(marker), { code: 'ENOENT' });
  assert.equal(await readFile(join(foreign.directory, 'run.json'), 'utf8'), original);
  await rm(join(run.directory, 'run.json'));
  await symlink(join(foreign.directory, 'run.json'), join(run.directory, 'run.json'));
  await assert.rejects(checkRun(config, run.directory), /regular file/);
  await rm(join(root, 'runs'), { recursive: true });
  await symlink(join(outside, 'runs'), join(root, 'runs'));
  await assert.rejects(createRun(root, 'Must not write outside', { id: 'new' }), /symlink/);
  await assert.rejects(checkRun(config, foreign.directory), /inside this project/);
});

test('output symlinks fail checks and checker log symlinks never overwrite their targets', async t => {
  const { root } = await setup(t);
  const run = await createRun(root, 'Own run', { id: 'own' });
  run.execution = 'completed'; await writeRun(run);
  const outside = join(root, 'important.txt');
  await writeFile(outside, 'keep');
  await symlink(outside, join(run.directory, 'validation.log'));
  const config = { root, validation: { command: [process.execPath, '-e', "require('node:fs').writeFileSync(process.env.AGENT_CHECK_FILE,JSON.stringify({status:'passed',checks:[],issues:[]}))"] } };
  assert.equal((await checkRun(config, run.directory)).delivery, 'passed');
  assert.equal(await readFile(outside, 'utf8'), 'keep');
  await rm(join(run.directory, 'output'), { recursive: true });
  await symlink(root, join(run.directory, 'output'));
  await assert.rejects(checkRun(config, run.directory), /output.*symlink/);
});

test('concurrent record readers never observe a partially written JSON checkpoint', async t => {
  const { root } = await setup(t);
  const run = await createRun(root, 'Concurrent readers', { id: 'native' });
  run.execution = 'completed'; await writeRun(run);
  let done = false;
  const writer = (async () => {
    try {
      for (let i = 0; i < 20; i++) { run.text = String(i).repeat(200000); await writeRun(run); }
    } finally { done = true; }
  })();
  try {
    while (!done) {
      const record = JSON.parse(await readFile(join(run.directory, 'run.json'), 'utf8'));
      assert.equal(record.execution, 'completed');
      await yieldTurn();
    }
  } finally { await writer; }
  assert.ok(!(await readdir(run.directory)).some(name => name.endsWith('.tmp')));
});

test('native MCP is shared by SDK/CLI, inspect reports real discovery, disabling follows Pi settings', async t => {
  const { root, agentDir, model, invoke } = await setup(t, request => request.messages.at(-1).role === 'tool'
    ? { text: 'Native MCP completed.' } : { toolCalls: [{ name: 'mcp__lab__double', arguments: { value: 21 } }] });
  new ProjectTrustStore(agentDir).set(root, true);
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  t.after(() => { if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous; });
  await mkdir(join(root, '.pi'), { recursive: true });
  await mkdir(join(root, '.agents/skills/sample'), { recursive: true });
  await writeFile(join(root, '.agents/skills/sample/SKILL.md'), '---\nname: sample\ndescription: Native discovery fixture.\n---\nUse real tools.\n');
  const pidFile = join(root, 'mcp.pid');
  await writeFile(join(root, '.pi/mcp.json'), JSON.stringify({ mcpServers: { lab: {
    command: process.execPath, args: [mcpServer], env: { MCP_PID_FILE: pidFile }, exposure: 'direct',
  } } }));
  const agent = await createAgent({ root });
  const inspection = await inspectSession(agent.session);
  assert.ok(inspection.skills.some(skill => skill.name === 'sample'));
  assert.ok(inspection.tools.some(tool => tool.name === 'mcp__lab__double' && tool.active));
  assert.match(JSON.stringify(inspection.mcp.status), /connected/);
  assert.equal(model.requests.length, 0, 'inspect must not call a model');
  const run = await agent.run('Double 21');
  assert.equal(run.execution, 'completed');
  assert.match(await readFile(run.session.file, 'utf8'), /42/);
  const pid = Number(await readFile(pidFile, 'utf8'));
  await agent.dispose();
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, 'native MCP subprocess must stop');
  const inspected = await invoke('inspect');
  assert.equal(inspected.code, 0, inspected.stderr);
  assert.ok(JSON.parse(inspected.stdout).tools.some(tool => tool.name === 'mcp__lab__double'));
  const executed = await invoke('run', 'Double through CLI');
  assert.equal(executed.code, 0, executed.stderr);
  assert.ok(model.requests.at(-2).tools.some(tool => tool.function.name === 'mcp__lab__double'));
  await writeFile(join(root, '.pi/settings.json'), JSON.stringify({ extensions: ['-builtin:mcp'] }));
  const disabled = await createAgent({ root });
  try { assert.equal((await inspectSession(disabled.session)).mcp.loaded, false); }
  finally { await disabled.dispose(); }
  await writeFile(join(root, '.pi/settings.json'), JSON.stringify({ extensions: ['-builtin:mcp', '-builtin:codemode', '-builtin:tool-search'] }));
  const allDisabled = await createAgent({ root });
  try { assert.ok(!allDisabled.session.getAllTools().some(tool => ['codemode', 'tool_search'].includes(tool.name))); }
  finally { await allDisabled.dispose(); }
  await writeFile(join(root, '.pi/settings.json'), '{}');
  await mkdir(join(root, '.pi/extensions'));
  await writeFile(join(root, '.pi/extensions/replacement.ts'), "export default pi => pi.registerCommand('mcp', {description:'Custom replacement',handler:async(_args,ctx)=>ctx.ui.notify('Replacement MCP status','info')});");
  await rm(pidFile);
  const replacement = await createAgent({ root });
  try {
    assert.match(JSON.stringify((await inspectSession(replacement.session)).mcp.status), /Replacement MCP status/);
    await assert.rejects(readFile(pidFile), { code: 'ENOENT' }, 'replaced native MCP must not start servers');
  } finally { await replacement.dispose(); }
});

test('per-session MCP directory mismatch fails explicitly instead of reading process credentials', async t => {
  const { root, agentDir } = await setup(t);
  new ProjectTrustStore(agentDir).set(root, true);
  await mkdir(join(root, '.pi'));
  await writeFile(join(root, '.pi/mcp.json'), JSON.stringify({ mcpServers: {} }));
  await assert.rejects(createAgent({ root }, { agentDir }), /PI_CODING_AGENT_DIR/);
});
