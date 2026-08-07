# route3-skill

**Route3** — boss orchestrator skill for Claude Code and Cursor. Clarify completely, then execute via Codex → Kimi → native experts. Never self-writes product code.

`v1.4.1` · MIT · Node ≥ 18 · Install: `github:vaqif14/route3-skill`

## What it is / is not

| Is | Is not |
|---|---|
| Boss orchestrator: clarify → classify risk → route writers → verify → review → done | A Temporal / durable-workflow platform |
| Filesystem-first run artifacts under `.workflow/route3/` | A control-panel UI or auto-merge bot |
| Opt-in **factory** path for high-risk / multi-slice work | Hermes / MEMANTO memory (MEMANTO dual-write from lessons is optional) |
| Mandatory **self-improve** lessons on FAIL | Mid-task silent rewrites of `SKILL.md` |

## Iron laws

1. **Clarify → execute.** Scan D1–D10, ask every material question, package Goal/AC, wait for confirm, then `check-preflight.sh`. Never code first.
2. **Boss never self-writes.** `primary=native` means Task/Agent `route3-*`, not main-thread edits. Ops/smoke under `/route3` is not an exception. See `skill/references/boss-discipline.md`.
3. **Codex → Kimi → native.** `route-slice.sh` picks primary; fail over on quota; AC stays identical. Never invent primary.
4. **Self-improve is mandatory and evidence-bound.** Verify FAIL / reviewer FIX|REJECT / BUILD_PROOF fail → `record-lesson.sh` with VERIFY/digest evidence (`quality=bound`). Factory done ignores unbound lessons and PLAN-only `LESSON_RECORDED` theater.

## Risk paths

| Path | When | Spine |
|---|---|---|
| `trivial` | Typo / ~20-line rename; no schema/auth/pay | Skip factory; `--trivial` done gate |
| `standard` | **Default** (~80% features) | Clarify → plan approval → slice → verify → review → done |
| `factory` | Multi-slice **or** high-risk (auth/pay/PII/migration/…) — **opt-in** | Run-dir + VALIDATED stages + BRIEF + verify-slice + lessons |

```bash
scripts/classify-risk.sh --write PLAN.md
# or: scripts/check-preflight.sh PLAN.md --classify
```

## Install / update / uninstall

```bash
# Install (GitHub)
npm install -g github:vaqif14/route3-skill
route3-skill install          # Claude + Cursor (default)
route3-skill install --all    # explicit both targets

# One-shot without global CLI
npx github:vaqif14/route3-skill

# Update
npm update -g github:vaqif14/route3-skill
route3-skill install --all

# Uninstall
route3-skill uninstall
npm uninstall -g route3-skill
```

Copies skill + agents to:

| Tool | Paths |
|---|---|
| Claude Code | `~/.claude/skills/route3`, `~/.claude/agents/route3` |
| Cursor | `~/.cursor/skills/route3`, `~/.cursor/agents/route3` |

Optional npm registry name: `route3-skill` (when published).

## Quick start

```text
/route3 seller dashboard-a order status əlavə et
```

```text
/route3 fix login 2FA edge case for parent portal
```

Flow: ask all material questions → you confirm → `classify-risk` → **standard** (default) or **factory** → Codex first, Kimi on quota, native Task/Agent if both dead → review → done report.

More: [docs/QUICKSTART.md](docs/QUICKSTART.md)

## Architecture

```
                    ┌─────────────┐
                    │   /route3   │
                    └──────┬──────┘
                           ▼
                    clarify (D1–D10)
                           ▼
                    classify-risk.sh
              ┌────────────┼────────────┐
              ▼            ▼            ▼
          trivial      standard      factory (opt-in)
              │            │            ▼
              │            │      init-run.sh → run-dir
              │            │            ▼
              │            │      VALIDATED stages
              │            │      (research?→product→arch→plan)
              │            │            ▼
              │            └────► route-slice.sh
              │                     ▼
              │              BUILD (Codex|Kimi|route3-*)
              │                     ▼
              │              verify (+ verify-slice factory)
              │                     ▼
              │              FAIL? → record-lesson.sh
              │                     ▼
              │              review → check-plan-done
              └───────────────────► done
```

Deep dive: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · factory: [docs/FACTORY.md](docs/FACTORY.md) · lessons: [docs/SELF-IMPROVE.md](docs/SELF-IMPROVE.md)

## Scripts cheat sheet

