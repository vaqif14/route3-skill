# Backend route — Codex → Kimi → native

Callers: `SKILL.md` hard rule #1; `slim-v3-contract.md`; `cli-backends.md`;
boss BUILD path. Enforced by `scripts/route-slice.sh`.

**User policy (mandatory):** every non-trivial coding slice **must** try Codex
(Sol via `codex exec`) first. If Codex is quota/OPEN/MISSING → Kimi. If both
are dead → **dispatch** native `route3-*` experts via Task/Agent (identical AC,
no apology, no ask which model). Boss never becomes the writer — see
`boss-discipline.md`.

## Router (run before BUILD)

```bash
~/.claude/skills/route3/scripts/route-slice.sh --probe   # first slice / no cache
~/.claude/skills/route3/scripts/route-slice.sh           # reuse session cache
# → ROUTE_DECISION: primary=codex|kimi|native reason=…
```

Log the `ROUTE_DECISION` line in PLAN.md. Do not invent a different order.

## Policy

| Fact | Rule |
|---|---|
| Default builder | **Codex first** (`primary=codex` when `sol=GREEN`) |
| Codex dead | **Kimi** (`primary=kimi` when `kimi=GREEN`) |
| Both dead | **Native** `route3-*` via Task/Agent — never stop; never ask; **never boss-write** |
| Quality bar | Same Done means as `slim-v3-contract.md` — native ≠ MVP |
| Trivial only | Proportionality typo/~20-line may skip probe and stay native |
| Overnight | Same ladder; if both CLI OPEN → native expert queue (not boss) |

## When each primary builds

| `primary` | How (boss invokes — does not simulate) |
|---|---|
| `codex` | `codex exec --model gpt-5.6-sol -s workspace-write -c model_reasoning_effort=high --skip-git-repo-check` |
| `kimi` | `kimi -m kimi-code/k3 -p "<task>" </dev/null` |
| `native` | Cursor `Task` / Claude Code `Agent` → `route3-*` (parallel disjoint files); same AC |

After invoke, log `BUILDER_DISPATCH:` in PLAN (`boss-discipline.md`). Run
`scripts/assert-build-route.sh` (and `--require-dispatch` before done).

Auth/pay/PII → always + **mandatory** security-auditor (any primary).

## Native parity checklist (boss, every failover to native)

Before reporting done after Codex+Kimi death:

1. Same AC as PLAN (not shrunk)
2. Writers were **dispatched** (`BUILDER_DISPATCH: via=task|agent …`) — not boss
3. `route3-reviewer` ran (writer ≠ reviewer)
4. Boss re-ran `npx tsc --noEmit` (+ targeted test/lint)
5. Auth/pay/PII → security-auditor PASS
6. `ROUTE_DECISION: primary=native …` matches `ROUTE_LAST.txt`
7. `assert-build-route.sh --require-dispatch` PASS
8. User report does **not** apologize for "model yox idi"

## Parallel native dispatch (throughput)

When both CLIs are dead, regain speed with **disjoint file ownership**:

- Split slices so experts don't touch the same file
- Dispatch react + api + ui in parallel when contracts are locked
- Architect owns contracts; improver owns FIX only

## Probe cache

`route-slice.sh` caches under `.workflow/route3/CLI_PROBE.txt` (session TTL).
Reuse until session ends; re-probe with `--probe` if mid-run Codex dies.
