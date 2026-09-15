'use strict';

const { Readable } = require('node:stream');

// A minimal stand-in for an http.IncomingMessage body stream.
function fakeRequest(body) {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  return Readable.from([buffer]);
}

function chunkedRequest(chunks) {
  return Readable.from(chunks.map(chunk => Buffer.from(chunk)));
}

module.exports = { fakeRequest, chunkedRequest };
