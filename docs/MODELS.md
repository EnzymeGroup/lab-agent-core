# Providers and models

Core uses Pi 1.2.0's model catalog, credentials and settings. `agent.config.ts`
continues to describe the project root and delivery checker; it does not contain
provider credentials or a second model configuration format.

## Choose a model

Run these commands in an initialized project. `--root /path/to/project` selects
another project's configuration.

```sh
npx lab-agent models
npx lab-agent models --provider lab-local --all --json
npx lab-agent config --json
npx lab-agent use lab-local org/model-id
npx lab-agent run "Analyze the inputs" --provider lab-local --model org/model-id
```

- `models` lists native chat models whose authentication is configured. `--all`
  also shows catalog models without configured authentication; `--provider`
  filters by provider identity. A catalog entry and configured authentication
  are **not an endpoint health check**, proof of access, or a tool-use benchmark.
- `config` shows native file locations and configured defaults without printing
  credentials or header values. Configured defaults are not necessarily the
  model already selected in an existing session.
- `use PROVIDER MODEL` saves both fields to the project's `.pi/settings.json`,
  preserving unrelated settings. The exact model must exist in the native
  catalog; authentication can be set up afterwards.
- `use PROVIDER MODEL --global` explicitly changes the defaults in the Pi agent
  directory. A project's own defaults still override them.
- `run --provider PROVIDER --model MODEL` selects that exact pair for this
  invocation. Supply both options. It does not change project/global defaults;
  the chosen model remains part of the native session history. The same override
  can accompany `--session /path/to/session.jsonl`.

Provider and model are separate arguments. `org/model-id` is one literal model
ID; Core does not split it at `/`, apply fuzzy matching, or invent catalog entries.

## Native files and precedence

The Pi agent directory is `~/.pi/agent`, or `PI_CODING_AGENT_DIR` when set. Use an
absolute path for that environment variable and pass it to both CLI and UI.

| File | Purpose |
| --- | --- |
| `<agent-dir>/models.json` | Endpoint, API dialect, custom model metadata and credential references |
| `<agent-dir>/auth.json` | Pi-managed credentials and sign-ins |
| `<agent-dir>/settings.json` | Global defaults |
| `<project>/.pi/settings.json` | Project overrides, including `defaultProvider` and `defaultModel` |
| `agent.config.ts` | Core project root and delivery check only |

For `lab-agent run`, the selection order is:

1. Explicit `--provider` and `--model`.
2. The model recorded in a supplied `--session` conversation.
3. Project defaults, with global defaults providing fields the project omits.

When this selects a named pair, the CLI resolves that exact catalog entry and
checks authentication before starting the task. A missing model or unconfigured
credential fails instead of sending the task to a fallback provider. You may
therefore save defaults with `use` before setting up credentials, but must
configure authentication before running that selection. If no named selection
exists, native Pi automatic model selection remains available.

This guard does not rewrite project/global defaults. Native session creation and
selection can still update session metadata before an error; a rejected resume
is not promised to leave the session file byte-for-byte unchanged. `run.json`
includes `model: {provider, id}` and records the final responding model when a
response exists, which can differ from a virtual/routing model selected initially.

Direct SDK creation and Pi Web retain native selection behavior: a saved/default
model without configured authentication can fall back to another available
model, or leave the session without one. Use an explicit native `setModel` call
in SDK code when exact selection is required. Authentication being configured
does not guarantee that a subsequent request will succeed.

Project settings merge by field, so set `defaultProvider` and `defaultModel`
together. `lab-agent use` does this for you. Direct native
`SettingsManager.setDefaultModelAndProvider()` writes **global** defaults.

Pi Web shares these files. A newly created session can use project defaults;
an explicit browser model selection and native `enabledModels` scope also affect
its choice. Changing defaults does not switch an active conversation. Reload the
UI and start a new session to use changed defaults, or select a model explicitly
in that conversation. The UI model picker and its save-default controls are
upstream Pi Web behavior; use Core's `use` command for explicit project/global
scope.

