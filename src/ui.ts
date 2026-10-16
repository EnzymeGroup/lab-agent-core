import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { getAgentDir, ProjectTrustStore } from '@earendil-works/pi-coding-agent';
import type { AgentConfig } from './config.js';

/** Run the upstream UI in the foreground, sharing native project resources. */
export async function launchUI(
  config: AgentConfig,
  options: { port?: number; open?: boolean } = {},
): Promise<number> {
  const port = options.port ?? 30141;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('UI port must be an integer between 1 and 65535.');
  }
  const root = resolve(config.root);
  const agentDir = getAgentDir();
  // Launching a lab-agent-core project explicitly trusts its native extensions.
  new ProjectTrustStore(agentDir).set(root, true);
  const require = createRequire(import.meta.url);
  const bin = require.resolve('@agegr/pi-web/bin/pi-web.js');
  const url = `http://127.0.0.1:${port}/?cwd=${encodeURIComponent(root)}`;
  const child = spawn(process.execPath, [bin, '--hostname', '127.0.0.1', '--port', String(port), '--no-open'], {
    cwd: root,
    stdio: ['inherit', 'pipe', 'inherit'],
    env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
  });

  return new Promise<number>((resolveExit, reject) => {
    let ready = false;
    let startup = '';
    let stoppedBy: NodeJS.Signals | undefined;
    const signals = ['SIGINT', 'SIGTERM'] as const;
    const handlers = signals.map(signal => {
      const handler = () => {
        stoppedBy = signal;
        // Pi Web forwards this to Next and owns its shutdown timeout.
        child.kill(signal);
      };
      process.on(signal, handler);
      return handler;
    });
    const cleanup = () => signals.forEach((signal, index) => process.off(signal, handlers[index]!));

    child.stdout.on('data', (chunk: Buffer) => {
      process.stdout.write(chunk);
      if (ready) return;
      startup = (startup + chunk.toString()).slice(-2048);
      if (!startup.includes('Ready')) return;
      ready = true;
      process.stdout.write(`\nAgent project: ${url}\n`);
      if (options.open) {
        const command = process.platform === 'darwin' ? 'open'
          : process.platform === 'win32' ? 'explorer.exe' : 'xdg-open';
        const browser = spawn(command, [url], { stdio: 'ignore', detached: true });
        browser.on('error', error => process.stderr.write(`Could not open browser: ${error.message}\n`));
        browser.unref();
      }
    });
    child.once('error', error => { cleanup(); reject(error); });
    child.once('close', (code, signal) => {
      cleanup();
      const interrupted = stoppedBy ?? signal;
      resolveExit(code ?? (interrupted === 'SIGINT' ? 130 : interrupted === 'SIGTERM' ? 143 : 1));
    });
  });
}
