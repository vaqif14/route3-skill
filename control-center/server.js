#!/usr/bin/env node
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { equalToken } = require('./security');
const { JobManager } = require('./process-manager');
const { Integrations } = require('./integrations');
const { ExpertRegistry } = require('./experts');
const { TelegramBridge } = require('./telegram-bridge');
const { NightShift } = require('./night-shift');
const { NotebookLM } = require('./notebooklm');
const { GraphManager, compilePrompt } = require('./graph-runtime');
const { buildAgentTree } = require('./agent-tree');

const STATIC = { '/': ['index.html', 'text/html; charset=utf-8'], '/index.html': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/agent-tree.js': ['agent-tree.js', 'text/javascript; charset=utf-8'], '/agent-tree.css': ['agent-tree.css', 'text/css; charset=utf-8'], '/styles.css': ['styles.css', 'text/css; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'] };

function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

function readJSON(request) {
  return new Promise((resolve, reject) => {
    const chunks = []; let bytes = 0, failed = false;
    request.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > 40000) {
        if (!failed) reject(Object.assign(new Error('Request body is too large.'), { statusCode: 413 }));
        failed = true;
        return;
      }
      if (!failed) chunks.push(chunk);
    });
    request.on('end', () => {
      if (failed) return;
      try {
        const data = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error();
        resolve(data);
      } catch { reject(Object.assign(new Error('A JSON object is required.'), { statusCode: 400 })); }
    });
    request.on('error', () => reject(Object.assign(new Error('Request interrupted.'), { statusCode: 400 })));
  });
}

