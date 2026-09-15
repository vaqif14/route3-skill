'use strict';

const FULL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;
const LOGIN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;

class GitHubError extends Error {
  constructor(message, { statusCode, transient, rateLimit = null, retryAfter = null }) {
    super(message);
    this.name = 'GitHubError';
    this.statusCode = statusCode;
    this.transient = Boolean(transient);
    this.rateLimit = rateLimit;
    this.retryAfter = retryAfter;
  }
}

class UnsafePathSegment extends Error {
  // The offending value is deliberately NOT interpolated: it is attacker-controlled
  // text and this message reaches the logs.
  constructor(kind) {
    super(`Unsafe ${kind} for a GitHub request path`);
    this.name = 'UnsafePathSegment';
    this.kind = kind;
  }
}

function safeFullName(value) {
  if (typeof value !== 'string' || !FULL_NAME.test(value)) throw new UnsafePathSegment('repository full name');
  return value;
}

function safeLogin(value) {
  if (typeof value !== 'string' || !LOGIN.test(value)) throw new UnsafePathSegment('login');
  return value;
}

function safeNumber(value, kind) {
  if (!Number.isInteger(value) || value < 0) throw new UnsafePathSegment(kind);
  return String(value);
}

function rateLimitOf(response) {
  const headers = response && response.headers;
  if (!headers || typeof headers.get !== 'function') return null;
  const read = name => { const raw = headers.get(name); return raw === null || raw === undefined ? null : Number(raw); };
  const remaining = read('x-ratelimit-remaining');
  const reset = read('x-ratelimit-reset');
  const retryAfter = read('retry-after');
  if (remaining === null && reset === null && retryAfter === null) return null;
  return { remaining, reset, retryAfter };
}

function createClient({ tokens, fetchImpl = fetch, apiBase = 'https://api.github.com', userAgent = 'route3-gateway', timeoutMs = 10_000 }) {
  // The error message names the method and path only. The token never enters it.
  async function request(installationId, method, path, body) {
    const token = await tokens.get(installationId);
    // A plain AbortController + setTimeout, not AbortSignal.timeout(): that helper's
    // internal timer is deliberately unref'd (Node keeps a hung fetch from blocking
    // process exit), so with nothing else pending on the event loop it can starve
    // and never fire at all. A ref'd timer, cleared in `finally`, fires reliably and
    // still never outlives this one request.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(`${apiBase}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
          'user-agent': userAgent,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      });
    } catch (error) {
      if (error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
        throw new GitHubError(`GitHub ${method} ${path} timed out after ${timeoutMs}ms`, { statusCode: 0, transient: true });
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const rateLimit = rateLimitOf(response);
      const exhausted = rateLimit !== null && rateLimit.remaining === 0;
      // A 401 means the cached token is dead: drop it so the next call re-mints.
      if (response.status === 401 && tokens && typeof tokens.forget === 'function') tokens.forget(installationId);
      throw new GitHubError(`GitHub ${method} ${path} failed with ${response.status}`, {
        statusCode: response.status,
        // GitHub signals primary rate-limit exhaustion as 403 with remaining 0.
        transient: response.status >= 500 || response.status === 429 || (response.status === 403 && exhausted),
        rateLimit,
        retryAfter: rateLimit === null ? null : rateLimit.retryAfter,
      });
    }
    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  return {
    request,
    async actorPermission(installationId, fullName, login) {
      const safeName = safeFullName(fullName);
      const safeUser = safeLogin(login);
      const body = await request(installationId, 'GET', `/repos/${safeName}/collaborators/${safeUser}/permission`);
      return body && typeof body.permission === 'string' ? body.permission : 'none';
    },
    // async, not a bare arrow returning request(...): a validation throw here must
    // surface as a rejected promise, not a synchronous exception, so callers using
    // assert.rejects (or any promise-based error handling) see it consistently.
    async createComment(installationId, fullName, number, body) {
      return request(installationId, 'POST', `/repos/${safeFullName(fullName)}/issues/${safeNumber(number, 'issue number')}/comments`, { body });
    },
    async updateComment(installationId, fullName, commentId, body) {
      return request(installationId, 'PATCH', `/repos/${safeFullName(fullName)}/issues/comments/${safeNumber(commentId, 'comment id')}`, { body });
    },
    async listComments(installationId, fullName, number) {
      return request(installationId, 'GET', `/repos/${safeFullName(fullName)}/issues/${safeNumber(number, 'issue number')}/comments?per_page=100`);
    },
  };
}

module.exports = { GitHubError, UnsafePathSegment, createClient };
