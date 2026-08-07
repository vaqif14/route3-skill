# Route3 self-improve (mandatory, evidence-bound)

Lessons are **data**, not mid-task skill rewrites. Boss may record/rollback lessons;
changing `SKILL.md` / references from a lesson needs **user or eval gate**.

Aligned with loop engineering: **external verify** + **maker ≠ checker** + **evidence-bound lessons**. Theater (self-score fluff, PLAN-only `LESSON_RECORDED`) does not count.

## Real vs Fake

| Real (counts) | Fake (theater — rejected / ignored) |
|---|---|
| `quality=bound` with VERIFY.md / digest evidence | Title/reason like `test`, `oops`, `lgtm`, `i learned` |
| Durable reason ≥ 40 chars (what failed + what to do) | Reason < 40 chars (unless smoke + `--allow-unbound`) |
| JSONL entry with `run_id` + `evidence_path` / digests | PLAN text alone containing `LESSON_RECORDED` |
| Factory done accepts **bound** lessons only | Unbound lesson, missing `quality`, or `rolled_back` |
| External verify artifact (VERIFY.md) attached | Agent “self-score looks good” with no file |

## Five loop blocks (Kopadze-style)

1. **Act** — builder changes product under BRIEF / ownership
2. **External verify** — `verify-slice.sh` (not the maker grading itself)
3. **Evidence** — VERIFY.md + digests; auto-attached when `--run` + `--slice`
4. **Lesson** — `record-lesson.sh` with durable title/reason; `quality=bound` when digests exist
5. **Inject / gate** — `context-pack.sh` active lessons; factory done requires bound lesson on FAIL/blocked

## When you MUST record

After any of:

1. `verify-slice.sh` → `VERIFY_STATUS: FAIL`
2. Reviewer verdict `FIX` or `REJECT`
3. Boss `BUILD_PROOF` fail / gates red

Call:

```bash
scripts/record-lesson.sh --title "…" --reason "…" [--run ID] [--slice N] \
  [--before FILE] [--after FILE] [--evidence FILE] [--allow-unbound] [--tag TAG]
```

Prints `LESSON_RECORDED: id=… quality=bound|unbound`.

`verify-slice.sh` auto-calls this on FAIL with `--after VERIFY.md` and a durable reason.

### Evidence-bound rules

- Prefer `--after` / `--evidence` (file digest). With `--run` + `--slice`, VERIFY.md is auto-attached when present.
- `quality=bound` if `after_digest` or evidence digest exists; else `unbound`.
- **Reject unbound** unless `--allow-unbound`.
- Reject fluff title/reason (`test|smoke|oops|n/a|todo|fix later|ok|fine|lgtm|self-score|looks good|i learned|agent learned`) unless `--allow-unbound` **and** `--tag smoke`.
- Reject reason &lt; 40 chars unless smoke + `--allow-unbound`.

## Storage

| Path | Role |
|---|---|
| `.workflow/route3/lessons/LESSONS.jsonl` | append-only machine log (`quality`, `evidence_path`, `status=active\|rolled_back`) |
| `.workflow/route3/lessons/<id>.md` | optional BEFORE/AFTER narrative |

Entry shape (example):

```json
{"id":"L-…","at":"2026-08-07T20:00:00Z","title":"…","reason":"…","run_id":"…","slice":"001","before_digest":null,"after_digest":"abc…","evidence_path":".workflow/.../VERIFY.md","quality":"bound","status":"active","tags":["verify-fail"]}
```

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

Ignore memanto failures — JSONL is source of truth. TRACE append includes `quality`.

## Done gates

- **factory:** VERIFY FAIL / blocked slice → require a JSONL lesson with matching `run_id`, `quality=="bound"`, and `status!="rolled_back"`. Missing `quality` = unbound = reject. **PLAN `LESSON_RECORDED` alone is insufficient.** TRACE-only is insufficient.
- **full:** warn if no **bound** lesson after VERIFY FAIL (also warns when any lesson signal is missing).

## Hard rule

Self-improve ≠ boss rewriting the skill mid-task. Persist evidence-bound lessons; propose skill
text changes separately for user/eval approval.
