'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { appJwt, base64url, createInstallationTokens } = require('../gateway/github/auth');
const { createClient, GitHubError } = require('../gateway/github/client');
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
