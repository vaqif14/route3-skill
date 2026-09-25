'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { redact, equalToken } = require('./security');
const { normalizeBrain } = require('./notebooklm');
const ACTIVE = new Set(['running', 'awaiting_approval']);
const HELP = '/status — Mac and agent status\n/jobs — recent jobs\n/run <task> — start a task in the configured project\n/continue <job-id> <task> — new session with a bounded handoff\n/watch <job-id> — follow a running panel task and its approvals\n/cancel <job-id> — cancel a task\n/brain — list NotebookLM notebooks; /brain <n> grounds every /run in one, /brain off clears\n/help — commands';
const safe = value => redact(value).slice(0, 3900);

class TelegramError extends Error {
  constructor(code, retryAfter = 0) {
    super(code === 401 ? 'Telegram rejected the bot token. Configure it again.' : code === 409 ? 'Another Telegram poller or webhook is using this bot. Stop it before restarting Route3 Telegram.' : code === 429 ? 'Telegram rate limit reached; waiting before reconnecting.' : 'Telegram is unreachable. Check the Mac internet connection.');
    this.code = code;
    this.retryAfter = Math.min(60, Math.max(1, Number(retryAfter) || 1));
  }
}

class TelegramBridge {
  constructor({ jobs, notebooklm = null, home = os.homedir(), workspace, fetchImpl = globalThis.fetch, now = Date.now, pollTimeout = 25, monitorMs = 1500, retryMs = 1000 } = {}) {
    if (!jobs) throw new Error('Telegram requires a job manager.');
    this.jobs = jobs;
    this.notebooklm = notebooklm;
    this.workspace = workspace || jobs.workspace || process.cwd();
    this.fetch = fetchImpl;
    this.now = now;
    this.pollTimeout = pollTimeout;
    this.monitorMs = monitorMs;
    this.retryMs = retryMs;
    this.directory = path.join(home, '.local', 'share', 'route3', 'telegram');
    if (fs.existsSync(this.directory) && !fs.lstatSync(this.directory).isDirectory()) throw new Error('Telegram directory must be a real private directory.');
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    fs.chmodSync(this.directory, 0o700);
    this.file = path.join(this.directory, 'config.json');
    this.config = { enabled: false, token: null, bot: null, paired: null, offset: 0, tracked: [], notified: [], acceptAfter: this.now() };
    if (fs.existsSync(this.file)) {
      try {
        const stat = fs.lstatSync(this.file);
        if (!stat.isFile() || stat.size > 262144) throw new Error('Invalid config file.');
        const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        if (saved && typeof saved === 'object' && !Array.isArray(saved)) Object.assign(this.config, saved);
        if (!Array.isArray(this.config.tracked) || !Array.isArray(this.config.notified) || !Number.isSafeInteger(this.config.offset) || this.config.offset < 0) throw new Error('Invalid config.');
        fs.chmodSync(this.file, 0o600);
      } catch { throw new Error('Telegram configuration could not be read. Restore or remove its private config.json.'); }
    }
    this.status = this.config.token ? 'stopped' : 'unconfigured';
    this.error = null;
    this.running = false;
    this.controllers = new Set();
    this.handles = new Map();
    this.pairCode = null;
    this.lock = null;
    this.lifecycle = Promise.resolve();
    // The saved brain is re-validated; a tampered or stale entry becomes "none".
    try { this.config.brain = normalizeBrain(this.config.brain); } catch { this.config.brain = null; }
  }

  snapshot() {
    return { configured: Boolean(this.config.token), enabled: Boolean(this.config.enabled), status: this.status, error: this.error, brain: this.config.brain ? { ...this.config.brain } : null, bot: this.config.bot ? { id: this.config.bot.id, username: this.config.bot.username } : null, paired: this.config.paired ? { userId: this.config.paired.userId, chatId: this.config.paired.chatId } : null };
  }

