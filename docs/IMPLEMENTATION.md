# Implementation baseline

Package/project name: `lab-agent-core`; executables remain `lab-agent` and
`create-lab-agent`. Model/provider configuration follows native Pi files. CLI
`models`, `use`, `config`, and per-run `--provider/--model` are conveniences over
that format, not a second provider protocol. See MODELS.md for selection scopes.

The approved user design is implemented as one package with native Pi escape hatches. This document records concrete contracts, not a new framework.

- Node >=22.19; Pi packages exactly 1.2.0; Pi Web 0.12.2. Pi's sibling packages are pinned together because they otherwise use caret dependencies. UI and Core must share the same native session format.
- `defineAgent({root, validation?})`; `createAgent(config, nativeOptions?)`. Native options are Pi `CreateAgentSessionOptions` except `cwd`, which is the project root. UI uses native project configuration, not programmatic in-memory overrides.
- Preserve SDK native default tools and project extensions; do not recreate CLI-specific built-in MCP/codemode initialization. Advanced callers can supply native resourceLoader. Async `dispose()` awaits abort and native extension shutdown before invalidating the session.
- `run(task)` creates `runs/<timestamp>-<random-id>/output`, prompts Pi with that location, waits for native `prompt()` completion, records output files, then invokes the optional checker. No custom agent loop or retry policy.
- Run execution (`running/completed/failed/aborted`) and delivery (`not_checked/passed/partial/failed`) are independent. No checker means `not_checked`, never implicit success.
- Checker runs an argv array without a shell, with project cwd and `AGENT_ROOT`, `AGENT_RUN_DIR`, `AGENT_OUTPUT_DIR`, `AGENT_CHECK_FILE`. It writes `check.json` with status, checks and issues. Nonzero exit, timeout, missing or malformed report means failed delivery. Rechecks remove the old report first.
- Native Pi JSONL remains the conversation/event source; Core stores only its run record and checker log, without duplicating the transcript or hashing outputs.
- Runs on a session are sequential. Native session operations bypass automatic delivery checks. File-producing jobs and side-effect recovery remain the application's responsibility.
- Pi Web runs on loopback, with the same Pi agent directory and a project cwd deep link. UI interaction does not invoke Core delivery automatically. Explicit check command is available for existing Core runs.
- Trusted local project only; no sandbox/multi-user service claim. SDK and UI cannot concurrently mutate the same session.

Acceptance cases: real Pi runtime with a deterministic local HTTP model fixture; extensions, skills, tool execution, native persistence, packed external consumers, Python workflow, checker failures, and upstream UI endpoints. Real paid-provider inference is reported separately from these engineering checks.
