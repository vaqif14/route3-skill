# Intent fidelity — do what was asked, only that, and prove it

Callers: `SKILL.md` (Intent fidelity); `efficient-dispatch.md` (brief);
`scripts/check-scope.sh` (scope audit); `scripts/eval-route.sh` (scope cases).

The most common agent failure is not bad code — it is doing a different task
than the one requested. Berkeley's MAST study of multi-agent traces put ~79% of
failures in specification problems and inter-agent misalignment (disobeyed
spec, task derailment, lost context). Faros' audit of real agent PRs found
wrong-file changes the top failure (31.9%), then instruction conflicts and
unrelated edits bundled into the change. Each rule below closes one of those gaps.

## Failure → countermeasure

| Failure seen in practice | Countermeasure here |
|---|---|
| Agent solves a nearby, easier or "better" problem | Verbatim request anchor + one-line interpretation |
| Loose instructions → model guesses the edges | `ALLOW` / `MUST_NOT_CHANGE` in every brief |
| Ambiguity filled silently with a guess | Ask-vs-assume rule; assumptions stated visibly |
| Constraint read too literally ("don't touch tests" blocks a needed test) | State the purpose of each constraint |
| Subagent gets a paraphrase that dropped a constraint | Brief carries the user's words, not a summary |
| Refactor/format/cleanup bundled into a fix | Scope audit on the diff (`check-scope.sh`) |
| Debug scripts, logs, temp files left behind | Scope audit `SCRATCH` class |
| Reviewer checks quality, not whether it is the asked task | Intent review first, quality second |
| "Done" claimed without evidence per requirement | `DONE_WHEN` → evidence mapping in the report |
| Long session drifts from the original goal | Re-read intent before dispatch, after compact, before finish |
| User correction triggers a broad redo | Minimal correction loop + lesson |

## 1. Anchor the intent (before any change)

Write the intent contract. For direct small work keep it as one line in your
reasoning; for delegated or multi-step work write `.workflow/route3/INTENT.md`:

```text
REQUEST: <user's message, verbatim — never paraphrased>
READ_AS: <one sentence: what I will deliver>
DONE_WHEN:
- <observable check the user would accept, e.g. command + expected output>
ALLOW: <paths/globs this task may change>
FORBID: <paths/globs that must stay untouched>
MUST_NOT_CHANGE: <behaviors, APIs, signatures, formatting, deps to preserve — and why>
ASSUMPTIONS: <defaults chosen for unstated details>
OUT_OF_SCOPE: <nearby things noticed and deliberately left alone>
```

`DONE_WHEN` is written from the user's point of view, not the implementer's.
"Tests pass" is not enough when the user asked for visible behavior.

## 2. Ask or assume — the rule

Ask only when **both** hold: two plausible readings produce materially
different results, **and** the choice is costly to reverse or cannot be
discovered from the repo, memory or project instructions. Otherwise pick the
smallest, most conservative reading, record it in `ASSUMPTIONS`, and say it in
the first user-visible line. Never widen scope silently; never ask what the
code already answers. One batched question beats several rounds.

## 3. Literal words, real purpose

The user's words are the spec. "Fix X" does not authorize improving Y; "make it
faster" does not authorize a rewrite. Problems noticed outside the request go to
`OUT_OF_SCOPE` and the report, not into the diff. Every constraint carries its
purpose so it is applied correctly: "don't weaken existing tests" is not "never
touch test files".

## 4. The brief is the intent contract

Every dispatch passes `REQUEST` verbatim plus `READ_AS`, `DONE_WHEN`, `ALLOW`,
`FORBID`, `MUST_NOT_CHANGE` and the relevant facts. Also state:

- If blocked or the task turns out ambiguous: stop and report the question —
  do not improvise a different task.
- Do not refactor, rename, reformat, upgrade or clean code outside `ALLOW`.
- Return: the `READ_AS` line you worked to, changed files, each `DONE_WHEN`
  item with evidence, deviations and assumptions.

A subagent that returns a different `READ_AS` than the brief is a misread —
correct it before accepting any of its work.

## 5. Drift checkpoints

Before each dispatch or substantial action, name the `DONE_WHEN` item it serves.
If none, do not do it. Re-read `INTENT.md` after a compact or recovery, after a
long tool loop, and before the final report. Checkpoints keep `REQUEST` verbatim.

