# 2.0.0 — Measured orchestration and Mac control center

- Add local session usage accounting, context recommendations and private checkpoints.
- Add native Mac control center with real agent jobs and OpenClaw/browser/Telegram controls.
- Run Kimi jobs over ACP so its tool approvals arrive in the panel instead of being
  auto-approved; unknown agent requests get a deterministic JSON-RPC error and
  cancellation denies every open approval.
- Build the AppKit/WebKit shell (`npm run mac`) with explicit server ownership: attach to
  a healthy external server, start and own one only when none exists, stop only what it owns.
- Make default dispatch bounded and avoid repeated approval ceremony and paid availability probes.
- Preserve active class-aware routing, context engine and opt-in factory hooks.
- Replace destructive upgrades with staged installs and backups; support Codex and OpenClaw skill paths.
- Add fixture-based telemetry, process, ACP, HTTP boundary, installer and checkpoint validation.

# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.5.0] - 2026-08-08

Three layered failures kept the skill from ever acting as a boss orchestrator:
the Codex probe could not succeed, activation was non-deterministic, and
dispatch was self-attested. A/B/C below fix them.

### Fixed

- **(A) Codex is selectable again.** `probe-backends.sh` passed the probe prompt
  as `-p`, which is `--profile` on codex-cli ≥ 0.144 — every probe errored, so
  `sol` was always classified unusable and `route-slice.sh` always emitted
  `primary=native reason=codex_and_kimi_quota`. The prompt is now positional.
- **(A) Success is checked before failure.** The classifier tested error/quota
  patterns first, so unrelated stderr (`ERROR rmcp::transport::worker` from an
  MCP server, `ERROR codex_models_manager` from the model cache) produced a
  false negative; only `tail -n 5` accidentally masked it. `OK` is now matched
  first, with a word boundary so `TOKENS` cannot fake a pass, over `tail -n 20`.

### Added

- **(B) `skill/commands/route3.md`** — a real `/route3` slash command. No command
  file existed anywhere, so activation depended on the model choosing to load
  the skill. The command hard-codes the boot order: read `SKILL.md` in full →
  `route-slice.sh --probe` and log `ROUTE_DECISION` **before** touching any
  product file → clarify D1–D11 → DISPATCH_PROMPT → dispatch → evidence gate.
- **(B) Installer ships the command.** `skillPaths()` gained a `commands` entry
  (`~/.claude/commands/route3.md`, `~/.cursor/commands/route3.md`), copied on
  `install` and removed on `uninstall`; the parent dir is created if absent.
- **(C) `DISPATCH_TOKEN` + `WRITER_ACK`.** `route-slice.sh` stamps a random token
  into `.workflow/route3/DISPATCH_TOKEN` at route time. Every writer must append
  `WRITER_ACK: agent=<name> token=<token> at=<ISO8601>` to
  `.workflow/route3/WRITER_ACK.md` as part of returning.
- **(C) `skill/scripts/assert-dispatch-evidence.sh`** — fails unless an ack
  matches the routed token and its agent is not the boss. Wired into
  `assert-build-route.sh --require-dispatch` and required **immediately after
  BUILD**, not only at done-time. Same evidence-binding idea as
  `record-lesson.sh` `quality=bound` vs `unbound`.
- **(C) `skill/evals/route-evals.json` + `scripts/eval-route.sh`** — 9 offline
  assertions (probe GREEN incl. under stderr noise, quota → BLOCKED, `sol=GREEN`
  → `primary=codex`, and missing / stale / boss-authored / valid acks). Runs as
  step 12 of `test-factory-smoke.sh`.

### Changed

- Package version **1.5.0**
- **Default builder is now Codex**, per the intended Codex → Kimi → native
  ladder. There is no flag to restore the old always-native behavior.
- Backend probe status `OPEN` renamed to **`BLOCKED`** — `OPEN` read as
  "available" while meaning "unusable". Updated in `probe-backends.sh`,
  `route-slice.sh`, `cli-backends.md`, `native-primary.md`. The circuit-breaker
  states in `routing-resilience.md` (`CLOSED|DEGRADED|OPEN|HALF_OPEN`) are a
  separate standard namespace and keep `OPEN`, now explicitly disambiguated.
- `SKILL.md` `description` leads with the `/route3` trigger; long tail dropped.
- `dispatch-prompt-contract.md` STOP / RETURN carries the mandatory WRITER_ACK,
  so Codex, Kimi and native `route3-*` writers all receive it from one source.

### Notes

- Kimi remains genuinely quota-dead (403 for the billing cycle). Its `-p` is a
  real `--prompt` flag on kimi-code 0.18.0, so no flag-shape fix was needed.
- Fix D (blocking file-write hook) was explicitly deferred and is not included.

## [1.4.3] - 2026-08-08

### Added

- `skill/references/loop-contract.md` — evidence-loop contract (Trigger · Goal · Evidence · Feedback · Stop rules · improver ≤2 · escalate to human); **loop on evidence, never on agent confidence**
- `docs/ARCHITECTURE.md` § Harness / Loop / Graph — diagnostic vocabulary + "diagnose before fix" triage (harness = cannot operate, loop = flaky/repeats, graph = branching/approvals); explicitly **not** a second spine
- Graph discipline in `parallel-ownership.md` (+ slice edge rule in `factory-contract.md`): real edge = consumes the prior artifact, diamond split/parallel/merge, barrier only for true fan-in, worktree only for real concurrent writers
- Factory PRODUCT verdict: `VERDICT: BUILD | BUILD_SMALLER | PARK | SCRAP | NEEDS_MORE_INPUT` + sharp-problem axes (workaround · frequency · willingness-to-pay, ≥3x bar) and `VERDICT_REASON` in `agents/route3-product.md`
- `check-stage.sh` product gate: `SCRAP`/`PARK` blocks architecture without a human `PRODUCT_OVERRIDE:` line; `NEEDS_MORE_INPUT` never validates; missing `VERDICT` warns only (backward compatible)
- Hard rules 17 (**Product may refuse**) and 18 (**Diagnose layer first**)
- Curated catalog rows for external [productmind-skills](https://github.com/ojiudezue/productmind-skills) `vet-a-feature` / `sharp-problem-test` — install + route only (CC BY-SA, never vendored)
- Evals: product SCRAP blocks architecture, override validates, ownership overlap fails, VERIFY FAIL needs a bound lesson

### Changed

- Package version **1.4.3**
- `qm-harness-ops.md` scoped as the **harness** layer with cross-links to loop / graph layers
- `slc-or-mvp` / `scope-cutter` listed as startup/product-lane **optional only** — the Route3 engineering bar stays SaaS production-complete (scope cuts = fewer AC, never MVP stubs)

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
