# Architecture

Route3 is a **boss orchestrator** packaged as an installable skill. The main agent clarifies, routes, and gates; writers (Codex / Kimi / `route3-*` Task|Agent) produce code; independent reviewers and scripts own truth.

## Components

| Component | Location | Role |
|---|---|---|
| Skill entry | `skill/SKILL.md` | Progressive disclosure, iron laws, mode spines |
| Agents | `agents/route3-*.md` | Expert definitions installed under `~/.claude|cursor/agents/route3/` |
| Scripts | `skill/scripts/*.sh` | Preflight, risk, factory stages, route, verify, lessons, done |
| References | `skill/references/*` | Contracts loaded on demand (see [references/README.md](../skill/references/README.md)) |
| Domain teams | `skill/teams/*.md` | Startup / project / halal / enterprise / agency playbooks |
| Evals | `skill/evals/*.json` + `eval-*.sh` | Clarify / factory / trigger regression fixtures |
| Run artifacts | `.workflow/route3/runs/<run-id>/` | Factory STATE, stages, slices, TRACE (per repo) |
| Lessons | `.workflow/route3/lessons/` | Append-only self-improve log |

## Standard vs factory data flow

### Standard (default)

```
profile + MEMANTO (optional)
  → skill autodecide
  → clarify D1–D10 until open_branches=none
  → package + user confirm
  → check-preflight.sh
  → classify-risk.sh  (usually → standard)
  → route-slice.sh → assert-build-route.sh
  → BUILD (Codex | Kimi | Task/Agent route3-*)
  → log BUILDER_DISPATCH
  → test → review [+security] → improver ≤2
  → BUILD_PROOF + SLICE_EVAL
  → assert-build-route.sh --require-dispatch
  → check-plan-done.sh
  → ≤15-line report
```

PLAN markers in the working tree (or `.workflow/PLAN.md`) are the compatibility bridge. No run-dir required.

### Factory (opt-in)

Triggered when `FACTORY: class=factory` after `classify-risk` (multi-slice or high-risk tokens).

```
classify-risk → FACTORY: class=factory
  → init-run.sh --path factory
       creates .workflow/route3/runs/<id>/{STATE.json,TRACE.jsonl,slices/}
  → VALIDATED stages: research? → product → architecture → plan
       (exactly one human APPROVED: PLAN_APPROVAL)
  → per slice:
       BRIEF.md → context-pack.sh → route-slice → BUILD → verify-slice.sh
       FAIL → record-lesson.sh
       invalidate-stale.sh when upstream digests change
  → check-plan-done.sh --factory --run <id>
```

If `class=factory` is declared but `init-run.sh` never ran, treat as **standard** until a run exists.

## Truth precedence

When sources disagree, higher wins:

1. **`STATE.json`** — authoritative machine state (stage, path, slice terminals, digests)
2. **Stage / BRIEF artifacts** — decisions (`01-RESEARCH` … `05-PLAN`, `slices/NNN/BRIEF.md`)
3. **`VERIFY.md`** — generated observations / command evidence (never builder prose)
4. **`TRACE.jsonl`** — append-only audit; never overrides STATE
5. **Legacy PLAN markers** — compat bridge; write-through to run artifacts when on factory path

## Gate kinds

| Kind | Who sets it | Examples |
|---|---|---|
| **VALIDATED** | Script or specialist agent | `check-stage.sh`, `verify-slice.sh` PASS, research complete |
| **APPROVED** | **Human user only** | `PLAN_APPROVAL: approved\|continue\|yes_to_all` |

Never auto-`APPROVED` overnight. Overnight freezes the plan at queue time; mid-loop stages stay VALIDATED-by-script only. Existing user gates (destructive / prod / money / secrets / publish / dependency) are unchanged.

## Boss / writer / reviewer separation

| Role | May | Must not |
|---|---|---|
| **Boss** (main `/route3` thread) | Clarify, classify, init-run, dispatch, run gate scripts, record lessons, relay debate | Author product/arch content, write product code, rescue-fix verify, self-approve stages, invent primary |
| **Writer** (Codex / Kimi / `route3-*`) | Edit allowed files per BRIEF / ownership | Set reviewer verdicts or APPROVED gates |
| **Reviewer** (`route3-reviewer`, security-auditor) | Independent FIX / PASS / REJECT | Be the same agent that wrote the slice |

`assert-build-route.sh` + `BUILDER_DISPATCH` enforce that the chosen primary was actually invoked. Missing dispatch ⇒ NOT DONE.

## Relation to MEMANTO

MEMANTO is **optional** and external. Route3’s source of truth for lessons is:

`.workflow/route3/lessons/LESSONS.jsonl`

When `memanto` is on `PATH`, `record-lesson.sh` dual-writes:

```text
memanto remember … --type learning --confidence 0.9 \
  --provenance observed --source route3-self-improve
```

Memanto failures are ignored. Skill rewrites are never driven automatically from lessons.

## Explicit non-goals (v1)

- Temporal / durable workflow runtime
- Control-panel UI
- Auto-merge or unattended FINAL PR
- New permanent **product-designer** / **program-designer** agents (until evals justify them)
- Forcing all domain-team work through factory
- Event-sourced TRACE that overrides STATE
- Exhaustive call-graph artifacts as stage requirements

See also: [FACTORY.md](FACTORY.md), [SELF-IMPROVE.md](SELF-IMPROVE.md), `skill/references/factory-contract.md`.
