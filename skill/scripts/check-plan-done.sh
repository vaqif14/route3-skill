#!/usr/bin/env bash
# Enforce Route3 PLAN done tokens before reporting "done".
# Usage:
#   check-plan-done.sh [PLAN.md]
#   check-plan-done.sh --trivial|--domain|--full [PLAN.md]
#   check-plan-done.sh --factory --run RUN_ID [PLAN.md]
set -euo pipefail

MODE=full
PLAN=""
RUN_ID=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --trivial) MODE=trivial; shift ;;
    --domain) MODE=domain; shift ;;
    --full) MODE=full; shift ;;
    --factory) MODE=factory; shift ;;
    --run) RUN_ID="$2"; shift 2 ;;
    -*)
      echo "unknown flag: $1" >&2; exit 2 ;;
    *)
      PLAN="$1"; shift ;;
  esac
done

if [[ "$MODE" == factory && -z "$RUN_ID" ]]; then
  echo "NOT DONE: --factory requires --run RUN_ID" >&2
  exit 1
fi

if [[ -z "$PLAN" ]]; then
  if [[ -n "$RUN_ID" && -f ".workflow/route3/runs/$RUN_ID/05-PLAN.md" ]]; then
    PLAN=".workflow/route3/runs/$RUN_ID/05-PLAN.md"
  else
    for c in PLAN.md .workflow/PLAN.md .workflow/route3/PLAN.md; do
      if [[ -f "$c" ]]; then PLAN="$c"; break; fi
    done
  fi
fi

if [[ -z "$PLAN" || ! -f "$PLAN" ]]; then
  echo "NOT DONE: PLAN file not found"
  exit 1
fi

missing=()
warn=()
has() { grep -Eq "$1" "$PLAN"; }
has_preflight() {
  has 'PREFLIGHT:\s*PASS' && return 0
  [[ -f .workflow/route3/PREFLIGHT_LAST.txt ]] && grep -Eq 'PREFLIGHT: PASS' .workflow/route3/PREFLIGHT_LAST.txt
}

case "$MODE" in
  trivial)
    has 'SLICE_EVAL:' || missing+=("SLICE_EVAL:")
    ;;
  domain)
    has 'EVIDENCE:' || missing+=("EVIDENCE: (VALIDATED|HYPOTHESIS|UNKNOWN one-liner)")
    has 'CLARIFY_COVERAGE:|GRILL:.*(ALIGNED|SKIPPED)|status=ALIGNED|^PLAN_APPROVAL:' \
      || missing+=("CLARIFY_COVERAGE or GRILL ALIGNED / PLAN_APPROVAL")
    ;;
  full)
    has 'SLICE_EVAL:' || missing+=("SLICE_EVAL:")
    has 'GRILL:.*ALIGNED|status=ALIGNED' || missing+=("GRILL: status=ALIGNED")
    has 'CLARIFY_COVERAGE:' || missing+=("CLARIFY_COVERAGE:")
    has_preflight || missing+=("PREFLIGHT: PASS (run check-preflight.sh)")
    has 'ROUTE_DECISION:.*primary=(codex|kimi|native)' || missing+=("ROUTE_DECISION: primary=codex|kimi|native")
    has '^BUILDER_DISPATCH:' || missing+=("BUILDER_DISPATCH:")
    has 'BUILD_PROOF:' || missing+=("BUILD_PROOF:")
    has 'PONYTAIL:' || warn+=("PONYTAIL:")
    has 'PRODUCT:' || warn+=("PRODUCT:")
    ;;
  factory)
    STATE=".workflow/route3/runs/$RUN_ID/STATE.json"
    [[ -f "$STATE" ]] || missing+=("STATE.json for run $RUN_ID")
    has 'SLICE_EVAL:' || missing+=("SLICE_EVAL:")
    has '^BUILDER_DISPATCH:' || missing+=("BUILDER_DISPATCH:")
    has 'BUILD_PROOF:' || missing+=("BUILD_PROOF:")
    has '^PLAN_APPROVAL: *(approved|continue|yes_to_all)\b' || missing+=("PLAN_APPROVAL human line")
    # all slices verified
    if [[ -f "$STATE" ]]; then
      python3 - "$STATE" <<'PY' || missing+=("factory slices not all verified/accepted")
import json, sys
s = json.load(open(sys.argv[1], encoding="utf-8"))
slices = s.get("slices") or {}
if not slices:
    sys.exit(1)
bad = [k for k,v in slices.items() if v.get("state") not in ("verified","reviewed","accepted")]
sys.exit(1 if bad else 0)
PY
      # no STALE artifacts
      python3 - "$STATE" <<'PY' || missing+=("STALE artifacts in STATE")
import json, sys
s = json.load(open(sys.argv[1], encoding="utf-8"))
arts = s.get("artifacts") or {}
stale = [k for k,v in arts.items() if v.get("status") == "STALE"]
sys.exit(1 if stale else 0)
PY
    fi
    ;;
esac

if [[ ${#missing[@]} -gt 0 ]]; then
  echo "NOT DONE: $PLAN missing required tokens for mode=$MODE"
  for m in "${missing[@]}"; do echo "  - $m"; done
  exit 1
fi

if [[ "$MODE" == full || "$MODE" == factory ]]; then
  ROOT="$(cd "$(dirname "$0")" && pwd)"
  ASSERT_ARGS=("$PLAN" --require-dispatch)
  [[ -n "$RUN_ID" ]] && ASSERT_ARGS+=(--run "$RUN_ID")
  if [[ -x "$ROOT/assert-build-route.sh" ]]; then
    if ! "$ROOT/assert-build-route.sh" "${ASSERT_ARGS[@]}"; then
      echo "NOT DONE: assert-build-route.sh --require-dispatch failed"
      exit 1
    fi
  fi
fi

echo "OK: mode=$MODE plan=$PLAN${RUN_ID:+ run=$RUN_ID}"
if [[ "$MODE" == full && ${#warn[@]} -gt 0 ]]; then
  echo "WARN: recommended missing: ${warn[*]}"
fi
exit 0
