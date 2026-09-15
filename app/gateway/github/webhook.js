'use strict';

const crypto = require('node:crypto');
const { equalToken } = require('../../../control-center/security');

const MAX_BODY_BYTES = 1024 * 1024;

class BodyTooLarge extends Error {
  constructor() {
    super('Webhook body exceeds 1 MiB.');
    this.name = 'BodyTooLarge';
    this.statusCode = 413;
  }
}

function readRawBody(request, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    let settled = false;
    request.on('data', chunk => {
      if (settled) return;
      bytes += chunk.length;
      if (bytes > limit) { settled = true; reject(new BodyTooLarge()); return; }
      chunks.push(chunk);
    });
    request.on('end', () => { if (!settled) { settled = true; resolve(Buffer.concat(chunks)); } });
    request.on('error', error => { if (!settled) { settled = true; reject(error); } });
  });
}

// Verified against the RAW bytes. Nothing in the payload is interpreted before
// this returns true.
function verifySignature(rawBody, headerValue, secret) {
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new Error('Webhook secret is not configured.');
  }
  if (typeof headerValue !== 'string' || !headerValue.startsWith('sha256=')) return false;
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  return equalToken(headerValue, expected);
}

// Returns true when this delivery has not been seen before.
async function dedupe(store, { deliveryId, event, installationId = null }) {
  const { inserted } = await store.recordDelivery({
    provider: 'github', deliveryId, event, installationId, outcome: 'accepted',
  });
  return inserted;
}

module.exports = { MAX_BODY_BYTES, BodyTooLarge, readRawBody, verifySignature, dedupe };
