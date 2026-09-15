'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const root = require('../../package.json');
const app = require('../package.json');

test('app workspace is registered', () => {
  assert.deepEqual(root.workspaces, ['app']);
});

test('app workspace stays out of the published package', () => {
  assert.ok(!root.files.some(entry => entry.startsWith('app')), 'app/ must not be published');
  assert.equal(app.private, true);
});

test('root test script covers the app suite', () => {
  assert.match(root.scripts.test, /app\/test\/\*\.test\.js/);
});

test('the published package declares no runtime dependencies', () => {
  assert.equal(root.dependencies, undefined);
});
