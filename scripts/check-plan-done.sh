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
ROOT="$(cd "$(dirname "$0")" && pwd)"
has() { grep -Eq "$1" "$PLAN"; }
has_preflight() {
  has 'PREFLIGHT:\s*PASS' && return 0
  [[ -f .workflow/route3/PREFLIGHT_LAST.txt ]] && grep -Eq 'PREFLIGHT: PASS' .workflow/route3/PREFLIGHT_LAST.txt
}

# Self-improve: VERIFY FAIL without evidence-bound LESSON_RECORDED
# exit codes from helper: 0 ok, 2 factory missing, 3 full warn
check_lesson_for_verify_fail() {
  local rc
  set +e
  python3 -c '
import json, glob, os, sys, re
plan, run_id, mode = sys.argv[1:4]
need = False
text = open(plan, encoding="utf-8").read() if os.path.isfile(plan) else ""
if re.search(r"VERIFY_STATUS:\s*FAIL", text):
    need = True
if run_id:
    for path in glob.glob(".workflow/route3/runs/%s/slices/*/VERIFY.md" % run_id):
        if re.search(r"VERIFY_STATUS:\s*FAIL", open(path, encoding="utf-8").read()):
            need = True
if not need:
    sys.exit(0)

def is_bound_lesson(o):
    if o.get("status") == "rolled_back":
        return False
    # missing quality treated as unbound
    return o.get("quality") == "bound"

def has_bound_lesson():
    """Factory: JSONL evidence-bound only. PLAN LESSON_RECORDED alone is NOT enough."""
    if not run_id:
        return False
    jl = ".workflow/route3/lessons/LESSONS.jsonl"
    if not os.path.isfile(jl):
        return False
    for line in open(jl, encoding="utf-8"):
        line = line.strip()
        if not line:
            continue
        try:
            o = json.loads(line)
        except Exception:
            continue
        if o.get("run_id") == run_id and is_bound_lesson(o):
            return True
    return False

def has_any_lesson_signal():
    """Full mode: warn if no lesson signal at all (bound preferred)."""
    if has_bound_lesson():
        return True
    if re.search(r"LESSON_RECORDED", text):
        return True
    if run_id:
        tr = ".workflow/route3/runs/%s/TRACE.jsonl" % run_id
        if os.path.isfile(tr) and "LESSON_RECORDED" in open(tr, encoding="utf-8").read():
            return True
        jl = ".workflow/route3/lessons/LESSONS.jsonl"
        if os.path.isfile(jl):
            for line in open(jl, encoding="utf-8"):
                line = line.strip()
                if not line:
                    continue
                try:
                    o = json.loads(line)
                except Exception:
                    continue
                if o.get("run_id") == run_id and o.get("status") != "rolled_back":
                    return True
    return False

if mode == "factory":
    if has_bound_lesson():
        sys.exit(0)
    sys.exit(2)

# full / other: warn if no bound lesson (also warn when any signal missing)
if has_bound_lesson():
    sys.exit(0)
if has_any_lesson_signal():
    # lesson exists but unbound / PLAN-only — still warn for missing bound evidence
    sys.exit(3)
sys.exit(3)
' "$PLAN" "${RUN_ID:-}" "$MODE"
  rc=$?
  set -e
  if [[ "$rc" -eq 2 ]]; then
    missing+=("bound lesson (evidence-bound LESSON_RECORDED) after VERIFY FAIL — factory ignores unbound / PLAN-only")
  elif [[ "$rc" -eq 3 ]]; then
    warn+=("VERIFY FAIL without bound lesson (evidence-bound self-improve)")
  fi
}

check_factory_blocked_lessons() {
  [[ -n "$RUN_ID" ]] || return 0
  STATE=".workflow/route3/runs/$RUN_ID/STATE.json"
  [[ -f "$STATE" ]] || return 0
  local rc
  set +e
  python3 -c '
import json, os, sys
state_path, rid = sys.argv[1:3]
s = json.load(open(state_path, encoding="utf-8"))
blocked = [k for k,v in (s.get("slices") or {}).items() if v.get("state") == "blocked"]
if not blocked:
    sys.exit(0)

def is_bound_lesson(o):
    if o.get("status") == "rolled_back":
        return False
    return o.get("quality") == "bound"

jl = ".workflow/route3/lessons/LESSONS.jsonl"
if os.path.isfile(jl):
    for line in open(jl, encoding="utf-8"):
        line = line.strip()
        if not line:
            continue
        try:
            o = json.loads(line)
        except Exception:
            continue
        if o.get("run_id") == rid and is_bound_lesson(o):
            sys.exit(0)
# TRACE / PLAN LESSON_RECORDED alone is insufficient in factory mode
sys.exit(1)
' "$STATE" "$RUN_ID"
  rc=$?
  set -e
  if [[ "$rc" -ne 0 ]]; then
    missing+=("bound lesson (evidence-bound) required when slice blocked — unbound / PLAN-only ignored")
  fi
}


