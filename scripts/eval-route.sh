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

# Keep the suite offline: probe-backends.sh also shells out to kimi/gemini.
for peer in kimi gemini; do
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

# Case: sol=GREEN routes to codex and stamps a dispatch token
printf 'CLI_PROBE at=2026-08-08T01:26:00Z ttl=session\nsol=GREEN\nkimi=BLOCKED\ngemini=MISSING\n' \
  > .workflow/route3/CLI_PROBE.txt
route_out=$("$SCR/route-slice.sh" --cache .workflow/route3/CLI_PROBE.txt --ttl 99999)
if echo "$route_out" | grep -q 'primary=codex' \
  && echo "$route_out" | grep -q '^DISPATCH_TOKEN: r3-' \
  && [[ -s .workflow/route3/DISPATCH_TOKEN ]]; then
  ok "route-primary-codex-when-sol-green"
else
  bad "route-primary-codex-when-sol-green ($route_out)"
fi

TOKEN=$(cat .workflow/route3/DISPATCH_TOKEN)

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

echo "EVAL_ROUTE: pass=$PASS fail=$FAIL"
[[ "$FAIL" -eq 0 ]]
