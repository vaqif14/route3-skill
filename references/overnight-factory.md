# Overnight ↔ factory bridge

When `FACTORY: class=factory`, overnight queue items **must** carry `factory_run_id`.

## Rules

1. **Human `PLAN_APPROVAL`** before the overnight window only (freeze plan at queue time).
2. Mid-loop: **no** human stage gates. Stages stay VALIDATED-by-script.
3. On `invalidate-stale` STALE → pause item `status=paused_for_morning` (do not auto-rebuild scope).
4. Morning report: slice terminal states + lessons recorded overnight (`LESSONS.jsonl` / TRACE).

## Scripts

```bash
scripts/init-run.sh --path factory --overnight-item ITEM_ID
scripts/link-overnight.sh --run RUN_ID --item ITEM_ID
scripts/invalidate-stale.sh --run RUN_ID
```

`link-overnight.sh` patches `.workflow/night-shift/QUEUE.json` when present;
else writes `.workflow/night-shift/links/$ITEM_ID` → `run_id`.

See `cli-backends.md` § Overnight queue.
