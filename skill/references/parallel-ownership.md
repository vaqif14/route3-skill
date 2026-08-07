# Parallel ownership — no cross-talk

Fixes concurrent-expert file corruption. Disjoint ownership is **enforced
in PLAN**, not vibes.

Callers: BUILD dispatch; `scripts/check-ownership.sh`; `build-pipeline.md`.

## Rule

Two writers must never own overlapping path globs in the same slice wave.
Architect/reviewer/docs may read anything; only one **writer** per file path.

## PLAN block

```text
OWNERSHIP:
  wave=1
  route3-api-expert: src/app/api/orders/**, src/features/orders/server/**
  route3-ui-expert: src/features/orders/components/**
  route3-database-expert: prisma/schema.prisma, prisma/migrations/**
```

Before dispatching wave N:

```bash
~/.claude/skills/route3/scripts/check-ownership.sh PLAN.md
```

Exit 1 → fix overlaps; do not dispatch.

## Wave discipline

1. Lock contracts (architect) before parallel writers
2. Wave 1: disjoint experts in parallel
3. Wave 2+: only after wave 1 STATUS COMPLETED + boss check
4. Improver owns FIX paths listed by reviewer — temporary exclusive lock

## Graph discipline

The wave plan is a **graph** of allowed next steps, not a to-do order.

- **Real edge test:** step B may depend on step A **only if B consumes A's
  artifact/data** (contract, schema, generated type, migration). Sequence without
  data flow is a **fake dependency** → put both in the same wave.
- **Diamond naming:** *split* (architect locks contracts / BRIEF) → *parallel work*
  (ownership waves, disjoint globs) → *merge* (boss check + verify-slice + reviewer).
- **Barrier only for true fan-in:** wait for the full set only when the merge step
  genuinely needs everything — dedupe, compare, ship gate. Otherwise run a
  wave/pipeline and let finished writers move on.
- **Worktree only for real concurrency:** `route3-worktree` when parallel writers
  actually write at the same time; same-branch sequential edits do not need one.

## Conflict protocol

If two agents touched the same file anyway:

1. Mark both NEEDS_CLARIFICATION / pause
2. Boss picks single owner; other reverts their hunks on that file
3. Log `OWNERSHIP_VIOLATION:` in PLAN
4. Re-run reviewer on the merged result
