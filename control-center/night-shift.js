'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { clip } = require('./job-history');
const { normalizeBrain } = require('./notebooklm');

// Night Shift: tasks queued during the day run one at a time inside a local-time
// window while the owner sleeps. It is a scheduler on top of JobManager, not a
// new execution path: every job keeps its provider's approval flow. A job that
// asks for approval waits (in the panel or on Telegram) — it is never approved
// on the owner's behalf. Nothing new starts after the window closes; running
// jobs are not killed. The morning report lists what happened to every item.

const MAX_ITEMS = 20;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const TASK_CLASSES = new Set(['code', 'design', 'planning', 'discussion']);
const ACTIVE = new Set(['running', 'awaiting_approval']);
const STATUSES = new Set(['queued', 'running', 'awaiting_approval', 'done', 'failed']);
const DEFAULT_SCHEDULE = { enabled: false, start: '23:00', end: '07:00' };

const badRequest = message => Object.assign(new Error(message), { statusCode: 400 });
const minutes = hhmm => { const [, h, m] = TIME.exec(hhmm); return Number(h) * 60 + Number(m); };

// Window may cross midnight (23:00 → 07:00). start === end means "never".
function inWindow(schedule, now) {
  const at = now.getHours() * 60 + now.getMinutes();
  const start = minutes(schedule.start), end = minutes(schedule.end);
  if (start === end) return false;
  return start < end ? at >= start && at < end : at >= start || at < end;
}

class NightShift {
  constructor({ jobs, experts = null, file = null, now = () => new Date(), setInterval: every = setInterval, clearInterval: stop = clearInterval,
    keepAwake = defaultKeepAwake, platform = process.platform, tickMs = 60000 } = {}) {
    Object.assign(this, { jobs, experts, file, now, every, stop, keepAwake, platform, tickMs });
    this.schedule = { ...DEFAULT_SCHEDULE };
    this.items = [];
    this.awake = null;
    this.timer = null;
    this.warning = null;
    this.load();
  }

  load() {
    if (!this.file || !fs.existsSync(this.file)) return;
    try {
      const stat = fs.lstatSync(this.file);
      if (!stat.isFile() || stat.size > 512 * 1024) throw new Error();
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (data.version !== 1 || !Array.isArray(data.items)) throw new Error();
      this.schedule = this.validSchedule({ ...DEFAULT_SCHEDULE, ...data.schedule });
      this.items = data.items.slice(-MAX_ITEMS).filter(item => /^[0-9a-f-]{36}$/.test(item?.id) && typeof item.prompt === 'string' && STATUSES.has(item.status));
      // An active item without its job can never reconcile; it would block the queue forever.
      for (const item of this.items) if (ACTIVE.has(item.status) && !item.jobId) Object.assign(item, { status: 'failed', note: 'job no longer tracked' });
    } catch {
      this.warning = 'Night Shift state could not be read; starting with an empty queue.';
    }
  }

