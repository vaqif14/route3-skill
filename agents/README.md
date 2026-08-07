# Route3 agents

Thin expert definitions installed to `~/.claude/agents/route3/` and `~/.cursor/agents/route3/` via `route3-skill install`.

Every agent: clarity gate → work → `STATUS: COMPLETED | NEEDS_CLARIFICATION | NEEDS_APPROVAL | BLOCKED | FAILED`.  
Boss never self-writes product code — see `skill/references/boss-discipline.md`.

## Core (v1.0–1.3)

| Agent | Role |
|---|---|
| `route3-architect` | Slice split, contracts, ADRs, risk — plans only |
| `route3-api-expert` | API/server handlers, auth, jobs — writes |
| `route3-database-expert` | Prisma/SQL, indexes, routine migrations — writes |
| `route3-nextjs-expert` | App Router, RSC, caching — writes |
| `route3-react-expert` | Components, hooks, client state — writes |
| `route3-ui-expert` | Styling, dark, a11y polish, motion — writes |
| `route3-design-analyst` | Screenshot/mockup → implementation brief |
| `route3-test-engineer` | Tests only — never product code |
| `route3-reviewer` | Primary adversarial diff review — SHIP/FIX/REJECT |
| `route3-security-auditor` | Auth/injection/IDOR/secrets — executed proof |
| `route3-improver` | Apply FIX findings; behavior-preserving |
| `route3-skill-user` | Curated skill autodecide + invoke |
| `route3-researcher` | Docs/web/codebase + skill ecosystem |
| `route3-notebooklm-expert` | NotebookLM / NBLM research → clarify |
| `route3-docs-writer` | Runbooks/release notes from approved diffs |

## Curated from alirezarezvani/claude-skills (v1.4.0)

Full analysis: [docs/CLAUDE_SKILLS_INTEGRATION.md](../docs/CLAUDE_SKILLS_INTEGRATION.md)

| Agent | Role |
|---|---|
| `route3-ship-gate` | Final ship checklist (tsc/lint/tests/AC/security) — never product code |
| `route3-worktree` | Git worktree + branch isolation per run |
| `route3-handoff` | Structured CONTEXT/handoff packages |
| `route3-zero-hallucination` | Citation/evidence grades before BUILD |
| `route3-adversarial` | Second-pass persona red-team (≠ primary reviewer) |
| `route3-spec` | Spec-driven AC → `.workflow` artifacts only |
| `route3-observability` | Metrics/logs/traces/SLO design |
| `route3-perf` | Performance / CWV / hot-path |
| `route3-a11y` | WCAG 2.2 A/AA audit |
| `route3-migration` | Risky zero-downtime migration architect |
| `route3-ci` | CI/CD pipeline design for the repo |
| `route3-pr` | PR description/checklist — no auto-push |
| `route3-tdd` | TDD red-green in allowed paths |
| `route3-incident` | Incident command + runbooks |
| `route3-product` | Factory PRODUCT stage — AC/scope only |
| `route3-deeplink-research` | Deep multi-source research (non-NBLM) |
| `route3-smm` | Marketing/SMM drafts — dual-approve, never auto-publish |
