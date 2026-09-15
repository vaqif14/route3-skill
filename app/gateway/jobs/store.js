'use strict';

const REQUIRED = [
  'recordDelivery',
  'getInstallation', 'upsertInstallation',
  'getRepository', 'upsertRepository',
  'createCommandRequest',
  'nextJobNumber', 'createJob', 'getJob', 'transitionJob', 'listRecentJobs',
  'appendAudit', 'listAudit',
  'claimOperation', 'completeOperation',
];

class StoreContractError extends Error {
  constructor(message) { super(message); this.name = 'StoreContractError'; }
}

// Every store implementation passes through here so a missing method is a loud
// failure at construction rather than a null at request time.
function assertStore(store) {
  const missing = REQUIRED.filter(name => typeof store[name] !== 'function');
  if (missing.length > 0) throw new StoreContractError(`Store is missing: ${missing.join(', ')}`);
  return store;
}

module.exports = { REQUIRED, StoreContractError, assertStore };
