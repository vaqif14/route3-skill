# Route3 GitHub App — Reference Architecture

Status: **frozen target architecture**. Delivered in slices; never reduced.
Frozen: 2026-09-15. Baseline revision: `12024c8` (route3-skill 2.1.0).
Deployment decision record: private beta (operator + invited orgs), gateway on
the Dell T5600 behind Cloudflare Tunnel, execution on a paired macOS runner.

This document is the north star. Each delivery slice gets its own spec under
`docs/superpowers/specs/`. A slice may implement a subset of this document; it
may never contradict it, and it may never ship a security invariant as a stub.

---

## 0. Product definition

Route3 is not `GitHub webhook -> Claude -> PR`. It is a GitHub-native,
multi-agent, policy-driven, security-isolated, evidence-based, model-agnostic,
skill-aware, repository-aware, cost-aware, self-observing, human-controlled
software-engineering control plane.

---

## 1. Non-negotiable invariants

These hold in every slice, from the first commit. A change that weakens one is
a design change to this document, not an implementation detail.

| # | Invariant |
|---|---|
| I1 | The runner NEVER receives the GitHub App private key, an App JWT, an installation access token, or a PAT. |
| I2 | The gateway NEVER executes repository code. |
| I3 | The runner NEVER performs GitHub writes. |
| I4 | Agent output is untrusted data. |
| I5 | Repository content is untrusted input and never overrides Route3 policy. |
| I6 | The publisher is deterministic and NEVER invokes an LLM. |
| I7 | Source analysis is bound to an immutable commit SHA. |
| I8 | No publication occurs against a stale or unexpected base SHA. |
| I9 | No unverified claim is represented as verified. |

---

## 2. Topology and trust boundaries

```
GitHub
  |  webhook (HMAC-SHA256 over raw bytes)
  v
+---------------------------------------------+
| GATEWAY   Dell T5600, Cloudflare Tunnel     |  app/gateway/
|  ingress . authz . command registry         |
|  job store (PostgreSQL) . runner API        |
|  source snapshots . publisher . audit       |
|  GitHub App JWT -> installation token       |
+---------------------------------------------+
  ^  GET  /runner/jobs/next      (long-poll, outbound only)
  |  POST /runner/jobs/:id/heartbeat
  |  POST /runner/jobs/:id/result
+---------------------------------------------+
| RUNNER    operator Mac                      |  app/runner/
|  device identity . lease . snapshot fetch   |
|  safe extraction . sandbox-exec . broker    |
|  control-center JobManager -> agent CLIs    |
|  -> ArtifactProposal (data only)            |
+---------------------------------------------+
```

| # | Boundary | Rule |
|---|---|---|
| B1 | GitHub -> gateway | The signature is the only trust. An unsigned body is never parsed as a command. |
| B2 | Gateway <-> runner | Device-bound signatures both ways. Neither side trusts the other's payload shape; both revalidate. |
| B3 | Runner -> sandbox | Repository content is hostile input. Deny-by-default filesystem and network. |
| B4 | Runner result -> publisher | Artifacts are untrusted data: schema, path policy, secret scan, security review. Nothing from a result is ever executed. |

The runner requires **zero inbound ports**. Nothing reaches the operator's home
network from the internet.

---

## 3. Resolved conflicts (amendments to the frozen sections)

The frozen sections contain four unresolved tensions. These are the binding
resolutions; the original section text is superseded where it disagrees.

### A. PostgreSQL vs. the zero-dependency property (§86)

`route3-skill` has no runtime dependencies. PostgreSQL introduces the first one.

**Resolution.** Dependencies live only in `app/`'s own `package.json`. The root
`files[]` array already excludes `app/`, so the published `route3-skill` tarball
remains dependency-free. The skill and control-center surfaces keep the
zero-dependency property; the hosted gateway does not claim it.

### B. Network DENY vs. the model broker (§13)

