#!/usr/bin/env bash
# Routing + dispatch-evidence evals (no network). Exit 0 all pass.
# Cases declared in evals/route-evals.json; implemented by id below.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCR="$ROOT/scripts"
CASES="$ROOT/evals/route-evals.json"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
cd "$TMP"
mkdir -p .workflow/route3 stub
PASS=0; FAIL=0
ok() { PASS=$((PASS+1)); echo "PASS: $1"; }
bad() { FAIL=$((FAIL+1)); echo "FAIL: $1"; }

if [[ -f "$CASES" ]]; then
  python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$CASES" \
    || { echo "FAIL: route-evals.json is not valid JSON"; exit 1; }
fi

# --- stub CLI factory -------------------------------------------------------
# probe-backends.sh shells out to `codex`; a stub keeps this offline and lets us
# assert the classification logic (success token wins over unrelated noise).
make_codex_stub() {
  cat > stub/codex <<EOF
#!/usr/bin/env bash
$1
EOF
  chmod +x stub/codex
}

# Keep the suite offline: probe-backends.sh also shells out to peer CLIs.
for peer in kimi gemini zai zai-cli lazyglm hermes; do
  printf '#!/usr/bin/env bash\necho "403 usage limit"\nexit 1\n' > "stub/$peer"
  chmod +x "stub/$peer"
done
probe_sol_line() {
  PATH="$TMP/stub:$PATH" "$SCR/probe-backends.sh" 2>/dev/null | grep -E '^sol=' | head -1
}
probe_kimi_line() {
  PATH="$TMP/stub:$PATH" "$SCR/probe-backends.sh" 2>/dev/null | grep -E '^kimi=' | head -1
}

# Case: healthy CLI answering OK → GREEN
make_codex_stub 'echo OK'
line=$(probe_sol_line)
[[ "$line" == "sol=GREEN" ]] && ok "probe-green-healthy-cli" || bad "probe-green-healthy-cli ($line)"

# Case: real-world stderr noise (MCP transport / model cache) must not mask GREEN
make_codex_stub '
echo "2026-08-08T01:00:00Z ERROR rmcp::transport::worker: send request error" >&2
echo "ERROR codex_models_manager::manager: failed to renew cache TTL" >&2
echo codex
echo OK
echo "tokens used"
echo "17,703"'
line=$(probe_sol_line)
[[ "$line" == "sol=GREEN" ]] && ok "probe-green-despite-stderr-noise" || bad "probe-green-despite-stderr-noise ($line)"

# Case: genuine quota death → BLOCKED (token renamed from OPEN)
make_codex_stub 'echo "403 usage limit reached for this billing cycle" >&2; exit 1'
line=$(probe_sol_line)
[[ "$line" == "sol=BLOCKED" ]] && ok "probe-blocked-on-quota" || bad "probe-blocked-on-quota ($line)"

# Case: kimi keeps -p/--prompt (verified shape) and reports BLOCKED on quota
line=$(probe_kimi_line)
[[ "$line" == "kimi=BLOCKED" ]] && ok "probe-kimi-blocked-on-quota" || bad "probe-kimi-blocked-on-quota ($line)"

# Case: both GREEN → Kimi is the default primary (not Codex)
printf 'CLI_PROBE at=2026-08-08T01:26:00Z ttl=session\nsol=GREEN\nkimi=GREEN\nzai=GREEN\ngemini=GREEN\n' \
  > .workflow/route3/CLI_PROBE.txt
route_out=$("$SCR/route-slice.sh" --cache .workflow/route3/CLI_PROBE.txt --ttl 99999)
if echo "$route_out" | grep -q 'primary=kimi'; then
  ok "route-primary-kimi-when-both-green"
else
  bad "route-primary-kimi-when-both-green ($route_out)"
fi

# Case: Kimi dead, Codex GREEN → Codex is second
printf 'CLI_PROBE at=2026-08-08T01:26:00Z ttl=session\nsol=GREEN\nkimi=BLOCKED\nzai=MISSING\ngemini=MISSING\n' \
  > .workflow/route3/CLI_PROBE.txt
route_out=$("$SCR/route-slice.sh" --cache .workflow/route3/CLI_PROBE.txt --ttl 99999)
if echo "$route_out" | grep -q 'primary=codex' \
  && echo "$route_out" | grep -q '^DISPATCH_TOKEN: r3-' \
  && [[ -s .workflow/route3/DISPATCH_TOKEN ]]; then
  ok "route-primary-codex-when-kimi-dead"
else
  bad "route-primary-codex-when-kimi-dead ($route_out)"
fi

TOKEN=$(cat .workflow/route3/DISPATCH_TOKEN)
ROUTE_SNAP=$(cat .workflow/route3/ROUTE_LAST.txt)

