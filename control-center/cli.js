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
  graphs list | show <id> | create | start <id> --hash HASH
         pause <id> | resume <id> | cancel <id> | wait <id> [--timeout SECONDS]
         reconcile <id> --node ID --action attach|fail [--job ID] [--note "…"]
         tasks <id> | members <id> | messages <id>
         claim <id> --node ID --member ID | release <id> --node ID --member ID
         message <id> --from ID --to ID|team [--task ID] --text "…" | --text-stdin
       create: --file PATH | --from-stdin (JSON definition)
               --prompt "…" | --prompt-stdin  --check-argv '["command","arg"]'
               [--source-key REVISION] [--attempts 1..5] [--agent …] [--class …] [--expert ID] [--notebook ID] [--cwd PATH]
               [--max-agent-attempts N] [--max-elapsed-ms N] [--max-concurrent-tasks N]
       start requires the exact definitionHash returned by create/show.
       wait returns on pause, block or completion; provider approvals stay explicit.
  harness report <graphId>                 structured policy, usage and recovery report
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

function graphInput(options) {
  const file = Object.hasOwn(options, 'file');
  const stdin = Object.hasOwn(options, 'from-stdin');
  const prompt = Object.hasOwn(options, 'prompt') || Object.hasOwn(options, 'prompt-stdin');
  if (Number(file) + Number(stdin) + Number(prompt) !== 1) throw new UsageError('Choose one graph source: --file PATH, --from-stdin, or --prompt/--prompt-stdin.');
  if (file || stdin) {
    if (['check-argv', 'source-key', 'attempts', 'agent', 'class', 'expert', 'notebook', 'cwd', 'max-agent-attempts', 'max-elapsed-ms', 'max-concurrent-tasks'].some(key => Object.hasOwn(options, key))) throw new UsageError('Prompt options apply only to a prompt graph; edit the JSON definition to change its nodes.');
    let raw;
    if (file) {
      if (typeof options.file !== 'string' || !options.file) throw new UsageError('--file PATH is required.');
      try { raw = fs.readFileSync(options.file, 'utf8'); } catch { throw new UsageError('Cannot read graph definition file.'); }
    } else raw = readStdin();
    let definition;
    try { definition = JSON.parse(raw); } catch { throw new UsageError('Graph definition must be valid JSON.'); }
    if (!definition || Array.isArray(definition) || typeof definition !== 'object') throw new UsageError('Graph definition must be a JSON object.');
    return { definition };
  }
  if (options.prompt && options['prompt-stdin']) throw new UsageError('Choose --prompt or --prompt-stdin.');
  let command;
  try { command = JSON.parse(options['check-argv']); } catch { throw new UsageError('--check-argv must be a JSON array of command arguments.'); }
  if (!Array.isArray(command) || !command.length || command.some(arg => typeof arg !== 'string') || !command[0]) throw new UsageError('--check-argv must be a nonempty JSON array of strings.');
  const input = { ...taskInput(options), command };
  // Graph definitions store notebook ids; only the server resolves their brain.
  if (input.notebook) { input.notebookId = input.notebook; delete input.notebook; }
  if (Object.hasOwn(options, 'source-key')) {
    if (typeof options['source-key'] !== 'string' || !options['source-key'].trim()) throw new UsageError('--source-key requires a source revision.');
    input.sourceKey = options['source-key'];
  }
  if (options.agent) input.agent = String(options.agent);
  if (options.cwd) input.cwd = String(options.cwd);
  if (Object.hasOwn(options, 'attempts')) {
    const attempts = Number(options.attempts);
    if (typeof options.attempts !== 'string' || !Number.isInteger(attempts) || attempts < 1 || attempts > 5) throw new UsageError('--attempts must be an integer from 1 to 5.');
    input.maxAttempts = attempts;
  }
  for (const [flag, field] of [['max-agent-attempts', 'maxAgentAttempts'], ['max-elapsed-ms', 'maxElapsedMs'], ['max-concurrent-tasks', 'maxConcurrentTasks']]) {
    if (!Object.hasOwn(options, flag)) continue;
    const value = Number(options[flag]);
    if (typeof options[flag] !== 'string' || !Number.isSafeInteger(value) || value <= 0) throw new UsageError(`--${flag} must be a positive integer.`);
    (input.harness ||= {})[field] = value;
  }
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

  if (group === 'harness' && action === 'report') return api.get(`/api/graphs/${encodeURIComponent(need(target, 'graph id'))}/harness`);

  if (group === 'graphs') {
    if (action === 'list') return api.get('/api/graphs');
    if (action === 'create') return api.post('/api/graphs', graphInput(options));
    const graphPath = () => `/api/graphs/${encodeURIComponent(need(target, 'graph id'))}`;
    const optionText = name => {
      if (typeof options[name] !== 'string' || !options[name].trim()) throw new UsageError(`--${name} requires text.`);
      return options[name];
    };
    if (action === 'show') return api.get(graphPath());
    if (['tasks', 'members', 'messages'].includes(action)) {
      const { graph } = await api.get(graphPath());
      if (action === 'messages') return { graphId: graph.id, messages: graph.messages || [] };
      if (action === 'members') return { graphId: graph.id, lead: graph.team.lead, members: graph.team.members };
      return { graphId: graph.id, tasks: graph.definition.nodes.map(node => ({ id: node.id, type: node.type, assignee: node.assignee, ...graph.nodes[node.id] })) };
    }
    if (action === 'claim' || action === 'release') return api.post(`${graphPath()}/${action}`, { nodeId: optionText('node'), memberId: optionText('member') });
    if (action === 'message') {
      const input = { from: optionText('from'), to: optionText('to'), body: textOption(options, 'text') };
      if (Object.hasOwn(options, 'task')) input.taskId = optionText('task');
      return api.post(`${graphPath()}/message`, input);
    }
    if (action === 'start') {
      if (typeof options.hash !== 'string' || !options.hash.trim()) throw new UsageError('--hash HASH is required. Review the graph definitionHash before starting.');
      return api.post(`${graphPath()}/start`, { definitionHash: options.hash });
    }
    if (['pause', 'resume', 'cancel'].includes(action)) return api.post(`${graphPath()}/${action}`);
    if (action === 'reconcile') {
      if (!['attach', 'fail'].includes(options.action)) throw new UsageError('--action must be attach or fail.');
      if (typeof options.node !== 'string' || !options.node.trim()) throw new UsageError('--node ID is required.');
      const input = { nodeId: options.node, action: options.action };
      if (options.action === 'attach') {
        if (typeof options.job !== 'string' || !options.job.trim()) throw new UsageError('--job ID is required for attach.');
        input.jobId = options.job;
      }
      if (Object.hasOwn(options, 'note')) {
        if (typeof options.note !== 'string' || !options.note.trim()) throw new UsageError('--note requires text.');
        input.note = options.note;
      }
      return api.post(`${graphPath()}/reconcile`, input);
    }
    if (action === 'wait') {
      const timeout = Object.hasOwn(options, 'timeout') ? Number(options.timeout) : 1800;
      if (!Number.isFinite(timeout) || timeout <= 0 || options.timeout === true) throw new UsageError('--timeout must be a positive number of seconds.');
      const pathname = graphPath();
      const deadline = Date.now() + timeout * 1000;
      for (;;) {
        const result = await api.get(pathname);
        if (result.graph.status !== 'running') return result;
        if (Object.values(result.graph.nodes || {}).some(node => node.status === 'awaiting_approval')) return { ...result, note: 'A graph job is waiting for provider approval. Review jobs list and use jobs approve <id> --request R --option O.' };
        if (Date.now() >= deadline) return { ...result, note: 'Timed out while the graph was still active; it keeps running.' };
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
