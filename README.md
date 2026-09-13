# Route3

Route3 supervises agent work with measured session usage, bounded context handoffs,
and a Mac control center for agent jobs, OpenClaw, browser and Telegram lifecycle.

## Local setup

Requires Node.js 18+ for the control center. Each provider CLI can require a newer
runtime; OpenClaw installed through NVM uses its adjacent Node executable.
Building the native Mac app also requires Apple's command line developer tools.

```bash
node bin/route3-skill.js install --all
npm start
```

Open **http://127.0.0.1:43173**. To build the native app:

```bash
npm run mac
```

`npm run mac` compiles the AppKit/WebKit shell into `~/Applications/Route3 Control.app`
(`build.sh --output DIR` overrides the location, `--open` launches it). The app attaches
to an already healthy server, starts and owns one only when the port is dead, and stops
only a server it started itself; its status bar names the current mode and workspace.

The installer supports `--claude`, `--cursor`, `--codex`, `--agents`, `--openclaw`,
`--all`, and `--dry-run`. It preserves local additions and saves the exact previous
installation under `~/.local/share/route3/backups/`, outside skill discovery. The
shared runtime is installed at `~/.local/share/route3/control-center`.

Invoke `/route3 <task>` in a supported agent host, or use the panel to launch an
installed agent. CLI presence is shown separately from actual job success; a
provider may still require its normal login, quota or permission interaction.

## What the panel measures

- **Sessions:** local Codex, Claude and OpenClaw session records; provider/model,
  workspace, measured token usage and context occupancy when available.
- **Token drivers:** observed large input and cache-read share. Input includes
  cache reads once; cached input is not added again to provider input totals.
- **Context decisions:** 65% prepares a handoff, 80% recommends compact at a task
  boundary, 90% marks urgency. These configurable operational thresholds use
  the reported context window and latest-request proxy, never lifetime spend.
- **Agent jobs:** actual subprocess state, bounded redacted logs and cancellation.
  Kimi runs over ACP, so its tool approvals appear as decision cards in the panel
  instead of being auto-approved; cancelling a job denies any open approval.
- **Integrations:** existing OpenClaw gateway, browser, and Telegram channel
  status/lifecycle through supported local commands, with explicit errors.

Unknown usage stays unknown. Displayed totals describe the sampled sessions,
not account billing. Tail-only logs are labeled partial; no prices or savings
percentages are invented. The panel does **not** pretend it can compact another
application's active conversation. It recommends and supports a durable handoff.

## Checkpoint before compact

```bash
node skill/scripts/session-budget.js status --cwd /path/to/project
node skill/scripts/session-budget.js snapshot --cwd /path/to/project
node skill/scripts/session-budget.js checkpoint --cwd /path/to/project < checkpoint.json
```

A checkpoint contains `goal`, `nextAction`, and string arrays `constraints`,
`changedFiles`, `verification`, `blockers`, `authorization`. It is limited to 32 KB
and written atomically with private permissions. Use `--session <id>` when several
sessions share a project. Then compact through the current host's supported
operation; saving a checkpoint alone does not alter its active context.

## Execution model

Default Route3 work uses the smallest useful team and brief. Already authorized,
clear work proceeds without a repeated plan approval or paid “reply OK” probe.
The user's configured models and permissions remain authoritative. Each delegated
writer gets owned paths and acceptance checks, rather than the full transcript.

Existing class-aware routing, repository context engine, artifact factory,
dispatch evidence, lessons and opt-in hooks are retained for existing factory
runs. Their larger ceremony is explicit, not imposed on every ordinary task.
The [skill entrypoint](skill/SKILL.md) defines the current operating contract.

The control server binds to loopback and checks Host, Origin and a mutation token.
It uses fixed executable/argument definitions, bounds concurrency and output, and
terminates only jobs it owns. It does not expose an arbitrary shell endpoint or
copy bot credentials. A local application is not a multi-user remote service.

## Verification

```bash
npm test
npm run test:legacy
npm run test:context
npm run test:hooks
```

Tests use temporary fixtures/fake executables; they do not send paid model prompts
or mutate the live gateway. Native compilation and browser checks should accompany
UI changes. See [architecture](docs/ARCHITECTURE.md) for component boundaries.

## License

MIT. See [LICENSE](LICENSE).
