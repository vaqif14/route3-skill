'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JobManager } = require('../process-manager');
const { NightShift } = require('../night-shift');
const { TelegramBridge } = require('../telegram-bridge');

// Two fake providers: codex dies with a quota message, gemini finishes the task
// and records the brief it received.
function fixture(t, { codexScript, geminiScript } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'route3-failover-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = (name, script) => { const file = path.join(dir, name); fs.writeFileSync(file, `#!${process.execPath}\n${script}`, { mode: 0o700 }); return file; };
  const codex = write('fake-codex', codexScript || `process.stdin.resume();process.stdin.on('end',()=>{console.error('Error: usage limit reached for this billing cycle');process.exit(1);});`);
  const gemini = write('fake-gemini', geminiScript || `let i='';process.stdin.on('data',d=>i+=d);process.stdin.on('end',()=>{require('fs').writeFileSync(${JSON.stringify(path.join(dir, 'gemini-brief.txt'))},i);console.log('done');});`);
  const jobs = new JobManager({ workspace: dir, env: { PATH: '' }, commands: { codex, gemini, kimi: null, claude: null, zai: null } });
  t.after(() => jobs.shutdown());
  return { dir, jobs };
}

async function settle(jobs, predicate, ms = 4000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (predicate(jobs.list())) return; await new Promise(r => setTimeout(r, 25)); }
  assert.fail('Timed out waiting for the fake providers.');
}

test('an auto-routed job whose provider quota ended is rerun on the next provider with the same task', async t => {
  const { dir, jobs } = fixture(t);
  const A = '11111111-2222-4333-8444-555555555555';
  const first = jobs.start({ agent: 'auto', taskClass: 'code', prompt: 'Refactor the parser', brain: { id: A, title: 'Books' } });
  assert.equal(first.agent, 'codex', 'kimi is not installed, so codex is the first usable route');
  await settle(jobs, list => list.some(job => job.failoverFrom === first.id && job.status === 'completed'));
  const failed = jobs.list().find(job => job.id === first.id);
  const rerouted = jobs.list().find(job => job.failoverFrom === first.id);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.stopReason, 'provider_exhausted');
  assert.equal(failed.failoverTo, rerouted.id);
  assert.match(failed.logTail, /rerouted to Gemini CLI/);
  assert.equal(rerouted.agent, 'gemini');
  assert.deepEqual(rerouted.tried, ['codex']);
  assert.deepEqual(rerouted.brain, { id: A, title: 'Books' }, 'brain travels with the task');
  const brief = fs.readFileSync(path.join(dir, 'gemini-brief.txt'), 'utf8');
  assert.match(brief, /Route3 rerouted this task: the previous attempt on Codex[\s\S]*Check the workspace for partial changes[\s\S]*Refactor the parser$/);
  assert.match(brief, /Notebook: "Books"/);
  const codex = jobs.agents().find(agent => agent.id === 'codex');
  assert.equal(codex.status, 'exhausted');
  assert.ok(Date.parse(codex.exhaustedUntil) > Date.now());
  const next = jobs.start({ agent: 'auto', taskClass: 'code', prompt: 'Another task' });
  assert.equal(next.agent, 'gemini', 'auto-routing skips the exhausted provider');
  assert.match(next.routingReason, /codex \(exhausted\)/);
});

test('no failover for explicit provider choices, ordinary failures, or jobs that asked for approval', async t => {
  const { jobs } = fixture(t);
  const explicit = jobs.start({ agent: 'codex', taskClass: 'code', prompt: 'Explicitly on codex' });
  await settle(jobs, list => list.find(job => job.id === explicit.id).status === 'failed');
  assert.equal(jobs.list().find(job => job.id === explicit.id).failoverTo, null);
  assert.equal(jobs.list().length, 1);
  assert.equal(jobs.agents().find(agent => agent.id === 'codex').status, 'available', 'an explicit run does not put the provider on cooldown');

  const plain = fixture(t, { codexScript: `process.stdin.resume();process.stdin.on('end',()=>{console.error('SyntaxError: unexpected token');process.exit(1);});` });
  const job = plain.jobs.start({ agent: 'auto', taskClass: 'code', prompt: 'Ordinary failure' });
  await settle(plain.jobs, list => list[0].status === 'failed');
  assert.equal(plain.jobs.list().length, 1, 'a non-exhaustion failure is not rerun');
  assert.equal(plain.jobs.list()[0].failoverTo, null);
  assert.equal(job.automatic, true);

  const approved = fixture(t);
  const seen = approved.jobs.start({ agent: 'auto', taskClass: 'code', prompt: 'Asked for approval first' });
  approved.jobs.jobs.get(seen.id).approvalsSeen = true;
  await settle(approved.jobs, list => list.find(job => job.id === seen.id).status === 'failed');
  assert.equal(approved.jobs.list().length, 1, 'a job that may have had side effects is never rerun automatically');
});

