#!/usr/bin/env bash
# Enforce Route3 PLAN done tokens before reporting "done" to the user.
# Callers: slim-v3-contract.md Done means; evals.md; build-pipeline.md after ship.
#
# Usage:
#   check-plan-done.sh [PLAN.md]              # full (non-trivial) slice
#   check-plan-done.sh --trivial [PLAN.md]    # typo/rename path
#   check-plan-done.sh --domain [PLAN.md]     # domain-team run
#
# Exit 0 = ok to report done. Exit 1 = NOT DONE.
set -euo pipefail

MODE=full
PLAN=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --trivial) MODE=trivial; shift ;;
    --domain) MODE=domain; shift ;;
    --full) MODE=full; shift ;;
    -*) echo "unknown flag: $1" >&2; exit 2 ;;
    *) PLAN="$1"; shift ;;
  esac
done

if [[ -z "$PLAN" ]]; then
  for c in PLAN.md .workflow/PLAN.md .workflow/route3/PLAN.md; do
    if [[ -f "$c" ]]; then PLAN="$c"; break; fi
  done
fi

if [[ -z "$PLAN" || ! -f "$PLAN" ]]; then
  echo "NOT DONE: PLAN file not found (pass path or create PLAN.md)"
  exit 1
fi

missing=()
warn=()
has() { grep -Eq "$1" "$PLAN"; }

case "$MODE" in
  trivial)
    has 'SLICE_EVAL:' || missing+=("SLICE_EVAL:")
    ;;
  domain)
    has 'EVIDENCE:' || missing+=("EVIDENCE: (VALIDATED|HYPOTHESIS|UNKNOWN one-liner)")
    has 'CLARIFY_COVERAGE:|GRILL:.*(ALIGNED|SKIPPED)|status=ALIGNED|plan_approval|yes to all|continue' \
      || missing+=("CLARIFY_COVERAGE or GRILL ALIGNED / approval marker")
    ;;
  full)
    has 'SLICE_EVAL:' || missing+=("SLICE_EVAL:")
    has 'GRILL:.*ALIGNED|status=ALIGNED' || missing+=("GRILL: status=ALIGNED")
    has 'CLARIFY_COVERAGE:' || missing+=("CLARIFY_COVERAGE:")
    has 'PREFLIGHT:\s*PASS' || missing+=("PREFLIGHT: PASS (run check-preflight.sh)")
    has 'ROUTE_DECISION:.*primary=(codex|kimi|native)' || missing+=("ROUTE_DECISION: primary=codex|kimi|native")
    has 'BUILD_PROOF:' || missing+=("BUILD_PROOF: (boss re-ran tsc/test/lint — paste summary)")
    has 'PONYTAIL:' || warn+=("PONYTAIL:")
    has 'PRODUCT:' || warn+=("PRODUCT:")
    ;;
esac

if [[ ${#missing[@]} -gt 0 ]]; then
  echo "NOT DONE: $PLAN missing required tokens for mode=$MODE"
  for m in "${missing[@]}"; do echo "  - $m"; done
  exit 1
fi

echo "OK: mode=$MODE plan=$PLAN"
if [[ "$MODE" == full && ${#warn[@]} -gt 0 ]]; then
  echo "WARN: recommended missing: ${warn[*]}"
fi
exit 0
