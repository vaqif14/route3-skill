#!/usr/bin/env bash
# Block BUILD until clarify→execute preflight passes.
# Usage: check-preflight.sh [PLAN.md] [--write-plan]
#   Default: writes PASS to .workflow/route3/PREFLIGHT_LAST.txt (does NOT mutate PLAN)
#   --write-plan: also append PREFLIGHT PASS into PLAN (legacy compat)
# Exit 0 = may BUILD. Exit 1 = keep clarifying. Exit 2 = bad args.
set -euo pipefail

PLAN=""
WRITE_PLAN=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --write-plan) WRITE_PLAN=1; shift ;;
    -*)
      echo "unknown flag: $1" >&2
      exit 2 ;;
    *)
      PLAN="$1"; shift ;;
  esac
done

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
  if ! grep -Eq '^TRIVIAL_REASON:' "$PLAN"; then
    echo "PREFLIGHT FAIL: SKIPPED_TRIVIAL requires TRIVIAL_REASON: line"
    exit 1
  fi
  if grep -Eiq 'schema|migration|prisma|/auth|2fa|payment|pii|refund|rbac' "$PLAN"; then
    echo "PREFLIGHT FAIL: SKIPPED_TRIVIAL forbidden for schema/auth/pay/PII plans"
    exit 1
  fi
  echo "PREFLIGHT OK: trivial skip ($PLAN)"
  exit 0
fi

fail=()
grep -Eq 'status=ALIGNED' "$PLAN" || fail+=("GRILL: status=ALIGNED")
grep -Eq 'open_branches=none' "$PLAN" || fail+=("open_branches=none")
grep -Eq 'CLARIFY_COVERAGE:' "$PLAN" || fail+=("CLARIFY_COVERAGE: block")
grep -Eq 'GOAL:' "$PLAN" || fail+=("GOAL: restatement")
grep -Eq '^AC:|acceptance criteria' "$PLAN" || fail+=("AC: gate-checkable list")
grep -Eq '^PLAN_APPROVAL: *(approved|continue|yes_to_all)\b' "$PLAN" \
  || fail+=("PLAN_APPROVAL: approved|continue|yes_to_all (anchored line)")

for d in D1 D2 D3 D4 D5 D6 D7 D8 D9 D10; do
  grep -Eq "$d " "$PLAN" || fail+=("CLARIFY_COVERAGE missing $d")
done

if grep -E 'D[0-9]+ .*: *asked( |—|-|$)' "$PLAN" >/dev/null 2>&1; then
  fail+=("dimension still status=asked (resolve before BUILD)")
fi

if [[ ${#fail[@]} -gt 0 ]]; then
  echo "PREFLIGHT FAIL: $PLAN — do NOT BUILD yet"
  for f in "${fail[@]}"; do echo "  - $f"; done
  exit 1
fi

ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
mkdir -p .workflow/route3
printf 'PREFLIGHT: PASS at=%s plan=%s\n' "$ts" "$PLAN" > .workflow/route3/PREFLIGHT_LAST.txt
echo "PREFLIGHT OK: $PLAN — BUILD allowed (marker: .workflow/route3/PREFLIGHT_LAST.txt)"

if [[ "$WRITE_PLAN" -eq 1 ]] && ! grep -Eq '^PREFLIGHT: *PASS' "$PLAN"; then
  printf '\nPREFLIGHT: PASS at=%s\n' "$ts" >> "$PLAN"
fi
exit 0
