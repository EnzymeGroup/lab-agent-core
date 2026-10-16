import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { createAgent, type LabAgent } from './agent.js';
import { requireProjectTrust, type AgentConfig } from './config.js';
import { checkRun, isWithin, readRun } from './delivery.js';
import { configuration, selectModel } from './models.js';

/** A local delivery UI alongside Pi Web. The runtime and checker are the public Core paths. */
export async function startTaskUI(config: AgentConfig, chatUrl: string, port = 0) {
  requireProjectTrust(config.root);
  let busy = false;
  let closing = false;
  let active: LabAgent | undefined;
  let pending: Promise<unknown> | undefined;
  let lastError: string | undefined;
  let origin = '';
  let shutdown: Promise<void> | undefined;
  const json = (res: ServerResponse, status: number, value: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(value));
  };
  const body = async (req: IncomingMessage) => {
    if (req.headers['content-type'] !== 'application/json') throw new Error('Send application/json.');
    let text = '';
    for await (const chunk of req) {
      text += chunk;
      if (text.length > 64_000) throw new Error('Request is too large.');
    }
    return JSON.parse(text) as Record<string, unknown>;
  };
  const runPath = (id: unknown) => {
    if (typeof id !== 'string' || !id || basename(id) !== id || id === '.' || id === '..') {
      throw new Error('Expected a run ID.');
    }
    return join('runs', id);
  };
  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', origin);
    if (req.headers.host !== new URL(origin).host || req.headers.origin && req.headers.origin !== origin) {
      json(res, 403, { error: { message: 'Only this local UI origin is allowed.' } });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/') {
      const page = await readFile(new URL('../templates/tasks.html', import.meta.url), 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(page);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/runs') {
      const entries = await readdir(resolve(config.root, 'runs'), { withFileTypes: true }).catch(error => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
      });
      const runs = [];
      const issues = [];
      for (const entry of entries.filter(entry => entry.isDirectory() || entry.isSymbolicLink())) {
        try { runs.push(await readRun(config.root, runPath(entry.name))); }
        catch (error) { issues.push({ id: entry.name, message: (error as Error).message }); }
      }
      runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
      const summaries = runs.map(({ id, directory, task, startedAt, execution, delivery, error }) =>
        ({ id, directory, task, startedAt, execution, delivery, error }));
      json(res, 200, { root: config.root, chatUrl, busy, error: lastError, runs: summaries, issues });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/run') {
      const run = await readRun(config.root, runPath(url.searchParams.get('id')));
      const checkFile = join(run.directory, 'check.json');
      const regular = await lstat(checkFile).then(info => info.isFile(), error => {
        if (error.code === 'ENOENT') return false;
        throw error;
      });
      json(res, 200, { run, check: regular ? JSON.parse(await readFile(checkFile, 'utf8')) : null });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/artifact') {
      const run = await readRun(config.root, runPath(url.searchParams.get('id')));
      const path = url.searchParams.get('path');
      if (!path || !run.artifacts.includes(path)) throw new Error('Unknown artifact.');
      const file = await realpath(resolve(run.directory, path));
      const output = join(run.directory, 'output');
      if (await realpath(output) !== output || !isWithin(output, file) || !(await lstat(file)).isFile()) {
        throw new Error('Artifact must be a regular file inside this run\'s output/.');
      }
      res.writeHead(200, { 'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(basename(file))}` });
      const stream = createReadStream(file);
      stream.on('error', error => res.destroy(error));
      stream.pipe(res);
      return;
    }
    if (req.method === 'POST' && (url.pathname === '/api/run' || url.pathname === '/api/check')) {
      if (busy || closing) { json(res, 409, { error: { message: 'A project operation is already running.' } }); return; }
      const input = await body(req);
      // Recheck after reading the request: another request may have acquired the slot.
      if (busy || closing) { json(res, 409, { error: { message: 'A project operation is already running.' } }); return; }
      busy = true;
      lastError = undefined;
      let background = false;
      try {
        if (url.pathname === '/api/check') {
          pending = checkRun(config, runPath(input.id));
          json(res, 200, await pending);
          return;
        }
        if (typeof input.task !== 'string' || !input.task.trim()) throw new Error('Task must not be empty.');
        active = await createAgent(config);
        if (closing) throw new Error('Task UI is shutting down.');
        const defaults = configuration(config).defaults;
        await selectModel(active.session, defaults.provider, defaults.model);
        pending = active.run(input.task).finally(async () => {
          try { await active?.dispose(); }
          finally { active = undefined; busy = false; }
        }).catch(error => { lastError = (error as Error).message; });
        background = true;
        json(res, 202, { accepted: true });
      } finally {
        if (!background) {
          try { await active?.dispose(); }
          finally { active = undefined; pending = undefined; busy = false; }
        }
      }
      return;
    }
    json(res, 404, { error: { message: 'Unknown endpoint.' } });
  };
  const server = createServer((req, res) => {
    void handle(req, res).catch(error => {
      lastError = error instanceof Error ? error.message : String(error);
      if (!res.headersSent) json(res, 400, { error: { message: lastError } });
      else res.destroy(error);
    });
  });
  await new Promise<void>((accept, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', accept);
  });
  const address = server.address() as { port: number };
  origin = `http://127.0.0.1:${address.port}`;
  return {
    url: origin,
    close() {
      return shutdown ??= (async () => {
        closing = true;
        const stopped = new Promise<void>((accept, reject) => server.close(error => error ? reject(error) : accept()));
        await active?.dispose();
        await pending;
        await stopped;
      })();
    },
  };
}
