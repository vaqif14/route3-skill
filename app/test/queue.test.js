'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createQueue } = require('../gateway/jobs/queue');
const { createMemoryStore } = require('../gateway/jobs/store.memory');
const { createAuditLog } = require('../gateway/audit/log');
const { IllegalTransition } = require('../gateway/jobs/state');
const { lookup } = require('../gateway/commands/registry');
const { parseCommand } = require('../gateway/commands/grammar');

function harness() {
  const store = createMemoryStore();
  const audit = createAuditLog(store);
  return { store, audit, queue: createQueue({ store, audit }) };
}

const request = (command = '/route3 review') => ({
  installationId: 1001, repositoryId: 5001, commandRequestId: 'cr-1',
  descriptor: lookup(parseCommand(command).ast.command, parseCommand(command).ast.subcommand),
  ast: parseCommand(command).ast, actorId: 9001, headSha: 'abc123',
});

test('job ids are sequential and formatted R3-n', async () => {
  const { queue } = harness();
  assert.equal((await queue.create(request())).job.id, 'R3-1');
  assert.equal((await queue.create(request('/route3 explain'))).job.id, 'R3-2');
});

test('a new job starts at RECEIVED and is not terminal', async () => {
  const { queue } = harness();
  const { job } = await queue.create(request());
  assert.equal(job.status, 'RECEIVED');
  assert.equal(job.terminal, false);
  assert.equal(job.capability, 'REVIEW');
});

test('an identical in-flight command coalesces instead of creating a second job', async () => {
  const { queue } = harness();
  const first = await queue.create(request());
  const second = await queue.create(request());
  assert.equal(second.coalescedWith, first.job.id);
  assert.equal(second.job.id, first.job.id);
});

test('coalescing is recorded in the audit log', async () => {
  const { store, queue } = harness();
  await queue.create(request());
  await queue.create(request());
  const types = (await store.listAudit({ jobId: 'R3-1' })).map(event => event.type);
  assert.deepEqual(types, ['JOB_CREATED', 'JOB_COALESCED']);
});

test('a legal transition advances the job and is audited', async () => {
  const { store, queue } = harness();
  const { job } = await queue.create(request());
  const advanced = await queue.advance(job, 'AUTHENTICATED');
  assert.equal(advanced.status, 'AUTHENTICATED');
  const transitions = (await store.listAudit({ jobId: job.id })).filter(event => event.type === 'JOB_TRANSITIONED');
  assert.deepEqual(transitions[0].metadata, { from: 'RECEIVED', to: 'AUTHENTICATED' });
});

test('an illegal transition throws and changes nothing', async () => {
  const { store, queue } = harness();
  const { job } = await queue.create(request());
  await assert.rejects(() => queue.advance(job, 'PUBLISHING'), IllegalTransition);
  assert.equal((await store.getJob(job.id)).status, 'RECEIVED');
});

test('failing a job sets a terminal status, a failure code and a completion time', async () => {
  const { queue } = harness();
  const { job } = await queue.create(request());
  const failed = await queue.fail(job, 'AUTH_REJECTED', 'Required: write. Yours: read.');
  assert.equal(failed.status, 'REJECTED');
  assert.equal(failed.terminal, true);
  assert.equal(failed.failureCode, 'AUTH_REJECTED');
  assert.ok(failed.completedAt);
});

test('a terminal job cannot be advanced or failed again', async () => {
  const { queue } = harness();
  const { job } = await queue.create(request());
  const failed = await queue.fail(job, 'AUTH_REJECTED');
  await assert.rejects(() => queue.advance(failed, 'AUTHENTICATED'), IllegalTransition);
  await assert.rejects(() => queue.fail(failed, 'AGENT_FAILED'), IllegalTransition);
});

test('a stale job snapshot loses the race instead of overwriting', async () => {
  const { queue } = harness();
  const { job } = await queue.create(request());
  await queue.advance(job, 'AUTHENTICATED');
  // `job` still says RECEIVED; the precondition no longer holds.
  await assert.rejects(() => queue.advance(job, 'AUTHENTICATED'), IllegalTransition);
});

test('a queued job can be failed as RUNNER_UNAVAILABLE', async () => {
  const { queue } = harness();
  let { job } = await queue.create(request());
  for (const next of ['AUTHENTICATED', 'AUTHORIZED', 'NORMALIZED', 'QUEUED']) job = await queue.advance(job, next);
  const failed = await queue.fail(job, 'RUNNER_UNAVAILABLE', 'Execution is not available yet.');
  assert.equal(failed.status, 'FAILED');
  assert.equal(failed.failureCode, 'RUNNER_UNAVAILABLE');
});
