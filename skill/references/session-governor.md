# Session governor

The CLI reads bounded local logs without sending their contents to a model.
Use `node <skill>/scripts/session-budget.js status --cwd <project>` or
`--session <session-id>`. `snapshot` additionally saves a private JSON snapshot
in `<cwd>/.workflow/route3/SESSION_SNAPSHOT.json`. Never monitor an unrelated
session as if it were the active one; multiple matches must remain separate.

## Accounting contract

- Codex cumulative `total_token_usage` is a session counter: use the latest
  counter; do not sum cumulative snapshots. `last_token_usage` estimates the
  latest request's context; `model_context_window` supplies its denominator.
- Claude usage must deduplicate assistant message IDs. Input totals include
  uncached input plus cache-read and cache-creation input exactly once.
- Cache-read is part of input, not additional input on top of provider totals.
  Cached tokens can still occupy context and can still incur charges.
- OpenClaw session records may contain counters and provider message usage;
  do not count an index and transcript as two sessions.
- Missing counters/windows are null, not zero. Tail-only observations are
  partial lower bounds. Aggregate figures describe only the displayed sample,
  never all-time/account billing. Prices are not inferred from model names.
- Context is the latest measured/request proxy, not cumulative spend. The
  runtime may expose a more authoritative active-context measure; prefer it.

## Decisions and savings

Check at task boundaries, not after every token. The dashboard can poll on its
own; do not relay its JSON into the model repeatedly. Establish a baseline for
this run. Compare counters only for the same session/provider and monotonic
counter epoch. A lower/new counter starts a new baseline, not negative spend.

When growth is high, inspect cheap signals first: cache proportion, last input,
output, retries and already-known oversized tools. For each proposed saving
record the cause, evidence and action. Do not assert that tools/system prompts/
reasoning caused a specific percentage unless that category was measured.

Reduce repeat reads, cap output, search symbols first, and pass references to
artifacts instead of full logs. Avoid new agents for tiny tasks. Do not trade
correctness or required verification for a smaller token number. Honor explicit
user budgets; never create a budget or goal on the user's behalf.

## Checkpoint and compact

65/80/90 percent correspond to prepare/recommend/urgent. Apply them only with a
known context window and an honest measurement/proxy label. Absolute spend
alone never triggers compact. Compaction can cost tokens and lose detail; wait
for a coherent boundary, not the middle of a write or external transaction.

Write a checkpoint through stdin:

```bash
node <skill>/scripts/session-budget.js checkpoint --cwd <project> < checkpoint.json
```

Required JSON: `goal` (string), `nextAction` (string), `constraints` (array),
`changedFiles` (array), `verification` (array), `blockers` (array), `authorization`
(array). Keep it under 32 KB and omit secrets. The CLI atomically writes
`.workflow/route3/CONTEXT_CHECKPOINT.json` with private permissions.

Then use the host's supported compact operation if available. Do not edit or
truncate provider logs or session databases. If no compact API exists, report
that limitation and resume a new host session with the checkpoint only when the
host/user supports it. Never claim that saving the file reduced active context.
After actual compact, reread the checkpoint and verify task identity, permissions,
changed files and next step. Continue the same objective.
