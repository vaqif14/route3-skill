# Boss discipline — never self-write (hard)

Callers: `SKILL.md` hard rules #1 / #13; `native-primary.md`; `agents-and-gates.md`;
`scripts/assert-build-route.sh`; `scripts/check-plan-done.sh`.

## Iron law

**Boss orchestrates. Boss does not build.**

On `/route3` Build (and ops/verify slices under Route3):

| Allowed for boss | Forbidden for boss |
|---|---|
| Clarify D1–D11, package PLAN/AC | Edit product `src/` / `prisma/` / app routes |
| Run `check-preflight.sh`, `route-slice.sh`, gate scripts | Implement features/fixes/migrations |
| Write DISPATCH_PROMPT + AGENT_MAP; invoke Codex / Kimi / `route3-*` | "I'll just quickly fix it" in main thread |
| Broker user approval gates | Prod env/DB/deploy **as the writer** (dispatch + supervise) |
| Boss-check diffs, re-run tsc/test/lint; correlate evidence | Skip dispatch because CLI probe said `native` |
| Re-dispatch on BLOCKED / VERIFY FAIL only | Intervene in writer session internals / live-rewrite WIP |
| ≤15-line user report | Apologize and self-code after quota death |

**`primary=native` ≠ boss writes.** It means: dispatch `route3-*` experts
(Cursor **Task** / Claude Code **Agent**) with identical AC.

**Ops/smoke/log-verify under `/route3` is not a boss exception.** Dispatch
`route3-api-expert` / `route3-test-engineer` / shell specialist via Task;
boss only correlates evidence and gates.


## Dispatch prompt (mandatory)

Before every Codex / Kimi / Task|Agent invoke, write a full **DISPATCH_PROMPT**
with **AGENT_MAP** per [`dispatch-prompt-contract.md`](dispatch-prompt-contract.md).

Process: `CLARIFY COMPLETE → AGENT_MAP → DISPATCH_PROMPT → INVOKE → BOSS GATES ONLY`.

Status enum: `EXISTS` | `MISSING_TYPE` | `USE_EXISTING`. Never invent fake agents.
SaaS / no-MVP / ideal-final bar is part of the prompt (`SOLUTION_BAR`).

### Writer-internals boundary

| Allowed | Forbidden |
|---|---|
| Clarify, package, write DISPATCH_PROMPT | Mid-flight rewrite of the writer's WIP / internals |
| Dispatch + log `BUILDER_DISPATCH` | Prompt nudges inside a live writer session |
| Gate scripts (`assert-build-route`, `check-plan-done`, tsc/test) | Boss becoming co-author mid-slice |
| Correlate evidence / review outputs | "Quick fix" edits while writer is running |
| Re-dispatch **new** prompt only on BLOCKED or VERIFY FAIL | Live meddling that muddies ownership |

Boss manages **orchestration only**.

## Dispatch matrix (mandatory)

After `route-slice.sh` prints `ROUTE_DECISION`:

| `primary` | Boss MUST invoke (not simulate) |
|---|---|
| `codex` | `codex exec --model gpt-5.6-sol -s workspace-write -c model_reasoning_effort=high --skip-git-repo-check` with the slice prompt |
| `kimi` | `kimi -m kimi-code/k3 -p "<slice>" </dev/null` |
| `native` | One or more `route3-*` via Task/Agent — never main-thread product edits |

Log in PLAN.md (required before done):

```text
BUILDER_DISPATCH: primary=<codex|kimi|native> via=<codex-exec|kimi-cli|task|agent> agents=<names or -> at=<ISO>
```

Examples:

```text
BUILDER_DISPATCH: primary=kimi via=kimi-cli agents=- at=2026-08-07T12:00:00Z
BUILDER_DISPATCH: primary=native via=task agents=route3-api-expert|EXISTS,route3-ui-expert|USE_EXISTING at=2026-08-07T12:05:00Z
BUILDER_DISPATCH: primary=native via=task agents=route3-api-expert|EXISTS,route3-reviewer|EXISTS at=2026-08-07T12:05:00Z
```

Include an `agent_map` summary on the dispatch line (`name|EXISTS|USE_EXISTING|MISSING_TYPE`).
Full AGENT_MAP + DISPATCH_PROMPT: see **Dispatch prompt (mandatory)** below.

Missing `BUILDER_DISPATCH:` → `check-plan-done.sh` FAIL.

## Host tool mapping

| Host | How to dispatch experts |
|---|---|
| Claude Code | `Agent` tool `subagent_type: "route3-…"`; resume via SendMessage |
| Cursor | `Task` tool `subagent_type: "route3-…"` (same names). Do **not** treat main Composer as the writer |

Docs that say only "Agent tool" also mean Cursor **Task**.

## Failover wording (canonical)

Wrong: "both CLIs dead → continue yourself"  
Right: "both CLIs dead → **dispatch native `route3-*` experts**; boss never becomes the writer"

Quota death never shrinks AC and never licenses boss self-write.

## Tiny exceptions (only)

1. **Trivial** path: PLAN has `status=SKIPPED_TRIVIAL` / `--trivial` done mode
   (typo / ~20-line rename). Still no schema/auth/pay.
2. **Boss-only meta**: edit Route3 skill/PLAN/workflow markers, run gate scripts,
   paste `BUILD_PROOF` / `SLICE_EVAL` after writers finished.
3. **Emergency stop**: revert a broken deploy **after** user `production_change`
   gate — still prefer dispatch; if boss must touch files, log
   `BOSS_EXCEPTION: <reason>` in PLAN and get user ack in the same turn.

## Enforcement scripts

```bash
scripts/route-slice.sh --probe   # before BUILD
scripts/assert-build-route.sh    # after ROUTE_DECISION logged
scripts/assert-build-route.sh --require-dispatch  # before done
scripts/check-plan-done.sh       # requires BUILDER_DISPATCH
```

If assert fails → stop. Fix route/dispatch. Do not self-write to "unblock".


## Factory authority matrix

| Action | Boss | Specialist / script |
|---|---|---|
| `init-run.sh`, gate scripts | yes | — |
| Record observed STATE transitions | yes | check-stage / verify-slice |
| Author PRODUCT / ARCHITECTURE content | **no** | researcher / architect |
| Dispatch Codex/Kimi/Task builders | yes | — |
| Rescue-fix failing verify (edit src to green) | **no** | dispatch improver / builder |
| Write reviewer verdict | **no** | route3-reviewer |
| Human `PLAN_APPROVAL` | broker only | **user** |
| Self-mark stage APPROVED | **no** | stages are VALIDATED only |

Mechanical `context-pack.sh` is allowed. Choosing product/architecture decisions is not.


## Self-improve authority

| Action | Boss |
|---|---|
| `record-lesson.sh` / `lesson-rollback.sh` / `lesson-list.sh` | **yes** |
| Inject active lessons via `context-pack.sh` | yes (script) |
| Silently edit `SKILL.md` / references from a lesson mid-task | **no** |
| Propose skill text change for user/eval gate | yes (broker only) |

Lessons are data under `.workflow/route3/lessons/`. See `self-improve.md`.
