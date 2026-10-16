# Quickstart

## Create and run

Use Node.js 22.19 or newer. From the Core checkout, run `npm ci` and `npm pack`.
Create a separate project using the resulting package:

```sh
npm exec --package=/absolute/path/lab-agent-core-0.1.0.tgz -- create-lab-agent my-agent
cd my-agent
npm install /absolute/path/lab-agent-core-0.1.0.tgz
```

After `lab-agent-core` is published to your registry, the equivalent is
`npm exec --package=lab-agent-core -- create-lab-agent my-agent`, followed by
`npm install` in the project. `create-lab-agent` is an executable in the Core
package, not a separately published package.

Configure your provider through native Pi settings and credentials. Existing Pi
credentials/settings are reused. Inspect models with `npx lab-agent models`, then
save a project default with `npx lab-agent use PROVIDER MODEL`. For a one-run
override, append `--provider PROVIDER --model MODEL` to the run command. See
[providers and models](MODELS.md) for built-in authentication, a custom endpoint
example and configuration precedence. Do not commit credentials.

Edit `AGENTS.md`, then:

```sh
npm run run -- "Read AGENTS.md and describe this project's purpose"
npm run ui
# On a remote host, use a local SSH port forward to the printed loopback URL.
npm run ui -- --no-open --port 3141
```

`npm run dev` also starts Pi Web; it does not enable file watching. UI uses the
project's native Pi settings, skills and extensions. It does not apply in-memory
SDK options or automatically create Core delivery runs.

The generated `agent.config.ts` contains only:

```ts
import { defineAgent } from 'lab-agent-core';
export default defineAgent({ root: import.meta.dirname });
```

## Extend and compose

Add a skill at `.agents/skills/summarize/SKILL.md`:

```md
---
name: summarize
description: Summarize project inputs with source references.
---
Read the relevant files. Cite their paths and preserve unresolved questions.
```

Use Pi's Bash tool to call existing scripts such as `python3 scripts/analyze.py`.
For a structured tool, add `.pi/extensions/hello.ts` using native Pi APIs:

```ts
import { Type } from '@earendil-works/pi-ai';
import { defineTool, type ExtensionAPI } from '@earendil-works/pi-coding-agent';

export default function (pi: ExtensionAPI) {
  pi.registerTool(defineTool({
    name: 'hello', label: 'Hello', description: 'Greet a named person.',
    parameters: Type.Object({ name: Type.String() }),
    async execute(_id, { name }) {
      return { content: [{ type: 'text', text: `Hello, ${name}!` }], details: {} };
    },
  }));
}
```

If your source imports Pi packages, declare those direct dependencies, using the
compatible pinned versions:

```sh
npm install @earendil-works/pi-ai@1.2.0 @earendil-works/pi-coding-agent@1.2.0
```

Start Core only in trusted projects: it loads the project's native resources, and
the UI launcher records that project as trusted in Pi. Core does not supply an
additional tool or plugin interface.

For a TypeScript workflow, save `workflow.ts` and run `node workflow.ts`:

```ts
import { createAgent } from 'lab-agent-core';
import config from './agent.config.ts';

const agent = await createAgent(config); // Optional second argument: native Pi options
try {
  const result = await agent.run('Inspect the input files and write a short report');
  console.log(result.directory, result.delivery);
  await agent.session.prompt('Explain the remaining uncertainties');
} finally {
  await agent.dispose();
}
```

Python can call the CLI without a Python SDK:

```python
import json
import subprocess

completed = subprocess.run(
    ["./node_modules/.bin/lab-agent", "run", "Summarize the inputs", "--json"],
    text=True, capture_output=True,
)
if completed.returncode not in (0, 1, 2) or not completed.stdout.strip():
    raise RuntimeError(completed.stderr)
result = json.loads(completed.stdout)
print(result["execution"], result["delivery"], result["artifacts"])
```

For a persistent Python-controlled session, use
[Pi RPC](https://pi.dev/docs/latest/rpc) directly; native RPC does not run Core's
delivery wrapper. Resume a Core session using
`npm run run -- "Continue the analysis" --session /path/to/session.jsonl`.

## Add a delivery check

Add `validation: { command: ['python3', 'checks/validate.py'] }` to the config.
The checker runs in the project root and receives `AGENT_OUTPUT_DIR`,
`AGENT_RUN_DIR`, `AGENT_ROOT` and `AGENT_CHECK_FILE`. Example `checks/validate.py`:

```python
import json
import os
from pathlib import Path

output = Path(os.environ["AGENT_OUTPUT_DIR"])
report = output / "report.md"
present = report.is_file() and bool(report.read_text().strip())
Path(os.environ["AGENT_CHECK_FILE"]).write_text(json.dumps({
    "status": "passed" if present else "failed",
    "checks": [{"name": "report_exists", "status": "passed" if present else "failed"}],
    "issues": [] if present else ["Expected a non-empty report.md"],
}))
```

This checks file presence, not scientific correctness. Replace it with your task's
actual requirements. Each Core run saves `runs/<id>/output/` and `run.json`;
configured checks also produce `check.json` and a checker log. Recheck with
`npm run check -- runs/<id> --json`. Exit codes: `0` passed or not checked,
`2` partial delivery, `1` execution/check failure, `130` aborted.
