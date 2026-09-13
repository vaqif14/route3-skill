#!/usr/bin/env bash
# PROOF harness for the Route3 enforcement hooks.
# Hermetic: each case gets a throwaway repo root whose .workflow/route3 is the
# state dir. We feed the exact Claude Code hook JSON on stdin and assert the
# exit code + decision. No network, no live settings, no real repo mutation.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
GW="$HERE/guard-boss-write.sh"
GD="$HERE/guard-done.sh"
chmod +x "$GW" "$GD" 2>/dev/null || true

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  \033[32mPASS\033[0m %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf '  \033[31mFAIL\033[0m %s (exit=%s expected=%s)\n%s\n' "$1" "$2" "$3" "$4"; }

# new_base: returns a fresh repo root with an initialised state dir.
new_base() { local b; b="$(mktemp -d)"; mkdir -p "$b/.workflow/route3"; echo "$b"; }
route()    { printf 'ROUTE_DECISION: primary=%s reason=test sol=MISSING kimi=MISSING\n' "${2:-native}" > "$1/.workflow/route3/ROUTE_LAST.txt"; }

# run <script> <expect-exit> <name> <base> <json>
run() {
  local script="$1" want="$2" name="$3" base="$4" json="$5" out ec
  out="$(cd "$base" && printf '%s' "$json" | ROUTE3_STATE_DIR="$base/.workflow/route3" "$script" 2>&1)"; ec=$?
  if [[ "$ec" -eq "$want" ]]; then ok "$name"; else bad "$name" "$ec" "$want" "      out: $out"; fi
}

echo "== guard-boss-write =="

B="$(new_base)"
run "$GW" 0 "no route → allow src edit" "$B" \
  '{"tool_name":"Edit","tool_input":{"file_path":"/p/src/api.ts"}}'

B="$(new_base)"; route "$B"
run "$GW" 2 "live route → DENY src edit" "$B" \
  '{"tool_name":"Write","tool_input":{"file_path":"/p/src/api.ts"}}'

B="$(new_base)"; route "$B"
run "$GW" 0 "live route → allow docs edit" "$B" \
  '{"tool_name":"Edit","tool_input":{"file_path":"/p/docs/README.md"}}'

B="$(new_base)"; route "$B"
run "$GW" 2 "live route → DENY prisma schema" "$B" \
  '{"tool_name":"Edit","tool_input":{"file_path":"/p/prisma/schema.prisma"}}'

B="$(new_base)"; route "$B"; printf 'BOSS_EXCEPTION: 8-line hotfix\n' > "$B/.workflow/route3/BOSS_EXCEPTION"
run "$GW" 0 "BOSS_EXCEPTION → allow bounded src edit" "$B" \
  '{"tool_name":"Edit","tool_input":{"file_path":"/p/src/api.ts"}}'

B="$(new_base)"; route "$B"; printf 'status=SKIPPED_TRIVIAL\n' > "$B/.workflow/route3/PLAN.md"
run "$GW" 0 "trivial plan → allow src edit" "$B" \
  '{"tool_name":"Edit","tool_input":{"file_path":"/p/src/x.ts"}}'

B="$(new_base)"; route "$B"
run "$GW" 0 "boss meta (skill edit) → allow" "$B" \
  '{"tool_name":"Edit","tool_input":{"file_path":"/Users/x/.claude/skills/route3/SKILL.md"}}'

B="$(new_base)"; route "$B"
run "$GW" 0 "Bash tool → allow" "$B" \
  '{"tool_name":"Bash","tool_input":{"command":"ls"}}'

echo "== guard-done =="

B="$(new_base)"
run "$GD" 0 "no route → allow stop" "$B" '{"stop_hook_active":false}'

B="$(new_base)"; route "$B"
run "$GD" 2 "live route, gates fail → BLOCK stop" "$B" '{"stop_hook_active":false}'

B="$(new_base)"; route "$B"
run "$GD" 0 "stop_hook_active=true → allow (loop-safe)" "$B" '{"stop_hook_active":true}'

# Passing world: token + non-boss WRITER_ACK + full PLAN tokens.
B="$(new_base)"; route "$B"
S="$B/.workflow/route3"
TOK="r3-20260811T000000Z-deadbeef"
printf '%s\n' "$TOK" > "$S/DISPATCH_TOKEN"
printf 'WRITER_ACK: agent=route3-api-expert token=%s at=2026-08-11T00:00:00Z\n' "$TOK" > "$S/WRITER_ACK.md"
cat > "$S/PLAN.md" <<PLAN
CLARIFY_COVERAGE: D1..D11 ok
GRILL: status=ALIGNED
SOLUTION_BAR: saas
AGENT_MAP: route3-api-expert|EXISTS
PREFLIGHT: PASS
ROUTE_DECISION: primary=native reason=test sol=MISSING kimi=MISSING
DISPATCH_PROMPT: present
BUILDER_DISPATCH: primary=native via=task agents=route3-api-expert|EXISTS at=2026-08-11T00:00:00Z
DISPATCH_TOKEN: $TOK
BUILD_PROOF: tsc+lint green
SLICE_EVAL: pass
BITIRDIM: task=hook fixture at=2026-08-11T00:00:00Z
BITIRDIM: task=hook fixture at=2026-08-11T00:00:00Z
PLAN
out="$(cd "$B" && printf '%s' '{"stop_hook_active":false}' | ROUTE3_STATE_DIR="$S" "$GD" 2>&1)"; ec=$?
if [[ "$ec" -eq 0 && -f "$S/DONE_OK" ]]; then ok "gates pass → allow stop + DONE_OK stamped"
else bad "gates pass → allow stop + DONE_OK stamped" "$ec / DONE_OK=$( [[ -f $S/DONE_OK ]] && echo y || echo n )" "0 / y" "      out: $out"; fi

# After DONE_OK, route is retired → a later src edit is allowed again.
run "$GW" 0 "post-DONE_OK → route retired, allow src edit" "$B" \
  '{"tool_name":"Edit","tool_input":{"file_path":"/p/src/api.ts"}}'

echo
echo "RESULT: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