# Case: design class prefers Gemini even when Kimi+Codex are GREEN
printf 'CLI_PROBE at=2026-08-08T01:26:00Z ttl=session\nsol=GREEN\nkimi=GREEN\nzai=GREEN\ngemini=GREEN\n' \
  > .workflow/route3/CLI_PROBE.txt
route_out=$("$SCR/route-slice.sh" --class design --cache .workflow/route3/CLI_PROBE.txt --ttl 99999)
if echo "$route_out" | grep -q 'primary=gemini' && echo "$route_out" | grep -q 'class=design'; then
  ok "route-primary-gemini-on-design-class"
else
  bad "route-primary-gemini-on-design-class ($route_out)"
fi

# Case: planning/discussion class prefers z.ai even when Kimi+Codex are GREEN
printf 'CLI_PROBE at=2026-08-08T01:26:00Z ttl=session\nsol=GREEN\nkimi=GREEN\nzai=GREEN\ngemini=GREEN\n' \
  > .workflow/route3/CLI_PROBE.txt
route_out=$("$SCR/route-slice.sh" --class planning --cache .workflow/route3/CLI_PROBE.txt --ttl 99999)
if echo "$route_out" | grep -q 'primary=zai' && echo "$route_out" | grep -q 'class=planning'; then
  ok "route-primary-zai-on-planning-class"
else
  bad "route-primary-zai-on-planning-class ($route_out)"
fi

# Case: Codex+Kimi dead, z.ai GREEN → primary=zai (active builder, not skipped)
printf 'CLI_PROBE at=2026-08-08T01:26:00Z ttl=session\nsol=BLOCKED\nkimi=BLOCKED\nzai=GREEN\ngemini=MISSING\n' \
  > .workflow/route3/CLI_PROBE.txt
route_out=$("$SCR/route-slice.sh" --cache .workflow/route3/CLI_PROBE.txt --ttl 99999)
if echo "$route_out" | grep -q 'primary=zai' \
  && echo "$route_out" | grep -q 'via=zai-cli\|BUILD_WITH:'; then
  ok "route-primary-zai-when-prior-cli-dead"
else
  bad "route-primary-zai-when-prior-cli-dead ($route_out)"
fi

# Case: prior CLIs dead, Gemini GREEN → primary=gemini (active builder, not optional cascade)
printf 'CLI_PROBE at=2026-08-08T01:26:00Z ttl=session\nsol=BLOCKED\nkimi=BLOCKED\nzai=BLOCKED\ngemini=GREEN\n' \
  > .workflow/route3/CLI_PROBE.txt
route_out=$("$SCR/route-slice.sh" --cache .workflow/route3/CLI_PROBE.txt --ttl 99999)
if echo "$route_out" | grep -q 'primary=gemini'; then
  ok "route-primary-gemini-when-prior-cli-dead"
else
  bad "route-primary-gemini-when-prior-cli-dead ($route_out)"
fi

# Restore the Codex token + route log for the dispatch-evidence fixtures below.
printf '%s\n' "$TOKEN" > .workflow/route3/DISPATCH_TOKEN
printf '%s\n' "$ROUTE_SNAP" > .workflow/route3/ROUTE_LAST.txt

# --- dispatch evidence fixtures --------------------------------------------
cat > PLAN.md <<P
GRILL: status=ALIGNED
open_branches=none
CLARIFY_COVERAGE: D1 ok D2 ok D3 ok D4 ok D5 ok D6 ok D7 ok D8 ok D9 ok D10 ok D11 ok
GOAL: dispatch evidence fixture
AC:
- writer evidence is required, not boss prose
SOLUTION_BAR: saas
AGENT_MAP: route3-api-expert|EXISTS
ROUTE_DECISION: primary=codex reason=mandatory_codex_first sol=GREEN kimi=BLOCKED
BUILD_PROOF: gates green
BUILDER_DISPATCH: primary=codex via=codex-exec agents=route3-api-expert|EXISTS at=2026-08-08T01:26:00Z
P

run_assert() {
  set +e
  out=$("$SCR/assert-build-route.sh" PLAN.md --require-dispatch 2>&1)
  rc=$?
  set -e
  printf '%s' "$out"
  return $rc
}

# Case: BUILDER_DISPATCH claimed, no WRITER_ACK anywhere → gate must fail
set +e
out=$(run_assert); rc=$?
set -e
if [[ "$rc" -eq 1 ]] && printf '%s' "$out" | grep -q 'DISPATCH_EVIDENCE FAIL'; then
  ok "dispatch-without-writer-ack-fails"
else
  bad "dispatch-without-writer-ack-fails (exit=$rc) $out"
fi

