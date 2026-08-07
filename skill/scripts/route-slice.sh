#!/usr/bin/env bash
# Mandatory backend router for Route3 coding slices.
# Order: Codex/Sol → Kimi → native.
#
# Usage:
#   route-slice.sh [--probe] [--cache FILE] [--run RUN_ID] [--slice NNN] [--ttl SECONDS]
# Exit: 0 route ok | 1 probe/cache failure | 2 bad args
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROBE="$ROOT/scripts/probe-backends.sh"
DO_PROBE=0
CACHE=""
RUN_ID=""
SLICE=""
TTL="${ROUTE3_PROBE_TTL:-900}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --probe) DO_PROBE=1; shift ;;
    --cache)
      [[ $# -ge 2 ]] || { echo "missing value for --cache" >&2; exit 2; }
      CACHE="$2"; shift 2 ;;
    --run)
      [[ $# -ge 2 ]] || { echo "missing value for --run" >&2; exit 2; }
      RUN_ID="$2"; shift 2 ;;
    --slice)
      [[ $# -ge 2 ]] || { echo "missing value for --slice" >&2; exit 2; }
      SLICE="$2"; shift 2 ;;
    --ttl)
      [[ $# -ge 2 ]] || { echo "missing value for --ttl" >&2; exit 2; }
      TTL="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,8p' "$0" | sed 's/^# //'
      exit 0 ;;
    -*)
      echo "unknown flag: $1" >&2
      exit 2 ;;
    *)
      echo "unexpected argument: $1 (use --run/--slice flags)" >&2
      exit 2 ;;
  esac
done

if [[ -n "$SLICE" && -z "$RUN_ID" ]]; then
  echo "route-slice: --slice requires --run" >&2
  exit 2
fi

RUN_DIR=""
if [[ -n "$RUN_ID" ]]; then
  RUN_DIR=".workflow/route3/runs/$RUN_ID"
  if [[ ! -d "$RUN_DIR" ]]; then
    echo "route-slice FAIL: run dir missing: $RUN_DIR (run init-run.sh)" >&2
    exit 1
  fi
fi

if [[ -z "$CACHE" ]]; then
  if [[ -n "$RUN_DIR" ]]; then
    CACHE="$RUN_DIR/CLI_PROBE.txt"
  elif [[ -d .workflow/route3 ]]; then
    CACHE=".workflow/route3/CLI_PROBE.txt"
  else
    CACHE="/tmp/route3-CLI_PROBE.txt"
  fi
fi

cache_fresh() {
  [[ -f "$CACHE" ]] || return 1
  local now mtime age
  now=$(date +%s)
  mtime=$(stat -f %m "$CACHE" 2>/dev/null || stat -c %Y "$CACHE" 2>/dev/null || echo 0)
  age=$((now - mtime))
  [[ "$age" -le "$TTL" ]]
}

run_probe() {
  if [[ -x "$PROBE" ]]; then
    "$PROBE"
  else
    echo "CLI_PROBE at=$(date -u +%Y-%m-%dT%H:%M:%SZ) ttl=${TTL}s"
    echo "sol=MISSING"
    echo "kimi=MISSING"
    echo "gemini=MISSING"
  fi
}

mkdir -p "$(dirname "$CACHE")" 2>/dev/null || true

if [[ "$DO_PROBE" -eq 1 ]] || ! cache_fresh; then
  if ! run_probe | tee "$CACHE"; then
    echo "route-slice FAIL: probe failed" >&2
    exit 1
  fi
else
  echo "CLI_PROBE cache_hit=1 age_lt=${TTL}s file=$CACHE"
  cat "$CACHE"
fi

sol=$(grep -E "^sol=" "$CACHE" 2>/dev/null | head -1 | cut -d= -f2 || echo OPEN)
kimi=$(grep -E "^kimi=" "$CACHE" 2>/dev/null | head -1 | cut -d= -f2 || echo OPEN)

if [[ -z "$sol" || -z "$kimi" ]]; then
  echo "route-slice FAIL: malformed probe cache ($CACHE)" >&2
  exit 1
fi

ROUTE_LOG=".workflow/route3/ROUTE_LAST.txt"
if [[ -n "$RUN_DIR" ]]; then
  ROUTE_LOG="$RUN_DIR/ROUTE_LAST.txt"
  mkdir -p "$RUN_DIR"
else
  mkdir -p .workflow/route3 2>/dev/null || true
fi

emit() {
  local primary="$1" reason="$2" build="$3"
  local line="ROUTE_DECISION: primary=$primary reason=$reason sol=$sol kimi=$kimi"
  [[ -n "$RUN_ID" ]] && line+=" run=$RUN_ID"
  [[ -n "$SLICE" ]] && line+=" slice=$SLICE"
  echo "$line"
  echo "BUILD_WITH: $build"
  case "$primary" in
    codex)
      echo "BOSS_MUST: invoke BUILD_WITH then log BUILDER_DISPATCH: primary=codex via=codex-exec — never self-write"
      ;;
    kimi)
      echo "BOSS_MUST: invoke BUILD_WITH then log BUILDER_DISPATCH: primary=kimi via=kimi-cli — never self-write"
      ;;
    native)
      echo "BOSS_MUST: dispatch Task|Agent route3-* then log BUILDER_DISPATCH: primary=native via=task|agent agents=route3-… — NEVER boss-write"
      ;;
  esac
  echo "$line" > "$ROUTE_LOG"
}

if [[ "$sol" == "GREEN" ]]; then
  emit codex mandatory_codex_first \
    'codex exec --model gpt-5.6-sol -s workspace-write -c model_reasoning_effort=high --skip-git-repo-check'
  exit 0
fi

if [[ "$kimi" == "GREEN" ]]; then
  emit kimi codex_quota_or_open \
    'kimi -m kimi-code/k3 -p "…" </dev/null'
  exit 0
fi

emit native codex_and_kimi_quota \
  'Cursor Task / Claude Agent → route3-* experts (identical AC; no apology)'
exit 0
