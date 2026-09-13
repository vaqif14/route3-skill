'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { redact } = require('./security');
const { AcpAgent } = require('./acp');

const AGENTS = {
  codex: { label: 'Codex', args: ['exec', '--json', '--color', 'never', '-'] },
  claude: { label: 'Claude Code', args: ['--print', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'default'] },
  gemini: { label: 'Gemini CLI', args: ['--output-format', 'stream-json', '--approval-mode', 'default', '--prompt', 'Use the task provided on standard input.'] },
  kimi: { label: 'Kimi Code', acp: true, args: ['acp'], installedReason: 'CLI installed; runs through ACP so its tool approvals reach this panel instead of being auto-approved. Authentication and account limits are checked only when a task runs.' },
  zai: { label: 'z.ai', command: 'hermes', unsupported: 'A verified z.ai adapter with interactive approval support is not available. Hermes one-shot mode automatically bypasses approvals.' },
};

const ROUTES = {
  code: ['kimi', 'codex', 'gemini', 'zai'],
  design: ['gemini', 'kimi', 'codex', 'zai'],
  planning: ['zai', 'kimi', 'codex', 'gemini'],
  discussion: ['zai', 'kimi', 'codex', 'gemini'],
};

const ACTIVE = new Set(['running', 'awaiting_approval']);