The sandbox denies localhost and RFC1918. The agent CLI reaches the model
through `ANTHROPIC_BASE_URL`, which requires an HTTP endpoint — a unix socket
cannot serve it.

**Resolution.** The `sandbox-exec` profile denies all network egress **except a
single, narrowly-allowed loopback port** bound by the Route3 broker for the
duration of the job. LAN, RFC1918, link-local, metadata IPs, GitHub, databases
and gateway admin APIs remain denied. The broker holds the model credential;
the sandbox receives a per-job opaque token that is valid only for that job.

### C. EXECUTION_TEST vs. network DENY (§21) — capability gap

`/route3 fix tests` requires running the repository's test command, which on a
cold checkout requires a package install, which requires registry egress. With
egress denied, `EXECUTION_TEST` cannot run on a cold repository.

**Resolution.** Two permitted paths, both deferred past the first write-capable
slice: a dependency cache keyed on lockfile hash, or a narrowly allowlisted
registry proxy behind the broker. Until one exists, `EXECUTION_TEST` is
unavailable and every affected job reports `Tests: NOT RUN` per §93. Reporting a
test result that was not observed is a violation of I9.

### D. `sandbox-exec` is deprecated

`sandbox-exec` satisfies §11–12 (deny-by-default filesystem, path allowlists,
network filtering) and is the chosen mechanism.

**Documented limits.** It will not contain a kernel-level escape. Apple may
remove it without notice. It is a strong boundary against an agent that reads
the wrong path or opens the wrong socket; it is not a hypervisor. The container
path in `app/runner/sandbox/` stays pluggable so the profile can be swapped for
a VM or container backend without touching the executor.

---

## 4. Job lifecycle (§2)

A GitHub event is not a Route3 job.

```
GitHub event -> authenticate -> authorize -> normalize
  -> CommandRequest -> policy -> Route3Job -> immutable SourceSnapshot
  -> JobLease -> RunnerExecution -> ArtifactProposal -> validation
  -> PublicationPlan -> GitHub publication
```

States: `RECEIVED, AUTHENTICATED, AUTHORIZED, NORMALIZED, QUEUED, LEASED,
FETCHING_SOURCE, PREPARING_SANDBOX, PLANNING, EXECUTING, VALIDATING_RESULT,
READY_TO_PUBLISH, PUBLISHING, SUCCEEDED`.

Failure branches: `AUTH_REJECTED, POLICY_REJECTED, SOURCE_FAILED,
SOURCE_INTEGRITY_FAILURE, SOURCE_TOO_LARGE, RUNNER_UNAVAILABLE,
RUNNER_VERSION_UNSUPPORTED, RUNNER_LOST, LEASE_EXPIRED, SANDBOX_FAILED,
AGENT_FAILED, RESULT_INVALID, SECURITY_REJECTED, ARTIFACT_SECURITY_REJECTED,
SOURCE_STALE, PUBLISH_CONFLICT, PUBLISH_FAILED, CANCELLED, TIMED_OUT`.

Terminal: `SUCCEEDED, FAILED, CANCELLED, REJECTED, EXPIRED`.

**Invariant.** A terminal job never returns to an active state. A retry creates
a new `JobAttempt`; it never rewinds the job.

---

## 5. Webhook ingestion (§3)

Endpoint `POST /github/webhook`. The order is normative:

1. read raw bytes
2. read delivery id
3. verify HMAC-SHA256 against the **raw bytes**
4. reject if invalid
5. dedupe on delivery id
6. parse JSON
7. validate event schema
8. resolve installation
9. resolve repository
10. resolve actor
11. authorize actor
12. parse Route3 command
13. apply command policy
14. create `CommandRequest`
15. acknowledge GitHub
16. queue the job asynchronously

`JSON.parse()` before step 3 is a defect, not a style choice. Dedupe key is the
GitHub delivery id under `UNIQUE(provider, delivery_id)`; a redelivery returns
`202 duplicate` and creates no job.

