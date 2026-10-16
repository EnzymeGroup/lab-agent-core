# Quickstart

Build a first Agent without reading Core source. Requires Node.js 22.19+, Python
3.10+ for the example, and a tool-capable model with working credentials.

## 1. Create and configure

Start from the complete example. From the repository checkout:

```sh
npm ci
npm pack
cp -R examples/sequence-summary ../sequence-agent
cd ../sequence-agent
npm install ../lab-agent-core/lab-agent-core-0.1.0.tgz
```

For an empty project instead, use [README step 1](../README.md#1-create-a-project).
All commands below run inside `sequence-agent/`:

```sh
npx lab-agent trust                          # After reviewing the copied project
npx lab-agent config                         # Show paths and defaults
npx lab-agent inspect --json                 # Actually loaded tools, skills, MCP
npx lab-agent models                         # Models with configured credentials
npx lab-agent use PROVIDER MODEL_ID          # Save your selected pair
```

Existing Pi settings are reused. For a new provider, see
[credentials](MODELS.md#built-in-providers) and [custom endpoints](MODELS.md#custom-compatible-endpoint).
`use` saves a selection; it does not test provider connectivity.

## 2. Write rules and a Skill

`AGENTS.md` sets the Agent's project-wide role and rules. Put reusable procedures
in `.agents/skills/<name>/SKILL.md`, for example:

```md
---
name: sequence-summary
description: Summarize FASTA record IDs and sequence lengths using Python.
---
Read the input FASTA. Run scripts/summarize.py with the input path and
an output file in the task's delivery directory. Report the output path.
```

Skills teach the model how to work; they do not enforce execution order. Reload
or create a new session after changing resources.

## 3. Call an existing Python script

Python scripts run through Pi's built-in Bash tool. No Python SDK or tool wrapper
is required. Try the [complete example](../examples/sequence-summary/README.md),
which includes every file used here:

```sh
python3 scripts/summarize.py data/sequences.fasta /tmp/sequence-summary.json
```

In an Agent task, ask it to use that script and save `summary.json` in the output
directory supplied by Core. Start with:

```sh
npm run run -- "Use the sequence-summary Skill to summarize data/sequences.fasta"
```

[Structured tools](EXTENDING.md) are optional when you want typed parameters
rather than a shell command.

## 4. Define and inspect acceptance

In `agent.config.ts`, point to an application-owned checker:

```ts
import { defineAgent } from 'lab-agent-core';
export default defineAgent({
  root: import.meta.dirname,
  validation: { command: ['python3', 'checks/validate.py'] },
});
```

The example's [checker](../examples/sequence-summary/checks/validate.py) compares
the report with the input FASTA. Core sets `AGENT_OUTPUT_DIR` and
`AGENT_CHECK_FILE`; the checker writes `{status, checks, issues}` there.
The exact schema and timeout behavior are in [Conventions](CONVENTIONS.md#delivery-contract).

A completed task produces `runs/<id>/run.json` and `output/`; a configured checker
also produces `check.json` and `validation.log`. `execution: completed` and
`delivery: passed` describe different things. No checker means `not_checked`.
Recheck an existing run without calling a model:

```sh
npm run check -- runs/<id> --json
```

## 5. Launch tasks from Python

Run the example's [Python driver](../examples/sequence-summary/workflows/run.py):

```sh
python3 workflows/run.py
```

It calls `lab-agent run --json`, parses the RunRecord and preserves the CLI exit
code. Exit codes are `0` for completed passed/not-checked, `2` for partial, `1`
for failure and `130` for abort. Failed execution returns its RunRecord with
nonzero status; setup errors return `{error: {message}}`. The driver preserves
this status and checks the error object. Add your stage order and external-job
recovery here. For native session control or TypeScript, see [Tools and workflows](EXTENDING.md).

## 6. Open the UI

```sh
npm run ui
# Remote server: choose a port and skip opening a server-side browser.
npm run ui -- --no-open --port 3141 --task-port 3142
```

For remote use, forward both ports from your own computer:
`ssh -N -L 3141:127.0.0.1:3141 -L 3142:127.0.0.1:3142 USER@SERVER`.
Open `http://127.0.0.1:3142` for tasks and use its Pi Web chat link.
Without `--task-port`, the task page uses an automatic loopback port.
The task page submits one operation at a time and shows actual files and checks.

| Mode | Entry | Core record/checker |
| --- | --- | --- |
| Task delivery | CLI, `agent.run()` or task page | Yes / configured checker |
| Native conversation | `agent.session.prompt()` or Pi Web chat | No / no |

The task page uses Core's delivery wrapper; Pi Web chat remains native. Both use
project files and native Pi configuration. `npm run dev` aliases `ui`, without file watching.
Start with trusted local projects; SDK and UI must not write the same native
session concurrently. See the [backend diagram](IMPLEMENTATION.md#architecture)
when you need implementation details.
