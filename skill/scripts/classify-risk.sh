#!/usr/bin/env bash
# Classify PLAN risk path: trivial | standard | factory.
# Usage: classify-risk.sh [--write] [PLAN.md]
#   or:  classify-risk.sh [--write] < stdin
# Exit 0 classification ok | 1 PLAN missing | 2 bad args
set -euo pipefail

WRITE=0
PLAN=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --write) WRITE=1; shift ;;
    -h|--help)
      echo "Usage: classify-risk.sh [--write] [PLAN.md]" >&2
      exit 2 ;;
    -*)
      echo "unknown flag: $1" >&2; exit 2 ;;
    *)
      PLAN="$1"; shift ;;
  esac
done

TEXT=""
if [[ -n "$PLAN" ]]; then
  if [[ ! -f "$PLAN" ]]; then
    echo "classify-risk FAIL: PLAN not found: $PLAN" >&2
    exit 1
  fi
  TEXT=$(cat "$PLAN")
elif [[ ! -t 0 ]]; then
  TEXT=$(cat)
else
  for c in PLAN.md .workflow/PLAN.md .workflow/route3/PLAN.md; do
    if [[ -f "$c" ]]; then PLAN="$c"; TEXT=$(cat "$c"); break; fi
  done
  if [[ -z "$TEXT" ]]; then
    echo "classify-risk FAIL: PLAN not found" >&2
    exit 1
  fi
fi

RESULT=$(FACTORY_TEXT="$TEXT" python3 - <<'PY'
import os, re
text = os.environ.get("FACTORY_TEXT", "")
low = text.lower()
signals = []

def hit(pat, label=None):
    if re.search(pat, text, re.I | re.M):
        signals.append(label or pat)
        return True
    return False

# High-risk / factory tokens (fail closed)
factory_pats = [
    (r'\bauth\b', 'auth'),
    (r'\b2fa\b', '2fa'),
    (r'\bpayment\b', 'payment'),
    (r'\bpii\b', 'pii'),
    (r'\brefund\b', 'refund'),
    (r'\brbac\b', 'rbac'),
    (r'\btenant\b', 'tenant'),
    (r'\bmigration\b', 'migration'),
    (r'prisma\s+schema', 'prisma schema'),
    (r'\bmulti-slice\b', 'multi-slice'),
    (r'slices:\s*[2-9]', 'slices:N'),
    (r'\bsecurity\b', 'security'),
    (r'\bproduction\b', 'production'),
]
high = False
for pat, lab in factory_pats:
    if hit(pat, lab):
        high = True

skipped = bool(re.search(r'status\s*=\s*SKIPPED_TRIVIAL', text, re.I))
has_trivial_reason = bool(re.search(r'^TRIVIAL_REASON\s*:', text, re.M | re.I))

klass = "standard"
reason = "default"

if high:
    klass = "factory"
    reason = "high-risk:" + ",".join(signals[:6])
elif skipped and has_trivial_reason and not high:
    klass = "trivial"
    reason = "SKIPPED_TRIVIAL+TRIVIAL_REASON"
elif skipped and not has_trivial_reason:
    # fail closed — not trivial without reason
    klass = "standard"
    reason = "SKIPPED_TRIVIAL_missing_TRIVIAL_REASON"
    signals.append("missing_TRIVIAL_REASON")
else:
    klass = "standard"
    reason = "default"

sig = ",".join(signals) if signals else "none"
print("CLASS=%s" % klass)
print("REASON=%s" % reason)
print("SIGNALS=%s" % sig)
PY
)

CLASS=$(echo "$RESULT" | sed -n 's/^CLASS=//p')
REASON=$(echo "$RESULT" | sed -n 's/^REASON=//p')
SIGNALS=$(echo "$RESULT" | sed -n 's/^SIGNALS=//p')

echo "FACTORY: class=$CLASS reason=$REASON"
echo "RISK_SIGNALS: $SIGNALS"

if [[ "$WRITE" -eq 1 ]]; then
  if [[ -z "$PLAN" || ! -f "$PLAN" ]]; then
    echo "classify-risk FAIL: --write requires a PLAN file path" >&2
    exit 1
  fi
  LINE="FACTORY: class=$CLASS reason=$REASON"
  python3 - "$PLAN" "$LINE" <<'PY'
import os, re, sys
path, line = sys.argv[1:3]
text = open(path, encoding="utf-8").read()
if re.search(r'^FACTORY:\s*class=', text, re.M):
    text = re.sub(r'^FACTORY:\s*class=.*$', line, text, count=1, flags=re.M)
else:
    if text and not text.endswith("\n"):
        text += "\n"
    text += "\n" + line + "\n"
tmp = path + ".tmp"
with open(tmp, "w", encoding="utf-8") as f:
    f.write(text)
os.replace(tmp, path)
PY
  echo "WRITE_OK: $PLAN"
fi
exit 0
