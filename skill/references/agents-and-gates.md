# Route3 agents + gates

Dispatch writers/reviewers — **boss never substitutes as writer**
(`boss-discipline.md`).

| Host | Dispatch tool |
|---|---|
| Claude Code | `Agent` tool `subagent_type: "<name>"`; continue via SendMessage |
| Cursor | `Task` tool `subagent_type: "<name>"` (same `route3-*` names) |

Agents live in `~/.claude/agents/route3/` (Cursor agent registry mirrors names).

## Agent roster

| Agent | Team | Job |
|---|---|---|
| `route3-architect` | Architecture | Slice split, contracts, ADRs, risk — PLANS only |
| `route3-design-analyst` | Frontend | Design image → token-mapped brief |
| `route3-react-expert` | Frontend | Components, hooks, client state — WRITES |
| `route3-nextjs-expert` | Frontend | App Router, RSC/actions, caching — WRITES |
| `route3-ui-expert` | Frontend | Tailwind/shadcn, dark, a11y, motion — WRITES |
| `route3-api-expert` | Backend | Endpoints, auth, validation, jobs — WRITES |
| `route3-database-expert` | Backend | Prisma/SQL, migrations, indexes — WRITES |
| `route3-reviewer` | Quality | Adversarial review; SHIP/FIX/REJECT — never writes |
| `route3-security-auditor` | Quality | Auth/injection/IDOR/secrets/PII — executed proof |
| `route3-test-engineer` | Quality | Unit/integration/e2e per AC — test code only |
| `route3-improver` | Quality | Apply FIX findings; behavior-preserving |
| `route3-skill-user` | Support | Curated skill autodecide + invoke |
| `route3-researcher` | Support | Docs/web/codebase; may learn new skills |
| `route3-notebooklm-expert` | Support | NotebookLM connect → research → clarify package |
| `route3-docs-writer` | Support | Runbooks/release notes from approved diffs |
| `route3-ship-gate` | Quality | Final ship checklist — never writes |
| `route3-worktree` | Ops | Git worktree + branch isolation |
| `route3-handoff` | Support | CONTEXT/handoff packages |
| `route3-zero-hallucination` | Support | Evidence grades for claims |
| `route3-adversarial` | Quality | Second-pass persona red-team |
| `route3-spec` | Architecture | Spec/AC under `.workflow` only |
| `route3-observability` | Platform | Metrics/logs/traces/SLO |
| `route3-perf` | Quality | Perf / CWV / hot-path |
| `route3-a11y` | Quality | WCAG 2.2 audit |
| `route3-migration` | Backend | Risky migration architect |
| `route3-ci` | Platform | CI/CD pipeline design |
| `route3-pr` | Support | PR draft — no auto-push |
| `route3-tdd` | Quality | TDD red-green in allowed paths |
| `route3-incident` | Ops | Incident command + runbooks |
| `route3-product` | Product | Factory PRODUCT — AC/scope only |
| `route3-deeplink-research` | Support | Deep multi-source research |
| `route3-smm` | Marketing | Dual-approve draft-only SMM |

**Separation of duties:** planner ≠ builder ≠ validator ≠ approver.
Reviewer ≠ writer, always.

## Expert keyword routing (first match; mixed → split)

Skills are NOT chosen here — see `skill-routing.md`.

| Signal | Primary expert |
|---|---|
| `/skill-name` | that skill via Skill / skill-user |
| dizayn update / polish | autodecide skill → usually ui-expert |
| screenshot / mockup | design-analyst → taste skill |
| component/hook/state | react-expert |
| route/page/server action | nextjs-expert |
| style/dark/a11y | ui-expert |
| endpoint/API/auth/job | api-expert |
| schema/migration/query | database-expert |
| test/e2e/flaky | test-engineer |
| audit/vuln/IDOR | security-auditor |
| docs/runbook/release | docs-writer |
| unknown lib / "necə işləyir" | researcher |
| NotebookLM / NBLM / notebook URL | notebooklm-expert |
| ship / deploy checklist | ship-gate |
| worktree / parallel branch | worktree |
| handoff package | handoff |
| evidence / no hallucination | zero-hallucination |
| red-team / persona review | adversarial |
| spec-first / executable AC | spec |
| SLO / metrics / tracing | observability |
| perf / CWV / slow | perf |
| WCAG / a11y audit | a11y |
| risky migration / expand-contract | migration |
| CI workflow / GitHub Actions | ci |
| open PR / PR body | pr |
| TDD / red-green | tdd |
| incident / sev / outage | incident |
| product AC / scope (factory) | product |
| deep research (non-NBLM) | deeplink-research |
| SMM / Meta ads draft | smm |


## STATUS contract

Every agent ends with:
`STATUS: COMPLETED | NEEDS_CLARIFICATION | NEEDS_APPROVAL | BLOCKED | FAILED`

| Status | Boss action |
|---|---|
| COMPLETED | Boss check (diff + re-run gates + AC) |
| NEEDS_CLARIFICATION | Answer all Qs via SendMessage |
| NEEDS_APPROVAL | Surface named gate to user; wait |
| BLOCKED | Fix blocker; resume SAME agent |
| FAILED | Route findings to owner; never blind re-dispatch |

Missing STATUS or COMPLETED with red gates = defect.

## Approval gates (user-owned — boss never self-approves)

| Gate | Trigger |
|---|---|
| `plan_approval` | Non-trivial Build preflight package |
| `destructive_operation` | Drop/truncate/delete, force-push, history rewrite |
| `production_change` | Live DB/migrations/deploys/DNS/env |
| `financial_code_path` | Payment/billing going live |
| `secrets_change` | Credentials / real .env values |
| `external_publish` | git push, PR, outbound messages |
| `dependency_add` | New packages |

Security posture (detail: `qm-harness-ops.md`): default `auto`;
auth/pay/migrations/prod → `strict`. Overnight `dangerous` never waives
predeclared denials (force-push, recursive rm, DROP, pipe-to-shell, secrets,
live deploy). Posture may only tighten.

## Handoff policy

Every dispatch/SendMessage carries: (1) ≤10-line context summary,
(2) artifact paths (never "see above"), (3) inherited risks,
(4) this-step acceptance criteria.
