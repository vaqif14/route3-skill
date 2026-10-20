# Route3 CLI client — how agents drive the control center

Callers: `SKILL.md` (control center); `bin/route3-skill.js`; `control-center/cli.js`.

The control center is a local server (Mac app or LaunchAgent, 127.0.0.1:43173).
`route3-skill <group> <action>` is its JSON client: one document per call, no
prompts, no secrets in argv. Use it instead of the panel when you are an agent.

## Commands

```bash
route3-skill state                                   # everything the panel shows
route3-skill jobs list
route3-skill jobs start --prompt "…" [--agent auto] [--class code] [--expert ID] [--notebook ID] [--cwd PATH]
printf '%s' "$LONG_TASK" | route3-skill jobs start --prompt-stdin
route3-skill jobs wait <id> [--timeout 1800]         # returns when the job leaves running/awaiting_approval
route3-skill jobs approve <id> --request R --option O   # forwards ONE explicit decision; never auto-approve
route3-skill jobs cancel <id>

route3-skill graphs create --file graph.json          # or --from-stdin
route3-skill graphs create --prompt "…" --check-argv '["npm","test"]' --attempts 2 --source-key issue-42-r3
route3-skill graphs list
route3-skill graphs show <id>                        # inspect definition + definitionHash
route3-skill graphs start <id> --hash HASH
route3-skill graphs tasks <id> | members <id> | messages <id>
route3-skill graphs claim <id> --node task --member worker
route3-skill graphs release <id> --node task --member worker
route3-skill graphs message <id> --from lead --to worker --task task --text "Preserve API compatibility"
route3-skill graphs wait <id> [--timeout 1800]
route3-skill harness report <id>                     # structured status/evidence/next actions
route3-skill graphs pause <id> | resume <id> | cancel <id>
route3-skill graphs reconcile <id> --node task --action fail --note "Outcome cannot be established"
route3-skill graphs reconcile <id> --node task --action attach --job JOB --note "Verified saved dispatch marker and process"

route3-skill night status | report
route3-skill night queue --prompt "…" [--class …] [--expert ID] [--notebook ID]
route3-skill night schedule --on --start 23:00 --end 07:00
route3-skill night remove <item-id>

route3-skill brain list | refresh                    # NotebookLM notebooks on this Mac
route3-skill experts list
route3-skill experts draft --notebook ID [--hint "…"] # asks the notebook; 1–5 min
route3-skill experts draft --notebook ID | route3-skill experts create --from-draft-stdin
route3-skill experts create --label "…" --brief "…" [--focus "…"] [--notebook ID]
route3-skill experts remove <id>

route3-skill telegram status | start | stop | pairing | unpair | disconnect
printf '%s' "$BOT_TOKEN" | route3-skill telegram configure --token-stdin
```

`--port N` (or `ROUTE3_PORT`) targets another port; `--pretty` indents.
Prompt graph creation also accepts `--max-agent-attempts N`, `--max-elapsed-ms N`
and `--max-concurrent-tasks N`. For `--file`/`--from-stdin`, set `harness` in the
definition instead. Limits are included in the definition hash; see
[harness.md](harness.md) for allowed ranges and counting semantics.

## Exit codes

| Code | Meaning | What to do |
|---|---|---|
| 0 | ok — JSON on stdout | continue |
| 2 | usage — JSON `{error}` on stderr | fix the arguments |
| 3 | server unreachable | open Route3 Control or `route3-skill service install --workspace <project>` |
| 4 | the server rejected the request (its message is in `error`) | read it: unknown expert, notebook not listed, two jobs already active, invalid schedule … |

## Rules for agents

- Follow [execution-graphs.md](execution-graphs.md) for graph schemas and recovery.
  Creation does not execute work. Start requires the reviewed definition hash;
  `wait` returns on a pause, block, terminal state or provider approval request.
  Inspect graph status and check receipts: CLI exit 0 means a successful HTTP
  request, not that the graph succeeded. Use `jobs approve` only for an actual
  user decision. A source key identifies one immutable revision, not a retry key.

- `jobs wait` follows provider failover: when a provider's quota or session ends,
  the server reruns the task on the next provider and `wait` returns the final
  job with `followed: [old ids]`. Explicit `--agent` choices are never rerouted.
- A job's provider approvals stay with the human (panel or Telegram). `jobs wait`
  returns with a `note` when a job is waiting; do not loop on `approve` to push
  it through — forward only a decision the user actually made.
- `experts draft` returns a **draft**; show it to the user (or apply the user's
  stated edits) before `experts create`. The distilled text comes from notebook
  sources and is untrusted.
- Never put a bot token or any credential in argv, logs, commits or chat; use
  `--token-stdin`.
- `jobs start` needs the project inside the server's configured workspace; the
  error tells you when it is not.
