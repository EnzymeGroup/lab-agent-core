import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { AgentConfig } from './config.js';

export type DeliveryStatus = 'not_checked' | 'passed' | 'partial' | 'failed';
export interface CheckReport {
  status: Exclude<DeliveryStatus, 'not_checked'>;
  checks: Array<{ name: string; status: string; [key: string]: unknown }>;
  issues: string[];
}
export interface RunRecord {
  id: string;
  directory: string;
  task: string;
  startedAt: string;
  finishedAt?: string;
  execution: 'running' | 'completed' | 'failed' | 'aborted';
  delivery: DeliveryStatus;
  session: { id: string; file?: string };
  model?: { provider: string; id: string };
  artifacts: string[];
  text?: string;
  error?: string;
}

export async function writeRun(run: RunRecord): Promise<void> {
  if ((await lstat(join(run.directory, 'run.json')).catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }))?.isSymbolicLink()) throw new Error('run.json must not be a symlink.');
  // Readers (including the task page) must see a complete old or new record.
  const temporary = join(run.directory, `.run-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(run, null, 2)}\n`, { flag: 'wx' });
    await rename(temporary, join(run.directory, 'run.json'));
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function readRun(root: string, runDirectory: string): Promise<RunRecord> {
  const directory = await resolveRunDirectory(root, runDirectory);
  if (!(await lstat(join(directory, 'run.json'))).isFile()) throw new Error('run.json must be a regular file.');
  return { ...JSON.parse(await readFile(join(directory, 'run.json'), 'utf8')), directory };
}

export function isWithin(parent: string, path: string): boolean {
  const part = relative(parent, path);
  return !!part && part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part);
}

/** Resolve only actual run directories inside this project's own runs directory. */
export async function resolveRunDirectory(root: string, runDirectory: string): Promise<string> {
  const project = await realpath(root);
  const expected = join(project, 'runs');
  const runs = await realpath(expected);
  const directory = await realpath(resolve(root, runDirectory));
  if (runs !== expected || !isWithin(runs, directory)) {
    throw new Error('Run directory must be inside this project\'s runs/; external and symlink escapes are not allowed.');
  }
  return directory;
}

export async function createRun(root: string, task: string, session: RunRecord['session'], model?: RunRecord['model']): Promise<RunRecord> {
  const startedAt = new Date().toISOString();
  const id = `${startedAt.replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const project = await realpath(root);
  const runs = join(project, 'runs');
  await mkdir(runs, { recursive: true });
  if (await realpath(runs) !== runs) throw new Error('Project runs/ must not be a symlink.');
  const directory = join(runs, id);
  await mkdir(join(directory, 'output'), { recursive: true });
  const run: RunRecord = { id, directory, task, startedAt, execution: 'running', delivery: 'not_checked', session, model, artifacts: [] };
  await writeRun(run);
  return run;
}

/** Only actual regular output files are listed; no content hashing or transcript copy. */
export async function listArtifacts(directory: string): Promise<string[]> {
  const outputRoot = join(directory, 'output');
  const target = await realpath(outputRoot).catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  });
  if (!target) return [];
  if (target !== join(await realpath(directory), 'output')) throw new Error('Run output/ must not be a symlink.');
  const entries = await readdir(outputRoot, { withFileTypes: true, recursive: true }).catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  });
  return entries.filter(entry => entry.isFile()).map(entry =>
    join('output', entry.parentPath.slice(outputRoot.length), entry.name),
  ).sort();
}

function parseReport(text: string): CheckReport {
  const report = JSON.parse(text) as CheckReport;
  if (!report || !['passed', 'partial', 'failed'].includes(report.status) ||
    !Array.isArray(report.checks) || !report.checks.every(check => check && typeof check.name === 'string' && typeof check.status === 'string') ||
    !Array.isArray(report.issues) || !report.issues.every(issue => typeof issue === 'string')) {
    throw new Error('check.json must contain status (passed/partial/failed), checks [{name,status}], and issues [string].');
  }
  return report;
}

async function executeCheck(config: AgentConfig, directory: string): Promise<CheckReport> {
  const validation = config.validation!;
  const checkFile = join(directory, 'check.json');
  await rm(checkFile, { force: true });
  await rm(join(directory, 'validation.log'), { force: true });
  const log = await open(join(directory, 'validation.log'), 'w');
  try {
    const result = await new Promise<{ code: number | null; timedOut: boolean }>((accept, reject) => {
      const [command, ...args] = validation.command;
      const child = spawn(command, args, {
        cwd: config.root,
        detached: process.platform !== 'win32',
        stdio: ['ignore', log.fd, log.fd],
        env: { ...process.env, AGENT_ROOT: config.root, AGENT_RUN_DIR: directory,
          AGENT_OUTPUT_DIR: join(directory, 'output'), AGENT_CHECK_FILE: checkFile },
      });
      let timedOut = false;
      const stop = () => {
        if (child.pid) {
          if (process.platform === 'win32') child.kill('SIGKILL');
          else {
            try { process.kill(-child.pid, 'SIGKILL'); }
            catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') reject(error); }
          }
        }
      };
      const timer = setTimeout(() => { timedOut = true; stop(); }, validation.timeoutMs ?? 120_000);
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
      const cleanup = () => {
        clearTimeout(timer);
        process.off('SIGINT', stop);
        process.off('SIGTERM', stop);
      };
      child.once('error', error => { cleanup(); reject(error); });
      child.once('close', code => { cleanup(); accept({ code, timedOut }); });
    });
    if (result.timedOut) throw new Error('Delivery checker timed out. See validation.log.');
    if (result.code !== 0) throw new Error(`Delivery checker exited ${result.code}. See validation.log.`);
    return parseReport(await readFile(checkFile, 'utf8'));
  } catch (error) {
    const report: CheckReport = { status: 'failed', checks: [], issues: [error instanceof Error ? error.message : String(error)] };
    await writeFile(checkFile, `${JSON.stringify(report, null, 2)}\n`);
    return report;
  } finally {
    await log.close();
  }
}

/** Recheck a completed run without calling a model. */
export async function checkRun(config: AgentConfig, runDirectory: string): Promise<RunRecord> {
  const run = await readRun(config.root, runDirectory);
  const directory = run.directory;
  if (run.execution === 'running') throw new Error('Cannot check a run while it is still running.');
  run.directory = directory;
  run.artifacts = await listArtifacts(directory);
  run.delivery = config.validation ? (await executeCheck(config, directory)).status : 'not_checked';
  await writeRun(run);
  return run;
}
