'use strict';

const crypto = require('node:crypto');

function redact(value) {
  return String(value ?? '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/(-----BEGIN [^-]*PRIVATE KEY-----)[\s\S]*?(-----END [^-]*PRIVATE KEY-----|$)/g, '[REDACTED PRIVATE KEY]')
    // Bearer/Basic runs before the generic key=value scan below: that scan's value
    // pattern stops at the first space, so "authorization: Bearer <token>" would
    // otherwise be split and only the word "Bearer" would be swallowed, leaving the
    // real token in place. Matching the whole "Bearer <token>" pair first avoids that.
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9+/=_\-.]+/gi, '[REDACTED AUTH]')
    .replace(/((?:["']?)(?:[\w.-]*(?:token|password|secret|api[_-]?key|authorization|cookie)[\w.-]*)(?:["']?)\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|\[REDACTED[^\]\n]*\](?=[\s,;}]|$)|[^\s,;}]+)/gi, '$1[REDACTED]')
    .replace(/\b\d{5,16}:[A-Za-z0-9_-]{20,}\b/g, '[REDACTED TELEGRAM TOKEN]')
    .replace(/\b(?:sk-|sk-ant-|ghp_|ghs_|gho_|ghu_|ghr_|github_pat_)[A-Za-z0-9_-]{12,}/g, '[REDACTED KEY]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@');
}

function equalToken(actual, expected) {
  if (typeof actual !== 'string') return false;
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { redact, equalToken };
