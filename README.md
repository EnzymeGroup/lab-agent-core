# lab-agent-core

Build a dedicated lab Agent in its own project using Pi SDK. Get shared startup,
model configuration, browser chat and task delivery checks; add your own Skills,
Python scripts and scientific acceptance rules.

**Pi executes models and tools. Core organizes runs and checks. Your project
supplies the task knowledge and decides what a usable result is.**

## Your first Agent

Requires **Node.js 22.19+** and credentials for a model that supports tool calls.
Python examples require **Python 3.10+**, with no third-party Python packages.

### 1. Create a project

The npm package has **not been published**. For now, build it once from this
repository and install that build in a separate project:

```sh
git clone https://github.com/EnzymeGroup/lab-agent-core.git
cd lab-agent-core
npm ci
npm pack
node dist/create.js ../my-agent
cd ../my-agent
npm install ../lab-agent-core/lab-agent-core-0.1.0.tgz
```

Already have a checkout or an installable tarball? See [installation options](docs/INSTALL.md).

### 2. Give it instructions

Edit `my-agent/AGENTS.md`, for example:

```md
You are a research assistant for this project.
Read the input files before drawing conclusions. Cite their paths.
Save deliverables in the output directory given in the task.
State missing evidence explicitly.
```

### 3. Select a model and run a task

Existing Pi credentials are reused. For a new provider, first follow the
[credential setup](docs/MODELS.md#built-in-providers); then run inside `my-agent/`:

```sh
npx lab-agent models
npx lab-agent use PROVIDER MODEL_ID
npm run run -- "Read AGENTS.md and write a short project summary to report.md"
```

Replace `PROVIDER` and `MODEL_ID` with a pair from `models`. Results are saved in
`runs/<id>/output/`; the CLI prints the run directory. Without a checker, delivery
is `not_checked` even when execution completes.

### 4. Open browser chat

```sh
npm run ui
```

Open the printed local URL. Browser chat uses Pi Web and native sessions;
**automatic delivery checks run through `lab-agent run`, not through chat**.
For a remote server, see [accessing the UI](docs/QUICKSTART.md#6-open-the-ui).

## What should I change?

| I want to… | Change or use |
| --- | --- |
| Set the Agent's role and working rules | `AGENTS.md` |
| Teach a task-specific procedure | `.agents/skills/<name>/SKILL.md` |
| Add a structured tool or hook | `.pi/extensions/` — [tool example](docs/EXTENDING.md) |
| Call Python | `scripts/` — invoked through Pi's Bash tool |
| Control stages or launch tasks from Python | `workflows/` — [working Python driver](examples/sequence-summary/workflows/run.py) |
| Select a model | `lab-agent use PROVIDER MODEL_ID` → `.pi/settings.json` |
| Configure an endpoint or credentials | [Provider/file lookup](docs/MODELS.md#native-files-and-precedence) |
| Define acceptance checks | `checks/` + `validation.command` in `agent.config.ts` |
| Recheck an existing delivery | `npm run check -- runs/<id>` |
| Explore through browser chat | `npm run ui` |

## Task run or conversation?

| Entry | Purpose | Creates Core run/output directory | Runs configured checker |
| --- | --- | --- | --- |
| `lab-agent run` / `agent.run(task)` | Deliver a recorded, checkable task | Yes | After completed execution |
| `agent.session.prompt(text)` | Use the native Pi conversation API | No | No |
| `lab-agent ui` | Explore and chat in Pi Web | No | No |

## Start from a complete Python example

[Sequence summary](examples/sequence-summary/README.md) is a small, runnable Agent
with sample FASTA data, a Skill, a Python analysis script, an independent checker
and a Python task driver. Copy it into a separate project, install Core and use
it as the starting point for your own scientific tools.

## Read next

| Guide | For |
| --- | --- |
| [Quickstart](docs/QUICKSTART.md) | Add a Skill, call Python, wire a checker and run the UI |
| [Installation](docs/INSTALL.md) | Current local build/tarball setup and future registry installation |
| [Providers and models](docs/MODELS.md) | Credentials, custom endpoints and configuration lookup |
| [Tools and workflows](docs/EXTENDING.md) | Structured Pi tools, TypeScript API and Python composition |
| [Architecture and source map](docs/IMPLEMENTATION.md) | Mermaid diagram, backend request paths and every source file |
| [Conventions](docs/CONVENTIONS.md) | Run states, checker contract, lifecycle and application boundaries |
| [Validation](docs/VALIDATION.md) | Test evidence and its limits |
| [Newcomer exercise](docs/ONBOARDING.md) | A practical usability test for two new developers |

Maintainers: `npm run verify` checks types, runtime, installed examples and Pi Web;
`npm pack` builds the installable package. Upstream: [Pi SDK](https://pi.dev/docs/latest/sdk)
and [Pi Web](https://github.com/agegr/pi-web).
