---
name: route3
description: >-
  Coordinate Route3 agent work with measured session/token monitoring, bounded
  context handoffs, class-aware agent routing, and a local Mac control center
  for agents, OpenClaw, browser and Telegram operations. Use for /route3,
  Route3 maintenance, multi-expert builds/reviews and supervised automation.
---

# Route3 — supervised, measurable execution

Complete the user's requested outcome. Preserve their model preferences,
existing authorization, files and running work. This entrypoint is the current
operating contract; older factory/clarify references apply only when that
explicit mode is selected, not as universal approval or ceremony requirements.

## Start cheaply

1. Read project instructions and inspect only enough state to identify the goal,
   acceptance checks and existing work. Resolve discoverable facts locally.
   Ask only for missing information that changes the result; continue independent
   work while waiting. Existing authorization does not need another confirmation.
2. Measure the relevant session with `node scripts/session-budget.js status
   --cwd <workspace>` (paths relative to this skill). If the runtime reports a
   session ID, use `--session <id>` to avoid confusing sibling sessions. Unknown
   telemetry stays unknown. Do not load transcripts into the model to count them.
3. Choose one execution lane: direct for small isolated work; one expert for a
   substantial coherent task; independent writers plus reviewer when parallel
   work or a separate review has concrete value. Delegate only bounded work with
   explicit ownership; identify the actual available agent, not an invented type.
4. Record a short plan and acceptance checks for substantial work. Default
   evidence lives under `.workflow/route3/`. No D1–D11 form or paid connectivity
   probes are needed for an already clear request.

## Session supervision (every Route3 run)

Read [session-governor.md](references/session-governor.md) once for measured
usage semantics, thresholds, checkpointing and recovery. Check telemetry at
start, before a new dispatch, after a large tool result or retry, and before
handoff/completion. Monitor the main session and dispatched sessions separately.

- Explain token growth using evidence: new input/output, cache share, measured
  tool output, repeated reads, retry count, or duplicated handoff content. Never
  label an estimated character count as a provider token measurement.
- Use existing configured context windows. Cumulative token spend is **not**
  context occupancy. Do not decide to compact from lifetime spend.
- At 65% measured occupancy prepare a checkpoint; at 80% recommend compact at a
  safe boundary; at 90% avoid another broad dispatch until checkpoint/recovery.
  These are operational defaults, not provider limits. If occupancy is unknown,
  use runtime warnings and record the uncertainty rather than guessing a limit.
- Save goal, user constraints/authorization, changed files, checks, blockers and
  exact next action before compact. Compact only through the current host's
  supported mechanism. A checkpoint file is **not** a compact operation; report
  `checkpoint_saved`, `compact_requested`, or `compact_confirmed` accurately.
- No unattended retries without a stopping condition. Retry only a transient
  failure, at most twice per operation; preserve state and explain persistent
  failure. A failed write must be reconciled before failover/replay.

## Dispatch and routing

Read [efficient-dispatch.md](references/efficient-dispatch.md) before delegation.
Prefer the user's installed routing order: code Kimi → Codex; design Gemini;
planning/discussion z.ai, with available alternatives. The host's capabilities
and explicit user model choice win. CLI presence does not prove authentication
or quota. Do not send paid "reply OK" prompts just to discover availability.

Pass a compact brief: goal, scope, owned files, relevant symbols/paths, acceptance
checks, constraints, and return format. Default to fresh bounded context; share
full history only when continuity needs it. Reuse a relevant existing agent.
Use the context engine only where its map saves reading; do not load every skill,
team roster or reference. Reviewer reads evidence/diff, not the writer's confidence.

For existing artifact factory runs, preserve its actual dispatch tokens, stage
state and ownership gates; read `references/factory-contract.md` and the needed
scripts. Never manufacture user approval, writer acknowledgements or test results.
Use `scripts/route-slice.sh` only for that legacy route contract; its explicit
`--probe` mode can invoke paid agents. Normal control-center discovery is local.

## Mac control center and integrations

Read [control-center.md](references/control-center.md) when launching or changing
agent, OpenClaw, browser or Telegram management. The panel launches real installed
CLIs and shows measured sessions and process results. Commands are capability
checked; unavailable credentials or services appear as unavailable/error.

External messages require the user's explicit authorization. Preserve existing
bot tokens and gateway settings. Never include secrets or full private transcripts
in UI diagnostics, checkpoints, commits or agent handoffs. Stop only processes
owned by this run, except an explicitly requested service lifecycle action.

## Finish with evidence

Run checks proportionate to the change and inspect the result. Fix failures and
repeat affected checks. Record the remaining limitations honestly. For code and
service control changes use an independent review when practical. Report what
works, how it was verified and any real blocker. Commit/push/publish only within
existing user authorization. A new user message steers the active task unless it
clearly replaces or cancels it.

## Load only the relevant depth

| Need | Reference |
|---|---|
| Session usage, compact, checkpoint | `references/session-governor.md` |
| Expert selection, ownership, bounded briefs | `references/efficient-dispatch.md` |
| Mac panel, agents, OpenClaw, browser, Telegram | `references/control-center.md` |
| Telegram remote tasks, pairing, background service | `references/remote-telegram.md` |
| Repository symbol map | `references/context-engine.md` |
| Explicit artifact factory / legacy run | `references/factory-contract.md` |
| UI / product checks | `references/product-engineering.md` |
| Domain teams | the matching `teams/*.md` only |
