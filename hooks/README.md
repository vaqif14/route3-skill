# Route3 enforcement hooks

Turns Route3's governance from **honor-system prose** into **mechanical gates**.
The audit finding was: the scripts existed but nothing forced the model to run
them. These hooks make the harness itself enforce the two core rules.

| Hook | Event | Enforces |
|---|---|---|
| `guard-boss-write.sh` | `PreToolUse` (Edit/Write/MultiEdit/NotebookEdit) | Hard rule #1/#13 — boss never hand-edits product files while a route is live. Denies the tool call. |
| `guard-done.sh` | `Stop` | Hard rule #12 — cannot end the turn until `assert-dispatch-evidence.sh` + `check-plan-done.sh` pass. On pass, stamps `DONE_OK`. |

## Design guarantees

- **No-op outside Route3.** Both hooks return "allow" unless `.workflow/route3/ROUTE_LAST.txt`
  has a live `ROUTE_DECISION` and no `DONE_OK`. Normal sessions are never touched.
- **Loop-safe.** `guard-done.sh` allows Stop when `stop_hook_active=true`, so a
  genuinely stuck run can never be permanently trapped.
- **Sanctioned escapes.** `guard-boss-write.sh` allows the edit when a
  `BOSS_EXCEPTION` file is logged (bounded micro-fix, hard rule #5) or the plan is
  `status=SKIPPED_TRIVIAL`. Boss meta-edits (the skill, PLAN, `.workflow/`) always pass.

## Install (opt-in)

```bash
hooks/install-hooks.sh --settings ~/.claude/settings.json      # global
hooks/install-hooks.sh --settings .claude/settings.json        # project
hooks/install-hooks.sh --settings .claude/settings.json --uninstall
```

## Prove it

```bash
hooks/test-hooks.sh                     # 13 hermetic cases, exit 0 = all pass
scripts/eval-outcome.sh                 # build-output quality scorer (discriminates)
hooks/consolidate-agents.sh             # dry-run agent-sprawl consolidation (reversible)
```

## Test-time / portability knobs

| Env | Effect |
|---|---|
| `ROUTE3_STATE_DIR` | Override the state dir (hooks read this; used for hermetic tests) |
| `ROUTE3_CODEX_MODEL` | Override codex model id (default `gpt-5.6-sol`) |
| `ROUTE3_KIMI_MODEL` | Override kimi model id (default `kimi-code/k3`) |
