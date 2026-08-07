#!/usr/bin/env bash
# Link a factory run to an overnight queue item.
# Usage: link-overnight.sh --run RUN_ID --item ITEM_ID
set -euo pipefail

RUN_ID=""; ITEM_ID=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --run) RUN_ID="$2"; shift 2 ;;
    --item) ITEM_ID="$2"; shift 2 ;;
    -*) echo "unknown flag: $1" >&2; exit 2 ;;
    *) echo "unexpected: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$RUN_ID" && -n "$ITEM_ID" ]] || { echo "need --run and --item" >&2; exit 2; }

STATE=".workflow/route3/runs/$RUN_ID/STATE.json"
[[ -f "$STATE" ]] || { echo "FAIL: missing $STATE" >&2; exit 1; }

python3 - "$STATE" "$RUN_ID" "$ITEM_ID" <<'PY'
import json, os, sys, datetime
state_path, run_id, item_id = sys.argv[1:4]
s = json.load(open(state_path, encoding="utf-8"))
s["overnight_item_id"] = item_id
s["updated_at"] = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
tmp = state_path + ".tmp"
with open(tmp, "w", encoding="utf-8") as f:
    json.dump(s, f, indent=2); f.write("\n")
os.replace(tmp, state_path)

queue = ".workflow/night-shift/QUEUE.json"
linked = False
if os.path.isfile(queue):
    try:
        q = json.load(open(queue, encoding="utf-8"))
        items = q if isinstance(q, list) else q.get("items") or q.get("queue") or []
        for it in items:
            iid = it.get("id") or it.get("item_id")
            if str(iid) == str(item_id):
                it["factory_run_id"] = run_id
                linked = True
        tmpq = queue + ".tmp"
        with open(tmpq, "w", encoding="utf-8") as f:
            json.dump(q, f, indent=2); f.write("\n")
        os.replace(tmpq, queue)
    except Exception as e:
        print("WARN: QUEUE.json patch failed: %s" % e, file=sys.stderr)

if not linked:
    link_dir = ".workflow/night-shift/links"
    os.makedirs(link_dir, exist_ok=True)
    link_path = os.path.join(link_dir, str(item_id))
    with open(link_path, "w", encoding="utf-8") as f:
        f.write(run_id + "\n")
    print("LINK_FILE: %s -> %s" % (link_path, run_id))
else:
    print("LINK_QUEUE: item=%s factory_run_id=%s" % (item_id, run_id))
print("OK: overnight link run=%s item=%s" % (run_id, item_id))
PY
exit 0
