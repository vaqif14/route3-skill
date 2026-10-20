'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { GraphManager, compilePrompt, validateDefinition, startCheck } = require('../graph-runtime');
const command = [process.execPath, '-e', 'process.exit(0)'];
const agent = id => ({ id, type: 'agent', prompt: `Work on ${id}` });
const check = (id, code = 0) => ({ id, type: 'check', command: [process.execPath, '-e', `process.exit(${code})`] });
const definition = (nodes, edges = [], extra = {}) => ({ version: 1, name: 'Test graph', goal: 'Implement exactly the requested scope', nodes, edges, ...extra });
const receipt = exitCode => ({ exitCode, output: '', error: null, signal: null });
const flush = () => new Promise(resolve => setImmediate(resolve));
async function eventually(predicate) { const end = Date.now() + 4000; while (Date.now() < end) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); } assert.fail('Expected graph state was not reached.'); }
function fixture(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'route3-graph-runtime-'));
  const entries = [], inputs = [], cancelled = [];
  const jobs = { list: () => entries.map(j => ({ ...j })),
    start(input) { inputs.push(input); const job = { id: crypto.randomUUID(), status: 'running', summary: input.prompt, cwd: input.cwd }; entries.push(job); return { ...job }; },
    cancel(id) { cancelled.push(id); const job = entries.find(j => j.id === id); if (job) job.status = 'cancelled'; }
  };
  const manager = new GraphManager({ jobs, workspace: dir, ...options });
  t.after(() => { manager.shutdown(); fs.rmSync(dir, { force: true, recursive: true }); });
  const start = input => { const run = manager.create(input); manager.start(run.id, { definitionHash: run.definitionHash }); return run.id; };
  return { dir, jobs, entries, inputs, cancelled, manager, start };
}

test('definitions reject cycles, unbounded loops, undeclared teammates and unknown authority', () => {
  assert.throws(() => validateDefinition(definition([agent('a'), agent('b')], [{ from: 'a', to: 'b', on: 'success' }, { from: 'b', to: 'a', on: 'success' }])), /acyclic/);
  assert.throws(() => compilePrompt({ prompt: 'Work', command, maxAttempts: 6 }), /maxAttempts/);
  assert.throws(() => validateDefinition(definition([{ ...agent('a'), assignee: 'stranger' }])), /Assignee/);
  assert.throws(() => validateDefinition(definition([{ ...agent('a'), brain: { id: 'untrusted' } }])), /Unknown/);
  assert.throws(() => validateDefinition(definition([check('a')], [], { team: { lead: 'absent', members: [{ id: 'worker' }] } })), /lead/);
  assert.throws(() => compilePrompt({ prompt: 'Work', command: 'echo success' }), /argv/);
});

test('draft hash, source revision and idle ticks cannot start or repeat work', async t => {
  const { manager, inputs } = fixture(t);
  const def = compilePrompt({ prompt: 'Work', command, sourceKey: 'issue:1:revision:2' });
  const run = manager.create(def);
  assert.equal(manager.create(def).id, run.id);
  assert.throws(() => manager.create({ ...def, goal: 'Changed' }), /sourceKey/);
  assert.throws(() => manager.start(run.id, { definitionHash: 'guessed' }), /definitionHash/);
  for (let i = 0; i < 50; i++) manager.tick();
  await flush(); assert.equal(inputs.length, 0);
  manager.start(run.id, { definitionHash: run.definitionHash });
  await eventually(() => inputs.length === 1);
  assert.equal(inputs[0].taskClass, 'code');
  assert.match(inputs[0].prompt, /teammate: worker/);
});

test('loop retries only a failed deterministic check and retains attempt receipts', async t => {
  let checks = 0;
  const { manager, entries, inputs, start } = fixture(t, { runCheck: () => ({ promise: Promise.resolve(receipt(++checks === 1 ? 1 : 0)), cancel() {} }) });
  const id = start(compilePrompt({ prompt: 'Fix the change', command, maxAttempts: 2 }));
  await eventually(() => inputs.length === 1); entries[0].status = 'completed'; manager.tick();
  await eventually(() => inputs.length === 2);
  assert.match(inputs[1].prompt, /Last deterministic check/);
  entries[1].status = 'completed'; manager.tick();
  await eventually(() => manager.get(id).status === 'succeeded');
  const node = manager.get(id).nodes.work;
  assert.equal(node.attempt, 2); assert.deepEqual(node.attempts.map(a => a.check.exitCode), [1, 0]);
  for (let i = 0; i < 20; i++) manager.tick();
  assert.equal(inputs.length, 2);
});

