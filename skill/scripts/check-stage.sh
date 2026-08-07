#!/usr/bin/env bash
# Validate a factory stage. Usage:
#   check-stage.sh --run RUN_ID <research|product|architecture|plan|slice> [--slice NNN]
# Exit 0 VALIDATED | 1 FAIL | 2 bad args
set -euo pipefail

RUN_ID=""
STAGE=""
SLICE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --run) RUN_ID="$2"; shift 2 ;;
    --slice) SLICE="$2"; shift 2 ;;
    -*)
      echo "unknown flag: $1" >&2; exit 2 ;;
    *)
      STAGE="$1"; shift ;;
  esac
done

[[ -n "$RUN_ID" && -n "$STAGE" ]] || { echo "usage: check-stage.sh --run ID STAGE" >&2; exit 2; }
RUN_DIR=".workflow/route3/runs/$RUN_ID"
STATE="$RUN_DIR/STATE.json"
[[ -f "$STATE" ]] || { echo "FAIL: missing $STATE" >&2; exit 1; }

digest() {
  if [[ -f "$1" ]]; then
    shasum -a 256 "$1" 2>/dev/null | awk '{print $1}'
  else
    echo ""
  fi
}

fail=()
case "$STAGE" in
  research)
    if [[ -f "$RUN_DIR/01-RESEARCH.md" ]]; then
      grep -Eq 'EVIDENCE:|VERIFIED|REPORTED' "$RUN_DIR/01-RESEARCH.md" || fail+=("research missing EVIDENCE")
      grep -Eqi 'finding|summary|result' "$RUN_DIR/01-RESEARCH.md" || fail+=("research missing findings")
    else
      # allowed skip if STATE.research_skipped
      python3 -c 'import json,sys; s=json.load(open(sys.argv[1])); sys.exit(0 if s.get("research_skipped") else 1)' "$STATE" \
        || fail+=("01-RESEARCH.md missing and research_skipped!=true")
    fi
    ;;
  product)
    if [[ -f "$RUN_DIR/02-PRODUCT.md" ]]; then
      grep -Eiq 'problem' "$RUN_DIR/02-PRODUCT.md" || fail+=("product missing problem")
      grep -Eiq 'scope' "$RUN_DIR/02-PRODUCT.md" || fail+=("product missing scope")
      grep -Eiq 'acceptance|^AC:|\bAC\b' "$RUN_DIR/02-PRODUCT.md" || fail+=("product missing acceptance/AC")
      grep -Eqi 'TBD' "$RUN_DIR/02-PRODUCT.md" && fail+=("product still has TBD")
    else
      PLAN=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("plan_path",""))' "$STATE")
      [[ -f "$PLAN" ]] || PLAN="$RUN_DIR/05-PLAN.md"
      grep -Eq 'PRODUCT:' "$PLAN" || fail+=("PRODUCT: missing in PLAN and no 02-PRODUCT.md")
      grep -Eq '^AC:|acceptance' "$PLAN" || fail+=("AC missing for product stage")
    fi
    # Product verdict gate (factory-contract.md - Product verdict gate):
    # SCRAP/PARK need a human PRODUCT_OVERRIDE line; NEEDS_MORE_INPUT never validates;
    # missing VERDICT warns only (pre-1.4.3 runs stay green).
    VPLAN=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("plan_path",""))' "$STATE")
    [[ -f "$VPLAN" ]] || VPLAN="$RUN_DIR/05-PLAN.md"
    set +e
    verdict_out=$(python3 - "$RUN_DIR/02-PRODUCT.md" "$VPLAN" <<'PYV'
import os, re, sys
text = ""
for path in sys.argv[1:]:
    if path and os.path.isfile(path):
        with open(path, encoding="utf-8") as fh:
            text += fh.read() + "\n"
verdicts = [v.upper() for v in re.findall(r"^[ \t]*VERDICT:[ \t]*([A-Za-z_]+)", text, re.M)]
override = re.search(r"^[ \t]*PRODUCT_OVERRIDE:[ \t]*\S", text, re.M)
if not verdicts:
    print("WARN: product has no VERDICT: line (BUILD|BUILD_SMALLER|PARK|SCRAP|NEEDS_MORE_INPUT)")
    sys.exit(0)
refused = [v for v in verdicts if v in ("SCRAP", "PARK")]
if refused and not override:
    print("product VERDICT: %s refuses build - architecture blocked until a human records "
          "'PRODUCT_OVERRIDE: approved by user at <ISO> reason=...' in PLAN or 02-PRODUCT.md" % refused[0])
    sys.exit(1)
if "NEEDS_MORE_INPUT" in verdicts:
    print("product VERDICT: NEEDS_MORE_INPUT - clarify and re-run product stage (override does not apply)")
    sys.exit(1)
sys.exit(0)
PYV
)
    verdict_rc=$?
    set -e
    if [[ "$verdict_rc" -ne 0 ]]; then
      fail+=("$verdict_out")
    elif [[ -n "$verdict_out" ]]; then
      echo "STAGE $verdict_out"
    fi
    ;;
  architecture)
    [[ -f "$RUN_DIR/03-ARCHITECTURE.md" ]] || fail+=("03-ARCHITECTURE.md missing")
    if [[ -f "$RUN_DIR/03-ARCHITECTURE.md" ]]; then
      grep -Eiq 'contract' "$RUN_DIR/03-ARCHITECTURE.md" || fail+=("architecture missing contract")
      grep -Eiq 'module|service' "$RUN_DIR/03-ARCHITECTURE.md" || fail+=("architecture missing module|service")
      grep -Eiq 'fail|failure' "$RUN_DIR/03-ARCHITECTURE.md" || fail+=("architecture missing fail|failure")
      grep -Eiq 'data|db|schema' "$RUN_DIR/03-ARCHITECTURE.md" || fail+=("architecture missing data|db|schema")
      grep -Eiq 'security' "$RUN_DIR/03-ARCHITECTURE.md" || fail+=("architecture missing security")
    fi
    ;;
  plan)
    PLAN="$RUN_DIR/05-PLAN.md"
    [[ -f "$PLAN" ]] || PLAN=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("plan_path",""))' "$STATE")
    [[ -f "$PLAN" ]] || fail+=("plan file missing")
    if [[ -f "$PLAN" ]]; then
      grep -Eq '^PLAN_APPROVAL: *(approved|continue|yes_to_all)\b' "$PLAN" \
        || fail+=("human PLAN_APPROVAL anchored line missing")
      grep -Eqi 'slice|BRIEF' "$PLAN" || fail+=("plan missing slice list")
    fi
    ;;
  slice)
    [[ -n "$SLICE" ]] || { echo "--slice required for slice stage" >&2; exit 2; }
    BRIEF="$RUN_DIR/slices/$SLICE/BRIEF.md"
    [[ -f "$BRIEF" ]] || fail+=("BRIEF.md missing for slice $SLICE")
    if [[ -f "$BRIEF" ]]; then
      grep -Eq 'goal:|acceptance:|verify:' "$BRIEF" || fail+=("BRIEF missing goal/acceptance/verify")
      grep -Eq 'allowed_files:' "$BRIEF" || fail+=("BRIEF missing allowed_files")
    fi
    ;;
  *)
    echo "unknown stage: $STAGE" >&2; exit 2 ;;
