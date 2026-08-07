# route3-skill

**Route3** — multi-expert orchestrator skill for Claude Code / Cursor.

Clarify completely (D1–D10) → then execute via **Codex → Kimi → native** experts, with progressive references, preflight/done gates, and no-MVP quality bar.

## Install

```bash
npm install -g github:vaqif14/route3-skill
route3-skill install
```

This installs the CLI and copies Route3 into:

| Tool | Paths |
|---|---|
| Claude Code | `~/.claude/skills/route3`, `~/.claude/agents/route3` |
| Cursor | `~/.cursor/skills/route3`, `~/.cursor/agents/route3` |

One-shot (no global CLI):

```bash
npx github:vaqif14/route3-skill
```

Update:

```bash
npm update -g github:vaqif14/route3-skill
route3-skill install
```

Uninstall:

```bash
route3-skill uninstall
npm uninstall -g route3-skill
```

### npmjs registry (optional)

Package name: `route3-skill`. Publishing requires an npm token that can publish
(Automation token + 2FA). Until then, use the GitHub install above.

```bash
npm install -g route3-skill
route3-skill install
```

## Use

In chat:

```text
/route3 seller dashboard-a order status əlavə et
```

Flow: **ask all material questions → you confirm → build** (Codex first, Kimi on quota, native if both dead).

## What's included

- `skill/SKILL.md` + `references/` (clarify-then-execute, slim-v3, boss-discipline, factory-contract, grill, backends, …)
- Opt-in factory: `init-run.sh` / `check-stage.sh` / `context-pack.sh` / `verify-slice.sh` (default path stays slim-v3 standard)
- `skill/scripts/` — `check-preflight.sh`, `route-slice.sh`, `check-plan-done.sh`, …
- `skill/teams/` — startup / project / halal / enterprise / agency playbooks
- `agents/` — `route3-*` expert agent definitions (incl. `route3-notebooklm-expert`)
- NotebookLM: connect → research → clarify → then Route3 execute

## License

MIT
