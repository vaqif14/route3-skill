'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const state = require('../gateway/jobs/state');

test('the happy path is walkable end to end', () => {
  const path = ['RECEIVED', 'AUTHENTICATED', 'AUTHORIZED', 'NORMALIZED', 'QUEUED',
    'EXECUTING', 'READY_TO_PUBLISH', 'PUBLISHING', 'SUCCEEDED'];
  for (let i = 0; i < path.length - 1; i++) {
    assert.equal(state.assertTransition(path[i], path[i + 1]), path[i + 1]);
  }
});

test('states cannot be skipped', () => {
  assert.throws(() => state.assertTransition('QUEUED', 'SUCCEEDED'), state.IllegalTransition);
  assert.throws(() => state.assertTransition('RECEIVED', 'PUBLISHING'), state.IllegalTransition);
});

test('a terminal state never returns to an active state', () => {
  for (const terminal of state.TERMINAL) {
    assert.throws(() => state.assertTransition(terminal, 'QUEUED'), state.IllegalTransition);
    assert.throws(() => state.assertFailure(terminal, 'AGENT_FAILED'), state.IllegalTransition);
  }
});

test('every failure branch resolves to a real terminal state', () => {
  for (const [branch, terminal] of Object.entries(state.FAILURE_TERMINAL)) {
    assert.ok(state.TERMINAL.has(terminal), `${branch} resolves to unknown terminal ${terminal}`);
  }
});

test('the failure branches the spec names are all present', () => {
  const required = ['AUTH_REJECTED', 'POLICY_REJECTED', 'SOURCE_FAILED', 'SOURCE_INTEGRITY_FAILURE',
    'SOURCE_TOO_LARGE', 'RUNNER_UNAVAILABLE', 'RUNNER_VERSION_UNSUPPORTED', 'RUNNER_LOST',
    'LEASE_EXPIRED', 'SANDBOX_FAILED', 'AGENT_FAILED', 'RESULT_INVALID', 'SECURITY_REJECTED',
    'ARTIFACT_SECURITY_REJECTED', 'SOURCE_STALE', 'PUBLISH_CONFLICT', 'PUBLISH_FAILED',
    'CANCELLED', 'TIMED_OUT'];
  for (const branch of required) {
    assert.ok(Object.hasOwn(state.FAILURE_TERMINAL, branch), `missing failure branch ${branch}`);
  }
});

test('an unknown failure code is rejected', () => {
  assert.throws(() => state.assertFailure('QUEUED', 'MADE_UP'), state.IllegalTransition);
});

test('a queued job can fail as RUNNER_UNAVAILABLE', () => {
  assert.equal(state.assertFailure('QUEUED', 'RUNNER_UNAVAILABLE'), 'FAILED');
});

test('terminal and active are disjoint', () => {
  for (const terminal of state.TERMINAL) assert.equal(state.isActive(terminal), false);
  for (const active of Object.keys(state.ACTIVE_TRANSITIONS)) assert.equal(state.isTerminal(active), false);
});
