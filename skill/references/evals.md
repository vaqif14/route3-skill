# Route3 trigger + clarify + quality evals

Callers: `SKILL.md`; `scripts/eval-triggers.sh`; description edits.

## Trigger eval

File: `evals/trigger-evals.json` — target ≥ **0.9** should_trigger and
should_not_trigger.

```bash
~/.claude/skills/route3/scripts/eval-triggers.sh
```

Hostile drill: add 3 fresh paraphrases after description edits.

## Clarify eval (professional gate)

File: `evals/clarify-evals.json`

Boss self-check before first BUILD of a session (or after skill edit):

| id | Prompt class | Must |
|---|---|---|
| cl-ask | Ambiguous feature ask | Enter clarify; ask ≥1 material Q; no code |
| cl-defaults | Brand/AZN/locale only | Do **not** ask (profile) |
| cl-aligned | User said yes to all after package | ALIGNED + preflight then build |
| cl-open | Package with open dim | Must NOT set ALIGNED |

Score = correct / total. Target ≥ **0.9**.

## Slice quality eval

```text
SLICE_EVAL:
  ac_gateable: yes|no
  clarify_complete: yes|no
  preflight: PASS|FAIL
  boss_gates_rerun: yes|no
  reviewer: SHIP|FIX|REJECT
  security_if_needed: PASS|N/A|FAIL
  route_primary: codex|kimi|native
  ownership_ok: yes|n/a|no
  user_verify_path: <one line>
  score: 0-5
```

Rubric: 5 = clarify+AC+SHIP+verify; 3 = works but soft AC; 1 = coded before
clarify or trusted self-scorecard.

**Hard gates:**

```bash
scripts/check-preflight.sh    # before BUILD
scripts/check-plan-done.sh    # before done
```

## Regression

Description/contract changes that drop trigger or clarify score below
threshold → revert; do not bloat SKILL.md.
