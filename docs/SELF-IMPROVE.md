# Self-improve (mandatory, evidence-bound)

Lessons are **data**, not mid-task skill rewrites. Boss may record and rollback lessons; changing `SKILL.md` or references from a lesson needs **user or eval gate**.

Agents must self-develop correctly — **not in fake form**. Loop engineering: external verify + maker ≠ checker + evidence-bound lessons.

## Real vs Fake

| Real (counts) | Fake (theater — rejected / ignored) |
|---|---|
| `quality=bound` with VERIFY.md / digest evidence | Fluff title/reason (`test`, `oops`, `lgtm`, `i learned`, …) |
| Durable reason ≥ 40 chars (failure + durable fix direction) | Short / empty reason (unless smoke + `--allow-unbound`) |
| JSONL with `run_id` + `evidence_path` / digests | PLAN text alone containing `LESSON_RECORDED` |
| Factory accepts **bound** lessons only | Unbound, missing `quality`, or `rolled_back` |
| External verify artifact attached | Self-score “looks good” with no file |

## Why mandatory

Without a closed loop, the same verify/review failures repeat across overnight and multi-slice runs. Factory done **fails closed** when a slice is blocked or VERIFY FAILs without an **evidence-bound** lesson. Standard/full mode warns when a bound lesson is missing.

## Five loop blocks

1. **Act** — builder changes under BRIEF / ownership
2. **External verify** — `verify-slice.sh` (not the maker grading itself)
3. **Evidence** — VERIFY.md + digests (auto-attach with `--run` + `--slice`)
4. **Lesson** — `record-lesson.sh` durable title/reason; `quality=bound` when digests exist
5. **Inject / gate** — context-pack active lessons; factory done requires bound lesson on FAIL/blocked

## When to record

After any of:

1. `verify-slice.sh` → `VERIFY_STATUS: FAIL` (auto-called by verify-slice with durable reason + `--after`)
2. Reviewer verdict `FIX` or `REJECT`
3. Boss `BUILD_PROOF` fail / gates red

```bash
scripts/record-lesson.sh --title "…" --reason "…" \
  [--run ID] [--slice N] [--before FILE] [--after FILE] \
  [--evidence FILE] [--allow-unbound] [--tag TAG]
# → LESSON_RECORDED: id=… quality=bound|unbound
```

### Evidence-bound rules

- `quality=bound` if `after_digest` or evidence digest exists; else `unbound`.
- Unbound rejected unless `--allow-unbound`.
- Fluff title/reason rejected unless `--allow-unbound` **and** `--tag smoke`.
- Reason must be ≥ 40 characters unless smoke + `--allow-unbound`.
- With `--run` + `--slice`, existing `slices/<N>/VERIFY.md` is auto-attached as evidence.

## Storage paths

| Path | Role |
|---|---|
| `.workflow/route3/lessons/LESSONS.jsonl` | Append-only machine log (`quality`, `evidence_path`, `status=active\|rolled_back`) |
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

Ignore memanto failures. **JSONL is source of truth** for Route3 done gates. TRACE events include `quality`.

## Done-gate coupling

| Mode | Behavior |
|---|---|
| `full` (standard) | VERIFY FAIL without **bound** lesson → **warn** |
| `factory` | VERIFY FAIL / blocked slice → **NOT DONE** unless JSONL has matching `run_id` + `quality=="bound"` + not `rolled_back`. Missing `quality` = unbound = reject. **PLAN-only `LESSON_RECORDED` is insufficient.** |

`check-plan-done.sh --factory --run ID` enforces the factory rules after stale checks.

## What NOT to do

- **Silent skill rewrite** from a lesson mid-task (no auto-edit of `SKILL.md` / references)
- Treating memanto as authoritative over JSONL
- Skipping `record-lesson.sh` because “we’ll remember in chat”
- Recording fluff / self-score theater without evidence
- Claiming factory done with PLAN-only `LESSON_RECORDED` or unbound lessons
- Using lessons to invent new APPROVED gates or bypass preflight
- Deleting JSONL entries instead of `lesson-rollback.sh`

Propose skill text changes separately for user/eval approval. See `skill/references/self-improve.md`.
