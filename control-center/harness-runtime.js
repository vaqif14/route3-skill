'use strict';

// Deterministic supervision around graph execution, independent of providers.
// Limits describe local dispatch intents, not inferred token usage or billing.
const DEFAULT_POLICY = Object.freeze({ maxAgentAttempts: 120, maxElapsedMs: 3600000, maxConcurrentTasks: 2 });
const ACTIVE = new Set(['preparing', 'running', 'awaiting_approval']);
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled']);
const observed = new WeakMap();
const EVENT_BYTES = 32768;
const invalid = message => { throw Object.assign(new Error(message), { statusCode: 400 }); };
function normalizePolicy(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !Object.hasOwn(DEFAULT_POLICY, key))) invalid('Unknown harness policy field.');
  const result = { ...DEFAULT_POLICY, ...input };
  for (const [key, min, max] of [['maxAgentAttempts', 1, 120], ['maxElapsedMs', 100, 86400000], ['maxConcurrentTasks', 1, 2]]) {
    if (!Number.isInteger(result[key]) || result[key] < min || result[key] > max) invalid(`${key} must be an integer from ${min} to ${max}.`);
  }
  return result;
}
function initialState() { return { version: 1, startedAt: null, finishedAt: null, pauseReason: null, sequence: 0, events: [] }; }
function validateState(state) {
  if (!state || state.version !== 1 || !Number.isSafeInteger(state.sequence) || state.sequence < 0 || !Array.isArray(state.events) || state.events.length > 100) invalid('Invalid harness checkpoint.');
  if (Buffer.byteLength(JSON.stringify(state.events)) > EVENT_BYTES) invalid('Harness event history exceeds its byte limit.');
  if (state.startedAt !== null && (typeof state.startedAt !== 'string' || !Number.isFinite(Date.parse(state.startedAt)))) invalid('Invalid harness start time.');
  if (state.finishedAt === undefined) state.finishedAt = null;
  if (state.finishedAt !== null && (typeof state.finishedAt !== 'string' || !Number.isFinite(Date.parse(state.finishedAt)))) invalid('Invalid harness finish time.');
  if (state.pauseReason !== null && !['manual', 'agent_attempt_limit', 'elapsed_time_limit'].includes(state.pauseReason)) invalid('Invalid harness pause reason.');
  let previous = 0;
  for (const event of state.events) {
    if (!event || !Number.isSafeInteger(event.sequence) || event.sequence <= previous || event.sequence > state.sequence || typeof event.at !== 'string' || !Number.isFinite(Date.parse(event.at)) || !Array.isArray(event.tasks) || event.tasks.length > 24) invalid('Invalid harness event history.');
    if (Object.keys(event).some(key => !['sequence', 'at', 'status', 'pauseReason', 'tasks'].includes(key)) || !['draft', 'running', 'paused', 'blocked', ...TERMINAL].includes(event.status) || (event.pauseReason !== null && !['manual', 'agent_attempt_limit', 'elapsed_time_limit'].includes(event.pauseReason))) invalid('Invalid harness event fields.');
    for (const task of event.tasks) {
      if (!task || Object.keys(task).some(key => !['id', 'status', 'phase', 'attempt', 'jobId', 'memberId'].includes(key)) || !/^[a-z][a-z0-9_-]{0,47}$/.test(task.id) || !['pending', 'claimed', 'preparing', 'running', 'awaiting_approval', 'succeeded', 'failed', 'skipped', 'blocked'].includes(task.status) || !['agent', 'check'].includes(task.phase) || !Number.isInteger(task.attempt) || task.attempt < 0 || task.attempt > 5 || (task.jobId !== null && (typeof task.jobId !== 'string' || !/^[0-9a-f-]{36}$/.test(task.jobId))) || (task.memberId !== null && (typeof task.memberId !== 'string' || !/^[a-z][a-z0-9_-]{0,47}$/.test(task.memberId)))) invalid('Invalid harness event task.');
    }
    previous = event.sequence;
  }
  return state;
}
function policyFor(run) { return normalizePolicy(run.definition.harness); }
function usageFor(run, at) {
  const nodes = Object.values(run.nodes);
  return {
    agentAttempts: nodes.reduce((sum, node) => sum + node.attempt, 0),
    elapsedMs: run.harness.startedAt === null ? 0 : Math.max(0, Date.parse(run.harness.finishedAt || at) - Date.parse(run.harness.startedAt)),
    activeTasks: TERMINAL.has(run.status) ? 0 : nodes.filter(node => ACTIVE.has(node.status)).length
  };
}
function dispatchLimit(run, at, phase) {
  const policy = policyFor(run), usage = usageFor(run, at);
  if (usage.elapsedMs >= policy.maxElapsedMs) return 'elapsed_time_limit';
  if (phase === 'agent' && usage.agentAttempts >= policy.maxAgentAttempts) return 'agent_attempt_limit';
  return null;
}
function recordTransition(run, at) {
  const state = run.harness;
  if (TERMINAL.has(run.status) && state.finishedAt === null) state.finishedAt = at;
  const tasks = Object.entries(run.nodes).map(([id, node]) => ({ id, status: node.status, phase: node.phase, attempt: node.attempt, jobId: node.jobId, memberId: node.claim?.memberId || null }));
  const previous = observed.get(run) || new Map();
  const changed = tasks.filter(task => previous.get(task.id) !== JSON.stringify(task));
  observed.set(run, new Map(tasks.map(task => [task.id, JSON.stringify(task)])));
  state.events.push({ sequence: ++state.sequence, at, status: run.status, pauseReason: state.pauseReason, tasks: changed });
  state.events = state.events.slice(-100);
  while (state.events.length > 1 && Buffer.byteLength(JSON.stringify(state.events)) > EVENT_BYTES) state.events.shift();
}
function report(run, at, historyWarning = null) {
  const policy = policyFor(run), usage = usageFor(run, at), nodes = Object.entries(run.nodes);
  const jobIds = [...new Set(nodes.flatMap(([, node]) => [node.jobId, ...(node.followed || []), ...node.attempts.map(a => a.jobId)].filter(Boolean)))];
  const actions = [];
  let status = 'success', summary = `Graph is ${run.status}.`;
  if (historyWarning) { status = 'error'; summary = 'Checkpoint or scheduler fault stopped new dispatch.'; actions.push({ action: 'inspect_storage_and_jobs', reason: 'Reconcile actual work before restarting the manager.' }); }
  if (run.status === 'blocked') {
    status = 'error'; summary = 'Execution outcome is uncertain; automatic replay is stopped.';
    for (const [taskId, node] of nodes.filter(([, n]) => n.status === 'blocked')) actions.push({ action: 'reconcile', taskId, jobId: node.jobId, allowedActions: node.phase === 'agent' ? ['attach', 'fail'] : ['fail'], reason: node.phase === 'agent' ? 'Attach a job matching the saved dispatch intent or explicitly record failure.' : 'An uncertain check cannot attach to a provider job; explicitly record failure after inspection.' });
  } else if (run.status === 'failed') { status = 'error'; summary = 'Graph has unhandled failed tasks.'; actions.push({ action: 'inspect_receipts', reason: 'Read failed task checks and job results before proposing new work.' }); }
  else if (run.status === 'draft') actions.push({ action: 'review_then_start', definitionHash: run.definitionHash, reason: 'Check scope, commands, routing and policy within existing user authorization.' });
  else if (run.status === 'cancelled') { status = historyWarning ? 'error' : 'warning'; summary = 'Cancellation was requested; prior effects are not rolled back.'; actions.push({ action: 'inspect_jobs_and_artifacts', reason: 'Confirm owned processes stopped and inspect any work already performed.' }); }
  else if (run.status === 'paused') {
    status = historyWarning ? 'error' : 'warning';
    const reason = run.harness.pauseReason;
    if (['agent_attempt_limit', 'elapsed_time_limit'].includes(reason)) {
      summary = `New dispatch paused at ${reason}.`;
      actions.push({ action: 'inspect_then_cancel_or_create_revision', reason: 'Limits are immutable; continuing changed work needs a new reviewed definition and reconciliation of prior effects.' });
    } else actions.push({ action: 'inspect_then_resume', reason: 'Resume only after checking running work and recovered task state.' });
  }
  const awaiting = TERMINAL.has(run.status) ? [] : nodes.filter(([, n]) => n.status === 'awaiting_approval');
  for (const [taskId, node] of awaiting) actions.push({ action: 'review_provider_permission', taskId, jobId: node.jobId, reason: 'Forward only an actual user permission decision; never auto-approve.' });
  if (awaiting.length && status === 'success') { status = 'warning'; summary = 'A provider job is waiting for an explicit permission decision.'; }
  const failed = nodes.filter(([, n]) => n.status === 'failed').map(([id]) => id);
  if (run.status === 'succeeded' && failed.length) { status = 'warning'; summary = 'Graph succeeded through failure handlers; inspect failed task receipts.'; }
  if (run.status === 'succeeded' && failed.length) actions.push({ action: 'inspect_receipts', reason: 'Failure handlers completed; inspect the failed parent receipts and acceptance evidence.' });
  if (historyWarning) { status = 'error'; summary = 'Checkpoint or scheduler fault stopped new dispatch.'; }
  const verification = {
    checksPassed: nodes.filter(([, n]) => n.lastCheck?.exitCode === 0 && !n.lastCheck.error && !n.lastCheck.signal).map(([id]) => id),
    checksFailed: nodes.filter(([, n]) => Number.isInteger(n.lastCheck?.exitCode) && n.lastCheck.exitCode !== 0).map(([id]) => id),
    agentOnlyCompleted: run.definition.nodes.filter(d => d.type === 'agent' && run.nodes[d.id].status === 'succeeded').map(d => d.id),
    failedTasks: failed,
    unknownTasks: nodes.filter(([, n]) => n.status === 'blocked').map(([id]) => id)
  };
  const nextActions = historyWarning ? actions.filter(a => !['review_then_start', 'inspect_then_resume'].includes(a.action)) : actions;
  return { status, summary, next_actions: nextActions, artifacts: { graphId: run.id, definitionHash: run.definitionHash, jobIds }, runStatus: run.status, policy, usage, pauseReason: run.harness.pauseReason, verification,
    events: run.harness.events.slice(-10).map(event => ({ ...event, tasks: event.tasks.map(task => ({ ...task })) })),
    coverage: { eventLimit: 100, eventByteLimit: EVENT_BYTES, reportedEvents: Math.min(10, run.harness.events.length), retainedEvents: run.harness.events.length, totalTransitions: run.harness.sequence, providerTokens: 'unknown', providerCost: 'unknown', processCompletionIsSemanticVerification: false } };
}

module.exports = { DEFAULT_POLICY, normalizePolicy, initialState, validateState, policyFor, usageFor, dispatchLimit, recordTransition, report };