# AGENT_MAP + SOLUTION_BAR + no-MVP deliverable wording (non-trivial)
check_agent_map_solution_bar() {
  # Accept block "AGENT_MAP:" or compact line
  if ! has '^AGENT_MAP:|[[:space:]]AGENT_MAP:'; then
    missing+=("AGENT_MAP: (block or line — see dispatch-prompt-contract.md)")
  fi
  if ! has 'SOLUTION_BAR:[[:space:]]*[Ss][Aa][Aa][Ss]\b'; then
    missing+=("SOLUTION_BAR: saas")
  fi
  # MVP as intended deliverable → factory fail / full warn (negated lines OK)
  local mvp_rc
  set +e
  python3 -c '
import re, sys
text = open(sys.argv[1], encoding="utf-8").read()
neg = re.compile(r"(?i)(no[- ]?mvp|mvp\s+forbidden|anti[- ]?mvp|not\s+an?\s+mvp|mvp\s+concept\s+does\s+not|forbid(?:den)?\s+mvp)")
bad = []
for i, line in enumerate(text.splitlines(), 1):
    if not re.search(r"(?i)\bMVP\b", line):
        continue
    if neg.search(line):
        continue
    # SOLUTION_BAR / anti-pattern docs in PLAN that say "NO MVP" already skipped
    bad.append((i, line.strip()[:120]))
if bad:
    for i, l in bad:
        print(f"L{i}: {l}")
    sys.exit(1)
sys.exit(0)
' "$PLAN"
  mvp_rc=$?
  set -e
  if [[ "$mvp_rc" -ne 0 ]]; then
    if [[ "$MODE" == factory ]]; then
      missing+=("PLAN contains MVP deliverable wording (SaaS/no-MVP bar — factory)")
    else
      warn+=("PLAN contains MVP deliverable wording (prefer SaaS/no-MVP)")
    fi
  fi
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
    check_agent_map_solution_bar
    check_lesson_for_verify_fail
    ;;
  factory)
    STATE=".workflow/route3/runs/$RUN_ID/STATE.json"
    [[ -f "$STATE" ]] || missing+=("STATE.json for run $RUN_ID")
    has 'SLICE_EVAL:' || missing+=("SLICE_EVAL:")
    has '^BUILDER_DISPATCH:' || missing+=("BUILDER_DISPATCH:")
    has 'BUILD_PROOF:' || missing+=("BUILD_PROOF:")
    has '^PLAN_APPROVAL: *(approved|continue|yes_to_all)\b' || missing+=("PLAN_APPROVAL human line")
    check_agent_map_solution_bar
    if [[ -f "$STATE" ]]; then
      python3 -c '
import json, sys
s = json.load(open(sys.argv[1], encoding="utf-8"))
slices = s.get("slices") or {}
if not slices:
    sys.exit(1)
bad = [k for k,v in slices.items() if v.get("state") not in ("verified","reviewed","accepted")]
sys.exit(1 if bad else 0)
' "$STATE" || missing+=("factory slices not all verified/accepted")
      python3 -c '
import json, sys
s = json.load(open(sys.argv[1], encoding="utf-8"))
arts = s.get("artifacts") or {}
stale = [k for k,v in arts.items() if v.get("status") == "STALE"]
sys.exit(1 if stale else 0)
' "$STATE" || missing+=("STALE artifacts in STATE")
    fi
    if [[ -x "$ROOT/invalidate-stale.sh" ]]; then
      set +e
      "$ROOT/invalidate-stale.sh" --run "$RUN_ID"
      inv_rc=$?
      set -e
      if [[ "$inv_rc" -ne 0 ]]; then
        missing+=("invalidate-stale STALE (re-validate upstream)")
      fi
    fi
    check_lesson_for_verify_fail
    check_factory_blocked_lessons
    ;;
esac

if [[ ${#missing[@]} -gt 0 ]]; then
  echo "NOT DONE: $PLAN missing required tokens for mode=$MODE"
  for m in "${missing[@]}"; do echo "  - $m"; done
  exit 1
fi

if [[ "$MODE" == full || "$MODE" == factory ]]; then
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
if [[ "$MODE" == full || "$MODE" == factory ]] && [[ ${#warn[@]} -gt 0 ]]; then
  echo "WARN: recommended missing: ${warn[*]}"
fi
exit 0