## 6. Lock the scope, then audit it

```bash
scripts/check-scope.sh --lock    # boss, after INTENT.md is written and BEFORE any dispatch
scripts/check-scope.sh           # anyone, any time: changes since the lock vs ALLOW/FORBID
scripts/check-scope.sh --gate    # what the Stop hook runs; same check, no overrides accepted
```

`--lock` records a sha256 of the `ALLOW`/`FORBID` lines and snapshots the tree
(path, size, mtime). The snapshot is the baseline: files already dirty before
the lock are not blamed, and new, modified and deleted files after it are all
caught, in git and non-git workspaces alike. `ALLOW` that covers the whole tree
(`**`, `*`, `.`) is refused — that is no scope.

- `FORBIDDEN` is always reverted. `UNTRACED` and `SCRATCH` are reverted.
- Widening scope is the user's decision, never the agent's: ask, and only after
  approval edit `INTENT.md` and re-run `--lock`. Every lock is appended to
  `INTENT_LOCK.log`; report each widening. An edit to `ALLOW`/`FORBID` without a
  re-lock fails the gate.
- `SCOPE EMPTY` means nothing changed in the tree. The gate fails on it unless
  `INTENT.md` declares `NO_CHANGE: <reason>` — otherwise the work landed elsewhere.
- Globs: `*` stays in one directory, `**` crosses; `dir/` is the whole subtree.

**Enforcement.** With the Route3 hooks installed (`hooks/install-hooks.sh`), the
Stop guard runs `--gate` whenever a route is live and `INTENT.md` exists: the
turn cannot end while scope fails, and a failure still open on the loop-safe
second stop is shown to the user. Without the hooks these rules are advisory.

## 7. Intent review before quality review

Reviewer receives `REQUEST`, `INTENT.md`, the diff and check output — not the
writer's summary or confidence. Review order:

1. Does it deliver what `REQUEST` asked, as a user would verify it?
2. Does it change anything not asked for?
3. Only then: correctness, safety, style.

A clean, well-tested diff that answers a different question is `FIX`, not `SHIP`.

## 8. Report against the request

Final report maps each `DONE_WHEN` item to evidence (command + result, or what
the user sees). Then: assumptions made, anything not done and why, and
`OUT_OF_SCOPE` items the user may want next. No claim without evidence.

## 9. When the user says "that is not what I asked"

1. Quote the part of `REQUEST` that was misread and state the corrected `READ_AS`.
2. Update `INTENT.md`; change only what the correction requires — no broad redo.
3. Re-run the scope audit and the affected `DONE_WHEN` checks.
4. Record the misread pattern once it is fixed and verified:
   `scripts/record-lesson.sh --title "<misread pattern>" --reason "<what the user meant>" --evidence .workflow/route3/INTENT.md`

## What was measured (2026-09-25)

Two A/B runs, Sonnet subagents, plain brief (user's words only) vs this intent
contract: a one-bug task (n=2 per arm) and an ambiguous multi-file task with a
protected legacy file and cleanup bait (n=5 per arm).

- Diffs: no difference. Every run in both arms that edited its own directory
  made the same minimal one-line fix and left the legacy file and bait alone.
- Cost: the intent arm took longer (75–128 s vs 47–58 s) and used more tool calls.
- The one real failure was in the intent arm: the agent edited a sibling
  directory, then reported the fix as verified with `DONE_WHEN` evidence. Only
  the mechanical check exposed it (`SCOPE EMPTY` in its own tree, hidden test 4/5).

Conclusion: with current models the prose rules mainly improve the report; they
did not change behavior on these tasks. What earned its place is the mechanical
gate — lock, audit against the baseline, and refusing a silent empty change at
the gate (declare `NO_CHANGE: <reason>` in `INTENT.md` when nothing should change).
Small samples; re-measure when models or task mix change.

## Sources

- MAST — Why Do Multi-Agent LLM Systems Fail? (arXiv 2503.13657)
- Faros AI — Why AI coding agents actually fail
- "The what-not-to-change section" (dev.to, 2026)
- Anthropic — Building effective agents; Effective context engineering for AI agents
