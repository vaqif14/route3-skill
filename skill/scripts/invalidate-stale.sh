#!/usr/bin/env bash
# Recompute artifact digests; mark STALE on mismatch.
# Usage: invalidate-stale.sh --run RUN_ID
# Exit 0 clean | 1 any STALE | 2 bad args
set -euo pipefail

RUN_ID=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --run) RUN_ID="$2"; shift 2 ;;
    -*) echo "unknown flag: $1" >&2; exit 2 ;;
    *) echo "unexpected: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$RUN_ID" ]] || { echo "need --run RUN_ID" >&2; exit 2; }

RUN_DIR=".workflow/route3/runs/$RUN_ID"
STATE="$RUN_DIR/STATE.json"
TRACE="$RUN_DIR/TRACE.jsonl"
[[ -f "$STATE" ]] || { echo "FAIL: missing $STATE" >&2; exit 1; }

python3 - "$RUN_DIR" "$STATE" "$TRACE" <<'PY'
import hashlib, json, os, sys, datetime

run_dir, state_path, trace_path = sys.argv[1:4]
s = json.load(open(state_path, encoding="utf-8"))
arts = s.setdefault("artifacts", {})
ts = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

KEY_MAP = {
    "research": "01-RESEARCH.md",
    "product": "02-PRODUCT.md",
    "architecture": "03-ARCHITECTURE.md",
    "plan": "05-PLAN.md",
}

def file_digest(path):
    if not os.path.isfile(path):
        return None
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()

stale_keys = []
for key, default_name in KEY_MAP.items():
    meta = arts.setdefault(key, {"path": default_name, "digest": None, "status": "missing"})
    rel = meta.get("path") or default_name
    path = os.path.join(run_dir, rel)
    current = file_digest(path)
    stored = meta.get("digest")
    status = meta.get("status") or "missing"

    if current is None:
        if status == "VALIDATED":
            meta["status"] = "STALE"
            stale_keys.append(key)
        # missing file with no prior digest → leave as-is
        continue

    if stored and stored != current:
        meta["status"] = "STALE"
        meta["digest"] = current  # observe new digest but mark STALE
        stale_keys.append(key)
    elif status == "STALE":
        stale_keys.append(key)

# If any upstream STALE → mark all slices STALE
upstream = [k for k in ("research", "product", "architecture", "plan") if k in stale_keys or (arts.get(k) or {}).get("status") == "STALE"]
if upstream:
    slices = s.setdefault("slices", {})
    for sid, sl in slices.items():
        sl["state"] = "STALE"
    stale_keys = list(dict.fromkeys(stale_keys + upstream))

s["updated_at"] = ts
tmp = state_path + ".tmp"
with open(tmp, "w", encoding="utf-8") as f:
    json.dump(s, f, indent=2)
    f.write("\n")
os.replace(tmp, state_path)

with open(trace_path, "a", encoding="utf-8") as f:
    f.write(json.dumps({
        "at": ts,
        "actor": "invalidate-stale",
        "transition": "stale_check",
        "stale": stale_keys,
        "run_id": s.get("run_id"),
    }) + "\n")

fail_list = [k for k in ("research", "product", "architecture", "plan") if (arts.get(k) or {}).get("status") == "STALE"]
if fail_list:
    print("STALE: " + ",".join(fail_list))
    print("FAIL: invalidate-stale found STALE artifacts")
    sys.exit(1)
print("OK: invalidate-stale clean")
sys.exit(0)
PY
