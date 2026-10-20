'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../server');
const { JobManager } = require('../process-manager');

test('real server state merges native identity and refreshes job lifecycle between cached telemetry polls', async t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'route3-tree-api-'));
  let server;
  t.after(async () => { if (server) { await server.route3.shutdown(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } fs.rmSync(home, { recursive: true, force: true }); });
  const experts = { list: () => [], warnings: () => [], find: () => null };
  const jobs = new JobManager({ workspace: home, experts, env: { PATH: '' }, commands: { codex: '/fixture/codex', gemini: null, kimi: null, claude: null, zai: null } });
  let launched = 0, collections = 0; jobs.launchProcess = () => { launched++; };
  const sessions = [{ id: 'lead-session', provider: 'codex', model: 'gpt-reported', costUsd: 0.4 },
    { id: 'native-child', provider: 'codex', parentSessionId: 'lead-session', status: 'done', startedAt: '2026-10-19T10:00:00Z', endedAt: '2026-10-19T10:00:01Z', costUsd: 0.1 }];
  server = createServer({ home, workspace: home, jobs, experts, notebookOptions: { command: null }, integrationOptions: { command: null }, collectTelemetry: async () => { collections++; return { sessions, summary: {}, warnings: [] }; } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const token = (await (await fetch(`${base}/api/bootstrap`)).json()).token;
  const headers = { 'content-type': 'application/json', 'x-route3-token': token };
  const post = input => fetch(`${base}/api/jobs`, { method: 'POST', headers, body: JSON.stringify(input) });
  assert.equal((await fetch(`${base}/api/jobs`, { method: 'POST', headers: { ...headers, 'x-route3-token': 'bad' }, body: JSON.stringify({ agent: 'codex', prompt: 'Spawn child', parentJobId: 'missing' }) })).status, 403);
  assert.equal((await post({ agent: 'codex', prompt: 'Invalid spawn', parentJobId: 'missing' })).status, 400);
  assert.equal(launched, 0);
  const root = (await (await post({ agent: 'codex', prompt: 'Lead task' })).json()).job;
  jobs.jobs.get(root.id).sessionId = 'lead-session';
  const child = (await (await post({ agent: 'codex', prompt: 'Spawned task', parentJobId: root.id })).json()).job;
  const first = await (await fetch(`${base}/api/state`)).json();
  assert.equal(first.agentTree.nodes.length, 3);
  assert.deepEqual(first.agentTree.rootIds, [`job:${root.id}`]);
  assert.equal(first.agentTree.nodes.find(node => node.sourceId === root.id).childCount, 2);
  assert.equal(first.agentTree.nodes.find(node => node.sourceId === root.id).model, 'gpt-reported');
  assert.equal(first.agentTree.summary.runningCount, 2);
  assert.equal(first.agentTree.summary.totalCostUsd, null);
  assert.equal(first.agentTree.summary.knownCostUsd, 0.5);
  assert.equal(first.agentTree.summary.costedAgents, 2);
  Object.assign(jobs.jobs.get(child.id), { status: 'awaiting_approval', costUsd: 0.2 });
  const second = await (await fetch(`${base}/api/state`)).json();
  assert.equal(collections, 1);
  assert.equal(second.agentTree.nodes.find(node => node.sourceId === child.id).status, 'needs_you');
  assert.equal(second.agentTree.summary.runningCount, 1);
  assert.ok(Math.abs(second.agentTree.summary.totalCostUsd - 0.7) < 1e-10);
  Object.assign(jobs.jobs.get(child.id), { status: 'completed', endedAt: new Date().toISOString() });
  const third = await (await fetch(`${base}/api/state`)).json();
  assert.equal(third.agentTree.nodes.find(node => node.sourceId === child.id).status, 'done');
  assert.equal(launched, 2);
  assert.equal((await fetch(`${base}/api/state`, { headers: { origin: 'https://other.example' } })).status, 403);
  for (const [file, type] of [['agent-tree.js', 'text/javascript'], ['agent-tree.css', 'text/css']]) {
    const response = await fetch(`${base}/${file}`);
    assert.equal(response.status, 200); assert.ok(response.headers.get('content-type').startsWith(type));
    assert.ok((await response.text()).length > 0);
  }
});

test('malformed Unicode identities cannot break state or turn stale telemetry into stopped agents', async t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'route3-empty-tree-'));
  const jobs = { list: () => [{ id: 'bad\ud800', provider: 'codex', status: 'running' }], agents: () => [], start() {}, shutdown() {} };
  const server = createServer({ home, workspace: home, jobs, notebookOptions: { command: null }, integrationOptions: { command: null }, collectTelemetry: async () => ({ sessions: [null, { id: '\udc00', provider: 'codex' }, { id: 'observed', provider: 'claude', updatedAt: '2000-01-01T00:00:00Z', costUsd: '12' }], summary: { totalTokens: 7 }, warnings: ['Existing coverage warning'] }) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await server.route3.shutdown(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(home, { recursive: true, force: true }); });
  const state = await (await fetch(`http://127.0.0.1:${server.address().port}/api/state`)).json();
  assert.equal(state.agentTree.nodes.length, 1);
  assert.equal(state.agentTree.nodes[0].status, 'unknown');
  assert.equal(state.agentTree.nodes[0].costUsd, null);
  assert.equal(state.agentTree.nodes[0].durationMs, null);
  assert.equal(state.agentTree.summary.totalCostUsd, null);
  assert.equal(state.agentTree.summary.costedAgents, 0);
  assert.ok(state.agentTree.warnings.length);
  assert.equal(state.summary.totalTokens, 7); assert.deepEqual(state.warnings, ['Existing coverage warning']);
});