test('attempt limit and failed agent both stop without a blind execution retry', async t => {
  const { manager, entries, inputs, start } = fixture(t, { runCheck: () => ({ promise: Promise.resolve(receipt(1)), cancel() {} }) });
  const id = start(compilePrompt({ prompt: 'Work', command, maxAttempts: 1 }));
  await eventually(() => inputs.length === 1); entries[0].status = 'completed'; manager.tick();
  await eventually(() => manager.get(id).status === 'failed');
  assert.equal(inputs.length, 1);
  const next = start(compilePrompt({ prompt: 'Other work', command, maxAttempts: 5 }));
  await eventually(() => inputs.length === 2); entries[1].status = 'failed'; manager.tick();
  assert.equal(manager.get(next).status, 'failed'); assert.equal(inputs.length, 2);
});

test('real shell-free check can read an artifact and close a bounded loop', async t => {
  const { manager, start, entries, inputs, dir } = fixture(t);
  const argv = [process.execPath, '-e', 'process.exit(require("fs").existsSync("artifact.txt") ? 0 : 1)'];
  const id = start(compilePrompt({ prompt: 'Create artifact', command: argv, maxAttempts: 2 }));
  await eventually(() => inputs.length === 1); entries[0].status = 'completed'; manager.tick();
  await eventually(() => inputs.length === 2); fs.writeFileSync(path.join(dir, 'artifact.txt'), 'verified'); entries[1].status = 'completed'; manager.tick();
  await eventually(() => manager.get(id).status === 'succeeded');
});

test('conditional branches skip inactive routes and join any waits for settled parents', async t => {
  const { manager, start, inputs } = fixture(t);
  const nodes = [check('root', 1), check('success'), check('recovery'), { ...check('join'), join: 'any' }];
  const edges = [{ from: 'root', to: 'success', on: 'success' }, { from: 'root', to: 'recovery', on: 'failure' }, { from: 'success', to: 'join', on: 'success' }, { from: 'recovery', to: 'join', on: 'success' }];
  const id = start(definition(nodes, edges));
  await eventually(() => manager.get(id).status === 'succeeded');
  const run = manager.get(id); assert.equal(run.nodes.success.status, 'skipped'); assert.equal(run.nodes.recovery.status, 'succeeded'); assert.equal(run.nodes.join.status, 'succeeded'); assert.match(run.note, /failed/); assert.equal(inputs.length, 0);
});

test('shared task claims, assignments and team messages reach the actual bounded job brief', async t => {
  const { manager, inputs } = fixture(t);
  const run = manager.create(definition([{ ...agent('a'), assignee: 'worker' }, agent('b')]));
  assert.throws(() => manager.claim(run.id, 'a', { memberId: 'lead' }), /another teammate/);
  manager.claim(run.id, 'a', { memberId: 'worker' });
  assert.throws(() => manager.claim(run.id, 'a', { memberId: 'worker' }), /available/);
  assert.throws(() => manager.claim(run.id, 'b', { memberId: 'worker' }), /already owns/);
  assert.throws(() => manager.release(run.id, 'a', { memberId: 'lead' }), /owner/);
  manager.release(run.id, 'a', { memberId: 'worker' }); manager.claim(run.id, 'a', { memberId: 'worker' });
  manager.message(run.id, { from: 'lead', to: 'worker', taskId: 'a', body: 'Preserve the API contract.' });
  manager.start(run.id, { definitionHash: run.definitionHash });
  await eventually(() => inputs.length === 2);
  assert.match(inputs[0].prompt, /Preserve the API contract/);
  assert.throws(() => manager.release(run.id, 'a', { memberId: 'worker' }), /undispatched/);
});

test('pause and cancellation during asynchronous preparation prevent a late agent launch', async t => {
  let release;
  const { manager, inputs, start } = fixture(t, { prepareJob: input => new Promise(resolve => { release = () => resolve(input); }) });
  const id = start(definition([agent('a')]));
  await eventually(() => !!release); manager.pause(id); release(); await flush();
  assert.equal(inputs.length, 0); assert.equal(manager.get(id).nodes.a.status, 'claimed');
  manager.resume(id); release = null; await eventually(() => !!release); manager.cancel(id); release(); await flush();
  assert.equal(manager.get(id).status, 'cancelled'); assert.equal(inputs.length, 0);
});

test('permission waits are preserved; failover successor is followed and cancelled', async t => {
  const { manager, entries, cancelled, inputs, start } = fixture(t);
  const id = start(definition([agent('a')])); await eventually(() => inputs.length === 1);
  entries[0].status = 'awaiting_approval'; manager.tick(); assert.equal(manager.get(id).nodes.a.status, 'awaiting_approval');
  const successor = { ...entries[0], id: crypto.randomUUID(), status: 'running' }; entries.push(successor); entries[0].status = 'failed'; entries[0].failoverTo = successor.id;
  manager.tick(); assert.equal(manager.get(id).nodes.a.jobId, successor.id);
  manager.cancel(id); assert.deepEqual(cancelled, [successor.id]);
});