Subscribed events (§33): `issue_comment, pull_request,
pull_request_review_comment, issues, installation, installation_repositories`.
Optional later: `push`, `check_suite`. Smaller surface, smaller attack surface.

---

## 6. Command model (§4)

Grammar: `/route3 <command> [subcommand] [flags]`. Parsed to a canonical AST —
never to a shell string.

```json
{ "command": "review", "target": "pull_request", "scope": "security",
  "options": { "deep": true } }
```

Commands: `review`, `review security`, `explain`, `plan`, `fix`, `fix tests`,
`architecture`, `setup`, `skill audit`, `create skill`, `cancel`.

The allowed set and each command's capabilities come from the capability
registry, never from the agent. The gateway maps command to capability; the
agent cannot widen its own permissions.

```yaml
review:
  github_read: true
  repo_read: true
  repo_execute: false
  artifacts: [review_comment]
  github_write: [issue_comment]

fix:
  github_read: true
  repo_read: true
  repo_execute: policy
  artifacts: [file_patch, summary, test_report]
  github_write: [branch, commit, pull_request]
```

---

## 7. Authorization (§5)

The webhook signature proves origin only. Four independent layers follow:

```
Installation -> Repository -> Actor -> Command
```

Default minimum actor permission: `explain` READ, `review` WRITE, `plan` WRITE,
`fix` WRITE, `setup` ADMIN.

Repository configuration may **restrict** and may never **widen**:

```
effective_policy = most_restrictive(global, installation, repository)
```

A repo declaring `setup >= READ` against a global `setup >= ADMIN` still
resolves to ADMIN.

Private beta gate: an installation allowlist is evaluated at the installation
layer. A non-allowlisted installation is `POLICY_REJECTED` with an explanatory
comment — never a silent drop.

---

## 8. Source snapshots (§6) and safe extraction (§7)

The job freezes `repository_id, repository_full_name, installation_id,
trigger_ref, trigger_sha, base_ref, base_sha, head_ref, head_sha` at creation.

The runner never clones and never holds GitHub credentials (I1). The gateway
fetches the archive with the installation token, hashes it, and issues a
single-use, short-lived download capability. The runner independently verifies
the digest; a mismatch is `SOURCE_INTEGRITY_FAILURE` and stops the job.

Extraction rejects: `../` traversal, absolute paths, symlinks and hardlinks
escaping the workspace, device files, FIFOs, sockets, invalid UTF-8 paths, path
collisions, case-fold collisions, extreme depth, archive bombs.

| Limit | Value |
|---|---|
| compressed | 50 MB |
| expanded | 250 MB |
| file count | 25,000 |
| single file | 10 MB |
| path length | 512 |
| directory depth | 32 |

Over-limit is `SOURCE_TOO_LARGE`, explained plainly in the GitHub comment.
Handing an agent half a repository is not an option.

---

## 9. Runner identity (§8), leases (§9) and claiming (§10)

A static bearer token is bootstrap-only. After one-time pairing the runner
generates an Ed25519 keypair, keeps the private key in the macOS Keychain, and
signs every request:

```
X-Route3-Runner-ID, X-Route3-Timestamp, X-Route3-Nonce, X-Route3-Signature
signature payload: METHOD | PATH | TIMESTAMP | NONCE | SHA256(BODY)
```

Gateway verifies: timestamp drift <= 60s, nonce unused, runner enabled,
signature valid.

Leases carry `jobId, leaseId, attemptId, runnerId, leasedAt, expiresAt,
heartbeatEverySeconds` (20s). A stopped heartbeat expires the lease and closes
the attempt as `RUNNER_LOST`; policy may open a new attempt. Claiming uses one
transaction with `SELECT ... FOR UPDATE SKIP LOCKED` so two runners can never
hold the same job. Runner slot count is computed from host load, not hardcoded.

Gateway may set `minimumRunnerVersion`; an older runner receives no jobs and
reports `RUNNER_VERSION_UNSUPPORTED` (§46). No auto-update — signed manual
releases only.

---

