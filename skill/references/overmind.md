# Optional Overmind integration

Read only when the user requests Overmind connection, observability or a hosted /
self-hosted experiment. The local [improvement workflow](measured-improvement.md)
works without an account, SDK, MCP connection or GPU. Updating this skill alone
does not authorize installing services, exporting private data or paid experiments.
Reuse authorization already given for the concrete operation.

## Establish the real integration

Discover available Overmind MCP tools and their current schemas. CLI presence,
a repository URL or this reference does not establish connectivity. If unavailable,
report that state and continue locally; do not claim instrumentation or remote
evaluation. For setup, query current Context7 docs and verify against the actual
installed version and upstream source. Keep keys in supported secret/ignored
configuration, never in reports, commands shown to users or skill files.

The upstream SDK/CLI under `overmind/` is MIT; the platform is AGPL-3.0. This skill
adapts workflow ideas and does not vendor either implementation. Self-hosting is
a separate deployment task with external service prerequisites, not a lightweight
side effect of enabling a skill.

## Project, capability and trace scope

Start with `list_projects`, resolve the intended accessible project and pass its
`project_id` on project tools/resource queries as required by the current schema.
Do not choose the first project merely because it exists. Resolve capability,
dataset/cell, version, evaluator and model IDs from returned records.

For diagnosis use `inspect_capability_health`, `query_failures`, `query_traces`
and linked resources. For requested instrumentation use `get_instrumentation_plan`
then `verify_instrumentation`; report observed versus expected component coverage.
Do not equate an SDK installation, a successful upload or session-budget counters
with verified end-to-end tracing. Retain original trace/run IDs and distinguish
missing instrumentation from absent activity. Preview and sanitize data before
an authorized export; do not auto-upload host transcripts or credentials.

## Evaluation and optimization

Inspect dataset cells with `list_datasets`, `inspect_dataset`, `query_dataset`.
Evaluation/optimizer inputs need an eval-intent cell and pinned version, not train
or pending data. Verify the active eval set and per-row criteria before launching.
Follow pagination when reviewing an entire set.

- Standalone change evaluation: `check_evaluation_readiness`, then authorized
  `run_evaluation`, inspect completed row results, then `compare_evaluations`.
- Prompt/code optimization: `check_optimizer_readiness` in `optimize` mode, then
  authorized `start_optimizer`, followed by `inspect_optimizer_result` and the
  returned executioner instructions. Use its own baseline iteration (`order=0`);
  a separate manual evaluation is not its landing baseline.
- Model comparison: resolve the authorized model list and current limits, use
  `model_comparison` mode with the same list in readiness and launch. `hybrid`
  combines modes only when deliberately selected. Preserve explicit user models.

MCP schedules and reports optimizer work. The local executioner runs repository
commands and candidates; follow its returned `next_action` and exact command in
the intended checkout. Do not invent tools for applying diffs or posting local
iterations. A scheduled job is not completed execution. Inspect existing job /
experiment IDs after timeouts before any retry; stop at the saved limit or plateau.

The optimizer reruns repository behavior. `overmind backtest` replays recorded
LLM-call contexts and does not rerun the application/tools; its results cannot
prove end-to-end improvement. Generic generated evaluation targets likewise do
not invoke the live application. Keep these execution modes separate.

Report baseline/candidate identities, the consumed cell/version and evaluator,
coverage, per-metric regressions, errors, partial cost accounting and winning
diff. Retaining the incumbent is a valid result. Review the full diff when a
result contains a truncated patch. Applying a local winner, changing production
routing and training/deploying a model are separate actions. Fine-tuning and live
alias changes require their own requested scope; neither follows automatically
from an optimization request.

## Source and freshness

Verified against upstream commit
[`51b7c2313719099fe48cc483f0ad7b89addb3350`](https://github.com/overmind-core/overmind/tree/51b7c2313719099fe48cc483f0ad7b89addb3350)
on 2026-10-19:

- [Optimizer workflow](https://github.com/overmind-core/overmind/blob/51b7c2313719099fe48cc483f0ad7b89addb3350/overmind/skills/overmind-optimiser/SKILL.md)
- [Evaluation workflow](https://github.com/overmind-core/overmind/blob/51b7c2313719099fe48cc483f0ad7b89addb3350/overmind/skills/overmind-evaluations/SKILL.md)
- [Current platform and connection overview](https://github.com/overmind-core/overmind/blob/51b7c2313719099fe48cc483f0ad7b89addb3350/README.md)

Context7 `/websites/overmindlab_ai` was queried during this update; it returned
older workflow names. Current connected schemas and installed-version source
take precedence when documentation differs. Recheck integration details at use
time rather than treating this snapshot as a permanent API contract.
