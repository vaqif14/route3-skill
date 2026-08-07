#!/usr/bin/env bash
# Build CONTEXT.md for a slice (conversation-isolated, repo-honest).
# Usage: context-pack.sh --run RUN_ID --slice NNN
set -euo pipefail

RUN_ID=""; SLICE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --run) RUN_ID="$2"; shift 2 ;;
    --slice) SLICE="$2"; shift 2 ;;
    -*) echo "unknown flag: $1" >&2; exit 2 ;;
    *) echo "unexpected: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$RUN_ID" && -n "$SLICE" ]] || { echo "need --run and --slice" >&2; exit 2; }

RUN_DIR=".workflow/route3/runs/$RUN_ID"
STATE="$RUN_DIR/STATE.json"
BRIEF="$RUN_DIR/slices/$SLICE/BRIEF.md"
OUT="$RUN_DIR/CONTEXT.md"
[[ -f "$STATE" ]] || { echo "missing STATE" >&2; exit 1; }
[[ -f "$BRIEF" ]] || { echo "missing BRIEF" >&2; exit 1; }

SHA=$(git rev-parse HEAD 2>/dev/null || echo unknown)
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)

{
  echo "# CONTEXT — run=$RUN_ID slice=$SLICE"
  echo
  echo "generated_at: $TS"
  echo "base_sha: $SHA"
  echo "EXPANSION_REQUEST: (builder may append read-only paths; grant logged in TRACE)"
  echo
  echo "## FACTORY"
  python3 -c 'import json,sys; s=json.load(open(sys.argv[1])); print("class=%s stage=%s" % (s.get("path"), s.get("stage")))' "$STATE"
  echo
  echo "## BRIEF"
  cat "$BRIEF"
  echo
  echo "## PRODUCT (excerpt)"
  if [[ -f "$RUN_DIR/02-PRODUCT.md" ]]; then head -n 80 "$RUN_DIR/02-PRODUCT.md"; else
    PLAN=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("plan_path",""))' "$STATE")
    [[ -f "$PLAN" ]] && grep -A 40 -E '^PRODUCT:|^AC:' "$PLAN" | head -n 60 || echo "(none)"
  fi
  echo
  echo "## ARCHITECTURE (excerpt)"
  if [[ -f "$RUN_DIR/03-ARCHITECTURE.md" ]]; then head -n 100 "$RUN_DIR/03-ARCHITECTURE.md"; else echo "(none)"; fi
  echo
  echo "## REPO RULES (paths — read as needed)"
  for p in AGENTS.md CLAUDE.md DESIGN.md docs/architecture.md MEMORY.md; do
    [[ -f "$p" ]] && echo "- $p"
  done
  echo
  echo "## FILE MANIFEST (from BRIEF allowed_files)"
  # list existing allowed files with hashes
  python3 - "$BRIEF" <<'PY'
import hashlib, os, re, sys
text = open(sys.argv[1], encoding="utf-8").read().splitlines()
files = []
in_af = False
for line in text:
    if re.match(r'^\s*allowed_files\s*:', line):
        in_af = True
        continue
    if in_af:
        m = re.match(r'^\s*-\s*[\"\']?([^\"\']+)[\"\']?\s*$', line)
        if m:
            files.append(m.group(1).strip())
        elif re.match(r'^\S', line) or re.match(r'^\s*[a-z_]+\s*:', line):
            break
for f in files:
    if os.path.isfile(f):
        h = hashlib.sha256(open(f, "rb").read()).hexdigest()[:16]
        print(f"- {f} sha256_16={h}")
    else:
        print(f"- {f} (missing)")
PY
  echo
  echo "## PRIOR VERIFY"
  PREV=$(ls -1 "$RUN_DIR/slices" 2>/dev/null | sort | awk -v s="$SLICE" '$0<s {p=$0} END{print p+0}')
  # list previous VERIFY.md if any
  for d in "$RUN_DIR"/slices/*/VERIFY.md; do
    [[ -f "$d" ]] || continue
    echo "### $d"
    head -n 30 "$d"
  done
} > "$OUT.tmp"
mv "$OUT.tmp" "$OUT"

DIGEST=$(shasum -a 256 "$OUT" | awk '{print $1}')
python3 - "$STATE" "$SLICE" "$DIGEST" <<'PY'
import json, os, sys, datetime
state_path, slice_id, digest = sys.argv[1:4]
s = json.load(open(state_path, encoding="utf-8"))
sl = s.setdefault("slices", {}).setdefault(slice_id, {})
sl["context_digest"] = digest
s["updated_at"] = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
tmp = state_path + ".tmp"
json.dump(s, open(tmp, "w", encoding="utf-8"), indent=2)
open(tmp, "a", encoding="utf-8").write("\n")
os.replace(tmp, state_path)
print(f"CONTEXT OK: {os.path.dirname(state_path)}/CONTEXT.md digest={digest[:16]}…")
PY
