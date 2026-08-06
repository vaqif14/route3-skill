#!/usr/bin/env bash
# Ensure PLAN ROUTE_DECISION was produced by route-slice.sh (not invented).
# Compares primary= in PLAN to last ROUTE_DECISION from cache/log if present.
set -euo pipefail
PLAN="${1:-.workflow/route3/PLAN.md}"
CACHE="${2:-.workflow/route3/CLI_PROBE.txt}"
LOG="${3:-.workflow/route3/ROUTE_LAST.txt}"

if [[ ! -f "$PLAN" ]]; then
  echo "ASSERT FAIL: PLAN missing"
  exit 1
fi

primary=$(grep -Eo 'ROUTE_DECISION:.*primary=(codex|kimi|native)' "$PLAN" | tail -1 | grep -Eo 'primary=(codex|kimi|native)' | cut -d= -f2 || true)
if [[ -z "$primary" ]]; then
  echo "ASSERT FAIL: no ROUTE_DECISION primary in PLAN — run route-slice.sh"
  exit 1
fi

if [[ -f "$LOG" ]]; then
  logp=$(grep -Eo 'primary=(codex|kimi|native)' "$LOG" | tail -1 | cut -d= -f2 || true)
  if [[ -n "$logp" && "$logp" != "$primary" ]]; then
    echo "ASSERT FAIL: PLAN primary=$primary but route-slice log primary=$logp"
    exit 1
  fi
fi

echo "ASSERT OK: primary=$primary"
exit 0
