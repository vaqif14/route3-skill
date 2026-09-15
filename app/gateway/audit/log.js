'use strict';

const crypto = require('node:crypto');
const { redact } = require('../../../control-center/security');

const TYPES = new Set([
  'WEBHOOK_REJECTED', 'WEBHOOK_DUPLICATE', 'COMMAND_PARSED',
  'JOB_CREATED', 'JOB_COALESCED', 'JOB_AUTHORIZED', 'JOB_REJECTED',
  'JOB_TRANSITIONED', 'JOB_COMPLETED',
  'PUBLICATION_STARTED', 'COMMENT_POSTED', 'COMMENT_UPDATED',
  'SECURITY_EVENT',
]);

const SENSITIVE_KEY = /token|password|secret|api[_-]?key|authorization|cookie|signature|private[_-]?key/i;

// Redact by key and by value. redact() is applied to strings individually —
// never to a serialized object, because it would break the JSON.
function scrub(value) {
  // A function isn't cloneable: appendAudit's structuredClone would throw
  // DataCloneError on it, failing an otherwise-valid audit append.
  if (typeof value === 'function') return '[FUNCTION]';
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === 'object') {
    // Object.create(null), not {}: a metadata key literally named "__proto__"
    // would otherwise hit the Object.prototype accessor instead of becoming
    // an own property, silently dropping that field from an append-only record.
    const out = Object.create(null);
    for (const [key, item] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : scrub(item);
    }
    return out;
  }
  return value;
}

function createAuditLog(store) {
  return {
    async append({ type, actor, installationId = null, jobId = null, metadata = {} }) {
      if (!TYPES.has(type)) throw new Error(`Unknown audit event type: ${type}`);
      if (!actor) throw new Error('Audit events require an actor.');
      return store.appendAudit({
        eventId: crypto.randomUUID(),
        type,
        actor,
        installationId,
        jobId,
        metadata: scrub(metadata),
        occurredAt: new Date().toISOString(),
      });
    },
  };
}

module.exports = { createAuditLog, TYPES, scrub };
