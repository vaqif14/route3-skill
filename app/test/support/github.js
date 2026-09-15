'use strict';

const crypto = require('node:crypto');

function testKeyPair() {
  return crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

// routes: { 'POST /app/installations/1001/access_tokens': () => ({status, body, headers}) }
function recordingFetch(routes) {
  const calls = [];
  async function fetchImpl(url, options = {}) {
    const method = options.method || 'GET';
    const path = String(url).replace('https://api.github.com', '');
    calls.push({ method, path, headers: options.headers || {}, body: options.body });
    const handler = routes[`${method} ${path}`];
    if (!handler) throw new Error(`recordingFetch: no route registered for ${method} ${path}`);
    const { status = 200, body = {}, headers: responseHeaders = {} } = handler({ method, path, options });
    const text = JSON.stringify(body);
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: name => (responseHeaders[String(name).toLowerCase()] ?? null) },
      async text() { return text; },
      async json() { return JSON.parse(text); },
    };
  }
  return { fetchImpl, calls };
}

module.exports = { testKeyPair, recordingFetch };
