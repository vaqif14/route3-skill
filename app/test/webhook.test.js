'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { readRawBody, verifySignature, dedupe, BodyTooLarge, MAX_BODY_BYTES } = require('../gateway/github/webhook');
const { createMemoryStore } = require('../gateway/jobs/store.memory');
const { fakeRequest, chunkedRequest } = require('./support/http');

const SECRET = 'route3-test-secret';
const sign = (body, secret = SECRET) =>
  `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;

test('a correctly signed body verifies', () => {
  const body = Buffer.from('{"action":"created"}');
  assert.equal(verifySignature(body, sign(body), SECRET), true);
});

test('a tampered body does not verify', () => {
  const body = Buffer.from('{"action":"created"}');
  const signature = sign(body);
  assert.equal(verifySignature(Buffer.from('{"action":"deleted"}'), signature, SECRET), false);
});

test('a signature made with another secret does not verify', () => {
  const body = Buffer.from('{}');
  assert.equal(verifySignature(body, sign(body, 'other-secret'), SECRET), false);
});

test('a missing or malformed signature header does not verify', () => {
  const body = Buffer.from('{}');
  assert.equal(verifySignature(body, undefined, SECRET), false);
  assert.equal(verifySignature(body, '', SECRET), false);
  assert.equal(verifySignature(body, 'sha1=deadbeef', SECRET), false);
  assert.equal(verifySignature(body, crypto.createHmac('sha256', SECRET).update(body).digest('hex'), SECRET), false);
});

test('an unconfigured secret is a startup error, not a silent pass', () => {
  assert.throws(() => verifySignature(Buffer.from('{}'), 'sha256=x', ''), /not configured/);
});

test('the raw body is read intact across chunks', async () => {
  const body = await readRawBody(chunkedRequest(['{"a":', '1}']));
  assert.equal(body.toString(), '{"a":1}');
});

test('an oversized body is refused', async () => {
  const request = fakeRequest(Buffer.alloc(MAX_BODY_BYTES + 1, 0x61));
  await assert.rejects(() => readRawBody(request), BodyTooLarge);
});

test('a delivery is accepted once and deduped thereafter', async () => {
  const store = createMemoryStore();
  const delivery = { deliveryId: 'aaaa-bbbb', event: 'issue_comment', installationId: 1 };
  assert.equal(await dedupe(store, delivery), true);
  assert.equal(await dedupe(store, delivery), false);
  assert.equal(await dedupe(store, { ...delivery, deliveryId: 'cccc-dddd' }), true);
});
