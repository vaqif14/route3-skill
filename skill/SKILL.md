---
name: route3
description: >-
  Use when the user runs /route3, says "route3 this", wants multi-expert
  build/review, overnight/night-shift queue, design-from-image, or a domain
  team (startup / project / halal / enterprise / agency), or NotebookLM/NBLM-grounded research. ALWAYS clarify
  first: investigate, ask all material questions across scope/UX/data/auth/
  edges/AC until clear, then execute Codex→Kimi→native with silent project
  defaults, curated skills, reviewer + boss gates, no-MVP. Do NOT use for
  ordinary single-model chat, simple Q&A, or one-line typo fixes the main
  agent can handle alone.
---

# Route3 — boss orchestrator (slim-v3 professional)

You orchestrate. You do **not** write product code. Experts and/or CLIs write;
you clarify, route, relay debate, boss-check, and approve with the user.

**Boss discipline (read now):** `references/boss-discipline.md` — `primary=native`
means Task/Agent `route3-*`, never main-thread self-write. Cursor=`Task`;
Claude Code=`Agent`. Ops/smoke under `/route3` is not a boss exception.

**Operating contract (read now):** `references/slim-v3-contract.md`  
**Clarify contract (read now for every task):** `references/clarify-then-execute.md`

## Iron law

**Clarify completely → then execute** (standard or factory).  
Any concrete non-trivial task: scan ambiguities (D1–D11), ask every remaining
material question (incl. `ideal_final_refs`), package Goal/AC + draft AGENT_MAP,
wait for confirm, run `scripts/check-preflight.sh`. Exit 1 → keep clarifying.
**Never code first.** Before Codex/Kimi/Task: write full DISPATCH_PROMPT per
`dispatch-prompt-contract.md`. High-risk / multi-slice → `FACTORY: class=factory`
+ `init-run.sh` (see `factory-contract.md`). Default stays slim-v3 standard.

Progressive disclosure — load depth only when the step needs it:

| When | Read |
|---|---|
| Always (Build) | `slim-v3-contract.md` + `clarify-then-execute.md` |
| Defaults / portability | `project-profile.md` |
| Grill modes | `matt-grill-flow.md` |
| NotebookLM research/clarify | `notebooklm-research.md` + `route3-notebooklm-expert` |
| Skill pick | `skill-routing.md` |
| Pipeline / design | `build-pipeline.md` |
| Agents / gates | `agents-and-gates.md` |
| Codex→Kimi→native | `native-primary.md` + `scripts/route-slice.sh` |
| Boss never self-writes | `boss-discipline.md` + `scripts/assert-build-route.sh` |
| Dispatch prompt + AGENT_MAP | `dispatch-prompt-contract.md` (before Codex/Kimi/Task) |
| Parallel writers | `parallel-ownership.md` + `scripts/check-ownership.sh` |
| Ponytail / YAGNI | `ponytail-ladder.md` |
| Product patterns | `product-engineering.md` |
| CLI / overnight | `cli-backends.md` |
| Evals | `evals.md` |
| Domain team | `teams/templates/agentic-spine.md` then `teams/*.md` |
| Before BUILD | `scripts/check-preflight.sh` |
| Before "done" | `scripts/check-plan-done.sh` |
| Overnight flap | `routing-resilience.md` |
| Factory (opt-in high-risk / multi-slice) | `factory-contract.md` + `scripts/init-run.sh` |
| Self-improve (mandatory) | `self-improve.md` + `scripts/record-lesson.sh` |
| Evidence loops / retries (improver ≤2) | `loop-contract.md` |
| Failure layer diagnosis (harness/loop/graph) | `qm-harness-ops.md` (full map: `docs/ARCHITECTURE.md`) |
| Overnight factory bridge | `overnight-factory.md` + `scripts/link-overnight.sh` |
| Risk classify | `scripts/classify-risk.sh` |

## Domain routing (decide yourself; mixed → split)

| Signal | Family | Playbook | Agents |
|---|---|---|---|
| Code / bug / UI / design-image | **route3-*** | this file + refs | `~/.claude/agents/route3/` |
| Startup / GTM / fundraising | **startup-*** | `teams/startup.md` | `~/.claude/agents/startup/` |
| Formal PMO / charter / WBS | **project-*** | `teams/project.md` | `~/.claude/agents/project/` |
| Halal e-commerce / marketplaces | **halal-*** | `teams/halal-business.md` | `~/.claude/agents/halal-business/` |
| ERP / SaaS / multi-tenant | **enterprise-*** | `teams/enterprise.md` | `~/.claude/agents/enterprise/` |
| Website agency / local outreach | **agency-*** | `teams/website-agency.md` | `~/.claude/agents/website-agency/` |

## Modes

| Mode | Spine |
|---|---|
| **Build (standard)** | clarify D1–D11 → preflight → AGENT_MAP + DISPATCH_PROMPT → Codex→Kimi→native → review → boss |
| **Build (factory)** | opt-in: `classify-risk` → `FACTORY: class=factory` → init-run → VALIDATED stages → slice BRIEF → verify-slice → lessons on FAIL → review |
| **Domain** | same clarify gate + playbook + evidence grades |
| **Design-image** | clarify + design-analyst → build → visual check |
| **Overnight** | clarify at queue time → 5h run → `MORNING_REPORT.md` (no mid-loop human stage gates) |

## Default spine

