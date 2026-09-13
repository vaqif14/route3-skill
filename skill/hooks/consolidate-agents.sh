#!/usr/bin/env bash
# Reversible agent consolidation for the route3 family (audit fix #4: sprawl).
# Archives thin/overlapping agents into _deprecated/ instead of deleting them,
# so nothing is lost and every move is undoable.
#
#   consolidate-agents.sh                 # DRY-RUN (default) — list candidates only
#   consolidate-agents.sh --apply         # move candidates into _deprecated/
#   consolidate-agents.sh --restore       # move them back
#   consolidate-agents.sh --dir <path>    # agents dir (default ~/.claude/agents/route3)
#
# Candidates fold into a survivor (their capability becomes a MODE of it):
#   route3-adversarial      -> route3-reviewer      (adversarial = hostile review mode)
#   route3-zero-hallucination-> route3-researcher   (evidence discipline = research mode)
#   route3-handoff          -> route3-docs-writer   (handoff = a doc artifact)
#   route3-pr               -> route3-docs-writer   (PR body = a doc artifact)
#   route3-spec             -> route3-architect      (spec = architect deliverable)
# APPLYING also requires updating SKILL.md "Quick expert map" — printed as a reminder.
set -uo pipefail
DIR="${HOME}/.claude/agents/route3"
MODE="dry"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) MODE="apply"; shift ;;
    --restore) MODE="restore"; shift ;;
    --dir) DIR="$2"; shift 2 ;;
    -h|--help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

CANDIDATES=(route3-adversarial route3-zero-hallucination route3-handoff route3-pr route3-spec)
ARCHIVE="$DIR/_deprecated"

echo "agents dir: $DIR"
echo "mode: $MODE"
echo

if [[ "$MODE" == "restore" ]]; then
  [[ -d "$ARCHIVE" ]] || { echo "nothing to restore (no _deprecated/)"; exit 0; }
  moved=0
  for f in "$ARCHIVE"/*.md; do
    [[ -e "$f" ]] || continue
    mv "$f" "$DIR/$(basename "$f")" && { echo "restored $(basename "$f")"; moved=$((moved+1)); }
  done
  rmdir "$ARCHIVE" 2>/dev/null || true
  echo "restored $moved agent(s)"
  exit 0
fi

count=0
for c in "${CANDIDATES[@]}"; do
  src="$DIR/$c.md"
  if [[ -f "$src" ]]; then
    count=$((count+1))
    if [[ "$MODE" == "apply" ]]; then
      mkdir -p "$ARCHIVE"
      mv "$src" "$ARCHIVE/$c.md"
      echo "archived $c -> _deprecated/"
    else
      echo "WOULD archive $c  ($(wc -l < "$src" | tr -d ' ') lines)"
    fi
  else
    echo "skip $c (not present)"
  fi
done

echo
echo "$count candidate(s)."
if [[ "$MODE" == "dry" ]]; then
  echo "DRY-RUN — no files moved. Re-run with --apply to archive, --restore to undo."
elif [[ "$MODE" == "apply" ]]; then
  echo "REMINDER: remove the archived rows from SKILL.md 'Quick expert map' and"
  echo "fold each capability note into its survivor agent. Undo anytime: --restore."
fi
