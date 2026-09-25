# Route3 Evolution baseline

Scope: the Route3 product repository only. No IT Innovations repository changes.
Baseline revision: `12024c8` (Route3 2.1.0), before Evolution implementation.

| Existing component | Behavior retained | Evolution overlap decision |
| --- | --- | --- |
| `skill/SKILL.md`, `skill/references/` | Thin entrypoint, progressive procedures, authorization continuity | Add capability selection, load one selected procedure |
| `skill/scripts/session-budget.js` | Measured usage, context proxy, private bounded checkpoints | Reuse; do not infer token savings from text length |
| `skill/context/`, `skill/teams/`, `agents/` | Repository context and specialist instructions | Keep expert executors separate from procedural capabilities |
| `skill/evals/`, factory scripts | Explicit legacy factory evidence and routing | Keep legacy; add separate deterministic capability benchmark |
| `bin/route3-skill.js` | One canonical source, merged installs, recovery backups | Extend host targets and capability/curator CLI |
| `control-center/process-manager.js`, `acp.js` | Provider routing, owned processes, concurrency/output limits, Kimi ACP approvals | Add optional selected capability brief, retain process boundaries |
| `control-center/experts.js` | Builtin/custom expert identities and bounded instructions | Do not duplicate experts in procedural skill registry |
| `control-center/telemetry.js` | Bounded local session parsing, unknown stays unknown | Capability health and measured evals are separate signals |
| `control-center/telegram-bridge.js` | Exact private pairing, replay protection, supervised approvals | Preserve Telegram behavior |
| `control-center/job-history.js` | Bounded per-workspace task handoffs and restart recovery | Native factual memory complements, does not replace history |
| `control-center/server.js`, `security.js` | Loopback, Host/Origin and mutation-token checks, redaction | Apply same boundary to capability operations |
| `control-center/mac/`, `background-service.js` | Native shell and independent per-user background runtime | Reuse for new Skills/Capabilities view |
| `docs/`, `test/`, `control-center/test/` | Existing operational docs and deterministic fixtures | Extend with provenance, trust model, provider compatibility and evaluation |

Baseline validation: 64 Node tests passed before Evolution; legacy smoke,
11 context checks and 13 hook checks passed. Native app compile/self-check and
browser setup verification passed. These results prove local fixture behavior,
not external-provider authentication or task quality.

No preexisting capability registry, supply-chain review state, external catalog
crawler or NotebookLM knowledge-provider adapter existed at this revision.
