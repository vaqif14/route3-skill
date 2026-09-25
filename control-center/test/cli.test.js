'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createServer } = require('../server');
const { NotebookLM } = require('../notebooklm');
const { TelegramBridge } = require('../telegram-bridge');

const CLI = path.join(__dirname, '..', 'cli.js');
const A = '11111111-2222-4333-8444-555555555555';
const LIST = JSON.stringify([{ id: A, title: 'Architecture books', source_count: 4, updated_at: '2026-09-20T10:00:00Z' }]);

// The CLI is exercised as a real child process: argv, stdin, stdout, exit code.
// Async, because the server under test lives in this process and must keep serving.
function cli(port, args, stdin) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [CLI, '--port', String(port), ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', chunk => out += chunk);
    child.stderr.on('data', chunk => err += chunk);
    const timer = setTimeout(() => child.kill('SIGKILL'), 20000);
    child.on('close', code => { clearTimeout(timer); const parse = text => { try { return JSON.parse(text); } catch { return text; } }; resolve({ code, out: parse(out), err: parse(err) }); });
    if (stdin !== undefined) child.stdin.end(stdin); else child.stdin.end();
  });
}

async function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'route3-cli-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const fake = path.join(home, 'fake-codex');
  fs.writeFileSync(fake, `#!${process.execPath}\nlet i='';process.stdin.on('data',d=>i+=d);process.stdin.on('end',()=>{require('fs').writeFileSync(${JSON.stringify(path.join(home, 'stdin.txt'))},i);});`, { mode: 0o700 });
  const notebooklm = new NotebookLM({ command: 'nlm', exec: (c, a, o, cb) => setTimeout(() => cb(null, a[1] === 'list' ? LIST : JSON.stringify({ answer: /TITLE:/.test(a[3]) ? 'TITLE: Architecture Mentor\nFOCUS: Layering.\nPRINCIPLES:\n- Depend inward (Book)' : '- Never skip the boundary (Book)', conversation_id: 'c1', sources_used: ['s'] })), 10) });
  const telegramCalls = [];
  const fetchImpl = async (url, options) => {
    const method = url.split('/').pop(); telegramCalls.push({ method, url });
    if (method === 'getUpdates') return new Promise((resolve, reject) => { options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }); });
    return { ok: true, json: async () => ({ ok: true, result: method === 'getMe' ? { id: 42, is_bot: true, username: 'route3_cli_bot' } : method === 'getWebhookInfo' ? { url: '' } : { message_id: 1 } }) };
  };
  const jobs = new (require('../process-manager').JobManager)({ workspace: home, env: { PATH: '' }, commands: { codex: fake, kimi: null, gemini: null, claude: null, zai: null } });
  const telegramBridge = new TelegramBridge({ jobs, notebooklm, home, workspace: home, fetchImpl, monitorMs: 100000 });
  const server = createServer({ workspace: home, home, publicDir: home, jobs, notebooklm, telegramBridge, integrationOptions: { command: null }, collectTelemetry: async () => ({ sessions: [], summary: {}, warnings: [] }) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await server.route3.shutdown(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return { home, port: server.address().port, telegramCalls };
}

test('usage and reachability errors are JSON on stderr with distinct exit codes', async () => {
  const usage = await cli(1, []);
  assert.equal(usage.code, 2);
  assert.match(usage.err.error, /route3-skill <group> <action>/);
  const down = await cli(1, ['state']);
  assert.equal(down.code, 3);
  assert.match(down.err.error, /not reachable on 127\.0\.0\.1:1/);
  assert.equal((await cli(1, ['jobs', 'start'])).code, 2, 'missing --prompt is a usage error before any request');
});

test('state, jobs start/wait/cancel, and rejected requests', async t => {
  const { home, port } = await fixture(t);
  const state = await cli(port, ['state']);
  assert.equal(state.code, 0);
  assert.deepEqual(state.out.nightShift.schedule, { enabled: false, start: '23:00', end: '07:00' });
  const started = await cli(port, ['jobs', 'start', '--prompt-stdin', '--agent', 'codex', '--notebook', A], 'Review the architecture against the books');
  assert.equal(started.code, 0, JSON.stringify(started.err));
  assert.deepEqual(started.out.job.brain, { id: A, title: 'Architecture books' });
  const waited = await cli(port, ['jobs', 'wait', started.out.job.id, '--timeout', '10']);
  assert.equal(waited.code, 0);
  assert.equal(waited.out.job.status, 'completed');
  assert.match(fs.readFileSync(path.join(home, 'stdin.txt'), 'utf8'), /Notebook: "Architecture books"[\s\S]*Review the architecture/);
  const rejected = await cli(port, ['jobs', 'start', '--prompt', 'x', '--expert', 'nope']);
  assert.equal(rejected.code, 4);
  assert.match(rejected.err.error, /Unknown expert/);
  assert.equal((await cli(port, ['jobs', 'wait', 'missing-id'])).code, 4);
  assert.equal((await cli(port, ['jobs', 'list'])).out.jobs.length, 1);
});

test('night shift and brain commands round-trip through the server', async t => {
  const { port } = await fixture(t);
  const queued = await cli(port, ['night', 'queue', '--prompt', 'Nightly review', '--class', 'planning', '--notebook', A]);
  assert.equal(queued.code, 0, JSON.stringify(queued.err));
  assert.equal(queued.out.item.taskClass, 'planning');
  assert.deepEqual(queued.out.item.brain, { id: A, title: 'Architecture books' });
  assert.equal((await cli(port, ['night', 'schedule'])).code, 2);
  const schedule = await cli(port, ['night', 'schedule', '--on', '--start', '22:30', '--end', '06:00']);
  assert.deepEqual(schedule.out.nightShift.schedule, { enabled: true, start: '22:30', end: '06:00' });
  assert.equal((await cli(port, ['night', 'schedule', '--start', '25:00'])).code, 4);
  assert.equal((await cli(port, ['night', 'status'])).out.nightShift.queue.length, 1);
  assert.equal((await cli(port, ['night', 'remove', queued.out.item.id])).code, 0);
  assert.equal((await cli(port, ['night', 'report'])).out.report.length, 0);
  assert.equal((await cli(port, ['brain', 'refresh'])).out.notebooklm.notebooks[0].title, 'Architecture books');
  assert.equal((await cli(port, ['brain', 'list'])).out.notebooklm.status, 'ready');
});

test('experts: draft piped into create keeps the notebook binding; list and remove', async t => {
  const { port } = await fixture(t);
  const draft = await cli(port, ['experts', 'draft', '--notebook', A, '--hint', 'mentor']);
  assert.equal(draft.code, 0, JSON.stringify(draft.err));
  assert.equal(draft.out.draft.label, 'Architecture Mentor');
  const created = await cli(port, ['experts', 'create', '--from-draft-stdin'], JSON.stringify(draft.out));
  assert.equal(created.code, 0, JSON.stringify(created.err));
  assert.deepEqual(created.out.expert.brain, { id: A, title: 'Architecture books' });
  assert.equal((await cli(port, ['experts', 'create', '--from-draft-stdin'], 'not json')).code, 2);
  const plain = await cli(port, ['experts', 'create', '--label', 'Plain', '--brief', 'No notebook for this expert.']);
  assert.equal(plain.out.expert.brain, null);
  assert.equal((await cli(port, ['experts', 'list'])).out.experts.filter(e => e.custom).length, 2);
  assert.equal((await cli(port, ['experts', 'remove', created.out.expert.id])).code, 0);
  assert.equal((await cli(port, ['experts', 'remove', 'x-missing'])).code, 4);
});

test('telegram: the token travels on stdin only and never appears in output', async t => {
  const { port, telegramCalls } = await fixture(t);
  const TOKEN = '123456789:abcdefghijklmnopqrstuvwx';
  const noStdin = await cli(port, ['telegram', 'configure', '--token', TOKEN]);
  assert.equal(noStdin.code, 2);
  assert.match(noStdin.err.error, /stdin only/);
  const configured = await cli(port, ['telegram', 'configure', '--token-stdin'], `${TOKEN}\n`);
  assert.equal(configured.code, 0, JSON.stringify(configured.err));
  assert.equal(configured.out.telegramRemote.configured, true);
  assert.equal(configured.out.telegramRemote.bot.username, 'route3_cli_bot');
  assert.equal(JSON.stringify(configured).includes(TOKEN), false);
  assert.ok(telegramCalls.some(call => call.method === 'getMe'));
  const status = await cli(port, ['telegram', 'status']);
  assert.equal(status.out.telegramRemote.configured, true);
  assert.equal(JSON.stringify(status).includes(TOKEN), false);
});