function createServer(options = {}) {
  const token = crypto.randomBytes(32).toString('hex');
  const workspace = fs.realpathSync(options.workspace || process.env.ROUTE3_WORKSPACE || process.cwd());
  if (!fs.statSync(workspace).isDirectory()) throw new Error('Workspace must be a directory.');
  const experts = options.experts || new ExpertRegistry({ home: options.home });
  const jobs = options.jobs || new JobManager({ workspace, experts, ...(options.persistJobs ? { historyFile: path.join(options.home || os.homedir(), `.local/share/route3/history/${crypto.createHash('sha256').update(workspace).digest('hex').slice(0,24)}.json`) } : {}), ...options.jobOptions });
  const notebooklm = options.notebooklm || new NotebookLM(options.notebookOptions);
  const telegram = options.telegramBridge || new TelegramBridge({ jobs, notebooklm, home: options.home, workspace });
  const integrations = options.integrations || new Integrations(options.integrationOptions);
  const nightShift = options.nightShift || new NightShift({ jobs, experts, ...(options.persistJobs ? { file: path.join(options.home || os.homedir(), `.local/share/route3/night-shift/${crypto.createHash('sha256').update(workspace).digest('hex').slice(0,24)}.json`) } : {}) });
  // Only server-verified notebooks may enter provider jobs, including delayed
  // graph launches. Re-resolve each launch rather than trusting a saved brain.
  const grounded = async input => {
    const { brain: _client, notebook, notebookId, ...rest } = input;
    let brain = await notebooklm.resolve(notebookId ?? notebook);
    if (!brain && typeof rest.expert === 'string') {
      const expert = experts.find(rest.expert);
      if (expert?.brain) {
        try { brain = await notebooklm.resolve(expert.brain.id); }
        catch { throw Object.assign(new Error(`The notebook bound to expert "${expert.label}" is no longer on this account. Refresh the NotebookLM list or recreate the expert.`), { statusCode: 400 }); }
      }
    }
    return { ...rest, brain };
  };
  let graphs = options.graphs;
  if (!graphs) {
    try { graphs = new GraphManager({ ...options.graphOptions, jobs, workspace, prepareJob: grounded, ...(options.persistJobs ? { file: path.join(options.home || os.homedir(), `.local/share/route3/graphs/${crypto.createHash('sha256').update(workspace).digest('hex').slice(0,24)}.json`) } : {}) }); }
    catch {
      // Preserve independent jobs and Night Shift when graph storage cannot be
      // opened safely. Never substitute an empty writable graph manager.
      const historyWarning = 'Graph checkpoints could not be opened safely; graph operations are unavailable. Repair local graph state or close the other Route3 instance before restarting.';
      const unavailable = () => { throw Object.assign(new Error(historyWarning), { statusCode: 503 }); };
      graphs = { unavailable: true, historyWarning, list: () => [], get: unavailable, harnessReport: unavailable, create: unavailable, start: unavailable, pause: unavailable, resume: unavailable, cancel: unavailable, reconcile: unavailable, claim: unavailable, release: unavailable, message: unavailable, startScheduler() {}, shutdown() {} };
    }
  }
  const telemetry = options.collectTelemetry || (args => require('./telemetry').collectTelemetry(args));
  const publicDir = options.publicDir || path.join(__dirname, 'public');
  let telemetryCache = null, telemetryAt = 0, pendingTelemetry = null, drafting = false;
  async function collect() {
    if (telemetryCache && Date.now() - telemetryAt < 10000) return telemetryCache;
    if (!pendingTelemetry) {
      pendingTelemetry = Promise.resolve().then(() => telemetry({ home: options.home || os.homedir(), limit: 40 })).then(data => {
        telemetryCache = data;
        telemetryAt = Date.now();
        return data;
      }).catch(() => ({ sessions: [], summary: {}, warnings: ['Session telemetry is unavailable. Check local session file access.'] })).finally(() => { pendingTelemetry = null; });
    }
    return pendingTelemetry;
  }

  const server = http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    const port = server.address()?.port;
    const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    const host = request.headers.host;
    const origin = request.headers.origin;
    if (!allowedHosts.includes(host) || (origin && origin !== `http://${host}`) || request.headers['sec-fetch-site'] === 'cross-site') return json(response, 403, { error: 'Only same-origin localhost requests are accepted.' });
    let pathname;
    try { pathname = new URL(request.url, `http://${host}`).pathname; }
    catch { return json(response, 400, { error: 'Invalid request URL.' }); }
    try {
      if (request.method === 'GET') {
        if (pathname === '/api/health') return json(response, 200, { service: 'route3-control-center', version: 1 });
        if (pathname === '/api/bootstrap') return json(response, 200, { token, csrfToken: token, workspace });
        if (pathname === '/api/state') {
          const data = await collect();
          if (notebooklm.snapshot().status === 'unknown') notebooklm.refresh().catch(() => {});
          const expertList = experts.list();
          const jobList = jobs.list();
          const agentTree = buildAgentTree({ jobs: jobList, sessions: data.sessions });
          return json(response, 200, { ...data, sessions: data.sessions || [], summary: data.summary || {}, warnings: [...(data.warnings || []), ...(experts.warnings?.() || []), ...(jobs.historyWarning ? [jobs.historyWarning] : []), ...(graphs.historyWarning ? [graphs.historyWarning] : [])], agents: jobs.agents(), experts: expertList, jobs: jobList, agentTree, graphs: graphs.list(), integrations: integrations.snapshot(), telegramRemote: telegram.snapshot(), nightShift: nightShift.snapshot(), notebooklm: notebooklm.snapshot(), backgroundService: Boolean(process.env.ROUTE3_BACKGROUND_SERVICE), workspace, generatedAt: new Date().toISOString() });
        }
        if (pathname === '/api/graphs') { if (graphs.unavailable) graphs.get(); return json(response, 200, { graphs: graphs.list() }); }
        const harnessPath = /^\/api\/graphs\/([0-9a-f-]{36})\/harness$/.exec(pathname);
        if (harnessPath) return json(response, 200, graphs.harnessReport(harnessPath[1]));
        const graphPath = /^\/api\/graphs\/([0-9a-f-]{36})$/.exec(pathname);
        if (graphPath) return json(response, 200, { graph: graphs.get(graphPath[1]) });
        if (Object.hasOwn(STATIC, pathname)) {
          const [file, type] = STATIC[pathname];
          let content;
          try { content = await fs.promises.readFile(path.join(publicDir, file)); }
          catch { return json(response, 404, { error: 'Control Center UI is not installed.' }); }
          response.writeHead(200, { 'Content-Type': type });
          return response.end(content);
        }
        return json(response, 404, { error: 'Not found.' });
      }
      if (request.method !== 'POST' && request.method !== 'DELETE') return json(response, 405, { error: 'Method not allowed.' });
      if (!equalToken(request.headers['x-route3-token'], token)) return json(response, 403, { error: 'A valid Route3 session token is required.' });
      if (request.method === 'DELETE') {
        const expertPath = /^\/api\/experts\/([a-z0-9-]{1,64})$/.exec(pathname);
        if (expertPath) return json(response, 200, { ok: experts.remove(expertPath[1]) });
        const nightItem = /^\/api\/night-shift\/items\/([0-9a-f-]{36})$/.exec(pathname);
        if (nightItem) return json(response, 200, { ok: nightShift.remove(nightItem[1]), nightShift: nightShift.snapshot() });
        return json(response, 404, { error: 'Not found.' });
      }
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) return json(response, 415, { error: 'Use application/json.' });
      const body = await readJSON(request);
      const telegramAction = /^\/api\/telegram\/(configure|start|stop|pairing|unpair|disconnect)$/.exec(pathname);
      if (telegramAction) {
        const action = telegramAction[1];
        if (action === 'pairing') return json(response, 200, { pairing: await telegram.pairing() });
        if (action === 'configure') await telegram.configure({ token: body.token, enabled: false });
        else await telegram[action]();
        return json(response, 200, { telegramRemote: telegram.snapshot() });
      }
      if (pathname === '/api/graphs') return json(response, 201, { graph: graphs.create(Object.hasOwn(body, 'definition') ? body.definition : compilePrompt(body)) });
      const graphAction = /^\/api\/graphs\/([0-9a-f-]{36})\/(start|pause|resume|cancel|reconcile|claim|release|message)$/.exec(pathname);
      if (graphAction) {
        const [, id, action] = graphAction;
        if (action === 'claim' || action === 'release') return json(response, 200, { graph: await graphs[action](id, body.nodeId, { memberId: body.memberId }) });
        if (action === 'message') return json(response, 200, { graph: await graphs.message(id, { from: body.from, to: body.to, taskId: body.taskId, body: body.body }) });
        const input = action === 'start' ? { definitionHash: body.definitionHash } : action === 'reconcile' ? { nodeId: body.nodeId, action: body.action, jobId: body.jobId, note: body.note } : undefined;
        return json(response, 200, { graph: await graphs[action](id, input) });
      }
      if (pathname === '/api/jobs') return json(response, 202, { job: jobs.start(await grounded(body)) });
      if (pathname === '/api/notebooklm/refresh') return json(response, 200, { notebooklm: await notebooklm.refresh({ force: true }) });
      if (pathname === '/api/night-shift/queue') return json(response, 200, { item: nightShift.enqueue(await grounded(body)), nightShift: nightShift.snapshot() });
      if (pathname === '/api/night-shift/schedule') return json(response, 200, { nightShift: nightShift.configure(body) });
      if (pathname === '/api/experts/draft') {
        const brain = await notebooklm.resolve(body.notebook);
        if (!brain) return json(response, 400, { error: 'Choose a NotebookLM notebook to draft from.' });
        if (drafting) return json(response, 409, { error: 'A draft is already being prepared. Wait for it to finish.' });
        drafting = true;
        try { return json(response, 200, { draft: await notebooklm.draftExpert(brain, typeof body.hint === 'string' ? body.hint : '') }); }
        finally { drafting = false; }
      }
      if (pathname === '/api/experts') return json(response, 200, { expert: experts.create(await grounded(body)) });
      const cancel = /^\/api\/jobs\/([0-9a-f-]{36})\/cancel$/.exec(pathname);
      if (cancel) return json(response, 200, { job: jobs.cancel(cancel[1]) });
      const permission = /^\/api\/jobs\/([0-9a-f-]{36})\/permission$/.exec(pathname);
      if (permission) return json(response, 200, { job: jobs.respondPermission(permission[1], body) });
      const integration = /^\/api\/integrations\/([a-z]+)\/([a-z]+)$/.exec(pathname);
      if (integration) return json(response, 200, { integration: await integrations.action(integration[1], integration[2]) });
      return json(response, 404, { error: 'Not found.' });
    } catch (error) {
      json(response, error.statusCode || 500, { error: error.statusCode ? error.message : 'Operation failed. Check local installation and try again.' });
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  let stopping;
  const shutdown = () => {
    if (!stopping) stopping = Promise.resolve().then(async () => {
      const failures = [];
      for (const component of [graphs, nightShift, jobs, telegram]) {
        try { await component.shutdown(); } catch (error) { failures.push(error); }
      }
      if (failures.length) throw failures[0];
    });
    return stopping;
  };
  server.on('listening', () => {
    graphs.startScheduler();
    if (options.startNightShift === true) nightShift.start();
    if (options.startTelegram === true && telegram.snapshot().enabled) Promise.resolve().then(() => telegram.start()).catch(() => {});
  });
  server.on('close', () => { shutdown().catch(() => {}); });
  server.route3 = { jobs, graphs, integrations, telegram, nightShift, notebooklm, workspace, shutdown };
  return server;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  let port = Number(process.env.ROUTE3_PORT || 43173);
  let workspace = process.env.ROUTE3_WORKSPACE || process.cwd();
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) port = Number(args[++i]);
    else if (args[i] === '--workspace' && args[i + 1]) workspace = args[++i];
    else if (args[i] === '--help') { console.log('Usage: node control-center/server.js [--port 43173] [--workspace /project]\nEnvironment: ROUTE3_PORT, ROUTE3_WORKSPACE. Binds only to 127.0.0.1.'); process.exit(0); }
    else { console.error('Unknown option. Use --help.'); process.exit(1); }
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) { console.error('Port must be an integer from 1 to 65535.'); process.exit(1); }
  let server;
  try { server = createServer({ workspace, persistJobs: true, startTelegram: true, startNightShift: true }); }
  catch { console.error('Route3 cannot initialize its workspace or private local state. Check paths and file permissions.'); process.exit(1); }
  server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? 'Route3 port is in use. Select another port with --port.' : 'Route3 could not start its localhost server.'); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`Route3 Control Center: http://127.0.0.1:${port}\nPrivate job history is retained locally. Telegram resumes only when enabled.`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
    server.route3.shutdown().catch(() => {});
    server.close();
    server.closeIdleConnections?.();
    setTimeout(() => process.exit(0), 4000).unref();
  });
}

module.exports = { createServer };
