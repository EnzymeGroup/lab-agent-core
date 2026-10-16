import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { request } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { ProjectTrustStore } from '@earendil-works/pi-coding-agent';
import { startTaskUI } from '../dist/task-ui.js';
import { lastUserText, startModelServer, writeModelConfig } from './fixtures/model-server.mjs';

async function until(read) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { const value = await read(); if (value) return value; await delay(50); }
  throw new Error('Task UI state did not settle');
}

test('task UI runs the real Core lifecycle, lists/downloads files, rechecks and rejects unsafe requests', async t => {
  const root = await mkdtemp(join(tmpdir(), 'lab-task-ui-'));
  const agentDir = join(root, 'agent');
  const model = await startModelServer(request => {
    if (lastUserText(request).includes('force failure')) return { status: 400, text: 'Task UI model failure' };
    if (lastUserText(request).includes('slow task')) return { text: 'Eventually complete', delayMs: 30000 };
    if (request.messages.at(-1).role === 'tool') return { text: 'Saved the actual result.' };
    const output = lastUserText(request).match(/Save deliverable files in: ([^\n]+)/)[1];
    return { toolCalls: [{ name: 'write', arguments: { path: join(output, 'result.txt'), content: '42' } }] };
  });
  await writeModelConfig(agentDir, model.baseUrl);
  new ProjectTrustStore(agentDir).set(root, true);
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const config = { root, validation: { command: [process.execPath, '-e', `
    const fs=require('node:fs');const passed=fs.readFileSync(process.env.AGENT_OUTPUT_DIR+'/result.txt','utf8')==='42';
    fs.writeFileSync(process.env.AGENT_CHECK_FILE,JSON.stringify({status:passed?'passed':'failed',checks:[{name:'actual_value',status:passed?'passed':'failed'}],issues:passed?[]:['Unexpected value']}));
  `] } };
  const ui = await startTaskUI(config, 'http://127.0.0.1:30141/?cwd=example');
  t.after(async () => {
    await ui.close(); await model.close(); await rm(root, { recursive: true, force: true });
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
  });
  const api = async (path, data, extra = {}) => fetch(ui.url+path, { ...extra,
    ...(data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ui.url, ...extra.headers }, body: JSON.stringify(data) }),
  });
  assert.match(await (await api('/')).text(), /Describe a task/);
  assert.deepEqual((await (await api('/api/runs')).json()).runs, []);
  assert.equal((await api('/api/run', {task:'Run native tool'})).status, 202);
  assert.equal((await api('/api/run', {task:'Concurrent task'})).status, 409);
  const completed = await until(async () => {
    const value=await (await api('/api/runs')).json(); return !value.busy && value.runs.length ? value : false;
  });
  const run = completed.runs[0];
  assert.equal(run.execution, 'completed'); assert.equal(run.delivery, 'passed');
  assert.equal((await (await api('/api/run?id='+run.id)).json()).check.status, 'passed');
  assert.equal(await (await api('/api/artifact?id='+run.id+'&path=output%2Fresult.txt')).text(), '42');
  const count = model.requests.length;
  await writeFile(join(run.directory, 'output/result.txt'), 'wrong');
  const checked = await api('/api/check', {id:run.id});
  assert.equal(checked.status, 200); assert.equal((await checked.json()).delivery, 'failed');
  assert.equal(model.requests.length, count, 'HTTP recheck must not make inference requests');
  assert.equal((await api('/api/run?id=..')).status, 400);
  assert.equal((await api('/api/artifact?id='+run.id+'&path=..%2F..%2Fagent%2Fmodels.json')).status, 400);
  await rm(join(run.directory, 'output/result.txt'));
  await symlink(join(agentDir, 'models.json'), join(run.directory, 'output/result.txt'));
  assert.equal((await api('/api/artifact?id='+run.id+'&path=output%2Fresult.txt')).status, 400);
  assert.equal((await api('/api/run', {task:'Cross origin'}, {headers:{Origin:'https://example.com'}})).status, 403);
  const badHost = await new Promise((accept, reject) => {
    const req = request(ui.url+'/api/runs', { headers: { Host: 'example.com' } }, res => { res.resume(); accept(res.statusCode); });
    req.on('error', reject); req.end();
  });
  assert.equal(badHost, 403);
  const settingsFile = join(agentDir, 'settings.json');
  const settings = await readFile(settingsFile, 'utf8');
  await writeFile(settingsFile, JSON.stringify({ defaultProvider: 'fixture', defaultModel: 'missing' }));
  const rejected = await api('/api/run', {task:'Do not fall back to another model'});
  assert.equal(rejected.status, 400);
  assert.match((await rejected.json()).error.message, /Unknown model/);
  assert.equal((await (await api('/api/runs')).json()).busy, false, 'setup failure must release the project slot');
  assert.equal(model.requests.length, count);
  await writeFile(settingsFile, settings);
  assert.equal((await api('/api/run', {task:'force failure'})).status, 202);
  const failed = await until(async () => {const value=await (await api('/api/runs')).json();return !value.busy && value.runs[0]?.execution==='failed' ? value : false;});
  assert.match(failed.runs[0].error, /Task UI model failure/);
  assert.ok(failed.error);
  assert.equal((await api('/api/run', {task:'slow task'})).status, 202);
  await until(() => model.requests.some(request=>lastUserText(request).includes('slow task')));
  await ui.close();
  const runs = (await import('node:fs/promises')).readdir;
  const records = await Promise.all((await runs(join(root,'runs'))).map(id=>readFile(join(root,'runs',id,'run.json'),'utf8').then(JSON.parse)));
  assert.ok(records.some(run=>run.execution==='aborted'), 'shutdown must retain an aborted task record');
  await assert.rejects(fetch(ui.url));
});
