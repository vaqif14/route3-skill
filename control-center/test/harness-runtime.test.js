'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { GraphManager, compilePrompt } = require('../graph-runtime');
const { normalizePolicy, recordTransition } = require('../harness-runtime');
const command = [process.execPath, '-e', 'process.exit(0)'];
const agent = id => ({ id, type: 'agent', prompt: `Implement ${id}` });
const def = (nodes, harness, edges = []) => ({ version: 1, name: 'Harness case', goal: 'Preserve the authorized scope', nodes, edges, ...(harness === undefined ? {} : { harness }) });
const flush = () => new Promise(resolve => setImmediate(resolve));
async function eventually(predicate) { const end = Date.now() + 4000; while (Date.now() < end) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); } assert.fail('Expected harness transition was not observed.'); }
function fixture(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'route3-harness-'));
  const inputs = [], jobsList = [];
  const jobs = { list: () => jobsList.map(j => ({ ...j })), start(input) { inputs.push(input); const job = { id: crypto.randomUUID(), status: 'running', summary: input.prompt, cwd: input.cwd }; jobsList.push(job); return { ...job }; }, cancel(id) { const job = jobsList.find(j => j.id === id); if (job) job.status = 'cancelled'; } };
  const manager = new GraphManager({ jobs, workspace: dir, ...options });
  t.after(() => { manager.shutdown(); fs.rmSync(dir, { recursive: true, force: true }); });
  const start = input => { const run = manager.create(input); manager.start(run.id, { definitionHash: run.definitionHash }); return run.id; };
  return { manager, dir, jobs, jobsList, inputs, start };
}

test('harness policy rejects implicit authority, invalid bounds and nonintegers', () => {
  assert.deepEqual(normalizePolicy(), { maxAgentAttempts: 120, maxElapsedMs: 3600000, maxConcurrentTasks: 2 });
  for (const value of [null, [], { allowPermissions: true }, { maxAgentAttempts: 0 }, { maxAgentAttempts: 121 }, { maxConcurrentTasks: 3 }, { maxElapsedMs: 99 }, { maxElapsedMs: 86400001 }, { maxAgentAttempts: 1.5 }]) assert.throws(() => normalizePolicy(value), /harness|integer/);
});

test('policy is bound into the reviewed graph hash and returned draft report', t => {
  const { manager } = fixture(t);
  const first = manager.create(def([agent('a')], { maxAgentAttempts: 1 })); const second = manager.create(def([agent('a')], { maxAgentAttempts: 2 }));
  assert.notEqual(first.definitionHash, second.definitionHash);
  assert.throws(() => manager.start(first.id, { definitionHash: second.definitionHash }), /definitionHash/);
  const report = manager.harnessReport(first.id);
  assert.equal(report.runStatus, 'draft'); assert.equal(report.policy.maxAgentAttempts, 1); assert.equal(report.usage.agentAttempts, 0);
  assert.equal(report.next_actions[0].action, 'review_then_start'); assert.equal(report.artifacts.definitionHash, first.definitionHash);
});

test('concurrent preparations cannot overshoot a one-attempt budget', async t => {
  const { manager, inputs, jobsList, start } = fixture(t);
  const id = start(def([agent('a'), agent('b')], { maxAgentAttempts: 1 }));
  await eventually(() => manager.get(id).status === 'paused');
  assert.equal(inputs.length, 1); assert.equal(manager.harnessReport(id).usage.agentAttempts, 1); assert.equal(manager.harnessReport(id).pauseReason, 'agent_attempt_limit');
  jobsList[0].status = 'completed'; manager.tick(); assert.equal(manager.get(id).nodes.a.status, 'succeeded');
  manager.resume(id); await flush(); assert.equal(inputs.length, 1); assert.equal(manager.get(id).status, 'paused');
});

test('attempt exhaustion still allows its verifier but prevents another model attempt', async t => {
  const { manager, jobsList, inputs, start } = fixture(t, { runCheck: () => ({ promise: Promise.resolve({ exitCode: 1 }), cancel() {} }) });
  const id = start(compilePrompt({ prompt: 'Fix scoped work', command, maxAttempts: 3, harness: { maxAgentAttempts: 1 } }));
  await eventually(() => inputs.length === 1); jobsList[0].status = 'completed'; manager.tick();
  await eventually(() => manager.get(id).status === 'paused');
  const report = manager.harnessReport(id); assert.equal(inputs.length, 1); assert.equal(report.status, 'warning'); assert.deepEqual(report.verification.checksFailed, ['work']); assert.equal(report.next_actions[0].action, 'inspect_then_cancel_or_create_revision');
});

test('wall-clock expiry is rechecked after asynchronous grounding before side effects', async t => {
  let time = Date.parse('2026-10-19T12:00:00Z'), release;
  const { manager, inputs, start } = fixture(t, { now: () => new Date(time).toISOString(), prepareJob: input => new Promise(resolve => { release = () => resolve(input); }) });
  const id = start(def([agent('a')], { maxElapsedMs: 100 })); await eventually(() => !!release); time += 101; release(); await flush();
  assert.equal(inputs.length, 0); assert.equal(manager.harnessReport(id).pauseReason, 'elapsed_time_limit'); assert.equal(manager.harnessReport(id).usage.elapsedMs, 101);
});

