'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { createServer } = require('../server');
const { main } = require('../cli');

const CLI = path.join(__dirname, '../cli.js');
const BIN = path.join(__dirname, '../../bin/route3-skill.js');
const check = [process.execPath, '-e', 'process.exit(0)'];
function cli(port, args, stdin, file = CLI) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [file, ...args, '--port', String(port)], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => stdout += data); child.stderr.on('data', data => stderr += data);
    const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
    child.on('close', code => { clearTimeout(timer); const parse = value => { try { return JSON.parse(value); } catch { return value; } }; resolve({ code, out: parse(stdout), err: parse(stderr) }); });
    child.stdin.end(stdin);
  });
}
async function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'route3-graph-cli-'));
  const entries = [], inputs = [];
  const jobs = { agents: () => [], list: () => entries.map(job => ({ ...job })), shutdown() {}, start(input) {
    inputs.push(input); const job = { id: crypto.randomUUID(), status: 'awaiting_approval', permissions: [{ requestId: 'request', options: [{ optionId: 'allow-once' }] }], summary: input.prompt, agent: input.agent || 'auto', cwd: input.cwd || home };
    entries.push(job); return { ...job };
  }, cancel(id) { const job = entries.find(item => item.id === id); job.status = 'cancelled'; return { ...job }; } };
  const server = createServer({ home, workspace: home, jobs, notebookOptions: { command: null }, graphOptions: { tickMs: 10 }, integrationOptions: { command: null }, collectTelemetry: async () => ({ sessions: [], warnings: [] }) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await server.route3.shutdown(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(home, { recursive: true, force: true }); });
  return { home, server, entries, inputs, port: server.address().port };
}

test('graph CLI rejects missing verification, malformed sources, unreviewed start and invalid waits locally', async () => {
  const cases = [
    ['graphs', 'create', '--prompt', 'Review task'],
    ['graphs', 'create', '--prompt', 'Review task', '--check-argv', '"echo"'],
    ['graphs', 'create', '--prompt', 'Review task', '--check-argv', '[1]'],
    ['graphs', 'create', '--prompt', 'Review task', '--check-argv', '["echo"]', '--attempts', '6'],
    ['graphs', 'create', '--file'],
    ['graphs', 'create', '--from-stdin', '--agent', 'codex'],
    ['graphs', 'create', '--from-stdin', '--prompt', 'conflict'],
    ['graphs', 'start', 'some-id'],
    ['graphs', 'start', 'some-id', '--hash'],
    ['graphs', 'wait', 'some-id', '--timeout', 'NaN'],
    ['graphs', 'reconcile', 'some-id', '--node', 'work', '--action', 'retry'],
    ['graphs', 'reconcile', 'some-id', '--action', 'fail', '--node'],
    ['graphs', 'reconcile', 'some-id', '--node', 'work', '--action', 'attach'],
    ['graphs', 'claim', 'some-id', '--node', 'work'],
    ['graphs', 'release', 'some-id', '--member', 'worker'],
    ['graphs', 'message', 'some-id', '--from', 'lead', '--to', 'team'],
    ['harness', 'report']
  ];
  for (const args of cases) assert.equal((await cli(1, args)).code, 2, args.join(' '));
  assert.equal((await cli(1, ['graphs', 'create', '--from-stdin'], '{bad')).code, 2);
  assert.equal((await cli(1, ['graphs', 'create', '--from-stdin'], '[]')).code, 2);
  assert.equal((await cli(1, ['graphs', 'list'])).code, 3);
  assert.equal((await cli(1, ['harness', 'report', 'some-id'])).code, 3);
});

