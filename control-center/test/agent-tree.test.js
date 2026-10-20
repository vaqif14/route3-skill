'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildAgentTree } = require('../agent-tree');
const { JobManager } = require('../process-manager');
const start = '2026-10-19T10:00:00.000Z', end = '2026-10-19T10:00:05.000Z', now = Date.parse('2026-10-19T10:00:10.000Z');
const job = (id, extra = {}) => ({ id, provider: 'codex', agent: 'codex', summary: 'Review the implementation', startedAt: start, status: 'running', ...extra });

test('explicit job parents and native session parents form one deduplicated forest', () => {
  const jobs = [job('lead', { sessionId: 'native-lead', costUsd: 0.2 }), job('worker', { parentJobId: 'lead', sessionId: 'native-worker', status: 'awaiting_approval' })];
  const sessions = [{ id: 'native-lead', provider: 'codex', costUsd: 0.2, model: 'gpt-observed' },
    { id: 'native-worker', provider: 'codex', costUsd: 0.1, parentSessionId: 'native-lead' },
    { id: 'native-child', provider: 'codex', parentSessionId: 'native-worker', status: 'done', startedAt: start, endedAt: end, costUsd: 0.05 }];
  const tree = buildAgentTree({ jobs, sessions, now });
  assert.equal(tree.nodes.length, 3);
  assert.deepEqual(tree.rootIds, ['job:lead']);
  assert.deepEqual(tree.nodes[0].children, ['job:worker']);
  assert.deepEqual(tree.nodes[1].children, ['session:codex:native-child']);
  assert.equal(tree.nodes[0].model, 'gpt-observed');
  assert.equal(tree.nodes[0].costUsd, 0.2);
  assert.equal(tree.nodes[1].status, 'needs_you');
  assert.equal(tree.nodes[1].source, 'job'); assert.equal(tree.nodes[1].sourceId, 'worker');
  assert.equal(tree.nodes[2].durationMs, 5000);
  assert.equal(tree.summary.totalAgents, 3); assert.equal(tree.summary.runningCount, 1);
  assert.equal(tree.summary.costedAgents, 3); assert.ok(Math.abs(tree.summary.totalCostUsd - 0.35) < 1e-10);
  assert.equal(jobs[0].model, undefined); assert.equal(sessions[0].children, undefined);
});

test('provider identity is required for deduplication; dependencies and replacements are not spawn relations', () => {
  const tree = buildAgentTree({ jobs: [job('one', { sessionId: 'shared' }), job('two', { failoverFrom: 'one', continuationOf: 'one', dependsOn: ['one'] })], sessions: [
    { id: 'shared', provider: 'claude', name: 'Same name' }, { id: 'different', provider: 'codex', name: 'Same name' }
  ], now });
  assert.equal(tree.nodes.length, 4);
  assert.equal(tree.rootIds.length, 4);
  assert.equal(tree.nodes.find(node => node.sourceId === 'shared').status, 'unknown');
});

test('unknown costs remain null, reported zero is measured and subtree bills never count as own cost', () => {
  const tree = buildAgentTree({ jobs: [job('unknown', { model: null }), job('zero', { costUsd: 0 }), job('inclusive', { costUsd: 20, costScope: 'subtree' }), job('negative', { costUsd: -1 })], now });
  assert.equal(tree.summary.totalCostUsd, null);
  assert.equal(tree.summary.knownCostUsd, 0); assert.equal(tree.summary.costedAgents, 1);
  assert.deepEqual(tree.nodes.map(node => node.costUsd), [null, 0, null, null]);
  const measured = buildAgentTree({ jobs: [job('own', { costUsd: 1.25 }), job('zero', { costUsd: 0 })], now });
  assert.equal(measured.summary.totalCostUsd, 1.25);
  assert.deepEqual(buildAgentTree().summary, { totalAgents: 0, runningCount: 0, totalCostUsd: 0, knownCostUsd: 0, costedAgents: 0 });
});

test('lifecycle and durations use reported state without converting stale or malformed sessions into stopped agents', () => {
  const statuses = ['running', 'completed', 'failed', 'awaiting_approval', 'cancelled', 'interrupted', 'incomplete', '__proto__'];
  const tree = buildAgentTree({ jobs: statuses.map((status, i) => job(String(i), { status, endedAt: status === 'completed' ? end : undefined })), sessions: [
    { id: 'old', provider: 'claude', startedAt: start, updatedAt: start },
    { id: 'bad-time', provider: 'codex', startedAt: 'invalid', endedAt: end, costUsd: Infinity }
  ], now });
  assert.deepEqual(tree.nodes.slice(0, 8).map(node => node.status), ['running', 'done', 'failed', 'needs_you', 'stopped', 'stopped', 'failed', 'unknown']);
  assert.equal(tree.nodes[0].durationMs, 10000); assert.equal(tree.nodes[1].durationMs, 5000);
  assert.equal(tree.nodes[2].durationMs, null); assert.equal(tree.nodes[8].durationMs, null); assert.equal(tree.nodes[8].status, 'unknown');
  assert.equal(tree.nodes[9].durationMs, null); assert.equal(tree.nodes[9].costUsd, null);
});

