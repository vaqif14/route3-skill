#!/usr/bin/env node
'use strict';

// Route3 CLI client — the interface AI agents use to drive the local control
// center. It speaks to the running server on 127.0.0.1 (app or LaunchAgent),
// prints one JSON document per call, never prompts, and never places secrets
// in argv: the Telegram token is read from stdin only. Provider approvals are
// not granted here; `jobs approve` forwards one explicit decision.
//
// Exit codes: 0 ok · 2 usage · 3 server unreachable · 4 request rejected.

const fs = require('node:fs');

const USAGE = `route3-skill <group> <action> [options]      (all output is JSON)

  state                                   full control-center state
  jobs list | start | wait <id> | cancel <id> | approve <id> --request R --option O
       start: --prompt "…" | --prompt-stdin  [--agent auto|codex|claude|gemini|kimi]
              [--class code|design|planning|discussion] [--expert ID] [--notebook ID] [--cwd PATH]
       wait:  [--timeout SECONDS]  polls until the job leaves running/awaiting_approval
  night status | report | queue | schedule | remove <id>
       queue:    --prompt "…" | --prompt-stdin  [--class …] [--expert ID] [--notebook ID]
       schedule: [--on | --off] [--start HH:MM] [--end HH:MM]
  brain list | refresh                    NotebookLM notebooks known to this Mac
  experts list | draft | create | remove <id>
       draft:  --notebook ID [--hint "…"]        (asks the notebook; 1–5 min)
       create: --label "…" --brief "…" [--focus "…"] [--notebook ID]  |  --from-draft-stdin
  telegram status | configure --token-stdin | start | stop | pairing | unpair | disconnect

Global: --port N (default $ROUTE3_PORT or 43173), --pretty`;

class UsageError extends Error {}

function parse(argv) {
  const positional = [], options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { options[key] = next; i++; } else options[key] = true;
    } else positional.push(arg);
  }
  return { positional, options };
}

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

function textOption(options, name) {
  if (options[`${name}-stdin`]) {
    const text = readStdin().trim();
    if (!text) throw new UsageError(`Nothing on stdin for --${name}-stdin.`);
    return text;
  }
  if (typeof options[name] === 'string' && options[name].trim()) return options[name].trim();
  throw new UsageError(`--${name} "…" or --${name}-stdin is required.`);
}