function findCommand(name, env = process.env) {
  for (const directory of (env.PATH || '').split(path.delimiter).filter(Boolean)) {
    const candidate = path.resolve(directory, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch { /* next PATH entry */ }
  }
  return null;
}

// NVM-installed CLIs may require a newer Node than the launcher's PATH selects.
function invocation(command, args, env = process.env) {
  if (command && path.basename(command) === 'openclaw') {
    const node = path.join(path.dirname(command), 'node');
    try {
      if (fs.statSync(node).isFile()) {
        fs.accessSync(node, fs.constants.X_OK);
        return { command: node, args: [command, ...args], env: { ...env, PATH: `${path.dirname(node)}${path.delimiter}${env.PATH || ''}` } };
      }
    } catch { /* use normal executable resolution */ }
  }
  return { command, args, env };
}

function stopTree(child, signal = 'SIGTERM') {
  if (!child || !child.pid) return;
  try {
    if (process.platform !== 'win32') process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch (error) {
    if (error.code !== 'ESRCH') { try { child.kill(signal); } catch { /* already stopped */ } }
  }
}

function boundedCommand(command, args, options = {}) {
  return new Promise(resolve => {
    if (!command) return resolve({ code: null, error: 'unavailable', output: '' });
    const call = invocation(command, args, options.env);
    let child;
    try { child = spawn(call.command, call.args, { shell: false, cwd: options.cwd, env: call.env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch { return resolve({ code: null, error: 'unavailable', output: '' }); }
    let output = '', bytes = 0, error = null, done = false, killTimer;
    const finish = code => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (!error) clearTimeout(killTimer);
      resolve({ code, error, output });
    };
    const stop = reason => {
      if (error) return;
      error = reason;
      stopTree(child);
      killTimer = setTimeout(() => stopTree(child, 'SIGKILL'), 500);
      killTimer.unref();
    };
    const timer = setTimeout(() => stop('timeout'), options.timeoutMs || 20000);
    const append = data => {
      bytes += data.length;
      if (bytes > (options.maxBytes || 131072)) return stop('output_limit');
      output += data.toString('utf8');
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.on('error', () => { error = 'unavailable'; finish(null); });
    child.on('close', finish);
  });
}

class JobManager {
  constructor(options = {}) {
    this.env = options.env || process.env;
    this.workspace = fs.realpathSync(options.workspace || process.cwd());
    this.commands = options.commands || {};
    this.timeoutMs = options.timeoutMs || 30 * 60 * 1000;
    this.maxOutputBytes = options.maxOutputBytes || 2 * 1024 * 1024;
    this.jobs = new Map();
    this.children = new Map();
    this.acps = new Map();
  }

  agents() {
    return Object.entries(AGENTS).map(([id, agent]) => {
      const executable = Object.hasOwn(this.commands, id) ? this.commands[id] : findCommand(agent.command || id, this.env);
      const available = Boolean(executable) && !agent.unsupported;
      return { id, label: agent.label, available, installed: Boolean(executable), path: executable, status: !available ? (executable ? 'unsupported' : 'unavailable') : (Array.from(this.jobs.values()).some(job => job.agent === id && ACTIVE.has(job.status)) ? 'running' : 'available'), reason: agent.unsupported || (executable ? agent.installedReason || 'CLI installed; authentication and account limits are checked only when a task runs.' : 'CLI was not found on PATH.') };
    });
  }

  list() { return Array.from(this.jobs.values()).reverse().map(job => ({ ...job })); }

  start(input) {
    const allAgents = this.agents();
    const taskClass = input.taskClass || 'code';
    if (!Object.hasOwn(ROUTES, taskClass)) throw Object.assign(new Error('Task class must be code, design, planning, or discussion.'), { statusCode: 400 });
    const automatic = input.agent === 'auto';
    const agent = automatic ? ROUTES[taskClass].map(id => allAgents.find(item => item.id === id)).find(item => item?.available) : allAgents.find(item => item.id === input.agent);
    if (automatic && !agent) throw Object.assign(new Error('No supported installed provider is available for automatic routing. Install a supported CLI or select an available provider manually.'), { statusCode: 409 });
    if (!agent) throw Object.assign(new Error('Unsupported agent.'), { statusCode: 400 });
    if (!agent.available) throw Object.assign(new Error(agent.reason), { statusCode: 409 });
    if (typeof input.prompt !== 'string' || !input.prompt.trim() || Buffer.byteLength(input.prompt) > 32768) throw Object.assign(new Error('Prompt must contain 1–32768 bytes.'), { statusCode: 400 });
    if (this.children.size >= 2) throw Object.assign(new Error('Two jobs are already active. Wait or cancel one.'), { statusCode: 409 });
    let cwd;
    try {
      cwd = fs.realpathSync(input.cwd || this.workspace);
      if (!fs.statSync(cwd).isDirectory()) throw new Error();
    } catch { throw Object.assign(new Error('Choose an existing project directory.'), { statusCode: 400 }); }
    // A launcher's configured workspace is its authority boundary, including symlinks.
    if (cwd !== this.workspace && !cwd.startsWith(this.workspace + path.sep)) throw Object.assign(new Error('Project directory must be inside the configured workspace. Relaunch Route3 from the desired project.'), { statusCode: 403 });
    if (this.jobs.size >= 100) {
      const oldest = Array.from(this.jobs).find(([, job]) => !ACTIVE.has(job.status));
      if (oldest) this.jobs.delete(oldest[0]);
    }
    const skipped = automatic ? ROUTES[taskClass].slice(0, ROUTES[taskClass].indexOf(agent.id)).map(id => `${id} (${allAgents.find(item => item.id === id).status})`) : [];
    const definition = AGENTS[agent.id];
    const job = { id: crypto.randomUUID(), agent: agent.id, provider: agent.id, cwd, taskClass, routingReason: automatic ? `${taskClass} route selected ${agent.label} by installed capability; authentication unverified.${skipped.length ? ` Skipped: ${skipped.join(', ')}.` : ''}` : `Explicit provider selection: ${agent.label}; authentication unverified.`, sessionId: null, model: null, status: 'running', startedAt: new Date().toISOString(), endedAt: null, exitCode: null, stopReason: null, permissions: [], summary: redact(input.prompt.replace(/\s+/g, ' ')).slice(0, 180), logTail: '' };
    this.jobs.set(job.id, job);
    if (definition.acp) this.launchAcp(job, definition, agent, input);
    else this.launchProcess(job, definition, agent, input);
    return { ...job };
  }

  launchProcess(job, definition, agent, input) {
    const call = invocation(agent.path, definition.args, this.env);
    const child = spawn(call.command, call.args, { shell: false, cwd: job.cwd, env: call.env, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    this.children.set(job.id, child);
    let bytes = 0, rawTail = '', eventBuffer = '', finished = false;
    const timer = setTimeout(() => this.cancel(job.id, 'timed_out'), this.timeoutMs);
    timer.unref();
    const finish = (code, spawnError) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      this.children.delete(job.id);
      job.endedAt = new Date().toISOString();
      job.exitCode = code;
      if (job.status === 'running') job.status = spawnError ? 'failed' : code === 0 ? 'completed' : 'failed';
      if (spawnError) job.logTail = 'Agent could not start. Check its installation and local authentication.';
    };
    const append = data => {
      bytes += data.length;
      rawTail = (rawTail + data.toString('utf8')).slice(-20000);
      job.logTail = redact(rawTail).slice(-16000);
      eventBuffer += data.toString('utf8');
      const lines = eventBuffer.split('\n');
      eventBuffer = lines.pop().slice(-65536);
      for (const line of lines) {
        try {
          const event = JSON.parse(line);
          const sessionId = event.thread_id || event.session_id || event.sessionId;
          if (typeof sessionId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(sessionId)) job.sessionId = sessionId;
          if (typeof event.model === 'string' && event.model.length < 150) job.model = redact(event.model);
        } catch { /* log lines are not always structured events */ }
      }
      if (bytes > this.maxOutputBytes && job.status === 'running') this.cancel(job.id, 'output_limit');
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.on('error', () => finish(null, true));
    child.on('close', code => finish(code, false));
    child.stdin.on('error', () => { /* early CLI rejection; close reports failure */ });
    child.stdin.end(`Use the installed route3 skill to handle this task. Preserve configured model preferences and normal approval policies.\n\n${input.prompt}`);
  }

  launchAcp(job, definition, agent, input) {
    const brief = `Use the installed route3 skill to handle this task. Preserve configured model preferences and normal approval policies.\n\n${input.prompt}`;
    let bytes = 0, rawTail = '';
    const append = value => {
      bytes += Buffer.byteLength(value);
      rawTail = (rawTail + value).slice(-20000);
      job.logTail = redact(rawTail).slice(-16000);
      if (bytes > this.maxOutputBytes && ACTIVE.has(job.status)) this.cancel(job.id, 'output_limit');
    };
    const acp = new AcpAgent({ command: agent.path, args: definition.args, cwd: job.cwd, env: this.env, onEvent: event => this.acpEvent(job, event, append) });
    this.acps.set(job.id, acp);
    this.children.set(job.id, acp.child);
    const timer = setTimeout(() => this.cancel(job.id, 'timed_out'), this.timeoutMs);
    timer.unref();
    const finalize = () => {
      clearTimeout(timer);
      this.acps.delete(job.id);
      this.children.delete(job.id);
      job.permissions = [];
      job.endedAt = new Date().toISOString();
    };
    acp.start(brief).then(result => {
      if (ACTIVE.has(job.status)) job.status = 'completed';
      job.exitCode = 0;
      job.stopReason = typeof result?.stopReason === 'string' ? redact(result.stopReason).slice(0, 60) : null;
      finalize();
    }).catch(error => {
      if (job.status === 'running') {
        job.status = 'failed';
        job.logTail = redact(`${error.message}${acp.lastStderr ? `\n${acp.lastStderr}` : ''}`).slice(-16000) || job.logTail;
      }
      finalize();
    });
  }

  acpEvent(job, event, append) {
    if (event.type === 'session') {
      if (/^[A-Za-z0-9_-]{1,128}$/.test(event.sessionId)) job.sessionId = event.sessionId;
    } else if (event.type === 'message' || event.type === 'tool') {
      append(`${event.text}\n`);
    } else if (event.type === 'metadata') {
      job.model = event.model;
    } else if (event.type === 'permission') {
      job.permissions.push({ requestId: event.requestId, title: event.title, options: event.options });
      if (job.status === 'running') job.status = 'awaiting_approval';
    }
  }

  respondPermission(jobId, input) {
    const job = this.jobs.get(jobId);
    if (!job) throw Object.assign(new Error('Job not found.'), { statusCode: 404 });
    const acp = this.acps.get(jobId);
    const permission = Array.isArray(job.permissions) && typeof input?.requestId === 'string' && input.requestId.length > 0 && input.requestId.length <= 200
      ? job.permissions.find(item => item.requestId === input.requestId) : null;
    if (!acp || !permission) throw Object.assign(new Error('No active approval request matches this job.'), { statusCode: 404 });
    let optionId = input.optionId;
    if (optionId !== undefined && optionId !== null) {
      if (typeof optionId !== 'string' || optionId.length > 200 || !permission.options.some(option => option.optionId === optionId)) throw Object.assign(new Error('Choose one of the offered approval options.'), { statusCode: 400 });
    } else optionId = null;
    acp.respondPermission(permission.requestId, optionId);
    job.permissions = job.permissions.filter(item => item.requestId !== permission.requestId);
    if (!job.permissions.length && job.status === 'awaiting_approval') job.status = 'running';
    return { ...job };
  }

  cancel(id, reason = 'cancelled') {
    const job = this.jobs.get(id);
    if (!job) throw Object.assign(new Error('Job not found.'), { statusCode: 404 });
    const child = this.children.get(id);
    const acp = this.acps.get(id);
    if (child && ACTIVE.has(job.status)) {
      job.status = reason;
      job.permissions = [];
      if (acp) {
        // Ask the agent to stop its turn first; force-kill only if it hangs.
        acp.cancel().catch(() => { /* the close handler reports the final state */ });
        const hard = setTimeout(() => stopTree(child), 10000);
        hard.unref();
      } else {
        stopTree(child);
        const hard = setTimeout(() => stopTree(child, 'SIGKILL'), 1000);
        hard.unref();
      }
    }
    return { ...job };
  }

  shutdown() { for (const id of this.children.keys()) this.cancel(id); }
}

module.exports = { AGENTS, ROUTES, findCommand, invocation, boundedCommand, JobManager };
