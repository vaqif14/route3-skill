'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const { createServer } = require('../server');

const NOTEBOOK = '11111111-2222-4333-8444-555555555555';
const check = [process.execPath, '-e', 'process.exit(0)'];
async function eventually(fn) {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) { const value = await fn(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 15)); }
  assert.fail('Graph did not reach the expected state.');
}
async function fixture(t, extra = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'route3-graph-api-'));
  let server;
  t.after(async () => { if (server) { await server.route3.shutdown(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } fs.rmSync(home, { recursive: true, force: true }); });
  const inputs = [], entries = [];
  const jobs = { agents: () => [], list: () => entries.map(job => ({ ...job })), shutdown() {},
    start(input) { inputs.push(input); const job = { id: crypto.randomUUID(), status: 'running', summary: input.prompt, cwd: input.cwd || home, agent: input.agent || 'auto', startedAt: new Date().toISOString() }; entries.push(job); return { ...job }; },
    cancel(id) { const job = entries.find(job => job.id === id); job.status = 'cancelled'; return { ...job }; }
  };
  const resolutions = [];
  const notebooklm = { snapshot: () => ({ status: 'ready', notebooks: [] }), resolve: async id => { resolutions.push(id); if (!id) return null; if (id !== NOTEBOOK) throw Object.assign(new Error('Notebook is unavailable.'), { statusCode: 400 }); return { id, title: 'Verified notebook' }; } };
  const experts = { list: () => [], warnings: () => [], find: id => id === 'bound' ? { label: 'Bound expert', brain: { id: NOTEBOOK, title: 'Stale title' } } : null };
  server = createServer({ home, workspace: home, jobs, experts, notebooklm, graphOptions: { tickMs: 10 }, integrationOptions: { command: null }, collectTelemetry: async () => ({ sessions: [], warnings: [] }), ...extra });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const request = (pathname, { method = 'GET', headers = {}, body, raw } = {}) => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: pathname, method, headers }, res => { let data = ''; res.on('data', chunk => data += chunk); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) })); });
    req.on('error', reject); req.end(raw ?? (body === undefined ? undefined : JSON.stringify(body)));
  });
  const token = (await request('/api/bootstrap')).body.token;
  const headers = { 'content-type': 'application/json', 'x-route3-token': token };
  const post = (pathname, body = {}) => request(pathname, { method: 'POST', headers, body });
  return { home, server, jobs, entries, inputs, resolutions, request, post, headers, port };
}

test('graph API preserves localhost, token, JSON and body-size boundaries', async t => {
  const { request, post, headers, port, inputs } = await fixture(t);
  const body = { prompt: 'Review the change', command: check };
  assert.equal((await request('/api/graphs', { method: 'POST', body })).status, 403);
  assert.equal((await request('/api/graphs', { headers: { host: `evil.example:${port}` } })).status, 403);
  assert.equal((await request('/api/graphs', { method: 'POST', body, headers: { ...headers, origin: 'https://evil.example' } })).status, 403);
  assert.equal((await request('/api/graphs', { method: 'POST', body, headers: { ...headers, 'x-route3-token': 'bad' } })).status, 403);
  assert.equal((await request('/api/graphs', { method: 'POST', body, headers: { 'x-route3-token': headers['x-route3-token'] } })).status, 415);
  assert.equal((await request('/api/graphs', { method: 'POST', raw: '[]', headers })).status, 400);
  assert.equal((await post('/api/graphs', { ...body, prompt: 'x'.repeat(41000) })).status, 413);
  assert.equal((await post('/api/graphs', { prompt: 'No implicit check' })).status, 400);
  assert.equal((await post('/api/graphs', { definition: { version: 1, name: 'Untrusted notebook', goal: 'Review', nodes: [{ id: 'work', type: 'agent', prompt: 'Review change', brain: { id: NOTEBOOK, title: 'Untrusted' } }], edges: [] } })).status, 400);
  assert.equal(inputs.length, 0);
});