## 10. Runner workspace (§11), sandbox (§12), network (§13)

Per job: `source/ work/ artifacts/ logs/ meta/`. The agent sees `source/`
(read-only) and `work/` only; edits happen in `work/` so the snapshot stays
immutable.

Filesystem is deny-by-default. Explicitly denied: `~/.ssh`, `~/.aws`,
`~/.gnupg`, `~/Library/Keychains`, unrelated Application Support, all other
source projects, the Docker socket, the SSH agent, browser profiles, cloud
credentials, gateway secrets.

Environment is constructed, not inherited — `env -i` semantics. Only `PATH`,
`HOME` (sandbox home), `TMPDIR`, `LANG`, `ROUTE3_JOB_ID` and the broker
endpoint. The developer's shell environment never reaches the agent.

Network is deny-by-default, with the single broker loopback port of §3.B as the
only exception.

---

## 11. Orchestration (§14), routing (§15), budgets (§38–39)

```
Intent Classifier -> Capability Resolver -> Repository Profiler -> Task Planner
  -> Specialist Router -> Execution Supervisor -> Independent Reviewer
  -> Security Validator -> Artifact Builder
```

Only required specialists run. "Run every agent" is forbidden.

The router is capability-based, never provider-hardcoded: `DEEP_REASONING,
CODE_REVIEW, FAST_CLASSIFICATION, LARGE_CONTEXT, VISION, WEB_RESEARCH` are
mapped to providers by a model registry.

Every agent carries `context_budget, output_budget, tool_budget, time_budget`.
`MAX_AGENT_DEPTH = 2`, `MAX_PARALLEL_AGENTS = 4`. A specialist may not spawn a
swarm.

Generation and review are separate roles with separate context (§41), even when
backed by the same model.

---

## 12. Instruction precedence and prompt-injection defence (§20, §44)

Repository `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `SKILL.md` and `README` are
readable and classified `PROJECT_GUIDANCE`. They are never `SYSTEM_POLICY`.

```
Route3 System Policy > Installation Policy > Command Policy
  > Trusted Skill Policy > Repository Guidance > Repository Content
```

Model context marks provenance explicitly with `<route3_policy>` and
`<repository_untrusted_content>` boundaries, and the agent system prompt states
that repository text may be malicious and never outranks policy.

---

## 13. Execution policy (§21–22)

`EXECUTION_NONE` (default), `EXECUTION_STATIC`, `EXECUTION_TEST`,
`EXECUTION_BUILD`, `EXECUTION_FULL`. Review is normally `STATIC`; fix may need
`TEST` (see §3.C).

Model output is never turned into a shell string. Execution goes through
allowlisted adapters:

```json
{ "kind": "npm_test", "args": ["--", "src/foo.test.ts"] }
```

`/bin/bash -c "<model output>"` is prohibited. Generic shell is a separate
`SHELL_EXECUTION` capability that the repository owner must enable explicitly,
and any job holding it is classified `HIGH` risk.

---

## 14. Artifacts (§23–24) and publication (§25–26, §73–76)

Agents return structured results, never prose to be interpreted:

```json
{ "schemaVersion": "1", "jobId": "...", "status": "success",
  "summary": "...", "artifacts": [] }
