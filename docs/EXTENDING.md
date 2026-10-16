# Tools and programmatic workflows

Start with the [Quickstart](QUICKSTART.md) or the complete
[Python example](../examples/sequence-summary/README.md). Most Python tools only
need an ordinary script called through Pi Bash. This reference covers structured
Pi tools and programmatic composition.

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
