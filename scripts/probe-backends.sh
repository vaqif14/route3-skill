#!/usr/bin/env bash
# Probe Sol / Kimi / Gemini once. Always exit 0; prints machine-readable lines.
# Callers: scripts/route-slice.sh; references/native-primary.md; cli-backends.md
# Output (synthetic): CLI_PROBE at=2026-08-03T19:00:00Z ttl=session / sol=GREEN
#
# Status tokens: GREEN (usable) | BLOCKED (quota/auth/error) | MISSING (no CLI).
# Success is checked FIRST: unrelated stderr noise (MCP transport errors, model
# cache warnings) must not turn a working CLI into a false negative.
set -u

# Word-boundary OK so "TOKENS" / "BROKE" cannot fake a success.
OK_RE='(^|[^[:alnum:]])OK([^[:alnum:]]|$)'

# Model ids are configurable (portability). Override via env or project profile;
# defaults preserve the original behaviour.
CODEX_MODEL="${ROUTE3_CODEX_MODEL:-gpt-5.6-sol}"
KIMI_MODEL="${ROUTE3_KIMI_MODEL:-kimi-code/k3}"

probe_sol() {
  if ! command -v codex >/dev/null 2>&1; then echo "sol=MISSING"; return; fi
  # codex exec takes the prompt POSITIONALLY; -p is --profile (codex-cli >=0.144).
  out=$(codex exec --model "$CODEX_MODEL" --skip-git-repo-check \
    "reply ONLY: OK" </dev/null 2>&1 | tail -n 20) || true
  if echo "$out" | grep -Eq "$OK_RE"; then
    echo "sol=GREEN"
  elif echo "$out" | grep -Eiq 'quota|usage limit|403|401|Ineligible|not logged|error'; then
    echo "sol=BLOCKED"
  else
    echo "sol=BLOCKED"
  fi
}

probe_kimi() {
  if ! command -v kimi >/dev/null 2>&1; then echo "kimi=MISSING"; return; fi
  # kimi-code DOES take -p/--prompt (verified 0.18.0) — flag shape already correct.
  out=$(kimi -m "$KIMI_MODEL" -p "reply ONLY: OK" </dev/null 2>&1 | tail -n 20) || true
  if echo "$out" | grep -Eq "$OK_RE"; then
    echo "kimi=GREEN"
  elif echo "$out" | grep -Eiq 'quota|usage limit|403|401|Ineligible|error|rate'; then
    echo "kimi=BLOCKED"
  else
    echo "kimi=BLOCKED"
  fi
}

probe_gemini() {
  if ! command -v gemini >/dev/null 2>&1; then echo "gemini=MISSING"; return; fi
  out=$(env -u GEMINI_API_KEY -u GOOGLE_API_KEY -u GOOGLE_GENAI_API_KEY \
    gemini -m gemini-3-flash-preview -y -p "reply ONLY: OK" 2>&1 | tail -n 20) || true
  if echo "$out" | grep -Eq "$OK_RE"; then
    echo "gemini=GREEN"
  elif echo "$out" | grep -Eiq 'quota|usage limit|403|401|Ineligible|not authenticated|error'; then
    echo "gemini=BLOCKED"
  else
    echo "gemini=BLOCKED"
  fi
}

echo "CLI_PROBE at=$(date -u +%Y-%m-%dT%H:%M:%SZ) ttl=session"
probe_sol
probe_kimi
probe_gemini