```

Types: `COMMENT, REVIEW, FILE_CREATE, FILE_UPDATE, FILE_DELETE, PATCH,
TEST_REPORT, SECURITY_REPORT, ARCHITECTURE_REPORT, SKILL_PACKAGE, PR_METADATA,
DEPENDENCY_CHANGE`. Each type has its own JSON schema.

File artifacts pass: path normalization, no absolute path, no traversal, allowed
path, allowed extension, size limit, binary policy, secret scan, malicious
content scan, and a check that the command actually permits writes. Failure is
`ARTIFACT_SECURITY_REJECTED`.

The publisher is the only GitHub writer, is deterministic, and never invokes an
LLM (I6). It compares the current base SHA against the job's base SHA; a
divergence is `SOURCE_STALE` and no blind commit occurs (I8). Publication uses
the Git Data API: tree -> commit -> `route3/<operation>-<job-id>` branch -> PR.
No force-push to user branches; no merge to the default branch.

Risk-based approval: comments and reviews publish automatically; source patches
open a PR automatically; workflow changes, security configuration and major
dependency updates require human approval. Migration artifacts are `HIGH_RISK`
and route through database-expert, migration-reviewer and security-reviewer with
evidence for up behaviour, down behaviour, locking, data preservation, backfill
and compatibility (§76).

Every external write carries an idempotency key `route3:{jobId}:{operation}`,
and publication records its step (`BRANCH_CREATED, COMMIT_CREATED, PR_CREATED,
COMMENT_POSTED`) so a crashed publisher resumes instead of duplicating (§48–49).

---

## 15. GitHub surface (§27–28, §32, §63–66, §79)

One tracking comment per job, carrying a hidden marker `<!-- route3-job:R3-123 -->`,
edited in place through the run. Twenty new comments is a defect.

Check runs: `Route3 / Review`, `Route3 / Security`, `Route3 / Tests`, with
GitHub-native status and conclusion values. A missing permission reports
`PERMISSION_REQUIRED`, never a failure.

Permissions, minimum privilege: Metadata READ; Contents READ/WRITE; Pull requests
READ/WRITE; Issues READ/WRITE; Checks READ/WRITE; Commit statuses READ/WRITE;
Actions READ only where CI evidence is required; **Workflows NONE by default**;
Administration only with a concrete implemented requirement.

Automation defaults: `automatic_write_actions = false`. Auto-review on PR open is
permitted; auto-fix requires explicit opt-in.

Tone (§92): an engineering tool, not a mascot. Status, commit analyzed, finding
counts by severity, and what was actually verified.

---

## 16. Evidence discipline (§40, §72, §93–94)

Every finding carries `severity, title, file, startLine, endLine, evidence,
reasoningSummary, recommendation`, with line references bound to the snapshot
SHA. A sourceless assertion is not a finding.

Every assertion is internally classified `VERIFIED`, `INFERRED`, `UNVERIFIED` or
`BLOCKED`. When a tool fails, the result is `evidence unavailable` — the agent
does not substitute a guess. Tool responses are schema-validated.

If tests did not run, the output says `Tests: NOT RUN`. **Claim requires
evidence** is the governing rule (I9).

Job confidence is derived from verification, security, tests, reviewer
acceptance and artifact validity — never from a model's self-reported
confidence (§62).

---

## 17. Data model (§34–35), audit (§36), tenancy (§67)

Entities: `GitHubInstallation, Repository, WebhookDelivery, CommandRequest,
Route3Job, JobAttempt, JobLease, RunnerDevice, SourceSnapshot, ArtifactProposal,
Publication, GitHubOperation, AuditEvent, UsageRecord, ModelInvocation`.

Every table carries `installation_id`; repository ownership is verified on every
access; cross-installation access is denied. This is the SaaS-ready boundary.

The audit log is append-only; historical events are never updated. Events:
`JOB_CREATED, JOB_AUTHORIZED, LEASE_CREATED, LEASE_HEARTBEAT, SOURCE_DOWNLOADED,
SANDBOX_STARTED, AGENT_STARTED, TOOL_CALLED, ARTIFACT_RECEIVED,
ARTIFACT_REJECTED, MODEL_FALLBACK, PUBLICATION_STARTED, PR_CREATED,
JOB_COMPLETED`. Sensitive content is redacted on write.

---

## 18. Operations (§37, §45, §47–55, §68–71)

**Cost.** Per model invocation: provider, model, input/output/cached tokens,
latency, cost estimate, agent, skill, job. Per job: totals, model calls, tool
calls, wall time. Configurable budget policy per command class.

**Durability.** No memory-only queue. Across a gateway restart, queued jobs,
lease recovery, history and delivery dedupe all survive.

**Cancellation.** `/route3 cancel` sets a flag the runner observes on heartbeat;
SIGTERM, then SIGKILL after 10s, then sandbox cleanup.

**Retention.** Successful scratch 24h, failed scratch 72h, metadata long-term,
artifacts by policy, raw prompts limited. Snapshots are deleted after the job
unless debugging retention is explicitly enabled. Prefer hashes, metadata and
structured findings over stored repository content.

**Logging.** Structured events only. Never log environment, headers, GitHub
tokens or model keys; `control-center/security.js` `redact()` is the single
central utility.

**Metrics.** `route3_jobs_total`, `route3_jobs_active`, `route3_jobs_failed_total`,
`route3_job_duration_seconds`, `route3_runner_online`, `route3_runner_slots`,
`route3_model_requests_total`, `route3_model_tokens_total`,
`route3_model_cost_total`, `route3_webhook_total`,
`route3_webhook_invalid_signature_total`, `route3_security_rejections_total`.

**SLO.** Webhook ack p95 < 500 ms; job dispatch p95 < 5 s; gateway availability
> 99.5%; duplicate publication rate 0; unauthorized publication rate 0; lost
jobs 0. Security SLO: runner GitHub-token exposure 0; gateway repository
execution 0; cross-job filesystem access 0.

**Rate limiting and abuse.** Limits per IP, installation, repository, actor,
command and runner; GitHub API budget tracked separately. Repeated identical
commands coalesce on (repository, command, SHA, scope) to the existing job.
Queue priority: security incident > manual fix > PR review > issue plan >
background indexing.

**Control center.** Runner status, gateway connectivity, active jobs, queue
depth, model calls, tokens, cost, CPU/RAM/disk, history, failures, security
blocks. Actions: pause, resume, cancel, retry, drain, disable. Drain accepts no
new jobs and finishes active ones.

---

## 19. Skills and knowledge (§16–19, §58–61, §95–99)

Hierarchy: `Capability -> Skill -> Subskill -> Tool`. Each skill ships a
manifest declaring identity, version, activation rules, required capabilities,
filesystem/network/execution permissions, inputs, outputs, risk, preferred
agents and model requirements — so Route3 knows what it does, when it activates,
what it may access, what it may output and how risky it is.

External skills are never blind-copied. Lifecycle: `DISCOVERED -> QUARANTINED ->
LICENSE_REVIEWED -> SECURITY_AUDITED -> NORMALIZED -> TESTED -> TRUSTED`. Only
`TRUSTED` enters automatic routing. Popularity is not trust.

`route3-notebook-research` wraps the pattern from `jacob-bd/gemini-notebook-mcp-cli`
for large documentation corpora, architecture research, RFC correlation,
historical design synthesis, deep onboarding and explicit deep-research
requests. It does not activate for single-file bugs, small test fixes or simple
reviews. Notebook content is untrusted source material and the notebook holds no
write capability.

Repository profile, dependency map, symbol index and documentation index are
cached on `repository_id + commit_sha` — never on repository name alone. Route3
memory (architecture decisions, commands, test strategy, deployment model,
conventions) is stored with evidence and the source SHA, with stale detection.

Search is an abstraction over lexical, symbol, semantic, git-history,
documentation, notebook and web sources; the router selects per task. Web
research is off by default. Cheap operations — command parsing, classification,
profile deltas, simple routing — never reach a deep reasoning model.

The learning router may derive routing recommendations from telemetry, but
emits `ROUTING_RECOMMENDATION` for human approval. No autonomous
self-modification.

---

## 20. Deployment (§83–91)

```
Cloudflare Tunnel -> Route3 Gateway -> PostgreSQL     (Dell T5600)
Gateway outbound  -> GitHub API
Runner inbound    -> NONE
```

Cloudflare does not replace webhook security: `/github/webhook` is public and
HMAC is mandatory. Admin endpoints (`/admin/jobs`, `/admin/runners`,
`/admin/installations`, `/admin/security-events`) sit behind Cloudflare Access
and are not on the same public trust surface as the webhook.

PostgreSQL, not SQLite — leases, transactions, `SKIP LOCKED`, audit durability,
future multi-runner. The queue is PostgreSQL; no Redis, NATS or Kafka is added
at this scale. Archives use encrypted local gateway storage first; S3-compatible
MinIO later if one-time URLs need it.

The GitHub App private key is gateway-only, mode `0600`, owned by a dedicated
service user, encrypted at rest, and eventually hardware- or Vault-backed.
Installation tokens are memory-cached, short-lived, never persisted, never
logged, never sent to a runner.

---

## 21. Repository configuration (§31)

```yaml
version: 1
route3:
  enabled: true