esac

if [[ ${#fail[@]} -gt 0 ]]; then
  echo "STAGE FAIL: $STAGE run=$RUN_ID"
  for f in "${fail[@]}"; do echo "  - $f"; done
  exit 1
fi

# Update STATE digests / status
python3 - "$STATE" "$STAGE" "$RUN_DIR" "$SLICE" <<'PY'
import hashlib, json, os, sys, datetime
state_path, stage, run_dir, slice_id = sys.argv[1:5]
with open(state_path, encoding="utf-8") as f:
    s = json.load(f)

def sha(path):
    if not os.path.isfile(path):
        return None
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()

ts = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
art_map = {
    "research": "01-RESEARCH.md",
    "product": "02-PRODUCT.md",
    "architecture": "03-ARCHITECTURE.md",
    "plan": "05-PLAN.md",
}
if stage in art_map:
    rel = art_map[stage]
    path = os.path.join(run_dir, rel)
    if stage == "research" and s.get("research_skipped") and not os.path.isfile(path):
        s["artifacts"]["research"] = {"path": rel, "digest": None, "status": "VALIDATED"}
    else:
        d = sha(path)
        s["artifacts"][stage] = {"path": rel, "digest": d, "status": "VALIDATED"}
    order = ["init","research","product","architecture","plan","slice","final_verify","done"]
    # advance stage pointer conservatively
    s["stage"] = stage if stage != "plan" else "plan"
elif stage == "slice":
    brief = os.path.join(run_dir, "slices", slice_id, "BRIEF.md")
    d = sha(brief)
    sl = s.setdefault("slices", {}).setdefault(slice_id, {})
    sl["state"] = "ready"
    sl["brief_digest"] = d
    s["stage"] = "slice"

s["updated_at"] = ts
tmp = state_path + ".tmp"
with open(tmp, "w", encoding="utf-8") as f:
    json.dump(s, f, indent=2)
    f.write("\n")
os.replace(tmp, state_path)
trace = os.path.join(run_dir, "TRACE.jsonl")
with open(trace, "a", encoding="utf-8") as f:
    f.write(json.dumps({"at": ts, "actor": "check-stage", "transition": f"VALIDATED:{stage}", "slice": slice_id or None}) + "\n")
print(f"STAGE OK: {stage} VALIDATED run={s['run_id']}")
PY