  save() {
    if (fs.existsSync(this.file) && !fs.lstatSync(this.file).isFile()) throw new Error('Telegram config must be a regular private file.');
    const temporary = `${this.file}.${crypto.randomBytes(8).toString('hex')}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify(this.config), { mode: 0o600, flag: 'wx' });
      fs.renameSync(temporary, this.file);
    } finally { try { fs.unlinkSync(temporary); } catch { /* moved */ } }
  }

  assertWriter() {
    for (const name of fs.readdirSync(this.directory).filter(name => /^poller-.*\.lock$/.test(name))) {
      const file = path.join(this.directory,name);
      let record;
      try { record = JSON.parse(fs.readFileSync(file,'utf8')); } catch { throw new Error('Telegram poller lock is unreadable.'); }
      if (this.lock?.file === file && this.lock.nonce === record.nonce) continue;
      try { process.kill(record.pid,0); } catch (error) { if (error.code === 'ESRCH') continue; }
      throw new Error('Another Route3 process owns Telegram. Manage it from the original panel.');
    }
  }

  serial(operation, transient = false) {
    const result = this.lifecycle.then(() => { if (!transient) this.assertWriter(); return operation(); }).catch(error => { if (!error.statusCode) error.statusCode = 400; throw error; });
    this.lifecycle = result.catch(() => {});
    return result;
  }

  configure(input = {}) { return this.serial(async () => {
    const token = input.token;
    if (typeof token !== 'string' || !/^\d{5,16}:[A-Za-z0-9_-]{20,200}$/.test(token)) throw new Error('Enter a valid BotFather bot token.');
    const bot = await this.api('getMe', {}, token);
    const webhook = await this.api('getWebhookInfo', {}, token);
    if (webhook?.url) throw new Error('This bot has an active webhook. Use a dedicated bot, or remove its webhook in the application that owns it.');
    if (!bot?.is_bot || !Number.isSafeInteger(bot.id) || !/^[A-Za-z0-9_]+$/.test(bot.username || '')) throw new Error('Telegram returned an invalid bot identity.');
    this.assertWriter();
    await this.halt();
    const sameBot = this.config.bot?.id === bot.id && this.config.workspace === this.workspace;
    this.config = { ...this.config, workspace: this.workspace, token, bot: { id: bot.id, username: bot.username }, enabled: input.enabled === true };
    if (!sameBot) Object.assign(this.config, { paired: null, offset: 0, tracked: [], notified: [], acceptAfter: this.now() });
    this.pairCode = null;
    this.handles.clear();
    this.save();
    this.error = null;
    this.status = 'stopped';
    if (this.config.enabled) await this.begin();
    return this.snapshot();
  }); }

  start() { return this.serial(async () => {
    if (!this.config.token) throw new Error('Configure a dedicated Telegram bot first.');
    if (this.running) return this.snapshot();
    await this.halt();
    this.config.enabled = true;
    this.save();
    await this.begin();
    return this.snapshot();
  }); }

  stop() { return this.serial(async () => {
    this.config.enabled = false;
    this.save();
    await this.halt();
    return this.snapshot();
  }); }

  shutdown() { for (const controller of this.controllers) controller.abort(); return this.serial(() => this.halt(), true); }

  unpair() { return this.serial(async () => {
    await this.halt();
    this.config.paired = null;
    this.config.tracked = [];
    this.config.notified = [];
    this.pairCode = null;
    this.handles.clear();
    this.save();
    if (this.config.enabled) await this.begin();
    return this.snapshot();
  }); }

  disconnect() { return this.serial(async () => {
    await this.halt();
    this.config = { enabled: false, token: null, bot: null, paired: null, offset: 0, tracked: [], notified: [], acceptAfter: this.now() };
    this.pairCode = null;
    this.handles.clear();
    this.save();
    this.status = 'unconfigured';
    return this.snapshot();
  }); }

  pairing() {
    this.assertWriter();
    if (!this.config.token) throw new Error('Configure a dedicated Telegram bot first.');
    if (this.config.paired) throw new Error('Unpair the existing Telegram identity first.');
    const code = crypto.randomBytes(24).toString('hex');
    this.pairCode = { code, createdAt: this.now(), expiresAt: this.now() + 10 * 60 * 1000 };
    return { code, expiresAt: new Date(this.pairCode.expiresAt).toISOString(), url: `https://t.me/${this.config.bot.username}?start=${code}` };
  }

