#!/usr/bin/env bash
# Print trigger eval checklist from evals/trigger-evals.json
# Caller: references/evals.md
# Reads: evals/trigger-evals.json → should_trigger[{id,prompt}], should_not_trigger[{id,prompt}]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
JSON="$ROOT/evals/trigger-evals.json"
python3 - "$JSON" <<'PY'
import json, sys
from pathlib import Path
data = json.loads(Path(sys.argv[1]).read_text())
print(f"# Route3 trigger eval — {data['skill']} {data.get('version','')}")
print("# Mark YES if description alone would load route3.\n")
print("## should_trigger (expect YES)")
for q in data["should_trigger"]:
    print(f"- [ ] {q['id']}: {q['prompt']}")
print("\n## should_not_trigger (expect NO)")
for q in data["should_not_trigger"]:
    print(f"- [ ] {q['id']}: {q['prompt']}")
print("\n# Score = correct/total. Target ≥0.9 each set. See references/evals.md")
PY