execution:
  tests: true
  build: true
  shell: false
  network: restricted
commands:
  review: { enabled: true }
  fix:    { enabled: true, require_permission: write }
  setup:  { require_permission: admin }
publication:
  mode: pull_request
security:
  block_secret_artifacts: true
  allow_workflow_edits: false
models:
  policy: automatic
```

Restricting only. See §7.

---

## 22. Testing (§80–82)

Layers: unit, contract, integration, security-negative, sandbox escape, archive
fuzz, webhook replay, authorization, cross-tenant, runner replay, lease expiry,
publisher idempotency, GitHub API mock, and a real private `route3-e2e-fixture`
repository.

Mandatory negative tests — a slice is not done until the ones in its scope pass:

```
invalid webhook signature        replayed delivery
unauthorized actor               disabled repository
cross-installation repository    expired job lease
runner spoofing                  signed replay
tar traversal                    symlink escape
archive bomb                     malicious AGENTS.md
secret exfiltration attempt      LAN access attempt
GitHub token lookup              publisher path traversal
workflow injection               duplicate publication
stale base SHA
```

---

## 23. Project structure (§56)

```
route3-skill/
  app/
    gateway/  { github, auth, commands, jobs, runners, source,
                artifacts, publisher, audit, telemetry }
    runner/   { client, identity, leases, source, sandbox,
                executor, broker, cleanup }
    control-center/
  core/       { router, orchestrator, capabilities, skills, agents,
                models, context, security, schemas }
  skills/     { repository, github, security, database, frontend,
                testing, research, notebook }
  packages/   { protocol, schemas, security, telemetry }
  tests/
