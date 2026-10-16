# My Agent

Requires Node.js 22.19 or newer and a configured Pi model/provider.

1. Install dependencies with `npm install`. For an unpublished Core build, use
   `npm install /absolute/path/lab-agent-core-0.1.0.tgz` instead.
2. Customize `AGENTS.md`.
3. Run `npm run run -- "Read this project and explain its purpose"`.
4. Open Pi Web with `npm run ui`; `npm run dev` is the same command, without watching files.

Add skills in `.agents/skills/<name>/SKILL.md` and native Pi extensions in
`.pi/extensions/`. Create `scripts/` and `checks/` only when needed.

Core runs save `runs/<id>/run.json` and `output/`. No checker means delivery is
`not_checked`. UI conversations use native Pi sessions and do not automatically
create Core runs or check deliverables.

See the installed Core package's `docs/QUICKSTART.md` and `docs/CONVENTIONS.md`
for programmatic use, validation and Python examples.
