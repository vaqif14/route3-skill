#!/usr/bin/env bash
# Probe Sol / Kimi / Gemini once. Always exit 0; prints machine-readable lines.
# Callers: scripts/route-slice.sh; references/native-primary.md; cli-backends.md
# Output (synthetic): CLI_PROBE at=2026-08-03T19:00:00Z ttl=session / sol=GREEN
set -u

probe_sol() {
  if ! command -v codex >/dev/null 2>&1; then echo "sol=MISSING"; return; fi
  out=$(codex exec --model gpt-5.6-sol --skip-git-repo-check \
    -p "reply ONLY: OK" </dev/null 2>&1 | tail -n 5) || true
  if echo "$out" | grep -Eiq 'quota|usage limit|403|401|Ineligible|not logged|error'; then
    echo "sol=OPEN"
  elif echo "$out" | grep -q 'OK'; then
    echo "sol=GREEN"
  else
    echo "sol=OPEN"
  fi
}

probe_kimi() {
  if ! command -v kimi >/dev/null 2>&1; then echo "kimi=MISSING"; return; fi
  out=$(kimi -m kimi-code/k3 -p "reply ONLY: OK" </dev/null 2>&1 | tail -n 8) || true
  if echo "$out" | grep -Eiq 'quota|usage limit|403|401|Ineligible|error|rate'; then
    echo "kimi=OPEN"
  elif echo "$out" | grep -q 'OK'; then
    echo "kimi=GREEN"
  else
    echo "kimi=OPEN"
  fi
}

probe_gemini() {
  if ! command -v gemini >/dev/null 2>&1; then echo "gemini=MISSING"; return; fi
  out=$(env -u GEMINI_API_KEY -u GOOGLE_API_KEY -u GOOGLE_GENAI_API_KEY \
    gemini -m gemini-3-flash-preview -y -p "reply ONLY: OK" 2>&1 | tail -n 8) || true
  if echo "$out" | grep -Eiq 'quota|usage limit|403|401|Ineligible|not authenticated|error'; then
    echo "gemini=OPEN"
  elif echo "$out" | grep -q 'OK'; then
    echo "gemini=GREEN"
  else
    echo "gemini=OPEN"
  fi
}

echo "CLI_PROBE at=$(date -u +%Y-%m-%dT%H:%M:%SZ) ttl=session"
probe_sol
probe_kimi
probe_gemini