test('graph creation is reviewable; exact hash gates launch; lifecycle stays independent of jobs', async t => {
  const { post, request, server, inputs } = await fixture(t);
  const created = await post('/api/graphs', { prompt: 'Implement the reviewed change', command: check, maxAttempts: 2 });
  assert.equal(created.status, 201);
  const graph = created.body.graph, url = `/api/graphs/${graph.id}`;
  assert.equal(graph.status, 'draft');
  assert.equal(inputs.length, 0);
  assert.equal((await request('/api/graphs')).body.graphs[0].id, graph.id);
  assert.equal((await request(url)).body.graph.definitionHash, graph.definitionHash);
  assert.equal((await request('/api/state')).body.graphs[0].id, graph.id);
  assert.equal(server.route3.graphs.get(graph.id).id, graph.id);
  assert.equal((await post(`${url}/start`)).status, 409);
  assert.equal((await post(`${url}/start`, { definitionHash: 'wrong' })).status, 409);
  assert.equal(inputs.length, 0);
  assert.equal((await post(`${url}/start`, { definitionHash: graph.definitionHash })).body.graph.status, 'running');
  await eventually(() => inputs.length === 1);
  assert.equal((await post(`${url}/pause`)).body.graph.status, 'paused');
  assert.equal((await post(`${url}/resume`)).body.graph.status, 'running');
  assert.equal((await post(`${url}/cancel`)).body.graph.status, 'cancelled');
  assert.equal((await request('/api/graphs/00000000-0000-4000-8000-000000000000')).status, 404);
});

