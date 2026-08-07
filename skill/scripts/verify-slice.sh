#!/usr/bin/env bash
# Run BRIEF verify: commands; write generated VERIFY.md evidence.
# Usage: verify-slice.sh --run RUN_ID --slice NNN
# Exit 0 all pass | 1 fail | 2 bad args
set -euo pipefail

RUN_ID=""; SLICE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --run) RUN_ID="$2"; shift 2 ;;
    --slice) SLICE="$2"; shift 2 ;;
    -*) echo "unknown flag: $1" >&2; exit 2 ;;
    *) echo "unexpected: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$RUN_ID" && -n "$SLICE" ]] || { echo "need --run and --slice" >&2; exit 2; }

RUN_DIR=".workflow/route3/runs/$RUN_ID"
BRIEF="$RUN_DIR/slices/$SLICE/BRIEF.md"
OUT="$RUN_DIR/slices/$SLICE/VERIFY.md"
STATE="$RUN_DIR/STATE.json"
[[ -f "$BRIEF" ]] || { echo "missing BRIEF" >&2; exit 1; }

# Extract verify commands (yaml-ish list under verify:)
CMDS=()
while IFS= read -r _cmd || [[ -n "$_cmd" ]]; do
  [[ -n "$_cmd" ]] && CMDS+=("$_cmd")
done < <(python3 - "$BRIEF" <<'PY'
import re, sys
lines = open(sys.argv[1], encoding="utf-8").read().splitlines()
in_v = False
for line in lines:
    if re.match(r"^\s*verify\s*:", line):
        in_v = True
        continue
    if in_v:
        m = re.match(r"^\s*-\s*(.*)$", line)
        if m and line.strip().startswith("-"):
            cmd = m.group(1).strip()
            if len(cmd) >= 2 and ((cmd[0] == chr(34) and cmd[-1] == chr(34)) or (cmd[0] == chr(39) and cmd[-1] == chr(39))):
                cmd = cmd[1:-1]
            if cmd:
                print(cmd)
        elif re.match(r"^\S", line) or (line.strip() and not line.strip().startswith("-") and ":" in line and not line.strip().startswith("#")):
            if re.match(r"^\s*[a-z_]+\s*:", line):
                break
PY
)


if [[ ${#CMDS[@]} -eq 0 ]]; then
  echo "verify-slice FAIL: no verify: commands in BRIEF" >&2
  exit 1
fi

# Allowlist prefixes (min effort safety)
ALLOW_RE='^(npm |npx |pnpm |yarn |node |python3 |pytest |vitest |cargo |go test|dotnet |make |bundle exec |tsc|eslint)'

BASE_SHA=$(git rev-parse HEAD 2>/dev/null || echo unknown)
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
PASS=0; FAIL=0

{
  echo "# VERIFY — generated evidence (not builder prose)"
  echo "run: $RUN_ID"
  echo "slice: $SLICE"
  echo "at: $TS"
  echo "base_sha: $BASE_SHA"
  echo
} > "$OUT.tmp"

for cmd in "${CMDS[@]}"; do
  if ! [[ "$cmd" =~ $ALLOW_RE ]]; then
    echo "BLOCKED_CMD: $cmd (not allowlisted)" >> "$OUT.tmp"
    FAIL=$((FAIL+1))
    continue
  fi
  echo "## CMD: $cmd" >> "$OUT.tmp"
  start=$(date +%s)
  set +e
  # capture limited output
  out=$(bash -lc "$cmd" 2>&1 | tail -n 40)
  code=$?
  set -e
  end=$(date +%s)
  echo "exit: $code" >> "$OUT.tmp"
  echo "duration_s: $((end-start))" >> "$OUT.tmp"
  echo '```' >> "$OUT.tmp"
  printf '%s\n' "$out" >> "$OUT.tmp"
  echo '```' >> "$OUT.tmp"
  echo >> "$OUT.tmp"
  if [[ "$code" -eq 0 ]]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi
done

HEAD_SHA=$(git rev-parse HEAD 2>/dev/null || echo unknown)
{
  echo "## SUMMARY"
  echo "passed: $PASS"
  echo "failed: $FAIL"
  echo "head_sha: $HEAD_SHA"
  if [[ "$FAIL" -eq 0 ]]; then echo "VERIFY_STATUS: PASS"; else echo "VERIFY_STATUS: FAIL"; fi
} >> "$OUT.tmp"
mv "$OUT.tmp" "$OUT"

DIGEST=$(shasum -a 256 "$OUT" | awk '{print $1}')
python3 - "$STATE" "$SLICE" "$DIGEST" "$FAIL" <<'PY'
import json, os, sys, datetime
state_path, slice_id, digest, fail = sys.argv[1:5]
s = json.load(open(state_path, encoding="utf-8"))
sl = s.setdefault("slices", {}).setdefault(slice_id, {})
sl["verify_digest"] = digest
sl["state"] = "verified" if fail == "0" else "blocked"
s["updated_at"] = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
tmp = state_path + ".tmp"
with open(tmp, "w", encoding="utf-8") as f:
    json.dump(s, f, indent=2); f.write("\n")
os.replace(tmp, state_path)
PY

echo "VERIFY written: $OUT (pass=$PASS fail=$FAIL)"
[[ "$FAIL" -eq 0 ]]
