'use strict';

// Local, read-only accounting. Never return log content, tool arguments or prompts.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const cache = new Map();
const DEFAULT_BOUNDS = Object.freeze({ maxFiles: 2000, maxEntries: 12000, maxDepth: 8,
  maxBytes: 1024 * 1024, headBytes: 32768, maxLines: 6000, maxLineBytes: 262144 });
const numeric = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const str = value => typeof value === 'string' ? value.slice(0, 1024) : null;
const add = (...values) => values.every(v => v !== null) ? values.reduce((a, b) => a + b, 0) : null;
const optional = value => value === undefined ? 0 : numeric(value);
const firstNumber = (...values) => values.map(numeric).find(v => v !== null) ?? null;

function usage(raw, provider) {
  if (!raw || typeof raw !== 'object') return null;
  let input = numeric(raw.input_tokens ?? raw.input);
  const output = numeric(raw.output_tokens ?? raw.output);
  const cached = numeric(raw.cached_input_tokens ?? raw.cache_read_input_tokens ?? raw.cacheRead);
  const created = numeric(raw.cache_creation_input_tokens ?? raw.cacheWrite);
  if (provider === 'claude' || provider === 'openclaw') {
    // Anthropic and Pi/OpenClaw report cache reads/writes separately from input.
    input = add(input, optional(raw.cache_read_input_tokens ?? raw.cacheRead), optional(raw.cache_creation_input_tokens ?? raw.cacheWrite));
  }
  if (input === null && output === null) return null;
  return { inputTokens: input, outputTokens: output, cachedInputTokens: cached,
    cacheWriteInputTokens: created, totalTokens: numeric(raw.total_tokens ?? raw.totalTokens) ?? add(input, output) };
}

function policy(tokens, window, thresholds) {
  if (tokens === null || window === null || window <= 0) return { level: 'unknown', reason: 'Current context occupancy or model context window is unavailable; no compaction decision.' };
  const percent = tokens / window * 100;
  if (percent >= thresholds.urgent) return { level: 'urgent', reason: `Last request used ${percent.toFixed(1)}% of the reported context window. Save a handoff and compact before more large tool results.` };
  if (percent >= thresholds.recommended) return { level: 'recommended', reason: `Last request used ${percent.toFixed(1)}% of the reported context window. Save decisions and compact at the next task boundary.` };
  if (percent >= thresholds.watch) return { level: 'watch', reason: `Last request used ${percent.toFixed(1)}% of the reported context window. Keep tool output bounded and prepare a handoff.` };
  return { level: 'healthy', reason: `Last request used ${percent.toFixed(1)}% of the reported context window; occupancy alone does not justify compaction.` };
}

async function discover(root, provider, bounds, warnings, sessionDirectoriesOnly = false) {
  const found = []; let entries = 0; let bounded = false;
  async function walk(dir, depth) {
    if (depth > bounds.maxDepth) { bounded = true; return; }
    let handle;
    try { handle = await fs.opendir(dir); } catch (error) { if (error.code !== 'ENOENT') warnings.push(`${provider}: a session directory could not be read (${error.code || 'IO'}).`); return; }
    const dirs = [];
    try {
      for await (const entry of handle) {
        if (++entries > bounds.maxEntries || found.length >= bounds.maxFiles) { bounded = true; break; }
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!sessionDirectoriesOnly || depth === 0 || (depth === 1 && entry.name === 'sessions') || depth >= 2) dirs.push(file);
        } else if (entry.isFile() && (entry.name.endsWith('.jsonl') || (provider === 'openclaw' && entry.name === 'sessions.json'))) {
          try { const stat = await fs.stat(file); found.push({ file, provider, size: stat.size, mtimeMs: stat.mtimeMs, ino: stat.ino }); } catch { /* A live session may disappear during rotation. */ }
        }
      }
    } catch (error) { warnings.push(`${provider}: session enumeration interrupted (${error.code || 'IO'}).`); }
    for (const subdir of dirs.sort().reverse()) {
      if (entries >= bounds.maxEntries || found.length >= bounds.maxFiles) { bounded = true; break; }
      await walk(subdir, depth + 1);
    }
  }
  await walk(root, 0);
  if (bounded) warnings.push(`${provider}: discovery reached its scan bound; older or unvisited sessions may be omitted.`);
  return found;
}

