# Route3 × Matt Pocock — grill → clarify → execute

Source spirit: [mattpocock/skills](https://github.com/mattpocock/skills)
(`grill-me`, `grill-with-docs`). Route3 professional default is **stronger**:
all-sided clarify until clear, then execute. Full taxonomy:
`clarify-then-execute.md`.

**User policy:** concrete task → ask every material question that remains →
only after everything is clear → execute.

Callers: `SKILL.md`; `build-pipeline.md`; `slim-v3-contract.md`;
`scripts/check-preflight.sh`. Prefer Skill invoke when installed:
`~/.claude/skills/grill-me/SKILL.md`,
`~/.claude/skills/grill-with-docs/SKILL.md`.

## Hard rule

Non-trivial: **no BUILD / no CLI implement** until:

1. `CLARIFY_COVERAGE` complete (10 dims — see `clarify-then-execute.md`)
2. `GRILL: status=ALIGNED` and `open_branches=none`
3. `scripts/check-preflight.sh` exits 0

Trivial (typo/rename/~20-line, zero judgment) → `SKIPPED_TRIVIAL` +
`check-plan-done.sh --trivial`.

## Flow

```
1. INVESTIGATE — repo, MEMANTO, project-profile (never ask silent defaults)
2. AMBIGUITY_SCAN — mark D1–D10
3. QUESTION_ROUNDS — full clarify until open_branches=none
4. PACKAGE — Goal / Assumptions / Plan / AC → wait for user confirm
5. PREFLIGHT — check-preflight.sh
6. BUILD — route-slice.sh (Codex→Kimi→native) + ownership locks
7. REVIEW → boss check → SLICE_EVAL → check-plan-done.sh
```

## Modes

| Mode | When |
|---|---|
| **`full`** | **Default** — all-sided; rounds of ≤7 Qs until clear |
| **`one`** | `/grill-me`, auth/pay/migrate/delete, or user wants drip |
| **`docs`** | Domain glossary / `/grill-with-docs` |
| **`batch-lite`** | Only if user explicitly wants fewer questions **after**
  seeing the scan summary |

`özün qərar ver` / `yes to all` / `continue` after package shown → apply
recommended defaults to remaining dims → ALIGNED.

## Question craft

- Every question: options + `Deyməsən → X`
- Repo can answer → explore; mark `repo_resolved`; do not ask
- Silent defaults / which model / which expert → never ask
- Keep rounds until every dim is resolved — **no early ALIGNED**

## ALIGNED means

All of:

1. Goal restated; not rejected
2. D1–D10 each `answered|repo_resolved|default_applied|n/a`
3. `open_branches=none`
4. Assumptions falsifiable; AC gate-checkable
5. User confirm signal (`PLAN_APPROVAL`)
6. `check-preflight.sh` → PASS

## PLAN blocks

See `clarify-then-execute.md` for `CLARIFY_COVERAGE` + `GRILL` templates.

## Anti-patterns

- Coding during grill / before preflight
- Cap questions so hard that ambiguity remains
- ALIGNED with dims still `asked`
- Asking discoverable or silent-default questions
- Re-grilling closed dims without a dead assumption
