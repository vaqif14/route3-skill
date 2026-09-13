#!/usr/bin/env bash
# Mandatory backend router for Route3 slices (class-aware).
# Default (code): Kimi → Codex → Gemini → z.ai → native.
# Design:         Gemini → Kimi → Codex → z.ai → native.
# Planning/talk:  z.ai → Kimi → Codex → Gemini → native.
#
# Usage:
#   route-slice.sh [--probe] [--class code|design|planning|discussion]
#                  [--cache FILE] [--run RUN_ID] [--slice NNN] [--ttl SECONDS]
# Exit: 0 route ok | 1 probe/cache failure | 2 bad args
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROBE="$ROOT/scripts/probe-backends.sh"
DO_PROBE=0
CACHE=""
RUN_ID=""
SLICE=""
TTL="${ROUTE3_PROBE_TTL:-900}"
CLASS="${ROUTE3_SLICE_CLASS:-code}"

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
    --class)
      [[ $# -ge 2 ]] || { echo "missing value for --class" >&2; exit 2; }
      CLASS="$2"; shift 2 ;;
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

case "$CLASS" in
  code|coding|build|default|"") CLASS=code ;;
  design|ui|ux|visual) CLASS=design ;;
  planning|plan|feature|product) CLASS=planning ;;
  discussion|debate|discuss|agent) CLASS=discussion ;;
  *)
    echo "route-slice: unknown --class $CLASS (use code|design|planning|discussion)" >&2
    exit 2 ;;
esac

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
    echo "zai=MISSING"
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

sol=$(grep -E "^sol=" "$CACHE" 2>/dev/null | head -1 | cut -d= -f2 || echo BLOCKED)
kimi=$(grep -E "^kimi=" "$CACHE" 2>/dev/null | head -1 | cut -d= -f2 || echo BLOCKED)
zai=$(grep -E "^zai=" "$CACHE" 2>/dev/null | head -1 | cut -d= -f2 || echo BLOCKED)
gemini=$(grep -E "^gemini=" "$CACHE" 2>/dev/null | head -1 | cut -d= -f2 || echo BLOCKED)

if [[ -z "$sol" || -z "$kimi" ]]; then
  echo "route-slice FAIL: malformed probe cache ($CACHE)" >&2
  exit 1
fi
[[ -z "$zai" ]] && zai=BLOCKED
[[ -z "$gemini" ]] && gemini=BLOCKED

ROUTE_LOG=".workflow/route3/ROUTE_LAST.txt"
TOKEN_FILE=".workflow/route3/DISPATCH_TOKEN"
ACK_FILE=".workflow/route3/WRITER_ACK.md"
if [[ -n "$RUN_DIR" ]]; then
  ROUTE_LOG="$RUN_DIR/ROUTE_LAST.txt"
  TOKEN_FILE="$RUN_DIR/DISPATCH_TOKEN"
  ACK_FILE="$RUN_DIR/WRITER_ACK.md"
  mkdir -p "$RUN_DIR"
else
  mkdir -p .workflow/route3 2>/dev/null || true
fi

# Dispatch token: unforgeable-by-omission evidence handle. The writer must echo
# it back in a WRITER_ACK line; the boss alone cannot satisfy the gate because
# assert-dispatch-evidence.sh rejects boss-authored acks.
new_token() {
  local rnd
  rnd=$(head -c 8 /dev/urandom 2>/dev/null | xxd -p 2>/dev/null | tr -d '\n' || true)
  [[ -n "$rnd" ]] || rnd=$(date +%s)$$
  echo "r3-$(date -u +%Y%m%dT%H%M%SZ)-$rnd"
}

