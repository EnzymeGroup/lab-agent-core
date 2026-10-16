#!/usr/bin/env node
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { checkRun, type RunRecord } from './delivery.js';
import { scaffold } from './scaffold.js';

const help = `Usage: lab-agent <command> [options]

  init [directory]             Create a minimal independent project
  run <task>                   Run a task and its optional delivery checker
  check <run-directory>        Recheck an existing run
  ui                          Start Pi Web for this project
  dev                         Alias for ui (no file watcher)
  models                      List credential-configured models (not a connectivity test)
  use <provider> <model>       Set this project's native model defaults
  config                      Show configuration paths and effective defaults
  trust                       Trust this project before loading its code
  inspect                     Inspect loaded skills, extensions, tools and MCP

  --root <directory>           Load this project's agent.config.ts
  --json                      Print only the final run record (run/check)
  --session <file>             Continue a native Pi session (run)
  --port <number>              Pi Web port (ui/dev)
  --task-port <number>         Task page port (ui/dev; automatic by default)
  --no-open                   Do not open a browser (ui/dev)
  --provider <name>            Filter models or select run provider (with --model)
  --model <id>                 Exact per-run model; does not change defaults
  --all                       Include models without configured credentials (models)
  --global                    Save user defaults instead of project defaults (use)
  --revoke                    Remove project trust (trust)
  -h, --help                  Show this help`;

