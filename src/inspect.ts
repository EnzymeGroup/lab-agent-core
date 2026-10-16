import { getAgentDir, type AgentSession } from '@earendil-works/pi-coding-agent';

/** Native discovery and MCP status only; does not send an inference request. */
export async function inspectSession(session: AgentSession) {
  const runner = session.extensionRunner;
  const mcp = runner.getCommand('mcp');
  const status: Array<{ message: string; type: string }> = [];
  if (mcp) {
    const context = runner.createCommandContext();
    await mcp.handler('', { ...context, ui: { ...context.ui,
      notify: (message, type = 'info') => { status.push({ message, type }); },
    } });
  }
  const active = new Set(session.getActiveToolNames());
  const callable = new Set(session.getCallableToolNames());
  const loader = session.resourceLoader;
  return {
    model: session.model ? { provider: session.model.provider, id: session.model.id } : null,
    instructions: loader.getAgentsFiles().agentsFiles.map(file => file.path),
    skills: loader.getSkills().skills.map(skill => ({ name: skill.name, file: skill.filePath })),
    extensions: runner.getExtensionPaths(),
    tools: session.getAllTools().map(tool => ({ name: tool.name, active: active.has(tool.name), callable: callable.has(tool.name) })),
    diagnostics: [...loader.getSkills().diagnostics, ...(loader.getExtensions().warnings ?? [])],
    mcp: { loaded: !!mcp, processAgentDir: getAgentDir(), status },
  };
}
