#!/usr/bin/env bash
# Outcome eval scorer — measures BUILD OUTPUT quality, the gap the audit flagged
# (trigger/route evals only checked whether the skill fires, never whether the
# produced code is correct).
#
# For each case in evals/outcome-evals.json:
#   1. run its `setup` steps in a hermetic temp dir (simulated writer output)
#   2. run every `verify` command
#   3. require every `acceptance` marker to appear in verify output
#   4. compare the observed pass/fail to the case's `expect`
# A case SCORES 1.0 only when observed == expect (so a case that is *meant* to
# fail must actually fail — this proves the scorer discriminates, not rubber-stamps).
#
# Usage: eval-outcome.sh [evals/outcome-evals.json]
# Exit: 0 all cases score == threshold | 1 below threshold | 2 bad input
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
EVALS="${1:-$HERE/../evals/outcome-evals.json}"
[[ -f "$EVALS" ]] || { echo "no evals file: $EVALS" >&2; exit 2; }
command -v python3 >/dev/null || { echo "python3 required" >&2; exit 2; }
command -v node   >/dev/null || { echo "node required for the golden cases" >&2; exit 2; }

N="$(python3 -c 'import json,sys;print(len(json.load(open(sys.argv[1]))["cases"]))' "$EVALS")"
THRESH="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("threshold",1.0))' "$EVALS")"
score_sum=0

for ((i=0; i<N; i++)); do
  id="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["cases"][int(sys.argv[2])]["id"])' "$EVALS" "$i")"
  name="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["cases"][int(sys.argv[2])]["name"])' "$EVALS" "$i")"
  expect="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["cases"][int(sys.argv[2])]["expect"])' "$EVALS" "$i")"

  work="$(mktemp -d)"
  # setup (writer output)
  python3 -c 'import json,sys;[print(s) for s in json.load(open(sys.argv[1]))["cases"][int(sys.argv[2])]["setup"]]' "$EVALS" "$i" \
    | ( cd "$work" && bash -s ) >/dev/null 2>&1

  # verify + acceptance
  observed="pass"; vout=""
  while IFS= read -r cmd; do
    [[ -z "$cmd" ]] && continue
    if ! out="$( cd "$work" && bash -c "$cmd" 2>&1 )"; then observed="fail"; fi
    vout+="$out"$'\n'
  done < <(python3 -c 'import json,sys;[print(c) for c in json.load(open(sys.argv[1]))["cases"][int(sys.argv[2])]["verify"]]' "$EVALS" "$i")

  while IFS= read -r marker; do
    [[ -z "$marker" ]] && continue
    printf '%s' "$vout" | grep -qF "$marker" || observed="fail"
  done < <(python3 -c 'import json,sys;[print(m) for m in json.load(open(sys.argv[1]))["cases"][int(sys.argv[2])].get("acceptance",[])]' "$EVALS" "$i")

  rm -rf "$work"

  if [[ "$observed" == "$expect" ]]; then
    printf '  \033[32mSCORE 1.0\033[0m %-10s %s (observed=%s expect=%s)\n' "$id" "$name" "$observed" "$expect"
    score_sum=$((score_sum+1))
  else
    printf '  \033[31mSCORE 0.0\033[0m %-10s %s (observed=%s expect=%s)\n' "$id" "$name" "$observed" "$expect"
  fi
done

avg="$(python3 -c "print(f'{$score_sum/$N:.3f}')")"
echo
echo "OUTCOME_EVAL: score=$avg cases=$N threshold=$THRESH"
python3 -c "import sys; sys.exit(0 if $score_sum/$N >= $THRESH else 1)"
