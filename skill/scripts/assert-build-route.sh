#!/usr/bin/env bash
# Hard gate: ROUTE_DECISION from route-slice.sh + optional BUILDER_DISPATCH.
# --require-dispatch also requires AGENT_MAP: in PLAN.
# Usage: assert-build-route.sh [PLAN.md] [--require-dispatch] [--run RUN_ID]
set -euo pipefail

PLAN=""
REQUIRE_DISPATCH=0
RUN_ID=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --require-dispatch) REQUIRE_DISPATCH=1; shift ;;
    --run)
      RUN_ID="$2"; shift 2 ;;
    -*)
      echo "unknown flag: $1" >&2; exit 2 ;;
    *)
      PLAN="$1"; shift ;;
  esac
done

if [[ -z "$PLAN" ]]; then
  if [[ -n "$RUN_ID" && -f ".workflow/route3/runs/$RUN_ID/05-PLAN.md" ]]; then
    PLAN=".workflow/route3/runs/$RUN_ID/05-PLAN.md"
  else
    for c in .workflow/route3/PLAN.md .workflow/PLAN.md PLAN.md; do
      if [[ -f "$c" ]]; then PLAN="$c"; break; fi
    done
  fi
fi

LOG=".workflow/route3/ROUTE_LAST.txt"
[[ -n "$RUN_ID" ]] && LOG=".workflow/route3/runs/$RUN_ID/ROUTE_LAST.txt"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [[ -z "${PLAN}" || ! -f "$PLAN" ]]; then
  echo "ASSERT FAIL: PLAN missing"
  exit 1
fi

if grep -Eq 'status=SKIPPED_TRIVIAL' "$PLAN"; then
  echo "ASSERT OK: trivial skip ($PLAN)"
  exit 0
fi

fail=()
primary=$(grep -Eo 'ROUTE_DECISION:.*primary=(codex|kimi|native)' "$PLAN" | tail -1 \
  | grep -Eo 'primary=(codex|kimi|native)' | cut -d= -f2 || true)
if [[ -z "$primary" ]]; then
  fail+=("no ROUTE_DECISION primary in PLAN — run route-slice.sh and paste output")
fi

if [[ ! -f "$LOG" ]]; then
  fail+=("missing $LOG — run route-slice.sh (do not invent ROUTE_DECISION)")
else
  logp=$(grep -Eo 'primary=(codex|kimi|native)' "$LOG" | tail -1 | cut -d= -f2 || true)
  if [[ -z "$logp" ]]; then
    fail+=("$LOG has no primary=")
  elif [[ -n "$primary" && "$logp" != "$primary" ]]; then
    fail+=("PLAN primary=$primary but route-slice log primary=$logp")
  fi
fi

if grep -Eiq 'BOSS_SELF_WRITE:\s*(yes|true)|BUILDER_DISPATCH:.*\bboss-self\b|BUILDER_DISPATCH:.*via=boss' "$PLAN"; then
  fail+=("boss self-write markers forbidden — see boss-discipline.md")
fi

if grep -Eiq 'continue yourself|boss will (code|implement|fix)|I (will|ll) (just )?(quickly )?(fix|implement)' "$PLAN"; then
  fail+=("PLAN contains boss-as-writer wording — dispatch Codex/Kimi/Task instead")
fi

dispatch_line=$(grep -E '^BUILDER_DISPATCH:' "$PLAN" | tail -1 || true)
if [[ "$REQUIRE_DISPATCH" -eq 1 || -n "$dispatch_line" ]]; then
  if [[ -z "$dispatch_line" ]]; then
    fail+=("missing BUILDER_DISPATCH: line — boss must log real dispatch (boss-discipline.md)")
  else
    echo "$dispatch_line" | grep -Eq 'primary=(codex|kimi|native)' \
      || fail+=("BUILDER_DISPATCH must include primary=codex|kimi|native")
    echo "$dispatch_line" | grep -Eq 'via=(codex-exec|kimi-cli|task|agent)' \
      || fail+=("BUILDER_DISPATCH via= must be codex-exec|kimi-cli|task|agent (not boss)")
    if [[ -n "$primary" ]]; then
      dprimary=$(echo "$dispatch_line" | grep -Eo 'primary=(codex|kimi|native)' | head -1 | cut -d= -f2 || true)
      if [[ -n "$dprimary" && "$dprimary" != "$primary" ]]; then
        fail+=("BUILDER_DISPATCH primary=$dprimary != ROUTE_DECISION primary=$primary")
      fi
    fi
    if [[ "$primary" == "native" ]] || echo "$dispatch_line" | grep -Eq 'primary=native'; then
      echo "$dispatch_line" | grep -Eq 'agents=route3-[a-z0-9-]+' \
        || fail+=("native BUILDER_DISPATCH must list agents=route3-… (Task/Agent dispatch)")
    fi
  fi
fi

if [[ "$REQUIRE_DISPATCH" -eq 1 && -n "$primary" && "$primary" != "native" ]]; then
  case "$primary" in
    codex)
      echo "$dispatch_line" | grep -Eq 'via=codex-exec' \
        || fail+=("primary=codex requires BUILDER_DISPATCH via=codex-exec")
      ;;
    kimi)
      echo "$dispatch_line" | grep -Eq 'via=kimi-cli' \
        || fail+=("primary=kimi requires BUILDER_DISPATCH via=kimi-cli")
      ;;
  esac
fi


if [[ "$REQUIRE_DISPATCH" -eq 1 ]]; then
  if ! grep -Eq '^AGENT_MAP:|[[:space:]]AGENT_MAP:' "$PLAN"; then
    fail+=("missing AGENT_MAP: in PLAN — declare EXISTS|MISSING_TYPE|USE_EXISTING before invoke (dispatch-prompt-contract.md)")
  fi
fi

if [[ ${#fail[@]} -gt 0 ]]; then
  echo "ASSERT FAIL: $PLAN — do NOT self-write; fix route/dispatch"
  for f in "${fail[@]}"; do echo "  - $f"; done
  echo "HINT: $ROOT/scripts/route-slice.sh --probe && dispatch per BUILD_WITH"
  exit 1
fi

echo "ASSERT OK: primary=${primary:-unknown} plan=$PLAN log=$LOG"
if [[ -z "$dispatch_line" ]]; then
  echo "WARN: BUILDER_DISPATCH not yet logged — required before check-plan-done.sh"
fi
exit 0
