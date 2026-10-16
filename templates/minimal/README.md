# My Agent

Requires Node.js 22.19+ and a model with working credentials and tool support.
The `lab-agent` commands are provided by the `lab-agent-core` dependency.

1. Install the supplied build with `npm install /path/to/lab-agent-core-0.1.0.tgz`.
   Once Core is published to your registry, plain `npm install` can be used.
2. Edit `AGENTS.md` to set your Agent's role, task rules and output expectations.
3. Configure native Pi credentials, run `npx lab-agent models`, and save a pair
   from that list with `npx lab-agent use PROVIDER MODEL_ID`.
4. Run `npm run run -- "Read AGENTS.md and write a short report.md"`.
5. Open browser chat with `npm run ui`; `npm run dev` is the same command.

| I want to… | Change |
| --- | --- |
| Set the role and rules | `AGENTS.md` |
| Add task knowledge | `.agents/skills/<name>/SKILL.md` |
| Call Python | A script under `scripts/`, through Pi Bash |
| Add a structured tool | `.pi/extensions/` |
| Control stages from Python | A CLI driver under `workflows/` |
| Select a model | `lab-agent use` / `.pi/settings.json` |
| Check a delivery | A script under `checks/` and `validation.command` in `agent.config.ts` |

Core tasks save `runs/<id>/run.json` and `output/`; without a checker, delivery
is `not_checked`. Native `agent.session.prompt()` and Pi Web chat do not create
Core task records or automatically check deliveries. `dev` does not watch files.

Continue with `node_modules/lab-agent-core/docs/QUICKSTART.md`. A complete Python
Agent is included under `node_modules/lab-agent-core/examples/sequence-summary/`;
provider setup is in the installed `docs/MODELS.md` and the API/backend guide is
in `docs/IMPLEMENTATION.md`.
