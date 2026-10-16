# Sequence summary Agent

A complete starter for Python users: ask an Agent to summarize a FASTA file,
call a Python script, and independently check the resulting JSON. Python uses
only the standard library. The short sequences are synthetic teaching data;
this example makes no protein-function or experimental claims.

## Set up an independent project

Requires Node.js 22.19+, Python 3.10+ and a tool-capable model with credentials.
From a `lab-agent-core` repository checkout:

```sh
npm ci
npm pack
cp -R examples/sequence-summary ../sequence-agent
cd ../sequence-agent
npm install ../lab-agent-core/lab-agent-core-0.1.0.tgz
```

This creates a separate application using the packaged Core. If Core has already
been built, skip the first two commands. A copy taken from an installed npm
package can use its own supplied tarball instead; add `node_modules/`, `runs/`
and `__pycache__/` to that project's `.gitignore` if needed.

Configure [provider credentials](../../docs/MODELS.md#built-in-providers), then:

```sh
npx lab-agent trust
npx lab-agent inspect --json
npx lab-agent models
npx lab-agent use PROVIDER MODEL_ID
```

Replace the uppercase arguments with a pair from the catalog. Pi's existing
credentials are reused. A successful model listing does not test inference.

## Try the Python action without a model

```sh
python3 scripts/summarize.py data/sequences.fasta /tmp/sequence-summary.json
```

The JSON contains `source: "data/sequences.fasta"`, `sequence_count: 2` and
records `sample_a` (length 10) and `sample_b` (length 6). This is a script check;
it does not create a Core task or call a model.

## Run an Agent task

```sh
npm run run -- "Use the sequence-summary Skill to summarize data/sequences.fasta. Save summary.json in the delivery output directory."
```

The Agent reads the Skill and calls the script through native Bash. Core runs
`checks/validate.py` afterwards. Expect `execution: completed` and
`delivery: passed`, with files in:

```text
runs/<id>/
├── output/summary.json    Python's computed report
├── run.json               Execution/delivery states, model and session reference
├── check.json             Independent source/ID/length comparison
└── validation.log         Checker stdout/stderr
```

To run the same task from a Python controller:

```sh
python3 workflows/run.py
```

The driver prints the RunRecord as JSON and keeps the CLI's exit status. Change
this file to add your own stage order or external-job waiting. Core does not
supply a Python SDK or scientific workflow engine.

## Recheck and chat

Use the run path printed by your task:

```sh
npm run check -- runs/<id> --json
npm run ui
```

Rechecking does not call a model. The Task deliveries page can submit this same
task and show its files and checks. Its Pi Web chat link is for native exploration;
chat does not automatically create Core deliveries.

## What to change next

| File | Responsibility |
| --- | --- |
| `AGENTS.md` | Project role and rules |
| `.agents/skills/sequence-summary/SKILL.md` | How to perform the task |
| `data/sequences.fasta` | Input data |
| `scripts/summarize.py` | Python action; accepts input and output file arguments |
| `checks/validate.py` | Checks against `data/sequences.fasta`; adapt when your task/input changes |
| `agent.config.ts` | Connects the independent checker |
| `workflows/run.py` | Python controller for `lab-agent run --json` |
| `.pi/settings.json` | Created by `lab-agent use`; project model selection |

Full guides live in the repository's `docs/` or the installed
`node_modules/lab-agent-core/docs/`. Relative guide links in this README refer to
the repository/package layout; after copying, use the installed documentation.
