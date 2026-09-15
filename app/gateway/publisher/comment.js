'use strict';

const { createJournal } = require('./idempotency');

const MARKER = jobId => `<!-- route3-job:${jobId} -->`;
const MARKER_PATTERN = /<!-- route3-job:(R3-\d+) -->/;

function withMarker(jobId, body) { return `${MARKER(jobId)}\n${body}`; }

// Deterministic by construction. It receives validated text and performs GitHub
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

  // GitHub stamps performed_via_github_app on comments written through an
  // installation token. Anyone who can comment on the surface can write the
  // marker; only this app can produce this stamp.
  function writtenByThisApp(comment) {
    const app = comment && comment.performed_via_github_app;
    return Boolean(app) && Number(app.id) === ownAppId;
  }

  async function adopt(target) {
    const comments = await client.listComments(target.installationId, target.repositoryFullName, target.surfaceNumber);
    const found = (comments || []).find(comment =>
      typeof comment.body === 'string'
      && comment.body.includes(MARKER(target.jobId))
      && writtenByThisApp(comment));
    return found ? found.id : null;
  }

  async function publish(target, body) {
    if (target.trackingCommentId) {
      await client.updateComment(target.installationId, target.repositoryFullName, target.trackingCommentId, withMarker(target.jobId, body));
      await audit.append({
        type: 'COMMENT_UPDATED', actor: 'publisher',
        installationId: target.installationId, jobId: target.jobId,
        metadata: { commentId: target.trackingCommentId },
      });
      return { commentId: target.trackingCommentId, created: false };
    }

    const claim = await journal.begin(target.jobId, 'comment');
    const recorded = claim.result && claim.result.commentId;
    if (claim.status === 'succeeded' && recorded) {
      return { commentId: recorded, created: false };
    }
    // 'pending' means an earlier attempt claimed this operation and never
    // finished it. 'succeeded' with no recorded id means the journal lost the
    // result. Both are repaired the same way: look for the comment this app
    // already wrote before writing a second one.
    if (claim.status !== 'claimed') {
      const existing = await adopt(target);
      if (existing !== null) {
        await journal.finish(claim.key, { commentId: existing });
        await audit.append({
          type: 'COMMENT_ADOPTED', actor: 'publisher',
          installationId: target.installationId, jobId: target.jobId,
          metadata: { commentId: existing },
        });
        return { commentId: existing, created: false };
      }
    }

    const created = await client.createComment(
      target.installationId, target.repositoryFullName, target.surfaceNumber, withMarker(target.jobId, body));
    await journal.finish(claim.key, { commentId: created.id });
    await audit.append({
      type: 'COMMENT_POSTED', actor: 'publisher',
      installationId: target.installationId, jobId: target.jobId,
      metadata: { commentId: created.id },
    });
    return { commentId: created.id, created: true };
  }

  return { publish, adopt };
}

module.exports = { createCommentPublisher, MARKER, MARKER_PATTERN, withMarker };
