#!/usr/bin/env bash
# PreToolUse guard — makes "boss never self-writes" MECHANICAL, not honor-system.
#
# Wire on Edit|Write|MultiEdit|NotebookEdit. When a Route3 route is live
# (ROUTE_DECISION logged, not done) and the main thread tries to edit a PRODUCT
# file, this DENIES the tool call. The only escapes are the two sanctioned ones:
#   - a logged BOSS_EXCEPTION (bounded micro-edit, hard rule #5), or
#   - a trivial plan (status=SKIPPED_TRIVIAL).
#
# Outside a Route3 run it is a no-op (route3_active returns false), so it can
# never interfere with a normal session.
#
# Exit: 0 allow | 2 deny (Claude Code treats exit 2 on PreToolUse as a block).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib.sh
source "$HERE/lib.sh"

RAW="$(cat 2>/dev/null || true)"

# Not inside a live Route3 build → allow everything.
route3_active || exit 0

TOOL="$(hook_field tool_name "$RAW")"
case "$TOOL" in
  Edit|Write|MultiEdit|NotebookEdit) ;;
  *) exit 0 ;;
esac

FILE="$(hook_field tool_input.file_path "$RAW")"
[[ -z "$FILE" ]] && FILE="$(hook_field tool_input.notebook_path "$RAW")"
[[ -z "$FILE" ]] && exit 0

# Boss meta-edits (the Route3 skill itself, PLAN, .workflow markers) are allowed.
case "$FILE" in
  *"/.claude/skills/route3/"*|*"/.workflow/"*|*"/PLAN.md") exit 0 ;;
esac

is_product_path "$FILE" || exit 0

# Sanctioned escapes.
if route3_trivial_plan; then exit 0; fi
if route3_boss_exception; then
  echo "route3-guard: BOSS_EXCEPTION honoured for $FILE" >&2
  exit 0
fi

PRIMARY="$(route3_primary)"
deny_tool "Route3 boss-discipline: primary=${PRIMARY:-set}, so product file '$FILE' must be written by a dispatched writer (codex|kimi|zai|gemini|route3-* via Agent/Task), not the main thread. If this is a bounded (<20-line) ops fix, log a BOSS_EXCEPTION line first: printf 'BOSS_EXCEPTION: <reason> at <ISO>\\n' > \$(dirname ROUTE_LAST.txt)/BOSS_EXCEPTION"