test('cancelling two running tasks releases graph capacity for another run', async t => {
  const { manager, start, inputs } = fixture(t);
  const first = start(definition([agent('a'), agent('b')])); await eventually(() => inputs.length === 2); manager.cancel(first);
  start(definition([agent('next')])); await eventually(() => inputs.length === 3);
});

test('provider capacity waits for a later scheduler turn instead of spinning microtasks', async t => {
  const { manager, jobs, start } = fixture(t);
  let calls = 0; jobs.start = () => { calls++; throw Object.assign(new Error('Two jobs are already active.'), { statusCode: 409 }); };
  const id = start(definition([agent('a')])); await flush();
  assert.equal(calls, 1); assert.equal(manager.get(id).nodes.a.attempt, 0); assert.equal(manager.historyWarning, null);
  manager.tick(); await flush(); assert.equal(calls, 2);
});

test('unknown dispatch outcome blocks dependent execution; no automatic replay', async t => {
  const { manager, jobs, start } = fixture(t);
  let calls = 0; jobs.start = () => { calls++; throw new Error('Connection vanished after dispatch'); };
  const id = start(definition([agent('a'), agent('b')], [{ from: 'a', to: 'b', on: 'always' }]));
  await eventually(() => manager.get(id).status === 'blocked');
  for (let i = 0; i < 20; i++) manager.tick(); assert.equal(calls, 1);
  assert.throws(() => manager.resume(id), /reconciled/);
});

test('check commands stay inside workspace including realpath symlinks', async t => {
  const { manager, dir, start } = fixture(t);
  fs.symlinkSync(os.tmpdir(), path.join(dir, 'outside'), 'dir');
  const id = start(definition([{ ...check('a'), cwd: path.join(dir, 'outside') }, check('b')]));
  await eventually(() => manager.get(id).status === 'blocked');
  assert.equal(manager.get(id).nodes.b.status, 'pending');
});

test('check timeout, output overflow, missing executable and argv literals have explicit receipts', async t => {
  const { dir } = fixture(t);
  const timeout = await startCheck({ command: [process.execPath, '-e', 'setInterval(()=>{},1000)'], timeoutMs: 100 }, { cwd: dir }).promise;
  assert.equal(timeout.error, 'timeout');
  const flood = await startCheck({ command: [process.execPath, '-e', 'process.stdout.write("x".repeat(100000))'], timeoutMs: 1000 }, { cwd: dir }).promise;
  assert.equal(flood.error, 'output_limit'); assert.ok(flood.output.length <= 2000);
  const missing = await startCheck({ command: [path.join(dir, 'missing')], timeoutMs: 1000 }, { cwd: dir }).promise;
  assert.equal(missing.error, 'spawn_error');
  const literal = '$(touch should-not-exist); *';
  const result = await startCheck({ command: [process.execPath, '-e', 'process.stdout.write(process.argv[1])', literal], timeoutMs: 1000 }, { cwd: dir }).promise;
  assert.equal(result.output, literal); assert.equal(fs.existsSync(path.join(dir, 'should-not-exist')), false);
});

test('uncertain verification blocks instead of consuming another paid attempt', async t => {
  const { manager, start, entries, inputs } = fixture(t, { runCheck: () => ({ promise: Promise.resolve({ exitCode: null, error: 'timeout' }), cancel() {} }) });
  const id = start(compilePrompt({ prompt: 'Work', command, maxAttempts: 5 })); await eventually(() => inputs.length === 1);
  entries[0].status = 'completed'; manager.tick(); await eventually(() => manager.get(id).status === 'blocked'); assert.equal(inputs.length, 1);
});