function report(record: RunRecord, json: boolean): void {
  if (json) console.log(JSON.stringify(record));
  else console.log(`\nRun: ${record.directory}\nExecution: ${record.execution}\nDelivery: ${record.delivery}`);
  process.exitCode = record.execution === 'aborted' ? 130
    : record.execution === 'failed' || record.delivery === 'failed' ? 1
    : record.delivery === 'partial' ? 2 : 0;
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      root: { type: 'string' },
      json: { type: 'boolean', default: false },
      session: { type: 'string' },
      port: { type: 'string' },
      'task-port': { type: 'string' },
      'no-open': { type: 'boolean', default: false },
      provider: { type: 'string' },
      model: { type: 'string' },
      all: { type: 'boolean', default: false },
      global: { type: 'boolean', default: false },
      revoke: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const [command, ...args] = positionals;
  if (values.help || !command) return console.log(help);
  if (command === 'init') {
    if (args.length > 1) throw new Error('Usage: lab-agent init [directory]');
    const directory = await scaffold(args[0]);
    console.log(`Created ${directory}\nInstall dependencies there, review the project, then run npx lab-agent trust and npm run ui.`);
    return;
  }
  if (command === 'trust') {
    if (args.length) throw new Error('Usage: lab-agent trust [--root directory] [--revoke]');
    const { ProjectTrustStore, getAgentDir } = await import('@earendil-works/pi-coding-agent');
    const root = resolve(values.root ?? process.cwd());
    new ProjectTrustStore(getAgentDir()).set(root, !values.revoke);
    console.log(JSON.stringify({ root, trusted: !values.revoke }));
    return;
  }
  if (!['run', 'check', 'ui', 'dev', 'models', 'use', 'config', 'inspect'].includes(command)) throw new Error(`Unknown command: ${command}\n${help}`);
  if (values.revoke) throw new Error('--revoke is for trust.');
  if ((values.provider || values.model) && !['run', 'models'].includes(command)) {
    throw new Error('--provider/--model are run options; models accepts --provider.');
  }
  if (values.model && command === 'models' || values.all && command !== 'models' || values.global && command !== 'use') {
    throw new Error('--all is for models, --global for use, and --model for run.');
  }
  if (values.provider !== undefined && !values.provider.trim() || values.model !== undefined && !values.model.trim()) {
    throw new Error('--provider and --model must not be empty.');
  }
  const { loadConfig, requireProjectTrust } = await import('./config.js');
  requireProjectTrust(values.root ?? process.cwd());
  const config = await loadConfig(values.root);
  if (resolve(config.root) !== resolve(values.root ?? process.cwd())) requireProjectTrust(config.root);
  if (command === 'config') {
    if (args.length) throw new Error('Usage: lab-agent config [--json]');
    const { configuration } = await import('./models.js');
    console.log(JSON.stringify(configuration(config), null, values.json ? undefined : 2));
    return;
  }
  if (command === 'ui' || command === 'dev') {
    if (args.length) throw new Error(`Usage: lab-agent ${command} [--port number] [--no-open]`);
    const port = values.port === undefined ? undefined : Number(values.port);
    if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) {
      throw new Error('--port must be an integer between 1 and 65535.');
    }
    const { launchUI } = await import('./ui.js');
    const taskPort = values['task-port'] === undefined ? undefined : Number(values['task-port']);
    process.exitCode = await launchUI(config, { port, taskPort, open: !values['no-open'] });
    return;
  }
  if (command === 'check') {
    if (args.length !== 1) throw new Error('Usage: lab-agent check <run-directory>');
    report(await checkRun(config, args[0]), values.json);
    return;
  }
  if (command === 'run' && !args.length) throw new Error('Usage: lab-agent run <task>');
  if (command === 'run' && Boolean(values.provider) !== Boolean(values.model)) {
    throw new Error('Specify both --provider and --model for a per-run override.');
  }
  if (command === 'models' && args.length || command === 'use' && args.length !== 2) {
    throw new Error('Usage: lab-agent models [--provider name] [--all] | lab-agent use <provider> <model> [--global]');
  }
  const [{ createAgent, RunError }, { SessionManager }] = await Promise.all([
    import('./agent.js'), import('@earendil-works/pi-coding-agent'),
  ]);
  const { configuration, listModels, selectModel, useModel } = await import('./models.js');
  const sessionManager = command === 'run' && values.session
    ? SessionManager.open(resolve(values.session), undefined, config.root) : undefined;
  const modelChange = sessionManager?.getBranch().findLast(entry => entry.type === 'model_change');
  const restoredModel = sessionManager?.buildSessionContext().model;
  const defaults = command === 'run' ? configuration(config).defaults : undefined;
  const agent = await createAgent(config, sessionManager ? { sessionManager } : undefined);
  if (command === 'inspect') {
    try {
      if (args.length) throw new Error('Usage: lab-agent inspect [--json]');
      const { inspectSession } = await import('./inspect.js');
      console.log(JSON.stringify(await inspectSession(agent.session), null, values.json ? undefined : 2));
    } finally { await agent.dispose(); }
    return;
  }
  if (command === 'models' || command === 'use') {
    try {
      if (command === 'models') {
        const models = listModels(agent.session, values.provider, values.all);
        if (values.json) console.log(JSON.stringify(models));
        else console.table(models);
      } else {
        const selected = await useModel(config, agent.session, args[0], args[1], values.global);
        console.log(JSON.stringify(selected, null, values.json ? undefined : 2));
        if (!selected.configured) console.error('Defaults saved. Configure this provider before running it.');
      }
    } finally { await agent.dispose(); }
    return;
  }
  const unsubscribe = agent.session.subscribe(event => {
    if (values.json) return;
    if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
      process.stdout.write(event.assistantMessageEvent.delta);
    } else if (event.type === 'tool_execution_start') {
      process.stderr.write(`\n[tool: ${event.toolName}]\n`);
    }
  });
  const abort = () => {
    void agent.session.abort().catch(error => console.error(error));
  };
  process.once('SIGINT', abort);
  process.once('SIGTERM', abort);
  try {
    // Keep a native virtual router selected instead of its last physical responder.
    const saved = modelChange && agent.session.modelRuntime.getModel(modelChange.provider, modelChange.modelId)?.api === 'pi-virtual'
      ? modelChange : restoredModel;
    const provider = values.provider ?? saved?.provider ?? defaults?.provider;
    const model = values.model ?? saved?.modelId ?? defaults?.model;
    // Native Pi may fall back. Standard CLI runs enforce a named selection exactly.
    await selectModel(agent.session, provider, model);
    report(await agent.run(args.join(' ')), values.json);
  } catch (error) {
    if (!(error instanceof RunError)) throw error;
    console.error(error.message);
    report(error.run, values.json);
  } finally {
    process.off('SIGINT', abort);
    process.off('SIGTERM', abort);
    unsubscribe();
    await agent.dispose();
  }
}

main().catch(error => {
  const message = error instanceof Error ? error.message : String(error);
  if (process.argv.includes('--json')) console.log(JSON.stringify({ error: { message } }));
  console.error(message);
  process.exitCode = 1;
});
