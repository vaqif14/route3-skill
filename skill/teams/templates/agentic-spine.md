**Clarify first (mandatory):** `references/clarify-then-execute.md` D1–D10 before domain deliverables.

# Shared agentic spine (all Route3 families)

Callers: every `teams/*.md` playbook (read this first on domain runs);
`SKILL.md` domain routing row.

Domain teams (startup / project / halal / enterprise / agency) are **not**
"soft chat". They are agentic engineering in a non-code substrate: same
harness, different artifacts.

Boss reads this **before** the family playbook on every domain run.

## Same as code Build

| Harness piece | Domain meaning |
|---|---|
| Silent defaults | Profile / workspace facts; don't re-interview known fields |
| Clarify + preflight | D1–D10 clarify rounds + Goal/AC package → `check-preflight.sh` → wait |
| STATUS contract | Every agent ends with STATUS line |
| Separation of duties | Planner ≠ producer ≠ reviewer ≠ founder approver |
| Boss check | Re-read artifacts; verify claims against evidence grade |
| No MVP | Full production-quality draft (complete sections, sources, risks) |
| Approval gates | Founder owns publish/money/legal/external send |
| Decision trace | LOG / pipeline row / MEMANTO for high-signal |
| Report ≤15 lines | User-facing; depth in `reports/` |

## Evidence grades (mandatory on claims)

| Grade | Meaning | Allowed action |
|---|---|---|
| VALIDATED | Primary source / user-confirmed / measured | Decide / ship draft |
| HYPOTHESIS | Plausible, unproven | Experiment or label clearly |
| UNKNOWN | Missing | Do not invent; ask or park |

Any report that states a number/market claim without a grade is a defect.

## Mandatory one-liner (every domain report / PLAN)

```text
EVIDENCE: <claim> → VALIDATED|HYPOTHESIS|UNKNOWN — <source or gap>
```

Example (synthetic):
`EVIDENCE: TAM 2B → HYPOTHESIS — desk research only, no primary interview`

Boss runs `scripts/check-plan-done.sh --domain` before reporting done.
Missing `EVIDENCE:` = not done.

## Domain STATUS handling

Identical to `references/agents-and-gates.md`:
COMPLETED → boss check; NEEDS_CLARIFICATION → answer via SendMessage;
NEEDS_APPROVAL → founder gate; BLOCKED → fix; FAILED → route to owner.

## When work becomes code

If a domain slice needs product code (landing, billing module, demo site):

1. Finish domain PLAN with AC for the business outcome.
2. Hand the coding slice to **route3-*** Build spine — Codex→Kimi→native (`references/native-primary.md`, `scripts/route-slice.sh`).
3. Keep one parent PLAN; do not ask user to re-invoke `/route3`.

## Kill criteria

Every initiative row needs a kill criterion **before** work starts
(see `templates/pipeline.md`). Boss stops zombie initiatives.

## Minimal domain loop

```
profile/defaults → skill? → grill/preflight (wait) → agent produce →
peer critique (if high-stakes) → EVIDENCE: line → boss check →
check-plan-done --domain → founder gate? → report
```
