#!/usr/bin/env bash
# Fail if OWNERSHIP writer globs overlap (path-prefix check).
# macOS Bash 3.2 compatible; no glob expansion on ** paths.
set -euo pipefail

PLAN="${1:-}"
if [[ -z "$PLAN" ]]; then
  for c in PLAN.md .workflow/PLAN.md .workflow/route3/PLAN.md; do
    if [[ -f "$c" ]]; then PLAN="$c"; break; fi
  done
fi
if [[ -z "${PLAN}" || ! -f "$PLAN" ]]; then
  echo "OWNERSHIP FAIL: PLAN not found"
  exit 1
fi

if ! grep -Eq '^OWNERSHIP:' "$PLAN"; then
  echo "OWNERSHIP WARN: no OWNERSHIP block (ok for single writer)"
  exit 0
fi

TMP=$(mktemp)
awk '
  /^OWNERSHIP:/ {p=1; next}
  p && /^[A-Z][A-Z0-9_]+:/ {exit}
  p && NF {print}
' "$PLAN" > "$TMP"

owners=""
paths=""
n=0

while IFS= read -r line || [[ -n "$line" ]]; do
  case "$line" in
    wave=*) continue ;;
  esac
  [[ "$line" != *:* ]] && continue
  agent=$(printf '%s' "${line%%:*}" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
  rest=$(printf '%s' "${line#*:}")
  # split commas without globbing
  set -f
  old_ifs=$IFS
  IFS=','
  for g in $rest; do
    g=$(printf '%s' "$g" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    [[ -z "$g" ]] && continue
    n=$((n + 1))
    eval "owner_$n=\"\$agent\""
    eval "path_$n=\"\$g\""
  done
  IFS=$old_ifs
  set +f
done < "$TMP"
rm -f "$TMP"

overlap=0
i=1
while [[ $i -le $n ]]; do
  j=$((i + 1))
  while [[ $j -le $n ]]; do
    eval "oi=\$owner_$i; oj=\$owner_$j; a=\$path_$i; b=\$path_$j"
    if [[ "$oi" != "$oj" ]]; then
      a2=$(printf '%s' "$a" | sed 's/\*//g' | sed 's:/*$::')
      b2=$(printf '%s' "$b" | sed 's/\*//g' | sed 's:/*$::')
      if [[ -n "$a2" && -n "$b2" ]]; then
        if [[ "$a2" == "$b2" || "$a2" == "$b2"/* || "$b2" == "$a2"/* || "$a" == "$b" ]]; then
          echo "OWNERSHIP FAIL: overlap '$oi:$a' vs '$oj:$b'"
          overlap=1
        fi
      fi
    fi
    j=$((j + 1))
  done
  i=$((i + 1))
done

if [[ "$overlap" -ne 0 ]]; then
  exit 1
fi
echo "OWNERSHIP OK: $PLAN ($n path entries)"
exit 0
