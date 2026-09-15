# Route3 GitHub App — Slice 1: Gateway ingress and durable job core

Date: 2026-09-15
Status: design, awaiting review
Reference architecture: `docs/github-app/ARCHITECTURE.md` (frozen)
Baseline: `12024c8` (route3-skill 2.1.0)

---

## 1. Goal

Make the GitHub-native surface real and safe before any agent exists.

After this slice, commenting `/route3 help` on a pull request in an allowlisted
repository produces exactly one Route3 tracking comment, a replayed webhook
delivery produces none, an unauthorized actor is rejected with an explanation,
and every one of those outcomes is recorded in an append-only audit log backed
by PostgreSQL that survives a gateway restart.

No agent. No LLM. No runner. No repository content is fetched or executed.

The value is that the security spine becomes testable while it is still
deterministic. Every nondeterministic component added later sits on top of a
foundation whose negative tests already pass.

---

## 2. In scope

- `app/` npm workspace bootstrap, PostgreSQL the only runtime dependency
- Gateway HTTP server on `node:http`, fronted by Cloudflare Tunnel
- `POST /github/webhook` implementing the normative 16-step order (ARCH §5)
- GitHub App authentication: private key -> RS256 JWT -> installation access
  token, memory-cached with expiry, never persisted, never logged
- PostgreSQL schema and forward-only migrations for the slice-1 entities
- Command grammar, canonical AST, and the capability registry
- Four-layer authorization plus the private-beta installation allowlist
- Job state machine with the terminal-state invariant enforced in the store
- Gateway-local handlers for `help` and `status` — commands that read only
  gateway state, touch no repository content, and therefore need no runner
- Deterministic publisher: one tracking comment per job, hidden marker, edited
  in place, idempotency keys, `GitHubOperation` journal
- Structured logging through the existing `redact()`
- The slice-1 negative test set (§9)

## 3. Out of scope

Deferred to later slices, and — this is the important part — **surfaced
honestly rather than stubbed**. `review`, `explain`, `plan`, `fix`,
`architecture`, `setup`, `skill audit`, `create skill` are registered in the
capability registry from day one. Invoking one creates a real job, authorizes
it correctly, and terminates it as `RUNNER_UNAVAILABLE` with a comment saying
execution is not yet available. It does not pretend to work.

Also out of scope: runner protocol, device identity, leases, source snapshots,
archive extraction, sandbox, broker, artifacts, Git Data publication, check
runs, metrics endpoint, admin API.

---

## 4. Components

```
app/
  package.json                    deps: pg
  gateway/
    server.js                     node:http bootstrap, routing, shutdown
    github/
      webhook.js                  raw-body read, HMAC verify, dedupe
      events.js                   event schema validation, normalization
      auth.js                     JWT + installation token cache
      client.js                   injectable fetch wrapper, rate-budget aware
    commands/
      grammar.js                  text -> canonical AST
      registry.js                 command -> capability + policy
      local/                      gateway-local handlers: help, status
    auth/
      authorize.js                installation -> repository -> actor -> command
      policy.js                   most_restrictive() resolution
    jobs/
      state.js                    state machine, legal transitions
      store.js                    store interface + PostgreSQL implementation
      queue.js                    create, transition, terminal guard
    publisher/
      comment.js                  tracking comment create/update by marker
      idempotency.js              route3:{jobId}:{operation}
    audit/
      log.js                      append-only events, redacted on write
    db/
      migrations/                 forward-only SQL
      pool.js
```

### Boundaries

Each module answers three questions without the caller reading its internals:

- `webhook.js` — given raw bytes and headers, is this a trustworthy,
  not-yet-seen GitHub delivery? Depends on `node:crypto` and the store.
- `grammar.js` — given comment text, what is the canonical AST or why not?
  Depends on nothing. Pure, exhaustively testable.
- `authorize.js` — given installation, repository, actor and AST, may this
  proceed? Depends on the store and `policy.js`.
- `state.js` — is this transition legal? Pure function over the state graph.
- `publisher/comment.js` — given a job and a body, ensure exactly one comment
  exists and matches. Depends on `client.js` and the idempotency journal.

`store.js` exposes an interface, not SQL, so unit tests run against an
in-memory fake and integration tests against real PostgreSQL.

---

## 5. Data model

Slice-1 tables. Every table carries `installation_id` (ARCH §17).

