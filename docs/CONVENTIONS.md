# Agent development conventions v0.1

## Dependencies and project layout

Each application depends on a versioned `lab-agent-core` package. Do not copy Core
source into applications. Keep `package.json`, `agent.config.ts` and `AGENTS.md` at
the project root. Add other directories only when used:

| Path | Responsibility |
| --- | --- |
| `.agents/skills/<name>/SKILL.md` | Native Pi task knowledge |
| `.pi/extensions/` | Native Pi tools and hooks |
| `.pi/settings.json` | Native model and resource configuration |
| `scripts/`, `workflows/` | Application programs and orchestration |
| `checks/` | Independent delivery checks |
| `runs/` | Generated outputs and run records; exclude from Git |

Commit dependency lockfiles. Pi sibling packages are pinned together; update Core
only after SDK, UI and external-consumer compatibility checks pass. A project that
imports Pi APIs directly should declare those packages as direct dependencies.

Model/provider configuration remains native Pi. `lab-agent use PROVIDER MODEL`
saves project defaults; `--global` explicitly changes global defaults. Per-run
`--provider`/`--model` options do not rewrite defaults. See
[providers and models](MODELS.md) for precedence, credentials and custom endpoints.
CLI runs enforce a named override, restored session model or configured default
before inference; unavailable named selections fail instead of using another
provider. Direct SDK/UI startup retains Pi's native selection behavior.

## Public API and execution ownership

`defineAgent({ root, validation? })` describes project location and optional
delivery checks. `createAgent(config, nativeOptions?)` accepts native Pi session
options except `cwd`, which always comes from the project root. Models, tools,
skills, extensions and context remain native Pi concepts.

`agent.run(task)` creates a run directory, tells Pi where outputs belong, waits for
native `prompt()` completion, lists output files and invokes the configured
checker. Calls on one session are sequential. `agent.session` is the original
Pi `AgentSession`; use its events, cancellation and advanced APIs directly.
Always `await agent.dispose()` in `finally`. Disposal waits for cancellation and
native shutdown hooks, including extension/MCP cleanup, before releasing the session.

`agent.session.prompt()`, Pi RPC and UI chats bypass automatic Core delivery
checks. UI uses filesystem/native Pi configuration, not an SDK caller's in-memory
model, tool or resource overrides. `lab-agent dev` is an alias of `lab-agent ui`,
not a development server with hot reload.

Core preserves the SDK's native default tools plus discovered project extensions.
Pi CLI/Web-specific built-ins (MCP, codemode and tool search) are not implicitly
injected into SDK sessions. If needed, supply a native `DefaultResourceLoader`
through `createAgent`'s second argument, following Pi's
[SDK configuration](https://pi.dev/docs/latest/sdk). Shared custom tools belong in
project extensions. In Pi 1.2.0, the optional MCP factory uses the process-level
Pi directory by default; use `PI_CODING_AGENT_DIR` for that configuration rather
than assuming a session's `agentDir` redirects MCP credentials and settings.

## Delivery contract

A run has independent `execution` and `delivery` fields:

| Field | Values |
| --- | --- |
| `execution` | `running`, `completed`, `failed`, `aborted` |
| `delivery` | `not_checked`, `passed`, `partial`, `failed` |

No checker means `not_checked`. A successful model response never implies passed
delivery. `run.json` records the input, native session reference, output paths and
states. Its `model` pair records the final responding model when available.
Native Pi JSONL owns the conversation; Core does not duplicate transcripts.

The checker command is an argv array, executed without a shell in the project
root. It receives `AGENT_ROOT`, `AGENT_RUN_DIR`, `AGENT_OUTPUT_DIR` and
`AGENT_CHECK_FILE`. It must write JSON to `AGENT_CHECK_FILE`:

```json
{
  "status": "partial",
  "checks": [{ "name": "units", "status": "needs_review" }],
  "issues": ["Some measurements have no documented unit"]
}
```

Top-level status is `passed`, `partial` or `failed`; individual checks and issues
describe the application's evidence. Exit nonzero only for checker execution
failure; a valid partial/failed report can exit zero. Timeout, nonzero exit, missing
or invalid report produces failed delivery. Default timeout is 120 seconds;
configure `validation.timeoutMs` when needed. Rechecks remove the previous report
before invoking the checker. They do not change a failed execution into a success.

Use `lab-agent check <run-directory>` to recheck. Relative run paths resolve against
the configured project root; `--root` selects the project configuration. The
`run --session <file>` path resolves against the shell's current directory.
`--json` on `run`/`check` prints one final run record. CLI exit status is `0` for
completed passed/not-checked runs, `2` for partial, `1` for failure and `130` for an
aborted run. Thrown setup or model errors go to stderr and may have no JSON result;
an already-created run still retains its failure record on disk.

## Trust, persistence and long jobs

v0.1 is for trusted local projects. Agent instructions, extensions and checkers
can execute host code; Core provides no sandbox or multi-user authorization.
Keep UI on loopback and use an SSH tunnel for remote access. Starting Core opts in
to loading the configured project's resources; the UI launcher marks that project
trusted in Pi's native trust store. Do not run untrusted project configs or store
provider credentials in committed files.

SDK and UI share native Pi session storage. Resume an inactive session by its
JSONL path; do not write the same session from multiple processes concurrently.
Session continuation does not make external side effects durable. Applications
own job submission, job IDs, polling, cancellation and recovery. Core does not add
a scheduler, retry engine, checkpoint format or output-hashing layer.

Add ordinary application capabilities through skills, extensions, scripts or
native SDK options. A new task should not require editing Core's public code.
