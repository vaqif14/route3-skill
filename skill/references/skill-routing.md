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
