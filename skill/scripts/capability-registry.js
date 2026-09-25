#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const DEFAULT_ROOT = path.resolve(__dirname, '..');
const MAX_CONTENT = 64 * 1024;
const digest = text => crypto.createHash('sha256').update(text).digest('hex');
function fail(message) { throw new Error(message); }
// Deliberately small JSON Schema subset. Unsupported validation keywords fail closed.
function validateSchema(value, schema, at = '$', errors = []) {
  const supported = new Set(['$schema', '$id', 'title', 'description', 'type', 'required', 'properties', 'additionalProperties', 'items', 'enum', 'pattern', 'minLength', 'maxLength', 'minimum', 'maximum', 'minItems', 'maxItems', 'uniqueItems']);
  for (const key of Object.keys(schema)) if (!supported.has(key)) errors.push(`${at}: unsupported schema keyword ${key}`);
  const type = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value === 'number' && Number.isInteger(value) ? 'integer' : typeof value;
  if (schema.type && !(Array.isArray(schema.type) ? schema.type : [schema.type]).some(t => t === type || t === 'number' && type === 'integer')) { errors.push(`${at}: expected ${schema.type}`); return errors; }
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${at}: invalid enum value`);
  if (typeof value === 'string') {
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${at}: invalid format`);
    if (schema.minLength !== undefined && value.length < schema.minLength || schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${at}: invalid length`);
  }
  if (typeof value === 'number' && (!Number.isFinite(value) || schema.minimum !== undefined && value < schema.minimum || schema.maximum !== undefined && value > schema.maximum)) errors.push(`${at}: out of range`);
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems || schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${at}: invalid item count`);
    if (schema.uniqueItems && new Set(value.map(x => JSON.stringify(x))).size !== value.length) errors.push(`${at}: duplicate items`);
    if (schema.items) value.forEach((v, i) => validateSchema(v, schema.items, `${at}[${i}]`, errors));
  } else if (value && typeof value === 'object') {
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) errors.push(`${at}.${key}: required`);
    for (const [key, val] of Object.entries(value)) {
      if (schema.properties && Object.hasOwn(schema.properties, key)) validateSchema(val, schema.properties[key], `${at}.${key}`, errors);
      else if (schema.additionalProperties === false) errors.push(`${at}.${key}: unknown field`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') validateSchema(val, schema.additionalProperties, `${at}.${key}`, errors);
    }
  }
  return errors;
}
function boundedRead(file, max = MAX_CONTENT) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try { const stat = fs.fstatSync(fd); if (!stat.isFile() || stat.size > max) fail('Invalid or oversized capability file'); return fs.readFileSync(fd, 'utf8'); }
  finally { fs.closeSync(fd); }
}
function within(root, relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative)) fail('Capability path must be relative');
  const target = fs.realpathSync(path.resolve(root, relative));
  const boundary = fs.realpathSync(root);
  if (target !== boundary && !target.startsWith(boundary + path.sep)) fail('Capability path escapes its root');
  return target;
}
function atomicJSON(file, data) {
  const temp = `${file}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  try { fs.writeFileSync(temp, JSON.stringify(data, null, 2) + '\n', {mode: 0o600, flag: 'wx'}); fs.renameSync(temp, file); }
  finally { try { fs.unlinkSync(temp); } catch {} }
}
function scanContent(text) {
  const checks = [
    ['policy_override', /(?:ignore|override|disable|bypass).{0,35}(?:previous instructions|system prompt|route3 policy|safeguards|safety checks)/i],
    ['credential_access', /(?:\.ssh|\.aws|\.config\/gcloud|git-credentials|password store|auth\.json|browser.{0,20}(?:cookie|profile)|(?:read|extract|upload|send).{0,30}(?:credential|secret|token))/i],
    ['remote_execution', /curl[^\n]{0,200}\|\s*(?:ba)?sh|wget[^\n]{0,200}\|\s*(?:ba)?sh|(?:eval|exec)\s*\(|child_process|subprocess|os\.system/i],
    ['shell_interpolation', /\$\(|`[^`\n]+`\s*;|shell\s*[:=]\s*[Tt]rue/],
    ['filesystem_escape', /\.\.\/|rm\s+-[rf]+\s+(?:~|\/)|(?:rmtree|unlink).{0,30}(?:home|~)/i],
    ['install_or_update_hook', /postinstall|preinstall|auto[- ]?update|download.{0,30}(?:script|executable|payload)/i],
    ['encoded_payload', /base64.{0,30}(?:decode|--decode|-d)|[A-Za-z0-9+/]{300,}={0,2}/i],
    ['tool_poisoning', /tool.{0,20}(?:description|result).{0,40}(?:override|instruction)|exfiltrat|hidden network/i],
  ];
  return checks.filter(([, pattern]) => pattern.test(text)).map(([code]) => code);
}
class CapabilityRegistry {
  constructor(options = {}) {
    this.skillRoot = fs.realpathSync(options.skillRoot || DEFAULT_ROOT);
    this.stateDir = path.resolve(options.stateDir || path.join(os.homedir(), '.local/share/route3/capabilities'));
    this.schema = JSON.parse(boundedRead(path.join(this.skillRoot, 'registry/skill-manifest.schema.json')));
    this.builtins = new Map();
    for (const file of fs.readdirSync(path.join(this.skillRoot, 'registry/builtin')).filter(f => f.endsWith('.json')).sort()) {
      const manifest = JSON.parse(boundedRead(within(this.skillRoot, `registry/builtin/${file}`)));
      this.validate(manifest);
      if (manifest.trustLevel !== 'BUILTIN' || manifest.source !== 'builtin' || this.builtins.has(manifest.id)) fail('Invalid builtin registry');
      this.builtins.set(manifest.id, manifest);
    }
  }
  validate(manifest) { const errors = validateSchema(manifest, this.schema); if (errors.length) fail(errors.join('; ')); return manifest; }
  ensureState() {
    fs.mkdirSync(this.stateDir, {recursive: true, mode: 0o700});
    if (fs.lstatSync(this.stateDir).isSymbolicLink() || !fs.statSync(this.stateDir).isDirectory()) fail('Unsafe capability state directory');
    fs.chmodSync(this.stateDir, 0o700);
  }
  state() {
    const file = path.join(this.stateDir, 'state.json');
    try { const value = JSON.parse(boundedRead(file, 2 * 1024 * 1024)); if (value.version !== 1 || !Array.isArray(value.entries)) fail('Invalid capability state'); return value; }
    catch (error) { if (error.code === 'ENOENT') return {version: 1, entries: [], disabled: []}; throw error; }
  }
  mutate(change) {
    this.ensureState();
    const lock = path.join(this.stateDir, '.lock');
    let fd; try { fd = fs.openSync(lock, 'wx', 0o600); } catch { fail('Capability state busy; retry after the other operation finishes'); }
    try { const state = this.state(); const result = change(state); atomicJSON(path.join(this.stateDir, 'state.json'), state); return result; }
    finally { fs.closeSync(fd); fs.unlinkSync(lock); }
  }
  entries() {
    const state = this.state();
    const builtins = [...this.builtins.values()].map(manifest => ({manifest, lifecycle: 'approved', enabled: !(state.disabled || []).includes(manifest.id), builtin: true, eval: {status: 'deterministic-suite'}}));
    const external = state.entries.map(entry => { this.validate(entry.manifest); if (this.builtins.has(entry.manifest.id) || entry.manifest.trustLevel === 'BUILTIN' || entry.manifest.source === 'builtin') fail('External entry impersonates builtin'); return entry; });
    return [...builtins, ...external];
  }
  inspect(id) { const item = this.entries().find(entry => entry.manifest.id === id); if (!item) fail('Unknown capability'); return structuredClone({...item, status: this.status(item)}); }
  status(entry) {
    if (entry.manifest.trustLevel === 'BLOCKED') return 'BLOCKED';
    if (!entry.builtin && (entry.lifecycle !== 'approved' || !['PINNED_REVIEWED', 'COMMUNITY_REVIEWED', 'FIRST_PARTY_OFFICIAL'].includes(entry.manifest.trustLevel))) return 'QUARANTINED';
    if (!entry.enabled) return 'DISABLED';
    if (!entry.builtin) { try { this.verifyExternal(entry); } catch { return 'QUARANTINED'; } }
    return 'AVAILABLE';
  }
  list() { return this.entries().map(entry => ({...structuredClone(entry), status: this.status(entry)})); }
  disable(id) { this.inspect(id); return this.mutate(state => { if (this.builtins.has(id)) state.disabled = [...new Set([...(state.disabled || []), id])]; else state.entries.find(e => e.manifest.id === id).enabled = false; return {id, enabled: false}; }); }
  enable(id) {
    const entry = this.inspect(id);
    if (['BLOCKED', 'QUARANTINED'].includes(entry.status)) fail('Review and approve the pinned candidate before enabling');
    return this.mutate(state => { if (this.builtins.has(id)) state.disabled = (state.disabled || []).filter(x => x !== id); else state.entries.find(e => e.manifest.id === id).enabled = true; return {id, enabled: true}; });
  }
  updateCandidate(manifest, {content} = {}) {
    this.validate(manifest);
    if (this.builtins.has(manifest.id) || manifest.source === 'builtin' || manifest.trustLevel === 'BUILTIN') fail('External candidates cannot replace packaged capabilities');
    if (typeof content !== 'string' || !content.trim() || Buffer.byteLength(content) > MAX_CONTENT) fail('Candidate content must contain bounded text');
    const hash = digest(content);
    return this.mutate(state => {
      const candidates = path.join(this.stateDir, 'content'); fs.mkdirSync(candidates, {mode: 0o700});
      if (fs.lstatSync(candidates).isSymbolicLink()) fail('Unsafe candidate content directory');
      const file = path.join(candidates, `${hash}.md`);
      try { fs.writeFileSync(file, content, {mode: 0o600, flag: 'wx'}); } catch (error) { if (error.code !== 'EEXIST' || digest(boundedRead(file)) !== hash) throw error; }
      const entry = {manifest: {...manifest, trustLevel: 'UNTRUSTED', entrypoint: `content/${hash}.md`}, enabled: false, builtin: false, lifecycle: 'draft', digest: hash, findings: scanContent(content), eval: null, reviewedAt: null};
      const previous = state.entries.findIndex(e => e.manifest.id === manifest.id);
      if (previous >= 0) state.entries[previous] = entry; else { if (state.entries.length >= 200) fail('External capability limit reached'); state.entries.push(entry); }
      return {id: manifest.id, digest: hash, lifecycle: entry.lifecycle, status: 'QUARANTINED', findings: entry.findings};
    });
  }
  recordEval(id, evidence) {
    if (!evidence || evidence.passed !== true || !Number.isInteger(evidence.cases) || evidence.cases < 1 || evidence.unsafeActivations !== 0 || typeof evidence.suite !== 'string' || !evidence.suite.trim() || evidence.suite.length > 300) fail('Passing evaluation evidence is required');
    return this.mutate(state => { const e = state.entries.find(e => e.manifest.id === id); if (!e || e.lifecycle === 'approved') fail('Evaluate an existing draft candidate'); if (evidence.digest !== e.digest) fail('Evaluation must bind the candidate digest'); e.eval = {...evidence, recordedAt: new Date().toISOString()}; e.lifecycle = 'evaluated'; return {id, lifecycle: e.lifecycle}; });
  }
  review(id, {approved = false, reviewer, acceptedFindings = [], expectedDigest} = {}) {
    return this.mutate(state => {
      const entry = state.entries.find(e => e.manifest.id === id);
      if (!entry || entry.lifecycle !== 'evaluated') fail('Candidate must pass evaluation before review');
      if (typeof reviewer !== 'string' || !reviewer.trim() || reviewer.length > 200) fail('Reviewer identity is required');
      if (expectedDigest !== entry.digest) fail('Review must bind the inspected candidate digest');
      const text = boundedRead(within(this.stateDir, entry.manifest.entrypoint));
      if (digest(text) !== entry.digest) fail('Candidate digest changed; create and evaluate a new candidate');
      if (approved) {
        if (!/^[a-f0-9]{40}$/.test(entry.manifest.sourceCommit || '')) fail('External review requires an exact commit');
        if (!entry.manifest.sourceRepository || ['UNKNOWN', 'NOASSERTION', 'UNLICENSED', ''].includes(entry.manifest.license.toUpperCase())) fail('A reviewed compatible license is required');
        if (!Array.isArray(acceptedFindings) || entry.findings.some(f => !acceptedFindings.includes(f))) fail('Every static finding needs explicit contextual review');
      }
      entry.lifecycle = approved ? 'approved' : 'rejected'; entry.enabled = false;
      entry.manifest.trustLevel = approved ? 'PINNED_REVIEWED' : 'BLOCKED';
      entry.reviewedAt = new Date().toISOString(); entry.manifest.lastReviewedAt = entry.reviewedAt;
      entry.review = {reviewer, acceptedFindings, digest: entry.digest};
      return {id, lifecycle: entry.lifecycle, enabled: false};
    });
  }
  verifyExternal(entry) {
    if (!entry.review || entry.review.digest !== entry.digest || !entry.eval || entry.eval.digest !== entry.digest || entry.eval.passed !== true || entry.eval.unsafeActivations !== 0) fail('External review/evaluation evidence missing');
    if (!/^[a-f0-9]{40}$/.test(entry.manifest.sourceCommit || '') || !entry.manifest.sourceRepository || ['UNKNOWN', 'NOASSERTION', 'UNLICENSED', ''].includes(entry.manifest.license.toUpperCase())) fail('External provenance missing');
    const text = boundedRead(within(this.stateDir, entry.manifest.entrypoint)); if (digest(text) !== entry.digest) fail('External digest drift; review required'); return text;
  }
  remove(id) { if (this.builtins.has(id)) fail('Packaged capabilities can be disabled, not removed'); return this.mutate(state => { const before = state.entries.length; state.entries = state.entries.filter(e => e.manifest.id !== id); if (state.entries.length === before) fail('Unknown capability'); return {id, removed: true}; }); }
  activate(id, context = {}) {
    const {gateCapability} = require('./capability-router');
    const entry = this.inspect(id); const gate = gateCapability(entry, context, this);
    if (!gate.allowed) return {activated: false, id, ...gate};
    const content = entry.builtin ? boundedRead(within(this.skillRoot, entry.manifest.entrypoint)) : this.verifyExternal(entry);
    const limit = context.maxContextBytes === undefined ? 32 * 1024 : context.maxContextBytes;
    if (!Number.isFinite(limit) || Buffer.byteLength(content) > limit) return {activated: false, id, allowed: false, reasons: ['context_byte_budget']};
    return {activated: true, id, content, digest: digest(content), bytes: Buffer.byteLength(content), estimatedTokens: Math.ceil(Buffer.byteLength(content) / 4), tokenMeasurement: 'byte/4 estimate; not provider token usage', source: entry.manifest.sourceRepository, commit: entry.manifest.sourceCommit};
  }
}
module.exports = {CapabilityRegistry, validateSchema, scanContent, digest, within};
