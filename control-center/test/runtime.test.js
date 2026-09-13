'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createServer } = require('../server');
const { JobManager, boundedCommand } = require('../process-manager');
const { Integrations, classify, observedStatus, commandFor } = require('../integrations');

function fixture(t, script) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'route3-runtime-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const command = path.join(directory, 'fake-agent');
  fs.writeFileSync(command, `#!${process.execPath}\n${script}`, { mode: 0o700 });
  return { directory, command };
}

async function eventually(fn) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) { if (fn()) return; await new Promise(resolve => setTimeout(resolve, 20)); }
  assert.fail('Timed out waiting for the fake child process.');
}

test('job argv is fixed; shell text stays on stdin; secrets redact; session ID is linked', async t => {
  const { directory, command } = fixture(t, `let input=''; process.stdin.on('data',d=>input+=d); process.stdin.on('end',()=>{console.log(JSON.stringify({argv:process.argv.slice(2),input})); console.log(JSON.stringify({type:'thread.started',thread_id:'session-123'})); console.log('api_key=private-test-value');});`);
  const manager = new JobManager({ workspace: directory, commands: { codex: command } });
  t.after(() => manager.shutdown());
  const prompt = '--dangerously-bypass-approvals-and-sandbox $(touch INJECTED) `touch ALSO_INJECTED`';
  const job = manager.start({ agent: 'codex', prompt });
  await eventually(() => manager.list()[0].status === 'completed');
  const finished = manager.list()[0];
  assert.equal(finished.id, job.id);
  assert.equal(finished.sessionId, 'session-123');
  const event = JSON.parse(finished.logTail.split('\n')[0]);
  assert.deepEqual(event.argv, ['exec', '--json', '--color', 'never', '-']);
  assert.ok(event.input.endsWith(prompt));
  assert.equal(fs.existsSync(path.join(directory, 'INJECTED')), false);
  assert.equal(finished.logTail.includes('private-test-value'), false);
});

test('jobs enforce concurrency, cancellation and real project boundary', async t => {
  const { directory, command } = fixture(t, 'setInterval(()=>{},1000);');
  const manager = new JobManager({ workspace: directory, commands: { codex: command } });
  t.after(() => manager.shutdown());
  assert.throws(() => manager.start({ agent: 'codex', prompt: 'test', cwd: os.tmpdir() }), /inside the configured workspace/);
  fs.symlinkSync(os.tmpdir(), path.join(directory, 'outside'));
  assert.throws(() => manager.start({ agent: 'codex', prompt: 'test', cwd: path.join(directory, 'outside') }), /inside the configured workspace/);
  const one = manager.start({ agent: 'codex', prompt: 'one' });
  manager.start({ agent: 'codex', prompt: 'two' });
  assert.throws(() => manager.start({ agent: 'codex', prompt: 'three' }), /Two jobs/);
  assert.equal(manager.cancel(one.id).status, 'cancelled');
  await eventually(() => manager.jobs.get(one.id).endedAt);
  assert.equal(manager.children.size, 1);
});

test('timeout and output limits terminate jobs instead of accumulating indefinitely', async t => {
  const { directory, command } = fixture(t, "console.log('x'.repeat(3000)); setInterval(()=>{},1000);");
  const manager = new JobManager({ workspace: directory, commands: { codex: command }, maxOutputBytes: 1000 });
  t.after(() => manager.shutdown());
  manager.start({ agent: 'codex', prompt: 'test' });
  await eventually(() => manager.list()[0].endedAt);
  assert.equal(manager.list()[0].status, 'output_limit');
  const limited = await boundedCommand(command, [], { timeoutMs: 50 });
  assert.equal(limited.error, 'timeout');
});

test('automatic route follows class and installed capabilities without billing probes', async t => {
  const { directory, command } = fixture(t, "process.stdin.resume(); process.stdin.on('end',()=>process.exit(0));");
  const manager = new JobManager({ workspace: directory, commands: { codex: command, gemini: command, kimi: null, zai: null } });
  t.after(() => manager.shutdown());
  const code = manager.start({ agent: 'auto', taskClass: 'code', prompt: 'test' });
  assert.equal(code.agent, 'codex');
  assert.match(code.routingReason, /kimi \(unavailable\)/);
  const design = manager.start({ agent: 'auto', taskClass: 'design', prompt: 'test' });
  assert.equal(design.agent, 'gemini');
  assert.equal(design.model, null);
});

