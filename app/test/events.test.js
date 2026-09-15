'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { normalize, SUPPORTED, InvalidEvent } = require('../gateway/github/events');
const { issueComment } = require('./support/payloads');

test('only the six subscribed events are supported', () => {
  assert.deepEqual([...SUPPORTED].sort(), [
    'installation', 'installation_repositories', 'issue_comment',
    'issues', 'pull_request', 'pull_request_review_comment',
  ]);
});

test('an unsubscribed event is reported, not thrown', () => {
  assert.deepEqual(normalize('push', {}), { supported: false, event: 'push' });
});

test('a pull-request comment normalizes to a flat shape', () => {
  const result = normalize('issue_comment', issueComment());
  assert.equal(result.actionable, true);
  assert.equal(result.installationId, 1001);
  assert.equal(result.surface, 'pull_request');
  assert.equal(result.surfaceNumber, 42);
  assert.equal(result.commentId, 7001);
  assert.equal(result.body, '/route3 help');
  assert.deepEqual(result.actor, { id: 9001, login: 'vaqif14' });
  assert.deepEqual(result.repository, {
    id: 5001, fullName: 'vaqif14/route3-e2e-fixture', defaultBranch: 'main', private: true, ownerId: 9001,
  });
});

test('an issue comment without a pull_request link is an issue surface', () => {
  const payload = issueComment({ issue: { number: 7 } });
  assert.equal(normalize('issue_comment', payload).surface, 'issue');
});

test('a deleted comment is supported but not actionable', () => {
  const result = normalize('issue_comment', issueComment({ action: 'deleted' }));
  assert.equal(result.supported, true);
  assert.equal(result.actionable, false);
});

test('a payload missing its installation is rejected', () => {
  const payload = issueComment();
  delete payload.installation;
  assert.throws(() => normalize('issue_comment', payload), InvalidEvent);
});

test('a non-integer repository id is rejected', () => {
  const payload = issueComment();
  payload.repository.id = '5001';
  assert.throws(() => normalize('issue_comment', payload), /repository.id/);
});

test('a missing comment body normalizes to an empty string, not undefined', () => {
  const payload = issueComment();
  delete payload.comment.body;
  assert.equal(normalize('issue_comment', payload).body, '');
});

test('installation events are supported but carry no command', () => {
  const result = normalize('installation', { action: 'created', installation: { id: 1001 } });
  assert.equal(result.supported, true);
  assert.equal(result.actionable, false);
  assert.equal(result.installationId, 1001);
});
