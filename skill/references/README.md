# References index

Progressive disclosure for Route3. Load only what the current step needs (`SKILL.md` table is authoritative for order).

Default: [native-primary.md](native-primary.md) makes the current AI the Team
Lead using available host agents. [efficient-dispatch.md](efficient-dispatch.md)
defines bounded briefs. Persisted [graphs](execution-graphs.md) and
[harness](harness.md) are optional local-runtime backends.
Requested optimization uses [measured-improvement.md](measured-improvement.md), or
[recursive-harnessing.md](recursive-harnessing.md) when no ground truth exists.

The historical catalog below is for explicitly selected legacy profiles. Its
"Always" labels apply within that profile, not every Route3 invocation.

| When | File |
|---|---|
| Always (Build) | [slim-v3-contract.md](slim-v3-contract.md) |
| Always (clarify) | [clarify-then-execute.md](clarify-then-execute.md) |
| Boss never self-writes | [boss-discipline.md](boss-discipline.md) |
| Dispatch prompt + AGENT_MAP (before invoke) | [dispatch-prompt-contract.md](dispatch-prompt-contract.md) |
| Defaults / portability | [project-profile.md](project-profile.md) |
| Grill modes | [matt-grill-flow.md](matt-grill-flow.md) |
| NotebookLM research → clarify | [notebooklm-research.md](notebooklm-research.md) |
| Skill pick | [skill-routing.md](skill-routing.md) |
| Pipeline / design | [build-pipeline.md](build-pipeline.md) |
| Agents / user gates | [agents-and-gates.md](agents-and-gates.md) |
| Current AI → native agents (default, replaces fixed vendor ladders) | [native-primary.md](native-primary.md) |
| Parallel writers | [parallel-ownership.md](parallel-ownership.md) |
| Ponytail / YAGNI | [ponytail-ladder.md](ponytail-ladder.md) |
| Product patterns | [product-engineering.md](product-engineering.md) |
| CLI / overnight queue | [cli-backends.md](cli-backends.md) |
| Overnight flap / resilience | [routing-resilience.md](routing-resilience.md) |
| QM / harness ops | [qm-harness-ops.md](qm-harness-ops.md) |
| Evals | [evals.md](evals.md) |
| Factory (opt-in) | [factory-contract.md](factory-contract.md) |
| Overnight ↔ factory | [overnight-factory.md](overnight-factory.md) |
| Self-improve (mandatory) | [self-improve.md](self-improve.md) |
| Evidence loops / retries | [loop-contract.md](loop-contract.md) |
| STATE schema (machine) | [state-schema.json](state-schema.json) |
| Legacy slim-v2 (compat) | [slim-v2-contract.md](slim-v2-contract.md) |

Domain playbooks live under [`../teams/`](../teams/). Scripts under [`../scripts/`](../scripts/). Top-level docs: [`../../docs/`](../../docs/).
