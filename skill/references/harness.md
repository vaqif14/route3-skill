# Graph → Harness

Callers: `SKILL.md`, [execution-graphs.md](execution-graphs.md),
`control-center/graph-runtime.js`. Policy and report implementation:
`control-center/harness-runtime.js`.

The graph defines tasks, dependencies, teammates and bounded execution loops.
The harness supervises those operations: what may start, what evidence was
produced, when new work must pause, and which recovery actions remain valid.
The main agent still carries the user's intent; provider jobs retain their
existing models, credentials, permissions and process controls.

For improving the harness itself, use the optional
[Harness² refinement workflow](recursive-harnessing.md). It proposes harness
edits, probes their behavior and composes an adopted task output. That local
helper is separate from these server execution limits; it does not supervise
native processes or increase permissions.

## Define limits before execution

An optional `harness` object in the graph definition sets immutable limits:

```json
{
  "harness": {
    "maxAgentAttempts": 4,
    "maxElapsedMs": 1800000,
    "maxConcurrentTasks": 1
  }
}
```

This is a field within the complete version 1 graph schema, not a standalone
graph. It enters the reviewed definition hash; changing a limit creates a new
definition. Existing definitions without the field keep their original hashes
and use the defaults below.

| Limit | Default | Allowed | Counts / behavior |
|---|---:|---:|---|
| `maxAgentAttempts` | 120 | 1–120 | Sum of persisted graph agent dispatch intents across tasks and loop attempts. Unknown dispatch counts; a known capacity rejection is rolled back. |
| `maxElapsedMs` | 3,600,000 | 100–86,400,000 | Wall-clock window from the first start, including preparation, permissions, pauses and server downtime. Terminal completion freezes elapsed reporting. |
| `maxConcurrentTasks` | 2 | 1–2 | Per-graph preparations, running checks/jobs and permission waits; the existing global two-graph-task and JobManager limits still apply. |

Agent attempts are **not** billed requests, tokens or cost. JobManager's own
provider failover can invoke a successor without another graph attempt. A known
provider rejection may also consume an intent without billable work. Use actual
provider telemetry for accounting; harness reports mark token usage and cost
unknown. These are execution limits, not a dollar budget or model preference.

## Run and inspect

```bash
route3-skill graphs create --prompt "Implement the authorized change" \
  --check-argv '["npm","test"]' --attempts 2 \
  --max-agent-attempts 2 --max-elapsed-ms 1800000 --max-concurrent-tasks 1
route3-skill graphs show <id>
route3-skill graphs start <id> --hash <definitionHash>
route3-skill harness report <id>
```

For JSON `--file`/`--from-stdin`, put the limits in `definition.harness` instead
of prompt flags. A source revision key still deduplicates unchanged graph work.
Creation, reporting and queue readiness do not call a model. A leading local
acceptance check can also skip already-satisfied work before any agent launch.

The harness checks limits before dispatch and again after asynchronous agent
preparation, so delayed notebook resolution cannot bypass an elapsed/attempt
limit. Preparation consumes a concurrency slot. Limit exhaustion pauses **new**
work; running jobs/checks may finish. This is a dispatch deadline, not a hard
kill timer for the entire graph. Checks and jobs retain their own timeouts.

An agent-attempt pause still permits the verifier already earned by a completed
loop agent, within the time and concurrency limits. It permits no new agent job
or standalone check. Manual pause and elapsed-time expiry stop all new dispatch.
Increasing limits in place or repeatedly resuming cannot replenish the budget.
Inspect prior effects before starting a new reviewed source revision.

## Observation contract

`GET /api/graphs/:id/harness` and `harness report` return the same document:

| Field | Meaning |
|---|---|
| `status`, `summary` | `success`, `warning` or `error` plus a short explanation of current supervision state. A successful report request does not prove the user goal is complete. |
| `runStatus`, `pauseReason` | Actual graph lifecycle and manual/attempt/time pause reason. |
| `policy`, `usage` | Validated limits; persisted agent attempts, elapsed milliseconds and active task count. |
| `verification` | Passed/failed check ids, completed agent-only tasks, failed tasks and unknown outcomes. |
| `next_actions` | Concrete review/start, permission review, reconciliation, resume or inspect/cancel/new-revision advice appropriate to actual state. These are suggestions, never authorization. |
| `artifacts` | Graph id, reviewed definition hash and known current/historical job ids. |
| `events`, `coverage` | Latest up to ten sanitized transition records, retention/truncation coverage and explicit unknown cost/token fields. |

An agent process completing is classified separately from a verifier passing.
Semantic acceptance still depends on sound checks and review of the actual
artifact. Failure handlers can produce a successful graph containing failed
parent receipts; the harness reports a warning. Storage/scheduler faults always
remain errors and do not suggest another start/resume through the fault.
Cancelled work prompts inspection of processes and existing effects, without
offering stale permission decisions.

## Journal and recovery

The checkpoint retains up to 100 transition records and at most 32 KiB of event
JSON per graph, dropping the oldest records first. Records contain lifecycle,
changed task states, attempt counts, job ids and claimant ids. They exclude goal,
prompt, message bodies, provider transcripts and check output. Recovery emits a
fresh state observation; this is a bounded local journal, not a complete audit
archive. Use full graph/task and job receipts when more evidence is required.

The first start timestamp and attempts survive restart; resuming does not reset
them. Older checkpoints gain harness state without changing graph hashes. For
already-started old runs, creation time is used conservatively when their exact
start time was not previously retained. Corrupt harness state fails closed.
State and journal share the graph manager's private atomic checkpoint and owner
lock; no second persistent queue or provider retry mechanism is introduced.

Unknown agent execution suggests attaching only a job matching the saved intent,
or explicitly recording failure. An uncertain check permits explicit failure
after inspection; it cannot attach to a provider job. A reconciliation decision
does not replay the uncertain operation. See
[graph recovery commands](execution-graphs.md#lifecycle-verification-and-recovery).

Provider approval remains a real user decision through normal job controls.
Harness reports never approve a request, raise a permission mode, edit provider
configuration, invoke a paid decision service or claim a token saving percentage.