test('per-graph concurrency bounds preparations and admits the next task after completion', async t => {
  const { manager, jobsList, inputs, start } = fixture(t);
  const id = start(def([agent('a'), agent('b')], { maxConcurrentTasks: 1 }));
  await eventually(() => inputs.length === 1); await flush(); assert.equal(inputs.length, 1); assert.equal(manager.harnessReport(id).usage.activeTasks, 1);
  jobsList[0].status = 'completed'; manager.tick(); await eventually(() => inputs.length === 2);
});

test('reports distinguish process completion, actual checks, handled failure and unknown outcomes', async t => {
  const { manager, jobsList, inputs, start } = fixture(t);
  const id = start(def([agent('a')])); await eventually(() => inputs.length === 1); jobsList[0].status = 'completed'; manager.tick();
  const report = manager.harnessReport(id); assert.equal(report.runStatus, 'succeeded'); assert.deepEqual(report.verification.agentOnlyCompleted, ['a']); assert.deepEqual(report.verification.checksPassed, []); assert.equal(report.coverage.processCompletionIsSemanticVerification, false);
  const broken = start(def([agent('b')])); await eventually(() => inputs.length === 2); jobsList[1].status = 'interrupted'; manager.tick();
  const uncertain = manager.harnessReport(broken); assert.equal(uncertain.status, 'error'); assert.deepEqual(uncertain.verification.unknownTasks, ['b']); assert.equal(uncertain.next_actions[0].action, 'reconcile');
});

test('permission waits and cancellation surface safe next actions without decisions on behalf of user', async t => {
  const { manager, jobsList, inputs, start } = fixture(t);
  const id = start(def([agent('a')])); await eventually(() => inputs.length === 1); jobsList[0].status = 'awaiting_approval'; manager.tick();
  const report = manager.harnessReport(id); assert.equal(report.status, 'warning'); assert.equal(report.next_actions[0].action, 'review_provider_permission');
  manager.cancel(id); const cancelled = manager.harnessReport(id); assert.equal(cancelled.status, 'warning'); assert.equal(cancelled.usage.activeTasks, 0); assert.equal(cancelled.next_actions[0].action, 'inspect_jobs_and_artifacts');
  assert.equal(cancelled.next_actions.some(a => a.action === 'review_provider_permission'), false);
});

test('sanitized history is bounded and report edits cannot mutate the saved event log', t => {
  const { manager } = fixture(t); const secret = 'CONFIDENTIAL_TASK_TEXT';
  const run = manager.create(def([{ ...agent('a'), prompt: secret }]));
  for (let i = 0; i < 110; i++) manager.message(run.id, { from: 'lead', to: 'worker', body: secret });
  const snapshot = manager.get(run.id); assert.equal(snapshot.harness.events.length, 100); assert.equal(snapshot.harness.sequence, 111);
  const report = manager.harnessReport(run.id); assert.equal(report.events.length, 10); assert.equal(JSON.stringify(report).includes(secret), false);
  report.events[0].status = 'invented'; assert.notEqual(manager.harnessReport(run.id).events[0].status, 'invented');
});

test('restart retains the budget clock and attempts rather than granting a new allowance', async t => {
  let time = Date.parse('2026-10-19T12:00:00Z');
  const { manager, jobs, dir, inputs } = fixture(t); manager.shutdown(); const file = path.join(dir, 'state.json');
  const now = () => new Date(time).toISOString();
  const first = new GraphManager({ jobs, workspace: dir, file, now }); const run = first.create(def([agent('a'), agent('b')], { maxAgentAttempts: 1, maxElapsedMs: 1000 })); first.start(run.id, { definitionHash: run.definitionHash });
  await eventually(() => first.get(run.id).status === 'paused'); first.shutdown(); time += 400;
  const second = new GraphManager({ jobs, workspace: dir, file, now }); t.after(() => second.shutdown());
  const report = second.harnessReport(run.id); assert.equal(report.usage.agentAttempts, 1); assert.equal(report.usage.elapsedMs, 400); assert.equal(report.policy.maxAgentAttempts, 1);
  second.resume(run.id); await flush(); assert.equal(inputs.length, 1); assert.equal(second.get(run.id).status, 'paused');
});

test('older graph checkpoints migrate harness state without changing definition hashes', async t => {
  const { manager, jobs, dir, inputs } = fixture(t); manager.shutdown(); const file = path.join(dir, 'state.json');
  const first = new GraphManager({ jobs, workspace: dir, file }); const run = first.create(def([agent('a')])); first.start(run.id, { definitionHash: run.definitionHash }); await eventually(() => inputs.length === 1); first.shutdown();
  const data = JSON.parse(fs.readFileSync(file)); delete data.runs[0].harness; fs.writeFileSync(file, JSON.stringify(data));
  const second = new GraphManager({ jobs, workspace: dir, file }); t.after(() => second.shutdown());
  assert.equal(second.get(run.id).definitionHash, run.definitionHash); assert.equal(second.get(run.id).status, 'paused'); assert.equal(second.get(run.id).harness.startedAt, run.createdAt); assert.equal(inputs.length, 1);
});

