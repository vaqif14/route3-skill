# Claude Skills → Route3 curated integration

Source: [alirezarezvani/claude-skills](https://github.com/alirezarezvani/claude-skills)  
Inventory snapshot: IT Innovations `.tmp-debug/claude-skills-COMPLETE.md`  
Route3 package version introducing this pack: **1.4.0**

## Policy (CRITICAL)

| Do | Do not |
|---|---|
| Thin `route3-*` adapters with Route3 contracts (clarity gate, STATUS, boss-discipline) | Add all **362** skills as agents |
| Curate ~15–18 gap-filling specialists | Copy entire upstream skill trees into this package |
| Extend skill-routing catalog rows that map to agents | Vendor license/size noise from full domain packs |
| Prefer Read upstream `SKILL.md` when installed | Depend on upstream install for agents to function |

Route3 agents ship **self-contained distilled protocols**. Optional full pack install (see below) only deepens behavior when the user wants it.

## Source repo stats

| Metric | Value |
|---|---:|
| Skills (inventory) | **362** |
| Domain folders (README) | **18** |
| Also noted upstream | agents/personas, slash commands (not ingested here) |

### Domain folder counts (inventory)

| Domain | Approx. skills | Route3 verdict |
|---|---:|---|
| engineering | 85 | **INCLUDE** (selective) |
| engineering-team | 53 | **INCLUDE** (selective) |
| c-level-advisor | 69 | **REJECT** |
| marketing-skill | 49 | **INCLUDE** (thin SMM only) |
| product-team | 18 | **INCLUDE** (thin product) |
| ra-qm-team | 20 | **DEFER** |
| productivity | 12 | **DEFER** (handoff already covered) |
| research | 10 | **INCLUDE** (deep-research) |
| project-management | 10 | **DEFER** (domain teams cover PMO) |
| compliance-os | 10 | **DEFER** |
| commercial | 9 | **REJECT** |
| business-operations | 8 | **DEFER** |
| research-ops | 6 | **DEFER** |
| markdown-html | 6 | **REJECT** |
| business-growth | 6 | **REJECT** |
| finance | 5 | **REJECT** |
| marketing (landing) | 2 | **REJECT** |
| loop-library | 2 | **DEFER** |

## Selection criteria for Route3

A skill becomes a Route3 agent only if it:

1. **Fills a gap** vs existing experts (architect, api, db, next, react, ui, design-analyst, test, reviewer, security, improver, researcher, notebooklm, docs, skill-user).
2. **Fits boss-discipline** — clear writer vs reviewer-class; no product code from gate/review agents.
3. **Is high-frequency** in `/route3` factory or standard spines (ship, TDD, a11y, migration risk, PR, CI, handoff, worktree).
4. **Stays thin** — 1–2 screens of protocol + pointer to upstream path; no vendored trees.
5. **Self-improves** — on FAIL, boss records lessons via `record-lesson.sh` (same as other agents).

Reject / defer when the skill is executive advisory, regulatory theater, SaaS sales ops, or duplicates an existing expert without a sharper contract.

## Category verdicts (all 18)

| Category | Verdict | Agents / notes |
|---|---|---|
| **engineering** | **INCLUDE** | `ship-gate`, `worktree`, `handoff`, `zero-hallucination`, `spec`, `observability`, `perf`, `migration`, `ci`, `pr` (+ upstream skills used via skill-user: grill-me, ponytail discipline already built-in) |
| **engineering-team** | **INCLUDE** | `adversarial`, `a11y`, `tdd`, `incident` |
| **product-team** | **INCLUDE** | `product` (PRODUCT stage only) |
| **research** | **INCLUDE** | `deeplink-research` |
| **marketing-skill** | **INCLUDE** | `smm` only (dual-approve, draft-only) |
| **productivity** | **DEFER** | Core handoff covered; rest is personal productivity noise for factory |
| **project-management** | **DEFER** | Covered by `skill/teams/project.md` + factory stages |
| **research-ops** | **DEFER** | Academic ops; notebooklm + deeplink sufficient |
| **ra-qm-team** | **DEFER** | Regulated device/QM — not default Route3 product spine |
| **compliance-os** | **DEFER** | SOC2/ISO/GDPR packs — invoke via skill-user when a project needs them |
| **business-operations** | **DEFER** | Vendor/SOP — agency/enterprise teams later |
| **loop-library** | **DEFER** | Meta loop design; Route3 factory already owns loops |
| **c-level-advisor** | **REJECT** | Boardroom/C-suite theater ≠ code factory |
| **commercial** | **REJECT** | Pricing desks / RFP — out of orchestrator scope |
| **business-growth** | **REJECT** | CS/RevOps — not Build spine |
| **finance** | **REJECT** | DCF/SaaS metrics — not Build spine |
| **marketing** (landing HTML) | **REJECT** | One-off landing generator; conflicts with DESIGN.md discipline |
| **markdown-html** | **REJECT** | Doc→HTML presentation toys |

## Mapping: upstream skill → route3 agent

| Upstream path | Route3 agent | Class |
|---|---|---|
| `engineering/skills/ship-gate` | `route3-ship-gate` | Reviewer — never product code |
| `engineering/skills/git-worktree-manager` | `route3-worktree` | Ops / shell |
| `engineering/handoff/skills/handoff` | `route3-handoff` | Support — artifacts only |
| `engineering/zero-hallucination-coder/...` | `route3-zero-hallucination` | Support — evidence grades |
| `engineering-team/skills/adversarial-reviewer` | `route3-adversarial` | Reviewer — red-team pass |
| `engineering/skills/spec-driven-workflow` | `route3-spec` | Planner — `.workflow` only |
| `engineering/skills/observability-designer` + `slo-architect` | `route3-observability` | Platform |
| `engineering/skills/performance-profiler` | `route3-perf` | Quality / hot-path |
| `engineering-team/a11y-audit/...` | `route3-a11y` | Quality / a11y |
| `engineering/skills/migration-architect` | `route3-migration` | Backend — risky migrations |
| `engineering/skills/ci-cd-pipeline-builder` | `route3-ci` | Platform |
| `engineering/skills/pr-review-expert` + `changelog-generator` | `route3-pr` | Support — PR draft |
| `engineering-team/skills/tdd-guide` | `route3-tdd` | Builder — tests-first |
| `engineering-team/skills/incident-commander` + `runbook-generator` | `route3-incident` | Ops |
| `product-team/skills/product-discovery` + `product-strategist` | `route3-product` | Product stage |
| `research/deep-research/...` | `route3-deeplink-research` | Research |
| `marketing-skill/skills/social-content` + `ad-creative` | `route3-smm` | Marketing — draft-only |

### Already covered (no new agent)

| Upstream | Existing Route3 coverage |
|---|---|
| senior-architect / senior-backend / frontend | `route3-architect`, `api`, `nextjs`, `react`, `ui` |
| code-reviewer / senior-security | `route3-reviewer`, `route3-security-auditor` |
| senior-qa / playwright-pro | `route3-test-engineer` (+ skill-user) |
| database-designer / sql assistant | `route3-database-expert` |
| grill-me / grill-with-docs | built-in `matt-grill-flow.md` + skill-routing |
| self-improving-agent | Route3 `record-lesson.sh` / SELF-IMPROVE |
| write-a-skill / skill-tester | `route3-researcher` + `route3-skill-user` |

## Install note (optional full pack)

Route3 agents work **without** installing alirezarezvani/claude-skills.

Optional (user choice — large):

```bash
# Upstream (example — follow their README; do not vendor into route3-skill)
git clone --depth 1 https://github.com/alirezarezvani/claude-skills.git /tmp/claude-skills-rezvani
# Cursor rules / Antigravity / Claude marketplace plugins per upstream scripts
```

When a matching skill exists at `~/.claude/skills/<name>/SKILL.md`, each thin agent **Read**s it first, then applies Route3 contracts (STATUS, gates, no self-publish).

## Self-improve

New agents follow the same FAIL path as the core pack:

1. Agent ends `STATUS: FAILED` (or BLOCKED after a real attempt) with evidence.
2. Boss runs `skill/scripts/record-lesson.sh` (mandatory on verify FAIL / reviewer FIX|REJECT).
3. Lessons land in `.workflow/route3/lessons/LESSONS.jsonl` (+ optional MEMANTO dual-write).
4. Agents must **not** silently rewrite `SKILL.md`.

See [SELF-IMPROVE.md](SELF-IMPROVE.md).

## Agent roster delta (v1.4.0)

**Before:** 15 `route3-*` agents  
**Added:** 17 curated adapters  
**After:** 32 agents (see `agents/README.md`)