test('graph jobs re-resolve notebook ids and expert bindings through the server', async t => {
  const { post, request, inputs, entries, resolutions } = await fixture(t);
  const definition = { version: 1, name: 'Notebook verification', goal: 'Review grounded work', nodes: [
    { id: 'one', type: 'agent', prompt: 'Review first change', notebookId: NOTEBOOK },
    { id: 'two', type: 'agent', prompt: 'Review second change', expert: 'bound' }
  ], edges: [{ from: 'one', to: 'two', on: 'success' }] };
  const created = await post('/api/graphs', { definition });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const graph = created.body.graph;
  await post(`/api/graphs/${graph.id}/start`, { definitionHash: graph.definitionHash });
  await eventually(() => inputs.length === 1);
  assert.deepEqual(inputs[0].brain, { id: NOTEBOOK, title: 'Verified notebook' });
  entries[0].status = 'completed';
  await eventually(() => inputs.length === 2);
  assert.deepEqual(inputs[1].brain, { id: NOTEBOOK, title: 'Verified notebook' });
  assert.equal(resolutions.filter(id => id === NOTEBOOK).length, 2);
  entries[1].status = 'completed';
  await eventually(async () => (await request(`/api/graphs/${graph.id}`)).body.graph.status === 'succeeded');
});
test('explicit graph check runs locally and graph checkpoints use private workspace state', async t => {
  const { post, request, home } = await fixture(t, { persistJobs: true });
  const definition = { version: 1, name: 'Local check', goal: 'Verify the workspace', nodes: [{ id: 'verify', type: 'check', command: check }], edges: [] };
  const { body, status } = await post('/api/graphs', { definition });
  assert.equal(status, 201, JSON.stringify(body));
  const graph = body.graph;
  await post(`/api/graphs/${graph.id}/start`, { definitionHash: graph.definitionHash });
  await eventually(async () => (await request(`/api/graphs/${graph.id}`)).body.graph.status === 'succeeded');
  const report = (await request(`/api/graphs/${graph.id}/harness`)).body;
  assert.equal(report.status, 'success');
  assert.equal(report.runStatus, 'succeeded');
  assert.equal(report.usage.agentAttempts, 0);
  const hash = crypto.createHash('sha256').update(fs.realpathSync(home)).digest('hex').slice(0, 24);
  const file = path.join(home, '.local/share/route3/graphs', `${hash}.json`);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test('team claims and messages coordinate a shared task list without launching a draft', async t => {
  const { post, request, headers, inputs } = await fixture(t);
  const definition = { version: 1, name: 'Shared work', goal: 'Coordinate a reviewed change', team: { lead: 'lead', members: [
    { id: 'lead', label: 'Team Lead', agent: 'codex', taskClass: 'planning' },
    { id: 'worker', label: 'Implementer', agent: 'codex', taskClass: 'code' },
    { id: 'reviewer', label: 'Reviewer', agent: 'codex', taskClass: 'code' }
  ] }, nodes: [{ id: 'work', type: 'agent', prompt: 'Implement the reviewed task' }], edges: [] };
  const created = await post('/api/graphs', { definition });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const graph = created.body.graph, url = `/api/graphs/${graph.id}`;
  assert.equal((await request(`${url}/claim`, { method: 'POST', body: { nodeId: 'work', memberId: 'worker' }, headers: { ...headers, 'x-route3-token': 'bad' } })).status, 403);
  const claimed = await post(`${url}/claim`, { nodeId: 'work', memberId: 'worker' });
  assert.equal(claimed.status, 200, JSON.stringify(claimed.body));
  assert.equal(claimed.body.graph.nodes.work.claim.memberId, 'worker');
  assert.equal((await post(`${url}/claim`, { nodeId: 'work', memberId: 'reviewer' })).status, 409);
  assert.equal((await post(`${url}/release`, { nodeId: 'work', memberId: 'reviewer' })).status, 409);
  assert.equal((await post(`${url}/release`, { nodeId: 'work', memberId: 'worker' })).status, 200);
  const messaged = await post(`${url}/message`, { from: 'lead', to: 'worker', taskId: 'work', body: 'Check the existing boundaries before editing.' });
  assert.equal(messaged.status, 200, JSON.stringify(messaged.body));
  assert.equal(messaged.body.graph.messages.at(-1).body, 'Check the existing boundaries before editing.');
  assert.equal(messaged.body.graph.team.lead, 'lead');
  assert.equal((await post(`${url}/message`, { from: 'outsider', to: 'team', body: 'Unknown sender' })).status, 400);
  assert.equal((await post(`${url}/message`, { from: 'lead', to: 'outsider', body: 'Unknown recipient' })).status, 400);
  assert.equal((await post(`${url}/message`, { from: 'lead', to: 'team', body: 'x'.repeat(1001) })).status, 400);
  assert.equal(inputs.length, 0);
  assert.equal((await request(url)).body.graph.status, 'draft');
});

test('unknown agent outcomes block until an explicit reconciliation decision', async t => {
  const { post, request, entries, inputs } = await fixture(t);
  const created = await post('/api/graphs', { definition: { version: 1, name: 'Reconcile work', goal: 'Track an unknown result', nodes: [{ id: 'work', type: 'agent', prompt: 'Perform the reviewed task' }], edges: [] } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const graph = created.body.graph, url = `/api/graphs/${graph.id}`;
  await post(`${url}/start`, { definitionHash: graph.definitionHash });
  await eventually(() => inputs.length === 1);
  entries.splice(0);
  await eventually(async () => (await request(url)).body.graph.status === 'blocked');
  assert.equal((await post(`${url}/resume`)).status, 409);
  const reconciled = await post(`${url}/reconcile`, { nodeId: 'work', action: 'fail', note: 'Operator inspected the lost job result.' });
  assert.equal(reconciled.status, 200, JSON.stringify(reconciled.body));
  assert.equal(reconciled.body.graph.status, 'paused');
  assert.equal(reconciled.body.graph.nodes.work.status, 'failed');
  assert.equal(inputs.length, 1);
});

test('graph storage faults remain visible and disable graph writes while jobs stay available', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'route3-graph-warning-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'graphs.json');
  const { request, post, server } = await fixture(t, { graphOptions: { file, tickMs: 10 } });
  fs.mkdirSync(file);
  assert.equal((await post('/api/graphs', { prompt: 'Review the write failure', command: check })).status, 503);
  assert.ok(server.route3.graphs.historyWarning);
  assert.ok((await request('/api/state')).body.warnings.includes(server.route3.graphs.historyWarning));
  const malformed = path.join(directory, 'malformed.json'); fs.writeFileSync(malformed, '{broken');
  const disabled = await fixture(t, { graphOptions: { file: malformed, tickMs: 10 } });
  assert.equal((await disabled.request('/api/state')).status, 200);
  assert.equal((await disabled.request('/api/graphs')).status, 503);
  assert.equal((await disabled.request('/api/graphs/00000000-0000-4000-8000-000000000000/harness')).status, 503);
  assert.equal((await disabled.post('/api/graphs', { prompt: 'Do not reset broken history', command: check })).status, 503);
  assert.equal((await disabled.post('/api/jobs', { prompt: 'Independent reviewed work', agent: 'codex' })).status, 202);
  assert.equal(fs.readFileSync(malformed, 'utf8'), '{broken');
});

test('shutdown cleans every component once after a graph write failure, including close-first shutdown', async t => {
  for (const mode of ['explicit', 'close-first']) await t.test(mode, async t => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'route3-shutdown-'));
    const file = path.join(home, 'graphs.json'), calls = [];
    let server, graphFailure;
    t.after(async () => {
      if (server) {
        try { await server.route3.shutdown(); } catch { /* expected checkpoint failure */ }
        if (server.listening) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
      }
      fs.rmSync(home, { recursive: true, force: true });
    });
    const jobs = { start() {}, list: () => [], shutdown() { calls.push('jobs'); throw new Error('Later jobs cleanup failure'); } };
    const nightShift = { async shutdown() { calls.push('nightShift'); throw new Error('Later Night Shift cleanup failure'); } };
    const telegramBridge = { async shutdown() { calls.push('telegram'); await Promise.resolve(); calls.push('telegram finished'); throw new Error('Later Telegram cleanup failure'); } };
    server = createServer({ home, workspace: home, jobs, nightShift, telegramBridge, notebookOptions: { command: null }, graphOptions: { file }, integrationOptions: { command: null } });
    server.route3.graphs.create({ version: 1, name: 'Retained work', goal: 'Retain the reviewed checkpoint', nodes: [{ id: 'verify', type: 'check', command: check }], edges: [] });
    const graphShutdown = server.route3.graphs.shutdown.bind(server.route3.graphs);
    server.route3.graphs.shutdown = () => {
      calls.push('graphs');
      try { return graphShutdown(); } catch (error) { graphFailure = error; throw error; }
    };
    // Break only the final checkpoint write, after valid retained work exists.
    fs.unlinkSync(file); fs.mkdirSync(file);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let stopping;
    if (mode === 'close-first') {
      await new Promise(resolve => server.close(resolve));
      stopping = server.route3.shutdown();
    } else {
      assert.doesNotThrow(() => { stopping = server.route3.shutdown(); });
      assert.ok(stopping instanceof Promise);
      assert.equal(server.route3.shutdown(), stopping);
    }
    await assert.rejects(stopping, error => error === graphFailure && error.statusCode === 503);
    if (server.listening) await new Promise(resolve => server.close(resolve));
    assert.equal(server.route3.shutdown(), stopping);
    assert.deepEqual(calls, ['graphs', 'nightShift', 'jobs', 'telegram', 'telegram finished']);
  });
});