test('corrupt harness histories fail closed instead of leaking arbitrary saved fields', t => {
  const { manager, jobs, dir } = fixture(t); manager.shutdown(); const file = path.join(dir, 'state.json');
  const first = new GraphManager({ jobs, workspace: dir, file }); first.create(def([agent('a')])); first.shutdown();
  const data = JSON.parse(fs.readFileSync(file)); data.runs[0].harness.events[0].prompt = 'untrusted extra field'; fs.writeFileSync(file, JSON.stringify(data));
  assert.throws(() => new GraphManager({ jobs, workspace: dir, file }), /harness event/);
});

test('another denied task cannot strand an already-earned verifier at the attempt limit', async t => {
  let checks = 0;
  const { manager, inputs, jobsList, start } = fixture(t, { runCheck: () => { checks++; return { promise: Promise.resolve({ exitCode: 0 }), cancel() {} }; } });
  const loop = { id: 'a', type: 'loop', prompt: 'Implement a', maxAttempts: 2, check: { command } };
  const id = start(def([loop, agent('b')], { maxAgentAttempts: 1 }));
  await eventually(() => manager.get(id).status === 'paused'); jobsList[0].status = 'completed'; manager.tick();
  await eventually(() => manager.get(id).nodes.a.status === 'succeeded');
  assert.equal(checks, 1); assert.equal(inputs.length, 1); assert.equal(manager.get(id).status, 'paused'); assert.equal(manager.get(id).nodes.b.status, 'claimed');
});

test('completed harness time freezes and persisted storage faults outrank handled-failure warnings', async t => {
  let time = Date.parse('2026-10-19T12:00:00Z');
  const { manager, start } = fixture(t, { now: () => new Date(time).toISOString(), runCheck: check => ({ promise: Promise.resolve({ exitCode: check.command[0] === 'failure' ? 1 : 0 }), cancel() {} }) });
  const id = start(def([{ id: 'first', type: 'check', command: ['failure'] }, { id: 'handler', type: 'check', command }], undefined, [{ from: 'first', to: 'handler', on: 'failure' }]));
  await eventually(() => manager.get(id).status === 'succeeded'); const elapsed = manager.harnessReport(id).usage.elapsedMs; time += 20000;
  const report = manager.harnessReport(id); assert.equal(report.usage.elapsedMs, elapsed); assert.equal(report.status, 'warning'); assert.equal(report.coverage.reportedEvents, report.events.length);
  manager.historyWarning = 'Checkpoint failed'; assert.equal(manager.harnessReport(id).status, 'error');
});

test('uncertain check report offers only reconciliation supported by the runtime', async t => {
  const { manager, start } = fixture(t, { runCheck: () => ({ promise: Promise.resolve({ exitCode: null, error: 'timeout' }), cancel() {} }) });
  const id = start(def([{ id: 'verify', type: 'check', command }])); await eventually(() => manager.get(id).status === 'blocked');
  assert.deepEqual(manager.harnessReport(id).next_actions[0].allowedActions, ['fail']);
});

test('max-team event histories fit their byte cap even across repeated recovery snapshots', t => {
  const { manager } = fixture(t); const nodes = Array.from({ length: 24 }, (_, n) => agent(`task_${n}`));
  const runs = [];
  for (let i = 0; i < 20; i++) {
    let run = manager.create(def(nodes));
    // Fresh objects model repeated recovery, when every task must be observed.
    for (let j = 0; j < 110; j++) { run = JSON.parse(JSON.stringify(run)); recordTransition(run, new Date().toISOString()); }
    assert.ok(Buffer.byteLength(JSON.stringify(run.harness.events)) <= 32768); assert.ok(run.harness.events.length < 100); runs.push(run);
  }
  assert.ok(Buffer.byteLength(JSON.stringify({ runs })) < 4 * 1024 * 1024);
});

test('normalization cannot accept a graph whose checkpoint validation would reject its size', t => {
  const { manager, jobs, dir } = fixture(t); manager.shutdown(); const file = path.join(dir, 'state.json');
  const first = new GraphManager({ jobs, workspace: dir, file });
  const input = def(Array.from({ length: 24 }, (_, n) => ({ ...agent(`task_${n}`), prompt: 'x'.repeat(1400) })), {});
  const overhead = Buffer.byteLength(JSON.stringify(input)); input.nodes[0].prompt += 'x'.repeat(35990 - overhead);
  assert.equal(Buffer.byteLength(JSON.stringify(input)), 35990); assert.throws(() => first.create(input), /Normalized graph definition/);
  input.nodes[0].prompt = 'x'; const accepted = first.create(input); first.shutdown();
  const restored = new GraphManager({ jobs, workspace: dir, file }); t.after(() => restored.shutdown()); assert.equal(restored.get(accepted.id).definitionHash, accepted.definitionHash);
});
