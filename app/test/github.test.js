'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { appJwt, base64url, createInstallationTokens } = require('../gateway/github/auth');
const { createClient, GitHubError, UnsafePathSegment } = require('../gateway/github/client');
const { testKeyPair, recordingFetch } = require('./support/github');

const { publicKey, privateKey } = testKeyPair();
const decode = segment => JSON.parse(Buffer.from(segment.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());

test('the app JWT is RS256 and verifies against the public key', () => {
  const token = appJwt({ appId: 12345, privateKey, now: 1_800_000_000_000 });
  const [header, payload, signature] = token.split('.');
  assert.deepEqual(decode(header), { alg: 'RS256', typ: 'JWT' });
  const claims = decode(payload);
  assert.equal(claims.iss, '12345');
  assert.equal(claims.iat, 1_800_000_000 - 60, 'iat allows for clock skew');
  assert.equal(claims.exp - claims.iat, 540, 'exp stays under the 10-minute ceiling');
  const verified = crypto.verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), publicKey,
    Buffer.from(signature.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
  assert.equal(verified, true);
});

test('base64url output carries no padding or unsafe characters', () => {
  assert.doesNotMatch(base64url('any input at all ???'), /[+/=]/);
});

test('an installation token is fetched once and cached', async () => {
  let clock = 1_800_000_000_000;
  const { fetchImpl, calls } = recordingFetch({
    'POST /app/installations/1001/access_tokens': () => ({
      status: 201, body: { token: 'ghs_fake_token_value', expires_at: new Date(clock + 3600_000).toISOString() },
    }),
  });
  const tokens = createInstallationTokens({ appId: 1, privateKey, fetchImpl, now: () => clock });
  assert.equal(await tokens.get(1001), 'ghs_fake_token_value');
  assert.equal(await tokens.get(1001), 'ghs_fake_token_value');
  assert.equal(calls.length, 1, 'the second call is served from cache');
  assert.equal(tokens.size(), 1);
});

test('a token close to expiry is refreshed', async () => {
  let clock = 1_800_000_000_000;
  const { fetchImpl, calls } = recordingFetch({
    'POST /app/installations/1001/access_tokens': () => ({
      status: 201, body: { token: `ghs_${calls.length}`, expires_at: new Date(clock + 30_000).toISOString() },
    }),
  });
  const tokens = createInstallationTokens({ appId: 1, privateKey, fetchImpl, now: () => clock });
  await tokens.get(1001);
  await tokens.get(1001);
  assert.equal(calls.length, 2, 'a token with under 60s left is not reused');
});

test('a malformed token response is rejected', async () => {
  const { fetchImpl } = recordingFetch({
    'POST /app/installations/1001/access_tokens': () => ({ status: 201, body: { nope: true } }),
  });
  const tokens = createInstallationTokens({ appId: 1, privateKey, fetchImpl });
  await assert.rejects(() => tokens.get(1001), /malformed/);
});

test('a 5xx from GitHub is transient and a 404 is not', async () => {
  const { fetchImpl } = recordingFetch({
    'POST /app/installations/1001/access_tokens': () => ({ status: 201, body: { token: 't', expires_at: new Date(Date.now() + 3600_000).toISOString() } }),
    'GET /repos/o/r/boom': () => ({ status: 503, body: { message: 'unavailable' } }),
    'GET /repos/o/r/gone': () => ({ status: 404, body: { message: 'Not Found' } }),
  });
  const client = createClient({ tokens: createInstallationTokens({ appId: 1, privateKey, fetchImpl }), fetchImpl });
  await assert.rejects(() => client.request(1001, 'GET', '/repos/o/r/boom'), error => {
    assert.ok(error instanceof GitHubError);
    assert.equal(error.transient, true);
    return true;
  });
  await assert.rejects(() => client.request(1001, 'GET', '/repos/o/r/gone'), error => {
    assert.equal(error.transient, false);
    assert.equal(error.statusCode, 404);
    return true;
  });
});

test('actor permission is read from the collaborator endpoint', async () => {
  const { fetchImpl } = recordingFetch({
    'POST /app/installations/1001/access_tokens': () => ({ status: 201, body: { token: 't', expires_at: new Date(Date.now() + 3600_000).toISOString() } }),
    'GET /repos/o/r/collaborators/someone/permission': () => ({ status: 200, body: { permission: 'write' } }),
  });
  const client = createClient({ tokens: createInstallationTokens({ appId: 1, privateKey, fetchImpl }), fetchImpl });
  assert.equal(await client.actorPermission(1001, 'o/r', 'someone'), 'write');
});

test('a token never appears in a thrown error message', async () => {
  const { fetchImpl } = recordingFetch({
    'POST /app/installations/1001/access_tokens': () => ({ status: 201, body: { token: 'ghs_supersecret', expires_at: new Date(Date.now() + 3600_000).toISOString() } }),
    'GET /repos/o/r/gone': () => ({ status: 404, body: { message: 'Not Found' } }),
  });
  const client = createClient({ tokens: createInstallationTokens({ appId: 1, privateKey, fetchImpl }), fetchImpl });
  await assert.rejects(() => client.request(1001, 'GET', '/repos/o/r/gone'), error => {
    assert.doesNotMatch(error.message, /ghs_supersecret/);
    return true;
  });
});

test('concurrent gets for the same installation mint only one token', async () => {
  let calls = 0;
  const { fetchImpl } = recordingFetch({
    'POST /app/installations/1001/access_tokens': () => {
      calls += 1;
      return { status: 201, body: { token: 'ghs_fake_token_value', expires_at: new Date(Date.now() + 3600_000).toISOString() } };
    },
  });
  const tokens = createInstallationTokens({ appId: 1, privateKey, fetchImpl });
  const [a, b, c] = await Promise.all([tokens.get(1001), tokens.get(1001), tokens.get(1001)]);
  assert.equal(a, 'ghs_fake_token_value');
  assert.equal(b, a);
  assert.equal(c, a);
  assert.equal(calls, 1, 'three concurrent cold-cache gets must share one request');
});

test('the comment endpoints use the documented GitHub paths', async () => {
  const { fetchImpl, calls } = recordingFetch({
    'POST /app/installations/1001/access_tokens': () => ({ status: 201, body: { token: 't', expires_at: new Date(Date.now() + 3600_000).toISOString() } }),
    'POST /repos/o/r/issues/42/comments': () => ({ status: 201, body: { id: 100 } }),
    'PATCH /repos/o/r/issues/comments/100': () => ({ status: 200, body: { id: 100 } }),
    'GET /repos/o/r/issues/42/comments?per_page=100': () => ({ status: 200, body: [] }),
  });
  const client = createClient({ tokens: createInstallationTokens({ appId: 1, privateKey, fetchImpl }), fetchImpl });
  assert.equal((await client.createComment(1001, 'o/r', 42, 'hello')).id, 100);
  await client.updateComment(1001, 'o/r', 100, 'edited');
  assert.deepEqual(await client.listComments(1001, 'o/r', 42), []);
  const paths = calls.filter(call => !call.path.includes('access_tokens')).map(call => `${call.method} ${call.path}`);
  assert.deepEqual(paths, [
    'POST /repos/o/r/issues/42/comments',
    'PATCH /repos/o/r/issues/comments/100',
    'GET /repos/o/r/issues/42/comments?per_page=100',
  ]);
});

test('unsafe path segments are refused before any request is made', async () => {
  const { fetchImpl, calls } = recordingFetch({ 'POST /app/installations/1001/access_tokens': () => ({ status: 201, body: { token: 't', expires_at: new Date(Date.now() + 3600_000).toISOString() } }) });
  const client = createClient({ tokens: createInstallationTokens({ appId: 1, privateKey, fetchImpl }), fetchImpl });
  for (const bad of ['o/r/../../user/repos', 'o/r/../../app/installations/9999/access_tokens#', 'o', 'o/r/x', '../etc']) {
    await assert.rejects(() => client.createComment(1001, bad, 42, 'x'), UnsafePathSegment, bad);
  }
  for (const bad of ['a/../../../user/repos', 'someone?visible=false', 'has space', '']) {
    await assert.rejects(() => client.actorPermission(1001, 'o/r', bad), UnsafePathSegment, bad);
  }
  assert.equal(calls.length, 0, 'nothing may reach the network with an unsafe segment');
});

test('a legitimate repository name and login still pass', async () => {
  const { fetchImpl } = recordingFetch({
    'POST /app/installations/1001/access_tokens': () => ({ status: 201, body: { token: 't', expires_at: new Date(Date.now() + 3600_000).toISOString() } }),
    'GET /repos/vaqif14/route3-e2e-fixture/collaborators/vaqif14/permission': () => ({ status: 200, body: { permission: 'admin' } }),
  });
  const client = createClient({ tokens: createInstallationTokens({ appId: 1, privateKey, fetchImpl }), fetchImpl });
  assert.equal(await client.actorPermission(1001, 'vaqif14/route3-e2e-fixture', 'vaqif14'), 'admin');
});

test('a hung request times out as a transient failure', async () => {
  const fetchImpl = (url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' })));
  });
  const tokens = { get: async () => 't', forget: () => {} };
  const client = createClient({ tokens, fetchImpl, timeoutMs: 25 });
  await assert.rejects(() => client.request(1001, 'GET', '/x'), error => {
    assert.equal(error.name, 'GitHubError');
    assert.equal(error.transient, true);
    assert.match(error.message, /timed out/);
    return true;
  });
});

