#!/usr/bin/env bash
# List active lessons (last 20).
# Usage: lesson-list.sh
set -euo pipefail

JSONL=".workflow/route3/lessons/LESSONS.jsonl"
if [[ ! -f "$JSONL" ]]; then
  echo "(no lessons)"
  exit 0
fi

python3 - "$JSONL" <<'PY'
import json, sys
path = sys.argv[1]
active = []
for line in open(path, encoding="utf-8"):
    line = line.strip()
    if not line:
        continue
    try:
        o = json.loads(line)
    except Exception:
        continue
    if o.get("status") == "active":
        active.append(o)
active = active[-20:]
if not active:
    print("(no active lessons)")
    sys.exit(0)
for o in active:
    print("%s | %s | %s" % (o.get("id"), o.get("at"), o.get("title")))
PY
exit 0