async function readBounded(item, bounds) {
  const handle = await fs.open(item.file, 'r');
  try {
    const tailSize = Math.min(item.size, bounds.maxBytes);
    const start = item.size - tailSize;
    const buffer = Buffer.alloc(tailSize);
    const { bytesRead } = await handle.read(buffer, 0, tailSize, start);
    let tail = buffer.subarray(0, bytesRead).toString('utf8');
    if (start > 0) { const newline = tail.indexOf('\n'); tail = newline < 0 ? '' : tail.slice(newline + 1); }
    let head = '';
    if (start > 0) {
      const headBuffer = Buffer.alloc(Math.min(bounds.headBytes, start));
      const read = await handle.read(headBuffer, 0, headBuffer.length, 0);
      head = headBuffer.subarray(0, read.bytesRead).toString('utf8');
      head = head.slice(0, head.lastIndexOf('\n') + 1);
    }
    const all = tail.split('\n');
    const lineBounded = all.length > bounds.maxLines;
    return { head, lines: all.slice(-bounds.maxLines), partial: start > 0 || lineBounded };
  } finally { await handle.close(); }
}

function parseSession(item, data, bounds) {
  const session = { id: path.basename(item.file, '.jsonl'), provider: item.provider, model: null, cwd: null,
    updatedAt: new Date(item.mtimeMs).toISOString(), inputTokens: null, outputTokens: null,
    cachedInputTokens: null, cacheWriteInputTokens: null, totalTokens: null, contextTokens: null,
    contextWindow: null, contextPercent: null, measurement: { usage: 'unavailable', context: 'unavailable', coverage: data.partial ? 'tail' : 'full' }, drivers: [] };
  let malformed = 0; let oversize = 0; let last = null; let cumulative = null; let compacted = false;
  const messages = new Map(); let anonymous = 0; let duplicateEvents = 0;
  function metadata(event) {
    const payload = event.payload || {};
    if (event.type === 'session_meta') { session.id = str(payload.id ?? payload.session_id) || session.id; session.cwd = str(payload.cwd) || session.cwd; }
    if (event.type === 'session') { session.id = str(event.id) || session.id; session.cwd = str(event.cwd) || session.cwd; }
    if (str(event.sessionId)) {
      session.id = str(event.sessionId);
      // Claude subagent transcripts share their parent's sessionId.
      // Keep each agent's usage separate instead of silently replacing siblings.
      const agentId = str(event.agentId) || (path.basename(item.file).startsWith('agent-') ? path.basename(item.file, '.jsonl').slice(6) : null);
      if (item.provider === 'claude' && agentId) { session.parentSessionId = session.id; session.id += `:agent:${agentId}`; }
    }
    session.cwd = str(event.cwd) || session.cwd;
    if (event.type === 'turn_context') { session.model = str(payload.model) || session.model; session.cwd = str(payload.cwd) || session.cwd; }
    session.contextWindow = firstNumber(payload.model_context_window, event.contextWindow, event.context_window, session.contextWindow);
  }
  function parse(line, metadataOnly = false) {
    if (!line.trim()) return;
    if (Buffer.byteLength(line) > bounds.maxLineBytes) { oversize++; return; }
    let event; try { event = JSON.parse(line); } catch { malformed++; return; }
    if (!event || typeof event !== 'object') return;
    metadata(event);
    if (metadataOnly) return;
    const payload = event.payload || {};
    if (event.type === 'compacted' || event.type === 'compaction' || (event.type === 'system' && event.subtype === 'compact_boundary') || payload.type === 'context_compacted') { last = null; compacted = true; }
    if (item.provider === 'codex') {
      if (event.type === 'event_msg' && payload.type === 'token_count' && payload.info) {
        const info = payload.info;
        cumulative = usage(info.total_token_usage, 'codex') || cumulative;
        const next = usage(info.last_token_usage, 'codex');
        if (next) { last = next; compacted = false; }
        session.contextWindow = firstNumber(info.model_context_window, session.contextWindow);
      }
    } else {
      const message = event.message;
      if (!message || (message.role !== 'assistant' && event.type !== 'assistant')) return;
      session.model = str(message.model) || session.model;
      session.contextWindow = firstNumber(message.contextWindow, message.context_window, message.usage?.context_window, session.contextWindow);
      const next = usage(message.usage, item.provider);
      if (!next) return;
      // Claude emits each content block with the same message id and usage.
      const id = str(message.id) || str(event.id) || str(event.uuid) || `anonymous-${anonymous++}`;
      if (messages.has(id)) duplicateEvents++;
      messages.set(id, next);
      last = next; compacted = false;
    }
  }
  for (const line of data.head.split('\n')) parse(line, true);
  for (const line of data.lines) parse(line);
  if (item.provider === 'codex' && cumulative) {
    Object.assign(session, cumulative); session.measurement.usage = 'reported_cumulative';
  } else if (messages.size) {
    for (const field of ['inputTokens', 'outputTokens', 'cachedInputTokens', 'cacheWriteInputTokens', 'totalTokens']) {
      const values = [...messages.values()].map(m => m[field]);
      session[field] = values.every(v => v !== null) ? values.reduce((a, b) => a + b, 0) : null;
    }
    session.measurement.usage = data.partial || malformed || oversize ? 'partial_messages' : 'observed_messages';
    session.measurement.uniqueMessages = messages.size;
    session.measurement.duplicateEventsIgnored = duplicateEvents;
    session.measurement.anonymousMessages = anonymous;
  }
  if (last && !compacted) {
    session.contextTokens = add(last.inputTokens, last.outputTokens);
    session.measurement.context = session.contextTokens === null ? 'unavailable' : 'last_request_proxy';
    if (last.inputTokens !== null && last.inputTokens >= 32000) session.drivers.push({ kind: 'large_input', tokens: last.inputTokens, reason: 'The last observed request processed at least 32,000 input tokens.' });
    if (last.inputTokens > 0 && last.cachedInputTokens !== null && last.cachedInputTokens <= last.inputTokens) {
      const uncached = last.inputTokens - last.cachedInputTokens;
      session.drivers.push({ kind: 'uncached_input', tokens: uncached, percent: Math.round(uncached / last.inputTokens * 1000) / 10, reason: 'Reported input minus reported cache reads; includes cache writes where applicable.' });
    }
  }
  session.measurement.skippedLines = malformed + oversize;
  if (compacted) session.measurement.context = 'awaiting_usage_after_compaction';
  const warnings = [];
  if (data.partial) warnings.push(`${item.provider}: ${session.id}: bounded tail read; message totals may exclude earlier requests.`);
  if (malformed || oversize) warnings.push(`${item.provider}: ${session.id}: skipped ${malformed} malformed and ${oversize} oversized log lines.`);
  return { sessions: [session], warnings };
}