test('when every provider is exhausted the chain stops with a clear note and a 409 for new auto jobs', async t => {
  const { jobs } = fixture(t, { geminiScript: `process.stdin.resume();process.stdin.on('end',()=>{console.error('429 Too Many Requests: quota exceeded');process.exit(1);});` });
  const first = jobs.start({ agent: 'auto', taskClass: 'code', prompt: 'Doomed task' });
  await settle(jobs, list => list.length === 2 && list.every(job => job.status === 'failed'));
  const second = jobs.list().find(job => job.failoverFrom === first.id);
  assert.equal(second.agent, 'gemini');
  assert.equal(second.failoverTo, null);
  assert.match(second.logTail, /failover not started: No supported installed provider is available[\s\S]*every installed provider is exhausted/);
  assert.throws(() => jobs.start({ agent: 'auto', taskClass: 'code', prompt: 'x' }), /every installed provider is exhausted/);
  jobs.exhausted.set('codex', Date.now() - 1);
  assert.equal(jobs.agents().find(agent => agent.id === 'codex').status, 'available', 'cooldown expiry restores the provider');
});

test('Night Shift and Telegram follow a rerouted job', async t => {
  const list = [];
  const manager = { list: () => list.map(job => ({ ...job })), start: () => { throw new Error('not used'); }, agents: () => [] };
  const night = new NightShift({ jobs: manager, now: () => new Date(2026, 8, 25, 23, 30), platform: 'linux' });
  t.after(() => night.shutdown());
  night.enqueue({ prompt: 'Nightly task' });
  list.push({ id: 'job-1', agent: 'codex', status: 'running', logTail: '', permissions: [] });
  manager.start = () => ({ ...list[0] });
  night.configure({ enabled: true });
  list[0].status = 'failed'; list[0].failoverTo = 'job-2';
  list.push({ id: 'job-2', agent: 'gemini', status: 'running', failoverFrom: 'job-1', logTail: 'working', permissions: [] });
  night.tick();
  const [item] = night.snapshot().report;
  assert.equal(item.jobId, 'job-2');
  assert.equal(item.status, 'running');
  assert.match(item.note, /rerouted/);

  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'route3-failover-tg-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const sent = [];
  const fetchImpl = async (url, options) => {
    const method = url.split('/').pop();
    if (method === 'sendMessage') sent.push(JSON.parse(options.body).text);
    if (method === 'getUpdates') return new Promise((resolve, reject) => { options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }); });
    return { ok: true, json: async () => ({ ok: true, result: method === 'getMe' ? { id: 1, is_bot: true, username: 'r3bot' } : method === 'getWebhookInfo' ? { url: '' } : { message_id: 1 } }) };
  };
  const bridge = new TelegramBridge({ jobs: manager, home, workspace: home, fetchImpl, monitorMs: 100000 });
  t.after(() => bridge.shutdown());
  await bridge.configure({ token: '123456789:abcdefghijklmnopqrstuvwx' });
  const { code } = bridge.pairing();
  await bridge.dispatch({ message: { text: `/pair ${code}`, date: Math.floor(Date.now() / 1000), from: { id: 7, is_bot: false }, chat: { id: 7, type: 'private' } } });
  bridge.track('job-1');
  await bridge.notifyJobs();
  assert.ok(sent.some(text => /job-1 · rerouted[\s\S]*Continuing as job-2 on gemini/.test(text)), 'the reroute is announced once');
  assert.ok(bridge.config.tracked.includes('job-2'), 'the new job is followed');
  list[1].status = 'completed';
  await bridge.notifyJobs();
  assert.ok(sent.some(text => text.startsWith('job-2 · completed')));
  assert.equal(sent.filter(text => /rerouted/.test(text)).length, 1);
});