test('graph CLI and package binary create, review, start and wait for explicit checks', async t => {
  const { home, port, inputs } = await fixture(t);
  const definition = { version: 1, harness: { maxAgentAttempts: 2, maxElapsedMs: 10000, maxConcurrentTasks: 1 }, name: 'CLI check', goal: 'Check local changes', nodes: [{ id: 'check', type: 'check', command: check }], edges: [] };
  const file = path.join(home, 'graph.json'); fs.writeFileSync(file, JSON.stringify(definition));
  const created = await cli(port, ['graphs', 'create', '--file', file]);
  assert.equal(created.code, 0, JSON.stringify(created.err));
  const graph = created.out.graph;
  assert.equal(graph.status, 'draft'); assert.equal(inputs.length, 0);
  assert.equal((await cli(port, ['graphs', 'show', graph.id])).out.graph.definitionHash, graph.definitionHash);
  assert.equal((await cli(port, ['graphs', 'list'], undefined, BIN)).out.graphs[0].id, graph.id);
  assert.equal((await cli(port, ['graphs', 'start', graph.id, '--hash', 'wrong'])).code, 4);
  assert.equal((await cli(port, ['graphs', 'start', graph.id, '--hash', graph.definitionHash])).code, 0);
  const waited = await main(['graphs', 'wait', graph.id, '--port', String(port), '--timeout', '4'], { pollMs: 10 });
  assert.equal(waited.graph.status, 'succeeded');
  const report = await cli(port, ['harness', 'report', graph.id], undefined, BIN);
  assert.equal(report.code, 0, JSON.stringify(report.err));
  assert.equal(report.out.status, 'success');
  assert.deepEqual(report.out.policy, definition.harness);
  assert.equal(report.out.artifacts.graphId, graph.id);
  const stdin = await cli(port, ['graphs', 'create', '--from-stdin'], JSON.stringify(definition));
  assert.equal(stdin.code, 0); assert.notEqual(stdin.out.graph.id, graph.id);
});

test('prompt shortcut preserves argv and bounded attempts; provider approval stays pending', async t => {
  const { port, inputs, entries } = await fixture(t);
  const created = await cli(port, ['graphs', 'create', '--prompt-stdin', '--check-argv', JSON.stringify(check), '--attempts', '2', '--agent', 'codex', '--class', 'planning'], 'Review pending work');
  assert.equal(created.code, 0, JSON.stringify(created.err));
  const graph = created.out.graph;
  assert.equal(graph.definition.nodes[0].maxAttempts, 2);
  assert.deepEqual(graph.definition.nodes[0].check.command, check);
  await cli(port, ['graphs', 'start', graph.id, '--hash', graph.definitionHash]);
  const waited = await main(['graphs', 'wait', graph.id, '--port', String(port), '--timeout', '4'], { pollMs: 10 });
  assert.match(waited.note, /provider approval/);
  assert.equal(entries.length, 1); assert.equal(entries[0].status, 'awaiting_approval');
  assert.equal(inputs[0].taskClass, 'planning'); assert.equal(inputs[0].agent, 'codex');
  assert.equal((await cli(port, ['graphs', 'pause', graph.id])).out.graph.status, 'paused');
  assert.equal((await cli(port, ['graphs', 'wait', graph.id])).out.graph.status, 'paused');
  assert.equal((await cli(port, ['graphs', 'resume', graph.id])).out.graph.status, 'running');
  assert.equal((await cli(port, ['graphs', 'cancel', graph.id])).out.graph.status, 'cancelled');
  const rejected = await cli(port, ['graphs', 'reconcile', graph.id, '--node', graph.definition.nodes[0].id, '--action', 'fail', '--note', 'Operator checked the outcome']);
  assert.equal(rejected.code, 4);
});

test('team CLI exposes shared tasks, ownership and task-scoped messages', async t => {
  const { port, inputs } = await fixture(t);
  const definition = { version: 1, name: 'Team CLI', goal: 'Coordinate local work', team: { lead: 'lead', members: [
    { id: 'lead', agent: 'codex', taskClass: 'planning' }, { id: 'worker', agent: 'codex', taskClass: 'code' }
  ] }, nodes: [{ id: 'work', type: 'agent', prompt: 'Review the shared task' }], edges: [] };
  const created = await cli(port, ['graphs', 'create', '--from-stdin'], JSON.stringify(definition));
  assert.equal(created.code, 0, JSON.stringify(created.err));
  const id = created.out.graph.id;
  const members = await cli(port, ['graphs', 'members', id]);
  assert.equal(members.out.lead, 'lead');
  assert.deepEqual(members.out.members.map(member => member.id), ['lead', 'worker']);
  const claimed = await cli(port, ['graphs', 'claim', id, '--node', 'work', '--member', 'worker']);
  assert.equal(claimed.code, 0, JSON.stringify(claimed.err));
  const tasks = await cli(port, ['graphs', 'tasks', id]);
  assert.equal(tasks.out.tasks[0].id, 'work');
  assert.equal(tasks.out.tasks[0].claim.memberId, 'worker');
  const message = await cli(port, ['graphs', 'message', id, '--from', 'lead', '--to', 'worker', '--task', 'work', '--text-stdin'], 'Review the dependencies before editing.');
  assert.equal(message.code, 0, JSON.stringify(message.err));
  const messages = await cli(port, ['graphs', 'messages', id]);
  assert.equal(messages.out.messages.at(-1).body, 'Review the dependencies before editing.');
  assert.equal(messages.out.messages.at(-1).taskId, 'work');
  assert.equal((await cli(port, ['graphs', 'release', id, '--node', 'work', '--member', 'lead'])).code, 4);
  assert.equal((await cli(port, ['graphs', 'release', id, '--node', 'work', '--member', 'worker'])).code, 0);
  assert.equal(inputs.length, 0);
});