| Script | Role |
|---|---|
| `classify-risk.sh` | `trivial` \| `standard` \| `factory` from PLAN |
| `check-preflight.sh` | Clarify gate before BUILD (`--classify` optional) |
| `init-run.sh` | Create `.workflow/route3/runs/<id>/` + `STATE.json` |
| `check-stage.sh` | VALIDATED stage gates (research/product/arch/plan/slice) |
| `context-pack.sh` | Per-slice `CONTEXT.md` (+ EXPANSION_REQUEST) |
| `route-slice.sh` | Codex → Kimi → native primary |
| `assert-build-route.sh` | Boss did not self-write; `--require-dispatch` |
| `verify-slice.sh` | BRIEF verify presets → generated `VERIFY.md` |
| `invalidate-stale.sh` | Digest mismatch → STALE |
| `record-lesson.sh` / `lesson-rollback.sh` / `lesson-list.sh` | Self-improve |
| `check-plan-done.sh` | Done gate (`--factory --run ID`) |
| `link-overnight.sh` | Overnight ↔ factory bridge |
| `eval-factory.sh` / `test-factory-smoke.sh` | Evals / smoke |

All under `skill/scripts/`.

## Agents (`route3-*`) — 32 total

Core writers/reviewers plus **17 curated specialists** from [alirezarezvani/claude-skills](https://github.com/alirezarezvani/claude-skills) (thin adapters — not the full 362-skill tree). Full catalog: [agents/README.md](agents/README.md) · selection analysis: [docs/CLAUDE_SKILLS_INTEGRATION.md](docs/CLAUDE_SKILLS_INTEGRATION.md).

| Agent | Role |
|---|---|
| `route3-architect` | Architecture / contracts |
| `route3-api-expert` | API / HTTP surfaces |
| `route3-database-expert` | Schema / migrations |
| `route3-nextjs-expert` | Next.js app routes |
| `route3-react-expert` | React UI logic |
| `route3-ui-expert` | UI implementation |
| `route3-design-analyst` | Design-from-image |
| `route3-test-engineer` | Tests |
| `route3-security-auditor` | Auth / pay / PII |
| `route3-reviewer` | Independent review (≠ writer) |
| `route3-improver` | Bounded polish (≤2) |
| `route3-researcher` | Evidence gathering |
| `route3-notebooklm-expert` | NotebookLM / NBLM research → clarify |
| `route3-docs-writer` | Docs |
| `route3-skill-user` | Skill application |
| `route3-ship-gate` | Final ship checklist — never product code |
| `route3-worktree` | Git worktree / branch isolation |
| `route3-handoff` | Expert CONTEXT packages |
| `route3-zero-hallucination` | Evidence grades for claims |
| `route3-adversarial` | Second-pass persona red-team |
| `route3-spec` | Spec-driven AC → `.workflow` |
| `route3-observability` | Metrics / logs / traces / SLO |
| `route3-perf` | Perf / CWV / hot-path |
| `route3-a11y` | WCAG audit |
| `route3-migration` | Risky migration architect |
| `route3-ci` | CI/CD pipeline design |
| `route3-pr` | PR draft — no auto-push |
| `route3-tdd` | TDD red-green |
| `route3-incident` | Incident command / runbooks |
| `route3-product` | Factory PRODUCT — AC/scope only |
| `route3-deeplink-research` | Deep multi-source research |
| `route3-smm` | SMM drafts — dual-approve, never auto-publish |

## Domain teams

Playbooks in `skill/teams/`:

| Signal | Playbook |
|---|---|
| Startup / GTM / fundraising | `startup.md` |
| Formal PMO / charter / WBS | `project.md` |
| Halal e-commerce | `halal-business.md` |
| ERP / SaaS / multi-tenant | `enterprise.md` |
| Website agency / outreach | `website-agency.md` |

## Documentation

| Doc | Contents |
|---|---|
| [docs/QUICKSTART.md](docs/QUICKSTART.md) | Install, first task, factory sequence, troubleshooting |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Components, truth precedence, gates, non-goals |
| [docs/FACTORY.md](docs/FACTORY.md) | Risk classify, stages, BRIEF, stale, overnight |
| [docs/SELF-IMPROVE.md](docs/SELF-IMPROVE.md) | Mandatory lessons, rollback, MEMANTO |
| [docs/CLAUDE_SKILLS_INTEGRATION.md](docs/CLAUDE_SKILLS_INTEGRATION.md) | Curated alirezarezvani skill → agent analysis |
| [agents/README.md](agents/README.md) | Full `route3-*` agent catalog |
| [skill/references/README.md](skill/references/README.md) | Progressive reference index |
| [CHANGELOG.md](CHANGELOG.md) | Version history |

## Testing

```bash
npm test                          # factory smoke (test-factory-smoke.sh)
bash skill/scripts/eval-factory.sh
```

Also: `eval-clarify.sh`, `eval-triggers.sh` + JSON fixtures under `skill/evals/`.

## Roadmap

- **Now:** filesystem-first factory, auto risk classify, stale gates, mandatory lessons, overnight bridge.
- **Deferred:** Temporal runtime, control-panel UI, auto-merge / FINAL PR automation, heavy program-designer / full c-level packs (see CLAUDE_SKILLS_INTEGRATION DEFER/REJECT).

## License

[MIT](LICENSE) © 2026 vaqif14
