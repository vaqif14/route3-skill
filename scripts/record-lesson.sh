#!/usr/bin/env bash
# Persist an evidence-bound self-improve lesson (JSONL + optional markdown).
# Usage:
#   record-lesson.sh --title "..." --reason "..." [--run ID] [--slice N]
#     [--before FILE] [--after FILE] [--evidence FILE] [--allow-unbound]
#     [--tag TAG] [--source SRC]
#
# quality=bound when after_digest or evidence digest exists; else unbound.
# Unbound lessons require --allow-unbound. Fluff titles/reasons are rejected
# unless (--allow-unbound AND --tag smoke).
set -euo pipefail

TITLE=""; REASON=""; RUN_ID=""; SLICE=""; BEFORE=""; AFTER=""; EVIDENCE=""
SOURCE="route3-self-improve"
ALLOW_UNBOUND=0
TAGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --title) TITLE="$2"; shift 2 ;;
    --reason) REASON="$2"; shift 2 ;;
    --run) RUN_ID="$2"; shift 2 ;;
    --slice) SLICE="$2"; shift 2 ;;
    --before) BEFORE="$2"; shift 2 ;;
    --after) AFTER="$2"; shift 2 ;;
    --evidence) EVIDENCE="$2"; shift 2 ;;
    --allow-unbound) ALLOW_UNBOUND=1; shift ;;
    --tag) TAGS+=("$2"); shift 2 ;;
    --source) SOURCE="$2"; shift 2 ;;
    -*) echo "unknown flag: $1" >&2; exit 2 ;;
    *) echo "unexpected: $1" >&2; exit 2 ;;
  esac
done

[[ -n "$TITLE" && -n "$REASON" ]] || { echo "need --title and --reason" >&2; exit 2; }

# Auto-attach VERIFY.md when --run and --slice and file exists
if [[ -z "$EVIDENCE" && -n "$RUN_ID" && -n "$SLICE" ]]; then
  CAND=".workflow/route3/runs/$RUN_ID/slices/$SLICE/VERIFY.md"
  if [[ -f "$CAND" ]]; then
    EVIDENCE="$CAND"
    if [[ -z "$AFTER" ]]; then
      AFTER="$CAND"
    fi
  fi
fi

has_smoke_tag=0
for t in "${TAGS[@]:-}"; do
  [[ "$t" == "smoke" ]] && has_smoke_tag=1
done

FLUFF_RE='^(test|smoke|oops|n/?a|todo|fix later|ok|fine|lgtm|self-score|looks good|i learned|agent learned)$'
is_fluff() {
  local s
  s=$(echo "$1" | tr '[:upper:]' '[:lower:]' | sed -E 's/^[[:space:]]+|[[:space:]]+$//g')
  [[ -z "$s" ]] && return 0
  echo "$s" | grep -Eqi "$FLUFF_RE"
}

if is_fluff "$TITLE" || is_fluff "$REASON"; then
  if [[ "$ALLOW_UNBOUND" -eq 1 && "$has_smoke_tag" -eq 1 ]]; then
    :
  else
    echo "reject: fluff title/reason (use durable lesson text, or --allow-unbound --tag smoke)" >&2
    exit 2
  fi
fi

REASON_LEN=${#REASON}
if [[ "$REASON_LEN" -lt 40 ]]; then
  if [[ "$ALLOW_UNBOUND" -eq 1 && "$has_smoke_tag" -eq 1 ]]; then
    :
  else
    echo "reject: --reason must be >= 40 chars (got $REASON_LEN) unless --allow-unbound --tag smoke" >&2
    exit 2
  fi
fi

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
EVIDENCE_D=$(digest_file "${EVIDENCE:-}")

# Prefer evidence file path for evidence_path; fall back to after
EVIDENCE_PATH=""
if [[ -n "$EVIDENCE" && -f "$EVIDENCE" ]]; then
  EVIDENCE_PATH="$EVIDENCE"
elif [[ -n "$AFTER" && -f "$AFTER" ]]; then
  EVIDENCE_PATH="$AFTER"
fi

QUALITY="unbound"
if [[ -n "$AFTER_D" || -n "$EVIDENCE_D" ]]; then
  QUALITY="bound"
fi

if [[ "$QUALITY" == "unbound" && "$ALLOW_UNBOUND" -ne 1 ]]; then
  echo "reject: unbound lesson (need --after/--evidence digest or --allow-unbound)" >&2
  exit 2
fi

TAG_CSV=$(IFS=,; echo "${TAGS[*]:-}")

python3 - "$JSONL" "$ID" "$TS" "$TITLE" "$REASON" "$RUN_ID" "$SLICE" \
  "$BEFORE_D" "$AFTER_D" "$TAG_CSV" "$BEFORE" "$AFTER" "$ROOT_LESSONS" \
  "$EVIDENCE_PATH" "$QUALITY" <<'PY'
import json, os, sys

(
    jsonl, lid, ts, title, reason, run_id, slice_id, bd, ad, tags,
    before, after, root, evidence_path, quality,
) = sys.argv[1:16]
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
    "evidence_path": evidence_path or None,
    "quality": quality,
    "status": "active",
    "tags": tag_list,
}
tmp = jsonl + ".tmp"
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
    f.write("**quality:** %s\n\n" % quality)
    f.write("**at:** %s\n\n" % ts)
    if run_id:
        f.write("**run_id:** %s\n\n" % run_id)
    if slice_id:
        f.write("**slice:** %s\n\n" % slice_id)
    if evidence_path:
        f.write("**evidence_path:** %s\n\n" % evidence_path)
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

echo "LESSON_RECORDED: id=$ID quality=$QUALITY"

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
    python3 - "$TRACE" "$ID" "$TS" "$TITLE" "$QUALITY" <<'PY'
import json, os, sys
trace, lid, ts, title, quality = sys.argv[1:6]
os.makedirs(os.path.dirname(trace), exist_ok=True)
with open(trace, "a", encoding="utf-8") as f:
    f.write(json.dumps({
        "at": ts,
        "actor": "record-lesson",
        "transition": "LESSON_RECORDED",
        "lesson_id": lid,
        "title": title,
        "quality": quality,
    }) + "\n")
PY
  fi
fi
exit 0
