#!/usr/bin/env bash
# Stop guard — converts the "done gate" from a suggestion into a wall.
#
# When a Route3 build is live, the agent cannot end its turn (Stop) until the
# real gates pass:
#   - assert-dispatch-evidence.sh  (a non-boss WRITER_ACK bound to the token)
#   - check-plan-done.sh           (required PLAN tokens present)
# On PASS it stamps DONE_OK (retiring the active state) and allows Stop.
# On FAIL it blocks Stop with the gate output as the reason.
#
# Loop-safe: if the harness re-invokes with stop_hook_active=true we allow,
# so a genuinely stuck run can never be permanently trapped.
#
# Exit: 0 allow stop | 2 block stop (agent must continue and fix the gate).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPTS="$(cd "$HERE/../scripts" && pwd)"
# shellcheck source=lib.sh
source "$HERE/lib.sh"

RAW="$(cat 2>/dev/null || true)"

# Re-entrancy guard: never trap a loop.
if [[ "$(hook_field stop_hook_active "$RAW")" == "True" || "$(hook_field stop_hook_active "$RAW")" == "true" ]]; then
  exit 0
fi

route3_active || exit 0

STATE="$(route3_state_dir)"
FAILS=""

if [[ -x "$SCRIPTS/assert-dispatch-evidence.sh" ]]; then
  if ! OUT_D="$("$SCRIPTS/assert-dispatch-evidence.sh" --quiet 2>&1)"; then
    FAILS+="dispatch-evidence: $OUT_D"$'\n'
  fi
fi

if [[ -x "$SCRIPTS/check-plan-done.sh" ]]; then
  if ! OUT_P="$("$SCRIPTS/check-plan-done.sh" 2>&1)"; then
    FAILS+="plan-done: $OUT_P"$'\n'
  fi
fi

if [[ -z "$FAILS" ]]; then
  : > "$STATE/DONE_OK" 2>/dev/null || true
  exit 0
fi

# Block the Stop. Claude Code shows the stderr reason back to the model.
echo "route3-guard: cannot finish — Route3 done gates FAILED:" >&2
printf '%s' "$FAILS" >&2
echo "Fix the gate (dispatch a writer / add missing PLAN tokens) then finish. Boss must not self-write to unblock." >&2
exit 2
