'use strict';

const crypto = require('node:crypto');

function testKeyPair() {
  return crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

// routes: { 'POST /app/installations/1001/access_tokens': () => ({status, body}) }
function recordingFetch(routes) {
  const calls = [];
  async function fetchImpl(url, options = {}) {
    const method = options.method || 'GET';
    const path = String(url).replace('https://api.github.com', '');
    calls.push({ method, path, headers: options.headers || {}, body: options.body });
    const handler = routes[`${method} ${path}`];
    if (!handler) return { ok: false, status: 404, async text() { return '{"message":"Not Found"}'; }, async json() { return { message: 'Not Found' }; } };
    const { status = 200, body = {} } = handler({ method, path, options });
    const text = JSON.stringify(body);
    return { ok: status >= 200 && status < 300, status, async text() { return text; }, async json() { return JSON.parse(text); } };
  }
  return { fetchImpl, calls };
}

module.exports = { testKeyPair, recordingFetch };
