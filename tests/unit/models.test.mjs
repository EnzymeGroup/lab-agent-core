import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startModelServer } from '../fixtures/model-server.mjs';

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));
const secret = 'fixture-secret-never-print';
const alpha = 'lab-fixture-alpha';
const beta = 'lab-fixture-beta';
const alphaModel = 'family/alpha';
const betaModel = 'family/beta';
const model = id => ({ id, name: id, reasoning: false, input: ['text'], contextWindow: 32000,
  maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } });

async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'lab-agent-models-'));
  const root = join(directory, 'project');
  const agentDir = join(directory, 'agent');
  await mkdir(join(root, '.pi'), { recursive: true });
  await mkdir(agentDir);
  const servers = await Promise.all([startModelServer(), startModelServer()]);
  t.after(async () => {
    await Promise.all(servers.map(server => server.close()));
    await rm(directory, { recursive: true, force: true });
  });
  const files = {
    models: join(agentDir, 'models.json'), global: join(agentDir, 'settings.json'),
    project: join(root, '.pi/settings.json'), auth: join(agentDir, 'auth.json'),
  };
  await writeFile(files.models, JSON.stringify({ providers: {
    [alpha]: { baseUrl: servers[0].baseUrl, api: 'openai-completions', apiKey: secret,
      headers: { 'X-Fixture-Secret': 'private-header-value' }, models: [model(alphaModel)] },
    [beta]: { baseUrl: servers[1].baseUrl, api: 'openai-completions', apiKey: '${AGENT_FIXTURE_KEY}',
      models: [model(betaModel)] },
  } }));
  const globalSettings = { defaultProvider: alpha, defaultModel: alphaModel, defaultThinkingLevel: 'off',
    retry: { enabled: false }, compaction: { enabled: false }, theme: 'light' };
  const projectSettings = { defaultProvider: beta, defaultModel: betaModel, quietStartup: true };
  await writeFile(files.global, JSON.stringify(globalSettings));
  await writeFile(files.project, JSON.stringify(projectSettings));
  await writeFile(join(root, 'agent.config.ts'), 'export default { root: import.meta.dirname };\n');
  const env = { ...process.env, PI_CODING_AGENT_DIR: agentDir, AGENT_FIXTURE_KEY: secret };
  async function invoke(args, environment = env) {
    try {
      const result = await exec(process.execPath, [cli, ...args, '--root', root, '--json'], {
        cwd: directory, env: environment, timeout: 20000, maxBuffer: 2 * 1024 * 1024,
      });
      return { ...result, code: 0 };
    } catch (error) {
      if (typeof error.code === 'number') return { stdout: error.stdout, stderr: error.stderr, code: error.code };
      throw error;
    }
  }
  const read = file => readFile(file, 'utf8');
  return { root, agentDir, servers, files, globalSettings, projectSettings, env, invoke, read };
}

