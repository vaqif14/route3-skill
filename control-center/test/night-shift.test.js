'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { NightShift, inWindow, MAX_ITEMS } = require('../night-shift');
const { createServer } = require('../server');

const at = hhmm => { const [h, m] = hhmm.split(':').map(Number); return new Date(2026, 8, 25, h, m); };

// A JobManager stand-in: records starts and lets a test move jobs between states.
function fakeJobs() {
  const jobs = [];
  return {
    started: [], cancelled: [], approvals: [], failNext: null,
    list: () => jobs.map(job => ({ ...job })),
    start(input) {
      if (this.failNext) { const error = this.failNext; this.failNext = null; throw error; }
      const job = { id: crypto.randomUUID(), agent: 'kimi', status: 'running', startedAt: new Date().toISOString(), endedAt: null, logTail: 'step 1\nstep 2', permissions: [] };
      jobs.push(job); this.started.push(input);
      return { ...job };
    },
    cancel(id) { this.cancelled.push(id); },
    respondPermission(id, body) { this.approvals.push({ id, body }); },
    set(id, patch) { Object.assign(jobs.find(job => job.id === id), patch); },
    last: () => jobs[jobs.length - 1],
  };
}

function shift(t, options = {}) {
  const clock = { now: at(options.time || '23:30') };
  const awake = { started: 0, killed: 0 };
  const jobs = options.jobs || fakeJobs();
  const night = new NightShift({ jobs, file: options.file || null, now: () => clock.now, platform: options.platform || 'darwin',
    keepAwake: () => { awake.started++; return { on() {}, kill() { awake.killed++; } }; } });
  t.after(() => night.shutdown());
  return { night, jobs, clock, awake };
}

test('window crosses midnight and start === end never opens', () => {
  const overnight = { start: '23:00', end: '07:00' };
  assert.equal(inWindow(overnight, at('23:00')), true);
  assert.equal(inWindow(overnight, at('03:15')), true);
  assert.equal(inWindow(overnight, at('07:00')), false);
  assert.equal(inWindow(overnight, at('12:00')), false);
  const daytime = { start: '13:00', end: '14:00' };
  assert.equal(inWindow(daytime, at('13:59')), true);
  assert.equal(inWindow(daytime, at('14:00')), false);
  assert.equal(inWindow({ start: '05:00', end: '05:00' }, at('05:00')), false);
});

test('disabled shift never starts work, even inside the window', t => {
  const { night, jobs } = shift(t);
  night.enqueue({ prompt: 'Fix the flaky login test' });
  night.tick();
  assert.equal(jobs.started.length, 0);
});

test('runs queued tasks one at a time, in order, with automatic routing', t => {
  const { night, jobs } = shift(t);
  night.enqueue({ prompt: 'First task', taskClass: 'code' });
  night.enqueue({ prompt: 'Second task', taskClass: 'planning' });
  night.configure({ enabled: true });
  assert.equal(jobs.started.length, 1);
  assert.deepEqual(jobs.started[0], { agent: 'auto', prompt: 'First task', taskClass: 'code', expert: undefined, brain: undefined });
  night.tick();
  assert.equal(jobs.started.length, 1, 'second must wait while the first runs');
  jobs.set(jobs.last().id, { status: 'completed', endedAt: new Date().toISOString() });
  night.tick();
  assert.equal(jobs.started.length, 2);
  assert.equal(jobs.started[1].prompt, 'Second task');
  const report = night.snapshot().report;
  assert.equal(report[0].status, 'done');
  assert.equal(report[0].agent, 'kimi');
  assert.match(report[0].tail, /step 2/);
});

test('approval requests are never answered by the shift; they do not block the queue', t => {
  const { night, jobs } = shift(t);
  night.enqueue({ prompt: 'Task needing approval' });
  night.enqueue({ prompt: 'Next task' });
  night.configure({ enabled: true });
  jobs.set(jobs.last().id, { status: 'awaiting_approval', permissions: [{ requestId: 'r1' }] });
  night.tick();
  assert.equal(jobs.approvals.length, 0);
  assert.equal(night.snapshot().report[0].status, 'awaiting_approval');
  assert.equal(night.snapshot().report[0].pendingApprovals, 1);
  assert.equal(jobs.started.length, 2, 'the next task may use the free job slot');
});