function client(port) {
  const base = `http://127.0.0.1:${port}`;
  let token = null;
  async function call(method, pathname, body, timeoutMs = 35000) {
    if (method !== 'GET' && !token) token = (await call('GET', '/api/bootstrap')).token;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetch(base + pathname, { method, signal: controller.signal, headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' ? { 'X-Route3-Token': token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (error) {
      const reason = error.name === 'AbortError' ? `no answer within ${Math.round(timeoutMs / 1000)}s` : 'connection refused';
      throw Object.assign(new Error(`Route3 server is not reachable on 127.0.0.1:${port} (${reason}). Open Route3 Control or run: route3-skill service install --workspace <project>`), { exitCode: 3 });
    } finally { clearTimeout(timer); }
    let data;
    try { data = await response.json(); } catch { throw Object.assign(new Error(`Route3 server returned a non-JSON answer (${response.status}).`), { exitCode: 4 }); }
    if (!response.ok) throw Object.assign(new Error(typeof data.error === 'string' ? data.error : `Request rejected (${response.status}).`), { exitCode: 4, status: response.status });
    return data;
  }
  return { get: pathname => call('GET', pathname), post: (pathname, body = {}, timeoutMs) => call('POST', pathname, body, timeoutMs), del: pathname => call('DELETE', pathname) };
}

const ACTIVE = new Set(['running', 'awaiting_approval']);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function taskInput(options) {
  const input = { prompt: textOption(options, 'prompt') };
  if (options.class) input.taskClass = String(options.class);
  if (options.expert) input.expert = String(options.expert);
  if (options.notebook) input.notebook = String(options.notebook);
  return input;
}

async function main(argv = process.argv.slice(2), { pollMs = 2000 } = {}) {
  const { positional, options } = parse(argv);
  const [group, action, target] = positional;
  const port = Number(options.port || process.env.ROUTE3_PORT || 43173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new UsageError('Port must be an integer from 1 to 65535.');
  const api = client(port);
  const need = (value, what) => { if (!value) throw new UsageError(`${what} is required.`); return String(value); };

  if (!group || group === 'help') throw new UsageError(USAGE);

  if (group === 'state') return api.get('/api/state');

  if (group === 'jobs') {
    if (action === 'list') return { jobs: (await api.get('/api/state')).jobs };
    if (action === 'start') {
      const input = { agent: String(options.agent || 'auto'), ...taskInput(options) };
      if (options.cwd) input.cwd = String(options.cwd);
      return api.post('/api/jobs', input);
    }
    if (action === 'cancel') return api.post(`/api/jobs/${encodeURIComponent(need(target, 'job id'))}/cancel`);
    if (action === 'approve') return api.post(`/api/jobs/${encodeURIComponent(need(target, 'job id'))}/permission`, { requestId: need(options.request, '--request'), optionId: need(options.option, '--option') });
    if (action === 'wait') {
      let id = need(target, 'job id');
      const followed = [];
      const deadline = Date.now() + Number(options.timeout || 1800) * 1000;
      for (;;) {
        const job = (await api.get('/api/state')).jobs.find(item => item.id === id);
        if (!job) throw Object.assign(new Error('Job not found.'), { exitCode: 4 });
        if (job.failoverTo) {
          if (followed.length >= 4) throw Object.assign(new Error(`Failover chain too long (${[...followed, job.id].join(' → ')}); inspect jobs list.`), { exitCode: 4 });
          followed.push(job.id); id = job.failoverTo; continue;
        }
        if (!ACTIVE.has(job.status)) return followed.length ? { job, note: `Rerouted from ${followed.join(' → ')} after the provider quota/session ended.`, followed } : { job };
        if (job.status === 'awaiting_approval' && job.permissions?.length) return { job, note: 'The job is waiting for an approval. Decide in the panel, on Telegram, or with: jobs approve <id> --request R --option O' };
        if (Date.now() > deadline) return { job, note: 'Timed out while the job was still active; it keeps running.' };
        await sleep(pollMs);
      }
    }
  }

  if (group === 'night') {
    if (action === 'status') return { nightShift: (await api.get('/api/state')).nightShift };
    if (action === 'report') return { report: (await api.get('/api/state')).nightShift.report };
    if (action === 'queue') return api.post('/api/night-shift/queue', taskInput(options));
    if (action === 'schedule') {
      const body = {};
      if (options.on) body.enabled = true;
      if (options.off) body.enabled = false;
      if (options.start) body.start = String(options.start);
      if (options.end) body.end = String(options.end);
      if (!Object.keys(body).length) throw new UsageError('Give --on/--off and/or --start HH:MM --end HH:MM.');
      return api.post('/api/night-shift/schedule', body);
    }
    if (action === 'remove') return api.del(`/api/night-shift/items/${encodeURIComponent(need(target, 'item id'))}`);
  }

  if (group === 'brain') {
    if (action === 'list') return { notebooklm: (await api.get('/api/state')).notebooklm };
    if (action === 'refresh') return api.post('/api/notebooklm/refresh');
  }

  if (group === 'experts') {
    if (action === 'list') return { experts: (await api.get('/api/state')).experts };
    if (action === 'draft') return api.post('/api/experts/draft', { notebook: need(options.notebook, '--notebook'), hint: typeof options.hint === 'string' ? options.hint : '' }, 330000);
    if (action === 'create') {
      let input;
      if (options['from-draft-stdin']) {
        let draft;
        try { draft = JSON.parse(readStdin()); } catch { throw new UsageError('--from-draft-stdin expects the JSON printed by `experts draft` (or its .draft object).'); }
        draft = draft?.draft || draft;
        input = { label: draft?.label, focus: draft?.focus, brief: draft?.brief, notebook: draft?.brain?.id };
      } else input = { label: need(options.label, '--label'), brief: need(options.brief, '--brief'), focus: typeof options.focus === 'string' ? options.focus : undefined, notebook: options.notebook ? String(options.notebook) : undefined };
      return api.post('/api/experts', input);
    }
    if (action === 'remove') return api.del(`/api/experts/${encodeURIComponent(need(target, 'expert id'))}`);
  }

  if (group === 'telegram') {
    if (action === 'status') return { telegramRemote: (await api.get('/api/state')).telegramRemote };
    if (action === 'configure') {
      if (!options['token-stdin']) throw new UsageError('The bot token is read from stdin only: printf "%s" "$TOKEN" | route3-skill telegram configure --token-stdin');
      const token = readStdin().trim();
      if (!token) throw new UsageError('Nothing on stdin for --token-stdin.');
      return api.post('/api/telegram/configure', { token });
    }
    if (['start', 'stop', 'pairing', 'unpair', 'disconnect'].includes(action)) return api.post(`/api/telegram/${action}`);
  }

  throw new UsageError(USAGE);
}

if (require.main === module) {
  main().then(result => {
    process.stdout.write(JSON.stringify(result, null, process.argv.includes('--pretty') ? 2 : 0) + '\n');
  }).catch(error => {
    const exitCode = error instanceof UsageError ? 2 : error.exitCode || 1;
    process.stderr.write(JSON.stringify({ error: error.message, exitCode }) + '\n');
    process.exitCode = exitCode;
  });
}

module.exports = { main, parse, USAGE };
