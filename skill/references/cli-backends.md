# Route3 CLI backends (class-aware: Kimi default)

**Mandatory class ladders** (see `native-primary.md`):

| Class | First GREEN wins |
|---|---|
| `code` (default) | **Kimi → Codex → Gemini → z.ai → native** |
| `design` | **Gemini → Kimi → Codex → z.ai → native** |
| `planning` / `discussion` | **z.ai → Kimi → Codex → Gemini → native** |

Run `scripts/route-slice.sh --class …` before BUILD. Invoke the routed primary
— do not skip a GREEN rung. Never ask which model. Breakers: `routing-resilience.md`.

## Probe once per session

```bash
~/.claude/skills/route3/scripts/probe-backends.sh
# → CLI_PROBE at=… / sol=GREEN|BLOCKED|MISSING …
```

`GREEN` = usable · `BLOCKED` = quota/auth/error · `MISSING` = CLI not installed.
The probe checks the success token **first** so unrelated stderr noise (MCP
transport errors, model-cache warnings) cannot fake a dead backend.

Cache in PLAN.md (`ttl=session`). Inline probes below if script unavailable.

## Inline probe commands

```bash
# Sol — prompt is POSITIONAL; `-p` is --profile on codex-cli >=0.144
codex exec --model gpt-5.6-sol -s workspace-write \
  -c model_reasoning_effort=high --skip-git-repo-check \
  "reply ONLY: OK" </dev/null

# Kimi (do NOT combine -y with -p on kimi-code ≥0.18)
kimi -m kimi-code/k3 -p "reply ONLY: OK" </dev/null

# z.ai / GLM — first installed coding backend wins
lazyglm -p "reply ONLY: OK" </dev/null
# or: zai-cli chat "reply ONLY: OK"
# or: hermes -z "reply ONLY: OK" --provider zai -m glm-5.3 --yolo --cli

# Gemini — OAuth only; unset API keys
env -u GEMINI_API_KEY -u GOOGLE_API_KEY -u GOOGLE_GENAI_API_KEY \
  gemini -m gemini-3-flash-preview -y -p "reply ONLY: OK"
```

Any quota/auth/tier error → BLOCKED that backend; `route-slice.sh` picks next rung
(Kimi → z.ai → Gemini → native). Never stop the slice.

## Invoke patterns

- **Sol critique:** `codex exec --model gpt-5.6-sol …`
- **Sol implement:** add `-s workspace-write -c model_reasoning_effort=high`
- Non-git/temp dir: always `--skip-git-repo-check`; feed `</dev/null`.
- **Kimi:** `kimi -m kimi-code/k3 -p "<task>"` (`-C` / `-r` to continue).
  Kimi is agentic (Agent / AgentSwarm); wide sweeps may parallelize.
- **z.ai:** invoke the routed `BUILD_WITH` (lazyglm / hermes `--provider zai` /
  `zai-cli chat`). Requires a GLM coding backend or `ZAI_API_KEY`. Missing
  binary → `zai=MISSING` (not a licence to skip Gemini).
- **Gemini:** `gemini -m gemini-3-flash-preview -y -p "<task>"` when
  `gemini=GREEN`. Cursor fallback: Task `model=gemini-3-flash`.
- **Gemini auth:** `~/.gemini/settings.json` →
  `security.auth.selectedType = oauth-personal` (Login with Google).
  Missing auth → open interactive `gemini` in Terminal for browser OAuth.
  Never paste API keys into chat for Route3.

## Gemini model cascade (only after Codex + Kimi + z.ai are not GREEN)

| Order | Model ID |
|---|---|
| G1 | `gemini-3-flash-preview` |
| G2 | `gemini-2.5-flash` |
| G3 | `gemini-2.5-flash-lite` |

Skip rung on 403 / usage limit / quota / billing. Last resort: Cursor Task
`gemini-3-flash` or `inherit`.

## Assignment order (coding slices) — MANDATORY

```
0. Classify slice: code | design | planning | discussion
1. Run scripts/route-slice.sh --class <class>  (Kimi first on code)
2. Design → Gemini first; planning/discussion → z.ai first
3. Preferred CLI dead → next GREEN on that class ladder (invoke, do not skip)
4. All four CLIs dead → dispatch native route3-* via Task/Agent
5. Mid-run death → re-route via route-slice.sh --probe --class <class>
6. Log BUILDER_DISPATCH; assert-build-route.sh [--require-dispatch]
```

Never shrink AC when landing on native. Never interpret failover as "boss codes".
Parity: `native-primary.md` + `boss-discipline.md`.

Apply 3-layer resilience + LKGP from `routing-resilience.md`. Log
`ROUTE_DECISION` in PLAN.md. Never invent "done" after a quota kill.

## Benchmark bias (within the mandatory ladder)

Kimi implements code when GREEN. Codex is the second implementer, not the
default. Do **not** skip Kimi because "slice looks like Codex work".

| Class | Preferred primary | Peer |
|---|---|---|
| `code` | Kimi implements; Codex second | Codex may critique |
| `design` | Gemini implements | Kimi/Codex failover |
| `planning` / `discussion` | z.ai plans / debates | Kimi/Codex failover |

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
- **Factory:** if `classify-risk` → `class=factory`, queue item **MUST** include
  `factory_run_id` (set via `init-run.sh --overnight-item` or `link-overnight.sh`)
- Human `PLAN_APPROVAL` **before** the window only; mid-loop no human stage gates
- STALE / `invalidate-stale` fail → item `status=paused_for_morning`
- Default pack: `offline-friendly`; same ladder — Codex → Kimi → native if both BLOCKED
- Morning: `.workflow/MORNING_REPORT.md` from slice terminals + overnight lessons + MEMANTO high-signal
- Detail: `overnight-factory.md`
- Digest habits: `qm-harness-ops.md` § Overnight digest
- Max 1 clarifying question per overnight window
