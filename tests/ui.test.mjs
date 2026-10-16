import { ProjectTrustStore } from '@earendil-works/pi-coding-agent';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { lastUserText, startModelServer, writeModelConfig } from './fixtures/model-server.mjs';

async function unusedPort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function until(check, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await delay(100);
  }
  throw new Error(`Condition did not become true within ${timeout} ms`);
}

test('published Pi Web: chat, native tools, sessions, files, upload, abort and foreground shutdown', { timeout: 120000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-core-ui-'));
  const root = join(directory, 'project');
  const agentDir = join(directory, 'pi-agent');
  await mkdir(join(root, '.pi', 'extensions'), { recursive: true });
  await mkdir(join(root, 'output'));
  await writeFile(join(root, 'AGENTS.md'), '# UI fixture\nUse the native write tool when requested.\n');
  await writeFile(join(root, '.pi', 'extensions', 'fixture.ts'), `
export default function (pi) {
  pi.registerCommand('ui-fixture', { description: 'UI fixture resource loaded', handler: async () => {} });
}
`);
  await writeFile(join(root, '.pi/mcp.json'), JSON.stringify({ mcpServers: { lab: {
    command: process.execPath, args: [fileURLToPath(new URL('./fixtures/mcp-server.mjs', import.meta.url))], exposure: 'direct',
  } } }));
  const fixture = await startModelServer(request => {
    if (lastUserText(request).includes('wait for abort')) return { text: 'Too late', delayMs: 30000 };
    if (lastUserText(request).includes('Use MCP double')) return request.messages.at(-1).role === 'tool'
      ? { text: 'Native MCP returned 42.' } : { toolCalls: [{ name: 'mcp__lab__double', arguments: { value: 21 } }] };
    if (request.messages.at(-1).role === 'tool') return { text: 'UI artifact written.' };
    return { toolCalls: [{ name: 'write', arguments: { path: 'output/ui.txt', content: 'UI artifact\n' } }] };
  });
  await writeModelConfig(agentDir, fixture.baseUrl);
  new ProjectTrustStore(agentDir).set(root, true);
  const modelsFile = join(agentDir, 'models.json');
  const models = JSON.parse(await readFile(modelsFile, 'utf8'));
  models.providers.fixture.models.push({ ...models.providers.fixture.models[0], id: 'project-fixture' });
  await writeFile(modelsFile, JSON.stringify(models));
  await writeFile(join(root, '.pi', 'settings.json'), JSON.stringify({ defaultProvider: 'fixture', defaultModel: 'project-fixture' }));
  const port = await unusedPort();
  const base = `http://127.0.0.1:${port}`;
  const uiModule = new URL('../dist/ui.js', import.meta.url).href;
  let child;
  let logs = '';
  let closed;
  let taskUrl;
  const start = async () => {
    child = spawn(process.execPath, ['--input-type=module', '-e',
      `import { launchUI } from ${JSON.stringify(uiModule)}; process.exitCode = await launchUI({root:process.argv[1]}, {port:Number(process.argv[2])});`, root, String(port)], {
      env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_WEB_SKIP_VERSION_CHECK: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    logs = '';
    child.stdout.on('data', chunk => { logs += chunk; });
    child.stderr.on('data', chunk => { logs += chunk; });
    closed = once(child, 'close');
    await until(async () => {
      assert.equal(child.exitCode, null, logs);
      try { return (await fetch(`${base}/api/sessions`)).ok; } catch { return false; }
    }, 30000);
    await until(() => logs.includes(`?cwd=${encodeURIComponent(root)}`));
    taskUrl = await until(() => logs.match(/Task deliveries: (http:\/\/[^\s]+)\n/)?.[1]);
    assert.match(await (await fetch(taskUrl)).text(), /Describe a task/);
  };
  const stop = async () => {
    child.kill('SIGTERM');
    const [code] = await Promise.race([closed, delay(15000, undefined, { ref: false }).then(() => { throw new Error(`UI failed to stop\n${logs}`); })]);
    assert.ok(code === 0 || code === 143, `Unexpected UI exit ${code}\n${logs}`);
    await assert.rejects(fetch(`${base}/api/sessions`, { signal: AbortSignal.timeout(1000) }));
    await assert.rejects(fetch(taskUrl, { signal: AbortSignal.timeout(1000) }));
    child = undefined;
  };
  t.after(async () => {
    if (child) { child.kill('SIGTERM'); await closed; }
    await fixture.close();
    await rm(directory, { recursive: true, force: true });
  });
  const api = async (path, body) => {
    const response = await fetch(`${base}${path}`, body === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await response.json();
    assert.equal(response.ok, true, JSON.stringify(data));
    return data;
  };
  const filePath = path => '/api/files/' + path.split('/').filter(Boolean).map(encodeURIComponent).join('/');

  await start();
  assert.match(await (await fetch(`${base}/?cwd=${encodeURIComponent(root)}`)).text(), /<html/);
  await api('/api/cwd/validate', { cwd: root });
  const trust = await api(`/api/project-trust?cwd=${encodeURIComponent(root)}`);
  assert.equal(trust.trusted, true);
  const created = await api('/api/agent/new', { cwd: root, type: 'ensure_session' });
  const id = created.sessionId;
  assert.ok(id);
  const initialState = await api(`/api/agent/${id}`, { type: 'get_state' });
  assert.equal(initialState.data.model.id, 'project-fixture', 'UI new sessions honor native project defaults');
  const commands = await api(`/api/agent/${id}`, { type: 'get_commands' });
  assert.match(JSON.stringify(commands), /ui-fixture/);

  const eventAbort = new AbortController();
  const stream = await fetch(`${base}/api/agent/${id}/events`, { signal: eventAbort.signal });
  let eventText = '';
  const reading = (async () => {
    try { for await (const chunk of stream.body) eventText += new TextDecoder().decode(chunk); }
    catch (error) { if (!eventAbort.signal.aborted) throw error; }
  })();
  t.after(() => eventAbort.abort());
  await api(`/api/agent/${id}`, { type: 'prompt', message: 'write UI artifact' });
  await until(() => eventText.includes('tool_execution_end') && eventText.includes('agent_end'));
  assert.equal(await readFile(join(root, 'output', 'ui.txt'), 'utf8'), 'UI artifact\n');
  assert.match(eventText, /UI artifact written/);
  assert.match(JSON.stringify(await api(`/api/sessions/${id}`)), /UI artifact written/);
  assert.ok((await api('/api/sessions?force=1')).sessions.some(session => session.id === id));
  await api(`/api/agent/${id}`, { type: 'prompt', message: 'Use MCP double on 21' });
  await until(() => eventText.includes('mcp__lab__double') && eventText.includes('Native MCP returned 42'));

  const listing = await api(filePath(join(root, 'output')));
  assert.ok(listing.entries.some(entry => entry.name === 'ui.txt'));
  assert.match(JSON.stringify(await api(`${filePath(join(root, 'output', 'ui.txt'))}?type=read`)), /UI artifact/);
  const upload = new FormData();
  upload.append('files', new Blob(['uploaded fixture\n'], { type: 'text/plain' }), 'uploaded.txt');
  const uploaded = await fetch(`${base}${filePath(join(root, 'output'))}`, { method: 'POST', body: upload });
  assert.equal(uploaded.ok, true, await uploaded.text());
  assert.equal(await (await fetch(`${base}${filePath(join(root, 'output', 'uploaded.txt'))}?type=download`)).text(), 'uploaded fixture\n');

  await api(`/api/agent/${id}`, { type: 'prompt', message: 'wait for abort' });
  await until(() => fixture.requests.some(request => lastUserText(request).includes('wait for abort')));
  await api(`/api/agent/${id}`, { type: 'abort' });
  await until(async () => !(await api(`/api/agent/${id}`, { type: 'get_state' })).data.isStreaming);
  eventAbort.abort();
  await reading;
  await stop();

  // Restart the actual upstream server and rediscover native persisted history.
  await start();
  assert.ok((await api('/api/sessions')).sessions.some(session => session.id === id));
  assert.match(JSON.stringify(await api(`/api/sessions/${id}`)), /UI artifact written/);
  await stop();
});
