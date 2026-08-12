# Clarify → then execute (professional default)

**Hard contract:** for any concrete non-trivial task, Route3 **stops coding**
until every material ambiguity is resolved. Then — and only then — execute.

Callers: `SKILL.md` hard rule #0; `matt-grill-flow.md`; `build-pipeline.md`;
`scripts/check-preflight.sh` (blocks BUILD); `check-plan-done.sh`.

User intent (verbatim policy): given a concrete task, ask all-sided questions
when any remain; after everything is clear, execute.

## NotebookLM lane

If the task should be grounded in a NotebookLM vault (user said NBLM / pasted notebook URL / domain pack exists), during INVESTIGATE dispatch `route3-notebooklm-expert` (`notebooklm-research.md`). Merge `nblm_answered` dims into `CLARIFY_COVERAGE` as `answered`. Only ask the user dims still `needs_user`.

## Absolute stop

Until `GRILL: status=ALIGNED` **and** `check-preflight.sh` exits 0:

- No product code
- No Codex / Kimi / native BUILD dispatch
- No "I'll assume and start"

Trivial only (typo / rename / ≤~20-line obvious, zero product judgment):
`GRILL: status=SKIPPED_TRIVIAL` + `--trivial` done path.

## Phase machine

```
RECEIVE → INVESTIGATE → AMBIGUITY_SCAN → QUESTION_ROUNDS → PACKAGE →
USER_CONFIRM → PREFLIGHT_PASS → EXECUTE → VERIFY → DONE
```

| Phase | Boss does | Exit criterion |
|---|---|---|
| INVESTIGATE | Repo, MEMANTO, project-profile, silent defaults | Facts gathered |
| AMBIGUITY_SCAN | Score all 11 dimensions below | `CLARIFY_COVERAGE` draft |
| QUESTION_ROUNDS | Ask every **open** dimension (see batching) | `open_branches=none` |
| PACKAGE | Goal / Assumptions / Plan / gateable AC + draft AGENT_MAP | Package in chat + PLAN |
| USER_CONFIRM | Wait for approve / continue / yes to all / answers | User signal |
| PREFLIGHT_PASS | `scripts/check-preflight.sh` | exit 0 |
| EXECUTE | `route-slice.sh` → Codex→Kimi→native + experts | Diff exists |
| VERIFY | Reviewer, boss re-run gates, SLICE_EVAL | `check-plan-done.sh` |

## 11 dimensions (all-sided clarify)

Boss **must** mark each dimension in PLAN. Never skip a dim silently.

| ID | Dimension | Ask when unclear |
|---|---|---|
| D1 | `goal_outcome` | What "done" looks like for the user / buyer |
| D2 | `scope_in_out` | In-scope vs explicitly out; slice boundaries |
| D3 | `users_surfaces` | Who + which surface (storefront/seller/admin/API) |
| D4 | `data_contracts` | Models, fields, migrations, backwards compat |
| D5 | `ux_states` | Loading / empty / error / success / mobile |
| D6 | `auth_permissions` | Roles, authZ, guest vs logged-in |
| D7 | `edge_failures` | Quota, nulls, concurrency, payment fail, offline |
| D8 | `acceptance_verify` | How user verifies in-app (path + expected) |
| D9 | `risks_rollback` | Blast radius, kill switch, rollback |
| D10 | `out_of_scope` | What we will **not** touch this slice |
| D11 | `ideal_final_refs` | Screenshots / samples / acceptance path / what "perfect done" looks like — ask **BEFORE** build when UI/UX or user may later say "belə olmalıdır" |

Per dimension status (exactly one):

`asked` | `answered` | `repo_resolved` | `default_applied` | `n/a`

`ALIGNED` requires: every dim **D1–D11** is `answered` | `repo_resolved` |
`default_applied` | `n/a` — **zero** bare `asked` left open.

## Question quality rules

