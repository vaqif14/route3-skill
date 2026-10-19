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

## Intent fidelity (every Route3 run)

Before delegating, write `.workflow/route3/INTENT.md` (verbatim `REQUEST`,
`DONE_WHEN`, `ALLOW`/`FORBID`) and run `scripts/check-scope.sh --lock`; only the
user widens scope. Trust the scope gate, not the agent's report — see
[intent-fidelity.md](references/intent-fidelity.md). The Stop hook enforces it
when Route3 hooks are installed; otherwise it is advisory.

## Read supplied resources through Markdown

When the user supplies a document, PDF or downloadable file resource, follow
[markitdown.md](references/markitdown.md): obtain the actual local file, convert
supported formats with MarkItDown, then work from relevant Markdown sections.
Reuse existing Markdown. Preserve the original, source hash and extraction
warnings; do not mistake blank text, image metadata or partial extraction for
complete content. Check the original with native PDF/Office/image tools when
layout, scans, formulas or exact values matter. This intake rule applies to
supplied resources, not every source-code file opened during repository work.

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

For unfamiliar behavior spanning files, optional `context/ctx.sh search "question"
--root <directory>` runs Route3's local content ranking and import follow-up,
returning line-numbered source evidence before dispatch. It needs only Node and
Git, with no Jevgrep CLI, model, account or service. Keep exact symbol/path
lookups targeted. Read the returned excerpts once, pass a bounded relevant
selection to the writer, and preserve incomplete/unavailable status. Ranking is
lexical and structural, not learned semantic understanding. Do not ask each
agent to repeat the same search. Limits and factory opt-in are in
[context-engine.md](references/context-engine.md).

For existing artifact factory runs, preserve its actual dispatch tokens, stage
state and ownership gates; read `references/factory-contract.md` and the needed
scripts. Never manufacture user approval, writer acknowledgements or test results.
Use `scripts/route-slice.sh` only for that legacy route contract; its explicit
`--probe` mode can invoke paid agents. Normal control-center discovery is local.

## Mac control center and integrations

Agents drive the control center through the CLI, not the panel: `route3-skill
state | jobs | night | brain | experts | telegram` prints JSON and never prompts
(see [cli-client.md](references/cli-client.md)). The panel is the human view of
the same server. Read [control-center.md](references/control-center.md) when launching or changing
agent, OpenClaw, browser or Telegram management. The panel launches real installed
CLIs and shows measured sessions and process results. Commands are capability
checked; unavailable credentials or services appear as unavailable/error.

For tasks needing an existing signed-in browser session, read
[webbrain.md](references/webbrain.md). Use an available purpose-built connector
first when it fits; WebBrain is an optional task-level browser backend, not an
assumed installed tool or a built-in control-center button. Verify the connection,
choose Ask/Act within the requested scope, and retain its run ID for recovery.

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

## Improve from observed outcomes

When asked to optimize Route3, a capability, prompts or model routing, read
[measured-improvement.md](references/measured-improvement.md). Map the relevant
capability to its actual files, diagnose observed failures, freeze the evaluation
protocol, and compare a bounded candidate against the incumbent on the same cases.
Keep correctness gates separate from token, latency and cost measurements. Unknown
or incomplete evidence cannot establish a winner. Retain the incumbent on ties or
regressions; preserve explicit model choices even when another model scores better.

Ordinary task completion does not require an optimization experiment. Lessons are
evidence for a future change, not permission for automatic skill rewrites. The
local workflow requires no service; read [overmind.md](references/overmind.md)
only for an actual Overmind integration or experiment.

## Load only the relevant depth

| Need | Reference |
|---|---|
| Intent contract, scope audit, misread correction | `references/intent-fidelity.md` |
| Session usage, compact, checkpoint | `references/session-governor.md` |
| Supplied files/PDFs → Markdown before analysis | `references/markitdown.md` |
| Capability diagnosis, paired evals, candidate adoption | `references/measured-improvement.md` |
| Optional Overmind MCP, tracing and optimizer | `references/overmind.md` |
| Expert selection, ownership, bounded briefs | `references/efficient-dispatch.md` |
| CLI client for jobs, Night Shift, brain, experts, Telegram | `references/cli-client.md` |
| Mac panel, agents, OpenClaw, browser, Telegram | `references/control-center.md` |
| Signed-in browser tasks, structured extraction, WebBrain MCP | `references/webbrain.md` |
| Telegram remote tasks, pairing, background service | `references/remote-telegram.md` |
| Repository symbol map and local code discovery | `references/context-engine.md` |
| Explicit artifact factory / legacy run | `references/factory-contract.md` |
| UI / product checks | `references/product-engineering.md` |
| Domain teams | the matching `teams/*.md` only |