  persist() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    if (fs.existsSync(this.file) && !fs.lstatSync(this.file).isFile()) throw new Error('Night Shift state must be a regular file.');
    const temp = `${this.file}.${crypto.randomBytes(8).toString('hex')}.tmp`;
    try {
      fs.writeFileSync(temp, JSON.stringify({ version: 1, schedule: this.schedule, items: this.items }), { mode: 0o600, flag: 'wx' });
      fs.renameSync(temp, this.file);
      this.warning = null;
    } finally { try { fs.unlinkSync(temp); } catch { /* renamed */ } }
  }

  validSchedule(input) {
    const schedule = { enabled: Boolean(input.enabled), start: String(input.start ?? ''), end: String(input.end ?? '') };
    if (!TIME.test(schedule.start) || !TIME.test(schedule.end)) throw badRequest('Night Shift times must be HH:MM (24-hour).');
    if (schedule.start === schedule.end) throw badRequest('Night Shift start and end must differ.');
    return schedule;
  }

  configure(input) {
    this.schedule = this.validSchedule({ ...this.schedule, ...input });
    this.persist();
    this.tick();
    return this.snapshot();
  }

  enqueue(input) {
    const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
    if (prompt.length < 3 || Buffer.byteLength(prompt) > 32768) throw badRequest('Prompt must contain 3–32768 bytes.');
    const taskClass = input.taskClass || 'code';
    if (!TASK_CLASSES.has(taskClass)) throw badRequest('Task class must be code, design, planning, or discussion.');
    const expert = input.expert ? String(input.expert).slice(0, 64) : null;
    // Reject an unknown expert now, not when the job would start at night.
    if (expert && this.experts && !this.experts.find(expert)) throw badRequest('Unknown expert. Create it in the Experts view first.');
    if (this.items.filter(item => item.status === 'queued').length >= MAX_ITEMS) throw badRequest(`Night Shift holds at most ${MAX_ITEMS} queued tasks.`);
    // Finished items beyond the cap drop oldest-first; queued work is never dropped.
    while (this.items.length >= MAX_ITEMS) {
      const index = this.items.findIndex(item => item.status !== 'queued' && !this.isActive(item));
      if (index < 0) break;
      this.items.splice(index, 1);
    }
    const brain = normalizeBrain(input.brain);
    const item = { id: crypto.randomUUID(), prompt, taskClass, expert, brain, status: 'queued', createdAt: this.now().toISOString(), jobId: null, startedAt: null, endedAt: null, note: null };
    this.items.push(item);
    this.persist();
    return { ...item };
  }

  remove(id) {
    const item = this.items.find(entry => entry.id === id);
    if (!item) throw Object.assign(new Error('Unknown Night Shift item.'), { statusCode: 404 });
    if (this.isActive(item)) throw Object.assign(new Error('This task is running; cancel its job in Tapşırıqlar first.'), { statusCode: 409 });
    this.items = this.items.filter(entry => entry.id !== id);
    this.persist();
    return true;
  }

  job(item) { return item.jobId ? this.jobs.list().find(job => job.id === item.jobId) : null; }
  isActive(item) { const job = this.job(item); return Boolean(job && ACTIVE.has(job.status)); }

  // Reconcile item state with its job, then start the next item when allowed.
  tick() {
    let changed = false;
    for (const item of this.items) {
      if (!item.jobId || !ACTIVE.has(item.status)) continue;
      let job = this.job(item);
      for (let hop = 0; job?.failoverTo && hop < 4; hop++) { item.jobId = job.failoverTo; item.note = 'rerouted after the provider quota/session ended'; changed = true; job = this.job(item); }
      if (job?.failoverTo) { Object.assign(item, { status: 'failed', endedAt: this.now().toISOString(), note: 'failover chain too long; check the job list' }); changed = true; continue; }
      const status = !job ? 'failed' : ACTIVE.has(job.status) ? job.status : job.status === 'completed' ? 'done' : 'failed';
      if (status !== item.status) {
        item.status = status;
        if (!ACTIVE.has(status)) { item.endedAt = job?.endedAt || this.now().toISOString(); item.note = job ? (status === 'done' ? null : job.status) : 'job no longer tracked'; }
        changed = true;
      }
    }
    const open = this.schedule.enabled && inWindow(this.schedule, this.now());
    this.setAwake(open && this.items.some(item => item.status === 'queued' || ACTIVE.has(item.status)));
    // One task runs at a time. A task waiting for approval does not block the
    // queue, but JobManager's own concurrency cap still applies.
    const running = this.items.some(item => item.status === 'running');
    const next = this.items.find(item => item.status === 'queued');
    if (open && !running && next) {
      try {
        const job = this.jobs.start({ agent: 'auto', prompt: next.prompt, taskClass: next.taskClass, expert: next.expert || undefined, brain: next.brain || undefined });
        Object.assign(next, { status: 'running', jobId: job.id, startedAt: job.startedAt || this.now().toISOString(), note: null });
      } catch (error) {
        if (error.statusCode === 409 && /already active/.test(error.message)) {
          changed = changed || next.note !== 'waiting for a free job slot';
          next.note = 'waiting for a free job slot';
          if (changed) this.persist();
          return;
        }
        Object.assign(next, { status: 'failed', endedAt: this.now().toISOString(), note: clip(error.message, 300) });
      }
      changed = true;
    }
    if (changed) this.persist();
  }

  setAwake(on) {
    if (this.platform !== 'darwin') return;
    if (on && !this.awake) {
      const child = this.keepAwake();
      this.awake = child;
      // Only forget the child this handler belongs to; a late exit of an
      // earlier, already-killed child must not orphan the current one.
      child?.on?.('exit', () => { if (this.awake === child) this.awake = null; });
    } else if (!on && this.awake) {
      try { this.awake.kill(); } catch { /* already gone */ }
      this.awake = null;
    }
  }

  start() { if (!this.timer) { this.timer = this.every(() => { try { this.tick(); } catch { /* next tick */ } }, this.tickMs); this.timer.unref?.(); this.tick(); } }
  shutdown() { if (this.timer) this.stop(this.timer); this.timer = null; this.setAwake(false); }

  report() {
    return this.items.filter(item => item.status !== 'queued').map(item => {
      const job = this.job(item);
      const tail = job ? (Array.isArray(job.logTail) ? job.logTail.join('\n') : job.logTail || '') : '';
      return { id: item.id, prompt: clip(item.prompt, 200), status: item.status, agent: job?.agent || null, jobId: item.jobId, brain: item.brain || null,
        startedAt: item.startedAt, endedAt: item.endedAt, note: item.note, pendingApprovals: job?.permissions?.length || 0,
        tail: clip(tail.split('\n').slice(-8).join('\n'), 1200) };
    });
  }

  snapshot() {
    const now = this.now();
    return { schedule: { ...this.schedule }, inWindow: this.schedule.enabled && inWindow(this.schedule, now), keepingAwake: Boolean(this.awake),
      queue: this.items.filter(item => item.status === 'queued').map(item => ({ ...item })), report: this.report(), warning: this.warning };
  }
}

// `caffeinate -i` blocks idle sleep only while it runs; it changes no system
// setting. A closed lid on battery still sleeps the Mac — the panel says so.
function defaultKeepAwake() {
  try {
    const child = spawn('/usr/bin/caffeinate', ['-i', '-w', String(process.pid)], { stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
    return child;
  } catch { return null; }
}

module.exports = { NightShift, inWindow, MAX_ITEMS };
