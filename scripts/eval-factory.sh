#!/usr/bin/env bash
# Factory / self-improve evals (no network). Exit 0 all pass.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCR="$ROOT/scripts"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
cd "$TMP"
mkdir -p .workflow/route3
PASS=0; FAIL=0
ok() { PASS=$((PASS+1)); echo "PASS: $1"; }
bad() { FAIL=$((FAIL+1)); echo "FAIL: $1"; }

# Case: buried yes to all → preflight fail
cat > PLAN_BURIED.md <<'P'
GRILL: status=ALIGNED
open_branches=none
CLARIFY_COVERAGE: D1 ok D2 ok D3 ok D4 ok D5 ok D6 ok D7 ok D8 ok D9 ok D10 ok D11 ok
GOAL: test
AC:
- works
SOLUTION_BAR: saas
AGENT_MAP: route3-api-expert|EXISTS
Would you like me to proceed? yes to all sounds good in the prose.
P
set +e
"$SCR/check-preflight.sh" PLAN_BURIED.md >/dev/null 2>&1
c=$?
set -e
[[ "$c" -eq 1 ]] && ok "buried-yes-to-all" || bad "buried-yes-to-all (exit=$c)"

# Case: factory without --run
set +e
"$SCR/check-plan-done.sh" --factory >/dev/null 2>&1
c=$?
set -e
[[ "$c" -eq 1 ]] && ok "factory-requires-run" || bad "factory-requires-run (exit=$c)"

# Case: high-risk → factory
cat > PLAN_AUTH.md <<'P'
GOAL: add auth and payment refund for tenant rbac
AC:
- login works
P
out=$("$SCR/classify-risk.sh" PLAN_AUTH.md)
echo "$out" | grep -Eq 'FACTORY: class=factory' && ok "high-risk-classify-factory" || bad "high-risk-classify-factory ($out)"

# Case: trivial without TRIVIAL_REASON
cat > PLAN_T.md <<'P'
status=SKIPPED_TRIVIAL
P
set +e
"$SCR/check-preflight.sh" PLAN_T.md >/dev/null 2>&1
c=$?
set -e
[[ "$c" -eq 1 ]] && ok "trivial-without-reason" || bad "trivial-without-reason (exit=$c)"

# Case: product VERDICT: SCRAP blocks architecture without human override
RUN=evalscrap
"$SCR/init-run.sh" --path factory --plan PLAN_AUTH.md --run-id "$RUN" >/dev/null
RD=".workflow/route3/runs/$RUN"
cat > "$RD/02-PRODUCT.md" <<'P'
# Product
problem: duplicate of an existing finance export
scope: none
acceptance: n/a
AC: none
VERDICT: SCRAP
VERDICT_REASON: users already get the same numbers from the finance page in two clicks
P
set +e
out=$("$SCR/check-stage.sh" --run "$RUN" product 2>&1)
c=$?
set -e
if [[ "$c" -eq 1 ]] && printf '%s' "$out" | grep -q 'refuses build'; then
  ok "product-scrap-blocks-architecture"
else
  bad "product-scrap-blocks-architecture (exit=$c) $out"
fi

# Case: same refused artifact + recorded human override → VALIDATED
printf '%s\n' "PRODUCT_OVERRIDE: approved by user at 2026-08-08T09:30:00Z reason=strategic bet" >> "$RD/02-PRODUCT.md"
set +e
out=$("$SCR/check-stage.sh" --run "$RUN" product 2>&1)
c=$?
set -e
if [[ "$c" -eq 0 ]] && printf '%s' "$out" | grep -q 'STAGE OK'; then
  ok "product-override-passes"
else
  bad "product-override-passes (exit=$c) $out"
fi

# Case: overlapping OWNERSHIP globs
cat > PLAN_OWN.md <<'P'
OWNERSHIP:
  wave=1
  route3-api-expert: src/features/orders/**
  route3-ui-expert: src/features/orders/components/**
P
set +e
out=$("$SCR/check-ownership.sh" PLAN_OWN.md 2>&1)
c=$?
set -e
if [[ "$c" -eq 1 ]] && printf '%s' "$out" | grep -q 'OWNERSHIP FAIL'; then
  ok "ownership-overlap-fails"
else
  bad "ownership-overlap-fails (exit=$c) $out"
fi

# Case: VERIFY FAIL requires a bound lesson (no confidence-stop)
RUN2=evalloop
cat > PLAN_LOOP.md <<'P'
GOAL: loop gate fixture
AC:
- verify fail requires a bound lesson
P
"$SCR/init-run.sh" --path factory --plan PLAN_LOOP.md --run-id "$RUN2" >/dev/null
mkdir -p ".workflow/route3/runs/$RUN2/slices/001"
printf 'VERIFY_STATUS: FAIL\n' > ".workflow/route3/runs/$RUN2/slices/001/VERIFY.md"
set +e
out=$("$SCR/check-plan-done.sh" --factory --run "$RUN2" 2>&1)
c=$?
set -e
if [[ "$c" -eq 1 ]] && printf '%s' "$out" | grep -q 'bound lesson'; then
  ok "verify-fail-needs-bound-lesson"
else
  bad "verify-fail-needs-bound-lesson (exit=$c) $out"
fi

echo "EVAL_FACTORY: pass=$PASS fail=$FAIL"
[[ "$FAIL" -eq 0 ]]
