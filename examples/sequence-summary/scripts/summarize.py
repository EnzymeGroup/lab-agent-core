"""Summarize a valid FASTA file using only the Python standard library."""

import json
import sys
from pathlib import Path

source, destination = map(Path, sys.argv[1:])
sequences = []
for line in source.read_text().splitlines():
    if line.startswith(">"):
        sequences.append({"id": line[1:].split()[0], "length": 0})
    elif line.strip():
        sequences[-1]["length"] += len(line.strip())

report = {"source": source.as_posix(), "sequence_count": len(sequences), "sequences": sequences}
destination.parent.mkdir(parents=True, exist_ok=True)
destination.write_text(json.dumps(report, indent=2) + "\n")
print(f"Summarized {len(sequences)} sequences in {destination}")
