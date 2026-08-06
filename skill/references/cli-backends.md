# Route3 CLI backends (mandatory Codex → Kimi ladder)

**Mandatory order** for non-trivial coding slices (see `native-primary.md`):
**Codex/Sol → Kimi → native**. Run `scripts/route-slice.sh` before BUILD.
Never block the whole job on a dead CLI — failover silently. Never ask which
model. Breakers: `routing-resilience.md`.

## Probe once per session

```bash
~/.claude/skills/route3/scripts/probe-backends.sh
# → CLI_PROBE at=… / sol=GREEN|OPEN|MISSING …
```

Cache in PLAN.md (`ttl=session`). Inline probes below if script unavailable.

## Inline probe commands

```bash
# Sol
codex exec --model gpt-5.6-sol -s workspace-write \
  -c model_reasoning_effort=high --skip-git-repo-check \
  -p "reply ONLY: OK" </dev/null

# Kimi (do NOT combine -y with -p on kimi-code ≥0.18)
kimi -m kimi-code/k3 -p "reply ONLY: OK" </dev/null

# Gemini — OAuth only; unset API keys
env -u GEMINI_API_KEY -u GOOGLE_API_KEY -u GOOGLE_GENAI_API_KEY \
  gemini -m gemini-3-flash-preview -y -p "reply ONLY: OK"
```

Any quota/auth/tier error → OPEN that backend; `route-slice.sh` picks next rung
(Kimi, then native). Never stop the slice.

## Invoke patterns

- **Sol critique:** `codex exec --model gpt-5.6-sol …`
- **Sol implement:** add `-s workspace-write -c model_reasoning_effort=high`
- Non-git/temp dir: always `--skip-git-repo-check`; feed `</dev/null`.
- **Kimi:** `kimi -m kimi-code/k3 -p "<task>"` (`-C` / `-r` to continue).
  Kimi is agentic (Agent / AgentSwarm); wide sweeps may parallelize.
- **Gemini auth:** `~/.gemini/settings.json` →
  `security.auth.selectedType = oauth-personal` (Login with Google).
  Missing auth → open interactive `gemini` in Terminal for browser OAuth.
  Never paste API keys into chat for Route3.

## Gemini cascade order (only after Sol+Kimi dead)

| Order | Model ID |
|---|---|
| G1 | `gemini-3-flash-preview` |
| G2 | `gemini-2.5-flash` |
| G3 | `gemini-2.5-flash-lite` |

Skip rung on 403 / usage limit / quota / billing. Last resort: Cursor Task
`gemini-3-flash` or `inherit`.

## Assignment order (coding slices) — MANDATORY

```
0. Run scripts/route-slice.sh  (Codex first if sol=GREEN)
1. Codex OPEN/MISSING/quota → Kimi if kimi=GREEN
2. Both dead → native route3-* (continue yourself; identical AC)
3. Mid-run Codex death → re-route via route-slice.sh --probe → Kimi → native
4. Optional after both CLI dead: Gemini G1→G3 only if boss elects cascade
```

Never shrink AC when landing on native. Parity checklist: `native-primary.md`.

Apply 3-layer resilience + LKGP from `routing-resilience.md`. Log
`ROUTE_DECISION` in PLAN.md. Never invent "done" after a quota kill.

## Benchmark bias (within the mandatory ladder)

Codex is always tried first when GREEN. Kimi is the quota failover (also GREEN
only). Class bias applies only when **both** are GREEN and boss splits parallel
critique — never skip Codex because "slice looks like Kimi work".

| Class | If both GREEN (optional peer critique) |
|---|---|
| Deep/hard SWE, terminal, premium UX/GDPval | Codex implements; Kimi may critique |
| Frontier/program/marathon SWE, APIs/logic/tests | Codex implements first; Kimi failover |
| Cascade only | Gemini (after Codex+Kimi dead) |

Mode packs (`quality-first`, `ship-fast`, `cost-saver`, `offline-friendly`,
`fusion`) — see `routing-resilience.md`.

## Overnight queue

Invoke:

```text
/route3 overnight:
1. [task]
Window: 5h.
```

Legacy: "night-shift", "yatanda bitir".

- State: `.workflow/night-shift/STATE.json` + `QUEUE.json`
- Scripts: `scripts/night-shift-swarm.sh` (`start` = queue only;
  `run-loop` needs `NIGHT_SHIFT_AUTO=1` + `NIGHT_SHIFT_I_UNDERSTAND=1`)
- Per item: FREEZE → PLAN → CODE → DIFF_REVIEW → VERIFY → DELIVER
- Default pack: `offline-friendly`; same ladder — Codex → Kimi → native if both OPEN
- Morning: `.workflow/MORNING_REPORT.md` + MEMANTO high-signal
- Digest habits: `qm-harness-ops.md` § Overnight digest
- Max 1 clarifying question per overnight window
