# Route3 build pipeline

Day-to-day: `slim-v3-contract.md`. Clarify gate: `clarify-then-execute.md`.

## Pipeline

```
RESEARCH?/SKILL? → CLARIFY (D1–D10 rounds) → PACKAGE (wait) →
PREFLIGHT (check-preflight.sh) → ARCHITECT → DEBATE? →
OWNERSHIP → route-slice.sh → BUILD → TEST → REVIEW [+SECURITY] →
IMPROVE → BOSS CHECK + BUILD_PROOF → DOCS?
```

- **CLARIFY**: default mode `full` — ask all material questions until
  `open_branches=none`. **No BUILD before preflight PASS.**
- **PACKAGE**: Goal / Assumptions / Plan / AC → user confirm
  (`PLAN_APPROVAL`).
- **PREFLIGHT**: `scripts/check-preflight.sh` — exit 1 = keep clarifying.
- **ARCHITECT**: non-trivial after approval; include `PRODUCT:`.
- **DEBATE**: 2 experts + architect when high-stakes; else skip.
- **OWNERSHIP**: `scripts/check-ownership.sh` before parallel writers.
- **BUILD**: `route-slice.sh` → Codex → Kimi → native; `PONYTAIL:` brief.
- **TEST / SECURITY / REVIEW / IMPROVE / BOSS**: unchanged quality bar.
- **BUILD_PROOF**: boss pastes independent gate summary in PLAN.

## Discussion protocol

You relay — subagents cannot talk to each other. Keep agents alive via
SendMessage. High-stakes → fusion (`routing-resilience.md`).

1. **Proposal**: relevant experts return plans in parallel.
2. **Critique**: max 2 rounds.
3. **Synthesis**: boss merges; security > data integrity > correctness >
   reliability > UX > delivery speed.

## Clarify + contractor package

Detail: `clarify-then-execute.md` + `matt-grill-flow.md`.

Investigate first. Scan D1–D10. Ask remaining material branches (rounds of
≤7). Then produce and **stop**:

**Goal.** Restate ask + acceptance criteria.  
**Blocking questions.** All open dims — not a shallow sample.  
**Assumptions.** Numbered, falsifiable.  
**Plan.** Files, signatures, order; rejected alternatives in one clause.

Set `GRILL: status=ALIGNED` only after user approval / continue / yes to all
**and** every dim resolved. Then run `check-preflight.sh`.

**Proportionality.** Typo/rename/~20-line → skip clarify. Auth/money/
migrations/deletion → mode `one` or full with extra caution.

Mid-build dead assumption → stop, re-clarify that dim; never quiet redesign.

## Clarity gate (agents)

- Agent unclear → `NEEDS_CLARIFICATION` + numbered Qs with defaults, no code.
- Boss answers via SendMessage; never "use your judgment" on material gaps.
- Dispatch brief must have gate-checkable AC.

## Design-from-image

1. Clarify D1–D10 (esp. surfaces, states, out_of_scope) if mockup ambiguous.
2. `route3-design-analyst` with image path(s).
3. Resolve CONFLICT vs repo rules; skill autodecide; debate; build; visual check.

## Design-polish (no picture)

1. Clarify if scope/surfaces unclear; else profile density defaults.
2. Autodecide taste skill → BUILD via route-slice.sh → reviewer.

## Task brief quality (every dispatch)

0. `PRODUCT:` + `PONYTAIL:`  
1. Preflight tool flags (e.g. Sol `--skip-git-repo-check`)  
2. Correctness traps named  
3. Measurable AC only  
4. Self-run gates + paste tails — **boss re-runs** → `BUILD_PROOF:`  
5. Scope discipline ≠ MVP

## Build loop (interactive)

1. Profile + MEMANTO → clarify rounds → package → wait.
2. `check-preflight.sh`  
3. Skill autodecide → `SKILL_ROUTE`  
4. `route-slice.sh` → `assert-build-route.sh` (mandatory; `boss-discipline.md`)  
5. `check-ownership.sh` if multi-writer  
6. Build via Codex|Kimi|Task(route3-*) — never boss-write; log `BUILDER_DISPATCH`  
7. Reviewer → improver ≤2  
8. Boss `BUILD_PROOF` + `SLICE_EVAL`  
9. `assert-build-route.sh --require-dispatch` → `check-plan-done.sh` → report ≤15 lines

## After ship (mandatory)

```bash
$(dirname skill)/scripts/check-plan-done.sh  # resolve from install
```

Exit 1 → not done.


## Risk paths + factory (opt-in)

See `factory-contract.md`. After clarify, set:

```text
FACTORY: class=trivial|standard|factory reason=…
```

| class | Flow |
|---|---|
| trivial | `--trivial` done; guarded `TRIVIAL_REASON:` |
| standard (default) | pipeline above |
| factory | `init-run.sh --path factory` → `check-stage` product/architecture/plan → per-slice `BRIEF` → `context-pack.sh` → `route-slice.sh --run --slice` → BUILD → `verify-slice.sh` → reviewer → `check-plan-done.sh --factory --run` |

Stages are **VALIDATED** by scripts. Exactly one human pre-code gate: `PLAN_APPROVAL`.
No mid-loop human stage approvals (overnight-safe). No FINAL PR in unattended spine.

```bash
scripts/init-run.sh --path factory
scripts/check-stage.sh --run "$RUN_ID" product
scripts/check-stage.sh --run "$RUN_ID" architecture
scripts/check-stage.sh --run "$RUN_ID" plan
scripts/check-stage.sh --run "$RUN_ID" slice --slice 001
scripts/context-pack.sh --run "$RUN_ID" --slice 001
scripts/route-slice.sh --probe --run "$RUN_ID" --slice 001
scripts/verify-slice.sh --run "$RUN_ID" --slice 001
scripts/check-plan-done.sh --factory --run "$RUN_ID"
```
