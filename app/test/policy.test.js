'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { mostRestrictive, resolve } = require('../gateway/auth/policy');
const { lookup } = require('../gateway/commands/registry');

test('the most restrictive permission wins', () => {
  assert.equal(mostRestrictive('read', 'admin', 'write'), 'admin');
  assert.equal(mostRestrictive('read', null, undefined), 'read');
  assert.equal(mostRestrictive(), 'none');
});

test('an unknown permission is a programming error, not a silent pass', () => {
  assert.throws(() => mostRestrictive('superuser'), /Unknown permission/);
});

test('a repository may restrict but never widen', () => {
  const setup = lookup('setup', null); // minimumPermission: admin
  assert.equal(resolve(setup, { repository: { minimum: 'read' } }).minimum, 'admin');
});

test('a repository may raise the bar above the command default', () => {
  const review = lookup('review', null); // minimumPermission: write
  assert.equal(resolve(review, { repository: { minimum: 'admin' } }).minimum, 'admin');
});

test('any layer can disable a command', () => {
  const review = lookup('review', null);
  assert.equal(resolve(review, {}).enabled, true);
  assert.equal(resolve(review, { repository: { enabled: false } }).enabled, false);
  assert.equal(resolve(review, { installation: { enabled: false } }).enabled, false);
  assert.equal(resolve(review, { global: { enabled: false } }).enabled, false);
});

test('a repository cannot re-enable what a higher layer disabled', () => {
  const review = lookup('review', null);
  assert.equal(resolve(review, { global: { enabled: false }, repository: { enabled: true } }).enabled, false);
});
