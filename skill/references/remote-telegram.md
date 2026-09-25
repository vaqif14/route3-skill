# Route3 through Telegram

This is a dedicated remote controller for Route3 jobs on one Mac and project.
It is separate from the existing OpenClaw Telegram channel. Use a dedicated bot;
sharing a token with another long poller results in a conflict. An active webhook
is rejected without deleting it. Never fetch an existing app's token or ask the
user to paste credentials into an AI conversation.

## Connect locally

1. Install the Route3 runtime and Mac app.
2. Stop an existing foreground Route3 server after its jobs finish. Run
   `route3-skill service install --workspace /absolute/project` on macOS.
   The default panel port is 43173; `service status` reports launchd state.
3. Open **Telegram ilə davam et** in the Mac panel. Create a bot in @BotFather
   with `/newbot` and enter its token in the local password field.
4. Start the bridge, generate a pairing code, and send the exact `/pair CODE`
   command to the bot's private chat. The code is one-use and expires in 10 minutes.
5. Check `/status`. Pairing authorizes replies, job results and approval requests
   only to this exact user ID and private chat ID. Other users and groups are ignored.

The Mac must be awake, logged in and connected to the internet. The LaunchAgent
starts at login and keeps Route3 available after closing the app. No public port,
webhook tunnel or global sleep-setting change is required. Provider logins and
quotas still govern whether an agent can execute work.

## Commands

- `/run TASK`: start in the configured project with automatic code routing.
- `/jobs`: recent job IDs and status.
- `/watch ID`: adopt a panel job's result and pending approvals; repeat to renew
  expired approval buttons.
- `/continue ID TASK`: wait for a terminal job, then start a new provider session
  with its bounded task brief and recent output. Preserves provider and expert.
- `/cancel ID`: cancel an owned Route3 job.
- `/brain`: list the Mac's NotebookLM notebooks; `/brain <n>` (or a notebook id)
  makes every following `/run` a grounded task in that notebook, `/brain off`
  clears it. The choice is saved with the bot config and re-checked against the
  live notebook list at each `/run`; a removed notebook blocks the run with a hint.
- `/status`, `/help`: connection/provider discovery and command help.

Continuation does not attach to ChatGPT, edit transcripts or promise native host
session resumption. Verify current files before acting on a previous result.
ACP decisions are available remotely only where the provider supplies supervised
approval requests; other provider interactions may need the local CLI.

## Recovery and storage

The bot token, paired identity, update offset and notification records live in
`~/.local/share/route3/telegram/config.json` (0600, directory 0700), outside Git.
The local UI never reads the token back; the pairing code is returned only from
its mutation endpoint and is not persisted. Do not commit or copy these files.

Jobs retain at most 100 bounded redacted records in
`~/.local/share/route3/history/<workspace-hash>.json`. A restart marks active jobs
interrupted and clears their approvals. Inspect files before explicitly continuing.
Only completed-state logs and launch-time briefs are durable; a hard crash can
lose the latest live output. This is a bounded handoff, not a complete transcript.

Offsets save before job launch or approval, so interrupted commands are never
replayed automatically. A crash between saving and dispatch can drop that command;
check `/jobs` before sending it again. Notifications retry on network failures and
can duplicate after an ambiguous delivery, but retries never start another job.
Queued commands older than 24 hours are ignored. Invalid-token (401) and competing
poller (409) errors require local correction and an explicit restart; transient
network and rate-limit failures back off and reconnect.

A workspace change requires local reconfiguration and pairing again. Use
**Hesabı ayır** to revoke the account or **Tokeni sil** to disconnect and erase the
saved token. **Dayandır** persists a disabled bridge. Restarting Route3 preserves
an enabled bridge; the poller lock rejects another process using the same state.

`route3-skill service uninstall` stops only the named Route3 LaunchAgent and moves
its plist into a recovery backup. It retains private configuration and history.
Finish/cancel active jobs before uninstalling. To change the service workspace,
uninstall and reinstall it, then reconfigure and pair the bot locally.
