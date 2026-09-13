#!/usr/bin/env bash
# Hard gate: dispatch must be backed by WRITER-produced evidence, not boss prose.
#
# A BUILDER_DISPATCH: line is self-attestation — the boss types it either way.
# route-slice.sh stamps a random DISPATCH_TOKEN at route time; the writer must
# echo that token back in a WRITER_ACK line as part of returning. The boss
# cannot satisfy this gate alone because boss-authored agent names are rejected.
#
# Mirrors record-lesson.sh evidence binding (references/self-improve.md):
# evidence the claimant could not have produced alone, or the claim is unbound.
#
# Usage:
#   assert-dispatch-evidence.sh [--run RUN_ID] [--token-file FILE] [--ack FILE]
#                               [--plan PLAN.md] [--quiet]
# Exit: 0 evidence bound | 1 missing/unbound evidence | 2 bad args
set -euo pipefail

RUN_ID=""
TOKEN_FILE=""
ACK_FILES=()
PLAN=""
QUIET=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --run)
      [[ $# -ge 2 ]] || { echo "missing value for --run" >&2; exit 2; }
      RUN_ID="$2"; shift 2 ;;
    --token-file)
      [[ $# -ge 2 ]] || { echo "missing value for --token-file" >&2; exit 2; }
      TOKEN_FILE="$2"; shift 2 ;;
    --ack)
      [[ $# -ge 2 ]] || { echo "missing value for --ack" >&2; exit 2; }
      ACK_FILES+=("$2"); shift 2 ;;
    --plan)
      [[ $# -ge 2 ]] || { echo "missing value for --plan" >&2; exit 2; }
      PLAN="$2"; shift 2 ;;
    --quiet) QUIET=1; shift ;;
    -h|--help)
      sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    -*) echo "unknown flag: $1" >&2; exit 2 ;;
    *)  echo "unexpected argument: $1 (use --run/--plan flags)" >&2; exit 2 ;;
  esac
done

say() { [[ "$QUIET" -eq 1 ]] || echo "$@"; }

RUN_DIR=""
[[ -n "$RUN_ID" ]] && RUN_DIR=".workflow/route3/runs/$RUN_ID"

if [[ -z "$TOKEN_FILE" ]]; then
  if [[ -n "$RUN_DIR" && -f "$RUN_DIR/DISPATCH_TOKEN" ]]; then
    TOKEN_FILE="$RUN_DIR/DISPATCH_TOKEN"
  else
    TOKEN_FILE=".workflow/route3/DISPATCH_TOKEN"
  fi
fi

if [[ ! -f "$TOKEN_FILE" ]]; then
  echo "DISPATCH_EVIDENCE FAIL: no $TOKEN_FILE — run route-slice.sh before BUILD"
  exit 1
fi

# Accept a bare token or a "DISPATCH_TOKEN: <tok>" line.
TOKEN=$(grep -Eo 'r3-[A-Za-z0-9]+-[A-Za-z0-9]+' "$TOKEN_FILE" | head -1 || true)
if [[ -z "$TOKEN" ]]; then
  TOKEN=$(head -1 "$TOKEN_FILE" | tr -d '[:space:]')
fi
if [[ -z "$TOKEN" ]]; then
  echo "DISPATCH_EVIDENCE FAIL: $TOKEN_FILE is empty — re-run route-slice.sh"
  exit 1
fi

# Where a writer may leave its ack.
if [[ ${#ACK_FILES[@]} -eq 0 ]]; then
  [[ -n "$RUN_DIR" ]] && ACK_FILES+=("$RUN_DIR/WRITER_ACK.md")
  ACK_FILES+=(".workflow/route3/WRITER_ACK.md")
  [[ -n "$PLAN" ]] && ACK_FILES+=("$PLAN")
  if [[ -n "$RUN_DIR" && -d "$RUN_DIR/slices" ]]; then
    while IFS= read -r f; do
      [[ -n "$f" ]] && ACK_FILES+=("$f")
    done < <(find "$RUN_DIR/slices" -name 'WRITER_ACK.md' 2>/dev/null || true)
  fi
fi

present=0
for f in "${ACK_FILES[@]}"; do
  [[ -f "$f" ]] && present=1
done
if [[ "$present" -eq 0 ]]; then
  echo "DISPATCH_EVIDENCE FAIL: no WRITER_ACK artifact found (looked in: ${ACK_FILES[*]})"
  echo "  the writer must append: WRITER_ACK: agent=<name> token=$TOKEN at=<ISO8601>"
  echo "  see references/dispatch-prompt-contract.md § STOP / RETURN"
  exit 1
fi

# The boss cannot be its own writer. Reject boss-ish agent identities.
BOSS_RE='^(boss|boss-self|self|main|main-thread|orchestrator|route3|route3-boss)$'

matched_agent=""
saw_ack_line=0
for f in "${ACK_FILES[@]}"; do
  [[ -f "$f" ]] || continue
  while IFS= read -r line; do
    saw_ack_line=1
    agent=$(printf '%s' "$line" | grep -Eo 'agent=[^[:space:]]+' | head -1 | cut -d= -f2- || true)
    ltoken=$(printf '%s' "$line" | grep -Eo 'token=[^[:space:]]+' | head -1 | cut -d= -f2- || true)
    [[ "$ltoken" == "$TOKEN" ]] || continue
    if [[ -z "$agent" ]]; then
      say "DISPATCH_EVIDENCE WARN: WRITER_ACK without agent= in $f"
      continue
    fi
    if printf '%s' "$agent" | tr '[:upper:]' '[:lower:]' | grep -Eq "$BOSS_RE"; then
      say "DISPATCH_EVIDENCE WARN: boss-authored ack rejected (agent=$agent) in $f"
      continue
    fi
    matched_agent="$agent"
    break
  done < <(grep -E '^[[:space:]]*WRITER_ACK:' "$f" || true)
  [[ -n "$matched_agent" ]] && break
done

if [[ -z "$matched_agent" ]]; then
  echo "DISPATCH_EVIDENCE FAIL: no WRITER_ACK bound to token=$TOKEN by a non-boss agent"
  if [[ "$saw_ack_line" -eq 1 ]]; then
    echo "  found WRITER_ACK line(s), but token mismatch or agent is the boss"
  fi
  echo "  required: WRITER_ACK: agent=<route3-…|codex|kimi|zai|gemini> token=$TOKEN at=<ISO8601>"
  echo "  a BUILDER_DISPATCH: line alone is self-attestation, not evidence"
  exit 1
fi

echo "DISPATCH_EVIDENCE OK: agent=$matched_agent token=$TOKEN quality=bound"
exit 0
