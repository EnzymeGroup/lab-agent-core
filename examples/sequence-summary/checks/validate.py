"""Independently check the report against this example's input FASTA."""

import json
import os
from pathlib import Path

source = Path("data/sequences.fasta")
expected = []
for record in source.read_text().split(">"):
    if record.strip():
        header, *lines = record.splitlines()
        expected.append({"id": header.split()[0], "length": len("".join(lines).strip())})

try:
    actual = json.loads((Path(os.environ["AGENT_OUTPUT_DIR"]) / "summary.json").read_text())
    passed = actual == {"source": source.as_posix(), "sequence_count": len(expected), "sequences": expected}
    issue = "summary.json does not match the source IDs, count and lengths"
except (OSError, ValueError) as error:
    passed, issue = False, str(error)

status = "passed" if passed else "failed"
Path(os.environ["AGENT_CHECK_FILE"]).write_text(json.dumps({
    "status": status,
    "checks": [{"name": "source_ids_and_lengths", "status": status}],
    "issues": [] if passed else [issue],
}, indent=2) + "\n")
