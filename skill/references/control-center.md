# Route3 Control Center

The native Mac app wraps a local web interface backed by dependency-free Node.
Provider credentials are not copied into Route3. Provider CLIs retain their own
login, permission policies and model configuration.

From the Route3 package:

```bash
node bin/route3-skill.js install --all
node bin/route3-skill.js center
node bin/route3-skill.js mac
```

`center` starts the loopback panel at `http://127.0.0.1:43173`. `mac` builds the
AppKit/WebKit application using the local Swift compiler into
`~/Applications/Route3 Control.app` (`--output DIR` and `--open` are supported).
The app attaches to a healthy server, starts and owns one only when none exists,
and on quit stops only a server it started itself. A stopped gateway, missing
login, unsupported CLI or missing Node runtime is an explicit state, not a success.

## Supervision

The session list reads local Codex, Claude and OpenClaw records. Displayed totals
cover the sampled sessions; bounded log tails can be incomplete. Context gauges
label last-request proxies and unknown windows. Recommendations do not perform
compaction. Use `scripts/session-budget.js checkpoint` before a supported host
compact action; do not truncate transcripts or patch a host's session database.

Agent jobs use fixed CLI argument arrays and a bounded stdin brief, with a
concurrency limit, timeout, bounded log tail and cancellation of owned processes.
A Route3 expert (built-in frontend/backend/fullstack/QA/security or a
panel-created custom expert) prepends its specialty instructions to that brief —
the expert travels with the task to whichever provider runs it; it is not a
separate model or credential. Custom experts live locally, are validated and
redacted, and are created/removed only from the panel with the session token.
Kimi jobs run over ACP instead: the agent's `session/request_permission` requests
become decision cards in the panel, unknown agent requests are answered with a
JSON-RPC error rather than hanging, and stopping a job denies every open approval.
Do not repeatedly launch a failed job without reading its error and reconciling
any changes. Presence on PATH is discovery only; actual invocation can still fail
authentication, quota, permission or model checks.

## Integrations

OpenClaw gateway and browser controls use the installed CLI's supported lifecycle
commands. Telegram status and per-account start/stop use the existing gateway
channel integration; they preserve its credentials. Probing status does not send
chat messages. For sending messages, changing bot credentials, external publishing
or other actions outside the current authorization, obtain the user's specific
instruction first. Do not expose tokens in logs or commit configuration backups.

The local server uses loopback binding, Host/Origin validation and per-process
mutation tokens. Do not expose it through a public tunnel or disable those checks.
Use the chosen project workspace for agent execution; any broader permissions
remain subject to the agent's configured policy. Quitting the app must not stop
an independently running server or unrelated gateway.

## Continue from Telegram

Use [remote-telegram.md](remote-telegram.md) for the dedicated paired bot and
macOS background service. This bridge stores its own locally entered bot token
privately; it does not import or modify OpenClaw credentials. Pairing explicitly
authorizes task replies and approval requests to the paired private account.
Each remote command remains subject to the project's provider policies.
