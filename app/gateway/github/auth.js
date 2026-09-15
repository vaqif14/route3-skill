'use strict';

const crypto = require('node:crypto');

const JWT_LIFETIME_SECONDS = 540;        // under GitHub's 10-minute ceiling
const CLOCK_SKEW_SECONDS = 60;
const REFRESH_MARGIN_MS = 60 * 1000;

function base64url(input) {
  return Buffer.from(input).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function appJwt({ appId, privateKey, now = Date.now() }) {
  const issuedAt = Math.floor(now / 1000) - CLOCK_SKEW_SECONDS;
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({
    iat: issuedAt, exp: issuedAt + JWT_LIFETIME_SECONDS, iss: String(appId),
  }));
  const signature = crypto.sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), privateKey);
  return `${header}.${payload}.${base64url(signature)}`;
}

// Tokens live in memory only. They are never persisted, logged, or handed to a runner.
function createInstallationTokens({ appId, privateKey, fetchImpl = fetch, now = () => Date.now(), apiBase = 'https://api.github.com', timeoutMs = 10_000 }) {
  const cache = new Map();
  const inflight = new Map();

  async function mint(installationId) {
    // A plain AbortController + setTimeout, not AbortSignal.timeout(): that helper's
    // internal timer is deliberately unref'd (Node keeps a hung fetch from blocking
    // process exit), so with nothing else pending on the event loop it can starve
    // and never fire at all. A ref'd timer, cleared in `finally`, fires reliably and
    // still never outlives this one request.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(`${apiBase}/app/installations/${installationId}/access_tokens`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${appJwt({ appId, privateKey, now: now() })}`,
          accept: 'application/vnd.github+json',
          'user-agent': 'route3-gateway',
        },
        signal: controller.signal,
      });
    } catch (error) {
      if (error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
        const timeoutError = new Error(`Installation token request timed out after ${timeoutMs}ms`);
        timeoutError.statusCode = 0;
        timeoutError.transient = true;
        throw timeoutError;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      const error = new Error(`Installation token request failed with ${response.status}`);
      error.statusCode = response.status;
      error.transient = response.status >= 500 || response.status === 429;
      throw error;
    }
    const body = await response.json();
    const expiresAtMs = Date.parse(body.expires_at);
    if (typeof body.token !== 'string' || typeof body.expires_at !== 'string' || !Number.isFinite(expiresAtMs)) {
      throw new Error('Installation token response was malformed.');
    }
    cache.set(installationId, { token: body.token, expiresAtMs });
    return body.token;
  }

  async function get(installationId) {
    const cached = cache.get(installationId);
    if (cached && cached.expiresAtMs - now() > REFRESH_MARGIN_MS) return cached.token;
    const existing = inflight.get(installationId);
    if (existing) return existing;
    const pending = mint(installationId);
    inflight.set(installationId, pending);
    try {
      return await pending;
    } finally {
      inflight.delete(installationId);
    }
  }

  return { get, forget: id => cache.delete(id), size: () => cache.size };
}

module.exports = { appJwt, base64url, createInstallationTokens, JWT_LIFETIME_SECONDS };
