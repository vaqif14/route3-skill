# Boss → builder dispatch prompt contract

**Process order (mandatory):**

```
CLARIFY COMPLETE → AGENT_MAP → DISPATCH_PROMPT → INVOKE → BOSS GATES ONLY
```

1. **CLARIFY COMPLETE** — D1–D11 crystal-clear (`clarify-then-execute.md`); preflight PASS.
2. **AGENT_MAP** — declare every needed expert with status (never invent fake agents).
3. **DISPATCH_PROMPT** — write the full markdown prompt below (paste into Codex/Kimi/Task).
4. **INVOKE** — run the chosen primary (`codex exec` / `kimi` / Task|Agent).
5. **BOSS GATES ONLY** — re-run scripts, correlate evidence, review outputs. Boss does **not** meddle in writer internals mid-flight.

Callers: `SKILL.md` hard rule #16; `boss-discipline.md`; `native-primary.md`;
`assert-build-route.sh --require-dispatch`; `check-plan-done.sh`.

---

## AGENT_MAP table format

Log in PLAN **and** paste into every DISPATCH_PROMPT:

```text
AGENT_MAP:
| Agent | Status | Notes |
|---|---|---|
| route3-api-expert | EXISTS | owns API slice |
| route3-ui-expert | USE_EXISTING | nearest for visual polish |
| route3-payments-expert | MISSING_TYPE | nearest=route3-api-expert; gap=payments domain |
```

Compact one-liner also accepted:

```text
AGENT_MAP: route3-api-expert|EXISTS,route3-ui-expert|USE_EXISTING,route3-payments-expert|MISSING_TYPE→route3-api-expert
```

### Status enum

| Status | Meaning | Boss action |
|---|---|---|
| **EXISTS** | This route3 agent exists → use it | Dispatch that named agent |
| **MISSING_TYPE** | We need this *type* of agent but do not have it | Nearest existing **or** escalate user — **never invent** a fake agent name |
| **USE_EXISTING** | Execute with this named existing agent | Dispatch that agent (explicit reuse / nearest) |

### MISSING_TYPE rules

1. Pick the **nearest existing** `route3-*` (or domain family) and set Status=`MISSING_TYPE` with Notes naming the nearest + the gap.
2. Optionally set a second row `USE_EXISTING` for that nearest agent.
3. **Do not invent** agent ids that are not in the installed roster.
4. If no nearest fit exists (or gap is high-risk auth/pay/PII with no specialist), **escalate the user** before invoke — do not guess a fake agent.
5. Writers must see the gap note so they do not assume a specialist that does not exist.

---

## DISPATCH_PROMPT markdown template

Copy verbatim structure. Fill every section. Paste as the **entire** Codex/Kimi/Task prompt.

```markdown
# DISPATCH_PROMPT

## AGENT_MAP
| Agent | Status | Notes |
|---|---|---|
| <route3-…> | EXISTS \| MISSING_TYPE \| USE_EXISTING | <why / nearest / gap> |

## SOLUTION_BAR
- Level: **SaaS production** (concrete in-scope product)
- **NO MVP** — MVP concept does not exist for this task
- Ideal final for AC: full functional in-scope; no stubs; no "phase-1 fake"
- Late rework ("doesn't work / design should be like this") must be minimized — samples/AC/verify already in clarify

## GOAL
<one paragraph restated goal>

## SCOPE
- In: …
- Out: …

## AC
- [ ] <gate-checkable acceptance criterion>
- [ ] …

## DESIGN_REFS
- Paths / URLs / screenshots: <list>
- OR `n/a` — reason: <why UI samples not required>
- **Required if UI/UX** — pull ideal_final_refs from clarify D11

## FILES / OWNERSHIP
- Allowed files: …
- Must not change: …
- OWNERSHIP lock / wave: …

## VERIFY
```bash
<exact commands boss will re-run>
```

## STOP / RETURN
- Return `BUILD_PROOF:` block (commands + results)
- Escalate **blocked only** (missing secrets, AC impossible, ownership conflict)
- Do not shrink AC; do not invent out-of-scope work

## BOSS_BOUNDARY
Boss will **not** rewrite your internals mid-flight.
Boss only re-runs gates + reviews outputs.
If blocked or VERIFY FAIL → boss may **re-dispatch** a new prompt; not live-edit your WIP session.
```

---

## Anti-patterns

| Forbidden | Why |
|---|---|
| Vague "do it well" / "make it nice" | Not gate-checkable; causes late rework |
| MVP / stub / "phase 1 fake" deliverable | Violates SaaS solution bar |
| Boss mid-edit of writer WIP / internals | Breaks ownership; use re-dispatch only on BLOCKED/VERIFY FAIL |
| Missing AGENT_MAP | Writers invent agents or skip specialists |
| Design samples after ship | Samples belong in clarify D11 / DESIGN_REFS before invoke |
| Inventing `route3-foo` that does not exist | Use MISSING_TYPE + nearest or escalate |

---

## How to paste (Codex / Kimi / native)

| Primary | How |
|---|---|
| **Codex** | `codex exec …` with the full DISPATCH_PROMPT as the task body (stdin or arg). Log `BUILDER_DISPATCH: primary=codex via=codex-exec agents=<map summary>`. |
| **Kimi** | `kimi -m kimi-code/k3 -p "<DISPATCH_PROMPT>" </dev/null` (or file redirect). Same `BUILDER_DISPATCH` with `via=kimi-cli`. |
| **Native** | Cursor `Task` / Claude Code `Agent` with `subagent_type` matching EXISTS/USE_EXISTING rows. Paste full DISPATCH_PROMPT as the task prompt. `via=task\|agent` + `agents=route3-…`. |

Always log after invoke:

```text
BUILDER_DISPATCH: primary=<codex|kimi|native> via=<codex-exec|kimi-cli|task|agent> agents=<name|STATUS,…> at=<ISO>
```

Example:

```text
BUILDER_DISPATCH: primary=native via=task agents=route3-api-expert|EXISTS,route3-ui-expert|USE_EXISTING at=2026-08-08T00:00:00Z
```

Before done: `assert-build-route.sh --require-dispatch` (requires `AGENT_MAP:` in PLAN) + `check-plan-done.sh`.