function parseIndex(item, data) {
  if (data.partial) return { sessions: [], warnings: ['openclaw: session index exceeds the read bound and was skipped.'] };
  let index; try { index = JSON.parse(data.lines.join('\n')); } catch { return { sessions: [], warnings: ['openclaw: session index is malformed.'] }; }
  if (!index || typeof index !== 'object' || Array.isArray(index)) return { sessions: [], warnings: ['openclaw: unrecognized session index.'] };
  const sessions = [];
  for (const entry of Object.values(index).slice(0, 2000)) {
    if (!entry || typeof entry !== 'object' || !str(entry.sessionId)) continue;
    // OpenClaw index input/output/totalTokens describe its latest request, not lifetime spend.
    const contextTokens = entry.totalTokensFresh === true ? numeric(entry.totalTokens) : null;
    sessions.push({ id: str(entry.sessionId), provider: 'openclaw', model: str(entry.model), cwd: str(entry.cwd),
      updatedAt: Number.isFinite(entry.updatedAt) && !Number.isNaN(new Date(entry.updatedAt).getTime()) ? new Date(entry.updatedAt).toISOString() : new Date(item.mtimeMs).toISOString(),
      inputTokens: null, outputTokens: null, cachedInputTokens: null, cacheWriteInputTokens: null, totalTokens: null,
      contextTokens, contextWindow: numeric(entry.contextTokens), contextPercent: null,
      measurement: { usage: 'unavailable', context: contextTokens === null ? 'unavailable' : 'reported_index_context', coverage: 'index' }, drivers: [] });
  }
  return { sessions, warnings: [] };
}

