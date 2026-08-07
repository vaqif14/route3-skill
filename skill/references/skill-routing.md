# Route3 skill autodecide — curated + silent

Full operating contract: `slim-v3-contract.md`. This file is the skill picker.

## Rules

1. Score **only** the Curated catalog below (plus project-local skills under
   the repo). Do not scan 1000+ global installs — context budget kills them.
2. Never ask the user which skill. `/skill-name` pin wins.
3. Max **3** skills per slice. Process → domain → polish.
4. Bugi silent dials when a taste skill wins: `VISUAL_DENSITY=7–8`,
   `MOTION_INTENSITY=4–6`, brand tokens from `globals.css` beat skill aesthetics.
5. Log:

```text
SKILL_ROUTE: slice=<id> candidates=<a:score,…> chosen=<…> rejected=<…>
  overrides=<…|none> reason=<≤2 sentences>
```

## Scoring (0–5 each)

`fit` · `leverage` · `conflict` (high conflict lowers total or needs overrides)
· `cost` · `freshness`. Pick highest total; ties → more specific → lower conflict.
Drop `fit≤2` unless pinned.

## Curated catalog (autodecide universe)

### Design / UX
| Skill | Use when | Reject when |
|---|---|---|
| `design-taste-frontend-v1` | Storefront/seller/admin product UI polish, density, redesign | Pure landing/marketing hero |
| `design-taste-frontend` | Landing / portfolio / marketing hero only | Dense marketplace grids |
| `frontend-design` | Taste skills missing | Prefer v1 when installed |
| `animation-vocabulary` | Motion polish after layout settled | Layout still moving |
| `apple-design` | Explicit iOS/HIG ask | Web marketplace default |

### Quality / process
| Skill | Use when | Reject when |
|---|---|---|
| `systematic-debugging` / superpowers debug | Root cause unknown | Cause already proven |
| `tdd-guide` | Tests-first / red-green asked or high-risk logic | Pure CSS density pass |
| `security-review` | Auth/pay/PII/upload review ask | Plus always `route3-security-auditor` on those slices |
| **built-in** `ponytail-ladder.md` | Every coding Build (default full) | Non-code Q&A; never to cut a11y/security |
| **built-in** `product-engineering.md` | Feature/UX/API design before inventing | Trivial typo/rename |


### Ship / quality specialists (map → route3 agents)
| Skill | Use when | Route3 agent | Reject when |
|---|---|---|---|
| `ship-gate` | Pre-deploy / done checklist | `route3-ship-gate` | Mid-slice WIP with no AC |
| `tdd-guide` | Tests-first / red-green | `route3-tdd` (or test-engineer if tests-only) | Pure CSS density pass |
| `a11y-audit` | WCAG audit of UI slice | `route3-a11y` | Non-UI API-only |
| `grill-me` | User `/grill-me` or stress-test plan | built-in `matt-grill-flow.md` + skill | Discoverable repo questions |
| `git-worktree-manager` | Parallel factory/agent isolation | `route3-worktree` | Single-branch trivial edit |
| `handoff` | Session/expert switch package | `route3-handoff` | Same-agent continue |
| `zero-hallucination-coder` | High-stakes claim grounding | `route3-zero-hallucination` | Typo/trivial |
| `adversarial-reviewer` | Second-pass persona red-team | `route3-adversarial` | Primary review (use `route3-reviewer`) |
| `spec-driven-workflow` | AC → executable spec before code | `route3-spec` | Code already approved |
| `observability-designer` / `slo-architect` | Metrics/logs/traces/SLO | `route3-observability` | No runtime surface |
| `performance-profiler` | CWV / hot-path | `route3-perf` | No perf budget |
| `migration-architect` | Risky zero-downtime migration | `route3-migration` | Trivial additive column (db-expert) |
| `ci-cd-pipeline-builder` | CI workflow design | `route3-ci` | App feature code |
| `pr-review-expert` / `changelog-generator` | PR body after Approve | `route3-pr` | Before plan approval; no auto-push |
| `incident-commander` / `runbook-generator` | Live incident / runbook | `route3-incident` | Feature BUILD |
| `product-discovery` / `product-strategist` | Factory PRODUCT stage | `route3-product` | Architecture/code asks |
| `deep-research` | Multi-source evidence grades | `route3-deeplink-research` | NotebookLM URL (notebooklm-expert) |
| `social-content` / `ad-creative` | SMM/ad drafts | `route3-smm` | Auto-publish asks (refuse) |

### External product judgment (install + route only — never vendored)

Source: [ojiudezue/productmind-skills](https://github.com/ojiudezue/productmind-skills) —
**CC BY-SA**. Catalog + link + invoke only; never copy SKILL.md bodies into this repo.

| Skill | Use when | Scope | Reject when |
|---|---|---|---|
| `vet-a-feature` | "Should we build this at all?" before architecture | factory PRODUCT / product lane | Trivial bug / UI slice — no product question |
| `sharp-problem-test` | Pressure-test workaround · frequency · willingness-to-pay | factory PRODUCT / product lane | Problem already validated with cited evidence |
| `slc-or-mvp` / `scope-cutter` | **Optional**, startup / product-lane scoping only | startup lane (**not** core Build catalog) | Any Route3 Build — engineering bar stays SaaS-complete; cuts mean fewer AC, never thinner quality |

Feeds the `route3-product` `VERDICT:` line (`agents/route3-product.md`); the refusal
gate lives in `factory-contract.md` § Product verdict gate.

### Content / growth
| Skill | Use when |
|---|---|
| `copywriting` / `davidondrej-copywriting` | Microcopy/CTA; AZ default |
| `seo` / matching `seo-*` | SEO/GEO/schema/sitemap tasks |

### Ponytail (always-on for code Builds)
Not a separate Skill tool invoke unless user installed upstream `ponytail` plugin. Boss/experts **Read** `~/.claude/skills/route3/references/ponytail-ladder.md` and put `PONYTAIL:` in the brief. If user pins `/ponytail` and the upstream skill is installed, invoke it; else the adapted ladder is enough.

### Grill / align (before BUILD — see `matt-grill-flow.md`)
| Skill / built-in | Use when | Reject when |
|---|---|---|
| **built-in** `matt-grill-flow.md` | Every non-trivial `/route3` Build | Trivial Proportionality skip |
| `grill-me` | User `/grill-me` or wants one-at-a-time | Discoverable repo questions |
| `grill-with-docs` | Domain terms / CONTEXT / ADR | Pure CSS density pass |
| `implement` | User `/implement` after ALIGNED | Before ALIGNED; Route3 still owns experts |

### Explicit only (do not autodecide-in)
Other Matt flows (`wayfinder`, `to-tickets`, `triage`, …) — only if user
pins `/skill-name`. Do not start a full external mega-process that bypasses
Route3 boss checks.

## Grill vs taste skill

Grill/align **before** BUILD. Taste/design skills apply after ALIGNED
(or inside grill if the open branch is visual direction). Never substitute
a random taste skill for a missing business decision.

## How experts receive the skill

Brief must include: SKILL_ROUTE block, path `~/.claude/skills/<name>/SKILL.md`,
dial overrides, "follow pre-flight; paste checklist". Boss/skill-user must
have invoked/Read the skill this turn.