1. **Investigate before ask** — repo/MEMANTO/profile answer → `repo_resolved`.
2. **Never ask silent defaults** — brand/AZN/locale/density/stack/model/expert
   (see `project-profile.md` + `slim-v3-contract.md`).
3. **Every question has a recommended default** — `Deyməsən → X`.
4. **Decision-tree order** — dependent branches first (scope before UX polish).
5. **No vague asks** — "necə istəyirsən?" is forbidden; offer concrete options.
6. **Material only** — wrong answer would throw away ≥30 min or break AC.
7. **Keep going** — if round N still leaves open dims, run round N+1.
   Do **not** set ALIGNED with open branches.

## Batching (professional, not shallow)

Default mode `full` (user asked for all-sided clarify):

- Round size: **up to 7** numbered questions per message
- After user replies: re-scan dims; if any still open → next round
- No artificial "max 5 total" cap that leaves ambiguity
- High-risk (auth/pay/migrate/delete/prod): prefer `one` mode
  (one question at a time) or `/grill-me`

Modes:

| Mode | When |
|---|---|
| `full` | **Default** — all-sided until clear |
| `one` | `/grill-me`, money/auth/migrate, or user asks slow drip |
| `docs` | Domain vocabulary / glossary (`grill-with-docs`) |
| `batch-lite` | Only if user says " tez / az soruş / özün qərar ver" **after**
  seeing the ambiguity scan summary |

`özün qərar ver` / `yes to all` / `continue` **after** the package is shown
→ apply recommended defaults to remaining open dims, mark
`default_applied`, set ALIGNED.

## PLAN blocks (required)

```text
CLARIFY_COVERAGE:
  D1 goal_outcome: answered|repo_resolved|default_applied|n/a — <note>
  D2 scope_in_out: …
  D3 users_surfaces: …
  D4 data_contracts: …
  D5 ux_states: …
  D6 auth_permissions: …
  D7 edge_failures: …
  D8 acceptance_verify: …
  D9 risks_rollback: …
  D10 out_of_scope: …
  D11 ideal_final_refs: … — screenshots/samples/acceptance path / perfect-done

GRILL: mode=full|one|docs|batch-lite status=IN_PROGRESS|ALIGNED|SKIPPED_TRIVIAL
  rounds=<n>
  open_branches=none
ALIGNED_AT: <iso>

GOAL: <restated>
ASSUMPTIONS:
  1. …
AC:
  - [ ] <gate-checkable>
SOLUTION_BAR: saas
AGENT_MAP: <intended experts even before route> e.g. route3-api-expert|EXISTS,route3-ui-expert|EXISTS
PLAN_APPROVAL: pending|approved|continue|yes_to_all
```


## PACKAGE requires draft AGENT_MAP

Even **before** `route-slice.sh`, PACKAGE must list intended experts:

```text
AGENT_MAP: route3-api-expert|EXISTS,route3-ui-expert|EXISTS
```

Status values: `EXISTS` | `MISSING_TYPE` | `USE_EXISTING` — see
`dispatch-prompt-contract.md`. Do not invent agents. UI/UX slices must close
D11 (`ideal_final_refs`) so design samples are clarify inputs, not post-ship
surprises.

## Mid-build re-clarify

If an assumption dies or a new material branch appears:

1. `STATUS: NEEDS_CLARIFICATION` — stop writers
2. Re-open only that dimension (do not re-litigate closed dims)
3. New ALIGNED + re-run `check-preflight.sh`
4. Resume same agents with handoff

## Anti-patterns

- Coding while `open_branches` ≠ none
- Marking ALIGNED with dims still `asked` (D1–D11 incomplete)
- Asking silent-default / discoverable questions
- Single vague question then build
- "Looks clear enough" without `CLARIFY_COVERAGE`
- Skipping preflight script
- Shipping then receiving design samples that should have been clarify D11 / DESIGN_REFS inputs
- PACKAGE without draft `AGENT_MAP` of intended experts
