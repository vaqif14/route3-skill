# route3-skill

**Route3** — multi-expert orchestrator skill for Claude Code / Cursor.

Clarify completely (D1–D10) → then execute via **Codex → Kimi → native** experts, with progressive references, preflight/done gates, and no-MVP quality bar.

## Install

### From GitHub (works now)

```bash
npm install -g github:vaqif14/route3-skill
route3-skill install
```

`postinstall` auto-copies the skill into Claude/Cursor dirs; if your environment skips lifecycle scripts:

```bash
npx github:vaqif14/route3-skill
# or after global install:
route3-skill install
```

### From npm registry

```bash
npm install -g route3-skill
```

(Requires the package to be published to npmjs; if `npm publish` fails with 403, create an npm **Automation** token with 2FA and publish from this repo.)

One-shot after registry publish:

```bash
npx route3-skill install
```

This copies the skill + agent roster to:

| Tool | Paths |
|---|---|
| Claude Code | `~/.claude/skills/route3`, `~/.claude/agents/route3` |
| Cursor | `~/.cursor/skills/route3`, `~/.cursor/agents/route3` |

Update:

```bash
npm update -g route3-skill
```

Uninstall:

```bash
npm uninstall -g route3-skill
# or
npx route3-skill uninstall
```

## Use

In chat:

```text
/route3 seller dashboard-a order status əlavə et
```

Flow: **ask all material questions → you confirm → build** (Codex first, Kimi on quota, native if both dead).

## What's included

- `skill/SKILL.md` + `references/` (clarify-then-execute, slim-v3, grill, backends, …)
- `skill/scripts/` — `check-preflight.sh`, `route-slice.sh`, `check-plan-done.sh`, …
- `skill/teams/` — startup / project / halal / enterprise / agency playbooks
- `agents/` — `route3-*` expert agent definitions

## License

MIT
