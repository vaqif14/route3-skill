#!/usr/bin/env bash
# Persist a self-improve lesson (JSONL + optional markdown).
# Usage:
#   record-lesson.sh --title "..." --reason "..." [--run ID] [--slice N]
#     [--before FILE] [--after FILE] [--tag TAG] [--source SRC]
set -euo pipefail

TITLE=""; REASON=""; RUN_ID=""; SLICE=""; BEFORE=""; AFTER=""; SOURCE="route3-self-improve"
TAGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --title) TITLE="$2"; shift 2 ;;
    --reason) REASON="$2"; shift 2 ;;
    --run) RUN_ID="$2"; shift 2 ;;
    --slice) SLICE="$2"; shift 2 ;;
    --before) BEFORE="$2"; shift 2 ;;
    --after) AFTER="$2"; shift 2 ;;
    --tag) TAGS+=("$2"); shift 2 ;;
    --source) SOURCE="$2"; shift 2 ;;
    -*) echo "unknown flag: $1" >&2; exit 2 ;;
    *) echo "unexpected: $1" >&2; exit 2 ;;
  esac
done

[[ -n "$TITLE" && -n "$REASON" ]] || { echo "need --title and --reason" >&2; exit 2; }

ROOT_LESSONS=".workflow/route3/lessons"
mkdir -p "$ROOT_LESSONS"
JSONL="$ROOT_LESSONS/LESSONS.jsonl"

TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
ID="L-$(date -u +%Y%m%dT%H%M%SZ)-$(head -c 3 /dev/urandom | xxd -p)"

digest_file() {
  if [[ -n "${1:-}" && -f "$1" ]]; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    echo ""
  fi
}

BEFORE_D=$(digest_file "${BEFORE:-}")
AFTER_D=$(digest_file "${AFTER:-}")

TAG_CSV=$(IFS=,; echo "${TAGS[*]:-}")

python3 - "$JSONL" "$ID" "$TS" "$TITLE" "$REASON" "$RUN_ID" "$SLICE" "$BEFORE_D" "$AFTER_D" "$TAG_CSV" "$BEFORE" "$AFTER" "$ROOT_LESSONS" <<'PY'
import hashlib, json, os, sys

jsonl, lid, ts, title, reason, run_id, slice_id, bd, ad, tags, before, after, root = sys.argv[1:14]
tag_list = [t for t in tags.split(",") if t]
entry = {
    "id": lid,
    "at": ts,
    "title": title,
    "reason": reason,
    "run_id": run_id or None,
    "slice": slice_id or None,
    "before_digest": bd or None,
    "after_digest": ad or None,
    "status": "active",
    "tags": tag_list,
}
tmp = jsonl + ".tmp"
# append safely: copy existing then add
prev = ""
if os.path.isfile(jsonl):
    prev = open(jsonl, encoding="utf-8").read()
with open(tmp, "w", encoding="utf-8") as f:
    if prev and not prev.endswith("\n"):
        prev += "\n"
    f.write(prev)
    f.write(json.dumps(entry, ensure_ascii=False) + "\n")
os.replace(tmp, jsonl)

md_path = os.path.join(root, lid + ".md")
def body(path):
    if path and os.path.isfile(path):
        return open(path, encoding="utf-8", errors="replace").read()
    return "(none)"

with open(md_path, "w", encoding="utf-8") as f:
    f.write("# Lesson %s\n\n" % lid)
    f.write("**title:** %s\n\n" % title)
    f.write("**reason:** %s\n\n" % reason)
    f.write("**at:** %s\n\n" % ts)
    if run_id:
        f.write("**run_id:** %s\n\n" % run_id)
    if slice_id:
        f.write("**slice:** %s\n\n" % slice_id)
    f.write("## BEFORE\n\n")
    if before and os.path.isfile(before):
        f.write("```\n")
        f.write(body(before)[:8000])
        f.write("\n```\n\n")
    else:
        f.write("digest: %s\n\n" % (bd or "n/a"))
    f.write("## AFTER\n\n")
    if after and os.path.isfile(after):
        f.write("```\n")
        f.write(body(after)[:8000])
        f.write("\n```\n\n")
    else:
        f.write("digest: %s\n\n" % (ad or "n/a"))
print(lid)
PY

echo "LESSON_RECORDED: id=$ID"

# MEMANTO (optional)
if command -v memanto >/dev/null 2>&1; then
  set +e
  memanto remember "Route3 lesson: $TITLE — $REASON" \
    --type learning --confidence 0.9 --provenance observed --source "$SOURCE" >/dev/null 2>&1
  set -e
fi

# TRACE append if run provided
if [[ -n "$RUN_ID" ]]; then
  TRACE=".workflow/route3/runs/$RUN_ID/TRACE.jsonl"
  if [[ -d ".workflow/route3/runs/$RUN_ID" ]]; then
    python3 - "$TRACE" "$ID" "$TS" "$TITLE" <<'PY'
import json, os, sys
trace, lid, ts, title = sys.argv[1:5]
os.makedirs(os.path.dirname(trace), exist_ok=True)
with open(trace, "a", encoding="utf-8") as f:
    f.write(json.dumps({"at": ts, "actor": "record-lesson", "transition": "LESSON_RECORDED", "lesson_id": lid, "title": title}) + "\n")
PY
  fi
fi
exit 0
