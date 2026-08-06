# Route3 slim-v3 — professional clarify → execute

Thin root `SKILL.md` + progressive `references/`. Depth loads on demand.

## Goal

Ship production-ready slices with **shared understanding first**. Defaults
remove noise questions; **task ambiguity is never skipped**.

## Silent defaults (never ask)

Loaded from `project-profile.md` (Bugi auto-detect or workspace profile).
Log `DEFAULTS_APPLIED: profile=…` in PLAN.

Never ask: brand tokens already in profile, AZN/locale when profile=bugi,
density band, stack, which model/expert/skill/test framework/lint.

## Clarify → align → execute (mandatory)

Full taxonomy: `clarify-then-execute.md`. Procedure: `matt-grill-flow.md`.

For every concrete non-trivial task:

1. Investigate
2. Scan D1–D10 ambiguities
3. Ask **all remaining material questions** (rounds until clear)
4. Package Goal / Assumptions / Plan / AC
5. Wait for user confirm
6. `check-preflight.sh` must PASS
7. Only then BUILD

Default grill mode: **`full`**. `/grill-me` → `one`. Explicit "az soruş"
after scan → `batch-lite`.

## Execution priority

```
1. Project profile + MEMANTO + silent defaults
2. Domain + curated skill (≤3) — never ask which
3. CLARIFY (D1–D10) until open_branches=none — no code
4. PACKAGE + user confirm → GRILL ALIGNED
5. check-preflight.sh (exit 1 = stop)
6. route-slice.sh → Codex → Kimi → native
7. check-ownership.sh before parallel writers
8. BUILD → test → reviewer → improver ≤2
9. Boss BUILD_PROOF + SLICE_EVAL → check-plan-done.sh
10. Report ≤15 lines
```

## Quality spines

| Concern | Reference |
|---|---|
| Clarify gate | `clarify-then-execute.md` |
| Backend ladder | `native-primary.md` + `route-slice.sh` |
| Minimal correct diff | `ponytail-ladder.md` |
| Patterns / layers | `product-engineering.md` |
| Parallel writers | `parallel-ownership.md` |
| Evals | `evals.md` |

## Done means

```bash
~/.claude/skills/route3/scripts/check-preflight.sh   # before BUILD
~/.claude/skills/route3/scripts/check-plan-done.sh   # before "done"
```

| Slice | Required |
|---|---|
| Trivial | `SLICE_EVAL:` |
| Full | `CLARIFY_COVERAGE` + `GRILL ALIGNED` + `PREFLIGHT: PASS` + `ROUTE_DECISION` + `BUILD_PROOF` + `SLICE_EVAL` |
| Domain | `EVIDENCE:` + clarify/grill marker |

## Anti-patterns

- Coding before preflight PASS
- Shallow one-question then build
- Re-asking profile silent defaults
- Asking "Sol yoxsa Kimi?"
- Inventing ROUTE_DECISION without `route-slice.sh`
- Parallel writers without OWNERSHIP check
- MVP stubs / skipping a11y-validation-states
- Growing root SKILL.md — put depth in references/
