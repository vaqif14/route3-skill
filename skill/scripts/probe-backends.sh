#!/usr/bin/env bash
# Probe Sol / Kimi / z.ai / Gemini once. Always exit 0; prints machine-readable lines.
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
ZAI_MODEL="${ROUTE3_ZAI_MODEL:-glm-5.3}"
GEMINI_MODEL="${ROUTE3_GEMINI_MODEL:-gemini-3-flash-preview}"

classify() {
  local name="$1" out="$2"
  if echo "$out" | grep -Eq "$OK_RE"; then
    echo "${name}=GREEN"
  elif echo "$out" | grep -Eiq 'quota|usage limit|403|401|Ineligible|not logged|not authenticated|error|rate'; then
    echo "${name}=BLOCKED"
  else
    echo "${name}=BLOCKED"
  fi
}

probe_sol() {
  if ! command -v codex >/dev/null 2>&1; then echo "sol=MISSING"; return; fi
  # codex exec takes the prompt POSITIONALLY; -p is --profile (codex-cli >=0.144).
  out=$(codex exec --model "$CODEX_MODEL" --skip-git-repo-check \
    "reply ONLY: OK" </dev/null 2>&1 | tail -n 20) || true
  classify sol "$out"
}

probe_kimi() {
  if ! command -v kimi >/dev/null 2>&1; then echo "kimi=MISSING"; return; fi
  # kimi-code DOES take -p/--prompt (verified 0.18.0) — flag shape already correct.
  out=$(kimi -m "$KIMI_MODEL" -p "reply ONLY: OK" </dev/null 2>&1 | tail -n 20) || true
  classify kimi "$out"
}

# z.ai / GLM coding backends, first match wins:
#   1. lazyglm  — dedicated GLM coding agent
#   2. zai-cli  — official @z_ai/zai-cli toolkit
#   3. zai      — short binary alias if installed
#   4. hermes   — only when ZAI_API_KEY is set (coding-agent path)
probe_zai() {
  if command -v lazyglm >/dev/null 2>&1; then
    out=$(lazyglm -p "reply ONLY: OK" </dev/null 2>&1 | tail -n 20) || true
    classify zai "$out"
    return
  fi
  if command -v zai-cli >/dev/null 2>&1; then
    out=$(zai-cli chat "reply ONLY: OK" 2>&1 | tail -n 20) || true
    classify zai "$out"
    return
  fi
  if command -v zai >/dev/null 2>&1; then
    out=$(zai chat "reply ONLY: OK" 2>&1 | tail -n 20) || true
    classify zai "$out"
    return
  fi
  if command -v hermes >/dev/null 2>&1 && [[ -n "${ZAI_API_KEY:-}" ]]; then
    out=$(hermes -z "reply ONLY: OK" --provider zai -m "$ZAI_MODEL" \
      --yolo --cli </dev/null 2>&1 | tail -n 20) || true
    classify zai "$out"
    return
  fi
  echo "zai=MISSING"
}

probe_gemini() {
  if ! command -v gemini >/dev/null 2>&1; then echo "gemini=MISSING"; return; fi
  out=$(env -u GEMINI_API_KEY -u GOOGLE_API_KEY -u GOOGLE_GENAI_API_KEY \
    gemini -m "$GEMINI_MODEL" -y -p "reply ONLY: OK" 2>&1 | tail -n 20) || true
  classify gemini "$out"
}

echo "CLI_PROBE at=$(date -u +%Y-%m-%dT%H:%M:%SZ) ttl=session"
probe_sol
probe_kimi
probe_zai
probe_gemini