async function collectTelemetry({ home = os.homedir(), limit = 30, cwd, sessionId, thresholds = {}, bounds: requestedBounds = {} } = {}) {
  const bounds = { ...DEFAULT_BOUNDS };
  for (const key of Object.keys(bounds)) if (Number.isInteger(requestedBounds[key]) && requestedBounds[key] > 0) bounds[key] = Math.min(bounds[key], requestedBounds[key]);
  const limits = { watch: 65, recommended: 80, urgent: 90, ...thresholds };
  if (![limits.watch, limits.recommended, limits.urgent].every(v => Number.isFinite(v) && v >= 0 && v <= 100) || !(limits.watch < limits.recommended && limits.recommended < limits.urgent)) throw new TypeError('Compaction thresholds must be increasing percentages between 0 and 100.');
  const count = Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.trunc(limit))) : 30;
  const warnings = [];
  const discovered = await Promise.all([
    discover(path.join(home, '.codex', 'sessions'), 'codex', bounds, warnings),
    discover(path.join(home, '.claude', 'projects'), 'claude', bounds, warnings),
    discover(path.join(home, '.openclaw', 'agents'), 'openclaw', bounds, warnings, true)
  ]);
  const normalize = async value => {
    if (typeof value !== 'string' || !value) return null;
    try { return await fs.realpath(value); } catch { return path.resolve(value); }
  };
  const requestedCwd = await normalize(cwd);
  const selected = Boolean(requestedCwd || sessionId);
  // Explicit lookup searches the bounded discovery set before limiting results.
  // Avoid parsing every full log: metadata heads select candidates cheaply.
  let files = discovered.flat().sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (selected) {
    const candidates = [];
    for (const item of files) {
      if (item.file.endsWith('sessions.json')) { candidates.push(item); continue; }
      let handle;
      try {
        handle = await fs.open(item.file, 'r');
        const buffer = Buffer.alloc(Math.min(item.size, bounds.headBytes));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        let head = buffer.subarray(0, bytesRead).toString('utf8');
        if (item.size > bytesRead) head = head.slice(0, head.lastIndexOf('\n') + 1);
        const metadata = parseSession(item, { head: '', lines: head.split('\n'), partial: true }, bounds).sessions[0];
        const idMatches = !sessionId || metadata.id === sessionId;
        const cwdMatches = !requestedCwd || await normalize(metadata.cwd) === requestedCwd;
        if (idMatches && cwdMatches) candidates.push(item);
      } catch { /* rotated/unreadable session: final coverage warning stays explicit */ }
      finally { if (handle) await handle.close(); }
    }
    files = candidates;
    warnings.push('Session lookup searches bounded discovery and metadata heads; files outside those bounds may be omitted.');
  }
  files = files.slice(0, count);
  const sessionsById = new Map();
  for (const item of files) {
    const key = `${item.file}:${item.ino}:${item.size}:${item.mtimeMs}:${JSON.stringify(bounds)}`;
    try {
      let result = cache.get(key);
      if (!result) {
        const data = await readBounded(item, bounds);
        result = item.file.endsWith('sessions.json') ? parseIndex(item, data) : parseSession(item, data, bounds);
        cache.set(key, result);
        if (cache.size > 200) cache.delete(cache.keys().next().value);
      }
      warnings.push(...result.warnings);
      for (const raw of result.sessions) {
        const session = structuredClone(raw);
        if (sessionId && session.id !== sessionId) continue;
        if (requestedCwd && await normalize(session.cwd) !== requestedCwd) continue;
        const id = `${session.provider}:${session.id}`;
        const previous = sessionsById.get(id);
        if (previous) {
          const index = session.measurement.coverage === 'index' ? session : previous.measurement.coverage === 'index' ? previous : null;
          if (index) {
            const log = index === session ? previous : session;
            log.contextWindow ??= index.contextWindow;
            log.model ??= index.model;
            // Use a fresh index context only if it is newer than the log snapshot.
            if (index.contextTokens !== null && index.updatedAt >= log.updatedAt) { log.contextTokens = index.contextTokens; log.measurement.context = index.measurement.context; }
            sessionsById.set(id, log);
          } else if (session.updatedAt > previous.updatedAt) sessionsById.set(id, session);
        } else sessionsById.set(id, session);
      }
    } catch (error) { warnings.push(`${item.provider}: a session could not be read (${error.code || 'IO'}).`); }
  }
  const sessions = [...sessionsById.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, count);
  for (const session of sessions) {
    session.contextPercent = session.contextTokens !== null && session.contextWindow > 0 ? Math.round(session.contextTokens / session.contextWindow * 1000) / 10 : null;
    session.compact = policy(session.contextTokens, session.contextWindow, limits);
  }
  const total = field => {
    const values = sessions.map(s => s[field]).filter(v => v !== null);
    return values.length ? values.reduce((a, b) => a + b, 0) : null;
  };
  return { sessions, summary: { sessionCount: sessions.length, measuredSessions: sessions.filter(s => s.totalTokens !== null).length,
    unknownUsageSessions: sessions.filter(s => s.totalTokens === null).length,
    partialUsageSessions: sessions.filter(s => s.measurement.usage === 'partial_messages').length,
    completeBreakdown: sessions.length > 0 && sessions.every(s => ['inputTokens','outputTokens','cachedInputTokens'].every(field => s[field] !== null)),
    inputTokens: total('inputTokens'), outputTokens: total('outputTokens'), cachedInputTokens: total('cachedInputTokens'), totalTokens: total('totalTokens'),
    compactRecommended: sessions.filter(s => ['recommended', 'urgent'].includes(s.compact.level)).length,
    scope: 'Selected local sessions only; partial logs are lower bounds and missing usage is excluded. Tokens are not currency cost.',
    scannedFiles: discovered.reduce((sum, files) => sum + files.length, 0), processedFiles: files.length, thresholds: limits }, warnings: [...new Set(warnings)] };
}

module.exports = { collectTelemetry };
