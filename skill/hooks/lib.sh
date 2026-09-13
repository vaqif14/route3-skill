#!/usr/bin/env bash
# Shared helpers for Route3 enforcement hooks.
# State dir is overridable (ROUTE3_STATE_DIR) so hooks are hermetically testable.
set -euo pipefail

route3_state_dir() {
  echo "${ROUTE3_STATE_DIR:-$PWD/.workflow/route3}"
}

# 0 = a Route3 build is IN FLIGHT (a route was decided, not yet done-validated).
# Outside a Route3 run this returns 1, so hooks are no-ops in normal sessions
# and can never trap an unrelated conversation.
route3_active() {
  local d; d="$(route3_state_dir)"
  [[ -f "$d/ROUTE_LAST.txt" ]] || return 1
  grep -Eq '^ROUTE_DECISION: primary=' "$d/ROUTE_LAST.txt" || return 1
  # A validated done marker retires the active state.
  [[ -f "$d/DONE_OK" ]] && return 1
  return 0
}

# The routed primary (codex|kimi|zai|gemini|native) for the live slice, or empty.
route3_primary() {
  local d; d="$(route3_state_dir)"
  [[ -f "$d/ROUTE_LAST.txt" ]] || { echo ""; return 0; }
  grep -Eo 'primary=[a-z]+' "$d/ROUTE_LAST.txt" | head -1 | cut -d= -f2 || echo ""
}

# Boss micro-exception (hard rule #5 / boss-discipline tiny-exceptions):
# a logged BOSS_EXCEPTION file authorises a bounded main-thread edit.
route3_boss_exception() {
  local d; d="$(route3_state_dir)"
  [[ -f "$d/BOSS_EXCEPTION" ]]
}

# Trivial slices legitimately skip the boss-never-write rule.
route3_trivial_plan() {
  local d p; d="$(route3_state_dir)"
  for p in "$d/PLAN.md" "$PWD/PLAN.md" "$d/../PLAN.md"; do
    [[ -f "$p" ]] && grep -Eq 'status=SKIPPED_TRIVIAL|FACTORY:\s*class=trivial' "$p" && return 0
  done
  return 1
}

# Product surfaces the boss must never hand-edit while a route is live.
PRODUCT_PATH_RE='(^|/)(src|app|pages|components|lib|server|prisma)(/|$)|\.prisma$|prisma/schema'

is_product_path() {
  [[ "$1" =~ $PRODUCT_PATH_RE ]]
}

# Emit a PreToolUse deny decision (JSON) + exit 2 (Claude Code blocks on 2).
deny_tool() {
  local reason="$1"
  cat <<JSON
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":$(json_str "$reason")}}
JSON
  exit 2
}

# Minimal JSON string escaper (no jq dependency in the hot path).
json_str() {
  local s="$1"
  s="${s//\\/\\\\}"; s="${s//\"/\\\"}"; s="${s//$'\n'/\\n}"
  printf '"%s"' "$s"
}

# Read a field from the hook's stdin JSON. Prefers python3, falls back to grep.
hook_field() {
  local field="$1" raw="$2"
  if command -v python3 >/dev/null 2>&1; then
    printf '%s' "$raw" | python3 -c "
import sys, json
try: d = json.load(sys.stdin)
except Exception: print(''); sys.exit(0)
# dotted path e.g. tool_input.file_path
cur = d
for part in '$field'.split('.'):
    if isinstance(cur, dict) and part in cur: cur = cur[part]
    else: cur = ''; break
# Return scalars verbatim (bool -> 'True'/'False', ints -> str); blank for containers/None.
print('' if (cur is None or isinstance(cur,(dict,list))) else cur)
"
  else
    printf '%s' "$raw" | grep -Eo "\"${field##*.}\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 | sed -E 's/.*:[[:space:]]*"([^"]*)"/\1/'
  fi
}