  acquireLock() {
    const name = 'route3';
    const file = path.join(this.directory, `poller-${name}.lock`);
    const nonce = crypto.randomBytes(16).toString('hex');
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        fs.writeFileSync(file, JSON.stringify({ pid: process.pid, nonce }), { mode: 0o600, flag: 'wx' });
        this.lock = { file, nonce };
        return;
      } catch (error) {
        if (error.code !== 'EEXIST') throw new Error('Cannot create Telegram poller lock.');
        let record;
        try { record = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new Error('Telegram poller lock is unreadable. Check the local private lock file.'); }
        if (!Number.isSafeInteger(record.pid) || record.pid < 1) throw new Error('Telegram poller lock is invalid.');
        try { process.kill(record.pid, 0); } catch (failure) {
          if (failure.code === 'ESRCH' && attempt === 0) {
            if (fs.readFileSync(file, 'utf8') === JSON.stringify(record)) fs.unlinkSync(file);
            continue;
          }
        }
        throw new Error('Another Route3 process owns this Telegram bot. Stop it first.');
      }
    }
    throw new Error('Could not acquire Telegram poller lock.');
  }

  releaseLock() {
    if (!this.lock) return;
    try { if (JSON.parse(fs.readFileSync(this.lock.file, 'utf8')).nonce === this.lock.nonce) fs.unlinkSync(this.lock.file); } catch { /* already released */ }
    this.lock = null;
  }

  async begin() {
    if (this.config.workspace !== this.workspace) { this.status = 'error'; this.error = 'Telegram belongs to a different project. Reconfigure and pair it in this project first.'; throw new Error(this.error); }
    try { this.acquireLock(); } catch (error) { this.status = 'conflict'; this.error = error.message; throw error; }
    this.running = true;
    this.status = this.config.paired ? 'connected' : 'awaiting_pair';
    this.error = null;
    this.pollPromise = this.poll().finally(() => this.releaseLock());
    this.monitorPromise = this.monitor();
  }

  async halt() {
    this.running = false;
    for (const controller of this.controllers) controller.abort();
    this.wake?.();
    this.monitorWake?.();
    await Promise.allSettled([this.pollPromise, this.monitorPromise]);
    this.releaseLock();
    this.status = this.config.token ? 'stopped' : 'unconfigured';
    this.error = null;
  }

  async api(method, body = {}, token = this.config.token) {
    const controller = new AbortController();
    this.controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), method === 'getUpdates' ? (this.pollTimeout + 10) * 1000 : 15000);
    timeout.unref?.();
    try {
      const response = await this.fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new TelegramError(payload.error_code || response.status, payload.parameters?.retry_after);
      return payload.result;
    } catch (error) { throw error instanceof TelegramError ? error : new TelegramError(0); }
    finally { clearTimeout(timeout); this.controllers.delete(controller); }
  }

  delay(ms, monitor = false) {
    return new Promise(resolve => {
      const key = monitor ? 'monitorWake' : 'wake';
      const timer = setTimeout(done, ms);
      timer.unref?.();
      const self = this;
      function done() { clearTimeout(timer); self[key] = null; resolve(); }
      this[key] = done;
    });
  }

  async poll() {
    let failures = 0;
    while (this.running) {
      try {
        const updates = await this.api('getUpdates', { offset: this.config.offset, timeout: this.pollTimeout, limit: 100, allowed_updates: ['message', 'callback_query'] });
        if (!this.running) break;
        if (!Array.isArray(updates)) throw new TelegramError(0);
        failures = 0;
        this.error = null;
        this.status = this.config.paired ? 'connected' : 'awaiting_pair';
        for (const update of updates) {
          if (!this.running) break;
          if (!Number.isSafeInteger(update.update_id) || update.update_id < this.config.offset) continue;
          // Persist receipt before any job launch, approval, or outbound message.
          this.config.offset = update.update_id + 1;
          this.save();
          try { await this.dispatch(update); } catch (error) { if (error instanceof TelegramError) throw error; this.error = 'A Telegram command could not be completed. Check the local Route3 panel.'; }
        }
        if (!updates.length) await this.delay(100);
      } catch (error) {
        if (!this.running) break;
        this.error = error instanceof TelegramError ? error.message : 'Telegram local state could not be saved. Check disk permissions.';
        if (!(error instanceof TelegramError) || error.code === 401 || error.code === 409) {
          this.status = error.code === 401 ? 'unauthorized' : error.code === 409 ? 'conflict' : 'error';
          this.running = false;
          this.monitorWake?.();
          break;
        }
        this.status = 'reconnecting';
        await this.delay(error.code === 429 ? error.retryAfter * 1000 : Math.min(30000, this.retryMs * 2 ** Math.min(failures++, 5)));
      }
    }
  }

  authorized(user, chat) {
    const paired = this.config.paired;
    return Boolean(paired && user && !user.is_bot && chat?.type === 'private' && user.id === paired.userId && chat.id === paired.chatId);
  }

  async send(text, extra = {}) {
    if (!this.config.paired) return;
    return this.api('sendMessage', { chat_id: this.config.paired.chatId, text: safe(text), ...extra });
  }

  async dispatch(update) {
    if (update.callback_query) return this.callback(update.callback_query);
    const message = update.message;
    if (!message || message.chat?.type !== 'private' || message.from?.is_bot || !Number.isSafeInteger(message.from?.id) || !Number.isSafeInteger(message.chat.id) || typeof message.text !== 'string') return;
    if (!Number.isFinite(message.date) || message.date * 1000 > this.now() + 60000 || message.date * 1000 < this.config.acceptAfter - 1000 || message.date * 1000 < this.now() - 24 * 60 * 60 * 1000) return;
    const match = message.text.trim().match(/^\/(\w+)(?:@([\w]+))?(?:\s+([\s\S]*))?$/);
    if (!match || (match[2] && match[2].toLowerCase() !== this.config.bot.username.toLowerCase())) return;
    const command = match[1].toLowerCase(), argument = (match[3] || '').trim();
    if (!this.config.paired && (command === 'pair' || command === 'start')) {
      if (!this.pairCode || this.now() > this.pairCode.expiresAt || message.date * 1000 < this.pairCode.createdAt - 1000 || !equalToken(argument, this.pairCode.code)) return;
      this.config.paired = { userId: message.from.id, chatId: message.chat.id, pairedAt: this.now() };
      this.pairCode = null;
      try { this.save(); } catch (error) { this.config.paired = null; throw error; }
      this.status = 'connected';
      return this.send(`Route3 paired with this private conversation. Commands work while the Mac is awake, online, and Route3 is running.\n\n${HELP}`);
    }
    if (!this.authorized(message.from, message.chat) || message.date * 1000 < this.config.paired.pairedAt - 1000) return;
    if (command === 'help' || command === 'start') return this.send(HELP);
    const jobs = this.jobs.list();
    if (command === 'status') return this.send(`Route3 is online. ${jobs.filter(job => ACTIVE.has(job.status)).length} active job(s).\nBrain: ${this.config.brain ? safe(this.config.brain.title) : 'none'}\n${this.jobs.agents().map(agent => `${agent.label}: ${agent.status}`).join('\n')}`);
    if (command === 'brain') return this.brain(argument);
    if (command === 'jobs') return this.send(jobs.slice(0, 12).map(job => `${job.id}\n${job.agent} · ${job.status}\n${safe(job.summary).slice(0, 160)}`).join('\n\n') || 'No jobs yet. Use /run <task>.');
    try {
      if (command === 'run') {
        if (!argument || Buffer.byteLength(argument) > 16000) return this.send('Use /run <task> with up to 16000 bytes.');
        // The saved brain is resolved against the Mac's current notebook list at run time.
        let brain = null;
        if (this.config.brain) {
          try { brain = await this.notebooklm?.resolve(this.config.brain.id); } catch { brain = null; }
          if (!brain) return this.send(`The selected brain "${safe(this.config.brain.title)}" is not available on this Mac right now. Send /brain to choose another or /brain off, then /run again.`);
        }
        const job = await this.jobs.start({ agent: 'auto', taskClass: 'code', cwd: this.workspace, prompt: argument, brain });
        this.track(job.id);
        return this.send(`Started ${job.id}\n${job.agent}${brain ? `\nBrain: ${safe(brain.title)}` : ''}\n${job.summary}`);
      }
      if (command === 'continue') {
        const parts = argument.match(/^(\S+)\s+([\s\S]+)$/);
        if (!parts || Buffer.byteLength(parts[2]) > 16000) return this.send('Use /continue <job-id> <task>. This starts a new session using a bounded handoff.');
        const job = await this.jobs.continueJob(parts[1], parts[2]);
        this.track(job.id);
        return this.send(`Started handoff ${job.id}\nFrom ${parts[1]}. This is a new agent session.\n${job.summary}`);
      }
      if (command === 'watch') {
        if (!jobs.some(job => job.id === argument)) return this.send('Job not found. Use /jobs for full IDs.');
        this.track(argument);
        return this.send(`Following ${argument}. Its results and pending approvals will arrive here.`);
      }
      if (command === 'cancel') {
        if (!jobs.some(job => job.id === argument)) return this.send('Job not found. Use /jobs for full IDs.');
        const job = await this.jobs.cancel(argument);
        return this.send(`${job.id}: ${job.status}`);
      }
      return this.send(HELP);
    } catch { return this.send('The command could not be completed. Check the job and provider status in the local Route3 panel.'); }
  }

  // /brain: list notebooks, pick one by number or id, or clear. Selection is
  // persisted with the bot config (private, 0600) and re-resolved on every /run.
  async brain(argument) {
    if (!this.notebooklm) return this.send('NotebookLM is not available on this Mac. Install nlm and sign in with nlm login, then restart Route3.');
    if (argument.toLowerCase() === 'off') { this.config.brain = null; this.save(); return this.send('Brain cleared. /run starts plain tasks.'); }
    const state = await this.notebooklm.refresh({ force: !argument });
    const list = state.notebooks || [];
    if (!argument) {
      if (!list.length) return this.send(state.status === 'ready' ? 'No NotebookLM notebooks on this account.' : 'NotebookLM is not signed in on the Mac. Run nlm login there, then send /brain again.');
      const current = this.config.brain ? `Current brain: ${safe(this.config.brain.title)}` : 'No brain selected.';
      return this.send(`${current}\n\n${list.slice(0, 20).map((item, index) => `${index + 1}. ${safe(item.title)}${Number.isInteger(item.sources) ? ` (${item.sources} sources)` : ''}`).join('\n')}\n\nUse /brain <number> to select, /brain off to clear.`);
    }
    const index = /^\d{1,2}$/.test(argument) ? Number(argument) - 1 : -1;
    const chosen = index >= 0 ? list[index] : list.find(item => item.id === argument.toLowerCase());
    if (!chosen) return this.send('Notebook not found. Send /brain to list them.');
    this.config.brain = { id: chosen.id, title: chosen.title };
    this.save();
    return this.send(`Brain set: ${safe(chosen.title)}\nEvery /run now grounds its task in this notebook. /brain off to clear.`);
  }

  track(id) {
    this.config.notified = this.config.notified.filter(key => !key.startsWith(`permission:${id}:`));
    this.config.tracked = [...new Set([...this.config.tracked, id])].slice(-100);
    this.save();
  }

  mark(key) {
    if (this.config.notified.includes(key)) return false;
    this.config.notified = [...this.config.notified, key].slice(-1000);
    this.save();
    return true;
  }

  async notifyJobs() {
    if (!this.config.paired) return;
    for (const [key, handle] of this.handles) if (handle.expiresAt < this.now()) this.handles.delete(key);
    for (const job of this.jobs.list()) {
      if (!this.config.tracked.includes(job.id)) continue;
      if (job.failoverTo) {
        const key = `failover:${job.id}`;
        if (!this.config.notified.includes(key)) { await this.send(`${job.id} · rerouted\n${job.agent} quota/session ended. Continuing as ${job.failoverTo} on ${this.jobs.list().find(item => item.id === job.failoverTo)?.agent || 'the next provider'}; results will arrive here.`); this.mark(key); this.track(job.failoverTo); }
        continue;
      }
      if (!ACTIVE.has(job.status)) {
        const key = `done:${job.id}`;
        if (!this.config.notified.includes(key)) { await this.send(`${job.id} · ${job.status}\n${safe(redact(job.logTail || job.summary).slice(-3000))}\n\nContinue with /continue ${job.id} <task>`); this.mark(key); }
        continue;
      }
      for (const request of job.permissions || []) {
        const notice = `permission:${job.id}:${request.requestId}`;
        if (this.config.notified.includes(notice)) continue;
        for (const [key, handle] of this.handles) if (handle.jobId === job.id && handle.requestId === request.requestId) this.handles.delete(key);
        const rows = (request.options || []).slice(0, 10).map(option => {
          const handle = crypto.randomBytes(24).toString('hex');
          this.handles.set(handle, { jobId: job.id, requestId: request.requestId, optionId: option.optionId, userId: this.config.paired.userId, chatId: this.config.paired.chatId, expiresAt: this.now() + 10 * 60 * 1000 });
          return [{ text: safe(option.name || option.kind || option.optionId).slice(0, 60), callback_data: handle }];
        });
        await this.send(`Approval required · ${job.id}\n${safe(request.title).slice(0, 200)}\n${safe(request.detail).slice(0, 2000)}\nButtons expire in 10 minutes. The local panel remains available.`, { reply_markup: { inline_keyboard: rows } });
        this.mark(notice);
      }
    }
  }

  async callback(query) {
    if (!this.authorized(query.from, query.message?.chat)) return;
    const handle = typeof query.data === 'string' ? this.handles.get(query.data) : null;
    const request = handle && this.jobs.list().find(job => job.id === handle.jobId && ACTIVE.has(job.status))?.permissions?.find(item => item.requestId === handle.requestId);
    if (!handle || handle.expiresAt < this.now() || handle.userId !== query.from.id || handle.chatId !== query.message.chat.id || !request?.options.some(option => option.optionId === handle.optionId)) {
      return this.api('answerCallbackQuery', { callback_query_id: query.id, text: 'This approval expired or was already handled. Use the local panel.', cache_time: 0 });
    }
    for (const [key, item] of this.handles) if (item.jobId === handle.jobId && item.requestId === handle.requestId) this.handles.delete(key);
    let text = 'Approval recorded.';
    try { await this.jobs.respondPermission(handle.jobId, { requestId: handle.requestId, optionId: handle.optionId }); } catch { text = 'Approval is no longer available. Check the local panel.'; }
    return this.api('answerCallbackQuery', { callback_query_id: query.id, text, cache_time: 0 });
  }

  async monitor() {
    while (this.running) {
      try { await this.notifyJobs(); } catch (error) {
        this.error = error instanceof TelegramError ? error.message : 'A notification could not be delivered. Check the local panel.';
        if (error instanceof TelegramError && [401,409].includes(error.code)) { this.running = false; this.status = error.code === 401 ? 'unauthorized' : 'conflict'; for (const controller of this.controllers) controller.abort(); this.wake?.(); }
        else if (this.running) await this.delay(error.code === 429 ? error.retryAfter * 1000 : Math.max(this.retryMs,5000), true);
      }
      if (this.running) await this.delay(this.monitorMs, true);
    }
  }
}

module.exports = { TelegramBridge };
