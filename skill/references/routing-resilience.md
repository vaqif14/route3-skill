# Route3 routing resilience (adapted from OmniRoute)

Source patterns: [OmniRoute](https://github.com/diegosouzapw/OmniRoute) Auto-Combo,
Resilience Guide, Fusion — adapted for Route3's Sol / Kimi / Gemini / native-agent
backends. This is **orchestration policy**, not an OmniRoute install requirement.

## Why these patterns

Route3 already picks winners by benchmark and fails over on quota. OmniRoute adds
operational semantics Route3 was missing:

1. **Mode packs** — same cascade, different scoring bias per slice class
2. **3-layer resilience** — provider vs connection vs model scoped failures
3. **LKGP** — stick to the last successful backend inside a multi-step slice
4. **Fusion** — named fan-out + judge (maps to Discussion protocol)
5. **Decision log** — every route choice is auditable in PLAN.md / MEMANTO

## Mode packs (slice bias)

Pick a pack when writing the slice brief. Pack changes **weights**, not the
failover chain order.

| Pack | Use when | Bias |
|---|---|---|
| `quality-first` (default coding) | Deep SWE, schema, security, marathon features | Benchmark winner hard; tolerate latency |
| `ship-fast` | Small fix, typo, one-file polish, overnight buffer low | Prefer native agent team / fastest available rung |
| `cost-saver` | Bulk refactors, doc sweeps, low-risk parallel slices | Prefer Gemini cascade / cheaper rung earlier |
| `offline-friendly` | Quota pressure, weekend, overnight marathon | Prefer headroom: skip rungs with recent 403; LKGP sticky |
| `fusion` | High-stakes plan/ADR, conflicting expert proposals | Fan-out ≥2 voices + boss-as-judge (see below) |

Map to backends (still subject to benchmark table + failover):

| Pack | Prefer first | Then |
|---|---|---|
| `quality-first` | Codex first (mandatory); peer Kimi critique if both GREEN | Gemini G1→G3 → native |
| `ship-fast` | Codex if GREEN else Kimi else native (same ladder, shorter debate) | Never skip Codex when GREEN |
| `cost-saver` | Gemini G1 (if primary dead or slice is low-risk) | Keep AC; do not re-litigate routing |
| `offline-friendly` | LKGP of this session | Skip OPEN breakers; probe HALF_OPEN |
| `fusion` | Parallel experts / Sol+Kimi proposals | Boss synthesis (never silent majority) |

## 3-layer resilience (CLI backends)

Keep layers separate when debugging — same OmniRoute rule.

### L1 — Backend circuit breaker (Sol / Kimi / Gemini-rung / native-family)

Scope: an entire execution backend (e.g. "Sol CLI", "Kimi CLI", "Gemini G1").

| State | Meaning | Boss action |
|---|---|---|
| `CLOSED` | Healthy | Use normally |
| `DEGRADED` | Errors rising but still usable | Prefer peer; still allow if winner |
| `OPEN` | Repeated hard fails | Skip this backend for cooldown |
| `HALF_OPEN` | Cooldown elapsed | One probe slice only; success → CLOSED |

Trip on: auth death, quota 403 with `limit: 0`, repeated process crash, "Not inside
a trusted directory" after preflight already set, provider billing hard-fail.

Do **not** trip L1 on: single flaky test, review FIX verdict, NEEDS_CLARIFICATION,
or a wrong code answer that still completed.

Defaults (session-scoped, record in PLAN.md):

| Backend | Degrade after | Open after | Cooldown |
|---|---|---|---|
| Sol / Kimi | 2 hard fails | 3 hard fails | 15 min |
| Gemini G1–G3 | 1 quota/auth fail | 2 hard fails | 10 min |
| Native route3-* family | n/a (per-agent STATUS) | treat FAILED agent as lockout of that agent id | resume via SendMessage |

### L2 — Connection / auth cooldown

Scope: one credential path (OAuth session, API profile, Antigravity Google login).

- 429 / rate-limit → wait `Retry-After` if present, else exponential backoff
- OAuth expired → run browser login flow (see SKILL.md Gemini auth); mark cooldown
  until probe OK
- Never overwrite a terminal state (`banned`, `credits_exhausted`) with a short cooldown

### L3 — Model / rung lockout

Scope: one model id inside a family (e.g. `gemini-2.5-flash-lite` only).

- One rung 403 → lock that rung; continue cascade to next
- Success on a sibling rung does **not** clear the locked rung until cooldown ends
- Success-decay: a later successful probe on the locked rung clears it early

## LKGP — Last-Known-Good Path

Inside one Route3 run (one PLAN.md session):

1. After first successful CLI/native build that passes boss-check gates, pin
   `LKGP=<backend>` in PLAN.md + MEMANTO event.
2. Follow-up slices of the **same** task class prefer LKGP if its breaker is not OPEN.
3. Clear LKGP when: user switches preferred model, overnight window ends, or LKGP
   trips OPEN.
4. Never let LKGP override a hard benchmark mismatch (e.g. do not force Kimi onto
   premium UI polish just because LKGP=Kimi) — pack + benchmark still win for
   **first** assignment; LKGP wins for **retries / continuations**.

## Fusion (high-stakes)

Maps OmniRoute `fusion` → Route3 Discussion protocol with stricter rules:

1. **Fan-out** — ≥2 relevant experts (or Sol+Kimi) propose in parallel; tools/code
   disabled in proposal round.
2. **Quorum** — need ≥2 substantive proposals before critique; if only 1 returns,
   escalate timeout once, then boss decides solo (log why).
3. **Judge** — boss synthesizes; anonymize brand bias ("Source A/B") when relaying
   critiques so experts attack substance.
4. **Tool-bearing bypass** — if the slice already has a locked implementation brief
   + AC, skip fusion and go BUILD (same spirit as OmniRoute skipping fusion when
   `tools` are required).
5. **Degradation** — 0 proposals → BLOCKED; 1 proposal → adopt with explicit risk note.

Use fusion for: architecture ADRs, auth/payments design, schema migrations with
destructive risk, multi-team split disputes.

## Pipeline strategy

Already Route3's default:

```
RESEARCH? → ARCHITECT → DEBATE/FUSION? → BUILD → TEST → REVIEW → IMPROVE → BOSS CHECK → DOCS?
```

OmniRoute `pipeline` reminder: each step's **artifact refs** feed the next
(handoff policy) — never "see above".

## Decision log (mandatory)

After every backend pick or failover, append one line to PLAN.md:

```text
ROUTE_DECISION: slice=<id> pack=<pack> primary=<backend> reason=<benchmark|lkgp|failover|fusion>
  attempted=<list> final=<backend> breaker=<CLOSED|DEGRADED|OPEN|HALF_OPEN> evidence=<probe or error tail>
```

High-signal decisions also → `memanto remember --type event`.

## Optional: OmniRoute as a transport

If the user already runs OmniRoute locally (`http://localhost:20128/v1`) and wants
CLIs to share its cascade/compression:

- Point Codex / OpenAI-compatible tools at OmniRoute; keep Route3 **boss logic**
  (briefs, debate, boss check, approval gates) unchanged.
- Prefer OmniRoute model ids `auto/coding` (quality) or `auto/fast` (ship-fast pack)
  only when the user explicitly enabled this path.
- Never install or require OmniRoute for Route3 to function.
- Never put OmniRoute API keys into the product repo.

Setup (user-owned, only when asked):

```bash
# User machine — not part of product build
npm install -g omniroute   # optional
omniroute                   # dashboard :20128
omniroute setup-codex       # or setup-claude / launch-codex
```

## What we deliberately did NOT import

| OmniRoute feature | Why skipped in Route3 |
|---|---|
| 12-engine prompt compression | Boss briefs stay full-fidelity; compression risks AC loss |
| MITM / TPROXY / stealth TLS | Out of scope for coding orchestration |
| Provider catalog / free-tier stacking | Route3 routes agents, not HTTP LLM proxies |
| Cost USD budgets per request | No durable billing meter in the skill |
| Bandit exploration traffic | Overnight must be deterministic; no random provider probes |

## Source map

| OmniRoute doc | Route3 use |
|---|---|
| `docs/routing/AUTO-COMBO.md` | Mode packs, LKGP, task fitness, fusion |
| `docs/architecture/RESILIENCE_GUIDE.md` | 3-layer breaker / cooldown / lockout |
| `docs/guides/CLI-INTEGRATIONS.md` | Optional OmniRoute transport only |
| `AGENTS.md` doc-accuracy rules | Boss + docs-writer: verify before documenting |
