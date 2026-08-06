#!/usr/bin/env bash
# Block BUILD until clarify→execute preflight passes.
# Callers: clarify-then-execute.md; build-pipeline.md; SKILL.md hard rule #0
# Usage: check-preflight.sh [PLAN.md]
# Exit 0 = may BUILD. Exit 1 = must keep clarifying.
set -euo pipefail

PLAN="${1:-}"
if [[ -z "$PLAN" ]]; then
  for c in PLAN.md .workflow/PLAN.md .workflow/route3/PLAN.md; do
    if [[ -f "$c" ]]; then PLAN="$c"; break; fi
  done
fi

if [[ -z "${PLAN}" || ! -f "$PLAN" ]]; then
  echo "PREFLIGHT FAIL: PLAN file not found"
  exit 1
fi

if grep -Eq 'status=SKIPPED_TRIVIAL' "$PLAN"; then
  echo "PREFLIGHT OK: trivial skip ($PLAN)"
  exit 0
fi

fail=()

grep -Eq 'status=ALIGNED' "$PLAN" || fail+=("GRILL: status=ALIGNED")
grep -Eq 'open_branches=none' "$PLAN" || fail+=("open_branches=none")
grep -Eq 'CLARIFY_COVERAGE:' "$PLAN" || fail+=("CLARIFY_COVERAGE: block")
grep -Eq 'GOAL:' "$PLAN" || fail+=("GOAL: restatement")
grep -Eq '^AC:|acceptance criteria' "$PLAN" || fail+=("AC: gate-checkable list")
grep -Eq 'PLAN_APPROVAL: *(approved|continue|yes_to_all)|yes to all|plan_approval' "$PLAN" \
  || fail+=("PLAN_APPROVAL approved|continue|yes_to_all")

for d in D1 D2 D3 D4 D5 D6 D7 D8 D9 D10; do
  grep -Eq "$d " "$PLAN" || fail+=("CLARIFY_COVERAGE missing $d")
done

# Fail if any dimension line still has status token "asked"
if grep -E 'D[0-9]+ .*: *asked( |—|-|$)' "$PLAN" >/dev/null 2>&1; then
  fail+=("dimension still status=asked (resolve before BUILD)")
fi

if [[ ${#fail[@]} -gt 0 ]]; then
  echo "PREFLIGHT FAIL: $PLAN — do NOT BUILD yet"
  for f in "${fail[@]}"; do echo "  - $f"; done
  exit 1
fi

echo "PREFLIGHT OK: $PLAN — BUILD allowed"
if ! grep -Eq '^PREFLIGHT: *PASS' "$PLAN"; then
  printf '\nPREFLIGHT: PASS at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$PLAN"
fi
exit 0