test('nothing new starts after the window closes and running jobs are not killed', t => {
  const { night, jobs, clock, awake } = shift(t);
  night.enqueue({ prompt: 'Long task' });
  night.enqueue({ prompt: 'Later task' });
  night.configure({ enabled: true });
  assert.equal(awake.started, 1, 'keeps the Mac awake while work is pending in the window');
  clock.now = at('07:05');
  jobs.set(jobs.last().id, { status: 'completed' });
  night.tick();
  assert.equal(jobs.started.length, 1);
  assert.equal(jobs.cancelled.length, 0);
  assert.equal(awake.killed, 1, 'stops keeping the Mac awake outside the window');
  assert.equal(night.snapshot().queue.length, 1);
});

test('failed jobs, start errors and a full job slot are reported, not retried blindly', t => {
  const { night, jobs } = shift(t);
  night.enqueue({ prompt: 'Will fail' });
  night.configure({ enabled: true });
  jobs.set(jobs.last().id, { status: 'output_limit' });
  night.tick();
  assert.equal(night.snapshot().report[0].status, 'failed');
  assert.equal(night.snapshot().report[0].note, 'output_limit');

  jobs.failNext = Object.assign(new Error('Two jobs are already active. Wait or cancel one.'), { statusCode: 409 });
  night.enqueue({ prompt: 'Waits for a slot' });
  night.tick();
  assert.equal(night.snapshot().queue[0].note, 'waiting for a free job slot');
  night.tick();
  assert.equal(night.snapshot().queue.length, 0, 'started once a slot freed');

  jobs.set(jobs.last().id, { status: 'completed' });
  jobs.failNext = Object.assign(new Error('Unknown expert. Create it in the Experts view first.'), { statusCode: 400 });
  night.enqueue({ prompt: 'Bad expert', expert: 'missing' });
  night.tick();
  const bad = night.snapshot().report.find(item => item.prompt === 'Bad expert');
  assert.equal(bad.status, 'failed');
  assert.match(bad.note, /Unknown expert/);
});

test('no keep-awake off macOS and none when the queue is empty', t => {
  const linux = shift(t, { platform: 'linux' });
  linux.night.enqueue({ prompt: 'Task' });
  linux.night.configure({ enabled: true });
  assert.equal(linux.awake.started, 0);
  const idle = shift(t);
  idle.night.configure({ enabled: true });
  assert.equal(idle.awake.started, 0);
});

test('validation: times, prompt size, task class and queue cap', t => {
  const { night } = shift(t);
  assert.throws(() => night.configure({ start: '24:00' }), /HH:MM/);
  assert.throws(() => night.configure({ start: '7:00' }), /HH:MM/);
  assert.throws(() => night.configure({ start: '06:00', end: '06:00' }), /must differ/);
  assert.throws(() => night.enqueue({ prompt: 'x' }), /3–32768/);
  assert.throws(() => night.enqueue({ prompt: 'x'.repeat(32769) }), /3–32768/);
  assert.throws(() => night.enqueue({ prompt: 'Valid task', taskClass: 'deploy' }), /Task class/);
  for (let i = 0; i < MAX_ITEMS; i++) night.enqueue({ prompt: `Task ${i}` });
  assert.throws(() => night.enqueue({ prompt: 'One too many' }), /at most 20/);
});

test('state persists privately and survives restart; corrupt state is not trusted', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'route3-night-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'state', 'night.json');
  const first = shift(t, { file });
  first.night.configure({ enabled: false, start: '22:30', end: '06:00' });
  first.night.enqueue({ prompt: 'Survives restart' });
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  const second = shift(t, { file });
  assert.deepEqual(second.night.snapshot().schedule, { enabled: false, start: '22:30', end: '06:00' });
  assert.equal(second.night.snapshot().queue[0].prompt, 'Survives restart');
  fs.writeFileSync(file, '{"version":1,"items":');
  const third = shift(t, { file });
  assert.equal(third.night.snapshot().queue.length, 0);
  assert.match(third.night.snapshot().warning, /could not be read/);
});

