'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { JobManager } = require('../process-manager');
const { AcpAgent } = require('../acp');

// A fake ACP agent: full JSON-RPC handshake, one permission request, an
// unknown capability probe, and a witness file proving which decision
// actually reached the agent process. No model call ever happens.
const FAKE_SERVER = `
'use strict';
const fs = require('node:fs');
const witness = process.env.ROUTE3_ACP_WITNESS;
const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
process.stdout.write('plain boot log line, not JSON-RPC\\n');
let prompt = null;
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf('\\n')) >= 0) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    if (line.trim()) handle(line);
  }
});
process.stdin.on('end', () => process.exit(0));
function handle(line) {
  let message; try { message = JSON.parse(line); } catch { return; }
  if (message.method === 'initialize') return send({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: 1, agentCapabilities: { loadSession: false }, authMethods: [] } });
  if (message.method === 'initialized') return send({ jsonrpc: '2.0', id: 77, method: 'workspace/unknownCapability', params: {} });
  if (message.id === 77 && message.error) return send({ jsonrpc: '2.0', method: 'session/update', params: { update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Unknown request answered.' } } } });
  if (message.method === 'session/new') return send({ jsonrpc: '2.0', id: message.id, result: { sessionId: 'acp-session-1' } });
  if (message.method === 'session/prompt') {
    prompt = message;
    send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: message.params.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Working. api_key=private-acp-value' } } } });
    send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: message.params.sessionId, update: { sessionUpdate: 'tool_call', toolCallId: 't1', title: 'Edit src/app.js', kind: 'edit', status: 'pending' } } });
    return send({ jsonrpc: '2.0', id: 42, method: 'session/request_permission', params: { sessionId: message.params.sessionId, options: [{ optionId: 'allow_once', kind: 'allow_once', name: 'Allow once' }, { optionId: 'reject_once', kind: 'reject_once', name: 'Reject once' }], toolCall: { toolCallId: 't1', title: 'Edit src/app.js', kind: 'edit' } } });
  }
  if (message.id === 42 && message.result) {
    const outcome = message.result.outcome || {};
    fs.writeFileSync(witness, JSON.stringify(outcome));
    const stopReason = outcome.outcome === 'cancelled' ? 'cancelled' : 'end_turn';
    if (stopReason === 'end_turn') send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: prompt.params.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Finished.' } } } });
    send({ jsonrpc: '2.0', id: prompt.id, result: { stopReason } });
    prompt = null;
    return process.exit(0);
  }
  if (message.method === 'session/cancel') {
    send({ jsonrpc: '2.0', id: message.id, result: {} });
    if (prompt) { send({ jsonrpc: '2.0', id: prompt.id, result: { stopReason: 'cancelled' } }); prompt = null; }
    process.exit(0);
  }
}
`;

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'route3-acp-test-'));
  t.after(() => { delete process.env.ROUTE3_ACP_WITNESS; fs.rmSync(directory, { recursive: true, force: true }); });
  const command = path.join(directory, 'fake-kimi-acp');
  fs.writeFileSync(command, `#!${process.execPath}\n${FAKE_SERVER}\n`, { mode: 0o700 });
  const witness = path.join(directory, 'witness.json');
  process.env.ROUTE3_ACP_WITNESS = witness;
  return { directory, command, witness };
}

async function eventually(fn) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    let value;
    try { value = fn(); } catch { value = null; }
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.fail('Timed out waiting for the fake ACP agent.');
}

test('kimi jobs run through ACP and surface tool approvals in the panel', async t => {
  const { directory, command, witness } = fixture(t);
  const manager = new JobManager({ workspace: directory, commands: { kimi: command, zai: null } });
  t.after(() => manager.shutdown());
  const started = manager.start({ agent: 'kimi', prompt: 'improve the readme' });
  assert.equal(started.agent, 'kimi');
  const job = manager.jobs.get(started.id);
  await eventually(() => job.status === 'awaiting_approval' ? job : null);
  assert.equal(job.sessionId, 'acp-session-1');
  assert.equal(job.permissions.length, 1);
  assert.equal(job.permissions[0].title, 'Edit src/app.js');
  assert.deepEqual(job.permissions[0].options.map(option => option.optionId), ['allow_once', 'reject_once']);
  const decided = manager.respondPermission(started.id, { requestId: '42', optionId: 'allow_once' });
  assert.equal(decided.permissions.length, 0);
  assert.equal(decided.status, 'running');
  await eventually(() => job.status === 'completed' ? job : null);
  assert.equal(job.stopReason, 'end_turn');
  assert.ok(job.logTail.includes('Working.'));
  assert.ok(job.logTail.includes('Edit src/app.js · edit · pending'));
  assert.ok(job.logTail.includes('Finished.'));
  assert.equal(job.logTail.includes('private-acp-value'), false);
  const outcome = JSON.parse(fs.readFileSync(witness, 'utf8'));
  assert.deepEqual(outcome, { outcome: 'selected', optionId: 'allow_once' });
  assert.throws(() => manager.respondPermission(started.id, { requestId: '42', optionId: 'allow_once' }), /No active approval request/);
});

test('permission decisions are validated and cancellation denies open requests', async t => {
  const { directory, command, witness } = fixture(t);
  const manager = new JobManager({ workspace: directory, commands: { kimi: command } });
  t.after(() => manager.shutdown());
  const started = manager.start({ agent: 'kimi', prompt: 'test' });
  const job = manager.jobs.get(started.id);
  await eventually(() => job.status === 'awaiting_approval' ? job : null);
  assert.throws(() => manager.respondPermission(started.id, { requestId: 'missing', optionId: 'allow_once' }), /No active approval request/);
  assert.throws(() => manager.respondPermission(started.id, { requestId: '42', optionId: 'allow_forever' }), /offered approval options/);
  assert.throws(() => manager.respondPermission('00000000-0000-4000-8000-000000000000', { requestId: '42' }), /Job not found/);
  const cancelled = manager.cancel(started.id);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.permissions.length, 0);
  await eventually(() => job.endedAt ? job : null);
  assert.equal(job.status, 'cancelled');
  const outcome = JSON.parse(fs.readFileSync(witness, 'utf8'));
  assert.equal(outcome.outcome, 'cancelled');
});

test('ACP client answers unknown server requests instead of hanging the agent', async t => {
  const { directory, command } = fixture(t);
  const events = [];
  const replies = [];
  const agent = new AcpAgent({
    command, cwd: directory,
    spawnFn: (file, args, options) => {
      const child = spawn(file, args, options);
      const write = child.stdin.write.bind(child.stdin);
      child.stdin.write = value => { replies.push(String(value).trim()); return write(value); };
      return child;
    },
    onEvent: event => events.push(event),
  });
  t.after(() => agent.dispose());
  const turn = agent.start('hello');
  await eventually(() => events.some(event => event.type === 'permission') ? events : null);
  const permission = events.find(event => event.type === 'permission');
  assert.equal(permission.requestId, '42');
  await eventually(() => replies.some(line => line.includes('"id":77') && line.includes('-32601')) ? replies : null);
  agent.respondPermission('42', null);
  const result = await turn;
  assert.equal(result.stopReason, 'cancelled');
  assert.ok(replies.some(line => line.includes('"outcome":"cancelled"')));
});
