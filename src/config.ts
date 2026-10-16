import { resolve } from 'node:path';
import { createJiti } from 'jiti';

export interface AgentConfig {
  root: string;
  validation?: {
    command: readonly [string, ...string[]];
    /** Maximum checker runtime; defaults to 120 seconds. */
    timeoutMs?: number;
  };
}

/** Configuration only. Model, tools and resources remain native Pi concepts. */
export function defineAgent(config: AgentConfig): AgentConfig {
  return config;
}

export async function loadConfig(root = process.cwd()): Promise<AgentConfig> {
  const directory = resolve(root);
  const jiti = createJiti(import.meta.url, { moduleCache: false, fsCache: false });
  const config = await jiti.import<AgentConfig>(resolve(directory, 'agent.config.ts'), { default: true });
  if (!config || typeof config.root !== 'string') {
    throw new Error('agent.config.ts must export defineAgent({ root: ... }).');
  }
  if (config.validation && (!Array.isArray(config.validation.command) ||
    config.validation.command.length === 0 ||
    !config.validation.command.every(arg => typeof arg === 'string'))) {
    throw new Error('validation.command must be a non-empty argv array.');
  }
  if (config.validation?.timeoutMs !== undefined &&
    (!Number.isFinite(config.validation.timeoutMs) || config.validation.timeoutMs <= 0)) {
    throw new Error('validation.timeoutMs must be a positive number.');
  }
  return { ...config, root: resolve(directory, config.root) };
}
