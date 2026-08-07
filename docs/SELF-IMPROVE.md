# Self-improve (mandatory)

Lessons are **data**, not mid-task skill rewrites. Boss may record and rollback lessons; changing `SKILL.md` or references from a lesson needs **user or eval gate**.

## Why mandatory

Without a closed loop, the same verify/review failures repeat across overnight and multi-slice runs. Factory done **fails closed** when a slice is blocked or VERIFY FAILs without a lesson attempt. Standard/full mode warns; factory mode treats missing lessons as NOT DONE.

## When to record

After any of:

1. `verify-slice.sh` → `VERIFY_STATUS: FAIL` (auto-called by verify-slice)
2. Reviewer verdict `FIX` or `REJECT`
3. Boss `BUILD_PROOF` fail / gates red

```bash
scripts/record-lesson.sh --title "…" --reason "…" \
  [--run ID] [--slice N] [--before FILE] [--after FILE] [--tag TAG]
# → LESSON_RECORDED: id=…
```

## Storage paths

| Path | Role |
|---|---|
| `.workflow/route3/lessons/LESSONS.jsonl` | Append-only machine log (`status=active\|rolled_back`) |
| `.workflow/route3/lessons/<id>.md` | Optional BEFORE/AFTER narrative |

Injection: `context-pack.sh` appends **ACTIVE LESSONS (last 5)** from JSONL (`status=active`) into `CONTEXT.md`.

## Rollback

```bash
scripts/lesson-list.sh
scripts/lesson-rollback.sh --id ID
```

Rollback sets `status=rolled_back` so the lesson no longer injects into context packs. History remains in JSONL.

## MEMANTO dual-write

If `memanto` is on `PATH`, `record-lesson.sh` also runs:

```bash
memanto remember "<lesson>" --type learning --confidence 0.9 \
  --provenance observed --source route3-self-improve
```

Ignore memanto failures. **JSONL is source of truth** for Route3 done gates.

## Done-gate coupling

| Mode | Behavior |
|---|---|
| `full` (standard) | VERIFY FAIL this run without `LESSON_RECORDED` → **warn** |
| `factory` | VERIFY FAIL without lesson → **NOT DONE**; any slice `blocked` → require ≥1 lesson attempt for that `run_id` |

`check-plan-done.sh --factory --run ID` enforces the factory rules after stale checks.

## What NOT to do

- **Silent skill rewrite** from a lesson mid-task (no auto-edit of `SKILL.md` / references)
- Treating memanto as authoritative over JSONL
- Skipping `record-lesson.sh` because “we’ll remember in chat”
- Using lessons to invent new APPROVED gates or bypass preflight
- Deleting JSONL entries instead of `lesson-rollback.sh`

Propose skill text changes separately for user/eval approval. See `skill/references/self-improve.md`.
