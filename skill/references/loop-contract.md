# Route3 loop contract — evidence cycles

Callers: `SKILL.md` progressive row; `self-improve.md`; `scripts/verify-slice.sh`;
`scripts/check-plan-done.sh`.

A **loop** is any cycle where Route3 acts, checks, and decides whether to go again.
Layer vocabulary (harness / loop / graph): `docs/ARCHITECTURE.md` + `qm-harness-ops.md`.

**Iron rule: loop on evidence, never on agent confidence.** A pass repeats only
because an artifact says so — `VERIFY.md`, command output, reviewer verdict, gate
script exit code. "The builder says it is fixed" is not a loop signal. Lessons stay
evidence-bound (`self-improve.md`: `quality=bound` or it did not happen).

## Every verify / improver cycle documents

| Field | Meaning | Route3 source |
|---|---|---|
| Trigger | what starts a new pass | `VERIFY_STATUS: FAIL`, reviewer `FIX`/`REJECT`, red gate, `BUILD_PROOF` fail |
| Goal | the bar being tested | slice `acceptance:` AC / BRIEF goal — never re-negotiated mid-loop |
| Evidence | generated observation, not prose | `slices/NNN/VERIFY.md`, lint/tsc/test output, reviewer verdict |
| Feedback shape | what the next pass receives | failing command + output tail + AC id + allowed files (BRIEF / CONTEXT) |
| Stop rules | when the loop ends | evidence PASS, retries exhausted, budget out, or blocked on a human gate |
| Max retries | hard ceiling | improver **≤ 2** passes per slice — a 3rd pass is a violation |

**Escalate to human** when retries or budget are exhausted, when the AC itself looks
wrong, or when the next step needs an `APPROVED` gate. Escalation is a legal terminal
state: report `BLOCKED` / `NEEDS_APPROVAL` with the last evidence path. Quiet extra
passes are not.

## Route3 loops today

| Loop | Trigger | Evidence | Stop |
|---|---|---|---|
| Slice verify | BRIEF `verify:` commands after BUILD | `VERIFY.md` (generated, never builder prose) | `VERIFY_STATUS: PASS`; FAIL → bound lesson → retry or escalate |
| Reviewer → improver | reviewer `FIX` / `REJECT` | reviewer verdict + re-run verify | PASS, or 2 improver passes then escalate |
| Factory stage re-validate | upstream digest change → `STALE` | `invalidate-stale.sh` exit + `STATE.artifacts` | stage re-`VALIDATED` by `check-stage.sh` |
| Overnight queue | queued item inside the 5h window | per-item VERIFY + `MORNING_REPORT.md` | window end or queue drained; no mid-loop human gate |

Boss runs the loop; boss does not become the writer inside it (`boss-discipline.md`).
Reviewer ≠ writer holds on every pass.

## Anti-patterns

- **Confidence-stop** — closing because the writer sounds sure; no evidence file.
- **Infinite improver** — a 3rd+ improver pass instead of escalating to the user.
- **"Looks good" close** — reviewer prose with no verdict token.
- **Self-grade** — the context that wrote the diff also checking it.
- **No stop condition** — a loop with no retry ceiling and no budget.
- **Goal drift** — weakening AC so the next pass passes.
- **Unbound lesson** — FAIL recorded without digest / evidence path.
