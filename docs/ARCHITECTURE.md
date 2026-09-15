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

The expert layer (`experts.js`) is provider-agnostic: a curated set of internal
specialties (frontend, backend, fullstack, QA, security) plus panel-created
custom experts are stored in `~/.local/share/route3/experts.json` (atomic,
private, bounded, redacted). Selecting an expert prepends its specialty brief to
the job brief, so the same expert works unchanged across Codex, Claude, Gemini
and Kimi/ACP; the provider still executes with its own models and permissions.

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
lifecycle/status operations, not arbitrary gateway RPC. The dedicated Telegram
bridge accepts only paired private-chat commands; it does not use gateway tokens.

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

## Telegram and background runtime

`telegram-bridge.js` long-polls Telegram over outbound HTTPS. The local panel
validates credentials and issues expiring random pairing codes. A paired user ID,
private chat ID and configured workspace form the remote authority boundary.
Update offsets persist before dispatch, giving at-most-once command execution:
a crash between receipt and dispatch can drop a command, but cannot replay it.
Replies can duplicate when delivery succeeds but saving its receipt fails.

Only remotely started or explicitly watched jobs produce proactive notifications.
ACP callbacks carry opaque handles bound to the exact job, request, offered option,
user and chat. Their 10-minute lifetime and live-request validation reject replay.
Transient network failures retry with bounded backoff; token and competing-poller
errors halt polling. Another instance's poller lock prevents configuration writes.

`job-history.js` stores at most 100 jobs, bounded redacted briefs and log tails in
private per-workspace files. Active jobs restore as interrupted, with no pending
permissions or automatic rerun. Continuation uses a new session and a bounded
handoff. CLI servers opt into persistence; test servers do not unless requested.

`background-service.js` installs only the user's named LaunchAgent, using fixed
argv and an explicit runtime PATH. The server remains on 127.0.0.1. RunAtLoad and
KeepAlive support login and process recovery; Mac sleep still suspends the bridge.
The native app attaches to this independent server and leaves it running on quit.
