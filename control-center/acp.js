'use strict';

// One supervised ACP turn per owned process. No prompt-mode auto approvals.
const { spawn } = require('node:child_process');
const { redact } = require('./security');
const MAX_LINE_BYTES = 262144;
const text = (value, limit = 500) => typeof value === 'string' && value.trim() ? redact(value).slice(0, limit) : null;

class AcpAgent {
  constructor({ command, args = [], cwd, env = process.env, spawnFn = spawn, onEvent = () => {}, maxOutputBytes = 2 * 1024 * 1024 }) {
    if (!command) throw new Error('A command is required.');
    Object.assign(this, { onEvent, cwd, maxOutputBytes, nextId: 1, pending: new Map(), permissions: new Map(), sessionId: null, buffer: '', done: false, closed: false, disposing: false, lastStderr: '', outputBytes: 0 });
    this.child = spawnFn(command, args, { shell: false, cwd, env, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.on('error', error => this.fail(`The agent could not start: ${error.message}`));
    this.child.on('close', (code, signal) => {
      this.closed = true;
      clearTimeout(this.killTimer);
      if (!this.done) this.fail(`The agent exited before finishing (${signal || `exit ${code}`}).`);
    });
    this.child.stdin.on('error', () => this.fail('The agent closed its input stream.'));
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', chunk => {
      if (this.accountOutput(chunk)) this.receiveChunk(chunk);
    });
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', chunk => {
      if (this.accountOutput(chunk)) this.lastStderr = (this.lastStderr + chunk).slice(-2000);
    });
  }

  accountOutput(chunk) {
    if (this.done) return false;
    this.outputBytes += Buffer.byteLength(chunk);
    if (this.outputBytes > this.maxOutputBytes) { this.fail('The agent exceeded its protocol output limit.', 'output_limit'); return false; }
    return true;
  }

  fail(message, code) {
    if (this.done) return;
    this.done = true;
    this.failure = Object.assign(new Error(redact(message)), code ? { code } : {});
    for (const entry of this.pending.values()) entry.reject(this.failure);
    this.pending.clear();
    this.permissions.clear();
    this.dispose();
  }

  receiveChunk(chunk) {
    this.buffer += chunk;
    let index;
    while (!this.done && (index = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 1);
      if (line.trim()) this.receive(line);
    }
    if (Buffer.byteLength(this.buffer) > MAX_LINE_BYTES) this.fail('The agent produced an unbounded protocol line.', 'output_limit');
  }

  receive(line) {
    if (this.done) return;
    if (Buffer.byteLength(line) > MAX_LINE_BYTES) return this.fail('The agent produced an unbounded protocol line.', 'output_limit');
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (!message || typeof message !== 'object' || Array.isArray(message)) return;
    if (typeof message.method === 'string' && message.id !== undefined) return this.serverRequest(message);
    if (typeof message.method === 'string') return this.notification(message);
    const entry = this.pending.get(message.id);
    if (entry) {
      this.pending.delete(message.id);
      if (message.error) entry.reject(new Error(text(message.error.message) || 'Agent protocol error.'));
      else entry.resolve(message.result);
    }
  }

  send(payload) {
    if (this.done) return;
    try { this.child.stdin.write(`${JSON.stringify(payload)}\n`); }
    catch { this.fail('The agent closed its input stream.'); }
  }

  request(method, params, timeoutMs = 30000) {
    if (this.done) return Promise.reject(this.failure || new Error('The agent session is closed.'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`The agent did not answer "${method}" within ${Math.round(timeoutMs / 1000)}s.`));
      }, timeoutMs);
      timer.unref();
      this.pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  serverRequest({ method, params = {}, id }) {
    if (method !== 'session/request_permission') return this.send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Not implemented by Route3.' } });
    const requestId = String(id);
    const options = (Array.isArray(params.options) ? params.options : []).filter(option => option && typeof option.optionId === 'string' && option.optionId.length > 0 && option.optionId.length <= 200 && ['allow_once','allow_always','reject_once','reject_always'].includes(option.kind)).slice(0, 16).map(option => ({ optionId: option.optionId, kind: option.kind, name: text(option.name, 120) || option.kind }));
    if (params.sessionId !== this.sessionId || !options.length || requestId.length > 200 || this.permissions.size >= 16 || this.permissions.has(requestId)) return this.send({ jsonrpc: '2.0', id, result: { outcome: { outcome: 'cancelled' } } });
    this.permissions.set(requestId, { rawId: id, options: new Set(options.map(option => option.optionId)) });
    const detail = params.toolCall?.rawInput ? text(JSON.stringify(params.toolCall.rawInput), 4000) : null;
    this.onEvent({ type: 'permission', requestId, title: text(params.toolCall?.title, 300) || text(params.toolCall?.kind, 60) || 'The agent requests a tool decision.', detail, options });
  }

  notification(message) {
    if (message.method !== 'session/update' || (message.params?.sessionId && message.params.sessionId !== this.sessionId)) return;
    const update = message.params?.update;
    if (!update || typeof update !== 'object') return;
    if (update.sessionUpdate === 'agent_message_chunk' && typeof update.content?.text === 'string') this.onEvent({ type: 'message', text: update.content.text });
    else if (['tool_call', 'tool_call_update'].includes(update.sessionUpdate)) {
      const parts = [text(update.title, 200) || text(update.kind, 60) || text(update.toolCallId, 120) || 'call', text(update.kind, 60), text(update.status, 60)].filter(Boolean);
      this.onEvent({ type: 'tool', text: parts.join(' · ') });
    } else if (update.sessionUpdate === 'session_metadata') {
      const model = text(update.model, 150);
      if (model) this.onEvent({ type: 'metadata', model });
    }
  }

  async start(promptText) {
    try {
      const initialized = await this.request('initialize', { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false }, clientInfo: { name: 'route3-control', version: '2.0.1' } });
      if (initialized?.protocolVersion !== 1) throw new Error('The agent negotiated an unsupported ACP protocol version.');
      const session = await this.request('session/new', { cwd: this.cwd, mcpServers: [] });
      if (typeof session?.sessionId !== 'string' || !session.sessionId) throw new Error('The agent did not provide a session id.');
      this.sessionId = session.sessionId;
      this.onEvent({ type: 'session', sessionId: session.sessionId.slice(0, 128) });
      if (session.models?.currentModelId) this.onEvent({ type: 'metadata', model: text(session.models.currentModelId, 150) });
      const result = await this.request('session/prompt', { sessionId: this.sessionId, prompt: [{ type: 'text', text: promptText }] }, 24 * 60 * 60 * 1000);
      if (!result || typeof result.stopReason !== 'string') throw new Error('The agent did not report a prompt stop reason.');
      return result;
    } finally {
      this.dispose();
    }
  }

  respondPermission(requestId, optionId) {
    const pending = this.permissions.get(requestId);
    if (!pending || this.done) return false;
    if (optionId != null && !pending.options.has(optionId)) return false;
    this.permissions.delete(requestId);
    const outcome = optionId != null ? { outcome: 'selected', optionId } : { outcome: 'cancelled' };
    this.send({ jsonrpc: '2.0', id: pending.rawId, result: { outcome } });
    return true;
  }

  async cancel() {
    if (this.done) return;
    for (const requestId of [...this.permissions.keys()]) this.respondPermission(requestId, null);
    if (this.sessionId) this.send({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId: this.sessionId } });
  }

  signal(signal) {
    if (this.closed || !this.child.pid) return;
    try {
      if (process.platform !== 'win32') process.kill(-this.child.pid, signal);
      else this.child.kill(signal);
    } catch (error) { if (error.code !== 'ESRCH') { try { this.child.kill(signal); } catch {} } }
  }

  dispose() {
    if (this.disposing) return;
    this.disposing = true;
    this.done = true;
    for (const entry of this.pending.values()) entry.reject(this.failure || new Error('The agent session was closed.'));
    this.pending.clear();
    this.permissions.clear();
    this.signal('SIGTERM');
    if (!this.closed) {
      this.killTimer = setTimeout(() => this.signal('SIGKILL'), 1000);
      this.killTimer.unref();
    }
  }
}

module.exports = { AcpAgent };