test('cycles, missing parents and malformed/duplicate records retain a safe finite forest', () => {
  const tree = buildAgentTree({ jobs: [null, {}, job('a', { parentJobId: 'b' }), job('b', { parentJobId: 'a' }), job('self', { parentJobId: 'self' }), job('orphan', { parentJobId: 'missing' }), job('a')], sessions: [
    null, { id: 'same', provider: 'claude', costUsd: 0.3 }, { id: 'same', provider: 'claude', costUsd: 0.3 }
  ], now });
  assert.equal(tree.nodes.length, 5);
  assert.equal(tree.summary.knownCostUsd, 0.3);
  assert.ok(tree.warnings.some(value => /Cyclic/.test(value)));
  assert.ok(tree.warnings.some(value => /outside/.test(value)));
  const visited = new Set();
  function visit(id) { assert.equal(visited.has(id), false); visited.add(id); for (const child of tree.nodes.find(node => node.id === id).children) visit(child); }
  tree.rootIds.forEach(visit); assert.equal(visited.size, tree.nodes.length);
  const safe = buildAgentTree({ jobs: [job('secret', { summary: 'api_key=private-value', name: 'Bearer veryprivatekey' })], now });
  assert.equal(JSON.stringify(safe).includes('private-value'), false);
  assert.equal(JSON.stringify(safe).includes('veryprivatekey'), false);
});

test('spawn parent ids validate before dispatch, survive history, and remain siblings on failover', t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'route3-lineage-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const options = { workspace: home, env: { PATH: '' }, commands: { codex: '/fixture/codex', gemini: '/fixture/gemini', claude: null, kimi: null, zai: null }, historyFile: path.join(home, 'jobs.json') };
  const manager = new JobManager(options); let launches = 0; manager.launchProcess = () => { launches++; };
  t.after(() => manager.shutdown());
  assert.throws(() => manager.start({ agent: 'codex', prompt: 'Invalid child', parentJobId: 'missing' }), /Parent job/);
  assert.equal(launches, 0);
  const parent = manager.start({ agent: 'codex', prompt: 'Lead work' });
  const child = manager.start({ agent: 'auto', prompt: 'Child work', parentJobId: parent.id });
  const failed = manager.jobs.get(child.id); Object.assign(failed, { status: 'failed', errorTail: 'quota exceeded' });
  manager.maybeFailover(failed);
  assert.ok(failed.failoverTo);
  const replacement = manager.jobs.get(failed.failoverTo);
  assert.equal(replacement.parentJobId, parent.id);
  assert.equal(replacement.failoverFrom, child.id);
  const tree = buildAgentTree({ jobs: manager.list(), now });
  assert.equal(tree.nodes.find(node => node.sourceId === replacement.id).parentId, `job:${parent.id}`);
  assert.equal(tree.nodes.find(node => node.sourceId === parent.id).childCount, 2);
  const restored = new JobManager(options); t.after(() => restored.shutdown());
  assert.equal(restored.jobs.get(replacement.id).parentJobId, parent.id);
});

test('lone Unicode surrogates are omitted without rejecting well-formed Unicode identities', () => {
  const tree = buildAgentTree({ jobs: [job('bad\ud800'), job('good-😀')], sessions: [
    { id: '\udc00', provider: 'codex' }, { id: 'bad\ud800suffix', provider: 'claude' }, { id: 'child-😀', provider: 'codex', parentSessionId: '\ud800' }
  ], now });
  assert.equal(tree.nodes.length, 2);
  assert.equal(tree.nodes[0].sourceId, 'good-😀');
  assert.equal(tree.nodes[0].id, `job:${encodeURIComponent('good-😀')}`);
  assert.equal(tree.nodes[1].parentId, null);
  assert.ok(tree.warnings.some(value => /Malformed/.test(value)));
});

test('continuation and failover retain validated lineage after history prunes the original parent', t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'route3-pruned-lineage-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const manager = new JobManager({ workspace: home, env: { PATH: '' }, commands: { codex: '/fixture/codex', gemini: '/fixture/gemini', claude: null, kimi: null, zai: null } });
  manager.launchProcess = () => {}; t.after(() => manager.shutdown());
  const finish = input => { const created = manager.start({ agent: 'codex', prompt: 'Completed work', ...input }); manager.jobs.get(created.id).status = 'completed'; return created; };
  const parent = finish(), child = finish({ parentJobId: parent.id });
  for (let i = 0; i < 99; i++) finish();
  assert.equal(manager.jobs.size, 100);
  assert.equal(manager.jobs.has(parent.id), false); assert.equal(manager.jobs.has(child.id), true);
  assert.throws(() => manager.start({ agent: 'codex', prompt: 'Unvalidated new spawn', parentJobId: parent.id }), /Parent job/);
  const continued = manager.continueJob(child.id, 'Continue the previously validated work');
  assert.equal(continued.parentJobId, parent.id); assert.equal(continued.continuationOf, child.id);
  assert.equal(manager.jobs.has(child.id), true, 'retention must not prune the predecessor while launching its replacement');
  const failed = manager.jobs.get(child.id);
  Object.assign(failed, { status: 'failed', automatic: true, errorTail: 'quota exceeded' });
  manager.maybeFailover(failed);
  assert.ok(failed.failoverTo);
  const replacement = manager.jobs.get(failed.failoverTo);
  assert.equal(replacement.parentJobId, parent.id); assert.equal(replacement.failoverFrom, child.id);
  const tree = buildAgentTree({ jobs: manager.list(), now });
  assert.equal(tree.nodes.find(node => node.sourceId === continued.id).parentId, null);
  assert.equal(tree.nodes.find(node => node.sourceId === replacement.id).parentId, null);
  assert.ok(tree.warnings.some(value => /outside the available records/.test(value)));
  assert.equal(manager.jobs.size, 100);
});
