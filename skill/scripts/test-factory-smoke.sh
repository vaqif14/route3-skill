#!/usr/bin/env bash
# Adversarial smoke for factory scripts (no network). Exit 0 = ok.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCR="$ROOT/scripts"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
cd "$TMP"
mkdir -p .workflow/route3

# 1) unknown arg rejected
set +e
"$SCR/route-slice.sh" --bogus >/dev/null 2>&1
code=$?
set -e
[[ "$code" -eq 2 ]] || { echo "FAIL: route-slice should exit 2 on unknown flag"; exit 1; }

# 2) preflight anchored approval + no plan mutation by default
cat > PLAN.md <<'P'
GRILL: status=ALIGNED
open_branches=none
CLARIFY_COVERAGE: D1 ok D2 ok D3 ok D4 ok D5 ok D6 ok D7 ok D8 ok D9 ok D10 ok
GOAL: test
AC:
- works
PLAN_APPROVAL: approved
P
cp PLAN.md PLAN.bak
"$SCR/check-preflight.sh" PLAN.md
# sidecar must exist
grep -q 'PREFLIGHT: PASS' .workflow/route3/PREFLIGHT_LAST.txt
# default must NOT require that buried "yes to all" in a question counts — already anchored
# plan should be unchanged without --write-plan
cmp -s PLAN.md PLAN.bak || { echo "FAIL: preflight mutated PLAN without --write-plan"; exit 1; }

# 3) trivial escape guarded
cat > PLAN_T.md <<'P'
status=SKIPPED_TRIVIAL
P
set +e
"$SCR/check-preflight.sh" PLAN_T.md >/dev/null 2>&1
code=$?
set -e
[[ "$code" -eq 1 ]] || { echo "FAIL: trivial without TRIVIAL_REASON should fail"; exit 1; }

# 4) init-run + stage + context
"$SCR/init-run.sh" --path factory --plan PLAN.md > init.out
RUN_ID=$(grep '^RUN_ID=' init.out | cut -d= -f2)
RUN_DIR=".workflow/route3/runs/$RUN_ID"
mkdir -p "$RUN_DIR/slices/001"
cat > "$RUN_DIR/02-PRODUCT.md" <<'P'
# Product
problem: demo
scope: demo
acceptance: works
AC: pass
P
cat > "$RUN_DIR/03-ARCHITECTURE.md" <<'P'
# Architecture
modules: demo
contracts: GET /demo
data: none
failure modes: timeout
security: none
P
printf '\n%s\n' "PLAN_APPROVAL: approved" >> "$RUN_DIR/05-PLAN.md"
echo "slices: 001 BRIEF" >> "$RUN_DIR/05-PLAN.md"
"$SCR/check-stage.sh" --run "$RUN_ID" product
"$SCR/check-stage.sh" --run "$RUN_ID" architecture
"$SCR/check-stage.sh" --run "$RUN_ID" plan
cat > "$RUN_DIR/slices/001/BRIEF.md" <<'P'
slice: "001"
goal: smoke
allowed_files:
  - PLAN.md
must_not_change:
  - secrets/**
acceptance:
  - id: AC1
    text: smoke
verify:
  - "python3 -c 'print(1)'"
P
"$SCR/check-stage.sh" --run "$RUN_ID" slice --slice 001
"$SCR/context-pack.sh" --run "$RUN_ID" --slice 001
[[ -f "$RUN_DIR/CONTEXT.md" ]]
"$SCR/verify-slice.sh" --run "$RUN_ID" --slice 001
grep -q 'VERIFY_STATUS: PASS' "$RUN_DIR/slices/001/VERIFY.md"

# 5) concurrent run dirs don't collide
"$SCR/init-run.sh" --path factory --plan PLAN.md --run-id runA >/dev/null
"$SCR/init-run.sh" --path factory --plan PLAN.md --run-id runB >/dev/null
[[ -f .workflow/route3/runs/runA/STATE.json && -f .workflow/route3/runs/runB/STATE.json ]]

echo "SMOKE OK"
