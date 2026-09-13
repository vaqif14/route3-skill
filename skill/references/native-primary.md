# Backend route — class-aware (Kimi default)

Callers: `SKILL.md` hard rule #1; `slim-v3-contract.md`; `cli-backends.md`;
boss BUILD path. Enforced by `scripts/route-slice.sh --class …`.

**User policy (mandatory):** pick the slice **class**, then invoke the first
GREEN backend on that class ladder. Boss never becomes the writer — see
`boss-discipline.md`.

| Class | When | Ladder (first GREEN wins) |
|---|---|---|
| `code` (default) | Implementation, bugfix, tests, API | **Kimi → Codex → Gemini → z.ai → native** |
| `design` | UI/UX, visual, layout, design-image | **Gemini → Kimi → Codex → z.ai → native** |
| `planning` | Feature planning, PRODUCT, roadmap | **z.ai → Kimi → Codex → Gemini → native** |
| `discussion` | Agent debate, critique, fusion | **z.ai → Kimi → Codex → Gemini → native** |

Kimi is the **default implementer**. Codex is **second** on code slices.
Gemini owns design. z.ai owns planning and agent discussion. All four stay
active: if the class-preferred CLI is dead, fail over — do not skip a GREEN
rung and do not boss-write.

## Router (run before BUILD)

```bash
~/.claude/skills/route3/scripts/route-slice.sh --probe --class code
~/.claude/skills/route3/scripts/route-slice.sh --class design
~/.claude/skills/route3/scripts/route-slice.sh --class planning
# → ROUTE_DECISION: primary=… class=code|design|planning|discussion …
```

Log the `ROUTE_DECISION` line in PLAN.md. Do not invent a different order.

## Policy

| Fact | Rule |
|---|---|
| Default builder | **Kimi first** on `class=code` (`primary=kimi` when `kimi=GREEN`) |
| Kimi dead (code) | **Codex second** (`primary=codex` when `sol=GREEN`) |
| Design slice | **Gemini first** (`--class design`) |
| Planning / discussion | **z.ai first** (`--class planning` or `--class discussion`) |
| Preferred CLI dead | Next GREEN on that class ladder — invoke, do not skip |
| All four CLIs dead | **Native** `route3-*` via Task/Agent — never stop; never ask; **never boss-write** |
| Quality bar | Same Done means as `slim-v3-contract.md` — SaaS / native ≠ MVP; require DISPATCH_PROMPT |
| Trivial only | Proportionality typo/~20-line may skip probe and stay native |
| Overnight | Same ladder; if both CLI BLOCKED → native expert queue (not boss) |


## DISPATCH_PROMPT before invoke (mandatory)

Before `codex exec` / `kimi` / z.ai / `gemini` / Task|Agent:

1. Clarify complete (D1–D11) + draft `AGENT_MAP`
2. Write full **DISPATCH_PROMPT** per [`dispatch-prompt-contract.md`](dispatch-prompt-contract.md)
3. Status enum: `EXISTS` | `MISSING_TYPE` | `USE_EXISTING` — never invent agents
4. `SOLUTION_BAR`: SaaS production, **NO MVP**, ideal-final for AC
5. Invoke with that prompt only; boss does not meddle in writer internals mid-flight

## When each primary builds

| `primary` | How (boss invokes — does not simulate) |
|---|---|
| `codex` | `codex exec --model gpt-5.6-sol -s workspace-write -c model_reasoning_effort=high --skip-git-repo-check` |
| `kimi` | `kimi -m kimi-code/k3 -p "<task>" </dev/null` |
| `zai` | First match: `lazyglm -p "<task>"` · else `hermes -z "<task>" --provider zai -m glm-5.3 --yolo --cli` · else `zai-cli chat "<task>"` |
| `gemini` | `env -u GEMINI_API_KEY -u GOOGLE_API_KEY -u GOOGLE_GENAI_API_KEY gemini -m gemini-3-flash-preview -y -p "<task>"` (Cursor fallback: Task `model=gemini-3-flash`) |
| `native` | Cursor `Task` / Claude Code `Agent` → `route3-*` (parallel disjoint files); same AC |

After invoke, log `BUILDER_DISPATCH:` + ensure PLAN has `AGENT_MAP:` (`boss-discipline.md`,
`dispatch-prompt-contract.md`). Writer must have appended `WRITER_ACK` with the routed
`DISPATCH_TOKEN`. Run `scripts/assert-dispatch-evidence.sh` immediately after BUILD, then
`scripts/assert-build-route.sh --require-dispatch` before done.

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
