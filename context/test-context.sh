#!/usr/bin/env bash
# PROOF harness for the native context engine. Hermetic: builds a throwaway git
# repo with known imports and asserts the graph, blast radius, drift, and
# context-pack ranking are all correct. No network, no real repo touched.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
E="$HERE/engine.mjs"
command -v node >/dev/null || { echo "node required" >&2; exit 2; }

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  \033[32mPASS\033[0m %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf '  \033[31mFAIL\033[0m %s\n     %s\n' "$1" "$2"; }
assert_has() { if printf '%s' "$2" | grep -qF "$3"; then ok "$1"; else bad "$1" "missing '$3' in: $(printf '%s' "$2" | tr '\n' '|')"; fi; }
assert_exit() { if [[ "$2" -eq "$3" ]]; then ok "$1"; else bad "$1" "exit=$2 want=$3"; fi; }

R="$(mktemp -d)"
git -C "$R" init -q
mkdir -p "$R/src"
cat > "$R/src/util.ts" <<'EOF'
export function retry(fn: () => void) { return fn; }
export const LIMIT = 5;
EOF
cat > "$R/src/client.ts" <<'EOF'
import { retry, LIMIT } from './util';
export function httpClient() { return retry(() => LIMIT); }
EOF
cat > "$R/src/page.tsx" <<'EOF'
import { httpClient } from './client';
export default function Page() { return httpClient(); }
EOF
git -C "$R" add -A >/dev/null 2>&1

echo "== context engine =="

OUT="$(cd "$R" && node "$E" build)"
assert_has "build reports 3 files" "$OUT" "files=3"

# util.ts is imported by client.ts (fan-in 1); client.ts imported by page.tsx.
MAP="$(cd "$R" && node "$E" map --budget 5)"
assert_has "map shows util.ts as hub" "$MAP" "src/util.ts"

# blast radius: editing util.ts impacts client.ts (d1) and page.tsx (d2).
CALL="$(cd "$R" && node "$E" callers src/util.ts --depth 2)"
assert_has "callers d1 = client.ts" "$CALL" "src/client.ts"
assert_has "callers d2 = page.tsx (transitive)" "$CALL" "src/page.tsx"

# callers by SYMBOL resolves to defining file then walks.
CALLS="$(cd "$R" && node "$E" callers retry --depth 1)"
assert_has "callers by symbol 'retry'" "$CALLS" "src/client.ts"

# skeleton = signatures only.
SK="$(cd "$R" && node "$E" skeleton src/util.ts)"
assert_has "skeleton lists retry()" "$SK" "export function retry"

# drift: clean right after build, dirty after edit.
( cd "$R" && node "$E" check ) >/dev/null 2>&1; assert_exit "check clean → exit 0" "$?" 0
printf '\nexport const EXTRA = 1;\n' >> "$R/src/util.ts"
( cd "$R" && node "$E" check ) >/dev/null 2>&1; assert_exit "check after edit → exit 1" "$?" 1
DRIFT="$(cd "$R" && node "$E" check 2>&1)"; assert_has "drift names util.ts" "$DRIFT" "src/util.ts"

# pack: query ranks the http client file top (path+symbol match, not noise).
PACK="$(cd "$R" && node "$E" build >/dev/null && node "$E" pack "fix httpClient retry" --k 2)"
assert_has "pack surfaces client.ts" "$PACK" "src/client.ts"
assert_has "pack emits CONTEXT block" "$PACK" "<CONTEXT"

echo
echo "RESULT: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
