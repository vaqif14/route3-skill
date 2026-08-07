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

echo "EVAL_FACTORY: pass=$PASS fail=$FAIL"
[[ "$FAIL" -eq 0 ]]