```

## 24. Reuse of existing Route3 code (§57)

| Existing | Reused for | Re-review required |
|---|---|---|
| `control-center/security.js` | constant-time compare, central `redact()` | yes — new trust model |
| `control-center/process-manager.js` | `JobManager`, timeout, max output, process termination | yes — sandbox context |
| `control-center/job-history.js` | audit/event semantics | yes |
| `skill/scripts/capability-registry.js` | command capability enforcement, schema validation, bounded reads, path containment | yes |
| `skill/scripts/skill-security.js` | skill and artifact security scanning | yes |
| `skill/scripts/session-budget.js` | per-job and per-model budgets | yes |
| control center | runner operational UI | yes |

Every reused module is reviewed against the invariants in §1 before it is
trusted in the hosted path.

---

## 25. Delivery slices

| Slice | Delivers | Invariants landed |
|---|---|---|
| 1 | Gateway ingress, authorization, command registry, PostgreSQL job core, state machine, tracking-comment publisher, idempotency | I2, I5, I9 |
| 2 | Runner device identity, leases, source snapshots, safe extraction | I1, I3, I7, I8 |
| 3 | Sandbox, model broker, agent execution, artifact contract, evidence discipline, budgets (read-only commands) | I4, I5, I9 |
| 4 | Artifact security, security reviewer, stale-SHA guard, Git Data publisher, check runs, `fix` and `setup` | I2, I3, I6, I8 |
| 5+ | Skill graph, profiler cache, context engine, notebook research, external-skill lifecycle, metrics and SLO, control-center dashboard | — |

No slice ships a stubbed invariant.
