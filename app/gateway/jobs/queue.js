'use strict';

const state = require('./state');

function jobId(number) { return `R3-${number}`; }

function createQueue({ store, audit, now = () => new Date().toISOString() }) {
  async function create({
    installationId, repositoryId, commandRequestId, descriptor, ast, actorId,
    baseRef = null, baseSha = null, headRef = null, headSha = null,
    priority = 100, riskLevel = 'LOW',
  }) {
    const number = await store.nextJobNumber();
    const row = {
      id: jobId(number),
      installationId, repositoryId, commandRequestId,
      command: descriptor.command,
      capability: descriptor.capability,
      scope: ast.scope || null,
      baseRef, baseSha, headRef, headSha,
      priority, riskLevel,
      status: 'RECEIVED',
      terminal: false,
      failureCode: null,
      failureMessage: null,
      trackingCommentId: null,
      requestedByGithubUserId: actorId,
      createdAt: now(), startedAt: null, completedAt: null,
    };
    const { job, coalescedWith } = await store.createJob(row);
    await audit.append({
      type: coalescedWith ? 'JOB_COALESCED' : 'JOB_CREATED',
      actor: 'gateway', installationId, jobId: job.id,
      metadata: { command: row.command, scope: row.scope, coalescedWith },
    });
    return { job, coalescedWith };
  }

  // Every write is guarded by the status the caller last observed. A stale
  // snapshot affects zero rows and raises rather than overwriting.
  async function apply(job, patch, expected) {
    const updated = await store.transitionJob(job.id, job.status, patch);
    if (!updated) throw new state.IllegalTransition(job.status, expected);
    return updated;
  }

  async function advance(job, to, patch = {}) {
    state.assertTransition(job.status, to);
    const updated = await apply(job, { status: to, ...patch }, to);
    await audit.append({
      type: 'JOB_TRANSITIONED', actor: 'gateway',
      installationId: job.installationId, jobId: job.id,
      metadata: { from: job.status, to },
    });
    return updated;
  }

  async function fail(job, failureCode, message = null) {
    const terminal = state.assertFailure(job.status, failureCode);
    const updated = await apply(job, {
      status: terminal, terminal: true, failureCode, failureMessage: message, completedAt: now(),
    }, failureCode);
    await audit.append({
      type: 'JOB_COMPLETED', actor: 'gateway',
      installationId: job.installationId, jobId: job.id,
      metadata: { terminal, failureCode },
    });
    return updated;
  }

  async function succeed(job) {
    state.assertTransition(job.status, 'SUCCEEDED');
    const updated = await apply(job, {
      status: 'SUCCEEDED', terminal: true, completedAt: now(),
    }, 'SUCCEEDED');
    await audit.append({
      type: 'JOB_COMPLETED', actor: 'gateway',
      installationId: job.installationId, jobId: job.id,
      metadata: { terminal: 'SUCCEEDED' },
    });
    return updated;
  }

  return { create, advance, fail, succeed };
}

module.exports = { createQueue, jobId };