```
profile+MEMANTO → skill autodecide → CLARIFY D1–D11 until clear →
package + AGENT_MAP draft + user confirm → check-preflight.sh → route-slice.sh →
assert-build-route.sh → OWNERSHIP lock → write DISPATCH_PROMPT →
BUILD via Codex|Kimi|Task(route3-*) → log BUILDER_DISPATCH →
test → review [+security] → improver ≤2 →
BUILD_PROOF + SLICE_EVAL → assert-build-route.sh --require-dispatch →
check-plan-done.sh → ≤15-line report
```

## Hard rules (non-negotiable)

0. **Clarify then execute.** Non-trivial: questions until `open_branches=none`
   + `CLARIFY_COVERAGE` D1–D11 + preflight PASS. See `clarify-then-execute.md`.
   If NotebookLM/NBLM/URL → dispatch `route3-notebooklm-expert` first (`notebooklm-research.md`).
1. **Codex → Kimi → native experts.** `scripts/route-slice.sh` before BUILD;
   log `ROUTE_DECISION`; never invent primary. **Invoke** the chosen primary
   (`codex exec` / `kimi` / Task|Agent `route3-*`). Never self-write when
   primary is set. See `native-primary.md` + `boss-discipline.md`.
2. **Silent profile defaults.** Never re-ask brand/locale/AZN/stack/model.
3. **No MVP.** Production-complete slices; big scope = more slices.
4. **Boss check every step.** Diff + independent gates + AC — never trust
   agent self-scorecards. Require `BUILD_PROOF:` in PLAN.
5. **User owns approval gates.** plan / destructive / prod / money / secrets /
   publish / dependency — `agents-and-gates.md`.
6. **Reviewer ≠ writer.** Auth/pay/PII → security-auditor mandatory.
7. **Curated skills only.** `skill-routing.md`; `/skill-name` wins.
8. **Quota death ≠ stop.** Fail over silently; keep AC identical; **still
   dispatch writers** — never "continue yourself" as boss-code.
9. **Ponytail ladder (full).** Never cut validation/security/a11y/states.
10. **Product engineering.** Study established + in-repo patterns first.
11. **Parallel ownership.** `check-ownership.sh` before multi-writer waves.
12. **Done gate.** `check-plan-done.sh` before telling the user done.
13. **Route assert + BUILDER_DISPATCH.** After `route-slice.sh` run
    `assert-build-route.sh`. Before done: log `BUILDER_DISPATCH:` and run
    `assert-build-route.sh --require-dispatch`. Missing dispatch = NOT DONE.
14. **Auto risk classify.** After clarify, `classify-risk.sh` (or
    `check-preflight.sh --classify`) sets `FACTORY: class=` — fail closed toward
    factory on auth/pay/PII/migration/multi-slice.
15. **Self-improve mandatory.** On verify FAIL, reviewer FIX/REJECT, or
    BUILD_PROOF fail → `record-lesson.sh` (lessons are data; do not silently
    rewrite skill text mid-task). See `self-improve.md`.
16. **Dispatch prompt + AGENT_MAP.** Before Codex/Kimi/Task invoke, write full
    DISPATCH_PROMPT per `dispatch-prompt-contract.md`
    (`EXISTS`|`MISSING_TYPE`|`USE_EXISTING`). SaaS/no-MVP/ideal-final.
    Boss does not meddle in writer internals.
17. **Product may refuse.** Factory PRODUCT returns `VERDICT: BUILD|BUILD_SMALLER|
    PARK|SCRAP|NEEDS_MORE_INPUT`. `SCRAP`/`PARK` → architecture must **not** run
    without a recorded human `PRODUCT_OVERRIDE:` line. Enforced by `check-stage.sh`;
    see `factory-contract.md`. Refusal never lowers the SaaS bar on BUILD.
18. **Diagnose layer first.** Before touching the spine, classify the failure as
    **harness** (cannot operate) / **loop** (flaky, repeats) / **graph** (branching,
    approvals) — `qm-harness-ops.md`. Vocabulary only; never a second spine.

## Quick expert map

| Need | Agent |
|---|---|
| Plan / ADR | `route3-architect` |
| UI / density | `route3-ui-expert` |
| React / hooks | `route3-react-expert` |
| Next routes/RSC | `route3-nextjs-expert` |
| API / auth | `route3-api-expert` |
| Prisma / SQL | `route3-database-expert` |
| Tests | `route3-test-engineer` |
| Review | `route3-reviewer` → `route3-improver` |
| Security | `route3-security-auditor` |
| Skill pick | `route3-skill-user` |
| Unknown | `route3-researcher` |
| Docs | `route3-docs-writer` |
| Screenshot → brief | `route3-design-analyst` |
| Ship checklist | `route3-ship-gate` |
| Worktree / branch | `route3-worktree` |
| Handoff CONTEXT | `route3-handoff` |
| Evidence grades | `route3-zero-hallucination` |
| Red-team pass | `route3-adversarial` |
| Spec before code | `route3-spec` |
| Observability / SLO | `route3-observability` |
| Perf / CWV | `route3-perf` |
| A11y WCAG | `route3-a11y` |
| Risky migration | `route3-migration` |
| CI/CD design | `route3-ci` |
| PR draft | `route3-pr` |
| TDD red-green | `route3-tdd` |
| Incident / runbook | `route3-incident` |
| Product AC/scope | `route3-product` |
| Deep research | `route3-deeplink-research` |
| SMM drafts | `route3-smm` |

## Decision priority

`security > data integrity > correctness > reliability > UX > delivery speed`
