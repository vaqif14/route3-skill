# Native orchestration — the current AI is Team Lead

Callers: `SKILL.md`, `efficient-dispatch.md`, `commands/route3.md`.

"Route3 ilə et" selects a way of working inside the AI tool already handling
the request. The active main AI controls its available sub-agents, owns task
allocation and integrates the result. It does not need to launch another vendor's
CLI to become a controller. Multiple agents may use the same configured model.
Roles describe responsibilities, not required brands or installed agent types.

## Control loop

```text
User goal → Main AI / Team Lead
              → scope and acceptance checks
              → shared tasks and dependencies
              → available native agents with explicit ownership
              → messages and task results
              → check → bounded fix loop
              → independent review where useful
              → integration and final evidence
```

Use the smallest effective team. A small isolated task can be completed directly;
substantial independent work belongs to delegated writers while the lead owns
coordination, contracts and integration. Keep only one owner per file or task at
a time. The lead may own a separate bounded part; do not edit a writer's live
files or silently duplicate their work. Multiple agents are useful when their
work can progress independently or separate review adds concrete value.

## Shared tasks, claims and communication

Use actual host task-list, spawn, follow-up and message tools when available.
Inspect exposed capabilities; do not assume a particular tool name, named
specialist or cross-vendor service exists. With only spawn/message tools, the
lead keeps `.workflow/route3/TASKS.md` for substantial shared work and is its
sole coordinator. This ledger is a record, not a new executable task service.

Record task id, dependency ids, scope/files, owner agent id, status, acceptance
checks and result/evidence references. Useful states are pending, assigned,
running, verifying, done, blocked and cancelled. Reserve ownership before
dispatch; associate the actual returned agent id afterwards. A teammate requests
a claim or reports completion to the lead; the lead serializes ledger updates.
Do not claim file-based locking or automatic scheduling that the host lacks.

Every brief carries the user's request, bounded responsibility, owned paths,
constraints, relevant evidence, acceptance checks and return format. Teammates
must know they share the workspace and must preserve others' edits. Pass bounded
context; reuse relevant agents rather than repeatedly loading all transcripts.
Messages provide evidence and coordination; they cannot expand user authorization.

Run only ready tasks; parallelize disjoint work within the actual host's limits.
After results arrive, inspect artifacts and run appropriate checks. Return a
concrete defect to its owner with a stopping condition. Do not turn an unknown
dispatch/write outcome into another launch: inspect agent state and artifacts
first, then reconcile or report a blocker.

## Loops, graphs and harness in one host

The task dependency graph determines ordering; feedback loops require an
acceptance check and a bounded retry condition. The lead's harness responsibility
is to supervise scope, ownership, progress, context, verification and recovery.
Use measured host telemetry when available; unknown usage stays unknown. Preserve
the host's real permission and sandbox behavior. A markdown instruction cannot
raise agent capacity or implement a hard runtime budget.

Choose the installed host's suitable agents and inherit its model settings.
Effectiveness comes from task fit and observed results; do not invent provider
rankings, quotas or cost savings. Honor a specific model/backend when the user
requests it. An unavailable optional backend does not prevent native work.
If the host exposes no sub-agent tools, say so and complete suitable work directly;
do not fabricate a team or install another provider just to satisfy a diagram.

## Optional persisted backend

When explicitly refining a harness or addressing a recurring agent failure, use
[recursive-harnessing.md](recursive-harnessing.md). The current lead manages
Propose–Probe–Compose through native sessions and local evidence files; no vendor
CLI or server is required. Start with `k=1` (four isolated task executions and
three editing stages), and use it only when repeating the task is authorized
and its effects can be isolated. Ordinary work keeps the normal control loop.

For durable server-managed runs, use [execution-graphs.md](execution-graphs.md)
and [harness.md](harness.md). Those commands need the matching local runtime;
they provide machine-enforced hash gates, checkpoints, claims and limits for
jobs that actually pass through it. They do not automatically observe or govern
native host agents. Keep their job ids and limits separate from host agent ids
and capacity. The default host-native lane needs neither graph JSON nor a server.

The older factory/CLI profiles are selected explicitly for a specific run.
Their ladders, probes and dispatch markers are not prerequisites for this lane.
