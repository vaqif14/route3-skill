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
grep -q 'PREFLIGHT: PASS' .workflow/route3/PREFLIGHT_LAST.txt
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

# 4) classify-risk: auth → factory
cat > PLAN_AUTH.md <<'P'
GOAL: implement auth login
AC:
- 2fa optional later
P
out=$("$SCR/classify-risk.sh" PLAN_AUTH.md)
echo "$out" | grep -Eq 'FACTORY: class=factory' || { echo "FAIL: auth plan should be factory: $out"; exit 1; }

# 5) classify-risk: default → standard
cat > PLAN_STD.md <<'P'
GOAL: rename a helper
AC:
- builds
P
out=$("$SCR/classify-risk.sh" PLAN_STD.md)
echo "$out" | grep -Eq 'FACTORY: class=standard' || { echo "FAIL: default should be standard: $out"; exit 1; }

# 6) classify --write + preflight --classify
"$SCR/check-preflight.sh" PLAN.md --classify
grep -Eq '^FACTORY: class=' PLAN.md || { echo "FAIL: --classify should write FACTORY line"; exit 1; }

# 7) init-run + stage + context + verify
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
grep -q 'ACTIVE LESSONS' "$RUN_DIR/CONTEXT.md" || { echo "FAIL: context missing ACTIVE LESSONS"; exit 1; }
"$SCR/verify-slice.sh" --run "$RUN_ID" --slice 001
grep -q 'VERIFY_STATUS: PASS' "$RUN_DIR/slices/001/VERIFY.md"

# 8) record-lesson + lesson-rollback
out=$("$SCR/record-lesson.sh" --title "smoke lesson" --reason "test" --run "$RUN_ID" --slice 001 --tag smoke)
echo "$out" | grep -Eq 'LESSON_RECORDED: id=' || { echo "FAIL: record-lesson: $out"; exit 1; }
LID=$(echo "$out" | sed -n 's/^LESSON_RECORDED: id=//p')
[[ -f .workflow/route3/lessons/LESSONS.jsonl ]]
"$SCR/lesson-list.sh" | grep -q "$LID" || { echo "FAIL: lesson-list missing $LID"; exit 1; }
"$SCR/context-pack.sh" --run "$RUN_ID" --slice 001
grep -q "$LID" "$RUN_DIR/CONTEXT.md" || { echo "FAIL: lesson not injected in context"; exit 1; }
"$SCR/lesson-rollback.sh" --id "$LID" | grep -Eq 'LESSON_ROLLBACK'
"$SCR/lesson-list.sh" | grep -q "$LID" && { echo "FAIL: rolled_back lesson still listed active"; exit 1; } || true

# 9) invalidate-stale detects edit
# ensure digests set from check-stage; then edit product
echo "tamper" >> "$RUN_DIR/02-PRODUCT.md"
set +e
"$SCR/invalidate-stale.sh" --run "$RUN_ID"
inv=$?
set -e
[[ "$inv" -eq 1 ]] || { echo "FAIL: invalidate-stale should exit 1 after edit"; exit 1; }
python3 -c 'import json,sys; s=json.load(open(sys.argv[1])); assert s["artifacts"]["product"]["status"]=="STALE"' "$RUN_DIR/STATE.json"

# 10) concurrent run dirs don't collide
"$SCR/init-run.sh" --path factory --plan PLAN.md --run-id runA >/dev/null
"$SCR/init-run.sh" --path factory --plan PLAN.md --run-id runB --overnight-item item99 >/dev/null
[[ -f .workflow/route3/runs/runA/STATE.json && -f .workflow/route3/runs/runB/STATE.json ]]
python3 -c 'import json; s=json.load(open(".workflow/route3/runs/runB/STATE.json")); assert s.get("overnight_item_id")=="item99"'
[[ -f .workflow/night-shift/links/item99 ]] || grep -q factory_run_id .workflow/night-shift/QUEUE.json 2>/dev/null || true

# 11) eval-factory
"$SCR/eval-factory.sh"

echo "SMOKE OK"
