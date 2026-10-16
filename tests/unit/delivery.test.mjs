import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { checkRun, createRun, writeRun } from '../../dist/delivery.js';
import { loadConfig } from '../../dist/config.js';

async function fixture(t, code) {
  const root = await mkdtemp(join(tmpdir(), 'agent-core-check-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const run = await createRun(root, 'check real output', { id: 'native-session' });
  await mkdir(join(run.directory, 'output', 'nested'));
  await writeFile(join(run.directory, 'output', 'nested', 'result.txt'), '42');
  run.execution = 'completed';
  await writeRun(run);
  const command = [process.execPath, '-e', code];
  return { root, run, config: { root, validation: { command } } };
}

test('checker receives project and run paths, manifest lists real nested artifacts', async t => {
  const { config, root, run } = await fixture(t, `
    const fs = require('node:fs');
    if (process.cwd() !== process.env.AGENT_ROOT) process.exit(9);
    const value = fs.readFileSync(process.env.AGENT_OUTPUT_DIR + '/nested/result.txt', 'utf8');
    fs.writeFileSync(process.env.AGENT_CHECK_FILE, JSON.stringify({status:value === '42' ? 'passed' : 'failed',checks:[{name:'value',status:'passed'}],issues:[]}));
  `);
  const checked = await checkRun(config, run.directory.slice(root.length + 1));
  assert.equal(checked.execution, 'completed');
  assert.equal(checked.delivery, 'passed');
  assert.deepEqual(checked.artifacts, ['output/nested/result.txt']);
});

test('no checker never declares delivery success', async t => {
  const { root, run } = await fixture(t, '');
  assert.equal((await checkRun({ root }, run.directory)).delivery, 'not_checked');
});

for (const [name, code, expected] of [
  ['partial result', `require('node:fs').writeFileSync(process.env.AGENT_CHECK_FILE, JSON.stringify({status:'partial',checks:[],issues:['missing unit']}))`, 'partial'],
  ['nonzero after writing passed', `require('node:fs').writeFileSync(process.env.AGENT_CHECK_FILE, JSON.stringify({status:'passed',checks:[],issues:[]}));process.exit(3)`, 'failed'],
  ['missing report', `console.log('done')`, 'failed'],
  ['malformed report', `require('node:fs').writeFileSync(process.env.AGENT_CHECK_FILE, '{bad')`, 'failed'],
  ['invalid report schema', `require('node:fs').writeFileSync(process.env.AGENT_CHECK_FILE, JSON.stringify({status:'passed'}))`, 'failed'],
]) {
  test(name, async t => {
    const { config, run } = await fixture(t, code);
    const checked = await checkRun(config, run.directory);
    assert.equal(checked.execution, 'completed');
    assert.equal(checked.delivery, expected);
    const report = JSON.parse(await readFile(join(run.directory, 'check.json'), 'utf8'));
    assert.equal(report.status, expected);
  });
}

test('rechecking cannot reuse a stale passed report', async t => {
  const { config, run } = await fixture(t, '');
  await writeFile(join(run.directory, 'check.json'), JSON.stringify({ status: 'passed', checks: [], issues: [] }));
  assert.equal((await checkRun(config, run.directory)).delivery, 'failed');
});

test('checker timeout kills its operation and produces failed report', async t => {
  const { config, run } = await fixture(t, 'setInterval(() => {}, 1000)');
  config.validation.timeoutMs = 100;
  const checked = await checkRun(config, run.directory);
  assert.equal(checked.delivery, 'failed');
  const report = JSON.parse(await readFile(join(run.directory, 'check.json'), 'utf8'));
  assert.match(report.issues[0], /timed out/);
});

test('cannot validate a running task', async t => {
  const { config, run } = await fixture(t, '');
  run.execution = 'running';
  await writeRun(run);
  await assert.rejects(checkRun(config, run.directory), /still running/);
});

test('SIGTERM during a standalone check stops the checker and saves a terminal report', async t => {
  const { root, run } = await fixture(t, '');
  const ready = join(root, 'checker-ready');
  const code = `require('node:fs').writeFileSync(${JSON.stringify(ready)},'ready');setInterval(()=>{},1000)`;
  const config = { root, validation: { command: [process.execPath, '-e', code] } };
  const module = new URL('../../dist/delivery.js', import.meta.url).href;
  const child = spawn(process.execPath, ['--input-type=module', '-e',
    `import {checkRun} from ${JSON.stringify(module)};await checkRun(${JSON.stringify(config)},${JSON.stringify(run.directory)});`],
    { stdio: 'ignore' });
  const closed = once(child, 'close');
  t.after(() => child.kill('SIGKILL'));
  const deadline = Date.now() + 5000;
  while (await readFile(ready, 'utf8').catch(() => '') !== 'ready') {
    assert.ok(Date.now() < deadline, 'checker did not start');
    await delay(20);
  }
  child.kill('SIGTERM');
  await closed;
  const record = JSON.parse(await readFile(join(run.directory, 'run.json'), 'utf8'));
  assert.equal(record.delivery, 'failed');
  assert.equal(record.execution, 'completed');
});

test('TypeScript config loads relative root and rejects malformed command at boundary', async t => {
  const root = await mkdtemp(join(tmpdir(), 'agent-core-config-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'agent.config.ts'), `export default {root:'.', validation:{command:['python3','check.py']}};`);
  assert.equal((await loadConfig(root)).root, root);
  await writeFile(join(root, 'agent.config.ts'), `export default {root:'.',validation:{command:'python3 check.py'}};`);
  await assert.rejects(loadConfig(root), /argv array/);
});
