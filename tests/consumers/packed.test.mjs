import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startModelServer, writeModelConfig, lastUserText } from '../fixtures/model-server.mjs';

const exec = promisify(execFile);
const repository = fileURLToPath(new URL('../..', import.meta.url));

async function command(file, args, options = {}) {
  try {
    const result = await exec(file, args, { timeout: 120000, maxBuffer: 4 * 1024 * 1024, ...options });
    return { ...result, code: 0 };
  } catch (error) {
    if (typeof error.code === 'number') return { stdout: error.stdout, stderr: error.stderr, code: error.code };
    throw error;
  }
}
function success(result) {
  assert.equal(result.code, 0, result.stderr || result.stdout);
  return result.stdout;
}

async function install(root, tarball) {
  await mkdir(root, { recursive: true });
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'external-agent-consumer', version: '1.0.0', private: true, type: 'module' }));
  success(await command('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', tarball], { cwd: root }));
  const installed = await realpath(join(root, 'node_modules/lab-agent-core'));
  assert.ok(installed.startsWith(root + '/'), 'must be an independent installed package, not source symlink');
  return join(installed, 'dist/cli.js');
}

function outputDirectory(request) {
  return lastUserText(request).match(/Save deliverable files in: ([^\n]+)/)[1];
}

const checker = `import json, os
from pathlib import Path
output = Path(os.environ['AGENT_OUTPUT_DIR'])
value = json.loads((output / 'result.json').read_text())
passed = value == {'value': 42}
report = {'status': 'passed' if passed else 'failed', 'checks': [{'name': 'computed_value', 'status': 'passed' if passed else 'failed'}], 'issues': [] if passed else ['Unexpected result']}
Path(os.environ['AGENT_CHECK_FILE']).write_text(json.dumps(report))
`;

// Each consumer installs the actual npm tarball into a fresh external directory.
// These are integration tests against Pi, not mocks of the lab-agent-core API.
test('packed package works in independent TS and Python projects', { timeout: 240000 }, async t => {
  const scratch = await mkdtemp(join(tmpdir(), 'agent-core-consumers-'));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const packOutput = success(await command('npm', ['pack', '--json', '--pack-destination', scratch], { cwd: repository }));
  const packed = JSON.parse(packOutput.slice(packOutput.indexOf('[\n')))[0];
  const tarball = join(scratch, packed.filename);
  assert.ok(packed.files.some(file => file.path === 'templates/minimal/agent.config.ts'));

  await t.test('TypeScript native extension through installed public SDK', async t => {
    const installation = join(scratch, 'typescript');
    const cli = await install(installation, tarball);
    const root = join(installation, 'project');
    success(await command(process.execPath, [cli, 'init', root]));
    const server = await startModelServer(request => request.messages.at(-1).role === 'tool'
      ? { text: 'TS consumer done.' }
      : { toolCalls: [{ name: 'write_result', arguments: { path: join(outputDirectory(request), 'result.json'), value: 42 } }] });
    t.after(() => server.close());
    const agentDir = join(root, '.test-agent');
    await writeModelConfig(agentDir, server.baseUrl);
    await mkdir(join(root, '.pi/extensions'), { recursive: true });
    await writeFile(join(root, '.pi/extensions/result.ts'), `import { writeFile } from 'node:fs/promises';
import { Type } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
export default function(pi: ExtensionAPI) {
  pi.registerTool({ name: 'write_result', label: 'Write result', description: 'Save a computed value',
    parameters: Type.Object({ path: Type.String(), value: Type.Number() }),
    async execute(_id, args) {
      await writeFile(args.path, JSON.stringify({value: args.value}));
      return { content: [{ type: 'text', text: 'Result saved' }], details: {} };
    }
  });
}
`);
    await writeFile(join(root, 'check.py'), checker);
    await writeFile(join(root, 'agent.config.ts'), `import { defineAgent } from 'lab-agent-core';
export default defineAgent({ root: import.meta.dirname, validation: { command: ['python3', 'check.py'] } });
`);
    await writeFile(join(root, 'run.ts'), `import { createAgent } from 'lab-agent-core';
import config from './agent.config.ts';
const agent = await createAgent(config, { agentDir: process.env.PI_CODING_AGENT_DIR });
try { console.log(JSON.stringify(await agent.run('Produce TS result'))); } finally { await agent.dispose(); }
`);
    const result = await command(process.execPath, ['--experimental-strip-types', 'run.ts'], { cwd: root, env: { ...process.env, PI_CODING_AGENT_DIR: agentDir } });
    const run = JSON.parse(success(result));
    assert.equal(run.execution, 'completed');
    assert.equal(run.delivery, 'passed');
    assert.deepEqual(run.artifacts, ['output/result.json']);
    assert.deepEqual(JSON.parse(await readFile(join(run.directory, 'output/result.json'), 'utf8')), { value: 42 });
    assert.ok(server.requests[0].tools.some(tool => tool.function.name === 'write_result'));
  });

  await t.test('Python script via native bash tool and CLI run/check JSON', async t => {
    const installation = join(scratch, 'python');
    const cli = await install(installation, tarball);
    const root = join(installation, 'project');
    success(await command(process.execPath, [cli, 'init', root]));
    const server = await startModelServer(request => request.messages.at(-1).role === 'tool'
      ? { text: 'Python consumer done.' }
      : { toolCalls: [{ name: 'bash', arguments: { command: `python3 compute.py '${outputDirectory(request)}'` } }] });
    t.after(() => server.close());
    const agentDir = join(root, '.test-agent');
    await writeModelConfig(agentDir, server.baseUrl);
    const env = { ...process.env, PI_CODING_AGENT_DIR: agentDir };
    await writeFile(join(root, 'compute.py'), `import json, sys\nfrom pathlib import Path\n(Path(sys.argv[1]) / 'result.json').write_text(json.dumps({'value': 6 * 7}))\nprint('Computed 42')\n`);
    await writeFile(join(root, 'check.py'), checker);
    await writeFile(join(root, 'agent.config.ts'), `import { defineAgent } from 'lab-agent-core';
export default defineAgent({ root: import.meta.dirname, validation: { command: ['python3', 'check.py'] } });
`);
    const invoke = (...args) => command(process.execPath, [cli, ...args, '--root', root, '--json'], { cwd: scratch, env });
    const run = JSON.parse(success(await invoke('run', 'Compute Python result')));
    assert.equal(run.execution, 'completed');
    assert.equal(run.delivery, 'passed');
    assert.deepEqual(run.artifacts, ['output/result.json']);
    assert.match(await readFile(run.session.file, 'utf8'), /Computed 42/);
    const requestsBefore = server.requests.length;
    const checked = JSON.parse(success(await invoke('check', run.directory)));
    assert.equal(checked.delivery, 'passed');
    assert.equal(server.requests.length, requestsBefore, 'check must not invoke a model');
    await writeFile(join(root, 'check.py'), `import json, os\nfrom pathlib import Path\nPath(os.environ['AGENT_CHECK_FILE']).write_text(json.dumps({'status':'partial','checks':[{'name':'review','status':'pending'}],'issues':['Manual review required']}))\n`);
    const partial = await invoke('check', run.directory);
    assert.equal(partial.code, 2);
    assert.equal(JSON.parse(partial.stdout).delivery, 'partial');
    const invalid = await command(process.execPath, [cli, 'unknown'], { cwd: root, env });
    assert.equal(invalid.code, 1);
    assert.match(invalid.stderr, /Unknown command/);
    const collision = await command(process.execPath, [cli, 'init', root], { cwd: scratch, env });
    assert.equal(collision.code, 1, 'init must not overwrite an existing agent');
  });
});
