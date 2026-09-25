'use strict';

const { createJournal, keyFor } = require('./idempotency');

const JOB_ID = /^R3-[1-9][0-9]*$/;

// The marker identifies this gateway's own comment to adopt(), so it is a
// security boundary. An unvalidated job id could close its own marker and open
// a second one for a different job, making one comment adoptable by two jobs.
function assertJobId(jobId) {
  if (typeof jobId !== 'string' || !JOB_ID.test(jobId)) throw new Error('Job id is not a valid Route3 job id');
  return jobId;
}

const MARKER = jobId => `<!-- route3-job:${assertJobId(jobId)} -->`;
const MARKER_PATTERN = /^<!-- route3-job:(R3-[1-9][0-9]*) -->/;

function withMarker(jobId, body) { return `${MARKER(jobId)}\n${body}`; }

// Deterministic by construction. It receives finished text and performs GitHub
// writes. It never reasons, and never invokes a model (invariant I6).
function createCommentPublisher({ store, client, audit, appId }) {
  // The app id authenticates adoption. Without it a forged marker would be
  // adoptable, so a missing or unusable id is a construction-time failure
  // rather than a silently weaker check at request time.
  const ownAppId = Number(appId);
  if (!Number.isInteger(ownAppId) || ownAppId <= 0) {
    throw new Error('createCommentPublisher requires a positive integer GitHub app id');
  }

  const journal = createJournal(store);
  // One publish at a time per job. Two concurrent publishes both saw the claim
  // as pending, neither adopt() could see the other's in-flight create, and
  // both created: N callers produced N comments with N-1 orphaned forever.
  // They are SERIALISED rather than sharing one promise the way auth.js shares
  // a token mint: every token caller wants the same token, but every publish
  // caller carries its own body, and handing the second caller the first
  // caller's promise would silently drop the second body.
  const inflight = new Map();

  // GitHub stamps performed_via_github_app on comments written through an
  // installation token. Anyone who can comment on the surface can write the
  // marker; only this app can produce this stamp.
  function writtenByThisApp(comment) {
    const app = comment && comment.performed_via_github_app;
    return Boolean(app) && Number(app.id) === ownAppId;
  }

  async function adopt(target) {
    const comments = await client.listComments(target.installationId, target.repositoryFullName, target.surfaceNumber);
    const marker = MARKER(target.jobId);
    // startsWith, not includes: every comment this gateway writes begins with
    // its marker, so anchoring refuses a marker that merely appears somewhere
    // in a body — inside a fenced code block, or after another job's marker.
    const found = (comments || []).find(comment =>
      typeof comment.body === 'string'
      && comment.body.startsWith(marker)
      && writtenByThisApp(comment));
    return found ? found.id : null;
  }

  async function update(target, commentId, text) {
    await client.updateComment(target.installationId, target.repositoryFullName, commentId, text);
    await audit.append({
      type: 'COMMENT_UPDATED', actor: 'publisher',
      installationId: target.installationId, jobId: target.jobId,
      metadata: { commentId },
    });
    return { commentId, created: false };
  }

  async function perform(target, body) {
    const text = withMarker(target.jobId, body);
    if (target.trackingCommentId) return update(target, target.trackingCommentId, text);

    const claim = await journal.begin(target.jobId, 'comment');
    // A comment id from any source means this write is an edit. Returning the
    // id here without writing would report success for a body never published.
    const recorded = claim.result && claim.result.commentId;
    if (recorded) return update(target, recorded, text);

    // 'pending' means an earlier attempt claimed this operation and never
    // finished it. Recover the comment it already wrote, then write this body
    // to it — recovering the id alone would strand the comment at whatever it
    // said when the earlier attempt died.
    if (claim.status !== 'claimed') {
      const existing = await adopt(target);
      if (existing !== null) {
        await audit.append({
          type: 'COMMENT_ADOPTED', actor: 'publisher',
          installationId: target.installationId, jobId: target.jobId,
          metadata: { commentId: existing },
        });
        await journal.finish(claim.key, { commentId: existing });
        return update(target, existing, text);
      }
    }

    const created = await client.createComment(
      target.installationId, target.repositoryFullName, target.surfaceNumber, text);
    // Audited BEFORE the journal is finished. Finishing first means a failed
    // append is permanent: the comment exists and the journal is correct, so
    // every retry short-circuits and the event is never recorded at all.
    await audit.append({
      type: 'COMMENT_POSTED', actor: 'publisher',
      installationId: target.installationId, jobId: target.jobId,
      metadata: { commentId: created.id },
    });
    await journal.finish(claim.key, { commentId: created.id });
    return { commentId: created.id, created: true };
  }

  // async so an invalid job id rejects rather than throwing synchronously:
  // assert.rejects does not validate a synchronous throw.
  async function publish(target, body) {
    const key = keyFor(assertJobId(target && target.jobId), 'comment');
    const previous = inflight.get(key);
    const run = previous
      ? previous.then(() => perform(target, body), () => perform(target, body))
      : perform(target, body);
    const settled = run.then(() => {}, () => {});
    inflight.set(key, settled);
    settled.then(() => { if (inflight.get(key) === settled) inflight.delete(key); });
    return run;
  }

  return { publish, adopt };
}

module.exports = { createCommentPublisher, MARKER, MARKER_PATTERN, withMarker };
