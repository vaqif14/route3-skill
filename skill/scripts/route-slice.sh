#!/usr/bin/env bash
# Mandatory backend router for Route3 coding slices.
# Order (user policy): Codex/Sol → Kimi (if Codex quota/OPEN) → native (if both dead).
#
# Callers: SKILL.md hard rule #1; slim-v3; cli-backends.md; native-primary.md
#
# Usage:
#   route-slice.sh [--probe] [--cache FILE]
#     --probe   run probe-backends.sh first (default: use cache if fresh)
#     --cache   path to CLI_PROBE cache (default: .workflow/route3/CLI_PROBE.txt)
#
# Prints machine-readable lines + exit 0 always:
#   ROUTE_DECISION: primary=codex|kimi|native reason=...
#   BUILD_WITH: <hint>
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROBE="$ROOT/scripts/probe-backends.sh"
DO_PROBE=0
CACHE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --probe) DO_PROBE=1; shift ;;
    --cache) CACHE="$2"; shift 2 ;;
    *) shift ;;
  esac
done

if [[ -z "$CACHE" ]]; then
  if [[ -d .workflow/route3 ]]; then
    CACHE=".workflow/route3/CLI_PROBE.txt"
  else
    CACHE="/tmp/route3-CLI_PROBE.txt"
  fi
fi

run_probe() {
  if [[ -x "$PROBE" ]]; then
    "$PROBE"
  else
    echo "CLI_PROBE at=$(date -u +%Y-%m-%dT%H:%M:%SZ) ttl=session"
    echo "sol=MISSING"
    echo "kimi=MISSING"
    echo "gemini=MISSING"
  fi
}

if [[ "$DO_PROBE" -eq 1 || ! -f "$CACHE" ]]; then
  mkdir -p "$(dirname "$CACHE")" 2>/dev/null || true
  run_probe | tee "$CACHE"
else
  cat "$CACHE"
fi

sol=$(grep -E "^sol=" "$CACHE" 2>/dev/null | head -1 | cut -d= -f2 || echo OPEN)
kimi=$(grep -E "^kimi=" "$CACHE" 2>/dev/null | head -1 | cut -d= -f2 || echo OPEN)

if [[ "$sol" == "GREEN" ]]; then
  echo "ROUTE_DECISION: primary=codex reason=mandatory_codex_first sol=GREEN"
  echo "BUILD_WITH: codex exec --model gpt-5.6-sol -s workspace-write -c model_reasoning_effort=high --skip-git-repo-check"
  mkdir -p .workflow/route3 2>/dev/null || true
  echo "ROUTE_DECISION: primary=codex reason=mandatory_codex_first sol=GREEN" > .workflow/route3/ROUTE_LAST.txt 2>/dev/null || true
  exit 0
fi

if [[ "$kimi" == "GREEN" ]]; then
  echo "ROUTE_DECISION: primary=kimi reason=codex_quota_or_open sol=$sol kimi=GREEN"
  echo "BUILD_WITH: kimi -m kimi-code/k3 -p \"…\" </dev/null"
  mkdir -p .workflow/route3 2>/dev/null || true
  echo "ROUTE_DECISION: primary=kimi reason=codex_quota_or_open sol=$sol kimi=GREEN" > .workflow/route3/ROUTE_LAST.txt 2>/dev/null || true
  exit 0
fi

echo "ROUTE_DECISION: primary=native reason=codex_and_kimi_quota sol=$sol kimi=$kimi"
echo "BUILD_WITH: native route3-* experts (identical AC; no apology)"
mkdir -p .workflow/route3 2>/dev/null || true
echo "ROUTE_DECISION: primary=native reason=codex_and_kimi_quota sol=$sol kimi=$kimi" > .workflow/route3/ROUTE_LAST.txt 2>/dev/null || true
exit 0