test('HTTP: night shift endpoints require the session token and show in state', async t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'route3-night-home-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const server = createServer({ workspace: home, home, publicDir: home, integrationOptions: { command: null }, collectTelemetry: async () => ({ sessions: [], summary: {}, warnings: [] }) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.route3.shutdown(); server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const port = server.address().port;
  const request = (url, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: url, method, headers }, res => {
      let text = ''; res.on('data', chunk => text += chunk); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
    });
    req.on('error', reject); req.end(body === undefined ? undefined : JSON.stringify(body));
  });
  assert.deepEqual((await request('/api/state')).body.nightShift.schedule, { enabled: false, start: '23:00', end: '07:00' });
  assert.equal((await request('/api/night-shift/queue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { prompt: 'No token' } })).status, 403);
  const token = (await request('/api/bootstrap')).body.token;
  const headers = { 'Content-Type': 'application/json', 'X-Route3-Token': token };
  const queued = await request('/api/night-shift/queue', { method: 'POST', headers, body: { prompt: 'Refactor nothing, fix the date bug', taskClass: 'code' } });
  assert.equal(queued.status, 200);
  assert.equal(queued.body.nightShift.queue.length, 1);
  assert.equal((await request('/api/night-shift/schedule', { method: 'POST', headers, body: { start: '25:00' } })).status, 400);
  assert.equal((await request('/api/night-shift/schedule', { method: 'POST', headers, body: { start: '22:00', end: '06:30' } })).body.nightShift.schedule.start, '22:00');
  assert.equal((await request(`/api/night-shift/items/${queued.body.item.id}`, { method: 'DELETE' })).status, 403);
  assert.equal((await request(`/api/night-shift/items/${queued.body.item.id}`, { method: 'DELETE', headers })).status, 200);
  assert.equal((await request(`/api/night-shift/items/${queued.body.item.id}`, { method: 'DELETE', headers })).status, 404);
  assert.equal((await request('/api/state')).body.nightShift.queue.length, 0);
});

test('end to end: the shift launches a real JobManager job and reports it in the morning', async t => {
  const { JobManager } = require('../process-manager');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'route3-night-e2e-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const fake = path.join(dir, 'fake-codex');
  fs.writeFileSync(fake, `#!${process.execPath}\nlet input='';process.stdin.on('data',d=>input+=d);process.stdin.on('end',()=>{console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'night result: '+input.trim().split('\\n').pop()}}));});`, { mode: 0o700 });
  // Only the fake CLI is visible, so automatic routing cannot reach a real provider.
  const jobs = new JobManager({ workspace: dir, env: { PATH: '' }, commands: { codex: fake, kimi: null, gemini: null, claude: null, zai: null } });
  t.after(() => jobs.shutdown());
  const { night } = shift(t, { jobs });
  night.enqueue({ prompt: 'Summarise TODO comments' });
  night.configure({ enabled: true });
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && night.snapshot().report[0]?.status !== 'done') { await new Promise(r => setTimeout(r, 50)); night.tick(); }
  const [entry] = night.snapshot().report;
  assert.equal(entry.status, 'done');
  assert.equal(entry.agent, 'codex');
  assert.match(entry.tail, /night result: Summarise TODO comments/);
});

test('review regressions: late exit of a killed keep-awake child does not orphan the current one', t => {
  const children = [];
  const night = new NightShift({ jobs: fakeJobs(), now: () => at('23:30'), platform: 'darwin',
    keepAwake: () => { const handlers = {}; const child = { alive: true, on(event, fn) { handlers[event] = fn; }, kill() { child.alive = false; }, exit: () => handlers.exit?.() }; children.push(child); return child; } });
  t.after(() => night.shutdown());
  night.enqueue({ prompt: 'Keeps work pending' });
  night.configure({ enabled: true });
  night.configure({ enabled: false });
  night.configure({ enabled: true });
  children[0].exit();            // the first, already-killed child exits late
  night.tick();
  night.configure({ enabled: false });
  assert.equal(children.filter(child => child.alive).length, 0, 'every spawned keep-awake child is stopped');
});

test('review regressions: unknown expert rejected at enqueue; tampered running item cannot block the queue', t => {
  const night = new NightShift({ jobs: fakeJobs(), experts: { find: id => id === 'frontend' ? { id } : null }, now: () => at('12:00') });
  t.after(() => night.shutdown());
  assert.throws(() => night.enqueue({ prompt: 'Task for a deleted expert', expert: 'gone' }), /Unknown expert/);
  assert.equal(night.enqueue({ prompt: 'Task for a real expert', expert: 'frontend' }).expert, 'frontend');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'route3-night-tamper-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'night.json');
  fs.writeFileSync(file, JSON.stringify({ version: 1, schedule: { enabled: true, start: '23:00', end: '07:00' }, items: [
    { id: crypto.randomUUID(), prompt: 'Tampered', status: 'running', jobId: null },
    { id: crypto.randomUUID(), prompt: 'Bogus status', status: 'launched' },
    { id: crypto.randomUUID(), prompt: 'Real queued task', status: 'queued', jobId: null }] }));
  const { night: loaded, jobs } = shift(t, { file });
  loaded.tick();
  assert.equal(jobs.started.length, 1);
  assert.equal(jobs.started[0].prompt, 'Real queued task');
  assert.equal(loaded.snapshot().report.find(item => item.prompt === 'Tampered').status, 'failed');
  assert.equal(loaded.snapshot().report.some(item => item.prompt === 'Bogus status'), false);
});
