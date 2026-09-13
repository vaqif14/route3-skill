# Route3 architecture

## Current operating contract

`skill/SKILL.md` is the short entrypoint. Session governance, efficient dispatch
and control-center operations are loaded only as needed. It does not require
factory ceremony for ordinary tasks. Existing factory references/scripts retain
their stage/token/evidence contract when that workflow is explicitly selected.

## Data flow

```text
Codex / Claude / OpenClaw local logs
                 │ bounded, read-only parsing
                 ▼
             telemetry.js ──► session-budget.js (status / snapshot)
                 │
                 ▼
Native Mac app ── local HTTP server ── browser interface
                        │ allowlisted argv, owned subprocess groups
                        ├─ agent CLIs (their configured auth/models/policies)
                        │    └─ Kimi: ACP over stdio (acp.js)
                        │         session/request_permission ──► panel approval
                        │         session/cancel ──► graceful job stop
                        └─ OpenClaw CLI (gateway / browser / Telegram channel)
```

Kimi jobs never run in prompt mode, which would bypass approvals. `acp.js`
speaks newline-delimited JSON-RPC over stdio, defers `session/request_permission`
server requests into job state (`awaiting_approval` plus permission cards in the
panel), answers unknown server requests with a JSON-RPC error so an agent never
hangs, and answers every open approval with `cancelled` when a job is stopped.

The native Mac app owns at most one server process: it attaches to a healthy
server when one exists, starts `node control-center/server.js` only when the
port is dead, and on quit stops only a server it started itself.

Telemetry never returns raw prompts/tool payloads. Usage is cumulative spend or
observed-message spend, labeled separately from latest-request context occupancy.
Cache input semantics are normalized without double-counting. A bounded tail
cannot prove complete lifetime totals. Unknown context windows stay unknown.

## Process and HTTP boundaries

The server listens only on loopback. Host checks prevent rebinding; Origin and a
per-process token protect mutations. Requests have bounded bodies; commands use
argv arrays and never a client-supplied shell string. Jobs have a concurrency cap,
output cap, timeout and owned-process cancellation. Logs are redacted before
return. Provider authentication stays with each provider; the control center does
not change approval policies. Integration actions are limited to implemented
lifecycle/status operations, not arbitrary gateway RPC or Telegram messaging.

## Recovery

The checkpoint CLI atomically writes a small private artifact containing the goal,
constraints, authorization, changed paths, verification, blockers and next action.
It never edits host transcript/session storage or claims to have compacted a host.
After supported host compaction, the orchestrator resumes from this artifact.

The skill installer stages changes, preserves local additions and retains the
previous destination as a timestamped backup outside skill discovery, including
symlink destinations.
Global hook configuration and existing credentials are not replaced. Factory
context graphs and lessons remain per-workspace data under `.workflow/route3/`.

## Validation boundaries

Automated tests use fixture transcripts, temporary files and fake executables.
They verify accounting and safety invariants without spending model tokens or
changing a live gateway. Native app compilation and a browser interaction smoke
check validate delivery separately. Successful fixture tests do not prove a
provider account has valid credentials or sufficient quota.
