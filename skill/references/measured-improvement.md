# Measured capability improvement

Use this workflow for requested optimization, recurring failures, or a routing
change that needs comparative evidence. It supplements the current entrypoint;
it does not activate legacy factory gates for ordinary tasks.

No case set or evaluator yet? Refine the harness with
[recursive-harnessing.md](recursive-harnessing.md) first; its exported proposal enters this
workflow as the candidate.

## Identify the capability and failure

Name the behavior being changed, its entrypoint and owned files, input/output
contract, tools, model/provider when observable, and acceptance checks. Examples
are dispatch selection, context handoff, repository verification and remote task
recovery. Record paths and symbols; use the existing context engine if useful
rather than constructing a second repository graph.

Inspect relevant failed runs and a small successful comparison sample. Record
run/case IDs, failure class, evidence paths, affected checks and telemetry gaps.
Separate task failure, bad tool arguments, missing permissions, provider/quota
failure, incomplete output and evaluation errors. An infrastructure error is not
a zero quality score. A passing test alone does not establish product quality.
Host session logs are not automatically capability traces or exportable datasets.

## Freeze a fair comparison

Before changing the candidate, save a short experiment record under
`.workflow/route3/experiments/<id>/` containing:

- Hypothesis, capability, authorized scope and the incumbent revision/diff.
- Case-set identity, evaluator/rubric identity, execution environment and mode.
  Use SHA-256 of the exact retained artifacts, not labels like `latest`.
- Expected case IDs, critical checks, required coverage, and the objective to
  improve. Keep correctness gates separate from resource measures.
- Candidate/iteration limit and stop condition appropriate to the authorized
  work. Do not invent a paid budget or expand an approved one.
- Measured or unknown token, latency and cost fields; a rollback artifact and
  exact acceptance checks. Preserve unrelated working-tree changes.

Keep conversation/task groups together when splitting examples. Development
examples can guide edits; hold final examples aside for final validation. Do not
train on final answers or change the rubric after seeing scores. If the suite,
judge or environment changes, create a new protocol and remeasure the incumbent.
Model identity is a subject variable in an authorized model comparison; keep
provider translation and all other conditions visible and fixed where possible.

## Execute and inspect

Run the incumbent and candidate with the same cases, checks and environment.
Store the candidate diff, execution evidence and individual case results. Prefer
deterministic checks where they express the requirement; use an independent
reviewer for semantic judgments when practical. Disclose reviewer/model identity
and any self-assessment. A digest binds an artifact; it does not prove its claims.

For standardized local comparison use:

```bash
python3 <skill>/scripts/compare-runs.py baseline.json candidate.json > comparison.json
```

The helper consumes reports; it does not execute agents, generate scores or
upload data. Exit 0 means eligible improved candidate, 1 retains the incumbent
(including unchanged/incomplete evidence), 2 means malformed input. Inspect the
JSON even after exit 1. Reports follow this compact example:

```json
{
  "schema_version": 1,
  "run_id": "baseline-001",
  "capability": "route3.dispatch",
  "subject": "revision-or-diff-sha256-and-model-identity",
  "protocol": {
    "dataset_sha256": "64 lowercase hex characters",
    "evaluator_sha256": "64 lowercase hex characters",
    "environment_sha256": "64 lowercase hex characters",
    "execution_mode": "repository"
  },
  "cases": [{
    "id": "provider-quota-fallback",
    "critical": true,
    "status": "passed",
    "evidence": [{"path": "case-001.log", "sha256": "64 lowercase hex characters"}],
    "metrics": {"duration_ms": 120, "input_tokens": null, "output_tokens": null, "cost_usd": null}
  }]
}
```

Replace digest descriptions with actual hashes. Relative evidence paths resolve
from each report's directory; absolute paths are also supported. Retain evidence
files unchanged. Statuses are `passed`, `failed`,
`error`, `not_run`. Every graded case needs at least one existing, hash-matching
evidence file. `critical` is required and must match across reports. Metrics are
optional, nonnegative measured numbers or null; missing values stay unknown.
Use `recorded_model` instead of `repository` only for recorded-context model
replay; it does not test tool execution or end-to-end behavior.

The helper requires identical protocol fingerprints and case IDs, verifies
evidence hashes and reports missing/error/skipped coverage. Any lost passing
case prevents adoption even if the average rises. Any remaining candidate
critical failure also prevents adoption. Metrics compare only paired, graded
cases with known values on both sides and report that coverage explicitly.
An overflowing resource aggregate remains null with `aggregate_overflow` recorded;
it does not invalidate otherwise complete quality evidence.
No win is inferred solely from lower cost or tokens. For efficiency-only work,
retain the quality-equivalent candidate as a proposal and assess the predeclared
resource objective, repeated measurements and critical checks separately; the
helper does not automatically promote ties. It compares reported artifacts,
not the truth of evaluator judgments or whether the claimed protocol was used.

## Adopt or retain

Report improved, regressed, unchanged or insufficient evidence, including paired
wins/losses, coverage, critical failures, and measured resource deltas. Descriptive
differences are not statistical significance. Do not use a partial mean to name a
winner or extrapolate partial cost accounting to total spend.

An eligible result is a proposal until the diff is reviewed and the requested
change is applied within existing authorization. Pin the adopted revision and
keep its rollback path. Do not reset unrelated work, switch live aliases or
change the user's model preference on the basis of a score. Record recurring
failures with the existing `record-lesson.sh` and sanitized evidence; lesson
injection is not permission for a new experiment or mid-task skill rewrite.
Stop at the iteration limit, plateau, budget boundary or unresolved external
state; resume from saved receipts rather than rerunning unknown work.

This local workflow adapts the capability → evidence → evaluation → candidate
diff loop from [Overmind](https://github.com/overmind-core/overmind), without a
runtime dependency. Integration details are in [overmind.md](overmind.md).
