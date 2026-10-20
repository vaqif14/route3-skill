'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { money, duration, branchCost } = require('../public/agent-tree');

test('UI keeps unavailable cost and duration separate from measured zero', () => {
  for (const value of [null, undefined, NaN, Infinity, -1, '0']) { assert.equal(money(value), '—'); assert.equal(duration(value), '—'); }
  assert.equal(money(0), '$0.00'); assert.equal(duration(0), '0s');
  assert.equal(money(.000001), '<$0.0001'); assert.equal(duration(61000), '1m 1s'); assert.equal(duration(3601000), '1h 0m');
});

test('branch costs include descendants once and stay unknown for incomplete or cyclic branches', () => {
  const nodes = new Map([['lead', { costUsd: .2, children: ['worker'] }], ['worker', { costUsd: .1, children: ['check'] }], ['check', { costUsd: .05, children: [] }]]);
  assert.ok(Math.abs(branchCost('lead', nodes) - .35) < 1e-9);
  nodes.get('check').costUsd = null; assert.equal(branchCost('lead', nodes), null);
  nodes.get('check').costUsd = 0; nodes.get('check').children = ['lead']; assert.equal(branchCost('lead', nodes), null);
  assert.equal(branchCost('missing', nodes), null);
});
