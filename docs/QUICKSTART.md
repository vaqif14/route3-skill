# Quickstart

## Install

```bash
npm install -g github:vaqif14/route3-skill
route3-skill install --all
```

Requires Node ≥ 18. Installs skill + `route3-*` agents into Claude Code and Cursor homes.

Verify: in chat, `/route3` should resolve the skill. Scripts live under the installed skill’s `scripts/` directory (or repo `skill/scripts/` when developing).

## First `/route3` task (standard)

1. In Claude Code or Cursor:

   ```text
   /route3 add empty-state to student certificates list
   ```

2. Answer clarify questions (scope, UX, data, auth, edges, AC). Boss packages Goal/AC.
3. Confirm the plan (`PLAN_APPROVAL` when asked).
4. Boss runs:

   ```bash
   scripts/check-preflight.sh PLAN.md
   scripts/classify-risk.sh --write PLAN.md   # usually → standard
   scripts/route-slice.sh …
   scripts/assert-build-route.sh
   # BUILD via Codex | Kimi | Task/Agent route3-*
   scripts/assert-build-route.sh --require-dispatch
   scripts/check-plan-done.sh
   ```

5. You get a short done report — not an MVP stub.

Default path is **standard**. No `.workflow/route3/runs/` required.

## When factory triggers

`classify-risk.sh` (or `check-preflight.sh … --classify`) sets:

```text
FACTORY: class=factory reason=…
RISK_SIGNALS: …
```

Factory when PLAN text hits high-risk / multi-slice signals, including:

`auth`, `2fa`, `payment`, `pii`, `refund`, `rbac`, `tenant`, `migration`, `prisma schema`, `multi-slice`, `slices:N≥2`, `security`, `production`

Otherwise `standard`. `trivial` only with `SKIPPED_TRIVIAL` + `TRIVIAL_REASON` and no high-risk tokens. Fail closed toward safer.

## Minimal factory command sequence

```bash
# After clarify + PLAN_APPROVAL
scripts/classify-risk.sh --write PLAN.md

scripts/init-run.sh --path factory --plan PLAN.md
# → RUN_ID=… RUN_DIR=.workflow/route3/runs/…

scripts/check-stage.sh --run "$RUN_ID" product
scripts/check-stage.sh --run "$RUN_ID" architecture
scripts/check-stage.sh --run "$RUN_ID" plan

# Per slice (NNN = 001, …)
# write slices/NNN/BRIEF.md first
scripts/context-pack.sh --run "$RUN_ID" --slice 001
scripts/route-slice.sh …
scripts/assert-build-route.sh
# BUILD …
scripts/verify-slice.sh --run "$RUN_ID" --slice 001
# on FAIL: record-lesson.sh (often auto from verify-slice)

scripts/invalidate-stale.sh --run "$RUN_ID"
scripts/check-plan-done.sh --factory --run "$RUN_ID"
```

Details: [FACTORY.md](FACTORY.md).

## Overnight note

When `FACTORY: class=factory`, overnight queue items must carry `factory_run_id`.

- Human `PLAN_APPROVAL` **before** the overnight window only.
- Mid-loop: no human stage gates (VALIDATED scripts only).
- STALE from `invalidate-stale` → pause item for morning; do not auto-rebuild scope.

```bash
scripts/init-run.sh --path factory --overnight-item ITEM_ID
scripts/link-overnight.sh --run "$RUN_ID" --item ITEM_ID
```

See `skill/references/overnight-factory.md`.

## Troubleshooting common FAIL

| Symptom | Likely cause | Fix |
|---|---|---|
| `check-preflight.sh` exit 1 | Clarify incomplete (`open_branches`, coverage, AC) | Finish clarify rounds; do not BUILD |
| `assert-build-route.sh` FAIL | Boss self-wrote or missing route | Dispatch Codex/Kimi/`route3-*`; never main-thread product edits |
| `assert-build-route.sh --require-dispatch` FAIL | No `BUILDER_DISPATCH:` in PLAN | Log dispatch after real builder invoke |
| `verify-slice.sh` FAIL | BRIEF verify command red | Fix AC; lesson auto-recorded; re-run verify |
| Factory done: lesson missing | VERIFY FAIL / blocked slice without `LESSON_RECORDED` | `scripts/record-lesson.sh --title … --reason … --run ID` |
| `invalidate-stale.sh` / factory done STALE | Upstream artifact edited after digest freeze | Re-run affected `check-stage.sh`; refresh slice BRIEF |
| `classify-risk` → factory but no run | Forgot `init-run.sh` | Init run, or stay on standard until ready |
| `check-stage.sh plan` FAIL | Missing anchored `PLAN_APPROVAL:` line | Human must approve before slice BUILD |

More: [ARCHITECTURE.md](ARCHITECTURE.md), [SELF-IMPROVE.md](SELF-IMPROVE.md).
