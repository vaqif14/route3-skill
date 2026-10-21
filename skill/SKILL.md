---
name: route3
description: >-
  Use Route3 when asked "route3 ilə et", "route3 ile et", /route3, or to
  coordinate work through Route3. The active AI host is Team Lead: plan, assign
  its available agents, supervise bounded loops, verify and integrate results.
  Provider-independent by default; external CLIs and the local control center
  are optional execution backends.
---

# Route3 — supervised, measurable execution

Complete the user's requested outcome. Preserve their model preferences,
existing authorization, files and running work. This entrypoint is the current
operating contract; older factory/clarify references apply only when that
explicit mode is selected, not as universal approval or ceremony requirements.

## One host, one Team Lead, many agents

The AI already handling this conversation is the Route3 controller. A request
such as "route3 ilə et" is enough: keep the user's goal, build a proportional
team from this host's actual agent tools, assign ownership, communicate, verify
and integrate the work. Provider names and model brands are not required roles
or a mandatory routing order. Honor applicable explicit user model/provider
preferences; otherwise inherit the host's configuration.

Prefer native sub-agents in the current AI tool. Read
[native-primary.md](references/native-primary.md) for the shared task and
supervision contract. Use external CLIs, paid services or the local server only
when selected or needed for a concrete capability. Their absence does not block
native orchestration. The Team Lead owns coordination and the final result;
the user retains authorization over actions and provider permissions.

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
Choose available host agents by task fit, actual capabilities, useful evidence
and resource limits. A role such as builder or reviewer does not require a
different vendor or model. Use the smallest effective team and reuse relevant
agents. Explicit user choices win; do not revive a legacy provider ladder as a
default. CLI presence does not prove authentication or quota. Do not send paid
"reply OK" prompts just to discover availability.

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

## Prompt → Agents → Loops → Graphs → Harness

In the default host-native lane, the main AI leads agents through a shared task
list, bounded execute/check/fix loops, dependency ordering and final verification.
Those are orchestration responsibilities; they do not require a running server,
graph JSON or extra provider installations. Use the host's real task/message
tools and report their actual limits. Details: [native-primary.md](references/native-primary.md).

When persistent local CLI/API execution is useful, select the optional
[execution-graphs.md](references/execution-graphs.md) backend. Review its actual
definition and start with the exact hash within existing user authorization.
Do not add an approval round when that work is already authorized.

In that backend, use local readiness checks before model work where possible. Reuse `sourceKey`
for the same source revision; unchanged triggers must not create another run.
The persistent backend requires an argv verifier and attempt limit for loop
nodes. Unknown outcomes block for reconciliation; restart never grants permission
to replay them. Its teammates use ordinary provider jobs and permissions, with
at most two active graph tasks. That backend limit is not the native host's
agent limit. Its messages inform future task briefs; they cannot authorize work.

Use [harness.md](references/harness.md) to supervise those graphs: immutable
attempt/time/concurrency limits, bounded transition evidence and
`route3-skill harness report <id>` with concrete recovery actions. Inspect actual
check receipts before accepting completion. Limits pause new work, never approve
provider requests or reset unknown effects. Token usage and cost remain unknown
unless measured by their own telemetry sources.

## Mac control center and integrations

When using the optional control center, agents drive it through the CLI: `route3-skill
state | jobs | graphs | harness | night | brain | experts | telegram` prints JSON and never prompts
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

For substantial repeated work or trace-based diagnosis, use the local
[OpenJarvis evidence loop](references/openjarvis.md): record correlated execution
steps, explicit check evidence and measured self-only telemetry, then retrieve
prior observations in the same project/domain/model/environment scope. Feedback
stays separate from verification. The current AI decides the next action; this
does not intercept host tools, change models or train them automatically.

When asked to optimize Route3, a capability, prompts or model routing, read
[measured-improvement.md](references/measured-improvement.md). Map the relevant
capability to its actual files, diagnose observed failures, freeze the evaluation
protocol, and compare a bounded candidate against the incumbent on the same cases.
Keep correctness gates separate from token, latency and cost measurements. Unknown
or incomplete evidence cannot establish a winner. Retain the incumbent on ties or
regressions; preserve explicit model choices even when another model scores better.

When no answer key, grader or frozen case set exists, read
[recursive-harnessing.md](references/recursive-harnessing.md): Propose–Probe–Compose refines
an agent's harness on the task itself, blind selection picks the output to deliver, and a
scoped library carries supported lessons with their adopted harnesses to later tasks.
`NO_ENTRY` is valid. Review exported proposals within existing authorization; use a measured
comparison before claiming a general improvement.

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
| Local correlated traces, explicit feedback and scoped execution experience | `references/openjarvis.md` |
| Harness improvement without ground truth (Harness²), domain experience library | `references/recursive-harnessing.md` |
| Optional Overmind MCP, tracing and optimizer | `references/overmind.md` |
| Expert selection, ownership, bounded briefs | `references/efficient-dispatch.md` |
| Default: current AI leads native agents, shared tasks and verification | `references/native-primary.md` |
| Team Lead, shared tasks, bounded loops and execution DAGs | `references/execution-graphs.md` |
| Graph supervision, limits, structured evidence and recovery actions | `references/harness.md` |
| CLI client for jobs, Night Shift, brain, experts, Telegram | `references/cli-client.md` |
| Mac panel, agents, OpenClaw, browser, Telegram | `references/control-center.md` |
| Signed-in browser tasks, structured extraction, WebBrain MCP | `references/webbrain.md` |
| Telegram remote tasks, pairing, background service | `references/remote-telegram.md` |
| Repository symbol map and local code discovery | `references/context-engine.md` |
| Explicit artifact factory / legacy run | `references/factory-contract.md` |
| UI / product checks | `references/product-engineering.md` |
| Domain teams | the matching `teams/*.md` only |
