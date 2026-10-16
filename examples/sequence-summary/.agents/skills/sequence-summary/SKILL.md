---
name: sequence-summary
description: Summarize FASTA record IDs and sequence lengths using Python.
---

1. Inspect the requested input FASTA; use `data/sequences.fasta` by default.
2. Run `python3 scripts/summarize.py INPUT OUTPUT` through Bash, substituting the
   actual input and the task's output directory followed by `/summary.json`.
   Quote paths that contain spaces. Do not calculate lengths in the response.
3. Read the resulting JSON. Report its path and the number of records.
   The host runs the independent checker after this task.
