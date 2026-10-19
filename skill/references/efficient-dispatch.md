# Efficient dispatch

Choose the smallest team that can finish correctly. Direct execution is valid
for isolated work; one expert owns a coherent feature. Parallel agents need
independent deliverables and disjoint ownership. Use available host agents by
actual tool identity, attaching a Route3 specialist reference when useful.
A specialist name in a markdown file does not make that runtime agent available.

A useful brief contains: the user's request verbatim, `READ_AS`, exact owned
paths, `DONE_WHEN` acceptance checks, `MUST_NOT_CHANGE` with reasons, necessary
facts, dependencies and expected return (see `intent-fidelity.md`). Tell the
agent to stop and report on ambiguity instead of improvising another task. State that others share the
workspace and their changes must be preserved. Prefer fresh context with explicit
paths over a full conversation fork. Do not pass every reference or agent roster.
Do not restart discovery already completed by another agent.

For supplied document resources, use [markitdown.md](markitdown.md) before handing
off analysis. Pass the original path/hash, derived Markdown path, relevant
headings or line ranges and extraction warnings. Reuse the verified conversion
instead of passing binary files or duplicating full document text in each brief.

Record actual agent ID/provider, why selected, start/end, state and changed
artifacts. For provider quota/auth errors, surface the failure and use a supported
alternative with the same acceptance criteria. Check whether the first attempt
already changed state before retrying. Do not invent a successful dispatch.
Respect configured permission modes; unattended agents must not bypass approval
or sandbox controls to make a UI job succeed.

Reusing an agent saves its existing understanding only when the task is related.
Use an independent reviewer for meaningful correctness/process-control risk,
providing the diff, acceptance checks and test evidence. Do not preload the
reviewer's desired verdict. At completion return paths, behavior, checks and
limitations in a concise handoff. Failed checks require specific corrections,
not a new broad architecture discussion.

Legacy factory runs continue to use their dispatch token and writer ACK contract.
They are an explicit workflow, not required ceremony for every Route3 invocation.

## Browser task delegation

Use [webbrain.md](webbrain.md) when the task needs the user's signed-in browser
and WebBrain tools are actually available. Pass a bounded goal, intended site /
account / tab, authorized operations, acceptance checks and result schema. Keep
its browser task `run_id` distinct from host agent/session IDs. It delegates to
the extension's configured model; preserve that model and disclose its identity
as unknown if unobservable. A timeout does not authorize launching a duplicate
task or replaying the same action through another browser backend.
