'use strict';

const { redact } = require('./security');
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER ? value : null;
const identifier = value => typeof value === 'string' && value.length > 0 && value.length <= 1024 && !/[\u0000-\u001f\u007f]/.test(value) && !/[\uD800-\uDFFF]/u.test(value) ? value : null;
const text = (value, limit) => typeof value === 'string' ? redact(value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, limit) || null : null;
const timestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const providerName = value => typeof value === 'string' && /^[a-z0-9_-]{1,32}$/i.test(value) ? value.toLowerCase() : null;
const labels = { codex: 'Codex', claude: 'Claude', gemini: 'Gemini', kimi: 'Kimi', zai: 'Z.AI', openclaw: 'OpenClaw' };
const statuses = { running: 'running', awaiting_approval: 'needs_you', needs_you: 'needs_you', completed: 'done', done: 'done', succeeded: 'done', failed: 'failed', error: 'failed', incomplete: 'failed', timeout: 'failed', timed_out: 'failed', output_limit: 'failed', cancelled: 'stopped', canceled: 'stopped', interrupted: 'stopped', stopped: 'stopped' };
const lifecycle = value => typeof value === 'string' && Object.hasOwn(statuses, value) ? statuses[value] : 'unknown';

// Only explicit identities and parent links form edges. A graph dependency,
// continuation or provider replacement does not establish a spawned child.
function buildAgentTree({ jobs = [], sessions = [], now = Date.now() } = {}) {
  const nodes = [], byId = new Map(), jobIds = new Map(), sessionOwners = new Map(), sessionRecords = new Map(), parents = new Map();
  const warnings = new Set();
  const current = typeof now === 'number' && Number.isFinite(now) ? now : Date.now();
  const key = (provider, id) => provider && id ? JSON.stringify([provider, id]) : null;
  function node(source, rawId, input, provider) {
    const status = lifecycle(input.status);
    const startedAt = timestamp(input.startedAt), endedAt = timestamp(input.endedAt);
    let durationMs = number(input.durationMs);
    if (durationMs === null && startedAt) {
      const end = endedAt ? Date.parse(endedAt) : ['running', 'needs_you'].includes(status) ? current : null;
      if (end !== null && end >= Date.parse(startedAt)) durationMs = end - Date.parse(startedAt);
    }
    // Subtree-inclusive billing is never a node's own cost.
    const costUsd = input.costScope === 'subtree' || input.costIncludesChildren === true ? null : number(input.costUsd);
    const result = { id: source === 'job' ? `job:${encodeURIComponent(rawId)}` : `session:${provider}:${encodeURIComponent(rawId)}`, parentId: null, source, sourceId: rawId,
      name: text(input.expertLabel || input.name || input.agentName, 120) || (Object.hasOwn(labels, provider) ? labels[provider] : null) || text(provider, 32) || 'Agent',
      model: text(input.model, 120), summary: text(input.summary, 240), status, costUsd, durationMs, startedAt, endedAt, childCount: 0, children: [] };
    nodes.push(result); byId.set(result.id, result); return result;
  }
  for (const job of Array.isArray(jobs) ? jobs : []) {
    if (!job || typeof job !== 'object' || !identifier(job.id)) { warnings.add('Malformed agent records were omitted.'); continue; }
    if (jobIds.has(job.id)) { warnings.add('Duplicate job identities were omitted.'); continue; }
    const provider = providerName(job.provider || job.agent), result = node('job', job.id, job, provider);
    jobIds.set(job.id, result.id); parents.set(result.id, { jobId: identifier(job.parentJobId) });
    const identity = key(provider, identifier(job.sessionId));
    if (identity) {
      if (sessionOwners.has(identity)) warnings.add('Multiple jobs share a session; its telemetry is counted once.');
      else sessionOwners.set(identity, result.id);
    }
  }
  for (const session of Array.isArray(sessions) ? sessions : []) {
    const provider = providerName(session?.provider), rawId = identifier(session?.id), identity = key(provider, rawId);
    if (!identity) { warnings.add('Malformed agent records were omitted.'); continue; }
    if (sessionRecords.has(identity)) { warnings.add('Duplicate session identities were omitted.'); continue; }
    sessionRecords.set(identity, session);
    let id = sessionOwners.get(identity);
    if (id) {
      const result = byId.get(id);
      result.model ||= text(session.model, 120);
      if (result.costUsd === null && session.costScope !== 'subtree' && session.costIncludesChildren !== true) result.costUsd = number(session.costUsd);
      result.startedAt ||= timestamp(session.startedAt);
      // The live JobManager owns lifecycle and duration for represented jobs.
      if (result.durationMs === null && result.startedAt) {
        const end = result.endedAt ? Date.parse(result.endedAt) : ['running', 'needs_you'].includes(result.status) ? current : null;
        if (end !== null && end >= Date.parse(result.startedAt)) result.durationMs = end - Date.parse(result.startedAt);
      }
    } else {
      const result = node('session', rawId, session, provider); id = result.id; sessionOwners.set(identity, id); parents.set(id, {});
    }
    Object.assign(parents.get(id), { provider, sessionId: identifier(session.parentSessionId) });
  }
  for (const result of nodes) {
    const parent = parents.get(result.id);
    if (parent.jobId) result.parentId = jobIds.get(parent.jobId) || null;
    if (!result.parentId && parent.sessionId) result.parentId = sessionOwners.get(key(parent.provider, parent.sessionId)) || null;
    if ((parent.jobId || parent.sessionId) && !result.parentId) warnings.add('An observed parent is outside the available records; its child is shown as a root.');
    if (result.parentId === result.id) { result.parentId = null; warnings.add('Invalid self-parent links were removed.'); }
  }
  // Remove a closing edge deterministically; leave every valid node visible.
  const settled = new Set();
  for (const result of nodes) {
    const chain = new Set(); let cursor = result;
    while (cursor && !settled.has(cursor.id)) {
      chain.add(cursor.id);
      if (chain.has(cursor.parentId)) { cursor.parentId = null; warnings.add('Cyclic parent links were removed.'); break; }
      cursor = byId.get(cursor.parentId);
    }
    for (const id of chain) settled.add(id);
  }
  for (const result of nodes) if (result.parentId) byId.get(result.parentId).children.push(result.id);
  for (const result of nodes) result.childCount = result.children.length;
  const costed = nodes.filter(item => item.costUsd !== null), knownCostUsd = costed.reduce((sum, item) => sum + item.costUsd, 0);
  return { nodes, rootIds: nodes.filter(item => !item.parentId).map(item => item.id), summary: { totalAgents: nodes.length, runningCount: nodes.filter(item => item.status === 'running').length,
    totalCostUsd: costed.length === nodes.length ? knownCostUsd : null, knownCostUsd, costedAgents: costed.length }, warnings: [...warnings] };
}

module.exports = { buildAgentTree };
