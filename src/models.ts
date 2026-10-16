import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { getAgentDir, SettingsManager, type AgentSession } from '@earendil-works/pi-coding-agent';
import type { AgentConfig } from './config.js';

export function configuration(config: AgentConfig) {
  const root = resolve(config.root);
  const agentDir = getAgentDir();
  const settings = SettingsManager.create(root, agentDir, { projectTrusted: true });
  const errors = settings.drainErrors();
  if (errors.length) throw errors[0].error;
  return {
    root, agentDir,
    files: {
      application: join(root, 'agent.config.ts'),
      projectSettings: join(root, '.pi', 'settings.json'),
      userSettings: join(agentDir, 'settings.json'),
      models: join(agentDir, 'models.json'),
      auth: join(agentDir, 'auth.json'),
    },
    defaults: {
      provider: settings.getDefaultProvider() ?? null,
      model: settings.getDefaultModel() ?? null,
      thinking: settings.getDefaultThinkingLevel() ?? null,
    },
  };
}

export function requireModel(session: AgentSession, provider: string, id: string) {
  const model = session.modelRuntime.getModel(provider, id);
  if (!model) throw new Error(`Unknown model ${provider}/${id}. See lab-agent models --all.`);
  return model;
}

export async function selectModel(session: AgentSession, provider?: string | null, model?: string | null) {
  if (provider == null && model == null) return;
  if (!provider?.trim() || !model?.trim()) {
    throw new Error('Model selection requires both a provider and a model. Use lab-agent use PROVIDER MODEL.');
  }
  await session.setModel(requireModel(session, provider, model));
}

export function listModels(session: AgentSession, provider?: string, all = false) {
  const models = session.modelRuntime.getModels(provider);
  return models.map(model => ({
    provider: model.provider, id: model.id, name: model.name, api: model.api,
    configured: session.modelRuntime.hasConfiguredAuth(model.provider),
  })).filter(model => all || model.configured);
}

export async function useModel(config: AgentConfig, session: AgentSession, provider: string, id: string, global = false) {
  requireModel(session, provider, id);
  const before = configuration(config);
  const file = global ? before.files.userSettings : before.files.projectSettings;
  if (global) {
    const settings = SettingsManager.create(config.root, before.agentDir, { projectTrusted: true });
    settings.setDefaultModelAndProvider(provider, id);
    await settings.flush();
    const errors = settings.drainErrors();
    if (errors.length) throw errors[0].error;
  } else {
    // Pi exposes global default setters; project defaults use its documented JSON keys.
    const text = await readFile(file, 'utf8').catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '{}';
      throw error;
    });
    const settings = JSON.parse(text);
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      throw new Error(`${file} must contain a JSON object.`);
    }
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify({ ...settings, defaultProvider: provider, defaultModel: id }, null, 2)}\n`);
  }
  return {
    scope: global ? 'global' : 'project', file, provider, model: id,
    configured: session.modelRuntime.hasConfiguredAuth(provider),
    effectiveDefaults: configuration(config).defaults,
  };
}
