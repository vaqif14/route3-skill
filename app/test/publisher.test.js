'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createCommentPublisher, MARKER, withMarker } = require('../gateway/publisher/comment');
const { createJournal, keyFor } = require('../gateway/publisher/idempotency');
const { createMemoryStore } = require('../gateway/jobs/store.memory');
const { createAuditLog } = require('../gateway/audit/log');

const APP_ID = 424242;

function fakeClient(existing = []) {
  const calls = [];
  let nextId = 100;
  return {
    calls,
    async createComment(installationId, fullName, number, body) {
      calls.push({ op: 'create', number, body });
      // Mirrors GitHub: a comment written through an installation token carries
      // the app that wrote it.
      const comment = { id: nextId++, body, performed_via_github_app: { id: APP_ID } };
      existing.push(comment);
      return comment;
    },
    async updateComment(installationId, fullName, commentId, body) {
      calls.push({ op: 'update', commentId, body });
      return { id: commentId, body };
    },
    async listComments() { calls.push({ op: 'list' }); return existing; },
  };
}

const target = (overrides = {}) => ({
  jobId: 'R3-1', installationId: 1001, repositoryFullName: 'vaqif14/route3-e2e-fixture',
  surfaceNumber: 42, trackingCommentId: null, ...overrides,
});

function harness(existing) {
  const store = createMemoryStore();
  const audit = createAuditLog(store);
  const client = fakeClient(existing);
  return { store, audit, client, publisher: createCommentPublisher({ store, client, audit, appId: APP_ID }) };
}

// A pending claim is the only state in which adopt() runs, so every adoption
// test has to put the journal there first.
async function claimed(store, jobId = 'R3-1') {
  return store.claimOperation({ idempotencyKey: keyFor(jobId, 'comment'), jobId, operation: 'comment' });
}

test('the idempotency key has the exact documented shape', () => {
  assert.equal(keyFor('R3-1', 'comment'), 'route3:R3-1:comment');
});

test('a first publish creates one comment carrying the marker', async () => {
  const { publisher, client } = harness();
  const result = await publisher.publish(target(), 'Route3 Analysis\nStatus: queued');
  assert.equal(result.created, true);
  assert.equal(client.calls.filter(call => call.op === 'create').length, 1);
  assert.ok(client.calls[0].body.startsWith(MARKER('R3-1')));
});

test('a job with a known comment id is edited, never reposted', async () => {
  const { publisher, client } = harness();
  const result = await publisher.publish(target({ trackingCommentId: 100 }), 'updated body');
  assert.equal(result.created, false);
  assert.equal(result.commentId, 100);
  assert.deepEqual(client.calls.map(call => call.op), ['update']);
});

test('a completed operation short-circuits with no GitHub call at all', async () => {
  const { publisher, client, store } = harness();
  await publisher.publish(target(), 'first');
  client.calls.length = 0;
  const again = await publisher.publish(target(), 'second');
  assert.equal(again.created, false);
  assert.equal(again.commentId, 100);
  assert.equal(client.calls.length, 0);
  assert.equal((await store.listAudit({ jobId: 'R3-1' })).filter(e => e.type === 'COMMENT_POSTED').length, 1);
});

test('a crashed attempt adopts the comment it already posted instead of duplicating', async () => {
  const existing = [{ id: 555, body: `${MARKER('R3-1')}\nposted before the crash`, performed_via_github_app: { id: APP_ID } }];
  const { publisher, client, store } = harness(existing);
  await claimed(store);

  const result = await publisher.publish(target(), 'after restart');
  assert.equal(result.commentId, 555);
  assert.equal(result.created, false);
  assert.equal(client.calls.filter(call => call.op === 'create').length, 0);
  assert.equal((await store.listAudit({ jobId: 'R3-1' })).filter(e => e.type === 'COMMENT_ADOPTED').length, 1);
});

test('a claimed-but-unposted operation posts exactly once on retry', async () => {
  const { publisher, client, store } = harness([]);
  await claimed(store);
  const result = await publisher.publish(target(), 'after restart');
  assert.equal(result.created, true);
  assert.equal(client.calls.filter(call => call.op === 'create').length, 1);
});

test('another job marker is never adopted', async () => {
  const existing = [{ id: 777, body: `${MARKER('R3-99')}\nsomeone else's job`, performed_via_github_app: { id: APP_ID } }];
  const { publisher, client, store } = harness(existing);
  await claimed(store);
  const result = await publisher.publish(target(), 'mine');
  assert.equal(result.created, true);
  assert.notEqual(result.commentId, 777);
});

test('a marker-carrying comment written by a human is never adopted', async () => {
  const existing = [{ id: 666, body: `${MARKER('R3-1')}\nStatus: SUCCEEDED, 0 findings`, performed_via_github_app: null }];
  const { publisher, client, store } = harness(existing);
  await claimed(store);
  const result = await publisher.publish(target(), 'the real body');
  assert.equal(result.created, true);
  assert.notEqual(result.commentId, 666);
  assert.equal(client.calls.filter(call => call.op === 'create').length, 1);
});

test('a marker-carrying comment written by a different app is never adopted', async () => {
  const existing = [{ id: 667, body: `${MARKER('R3-1')}\nnot ours`, performed_via_github_app: { id: 999999 } }];
  const { publisher, store } = harness(existing);
  await claimed(store);
  const result = await publisher.publish(target(), 'the real body');
  assert.equal(result.created, true);
  assert.notEqual(result.commentId, 667);
});

test('a succeeded record with no recorded comment id heals by adopting, not by duplicating', async () => {
  const existing = [{ id: 888, body: `${MARKER('R3-1')}\nposted`, performed_via_github_app: { id: APP_ID } }];
  const { publisher, client, store } = harness(existing);
  await claimed(store);
  await store.completeOperation(keyFor('R3-1', 'comment'), null);
  const result = await publisher.publish(target(), 'after restart');
  assert.equal(result.commentId, 888);
  assert.equal(result.created, false);
  assert.equal(client.calls.filter(call => call.op === 'create').length, 0);
});

test('the publisher refuses to construct without a usable app id', () => {
  const store = createMemoryStore();
  const audit = createAuditLog(store);
  const client = fakeClient();
  for (const appId of [undefined, null, '', 0, -1, 'not-a-number']) {
    assert.throws(() => createCommentPublisher({ store, client, audit, appId }), /app id/i, `appId ${JSON.stringify(appId)} must be refused`);
  }
  assert.doesNotThrow(() => createCommentPublisher({ store, client, audit, appId: '424242' }));
});

test('withMarker puts the marker on its own first line', () => {
  assert.equal(withMarker('R3-7', 'body'), '<!-- route3-job:R3-7 -->\nbody');
});

test('the publisher module imports nothing that could call a model', () => {
  const source = require('node:fs').readFileSync(require.resolve('../gateway/publisher/comment.js'), 'utf8');
  assert.doesNotMatch(source, /anthropic|openai|fetch\(|child_process/i);
});
