#!/usr/bin/env bash
# Opt-in installer: wire Route3 enforcement hooks into a settings.json.
#
#   install-hooks.sh --settings <path> [--uninstall]
#
# Idempotent. Merges a PreToolUse guard (Edit|Write|MultiEdit|NotebookEdit) and
# a Stop guard. Requires jq. Prints the resulting hooks block for verification.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
GUARD_WRITE="$HERE/guard-boss-write.sh"
GUARD_DONE="$HERE/guard-done.sh"

SETTINGS=""
UNINSTALL=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --settings) SETTINGS="$2"; shift 2 ;;
    --uninstall) UNINSTALL=1; shift ;;
    -h|--help) sed -n '2,7p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$SETTINGS" ]] || { echo "need --settings <path>" >&2; exit 2; }
command -v jq >/dev/null || { echo "jq required" >&2; exit 2; }
chmod +x "$GUARD_WRITE" "$GUARD_DONE" "$HERE/lib.sh" 2>/dev/null || true

[[ -f "$SETTINGS" ]] || echo '{}' > "$SETTINGS"
TMP="$(mktemp)"

if [[ "$UNINSTALL" -eq 1 ]]; then
  jq --arg gw "$GUARD_WRITE" --arg gd "$GUARD_DONE" '
    (.hooks.PreToolUse //= []) |
    (.hooks.Stop //= []) |
    .hooks.PreToolUse |= map(select((.hooks // []) | any(.command == $gw) | not)) |
    .hooks.Stop       |= map(select((.hooks // []) | any(.command == $gd) | not))
  ' "$SETTINGS" > "$TMP" && mv "$TMP" "$SETTINGS"
  echo "uninstalled route3 hooks from $SETTINGS"
  jq '.hooks' "$SETTINGS"
  exit 0
fi

jq --arg gw "$GUARD_WRITE" --arg gd "$GUARD_DONE" '
  .hooks //= {} |
  .hooks.PreToolUse //= [] |
  .hooks.Stop //= [] |
  # drop any prior copy (idempotent)
  .hooks.PreToolUse |= map(select((.hooks // []) | any(.command == $gw) | not)) |
  .hooks.Stop       |= map(select((.hooks // []) | any(.command == $gd) | not)) |
  .hooks.PreToolUse += [{
    "matcher": "Edit|Write|MultiEdit|NotebookEdit",
    "hooks": [{"type":"command","command":$gw}]
  }] |
  .hooks.Stop += [{
    "hooks": [{"type":"command","command":$gd}]
  }]
' "$SETTINGS" > "$TMP" && mv "$TMP" "$SETTINGS"

echo "installed route3 hooks into $SETTINGS"
jq '.hooks' "$SETTINGS"