# Case: ack exists but carries a stale token from an earlier route
printf 'WRITER_ACK: agent=route3-api-expert token=r3-19990101T000000Z-deadbeef at=2026-08-08T01:26:00Z\n' \
  > .workflow/route3/WRITER_ACK.md
set +e
out=$(run_assert); rc=$?
set -e
if [[ "$rc" -eq 1 ]] && printf '%s' "$out" | grep -q 'DISPATCH_EVIDENCE FAIL'; then
  ok "dispatch-with-stale-token-fails"
else
  bad "dispatch-with-stale-token-fails (exit=$rc) $out"
fi

# Case: boss forges an ack with the right token but its own identity
printf 'WRITER_ACK: agent=boss token=%s at=2026-08-08T01:26:00Z\n' "$TOKEN" \
  > .workflow/route3/WRITER_ACK.md
set +e
out=$(run_assert); rc=$?
set -e
if [[ "$rc" -eq 1 ]] && printf '%s' "$out" | grep -q 'DISPATCH_EVIDENCE FAIL'; then
  ok "dispatch-boss-authored-ack-fails"
else
  bad "dispatch-boss-authored-ack-fails (exit=$rc) $out"
fi

# Case: real writer ack bound to the routed token → gate passes
printf 'WRITER_ACK: agent=route3-api-expert token=%s at=2026-08-08T01:26:00Z\n' "$TOKEN" \
  > .workflow/route3/WRITER_ACK.md
set +e
out=$(run_assert); rc=$?
set -e
if [[ "$rc" -eq 0 ]] && printf '%s' "$out" | grep -q 'DISPATCH_EVIDENCE OK' \
  && printf '%s' "$out" | grep -q 'ASSERT OK'; then
  ok "dispatch-with-writer-ack-passes"
else
  bad "dispatch-with-writer-ack-passes (exit=$rc) $out"
fi

# --- scope audit (intent fidelity) ------------------------------------------
scope_run() { set +e; out=$("$SCR/check-scope.sh" "$@" 2>&1); rc=$?; set -e; }
mkdir -p scope && printf 'src/app.js\nsrc/util.js\n' > scope/ok.txt
scope_run --allow 'src/**' --changed scope/ok.txt
[[ "$rc" -eq 0 ]] && echo "$out" | grep -q 'SCOPE OK' \
  && ok "scope-traced-passes" || bad "scope-traced-passes (exit=$rc) $out"

printf 'src/app.js\nREADME.md\n' > scope/untraced.txt
scope_run --allow 'src/**' --changed scope/untraced.txt
[[ "$rc" -eq 1 ]] && echo "$out" | grep -q 'UNTRACED: README.md' \
  && ok "scope-untraced-fails" || bad "scope-untraced-fails (exit=$rc) $out"

printf 'src/legacy/pay.js\n' > scope/forbid.txt
scope_run --allow 'src/**' --forbid 'src/legacy/**' --changed scope/forbid.txt
[[ "$rc" -eq 1 ]] && echo "$out" | grep -q 'FORBIDDEN: src/legacy/pay.js' \
  && ok "scope-forbidden-beats-allow" || bad "scope-forbidden-beats-allow (exit=$rc) $out"

printf 'src/debug_dump.js\nsrc/run.log\n' > scope/scratch.txt
scope_run --allow 'src/**' --changed scope/scratch.txt
[[ "$rc" -eq 1 ]] && echo "$out" | grep -q 'SCRATCH: src/debug_dump.js' \
  && echo "$out" | grep -q 'SCRATCH: src/run.log' \
  && ok "scope-scratch-leftovers-fail" || bad "scope-scratch-leftovers-fail (exit=$rc) $out"

# Non-git workspace: INTENT.md ALLOW + start marker picks up only newer files.
mkdir -p ws/.workflow/route3 ws/src ws/docs
printf 'REQUEST: fix sum\nALLOW: src/**\n' > ws/.workflow/route3/INTENT.md
echo old > ws/docs/old.md
( cd ws && "$SCR/check-scope.sh" --mark >/dev/null )
echo new > ws/src/sum.js
scope_run --root ws
[[ "$rc" -eq 0 ]] && echo "$out" | grep -q 'TRACED: src/sum.js' \
  && ! echo "$out" | grep -q 'docs/old.md' \
  && ok "scope-marker-intent-nongit" || bad "scope-marker-intent-nongit (exit=$rc) $out"
echo drift > ws/docs/new.md
scope_run --root ws
[[ "$rc" -eq 1 ]] && echo "$out" | grep -q 'UNTRACED: docs/new.md' \
  && ok "scope-marker-catches-drift" || bad "scope-marker-catches-drift (exit=$rc) $out"