function parsed(result) {
  assert.equal(result.code, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function noSecrets(result) {
  const output = result.stdout + result.stderr;
  assert.ok(!output.includes(secret));
  assert.ok(!output.includes('private-header-value'));
  assert.ok(!output.includes('${AGENT_FIXTURE_KEY}'));
}

// Native configuration is exercised through the real CLI and two isolated HTTP providers.
// The local fixture verifies routing and persistence, not model reasoning quality.
test('config and models inspect native configuration without exposing credentials', async t => {
  const fixture = await setup(t);
  const { root, agentDir, servers, files, invoke, env } = fixture;
  const configResult = await invoke(['config']);
  noSecrets(configResult);
  const config = parsed(configResult);
  assert.equal(config.root, root);
  assert.equal(config.agentDir, agentDir);
  assert.equal(config.defaults.provider, beta);
  assert.equal(config.defaults.model, betaModel);
  for (const file of Object.values(files)) assert.ok(JSON.stringify(config).includes(file), `missing native path ${file}`);
  assert.ok(JSON.stringify(config).includes(betaModel), 'effective project model should be visible');
  const availableResult = await invoke(['models', '--provider', beta]);
  noSecrets(availableResult);
  const available = parsed(availableResult);
  assert.equal(available.length, 1);
  assert.equal(available[0].provider, beta);
  assert.equal(available[0].id, betaModel);
  assert.equal(available[0].configured, true);
  assert.ok(JSON.stringify(available).includes(betaModel));
  assert.ok(!JSON.stringify(available).includes(alphaModel));
  const noKey = { ...env };
  delete noKey.AGENT_FIXTURE_KEY;
  const unavailable = parsed(await invoke(['models', '--provider', beta], noKey));
  assert.ok(!JSON.stringify(unavailable).includes(betaModel), 'unconfigured credential excludes default model listing');
  const allResult = await invoke(['models', '--provider', beta, '--all'], noKey);
  noSecrets(allResult);
  assert.ok(JSON.stringify(parsed(allResult)).includes(betaModel), '--all includes known unavailable models');
  const beforeMissingAuth = await Promise.all([files.global, files.project, files.models].map(file => readFile(file, 'utf8')));
  const rejected = await invoke(['run', 'Missing credential must not fall back'], noKey);
  assert.equal(rejected.code, 1);
  assert.match(rejected.stderr, /key|credential|auth|configured/i);
  noSecrets(rejected);
  assert.deepEqual(await Promise.all([files.global, files.project, files.models].map(file => readFile(file, 'utf8'))), beforeMissingAuth);
  assert.equal(servers.reduce((n, server) => n + server.requests.length, 0), 0, 'inspection must not perform inference');
});

test('use validates exact models and preserves project and global settings', async t => {
  const { invoke, read, files, globalSettings, projectSettings, servers } = await setup(t);
  const globalBefore = await read(files.global);
  const selected = await invoke(['use', alpha, alphaModel]);
  noSecrets(selected);
  const selection = parsed(selected);
  assert.equal(selection.scope, 'project');
  assert.equal(selection.file, files.project);
  assert.equal(selection.effectiveDefaults.model, alphaModel);
  assert.deepEqual(JSON.parse(await read(files.project)), { ...projectSettings, defaultProvider: alpha, defaultModel: alphaModel });
  assert.equal(await read(files.global), globalBefore);
  const projectBefore = await read(files.project);
  parsed(await invoke(['use', beta, betaModel, '--global']));
  assert.deepEqual(JSON.parse(await read(files.global)), { ...globalSettings, defaultProvider: beta, defaultModel: betaModel });
  assert.equal(await read(files.project), projectBefore);
  const config = parsed(await invoke(['config']));
  assert.equal(config.defaults.provider, alpha);
  assert.equal(config.defaults.model, alphaModel, 'project defaults retain precedence');
  const snapshot = [await read(files.global), await read(files.project), await read(files.models)];
  for (const args of [['use', alpha, 'alpha'], ['use', 'missing-provider', betaModel]]) {
    const rejected = await invoke(args);
    assert.equal(rejected.code, 1);
    assert.match(rejected.stderr, /unknown|not found|exact|model/i);
  }
  assert.deepEqual([await read(files.global), await read(files.project), await read(files.models)], snapshot);
  assert.equal(servers.reduce((n, server) => n + server.requests.length, 0), 0);
});

test('run overrides are transient; resumed session model wins unless explicitly overridden', async t => {
  const { invoke, read, files, servers } = await setup(t);
  const initialSettings = [await read(files.global), await read(files.project), await read(files.models)];
  const defaultRun = parsed(await invoke(['run', 'Use project default']));
  assert.equal(defaultRun.execution, 'completed');
  assert.deepEqual(defaultRun.model, { provider: beta, id: betaModel });
  assert.equal(servers[0].requests.length, 0);
  assert.equal(servers[1].requests.at(-1).model, betaModel);
  const overrideRun = parsed(await invoke(['run', 'Use explicit model', '--provider', alpha, '--model', alphaModel]));
  assert.equal(overrideRun.execution, 'completed');
  assert.deepEqual(overrideRun.model, { provider: alpha, id: alphaModel });
  assert.equal(servers[0].requests.at(-1).model, alphaModel);
  assert.deepEqual([await read(files.global), await read(files.project), await read(files.models)], initialSettings);
  const betaCount = servers[1].requests.length;
  parsed(await invoke(['run', 'Continue saved model', '--session', overrideRun.session.file]));
  assert.equal(servers[0].requests.length, 2);
  assert.equal(servers[1].requests.length, betaCount, 'resume should retain alpha even though project default is beta');
  parsed(await invoke(['run', 'Explicitly change resumed model', '--session', overrideRun.session.file,
    '--provider', beta, '--model', betaModel]));
  assert.equal(servers[1].requests.length, betaCount + 1);
  assert.deepEqual([await read(files.global), await read(files.project), await read(files.models)], initialSettings);
  const beforeInvalid = servers.map(server => server.requests.length);
  for (const flags of [['--provider', alpha], ['--model', alphaModel], ['--provider', '', '--model', ''],
    ['--provider', alpha, '--model', 'alpha'], ['--provider', 'missing-provider', '--model', betaModel]]) {
    const rejected = await invoke(['run', 'Must not infer', ...flags]);
    assert.equal(rejected.code, 1);
    assert.match(rejected.stderr, /both|together|require|unknown|not found|model/i);
    noSecrets(rejected);
  }
  assert.deepEqual(servers.map(server => server.requests.length), beforeInvalid);
  assert.deepEqual([await read(files.global), await read(files.project), await read(files.models)], initialSettings);
  await rm(files.project);
  parsed(await invoke(['run', 'Use global default']));
  assert.equal(servers[0].requests.at(-1).model, alphaModel);
  assert.equal(servers[0].requests.length, beforeInvalid[0] + 1);
  assert.equal(JSON.parse(await read(files.global)).defaultModel, alphaModel);
});

test('partial configured defaults fail rather than enabling automatic fallback', async t => {
  const { invoke, files, servers } = await setup(t);
  await writeFile(files.global, JSON.stringify({ defaultProvider: alpha, retry: { enabled: false } }));
  await writeFile(files.project, '{}');
  const result = await invoke(['run', 'Do not infer with incomplete selection']);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /both.*provider.*model/i);
  assert.equal(servers[0].requests.length + servers[1].requests.length, 0);
});
