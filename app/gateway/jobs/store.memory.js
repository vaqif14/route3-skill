'use strict';

const { assertStore } = require('./store');

const clone = value => (value === undefined ? undefined : structuredClone(value));
const same = (a, b) => (a || '') === (b || '');

function createMemoryStore() {
  const deliveries = new Map();
  const installations = new Map();
  const repositories = new Map();
  const commandRequests = new Map();
  const jobs = new Map();
  const operations = new Map();
  const audit = [];
  let jobCounter = 0;

  const store = {
    async recordDelivery(row) {
      const provider = row.provider || 'github';
      const key = `${provider}:${row.deliveryId}`;
      if (deliveries.has(key)) return { inserted: false };
      deliveries.set(key, { ...clone(row), provider, receivedAt: new Date().toISOString() });
      return { inserted: true };
    },

    async getInstallation(id) { return clone(installations.get(id)) || null; },
    async upsertInstallation(row) {
      installations.set(row.id, { ...installations.get(row.id), ...clone(row) });
      return clone(installations.get(row.id));
    },

    async getRepository(id) { return clone(repositories.get(id)) || null; },
    async upsertRepository(row) {
      repositories.set(row.id, { ...repositories.get(row.id), ...clone(row) });
      return clone(repositories.get(row.id));
    },

    async createCommandRequest(row) { commandRequests.set(row.id, clone(row)); return clone(row); },

    async nextJobNumber() { jobCounter += 1; return jobCounter; },

    // Mirrors the partial unique index route3_job_coalesce.
    async createJob(row) {
      const open = [...jobs.values()].find(job =>
        job.terminal === false &&
        job.repositoryId === row.repositoryId &&
        job.command === row.command &&
        same(job.headSha, row.headSha) &&
        same(job.scope, row.scope));
      if (open) return { job: clone(open), coalescedWith: open.id };
      jobs.set(row.id, { ...clone(row), terminal: Boolean(row.terminal) });
      return { job: clone(jobs.get(row.id)), coalescedWith: null };
    },

    async getJob(id) { return clone(jobs.get(id)) || null; },

    async transitionJob(id, fromStatus, patch) {
      const job = jobs.get(id);
      if (!job || job.terminal === true || job.status !== fromStatus) return null;
      Object.assign(job, clone(patch));
      return clone(job);
    },

    async listRecentJobs({ repositoryId, limit = 10 }) {
      return [...jobs.values()]
        .filter(job => job.repositoryId === repositoryId)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .slice(0, limit)
        .map(clone);
    },

    async appendAudit(event) { audit.push(clone(event)); return clone(event); },
    async listAudit({ jobId } = {}) {
      return audit.filter(event => !jobId || event.jobId === jobId).map(clone);
    },

    async claimOperation({ idempotencyKey, jobId, operation }) {
      const existing = operations.get(idempotencyKey);
      if (existing) return { claimed: false, record: clone(existing) };
      const record = { idempotencyKey, jobId, operation, status: 'pending', result: null };
      operations.set(idempotencyKey, record);
      return { claimed: true, record: clone(record) };
    },

    async completeOperation(idempotencyKey, result) {
      const record = operations.get(idempotencyKey);
      if (!record) throw new Error(`Unknown operation ${idempotencyKey}`);
      record.status = 'succeeded';
      record.result = clone(result);
      return clone(record);
    },
  };

  return assertStore(store);
}

module.exports = { createMemoryStore };