# Git subdirectory: paths must be relative to --root, not the repo top level.
if command -v git >/dev/null 2>&1; then
  mkdir -p repo/pkg/src && ( cd repo && git init -q . )
  echo x > repo/pkg/src/a.js
  scope_run --root repo/pkg --allow 'src/**' --git
  [[ "$rc" -eq 0 ]] && echo "$out" | grep -q 'TRACED: src/a.js' \
    && ok "scope-git-subdir-relative" || bad "scope-git-subdir-relative (exit=$rc) $out"
fi

# Regressions found by adversarial review of check-scope.sh.
mkdir -p md/.workflow/route3 && printf 'src/pay/x.js\nsrc/my_file.js\n' > md/l.txt
printf -- '- ALLOW: `src/**`\n**FORBID:** src/pay/**\n' > md/.workflow/route3/INTENT.md
scope_run --root md --changed l.txt
[[ "$rc" -eq 1 ]] && echo "$out" | grep -q 'FORBIDDEN: src/pay/x.js' \
  && echo "$out" | grep -q 'TRACED: src/my_file.js' \
  && ok "scope-markdown-intent-keeps-forbid" || bad "scope-markdown-intent-keeps-forbid (exit=$rc) $out"

printf 'REQUEST: fix it\nAllow: everything please\nALLOW: src/**\n' > md/.workflow/route3/INTENT.md
printf 'everything please\n' > md/p.txt
scope_run --root md --changed p.txt
[[ "$rc" -eq 1 ]] && echo "$out" | grep -q 'UNTRACED: everything please' \
  && ok "scope-prose-allow-not-scope" || bad "scope-prose-allow-not-scope (exit=$rc) $out"

printf 'src/a.js\nsrc/deep/x.js\n' > scope/star.txt
scope_run --allow 'src/*.js' --changed scope/star.txt
[[ "$rc" -eq 1 ]] && echo "$out" | grep -q 'UNTRACED: src/deep/x.js' \
  && echo "$out" | grep -q 'TRACED: src/a.js' \
  && ok "scope-single-star-stays-in-dir" || bad "scope-single-star-stays-in-dir (exit=$rc) $out"

mkdir -p snap/src && echo del > snap/src/old.js
( cd snap && "$SCR/check-scope.sh" --mark >/dev/null )
echo keep > snap/aged.txt && touch -t 202001010000 snap/aged.txt
rm snap/src/old.js
scope_run --root snap --allow 'src/**'
[[ "$rc" -eq 1 ]] && echo "$out" | grep -q 'UNTRACED: aged.txt' \
  && echo "$out" | grep -q 'TRACED: DELETED src/old.js' \
  && ok "scope-snapshot-sees-old-mtime-and-deletes" || bad "scope-snapshot-sees-old-mtime-and-deletes (exit=$rc) $out"

mkdir -p empty && ( cd empty && "$SCR/check-scope.sh" --mark >/dev/null )
scope_run --root empty --allow 'src/**'
[[ "$rc" -eq 0 ]] && echo "$out" | grep -q 'SCOPE EMPTY' \
  && ok "scope-empty-change-is-reported" || bad "scope-empty-change-is-reported (exit=$rc) $out"

if command -v git >/dev/null 2>&1; then
  mkdir -p repo/other && echo evil > repo/other/evil.js
  scope_run --root repo/pkg --allow 'src/**' --git
  [[ "$rc" -eq 1 ]] && echo "$out" | grep -q 'UNTRACED: ../other/evil.js' \
    && ok "scope-git-sees-outside-root" || bad "scope-git-sees-outside-root (exit=$rc) $out"
fi

# Scope lock: boss freezes ALLOW/FORBID; the gate refuses agent-supplied overrides.
mkdir -p lk/.workflow/route3 && printf 'REQUEST: x\n' > lk/.workflow/route3/INTENT.md
scope_run --root lk --lock
[[ "$rc" -eq 1 ]] && echo "$out" | grep -q 'no ALLOW line' \
  && ok "scope-lock-requires-allow" || bad "scope-lock-requires-allow (exit=$rc) $out"
printf 'REQUEST: x\nALLOW: src/**\n' > lk/.workflow/route3/INTENT.md
printf 'README.md\n' > lk/list.txt
scope_run --root lk --lock
scope_run --root lk --gate --changed list.txt
[[ "$rc" -eq 2 ]] && ok "scope-gate-rejects-agent-list" || bad "scope-gate-rejects-agent-list (exit=$rc) $out"
scope_run --allow '**' --changed scope/ok.txt
[[ "$rc" -eq 1 ]] && echo "$out" | grep -q 'ALLOW too broad' \
  && ok "scope-broad-allow-refused" || bad "scope-broad-allow-refused (exit=$rc) $out"

echo "EVAL_ROUTE: pass=$PASS fail=$FAIL"
[[ "$FAIL" -eq 0 ]]
