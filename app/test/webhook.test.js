'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');

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

test('signature forgery variants are all rejected', () => {
  const body = Buffer.from('{"action":"created"}');
  const good = sign(body);
  const flipped = good.slice(0, -1) + (good.slice(-1) === 'a' ? 'b' : 'a');
  assert.equal(verifySignature(body, flipped, SECRET), false, 'single bit flip');
  assert.equal(verifySignature(body, good.slice(0, -4), SECRET), false, 'truncated');
  assert.equal(verifySignature(body, `${good}00`, SECRET), false, 'extended');
  assert.equal(verifySignature(body, good.toUpperCase(), SECRET), false, 'uppercase hex');
  assert.equal(verifySignature(body, good.replace('sha256=', 'sha1='), SECRET), false, 'downgraded prefix');
  assert.equal(verifySignature(body, [good], SECRET), false, 'header collapsed to an array');
  assert.equal(verifySignature(body, {}, SECRET), false, 'header not a string');
});

test('string chunks are normalised to Buffers and counted by byte length', async () => {
  const body = await readRawBody(Readable.from(['{"a":', '1}']));
  assert.ok(Buffer.isBuffer(body));
  assert.equal(body.toString(), '{"a":1}');
});

test('the bounded reader settles exactly once when the cap is crossed mid-stream', async () => {
  const half = Buffer.alloc(Math.ceil(MAX_BODY_BYTES / 2) + 1, 0x61);
  let settles = 0;
  await readRawBody(Readable.from([half, half, half]))
    .then(() => { settles += 1; }, error => { settles += 1; assert.ok(error instanceof BodyTooLarge); });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settles, 1, 'the promise settled exactly once');
});