test('durable restart preserves completed prefixes and pauses before new work', async t => {
  const { manager, dir, jobs, entries, inputs } = fixture(t);
  manager.shutdown(); const file = path.join(dir, 'state.json');
  const first = new GraphManager({ jobs, workspace: dir, file });
  const run = first.create(definition([agent('a'), agent('b')], [{ from: 'a', to: 'b', on: 'success' }]));
  first.start(run.id, { definitionHash: run.definitionHash }); await eventually(() => inputs.length === 1);
  first.pause(run.id); entries[0].status = 'completed'; first.tick(); first.shutdown();
  const restored = new GraphManager({ jobs, workspace: dir, file }); t.after(() => restored.shutdown());
  assert.equal(restored.get(run.id).status, 'paused'); assert.equal(restored.get(run.id).nodes.a.status, 'succeeded');
  await flush(); assert.equal(inputs.length, 1); restored.resume(run.id); await eventually(() => inputs.length === 2);
  assert.match(inputs[1].prompt, /Assignment:\nWork on b/); assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test('restart uncertainty requires matching intent attachment or explicit failure', async t => {
  const { manager, dir, jobs, entries, inputs } = fixture(t); manager.shutdown(); const file = path.join(dir, 'state.json');
  const first = new GraphManager({ jobs, workspace: dir, file }); const run = first.create(definition([agent('a')]));
  first.start(run.id, { definitionHash: run.definitionHash }); await eventually(() => inputs.length === 1); first.shutdown();
  const original = { ...entries[0] }; entries[0].status = 'interrupted';
  const restored = new GraphManager({ jobs, workspace: dir, file }); t.after(() => restored.shutdown());
  assert.equal(restored.get(run.id).status, 'blocked');
  assert.throws(() => restored.reconcile(run.id, { nodeId: 'a', action: 'attach', jobId: original.id, note: 'Confirmed' }), /match/);
  entries[0] = original; restored.reconcile(run.id, { nodeId: 'a', action: 'attach', jobId: original.id, note: 'Verified matching running process and saved marker' });
  assert.equal(restored.get(run.id).status, 'paused'); restored.resume(run.id); restored.tick(); assert.equal(inputs.length, 1);
  restored.cancel(run.id); restored.shutdown();
  const terminal = new GraphManager({ jobs, workspace: dir, file }); t.after(() => terminal.shutdown()); assert.equal(terminal.get(run.id).status, 'cancelled');
});

test('in-flight checks are never replayed after restart and can be explicitly failed', async t => {
  const { manager, dir, jobs } = fixture(t); manager.shutdown(); const file = path.join(dir, 'state.json');
  let checks = 0; const runCheck = () => { checks++; return { promise: new Promise(() => {}), cancel() {} }; };
  const first = new GraphManager({ jobs, workspace: dir, file, runCheck }); const run = first.create(definition([check('a')])); first.start(run.id, { definitionHash: run.definitionHash }); await flush(); first.shutdown();
  const restored = new GraphManager({ jobs, workspace: dir, file, runCheck }); t.after(() => restored.shutdown());
  assert.equal(restored.get(run.id).status, 'blocked'); assert.equal(checks, 1);
  restored.reconcile(run.id, { nodeId: 'a', action: 'fail', note: 'Cannot prove check outcome after restart' }); restored.resume(run.id); restored.tick(); assert.equal(restored.get(run.id).status, 'failed'); assert.equal(checks, 1);
});

test('exclusive checkpoints reject another owner and corrupted definitions', t => {
  const { manager, dir, jobs } = fixture(t); manager.shutdown(); const file = path.join(dir, 'state.json');
  const first = new GraphManager({ jobs, workspace: dir, file }); first.create(definition([agent('a')]));
  assert.throws(() => new GraphManager({ jobs, workspace: dir, file }), /owned/); first.shutdown();
  const data = JSON.parse(fs.readFileSync(file)); data.runs[0].definition.goal = 'tampered'; fs.writeFileSync(file, JSON.stringify(data));
  assert.throws(() => new GraphManager({ jobs, workspace: dir, file }), /mismatch/); assert.equal(fs.existsSync(file + '.lock'), false);
});

test('storage failure latches scheduling before dispatch and leaves other jobs untouched', async t => {
  const { manager, dir, jobs, inputs } = fixture(t); manager.shutdown(); const file = path.join(dir, 'state.json');
  const durable = new GraphManager({ jobs, workspace: dir, file }); t.after(() => durable.shutdown()); const run = durable.create(definition([agent('a')]));
  fs.unlinkSync(file); fs.mkdirSync(file);
  assert.throws(() => durable.start(run.id, { definitionHash: run.definitionHash }), /checkpoint/);
  durable.tick(); await flush(); assert.equal(inputs.length, 0); assert.match(durable.historyWarning, /stopped/);
});

test('disk failure cannot prevent cancellation of an already running owned job', async t => {
  const { manager, dir, jobs, inputs, cancelled } = fixture(t); manager.shutdown(); const file = path.join(dir, 'state.json');
  const durable = new GraphManager({ jobs, workspace: dir, file }); t.after(() => durable.shutdown()); const run = durable.create(definition([agent('a')])); durable.start(run.id, { definitionHash: run.definitionHash });
  await eventually(() => inputs.length === 1); fs.unlinkSync(file); fs.mkdirSync(file);
  assert.throws(() => durable.cancel(run.id), /checkpoint/); assert.equal(cancelled.length, 1); assert.equal(durable.get(run.id).status, 'cancelled');
});
