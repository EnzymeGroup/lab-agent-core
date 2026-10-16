import { resolve } from 'node:path';
import {
  createAgentSession,
  DefaultResourceLoader, getAgentDir, SettingsManager,
  type AgentSession, type CreateAgentSessionOptions,
} from '@earendil-works/pi-coding-agent';
import type { AgentConfig } from './config.js';
import { checkRun, createRun, listArtifacts, writeRun, type RunRecord } from './delivery.js';

export type NativeSessionOptions = Omit<CreateAgentSessionOptions, 'cwd'>;
export interface LabAgent {
  session: AgentSession;
  run(task: string): Promise<RunRecord>;
  dispose(): Promise<void>;
}

export async function createAgent(config: AgentConfig, options: NativeSessionOptions = {}): Promise<LabAgent> {
  const root = resolve(config.root);
  const agentDir = options.agentDir ?? getAgentDir();
  const settingsManager = options.settingsManager ?? SettingsManager.create(root, agentDir, { projectTrusted: true });
  const resourceLoader = options.resourceLoader ?? new DefaultResourceLoader({
    cwd: root, agentDir, settingsManager,
  });
  if (!options.resourceLoader) await resourceLoader.reload();
  const { session, extensionsResult } = await createAgentSession({
    ...options, cwd: root, agentDir, settingsManager, resourceLoader,
  });
  let disposed = false;
  let disposal: Promise<void> | undefined;
  const dispose = () => {
    disposed = true;
    return disposal ??= (async () => {
      try {
        await session.abort();
        await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
      } finally {
        session.dispose();
      }
    })();
  };
  let extensionError: Error | undefined;
  try {
    if (extensionsResult.errors.length) {
      throw new Error(extensionsResult.errors.map(item => `${item.path}: ${item.error}`).join('\n'));
    }
    await session.bindExtensions({ onError: error => {
      extensionError = new Error(`Pi extension ${error.extensionPath}: ${error.error}`);
      process.stderr.write(`${extensionError.message}\n`);
    } });
    if (extensionError) throw extensionError;
  } catch (error) {
    await dispose();
    throw error;
  }

  let running = false;
  return {
    session,
    dispose,
    async run(task) {
      if (disposed) throw new Error('This Agent has been disposed.');
      if (running || session.isStreaming) throw new Error('This session is busy. Await the current run before starting another.');
      if (!task.trim()) throw new Error('Task must not be empty.');
      running = true;
      extensionError = undefined;
      let run: RunRecord | undefined;
      let aborted = false;
      let lastAssistant: Extract<AgentSession['messages'][number], { role: 'assistant' }> | undefined;
      const unsubscribe = session.subscribe(event => {
        if (event.type === 'agent_settled') aborted = event.aborted;
        if (event.type === 'message_end' && event.message.role === 'assistant') lastAssistant = event.message;
      });
      try {
        run = await createRun(root, task, { id: session.sessionManager.getSessionId(), file: session.sessionFile },
          session.model ? { provider: session.model.provider, id: session.model.id } : undefined);
        await session.prompt(`${task}\n\n[lab-agent-core delivery]\nSave deliverable files in: ${run.directory}/output\nKeep source code and reusable project resources in the project as appropriate.\nThe host will execute the independent delivery checker after this task. Do not write or alter check.json or run.json.`, { expandPromptTemplates: false });
        if (extensionError) throw extensionError;
        if (lastAssistant?.stopReason === 'error') {
          throw new Error(lastAssistant.errorMessage ?? 'Pi model request failed.');
        }
        run.execution = aborted || disposed || lastAssistant?.stopReason === 'aborted' ? 'aborted' : 'completed';
        run.text = lastAssistant ? session.getLastAssistantText() : undefined;
        if (lastAssistant) run.model = { provider: lastAssistant.provider, id: lastAssistant.model };
        run.finishedAt = new Date().toISOString();
        run.session.file = session.sessionFile;
        run.artifacts = await listArtifacts(run.directory);
        await writeRun(run);
        return run.execution === 'completed' ? await checkRun({ ...config, root }, run.directory) : run;
      } catch (error) {
        if (run) {
          run.execution = aborted ? 'aborted' : 'failed';
          run.error = error instanceof Error ? error.message : String(error);
          run.finishedAt = new Date().toISOString();
          run.session.file = session.sessionFile;
          // Preserve the execution error even if the tool also removed its output directory.
          run.artifacts = await listArtifacts(run.directory).catch(() => run!.artifacts);
          await writeRun(run);
        }
        throw error;
      } finally {
        unsubscribe();
        running = false;
      }
    },
  };
}