test('source revision keys deduplicate prompt triggers without dispatching work', async t => {
  const { port, inputs } = await fixture(t);
  const args = ['graphs', 'create', '--prompt', 'Review source revision', '--check-argv', JSON.stringify(check), '--source-key', 'ticket-22@revision-1'];
  const first = await cli(port, args), repeated = await cli(port, args);
  assert.equal(first.code, 0, JSON.stringify(first.err));
  assert.equal(repeated.out.graph.id, first.out.graph.id);
  assert.equal(first.out.graph.definition.sourceKey, 'ticket-22@revision-1');
  const changed = [...args]; changed[changed.indexOf('Review source revision')] = 'Review changed work';
  assert.equal((await cli(port, changed)).code, 4);
  assert.equal(inputs.length, 0);
});

test('harness prompt policy options reject invalid integers and JSON overrides before contacting the server', async () => {
  for (const flag of ['max-agent-attempts', 'max-elapsed-ms', 'max-concurrent-tasks']) {
    for (const value of ['0', '-1', '1.5', 'NaN']) {
      const result = await cli(1, ['graphs', 'create', '--prompt', 'Review the task', '--check-argv', JSON.stringify(check), `--${flag}`, value]);
      assert.equal(result.code, 2, `${flag}=${value}`);
    }
    assert.equal((await cli(1, ['graphs', 'create', '--prompt', 'Review the task', '--check-argv', JSON.stringify(check), `--${flag}`])).code, 2);
    assert.equal((await cli(1, ['graphs', 'create', '--from-stdin', `--${flag}`, '1'], '{}')).code, 2);
  }
});

test('harness CLI reports an exhausted prompt policy and preserves server-side policy bounds', async t => {
  const { port, inputs, entries, server } = await fixture(t);
  const created = await cli(port, ['graphs', 'create', '--prompt', 'Review bounded work', '--check-argv', JSON.stringify([process.execPath, '-e', 'process.exit(1)']), '--attempts', '2', '--max-agent-attempts', '1', '--max-elapsed-ms', '10000', '--max-concurrent-tasks', '1']);
  assert.equal(created.code, 0, JSON.stringify(created.err));
  const graph = created.out.graph;
  const draft = await cli(port, ['harness', 'report', graph.id]);
  assert.deepEqual(draft.out.policy, { maxAgentAttempts: 1, maxElapsedMs: 10000, maxConcurrentTasks: 1 });
  assert.equal((await cli(port, ['harness', 'report', '00000000-0000-4000-8000-000000000000'])).code, 4);
  assert.equal((await cli(port, ['graphs', 'create', '--prompt', 'Review invalid bounds', '--check-argv', JSON.stringify(check), '--max-concurrent-tasks', '3'])).code, 4);
  await cli(port, ['graphs', 'start', graph.id, '--hash', graph.definitionHash]);
  assert.equal(entries.length, 1);
  entries[0].status = 'completed';
  const deadline = Date.now() + 4000;
  while (server.route3.graphs.get(graph.id).status === 'running' && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  const report = await cli(port, ['harness', 'report', graph.id], undefined, BIN);
  assert.equal(report.code, 0, JSON.stringify(report.err));
  assert.equal(report.out.runStatus, 'paused');
  assert.ok(['warning', 'error'].includes(report.out.status));
  assert.equal(report.out.usage.agentAttempts, 1);
  assert.deepEqual(report.out.artifacts.jobIds, [entries[0].id]);
  assert.ok(report.out.next_actions.length);
  assert.equal(inputs.length, 1);
});