## Built-in providers

Use the provider's documented environment variable or Pi's native sign-in/key
configuration. Existing Pi credentials work without copying them into the project.
Use `models --all` to inspect known provider/model pairs and `models` after
configuring authentication. See the bundled Pi provider documentation for the
environment variables supported by the pinned version.

Pi resolves credentials in this order: explicit runtime override, stored
`auth.json` credential, `models.json` API key, then the provider's environment or
ambient credentials. Provider extensions can define different authentication.
A stored credential can therefore take precedence over a newly exported key.
Do not commit secrets; environment variables must reach the process that starts
the CLI or UI.

## Custom compatible endpoint

Provider identity, API dialect and model ID mean different things:

| Field | Meaning | Example |
| --- | --- | --- |
| Provider | Local identity for this connection | `lab-local` |
| `api` | Pi's request/response implementation | `openai-completions` |
| `baseUrl` | Service endpoint prefix | `http://127.0.0.1:8000/v1` |
| Model `id` | Exact identifier the service accepts | `org/model-id` |

For a service implementing the OpenAI chat-completions protocol, add this entry
to `<agent-dir>/models.json`, preserving any existing providers:

```json
{
  "$schema": "https://pi.dev/schemas/models.schema.json",
  "providers": {
    "lab-local": {
      "baseUrl": "http://127.0.0.1:8000/v1",
      "api": "openai-completions",
      "apiKey": "${LAB_MODEL_API_KEY}",
      "models": [{
        "id": "org/model-id",
        "name": "Lab model",
        "input": ["text"],
        "reasoning": false,
        "contextWindow": 32768,
        "maxTokens": 4096
      }]
    }
  }
}
```

The address, ID and limits are placeholders. Replace them with the deployed
service's actual values and capabilities. This example does not certify that a
particular model supports tool calls or that every compatible server implements
all request fields. Use `openai-responses` for a Responses-protocol endpoint or
`anthropic-messages` for an Anthropic Messages endpoint, only when the service
actually implements that dialect. The name of a model does not determine its API.

Set `LAB_MODEL_API_KEY` in the launching environment, then:

```sh
npx lab-agent models --provider lab-local --all
npx lab-agent use lab-local org/model-id
npx lab-agent run "Reply briefly" --provider lab-local --model org/model-id
```

Pi supports `$NAME` and `${NAME}` references in API keys and headers. Keep these
references literal in the JSON file rather than substituting secrets into it.
For a deliberately unauthenticated local endpoint that ignores the key, a dummy
literal such as `local-unused` makes authentication configured in Pi. This does
not disable authentication on a server that requires it. Native `!command`
credential values execute commands; use them only in trusted configuration.

## Programmatic selection

Use the native runtime to resolve a known model and select it for the session:

```ts
import { createAgent } from 'lab-agent-core';
import config from './agent.config.ts';

const agent = await createAgent(config);
try {
  const model = agent.session.modelRuntime.getModel('lab-local', 'org/model-id');
  if (!model) throw new Error('Model is not in the native catalog');
  await agent.session.setModel(model, { persist: false });
  await agent.run('Analyze the inputs');
} finally {
  await agent.dispose();
}
```

`setModel` checks authentication and records the choice in the session; it does
not make an inference request to validate endpoint health. `persist: false` is
the native default. `persist: true` also changes **global** defaults. A resolved
native model can instead be passed as `createAgent(config, { model })`.

SDK `agentDir` and a supplied `modelRuntime` are native overrides for that caller.
The separately launched UI cannot inherit in-memory options. Use native files
and the same `PI_CODING_AGENT_DIR` when both interfaces should share configuration.

Upstream references: [Pi models](https://pi.dev/docs/latest/models),
[providers](https://pi.dev/docs/latest/providers),
[SDK](https://pi.dev/docs/latest/sdk). Behavior above was checked against the
installed Pi **1.2.0** sources; upstream online documentation may describe newer
versions.
