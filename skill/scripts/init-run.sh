#!/usr/bin/env bash
# Create a factory run directory + STATE.json.
# Usage: init-run.sh --path factory|standard [--plan PLAN.md] [--run-id ID] [--overnight-item ID]
# Exit 0 prints: RUN_ID=… RUN_DIR=…
set -euo pipefail

PATH_CLASS="factory"
PLAN=""
RUN_ID=""
OVERNIGHT_ITEM=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --path)
      PATH_CLASS="$2"; shift 2 ;;
    --plan)
      PLAN="$2"; shift 2 ;;
    --run-id)
      RUN_ID="$2"; shift 2 ;;
    --overnight-item)
      OVERNIGHT_ITEM="$2"; shift 2 ;;
    -*)
      echo "unknown flag: $1" >&2; exit 2 ;;
    *)
      echo "unexpected arg: $1" >&2; exit 2 ;;
  esac
done

case "$PATH_CLASS" in
  trivial|standard|factory) ;;
  *) echo "invalid --path (trivial|standard|factory)" >&2; exit 2 ;;
esac

if [[ -z "$PLAN" ]]; then
  for c in .workflow/route3/PLAN.md .workflow/PLAN.md PLAN.md; do
    [[ -f "$c" ]] && PLAN="$c" && break
  done
fi

if [[ -z "$RUN_ID" ]]; then
  RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$(head -c 4 /dev/urandom | xxd -p)"
fi

RUN_DIR=".workflow/route3/runs/$RUN_ID"
if [[ -e "$RUN_DIR" ]]; then
  echo "init-run FAIL: refuse reuse of $RUN_DIR" >&2
  exit 1
fi

BASE_SHA=$(git rev-parse HEAD 2>/dev/null || echo null)
REPO_ROOT=$(pwd)
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)

mkdir -p "$RUN_DIR/slices"
: > "$RUN_DIR/TRACE.jsonl"
[[ -n "$PLAN" && -f "$PLAN" ]] && cp "$PLAN" "$RUN_DIR/05-PLAN.md" || true

python3 - "$RUN_DIR" "$RUN_ID" "$PATH_CLASS" "$REPO_ROOT" "$BASE_SHA" "$TS" "${PLAN:-}" "${OVERNIGHT_ITEM:-}" <<'PY'
import json, sys, os
run_dir, run_id, path, repo, sha, ts, plan, overnight = sys.argv[1:9]
state = {
  "schema_version": 1,
  "run_id": run_id,
  "repo_root": repo,
  "base_sha": None if sha == "null" else sha,
  "path": path,
  "stage": "init",
  "plan_path": plan or f"{run_dir}/05-PLAN.md",
  "created_at": ts,
  "updated_at": ts,
  "research_skipped": True,
  "artifacts": {
    "research": {"path": "01-RESEARCH.md", "digest": None, "status": "missing"},
    "product": {"path": "02-PRODUCT.md", "digest": None, "status": "missing"},
    "architecture": {"path": "03-ARCHITECTURE.md", "digest": None, "status": "missing"},
    "plan": {"path": "05-PLAN.md", "digest": None, "status": "draft" if plan else "missing"},
  },
  "human_approvals": {},
  "slices": {},
  "security_triggers": [],
}
if overnight:
  state["overnight_item_id"] = overnight
tmp = run_dir + "/STATE.json.tmp"
with open(tmp, "w", encoding="utf-8") as f:
  json.dump(state, f, indent=2)
  f.write("\n")
os.replace(tmp, run_dir + "/STATE.json")
with open(run_dir + "/TRACE.jsonl", "a", encoding="utf-8") as f:
  f.write(json.dumps({"at": ts, "actor": "init-run", "transition": "->init", "run_id": run_id, "overnight_item_id": overnight or None}) + "\n")
PY

# Pointer for "current" run (never auto-picked by validators without --run)
printf '%s\n' "$RUN_ID" > .workflow/route3/CURRENT_RUN.txt

# Optional overnight link
if [[ -n "$OVERNIGHT_ITEM" ]]; then
  ROOT="$(cd "$(dirname "$0")" && pwd)"
  if [[ -x "$ROOT/link-overnight.sh" ]]; then
    "$ROOT/link-overnight.sh" --run "$RUN_ID" --item "$OVERNIGHT_ITEM" || true
  fi
fi

echo "RUN_ID=$RUN_ID"
echo "RUN_DIR=$RUN_DIR"
echo "PATH_CLASS=$PATH_CLASS"
echo "STATE=$RUN_DIR/STATE.json"
if [[ -n "$OVERNIGHT_ITEM" ]]; then
  echo "OVERNIGHT_ITEM=$OVERNIGHT_ITEM"
fi
exit 0