test('harness reports enforce localhost access and expose exhausted agent budget without another dispatch', async t => {
  const { post, request, entries, inputs, port } = await fixture(t);
  const policy = { maxAgentAttempts: 1, maxElapsedMs: 10000, maxConcurrentTasks: 1 };
  const created = await post('/api/graphs', { prompt: 'Review the budgeted change', command: [process.execPath, '-e', 'process.exit(1)'], maxAttempts: 2, harness: policy });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const graph = created.body.graph, url = `/api/graphs/${graph.id}`;
  const draft = await request(`${url}/harness`);
  assert.equal(draft.status, 200);
  assert.equal(draft.body.runStatus, 'draft');
  assert.deepEqual(draft.body.policy, policy);
  assert.equal(draft.body.usage.agentAttempts, 0);
  assert.equal(draft.body.artifacts.graphId, graph.id);
  assert.equal(draft.body.artifacts.definitionHash, graph.definitionHash);
  assert.ok(Array.isArray(draft.body.events));
  assert.equal(typeof draft.body.verification, 'object');
  assert.equal((await request(`${url}/harness`, { headers: { host: `evil.example:${port}` } })).status, 403);
  assert.equal((await request(`${url}/harness`, { headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal((await request(`${url}/harness`, { method: 'POST', body: {} })).status, 403);
  assert.equal((await request('/api/graphs/00000000-0000-4000-8000-000000000000/harness')).status, 404);
  await post(`${url}/start`, { definitionHash: graph.definitionHash });
  await eventually(() => inputs.length === 1);
  entries[0].status = 'completed';
  const report = await eventually(async () => { const result = (await request(`${url}/harness`)).body; return result.runStatus !== 'running' && result.usage.agentAttempts === 1 && result; });
  assert.ok(['warning', 'error'].includes(report.status));
  assert.equal(report.runStatus, 'paused');
  assert.deepEqual(report.artifacts.jobIds, [entries[0].id]);
  assert.ok(report.next_actions.some(item => typeof item.action === 'string' && typeof item.reason === 'string' && item.reason));
  assert.equal(inputs.length, 1);
});