test('a 401 drops the cached token so the next call re-mints', async () => {
  let forgotten = null;
  const tokens = { get: async () => 't', forget: id => { forgotten = id; } };
  const { fetchImpl } = recordingFetch({ 'GET /x': () => ({ status: 401, body: { message: 'Bad credentials' } }) });
  const client = createClient({ tokens, fetchImpl });
  await assert.rejects(() => client.request(1001, 'GET', '/x'));
  assert.equal(forgotten, 1001, 'a 401 must invalidate the cached installation token');
});

test('rate-limit exhaustion is surfaced and classified transient', async () => {
  const tokens = { get: async () => 't', forget: () => {} };
  const { fetchImpl } = recordingFetch({
    'GET /x': () => ({ status: 403, body: { message: 'rate limit' }, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1800000000', 'retry-after': '60' } }),
    'GET /y': () => ({ status: 403, body: { message: 'forbidden' } }),
  });
  const client = createClient({ tokens, fetchImpl });
  await assert.rejects(() => client.request(1001, 'GET', '/x'), error => {
    assert.equal(error.transient, true, '403 with remaining 0 is rate limiting');
    assert.equal(error.rateLimit.remaining, 0);
    assert.equal(error.retryAfter, 60);
    return true;
  });
  await assert.rejects(() => client.request(1001, 'GET', '/y'), error => {
    assert.equal(error.transient, false, 'a plain 403 is not transient');
    return true;
  });
});

test('a malformed expires_at is rejected rather than cached', async () => {
  const { fetchImpl } = recordingFetch({ 'POST /app/installations/1001/access_tokens': () => ({ status: 201, body: { token: 't', expires_at: 'not-a-date' } }) });
  const tokens = createInstallationTokens({ appId: 1, privateKey, fetchImpl });
  await assert.rejects(() => tokens.get(1001), /malformed/i);
  assert.equal(tokens.size(), 0, 'a malformed response must not be cached');
});
