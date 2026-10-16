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
provider. The task page applies the same check. Direct SDK/native chat selection
retains Pi's native behavior.

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

`agent.session.prompt()`, Pi RPC and native Pi Web chat bypass automatic Core
delivery checks. The task page calls `agent.run()` and does run configured checks.
Both web entry points use filesystem/native Pi configuration, not an SDK caller's
in-memory overrides. `lab-agent dev` aliases `ui`, without hot reload.

## Native capability loading

Core's default resource loader supplies Pi's native `mcp`, `codemode` and
`tool-search` factories as replaceable built-in extensions. Pi still discovers
Skills, project extensions and packages, controls default tool activation, honors
`extensions: ["-builtin:mcp"]` (and equivalent exclusions), and lets a project
extension replace a built-in. Codemode and tool search are registered inactive
unless native settings or MCP exposure activates them. Configure MCP in native
`.pi/mcp.json` or `<agent-dir>/mcp.json`; there is no Core capability schema.

Pi 1.2.0's MCP factory reads the **process-level** Pi directory for configuration,
authentication and logs. Set `PI_CODING_AGENT_DIR` before starting the process
when using a custom directory. If SDK `options.agentDir` differs, Core leaves
MCP uninitialized when none is requested and rejects configured/registered MCP
instead of using another directory's credentials. Native `-builtin:mcp` can
explicitly disable it. A supplied `resourceLoader` owns its own extension policy.
Core does not mutate process environment variables or import private Pi modules.

For example, point `.pi/mcp.json` at an existing server (replace the sample path):

```json
{
  "mcpServers": {
    "lab": {
      "command": "python3",
      "args": ["/absolute/path/to/your_mcp_server.py"],
      "exposure": "direct"
    }
  }
}
```

Restart the session, then inspect it. Pi owns stdio/HTTP transport, authentication,
tool registration and shutdown. Direct exposure makes connected tools available
to the model; native deferred/codemode exposures remain available as documented
in the installed Pi package's `docs/mcp.md`.

Run `lab-agent inspect --json` after granting trust. It loads real resources,
waits for the native MCP status command, and reports instruction/Skill paths,
extensions, active/callable tools, diagnostics and native MCP status. It makes
no model request; startup can launch configured MCP processes and connect to
servers. Those processes are released after inspection. Registered/inactive
means different things; inspect does not claim an uncalled tool or provider has
passed an end-to-end task. Pi Web can have additional native UI-specific behavior;
Core does not promise equality of every built-in or in-memory SDK override.

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
Run-record writes use an atomic file replacement so concurrent readers see
complete JSON. This does not add a cross-process writer lock or a crash-recovery
engine; callers must still coordinate concurrent operations on the same run.

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
Only canonical directories inside the current project's own `runs/` are accepted.
External directories, a symlinked `runs/`, escaping run/output symlinks, and a
symlinked `run.json` are rejected. This prevents accidental cross-project writes;
it is not a filesystem sandbox for trusted tools or protection against hostile
concurrent filesystem changes.

Use `lab-agent check <run-directory>` to recheck. Relative run paths resolve against
the configured project root; `--root` selects the project configuration. The
`run --session <file>` path resolves against the shell's current directory.
`--json` on `run`/`check` prints one final RunRecord when a run exists.
SDK execution failures throw `RunError` with `.run` and the original `.cause`.
CLI failures after creation print that failed record and keep a nonzero exit code.
Setup errors before run creation print `{ "error": { "message": "..." } }`.
The setup envelope's `error` is an object; a failed RunRecord's `error` is a
string and the record still contains its ID, directory and execution state.
CLI exit status is `0` for
completed passed/not-checked runs, `2` for partial, `1` for failure and `130` for an
aborted run. Error messages are also printed to stderr. Rechecking a failed
execution does not change its execution status.

## Trust, persistence and long jobs

v0.1 is for trusted local projects. Agent instructions, extensions and checkers
can execute host code; Core provides no sandbox or multi-user authorization.
Review project code, then run `lab-agent trust --root /path/to/project`.
`--revoke` denies that project again. The command updates Pi's native `trust.json`
and does not evaluate project config. Other CLI project commands require trust
before evaluating `agent.config.ts`; a config redirecting `root` also requires
trust for the resulting workspace. SDK `createAgent()` and the UI launcher check
native trust before loading extensions. SDK callers can explicitly supply a
trusted native `SettingsManager` for session-only authorization. Direct SDK
`loadConfig()` is executable TypeScript, equivalent to importing project code;
its caller owns that authorization.

Keep both UI listeners on loopback and use SSH forwards for remote access. Trust
allows host code execution, not sandboxing. Do not commit provider credentials.

SDK and UI share native Pi session storage. Resume an inactive session by its
JSONL path; do not write the same session from multiple processes concurrently.
Session continuation does not make external side effects durable. Applications
own job submission, job IDs, polling, cancellation and recovery. Core does not add
a scheduler, retry engine, checkpoint format or output-hashing layer.

Add ordinary application capabilities through skills, extensions, scripts or
native SDK options. A new task should not require editing Core's public code.

## Task page and Pi Web

`lab-agent ui` launches two local listeners and opens the task page. Pi Web's
chat port defaults to 30141 (`--port`); the task listener uses an available port
or `--task-port`. The page links to native chat. It submits one project operation
at a time, uses a new native session per task, and reads `run.json`, `check.json`
and actual output files. It adds no separate run database or transcript store.
Existing CLI runs appear automatically. Rechecking uses the same `checkRun()`.
Task default-model selection follows the CLI's exact-name check.

The small HTTP adapter in `src/task-ui.ts` provides:

| Method / path | Behavior |
| --- | --- |
| `GET /api/runs` | List persisted run summaries, active state and unreadable-record issues |
| `GET /api/run?id=ID` | Read a run and its regular-file checker report |
| `GET /api/artifact?id=ID&path=output/...` | Download a listed artifact confined to that run's output |
| `POST /api/run` with `{task}` | Start `agent.run()`; return 202 once started, 409 when busy |
| `POST /api/check` with `{id}` | Recheck an existing run and return its updated record |

Mutations require JSON. Requests with another Origin or Host are rejected. This
is a trusted single-user loopback interface, not a public authenticated service.
Stopping the launcher aborts active Pi work, saves its terminal run record, waits
for native cleanup and closes both listeners. Long external scientific jobs
still require application-owned cancellation and recovery. The task page does
not expose native history editing, streaming chat or a multi-project scheduler.
