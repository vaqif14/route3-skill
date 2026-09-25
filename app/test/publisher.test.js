'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const { createCommentPublisher, MARKER, MARKER_PATTERN, withMarker } = require('../gateway/publisher/comment');
const { createJournal, keyFor } = require('../gateway/publisher/idempotency');
const { createMemoryStore } = require('../gateway/jobs/store.memory');
const { createAuditLog } = require('../gateway/audit/log');

const APP_ID = 424242;

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function fakeClient(existing = []) {
  const calls = [];
  let nextId = 100;
  return {
    calls,
    async createComment(installationId, fullName, number, body) {
      calls.push({ op: 'create', installationId, fullName, number, body });
      // Mirrors GitHub: a comment written through an installation token carries
      // the app that wrote it.
      const comment = { id: nextId++, body, performed_via_github_app: { id: APP_ID } };
      existing.push(comment);
      return comment;
    },
    async updateComment(installationId, fullName, commentId, body) {
      calls.push({ op: 'update', installationId, fullName, commentId, body });
      return { id: commentId, body };
    },
    async listComments(installationId, fullName, number) {
      calls.push({ op: 'list', installationId, fullName, number });
      return existing;
    },
  };
}

// A fake that behaves like a real server under concurrent load: listComments
// snapshots BEFORE its latency (so it can never observe a write that lands
// mid-flight), and createComment/updateComment apply their write AFTER their
// latency (so two in-flight calls can genuinely race). A fake that resolves in
// the same microtask tick, or that returns a live array reference after
// sleeping, gives a false pass — it can't reproduce the interleaving a real
// network round-trip allows.
function serverLikeClient(latency) {
  const calls = [];
  const stored = [];
  let nextId = 100;
  return {
    calls,
    stored,
    async listComments(installationId, fullName, number) {
      const snapshot = stored.slice();
      await sleep(latency);
      calls.push({ op: 'list', installationId, fullName, number });
      return snapshot;
    },
    async createComment(installationId, fullName, number, body) {
      await sleep(latency);
      const comment = { id: nextId++, body, performed_via_github_app: { id: APP_ID } };
      stored.push(comment);
      calls.push({ op: 'create', installationId, fullName, number, body });
      return comment;
    },
    async updateComment(installationId, fullName, commentId, body) {
      await sleep(latency);
      const existing = stored.find(comment => comment.id === commentId);
      if (existing) existing.body = body;
      calls.push({ op: 'update', installationId, fullName, commentId, body });
      return { id: commentId, body };
    },
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

function serverHarness(latency) {
  const store = createMemoryStore();
  const audit = createAuditLog(store);
  const client = serverLikeClient(latency);
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

test('create calls carry the correct installation, repository, and issue number', async () => {
  const { publisher, client } = harness();
  await publisher.publish(target(), 'body');
  const create = client.calls.find(call => call.op === 'create');
  assert.ok(create, 'expected a create call');
  assert.equal(create.installationId, 1001);
  assert.equal(create.fullName, 'vaqif14/route3-e2e-fixture');
  assert.equal(create.number, 42);
});

test('the marker is derived from the target job id, not hardcoded', async () => {
  const { publisher, client } = harness();
  const result = await publisher.publish(target({ jobId: 'R3-7' }), 'body');
  assert.equal(result.created, true);
  const create = client.calls.find(call => call.op === 'create');
  assert.ok(create.body.startsWith(MARKER('R3-7')));
});

test('a job with a known comment id is edited, never reposted', async () => {
  const { publisher, client } = harness();
  const result = await publisher.publish(target({ trackingCommentId: 100 }), 'updated body');
  assert.equal(result.created, false);
  assert.equal(result.commentId, 100);
  assert.deepEqual(client.calls.map(call => call.op), ['update']);
});

test('update calls carry the correct installation, repository, and comment id', async () => {
  const { publisher, client } = harness();
  await publisher.publish(target({ trackingCommentId: 100 }), 'body');
  const update = client.calls.find(call => call.op === 'update');
  assert.ok(update, 'expected an update call');
  assert.equal(update.installationId, 1001);
  assert.equal(update.fullName, 'vaqif14/route3-e2e-fixture');
  assert.equal(update.commentId, 100);
});

test('a second publish for a settled job edits the comment instead of posting a second one', async () => {
  const { publisher, client, store } = harness();
  const first = await publisher.publish(target(), 'first');
  assert.equal(first.created, true);
  const second = await publisher.publish(target(), 'second');
  assert.equal(client.calls.filter(call => call.op === 'create').length, 1);
  const updates = client.calls.filter(call => call.op === 'update');
  assert.equal(updates.length, 1);
  assert.equal(updates[0].body, withMarker('R3-1', 'second'));
  assert.equal(second.created, false);
  assert.equal(second.commentId, 100);
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
  const updates = client.calls.filter(call => call.op === 'update');
  assert.equal(updates.length, 1);
  assert.equal(updates[0].commentId, 555);
  assert.equal(updates[0].body, withMarker('R3-1', 'after restart'));
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

test('a marker that is not at the start of a body is not adopted', async () => {
  const existing = [{ id: 999, body: `see below\n${MARKER('R3-1')}\nx`, performed_via_github_app: { id: APP_ID } }];
  const { publisher, client, store } = harness(existing);
  await claimed(store);
  const result = await publisher.publish(target(), 'the real body');
  assert.equal(result.created, true);
  assert.notEqual(result.commentId, 999);
  assert.equal(client.calls.filter(call => call.op === 'create').length, 1);
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

test('two concurrent publishes for one job produce exactly one comment', async () => {
  const { publisher, client, store } = serverHarness(10);
  const [a, b] = await Promise.all([
    publisher.publish(target(), 'a'),
    publisher.publish(target(), 'b'),
  ]);
  assert.equal(client.calls.filter(call => call.op === 'create').length, 1);
  assert.equal(client.stored.length, 1);
  assert.equal((await store.listAudit({ jobId: 'R3-1' })).filter(e => e.type === 'COMMENT_POSTED').length, 1);
  assert.equal(a.commentId, b.commentId);
});

test('three concurrent publishes for one job produce exactly one comment', async () => {
  const { publisher, client, store } = serverHarness(10);
  const [a, b, c] = await Promise.all([
    publisher.publish(target(), 'a'),
    publisher.publish(target(), 'b'),
    publisher.publish(target(), 'c'),
  ]);
  assert.equal(client.calls.filter(call => call.op === 'create').length, 1);
  assert.equal(client.stored.length, 1);
  assert.equal((await store.listAudit({ jobId: 'R3-1' })).filter(e => e.type === 'COMMENT_POSTED').length, 1);
  assert.equal(a.commentId, b.commentId);
  assert.equal(b.commentId, c.commentId);
});

test('a hostile job id is refused', async () => {
  const { publisher } = harness();
  await assert.rejects(
    () => publisher.publish(target({ jobId: 'R3-1 --><!-- route3-job:R3-2' }), 'x'),
    /job id/i);
  assert.throws(() => withMarker('R3-1 -->evil', 'x'));
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

test('MARKER_PATTERN matches what withMarker produces and captures the job id', () => {
  assert.equal(MARKER_PATTERN.exec(withMarker('R3-12', 'body'))[1], 'R3-12');
});

test('the transitive require closure of comment.js is exactly {comment.js, idempotency.js}, and neither can call a model', () => {
  const entry = require.resolve('../gateway/publisher/comment.js');
  const seen = new Set();
  const stack = [entry];
  while (stack.length) {
    const filename = stack.pop();
    if (seen.has(filename)) continue;
    seen.add(filename);
    const mod = require.cache[filename];
    if (!mod) continue;
    for (const child of mod.children) stack.push(child.filename);
  }
  const basenames = [...seen].map(filename => path.basename(filename)).sort();
  assert.deepEqual(basenames, ['comment.js', 'idempotency.js']);
  for (const filename of seen) {
    const source = fs.readFileSync(filename, 'utf8');
    assert.doesNotMatch(source, /anthropic|openai|child_process|node:https?|node:net|\bfetch\(/i);
  }
});
