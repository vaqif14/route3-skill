# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.2] - 2026-08-08

### Added

- `skill/references/dispatch-prompt-contract.md` — Boss → builder DISPATCH_PROMPT + AGENT_MAP (`EXISTS`|`MISSING_TYPE`|`USE_EXISTING`)
- Clarify D11 `ideal_final_refs` (screenshots/samples/perfect-done before build)
- Hard rule 16: full DISPATCH_PROMPT before Codex/Kimi/Task; boss does not meddle in writer internals
- Done gates: require `AGENT_MAP:` + `SOLUTION_BAR: saas`; MVP deliverable wording fails factory / warns full
- `assert-build-route.sh --require-dispatch` requires `AGENT_MAP:`

### Changed

- Boss discipline / clarify / slim-v3 / native-primary: SaaS/no-MVP ideal-final bar; clarify-first process order
- Package version **1.4.2**

## [1.4.1] - 2026-08-08

### Added

- Evidence-bound lessons: `evidence_path`, `quality` (`bound`|`unbound`) on `LESSONS.jsonl`
- Fluff / short-reason rejection in `record-lesson.sh` (smoke escape: `--allow-unbound --tag smoke`)
- Auto-attach `VERIFY.md` when `--run` + `--slice` and file exists
- Smoke negative check: fluff lesson without allow-unbound must exit 2

### Changed

- Anti-theater self-improve (Kopadze-aligned): factory done accepts **only** bound lessons for matching `run_id`; ignores unbound / missing quality / PLAN-only `LESSON_RECORDED`
- `verify-slice.sh` FAIL auto-lesson uses durable ≥40-char reason + `--after` VERIFY.md
- Docs: Real vs Fake table + five loop blocks in `self-improve.md` / `docs/SELF-IMPROVE.md`
- Package version **1.4.1**

## [1.4.0] - 2026-08-08

### Added

- Curated integration of [alirezarezvani/claude-skills](https://github.com/alirezarezvani/claude-skills): analysis in `docs/CLAUDE_SKILLS_INTEGRATION.md` (INCLUDE/DEFER/REJECT per category)
- 17 thin `route3-*` agents filling gaps (ship-gate, worktree, handoff, zero-hallucination, adversarial, spec, observability, perf, a11y, migration, ci, pr, tdd, incident, product, deeplink-research, smm)
- `agents/README.md` full catalog
- Skill-routing rows for new process/quality/marketing specialists

### Changed

- Agent roster 15 → 32; README / ARCHITECTURE / SKILL quick expert map updated
- Package version **1.4.0**

## [1.3.2] - 2026-08-07

### Changed

- Pro-level documentation: README, `docs/ARCHITECTURE.md`, `docs/QUICKSTART.md`, `docs/FACTORY.md`, `docs/SELF-IMPROVE.md`
- Reference index at `skill/references/README.md`
- npm `files` array includes `docs/` and `CHANGELOG.md`

## [1.3.1] - 2026-08-07

### Added

- `classify-risk.sh` — auto risk path `trivial` | `standard` | `factory`
- `invalidate-stale.sh` — digest mismatch → STALE (factory done fails closed)
- Mandatory self-improve: `record-lesson.sh`, `lesson-list.sh`, `lesson-rollback.sh`, `references/self-improve.md`
- Overnight ↔ factory bridge: `link-overnight.sh`, `references/overnight-factory.md`
- `eval-factory.sh` + `skill/evals/factory-evals.json`
- Factory done-gate lessons + stale coupling in `check-plan-done.sh --factory`
- Active lessons injection in `context-pack.sh`

### Changed

- `verify-slice.sh` presets (`lint` / `tsc` / `test` / `test:unit`) and auto lesson on FAIL
- `state-schema.json` expanded for artifacts / slice terminals / lessons
- Boss-discipline and factory-contract docs for risk + stale + lessons

## [1.3.0] - 2026-08-07

### Added

- Factory v2 **SHIP-WITH-CUTS**: run-scoped stages under `.workflow/route3/runs/<id>/`
- `init-run.sh`, `check-stage.sh`, `context-pack.sh`, `verify-slice.sh`
- `references/factory-contract.md` — VALIDATED vs APPROVED, truth precedence
- Factory smoke: `test-factory-smoke.sh`

### Changed

- Live stage gates fixed for product / architecture / plan / slice
- Default Build path remains slim-v3 **standard** (factory opt-in)

## [1.2.0] - 2026-08-06

### Added

- Boss-discipline enforcement: never self-write on `/route3`
- `assert-build-route.sh` + `BUILDER_DISPATCH` done coupling
- `references/boss-discipline.md`

### Changed

- `primary=native` means Task/Agent `route3-*`, not main-thread product edits

## [1.1.0] - 2026-08-06

### Added

- `route3-notebooklm-expert` for research-then-clarify
- Prefer Gemini Notebook `nlm` CLI over browser MCP when available
- `references/notebooklm-research.md`

### Changed

- Package bump; install docs for GitHub npm path

## [1.0.0] - 2026-08-06

### Added

- Initial publishable Route3 orchestrator skill (`route3-skill`)
- Slim-v3 contract, clarify-then-execute, Codex → Kimi → native routing
- Scripts: preflight, route-slice, ownership, plan-done, probe-backends, evals
- Domain teams: startup / project / halal / enterprise / website-agency
- Agent pack: `route3-*` experts (architect, API, DB, Next, React, UI, review, …)
- CLI: `bin/route3-skill.js` install / uninstall for Claude Code + Cursor
- MIT license; GitHub install path documented

[1.3.2]: https://github.com/vaqif14/route3-skill/compare/v1.3.1...v1.3.2
[1.3.1]: https://github.com/vaqif14/route3-skill/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/vaqif14/route3-skill/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/vaqif14/route3-skill/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/vaqif14/route3-skill/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/vaqif14/route3-skill/releases/tag/v1.0.0
