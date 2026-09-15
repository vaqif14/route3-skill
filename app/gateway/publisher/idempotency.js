'use strict';

function keyFor(jobId, operation) { return `route3:${jobId}:${operation}`; }

function createJournal(store) {
  return {
    keyFor,
    // claimed   — this process owns the operation and must perform it
    // pending   — a previous attempt claimed it and did not finish; read back first
    // succeeded — already done; reuse the recorded result and call nothing
    async begin(jobId, operation) {
      const key = keyFor(jobId, operation);
      const { claimed, record } = await store.claimOperation({ idempotencyKey: key, jobId, operation });
      if (claimed) return { status: 'claimed', key };
      if (record.status === 'succeeded') return { status: 'succeeded', key, result: record.result };
      return { status: 'pending', key, result: record.result };
    },
    async finish(key, result) { return store.completeOperation(key, result); },
  };
}

module.exports = { createJournal, keyFor };