emit() {
  local primary="$1" reason="$2" build="$3"
  local line="ROUTE_DECISION: primary=$primary reason=$reason class=$CLASS sol=$sol kimi=$kimi zai=$zai gemini=$gemini"
  [[ -n "$RUN_ID" ]] && line+=" run=$RUN_ID"
  [[ -n "$SLICE" ]] && line+=" slice=$SLICE"
  echo "$line"
  echo "BUILD_WITH: $build"

  local token
  token=$(new_token)
  printf '%s\n' "$token" > "$TOKEN_FILE"
  echo "DISPATCH_TOKEN: $token file=$TOKEN_FILE"
  echo "WRITER_ACK_REQUIRED: writer appends to $ACK_FILE →"
  echo "  WRITER_ACK: agent=<writer-name> token=$token at=<ISO8601>"

  case "$primary" in
    codex)
      echo "BOSS_MUST: invoke BUILD_WITH then log BUILDER_DISPATCH: primary=codex via=codex-exec — never self-write"
      ;;
    kimi)
      echo "BOSS_MUST: invoke BUILD_WITH then log BUILDER_DISPATCH: primary=kimi via=kimi-cli — never self-write"
      ;;
    zai)
      echo "BOSS_MUST: invoke BUILD_WITH then log BUILDER_DISPATCH: primary=zai via=zai-cli — never self-write"
      ;;
    gemini)
      echo "BOSS_MUST: invoke BUILD_WITH then log BUILDER_DISPATCH: primary=gemini via=gemini-cli — never self-write"
      ;;
    native)
      echo "BOSS_MUST: dispatch Task|Agent route3-* then log BUILDER_DISPATCH: primary=native via=task|agent agents=route3-… — NEVER boss-write"
      ;;
  esac
  echo "$line" > "$ROUTE_LOG"
}

# Model ids are configurable (portability): override via env or project profile.
CODEX_MODEL="${ROUTE3_CODEX_MODEL:-gpt-5.6-sol}"
KIMI_MODEL="${ROUTE3_KIMI_MODEL:-kimi-code/k3}"
ZAI_MODEL="${ROUTE3_ZAI_MODEL:-glm-5.3}"
GEMINI_MODEL="${ROUTE3_GEMINI_MODEL:-gemini-3-flash-preview}"

zai_build_cmd() {
  if command -v lazyglm >/dev/null 2>&1; then
    echo "lazyglm -p \"…\" </dev/null"
  elif command -v hermes >/dev/null 2>&1 && [[ -n "${ZAI_API_KEY:-}" ]]; then
    echo "hermes -z \"…\" --provider zai -m $ZAI_MODEL --yolo --cli"
  elif command -v zai-cli >/dev/null 2>&1; then
    echo "zai-cli chat \"…\""
  elif command -v zai >/dev/null 2>&1; then
    echo "zai chat \"…\""
  else
    echo "zai-cli chat \"…\""
  fi
}

codex_build_cmd() {
  echo "codex exec --model $CODEX_MODEL -s workspace-write -c model_reasoning_effort=high --skip-git-repo-check"
}

kimi_build_cmd() {
  echo "kimi -m $KIMI_MODEL -p \"…\" </dev/null"
}

gemini_build_cmd() {
  echo "env -u GEMINI_API_KEY -u GOOGLE_API_KEY -u GOOGLE_GENAI_API_KEY gemini -m $GEMINI_MODEL -y -p \"…\""
}

# Try backends in order. First GREEN wins. Boss must invoke that primary.
try_rungs() {
  local name
  for name in "$@"; do
    case "$name" in
      kimi)
        if [[ "$kimi" == "GREEN" ]]; then
          emit kimi "class_${CLASS}_kimi" "$(kimi_build_cmd)"
          exit 0
        fi
        ;;
      codex)
        if [[ "$sol" == "GREEN" ]]; then
          emit codex "class_${CLASS}_codex_second" "$(codex_build_cmd)"
          exit 0
        fi
        ;;
      zai)
        if [[ "$zai" == "GREEN" ]]; then
          emit zai "class_${CLASS}_zai" "$(zai_build_cmd)"
          exit 0
        fi
        ;;
      gemini)
        if [[ "$gemini" == "GREEN" ]]; then
          emit gemini "class_${CLASS}_gemini" "$(gemini_build_cmd)"
          exit 0
        fi
        ;;
    esac
  done
}

case "$CLASS" in
  design)
    try_rungs gemini kimi codex zai
    ;;
  planning|discussion)
    try_rungs zai kimi codex gemini
    ;;
  *)
    try_rungs kimi codex gemini zai
    ;;
esac

emit native all_cli_quota \
  'Cursor Task / Claude Agent → route3-* experts (identical AC; no apology)'
exit 0
