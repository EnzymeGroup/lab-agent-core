"""Launch a checked Core task from Python. No Python SDK required."""

import json
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parents[1]
completed = subprocess.run(
    [str(root / "node_modules/.bin/lab-agent"), "run",
     "Use the sequence-summary Skill to summarize data/sequences.fasta. "
     "Save summary.json in the delivery output directory.", "--json"],
    cwd=root, text=True, capture_output=True,
)
if not completed.stdout.strip():
    raise SystemExit(completed.stderr.strip() or "Task returned no run record")
record = json.loads(completed.stdout)
if isinstance(record.get("error"), dict):
    raise SystemExit(record["error"]["message"])
print(json.dumps(record, indent=2))
raise SystemExit(completed.returncode)
