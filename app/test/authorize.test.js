'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { authorize } = require('../gateway/auth/authorize');
const { createMemoryStore } = require('../gateway/jobs/store.memory');
const { parseCommand } = require('../gateway/commands/grammar');
const { normalize } = require('../gateway/github/events');
const { issueComment } = require('./support/payloads');

function fakeClient(permission = 'write') {
  const calls = [];
  return {
    calls,
    async actorPermission(installationId, fullName, login) {
      calls.push({ installationId, fullName, login });
      return permission;
    },
  };
}

async function seed({ enabled = true, repositoryEnabled = true, repositoryInstallationId = 1001 } = {}) {
  const store = createMemoryStore();
  await store.upsertInstallation({ id: 1001, accountLogin: 'vaqif14', accountType: 'User', enabled, suspendedAt: null });
  await store.upsertRepository({
    id: 5001, installationId: repositoryInstallationId, fullName: 'vaqif14/route3-e2e-fixture',
    defaultBranch: 'main', private: true, enabled: repositoryEnabled,
  });
  return store;
}

const run = (store, client, body, allowlist = new Set([1001])) => authorize({
  store, client,
  normalized: normalize('issue_comment', issueComment({ comment: { id: 7001, body } })),
  ast: parseCommand(body).ast,
  allowlist,
});

test('a well-formed request from a write user is authorized', async () => {
  const decision = await run(await seed(), fakeClient('write'), '/route3 review');
  assert.equal(decision.ok, true);
  assert.equal(decision.descriptor.capability, 'REVIEW');
  assert.equal(decision.minimum, 'write');
});

test('an unknown installation is rejected at layer 1', async () => {
  const store = createMemoryStore();
  const decision = await run(store, fakeClient(), '/route3 review');
  assert.equal(decision.reason, 'installation_unknown');
  assert.equal(decision.failureCode, 'AUTH_REJECTED');
});

test('an installation outside the private-beta allowlist is policy-rejected', async () => {
  const decision = await run(await seed(), fakeClient(), '/route3 review', new Set([2002]));
  assert.equal(decision.reason, 'installation_disabled');
  assert.equal(decision.failureCode, 'POLICY_REJECTED');
});

test('an empty allowlist enables nobody', async () => {
  const decision = await run(await seed(), fakeClient(), '/route3 review', new Set());
  assert.equal(decision.ok, false);
});

test('a repository owned by another installation is rejected before any actor lookup', async () => {
  const client = fakeClient('admin');
  const decision = await run(await seed({ repositoryInstallationId: 2002 }), client, '/route3 review');
  assert.equal(decision.reason, 'repository_foreign');
  assert.equal(decision.securityEvent, true);
  assert.equal(client.calls.length, 0, 'no GitHub call is made for a cross-installation event');
});

test('a disabled repository is policy-rejected', async () => {
  const decision = await run(await seed({ repositoryEnabled: false }), fakeClient('admin'), '/route3 review');
  assert.equal(decision.reason, 'repository_disabled');
});

test('a read-only actor cannot run a write command', async () => {
  const decision = await run(await seed(), fakeClient('read'), '/route3 review');
  assert.equal(decision.reason, 'actor_permission');
  assert.equal(decision.failureCode, 'AUTH_REJECTED');
  assert.match(decision.message, /Required: write/);
  assert.match(decision.message, /Yours: read/);
});

test('a write actor cannot run an admin command', async () => {
  const decision = await run(await seed(), fakeClient('write'), '/route3 setup');
  assert.equal(decision.reason, 'actor_permission');
  assert.match(decision.message, /Required: admin/);
});

test('a read actor may run a read command', async () => {
  assert.equal((await run(await seed(), fakeClient('read'), '/route3 help')).ok, true);
});

test('a repository policy may raise the bar but not lower it', async () => {
  const store = await seed();
  await store.upsertRepository({ id: 5001, policy: { review: { minimum: 'admin' } } });
  assert.equal((await run(store, fakeClient('write'), '/route3 review')).reason, 'actor_permission');

  const lowered = await seed();
  await lowered.upsertRepository({ id: 5001, policy: { setup: { minimum: 'read' } } });
  assert.equal((await run(lowered, fakeClient('read'), '/route3 setup')).reason, 'actor_permission');
});

test('a disabled command short-circuits before the GitHub call', async () => {
  const store = await seed();
  await store.upsertRepository({ id: 5001, policy: { review: { enabled: false } } });
  const client = fakeClient('admin');
  const decision = await run(store, client, '/route3 review');
  assert.equal(decision.reason, 'command_disabled');
  assert.equal(client.calls.length, 0);
});