```sql
CREATE TABLE github_installation (
  id                BIGINT PRIMARY KEY,           -- GitHub installation id
  account_login     TEXT        NOT NULL,
  account_type      TEXT        NOT NULL,
  enabled           BOOLEAN     NOT NULL DEFAULT FALSE,   -- private-beta gate
  suspended_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE repository (
  id                BIGINT PRIMARY KEY,           -- GitHub repository id
  installation_id   BIGINT      NOT NULL REFERENCES github_installation(id),
  full_name         TEXT        NOT NULL,
  default_branch    TEXT        NOT NULL,
  private           BOOLEAN     NOT NULL,
  enabled           BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON repository (installation_id);

CREATE TABLE webhook_delivery (
  provider          TEXT        NOT NULL DEFAULT 'github',
  delivery_id       TEXT        NOT NULL,
  event             TEXT        NOT NULL,
  installation_id   BIGINT,
  received_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  outcome           TEXT        NOT NULL,   -- accepted | duplicate | rejected
  reject_reason     TEXT,
  PRIMARY KEY (provider, delivery_id)
);

CREATE TABLE command_request (
  id                TEXT        PRIMARY KEY,
  installation_id   BIGINT      NOT NULL REFERENCES github_installation(id),
  repository_id     BIGINT      NOT NULL REFERENCES repository(id),
  delivery_id       TEXT        NOT NULL,
  actor_login       TEXT        NOT NULL,
  actor_id          BIGINT      NOT NULL,
  actor_permission  TEXT        NOT NULL,
  surface           TEXT        NOT NULL,   -- issue | pull_request
  surface_number    INTEGER     NOT NULL,
  raw_text          TEXT        NOT NULL,
  ast               JSONB       NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE route3_job (
  id                TEXT        PRIMARY KEY,   -- R3-<n>
  installation_id   BIGINT      NOT NULL REFERENCES github_installation(id),
  repository_id     BIGINT      NOT NULL REFERENCES repository(id),
  command_request_id TEXT       NOT NULL REFERENCES command_request(id),
  command           TEXT        NOT NULL,
  capability        TEXT        NOT NULL,
  scope             TEXT,                 -- AST scope, e.g. 'security'
  base_ref          TEXT,
  base_sha          TEXT,
  head_ref          TEXT,
  head_sha          TEXT,
  priority          INTEGER     NOT NULL DEFAULT 100,
  risk_level        TEXT        NOT NULL DEFAULT 'LOW',
  status            TEXT        NOT NULL,
  terminal          BOOLEAN     NOT NULL DEFAULT FALSE,
  tracking_comment_id BIGINT,
  requested_by_github_user_id BIGINT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ
);
CREATE INDEX ON route3_job (installation_id, repository_id, created_at DESC);
CREATE INDEX ON route3_job (status) WHERE terminal = FALSE;

-- Abuse control (ARCH §18): identical in-flight commands coalesce.
CREATE UNIQUE INDEX route3_job_coalesce
  ON route3_job (repository_id, command, COALESCE(head_sha, ''),
                 COALESCE(scope, ''))
  WHERE terminal = FALSE;

CREATE TABLE job_attempt (
  id                TEXT        PRIMARY KEY,
  installation_id   BIGINT      NOT NULL REFERENCES github_installation(id),
  job_id            TEXT        NOT NULL REFERENCES route3_job(id),
  number            INTEGER     NOT NULL,
  status            TEXT        NOT NULL,
  failure_code      TEXT,
  failure_message   TEXT,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at      TIMESTAMPTZ,
  UNIQUE (job_id, number)
);

CREATE TABLE github_operation (
  idempotency_key   TEXT        PRIMARY KEY,   -- route3:{jobId}:{operation}
  installation_id   BIGINT      NOT NULL REFERENCES github_installation(id),
  job_id            TEXT        NOT NULL REFERENCES route3_job(id),
  operation         TEXT        NOT NULL,
  status            TEXT        NOT NULL,      -- pending | succeeded | failed
  result            JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at      TIMESTAMPTZ
);

CREATE TABLE audit_event (
  id                BIGSERIAL   PRIMARY KEY,
  event_id          TEXT        NOT NULL UNIQUE,
  installation_id   BIGINT,
  job_id            TEXT,
  type              TEXT        NOT NULL,
  actor             TEXT        NOT NULL,
  metadata          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  occurred_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON audit_event (job_id, occurred_at);
```

`audit_event` has no `UPDATE` or `DELETE` path in the store interface. The
append-only property is enforced by the code surface, and by a database role
that is granted only `INSERT` and `SELECT` on that table.

---

## 6. Control flow

### 6.1 Ingress

The 16 steps of ARCH §5, implemented in that order, in one function, with no
early JSON parse. Body is read into a bounded buffer (1 MB; GitHub payloads are
well under this) before any interpretation. HMAC uses
`crypto.timingSafeEqual` via the existing `equalToken` helper pattern.

Failure modes and responses:

| Condition | HTTP | Recorded |
|---|---|---|
| missing or malformed signature header | 401 | `webhook_delivery.outcome='rejected'` |
| signature mismatch | 401 | rejected, `route3_webhook_invalid_signature` counter |
| duplicate delivery id | 202 | `outcome='duplicate'`, no job |
| unparseable JSON after valid signature | 400 | rejected |
| event not subscribed | 204 | accepted, no job |
| comment contains no `/route3` command | 204 | accepted, no job |

GitHub is acknowledged before job processing begins. Acknowledgement target is
p95 < 500 ms (ARCH §18).

### 6.2 Command parsing

`grammar.js` is a pure function. It accepts a comment body, finds a line whose
first token is `/route3`, and produces either an AST or a typed parse error. It
never builds a shell string, never evaluates, and never accepts a command
absent from the registry. Unknown command -> help output, not an error comment.

### 6.3 Authorization

Four layers, evaluated in order, each failure producing a distinct audit event
and a distinct user-facing explanation:

