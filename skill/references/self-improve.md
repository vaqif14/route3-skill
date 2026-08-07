# Route3 self-improve (mandatory)

Lessons are **data**, not mid-task skill rewrites. Boss may record/rollback lessons;
changing `SKILL.md` / references from a lesson needs **user or eval gate**.

## When you MUST record

After any of:

1. `verify-slice.sh` → `VERIFY_STATUS: FAIL`
2. Reviewer verdict `FIX` or `REJECT`
3. Boss `BUILD_PROOF` fail / gates red

Call:

```bash
scripts/record-lesson.sh --title "…" --reason "…" [--run ID] [--slice N] \
  [--before FILE] [--after FILE] [--tag TAG]
```

Prints `LESSON_RECORDED: id=…`. `verify-slice.sh` auto-calls this on FAIL.

## Storage

| Path | Role |
|---|---|
| `.workflow/route3/lessons/LESSONS.jsonl` | append-only machine log (`status=active\|rolled_back`) |
| `.workflow/route3/lessons/<id>.md` | optional BEFORE/AFTER narrative |

## Injection

`context-pack.sh` appends **ACTIVE LESSONS (last 5)** from JSONL (`status=active`).

## Rollback

```bash
scripts/lesson-rollback.sh --id ID
scripts/lesson-list.sh
```

## MEMANTO

If `memanto` is on `PATH`, `record-lesson.sh` also runs:

`memanto remember … --type learning --confidence 0.9 --provenance observed --source route3-self-improve`

Ignore memanto failures — JSONL is source of truth.

## Done gates

- **full / factory:** VERIFY FAIL this run without `LESSON_RECORDED` → warn (full) or NOT DONE (factory).
- **factory:** any slice `blocked` → require at least one lesson attempt for that `run_id`.

## Hard rule

Self-improve ≠ boss rewriting the skill mid-task. Persist lessons; propose skill
text changes separately for user/eval approval.
