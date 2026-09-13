'use strict';

// Minimal Agent Client Protocol (ACP) client: newline-delimited JSON-RPC 2.0
// over stdio. Only the operations the control center needs are implemented.
// Unknown server requests get a JSON-RPC error so an agent never blocks on an
// unanswered capability, and every surface text is redacted before display.

const { spawn } = require('node:child_process');
const { redact } = require('./security');

const PROTOCOL_VERSION = 1;
const MAX_LINE_BYTES = 262144;
const text = (value, limit = 500) => typeof value === 'string' && value.trim() ? redact(value).slice(0, limit) : null;

class AcpAgent {
  constructor({ command, args = [], cwd, env = process.env, spawnFn = spawn, onEvent = () => {} }) {
    if (!command) throw new Error('A command is required.');
    this.onEvent = onEvent;
    this.cwd = cwd;
    this.nextId = 1;
    this.pending = new Map();
    this.permissions = new Map();
    this.sessionId = null;
    this.buffer = '';
    this.done = false;
    this.lastStderr = '';
    this.turn = new Promise((resolve, reject) => { this.settle = { resolve, reject }; });
    this.child = spawnFn(command, args, { shell: false, cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.on('error', error => this.fail(`The agent could not start: ${error.message}`));
    this.child.on('close', (code, signal) => this.fail(`The agent exited before finishing (${signal || `exit ${code}`}).`));
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', chunk => this.receiveChunk(chunk));
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', chunk => { this.lastStderr = (this.lastStderr + chunk).slice(-2000); });
  }

  fail(message) {
    if (this.done) return;
    this.done = true;
    for (const { reject } of this.pending.values()) reject(new Error(message));
    this.pending.clear();
    this.permissions.clear();
    this.settle.reject(new Error(message));
  }

  receiveChunk(chunk) {
    this.buffer += chunk;
    let index;
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 1);
      if (line.trim()) this.receive(line);
    }
    if (Buffer.byteLength(this.buffer) > MAX_LINE_BYTES) this.fail('The agent produced an unbounded protocol line.');
  }

  receive(line) {
    if (Buffer.byteLength(line) > MAX_LINE_BYTES) return this.fail('The agent produced an unbounded protocol line.');
    let message;
    try { message = JSON.parse(line); } catch { return; /* agents may print plain logs on stdio */ }
    if (!message || typeof message !== 'object' || Array.isArray(message)) return;
    if (typeof message.method === 'string' && message.id !== undefined) return this.serverRequest(message);
    if (typeof message.method === 'string') return this.notification(message);
    if (message.id !== undefined) {
      const entry = this.pending.get(message.id);
      if (entry) {
        this.pending.delete(message.id);
        if (message.error) entry.reject(new Error(text(message.error.message) || `Agent protocol error ${message.error.code}.`));
        else entry.resolve(message.result);
      }
    }
  }

  send(payload) {
    if (this.done) return;
    try { this.child.stdin.write(`${JSON.stringify(payload)}\n`); }
    catch { this.fail('The agent closed its input stream.'); }
  }

  request(method, params, timeoutMs = 30000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`The agent did not answer "${method}" within ${Math.round(timeoutMs / 1000)}s.`));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  serverRequest(message) {
    const { method, params = {}, id } = message;
    if (method !== 'session/request_permission') {
      return this.send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Not implemented by the Route3 control center.' } });
    }
    const options = (Array.isArray(params.options) ? params.options : [])
      .filter(option => option && typeof option.optionId === 'string' && option.optionId)
      .map(option => ({ optionId: option.optionId.slice(0, 200), kind: text(option.kind, 60), name: text(option.name, 120) || text(option.kind, 60) || option.optionId.slice(0, 200) }));
    if (!options.length) return this.send({ jsonrpc: '2.0', id, result: { outcome: { outcome: 'cancelled' } } });
    const requestId = String(id).slice(0, 200);
    this.permissions.set(requestId, { rawId: id });
    this.onEvent({ type: 'permission', requestId, title: text(params.toolCall?.title, 300) || text(params.toolCall?.kind, 60) || 'The agent requests a tool decision.', options });
  }

  notification(message) {
    if (message.method !== 'session/update') return;
    const update = message.params?.update;
    if (!update || typeof update !== 'object') return;
    const kind = update.sessionUpdate;
    if (kind === 'agent_message_chunk') {
      if (typeof update.content?.text === 'string' && update.content.text) this.onEvent({ type: 'message', text: update.content.text });
    } else if (kind === 'tool_call' || kind === 'tool_call_update') {
      const parts = [text(update.title, 200) || text(update.kind, 60) || String(update.toolCallId || 'call')];
      if (update.kind) parts.push(update.kind);
      if (update.status) parts.push(update.status);
      this.onEvent({ type: 'tool', text: parts.join(' · ') });
    } else if (kind === 'session_metadata') {
      const model = text(update.model, 150) || text(update.agentName, 150);
      if (model) this.onEvent({ type: 'metadata', model });
    }
  }

  async start(promptText) {
    await this.request('initialize', { protocolVersion: PROTOCOL_VERSION, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } } });
    this.send({ jsonrpc: '2.0', method: 'initialized' });
    const session = await this.request('session/new', { cwd: this.cwd, mcpServers: {} });
    if (typeof session?.sessionId !== 'string' || !session.sessionId) throw new Error('The agent did not provide a session id.');
    this.sessionId = session.sessionId;
    this.onEvent({ type: 'session', sessionId: session.sessionId.slice(0, 128) });
    const result = await this.request('session/prompt', { sessionId: this.sessionId, prompt: [{ type: 'text', text: promptText }] }, 24 * 60 * 60 * 1000);
    this.done = true;
    this.permissions.clear();
    this.settle.resolve(result || {});
    return result || {};
  }

  respondPermission(requestId, optionId) {
    const pending = this.permissions.get(requestId);
    if (!pending) return false;
    this.permissions.delete(requestId);
    if (this.done) return true;
    const outcome = typeof optionId === 'string' && optionId ? { outcome: 'selected', optionId: optionId.slice(0, 200) } : { outcome: 'cancelled' };
    this.send({ jsonrpc: '2.0', id: pending.rawId, result: { outcome } });
    return true;
  }

  async cancel() {
    if (this.done) return;
    for (const requestId of [...this.permissions.keys()]) this.respondPermission(requestId, null);
    if (this.sessionId) {
      try { await this.request('session/cancel', { sessionId: this.sessionId, reason: 'cancelled' }, 5000); }
      catch { /* the prompt response or process close reports the final state */ }
    }
  }

  dispose() {
    this.done = true;
    try { this.child.kill('SIGTERM'); } catch { /* already stopped */ }
    const kill = setTimeout(() => { try { this.child.kill('SIGKILL'); } catch { /* already stopped */ } }, 2000);
    kill.unref?.();
  }
}

module.exports = { AcpAgent };
