'use strict';

const { findCommand, boundedCommand } = require('./process-manager');
const { redact } = require('./security');

const ACTIONS = {
  openclaw: ['status', 'start', 'stop', 'restart'],
  browser: ['status', 'start', 'stop'],
  telegram: ['status', 'start', 'stop'],
};
const LABELS = { openclaw: 'OpenClaw Gateway', browser: 'OpenClaw Browser', telegram: 'Telegram · default account' };

function classify(result) {
  if (result.error === 'unavailable') return 'unavailable';
  if (result.error === 'timeout') return 'timeout';
  if (result.error === 'output_limit') return 'output_limit';
  if (/unauthorized|forbidden|auth.*(?:fail|missing|invalid)|token.*(?:mismatch|missing)|operator\.(?:admin|read)|pairing required/i.test(result.output)) return 'auth_error';
  if (result.code !== 0) return /ECONNREFUSED|gateway.*(?:not running|unreachable)|connect.*failed|1006/i.test(result.output) ? 'offline' : 'error';
  return null;
}

function parseJSON(output) {
  try { return JSON.parse(output.trim()); } catch { /* CLI may prefix logs */ }
  const start = output.indexOf('{');
  const end = output.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(output.slice(start, end + 1)); } catch { /* unknown format */ }
  }
  return null;
}

function observedStatus(service, data) {
  if (!data || typeof data !== 'object') return 'unknown';
  if (service === 'browser') return data.running === true ? 'running' : data.running === false ? 'stopped' : 'unknown';
  if (service === 'openclaw') {
    if (data.rpc?.ok === true) return 'running';
    const state = data.service?.runtime?.status || data.runtime?.status;
    if (state === 'running') return data.rpc?.ok === false ? 'degraded' : 'running';
    if (['stopped', 'inactive', 'not-found', 'exited'].includes(state)) return 'stopped';
    if (data.rpc?.ok === false) return 'offline';
    return 'unknown';
  }
  const defaultId = data.channelDefaultAccountId?.telegram;
  const accounts = data.channelAccounts?.telegram;
  const account = Array.isArray(accounts) ? accounts.find(item => item.accountId === (defaultId || 'default')) : null;
  const channel = account || data.channels?.telegram;
  if (!channel) return 'not_configured';
  if (channel.enabled === false || channel.configured === false) return channel.configured === false ? 'not_configured' : 'disabled';
  if (channel.running === true) return 'running';
  if (channel.running === false) return 'stopped';
  return 'unknown';
}

function commandFor(service, action) {
  if (service === 'openclaw') return ['gateway', action, ...(action === 'status' ? ['--json'] : [])];
  if (service === 'browser') return ['browser', '--json', action];
  if (action === 'status') return ['channels', 'status', '--channel', 'telegram', '--json'];
  return ['gateway', 'call', `channels.${action}`, '--params', JSON.stringify({ channel: 'telegram' }), '--json'];
}

class Integrations {
  constructor(options = {}) {
    this.env = options.env || process.env;
    this.command = Object.hasOwn(options, 'command') ? options.command : findCommand('openclaw', this.env);
    this.run = options.run || boundedCommand;
    this.timeoutMs = options.timeoutMs || 20000;
    this.state = {};
    this.busy = false;
    for (const id of Object.keys(ACTIONS)) {
      this.state[id] = {
        id, label: LABELS[id], available: Boolean(this.command), status: this.command ? 'unchecked' : 'unavailable',
        message: this.command ? 'Status has not been checked. Use Check status for a live observation.' : 'OpenClaw CLI was not found on PATH.',
        checkedAt: null, actions: ACTIONS[id].map(action => ({ id: action, label: action === 'status' ? 'Check status' : `${action[0].toUpperCase()}${action.slice(1)}${id === 'telegram' ? ' default account' : ''}`, available: Boolean(this.command) })),
      };
    }
  }

  snapshot() { return JSON.parse(JSON.stringify(this.state)); }

  async action(service, action) {
    if (!Object.hasOwn(ACTIONS, service) || !ACTIONS[service].includes(action)) {
      throw Object.assign(new Error('Unsupported integration action. Telegram supports status/start/stop for the configured default account; credential and configuration editing are unavailable.'), { statusCode: 400 });
    }
    if (!this.command) return this.state[service];
    if (this.busy) throw Object.assign(new Error('An integration command is already running.'), { statusCode: 409 });
    this.busy = true;
    try {
      const result = await this.run(this.command, commandFor(service, action), { env: this.env, timeoutMs: this.timeoutMs });
      const failure = classify(result);
      const state = this.state[service];
      state.checkedAt = new Date().toISOString();
      if (failure) {
        state.status = failure;
        state.message = failure === 'timeout' ? 'OpenClaw did not respond before the command timeout.' : failure === 'unavailable' ? 'OpenClaw could not be started. Check its installation and Node runtime.' : redact(result.output).slice(-1000).trim() || `OpenClaw command failed (${failure}).`;
        return { ...state };
      }
      if (action !== 'status') {
        // Command acceptance alone is not evidence the service is running.
        state.status = 'unknown';
        state.message = `${action[0].toUpperCase()}${action.slice(1)} request completed. Check status to verify the current state.`;
      } else {
        state.status = observedStatus(service, parseJSON(result.output));
        state.message = state.status === 'unknown' ? 'Command succeeded, but its output did not provide a recognized runtime state.' : `Observed ${state.status.replaceAll('_', ' ')}${service === 'telegram' ? ' for the configured default account' : ''}.`;
      }
      return { ...state };
    } finally { this.busy = false; }
  }
}

module.exports = { Integrations, classify, parseJSON, observedStatus, commandFor };