1. installation exists, `enabled = true`, not suspended
2. repository exists, belongs to that installation, `enabled = true`
3. actor permission resolved from GitHub, compared to the command minimum
4. command enabled, and `most_restrictive(global, installation, repository)`
   satisfied

Cross-installation access — a delivery naming a repository owned by a different
installation — is rejected at layer 2 and audited as a security event.

### 6.4 Job creation and state

`state.js` holds the transition graph as data. `queue.js` is the only writer,
and every transition is a single statement guarded by the current status and by
`terminal = FALSE`. A transition out of a terminal state affects zero rows and
raises; it cannot succeed under concurrency.

Slice-1 paths:

```
RECEIVED -> AUTHENTICATED -> AUTHORIZED -> NORMALIZED -> QUEUED
  -> (local handler)  EXECUTING -> READY_TO_PUBLISH -> PUBLISHING -> SUCCEEDED
  -> (no runner)      RUNNER_UNAVAILABLE                          -> FAILED
```

### 6.5 Publication

`publisher/comment.js` is deterministic and never calls a model (I6). It writes
one comment carrying `<!-- route3-job:R3-123 -->`, records the comment id on the
job, and edits that comment for every later update. Every GitHub write claims
its `github_operation` row first; a claimed-but-incomplete key on restart is
resolved by reading back the comment rather than posting a second one.

---

## 7. Configuration

```
ROUTE3_DATABASE_URL
ROUTE3_GITHUB_APP_ID
ROUTE3_GITHUB_PRIVATE_KEY_PATH      mode 0600, gateway-only
ROUTE3_GITHUB_WEBHOOK_SECRET
ROUTE3_INSTALLATION_ALLOWLIST       comma-separated ids; empty = none enabled
ROUTE3_LISTEN_PORT
ROUTE3_LOG_LEVEL
```

No secret is read from a repository, a webhook payload, or a comment.

---

## 8. Error handling

Three classes, handled differently:

- **Rejected input** (bad signature, unknown event, unauthorized actor) — not an
  error. Recorded, answered with the correct status code, and where an actor is
  identifiable and authorized to see it, explained in a comment.
- **Transient failure** (GitHub 5xx, rate limit, database unavailable) — bounded
  retry with backoff, then the job terminates with a named failure code. Never
  an infinite retry, never a silent drop.
- **Programming error** (illegal transition, schema violation) — throws, is
  logged with full context through `redact()`, and terminates the job as
  `FAILED`. It does not degrade into a plausible-looking success.

No `catch` block swallows an exception. Every caught exception is either
converted to a typed failure or rethrown.

---

## 9. Testing

`node --test`, matching the existing harness. Store-level tests run against the
in-memory fake by default; integration tests run against real PostgreSQL when
`ROUTE3_TEST_DATABASE_URL` is set, and are skipped — visibly, not silently —
when it is not. GitHub is a fake `fetch` recording calls.

**Positive**

1. `/route3 help` on a PR creates one tracking comment carrying the marker.
2. A second `/route3 help` on the same PR edits that comment; no second comment.
3. `/route3 status` reports installation state, repository state, and recent job
   history from the database.
4. `/route3 review` creates a job, authorizes it, and terminates it as
   `RUNNER_UNAVAILABLE` with a comment that says execution is not yet available.
5. Gateway restart preserves queued jobs, job history, and delivery dedupe.

**Negative — required for this slice to be done**

| Test | Expected |
|---|---|
| invalid webhook signature | 401, body never parsed, no job, audited |
| replayed delivery id | 202 duplicate, no second job, no second comment |
| unauthorized actor (read-only on a write command) | rejected, explained, audited |
| disabled repository | rejected, audited |
| non-allowlisted installation | `POLICY_REJECTED`, explained, audited |
| cross-installation repository id | rejected at layer 2, security event |
| duplicate publication (same idempotency key twice) | one comment |
| illegal transition out of a terminal state | raises, zero rows affected |
| command text containing shell metacharacters | parsed as data or refused; never executed |
| concurrent identical commands | coalesced to one job by the partial unique index |

A `console.log` of environment, headers, or any token fails review.

---

## 10. Acceptance

Slice 1 is done when, against a real private repository with the App installed:

1. All positive and negative tests above pass under `npm test`.
2. `/route3 help` and `/route3 status` work end to end on a real PR.
3. `/route3 review` fails honestly rather than pretending.
4. A gateway restart mid-queue loses nothing.
5. `npm test` at the repository root still passes — the existing 64 tests plus
   the new ones — and the published `route3-skill` tarball still has zero
   runtime dependencies.

---

## 11. Known limitations at the end of slice 1

Stated here so they are never mistaken for defects or for completeness:

- No repository content is read. Every command that needs it fails honestly.
- No runner exists; `RUNNER_UNAVAILABLE` is the correct terminal state.
- Single gateway process. Durable state survives restart; there is no failover.
- Admin API, metrics endpoint and check runs arrive in later slices.
- Rate limiting is per-installation and per-actor only; per-IP limiting belongs
  to the Cloudflare layer and is configured, not coded, in this slice.
