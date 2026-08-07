#!/usr/bin/env bash
# Mark a lesson rolled_back in LESSONS.jsonl.
# Usage: lesson-rollback.sh --id ID
set -euo pipefail

ID=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --id) ID="$2"; shift 2 ;;
    -*) echo "unknown flag: $1" >&2; exit 2 ;;
    *) echo "unexpected: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$ID" ]] || { echo "need --id" >&2; exit 2; }

JSONL=".workflow/route3/lessons/LESSONS.jsonl"
[[ -f "$JSONL" ]] || { echo "FAIL: no $JSONL" >&2; exit 1; }

python3 - "$JSONL" "$ID" <<'PY'
import json, os, sys
path, lid = sys.argv[1:3]
lines = open(path, encoding="utf-8").read().splitlines()
found = False
out = []
for line in lines:
    if not line.strip():
        continue
    try:
        o = json.loads(line)
    except Exception:
        out.append(line)
        continue
    if o.get("id") == lid:
        o["status"] = "rolled_back"
        found = True
    out.append(json.dumps(o, ensure_ascii=False))
if not found:
    print("FAIL: lesson not found: %s" % lid, file=sys.stderr)
    sys.exit(1)
tmp = path + ".tmp"
with open(tmp, "w", encoding="utf-8") as f:
    f.write("\n".join(out) + "\n")
os.replace(tmp, path)
print("LESSON_ROLLBACK: id=%s" % lid)
PY
exit 0
