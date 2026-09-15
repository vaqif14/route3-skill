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
      // Node's http server emits Buffers, but a caller that set an encoding would
      // emit strings: counting chunk.length would then count characters, not bytes,
      // and Buffer.concat would throw inside the 'end' listener and escape this
      // promise. Buffer.from assumes UTF-8, which is correct for a JSON webhook body.
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > limit) {
        settled = true;
        // Stop reading, do not destroy: the caller still has to write a 413 on this
        // response, and destroying the socket here would prevent that.
        request.pause();
        reject(new BodyTooLarge());
        return;
      }
      chunks.push(buffer);
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