test('integration status remains honest, has fixed commands and classifies failures', async () => {
  const calls = [];
  const integrations = new Integrations({ command: '/fake/openclaw', run: async (command, args) => {
    calls.push({ command, args });
    return { code: 0, error: null, output: JSON.stringify({ running: false }) };
  } });
  assert.equal(integrations.snapshot().browser.status, 'unchecked');
  assert.equal((await integrations.action('browser', 'status')).status, 'stopped');
  assert.deepEqual(calls[0].args, ['browser', '--json', 'status']);
  assert.equal((await integrations.action('browser', 'start')).status, 'unknown');
  assert.deepEqual(commandFor('telegram', 'stop'), ['gateway', 'call', 'channels.stop', '--params', '{"channel":"telegram"}', '--json']);
  await assert.rejects(integrations.action('telegram', 'send'), /Unsupported/);
  await assert.rejects(integrations.action('__proto__', 'status'), /Unsupported/);
  assert.equal(classify({ code: 1, output: 'token mismatch' }), 'auth_error');
  assert.equal(classify({ code: 1, output: 'ECONNREFUSED' }), 'offline');
  assert.equal(classify({ code: null, error: 'timeout', output: '' }), 'timeout');
  assert.equal(observedStatus('openclaw', { service: { runtime: { status: 'running' } }, rpc: { ok: false } }), 'degraded');
  assert.equal(observedStatus('telegram', { channelAccounts: { telegram: [{ accountId: 'default', running: true }] } }), 'running');
  const failure = new Integrations({ command: '/fake', run: async () => ({ code: 1, output: 'api_key=should-never-escape unauthorized' }) });
  assert.equal((await failure.action('openclaw', 'status')).message.includes('should-never-escape'), false);
});

test('HTTP protects Host, Origin, CSRF and confines static file access', async t => {
  const { directory, command } = fixture(t, "process.stdin.resume(); process.stdin.on('end',()=>process.exit(0));");
  let collections = 0;
  const server = createServer({ workspace: directory, publicDir: directory, jobOptions: { commands: { codex: command } }, integrationOptions: { command: null }, collectTelemetry: async () => { collections++; return { sessions: [], summary: { totalTokens: 123 }, warnings: [] }; } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.route3.shutdown(); server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const port = server.address().port;
  const request = (url, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: url, method, headers }, res => {
      let text = ''; res.on('data', chunk => text += chunk); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(text) }));
    });
    req.on('error', reject); req.end(body === undefined ? undefined : JSON.stringify(body));
  });
  assert.equal((await request('/api/health')).body.service, 'route3-control-center');
  assert.equal((await request('/api/state', { headers: { Host: `evil.example:${port}` } })).status, 403);
  assert.equal((await request('/api/bootstrap', { headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await request('/api/bootstrap', { headers: { Origin: 'null' } })).status, 403);
  const token = (await request('/api/bootstrap')).body.token;
  const headers = { 'Content-Type': 'application/json', 'X-Route3-Token': token, Origin: `http://127.0.0.1:${port}` };
  assert.equal((await request('/api/jobs', { method: 'POST', body: {} })).status, 403);
  assert.equal((await request('/api/jobs', { method: 'POST', headers: { ...headers, Origin: 'https://evil.example' }, body: {} })).status, 403);
  assert.equal((await request('/api/jobs', { method: 'POST', headers: { ...headers, 'X-Route3-Token': 'wrong' }, body: {} })).status, 403);
  assert.equal((await request('/api/jobs', { method: 'POST', headers, body: { agent: 'codex', prompt: 'test' } })).status, 202);
  assert.equal((await request('/api/jobs', { method: 'POST', headers, body: { agent: 'codex', prompt: 'x'.repeat(41000) } })).status, 413);
  assert.equal((await request('/../../etc/passwd')).status, 404);
  assert.equal((await request('/api/state')).body.summary.totalTokens, 123);
  await request('/api/state');
  assert.equal(collections, 1);
});
