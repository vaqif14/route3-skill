'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createMemoryStore } = require('../gateway/jobs/store.memory');
const { assertStore, StoreContractError } = require('../gateway/jobs/store');
const { createAuditLog } = require('../gateway/audit/log');

function jobRow(overrides = {}) {
  return {
    id: 'R3-1', installationId: 1, repositoryId: 10, commandRequestId: 'cr-1',
    command: 'review', capability: 'REVIEW', scope: null, headSha: 'abc', baseSha: 'def',
    status: 'RECEIVED', terminal: false, requestedByGithubUserId: 7,
    createdAt: '2026-09-15T10:00:00.000Z', ...overrides,
  };
}

test('the memory store satisfies the contract', () => {
  assert.doesNotThrow(() => assertStore(createMemoryStore()));
  assert.throws(() => assertStore({}), StoreContractError);
});

test('a delivery is recorded once', async () => {
  const store = createMemoryStore();
  assert.deepEqual(await store.recordDelivery({ deliveryId: 'd1', event: 'issue_comment', outcome: 'accepted' }), { inserted: true });
  assert.deepEqual(await store.recordDelivery({ deliveryId: 'd1', event: 'issue_comment', outcome: 'accepted' }), { inserted: false });
});

test('identical in-flight commands coalesce', async () => {
  const store = createMemoryStore();
  const first = await store.createJob(jobRow());
  assert.equal(first.coalescedWith, null);
  const second = await store.createJob(jobRow({ id: 'R3-2' }));
  assert.equal(second.coalescedWith, 'R3-1');
});

test('a different command on the same SHA does not coalesce', async () => {
  const store = createMemoryStore();
  await store.createJob(jobRow());
  const other = await store.createJob(jobRow({ id: 'R3-2', command: 'explain', capability: 'EXPLAIN' }));
  assert.equal(other.coalescedWith, null);
});

test('a terminal job no longer blocks a new one', async () => {
  const store = createMemoryStore();
  await store.createJob(jobRow());
  await store.transitionJob('R3-1', 'RECEIVED', { status: 'REJECTED', terminal: true });
  const next = await store.createJob(jobRow({ id: 'R3-2' }));
  assert.equal(next.coalescedWith, null);
});

test('a transition whose precondition fails changes nothing', async () => {
  const store = createMemoryStore();
  await store.createJob(jobRow());
  assert.equal(await store.transitionJob('R3-1', 'QUEUED', { status: 'EXECUTING' }), null);
  assert.equal((await store.getJob('R3-1')).status, 'RECEIVED');
});

test('an operation is claimed exactly once', async () => {
  const store = createMemoryStore();
  const first = await store.claimOperation({ idempotencyKey: 'route3:R3-1:comment', jobId: 'R3-1', operation: 'comment' });
  assert.equal(first.claimed, true);
  const second = await store.claimOperation({ idempotencyKey: 'route3:R3-1:comment', jobId: 'R3-1', operation: 'comment' });
  assert.equal(second.claimed, false);
  assert.equal(second.record.status, 'pending');
  await store.completeOperation('route3:R3-1:comment', { commentId: 99 });
  const third = await store.claimOperation({ idempotencyKey: 'route3:R3-1:comment', jobId: 'R3-1', operation: 'comment' });
  assert.equal(third.record.status, 'succeeded');
  assert.equal(third.record.result.commentId, 99);
});

test('audit events are typed and carry an actor', async () => {
  const audit = createAuditLog(createMemoryStore());
  await assert.rejects(() => audit.append({ type: 'NOT_A_TYPE', actor: 'gateway' }), /Unknown audit event type/);
  await assert.rejects(() => audit.append({ type: 'JOB_CREATED' }), /require an actor/);
});

test('audit metadata is redacted by key and by value', async () => {
  const store = createMemoryStore();
  const audit = createAuditLog(store);
  await audit.append({
    type: 'JOB_CREATED', actor: 'gateway', jobId: 'R3-1',
    metadata: { token: 'ghs_abcdefghijklmnopqrst', note: 'authorization: Bearer ghs_abcdefghijklmnopqrst', count: 3 },
  });
  const [event] = await store.listAudit({ jobId: 'R3-1' });
  assert.equal(event.metadata.token, '[REDACTED]');
  assert.doesNotMatch(event.metadata.note, /ghs_abcdefghijklmnopqrst/);
  assert.equal(event.metadata.count, 3);
  assert.match(event.eventId, /^[0-9a-f-]{36}$/);
});

test('the audit log exposes no update or delete', () => {
  const store = createMemoryStore();
  assert.equal(store.updateAudit, undefined);
  assert.equal(store.deleteAudit, undefined);
});
