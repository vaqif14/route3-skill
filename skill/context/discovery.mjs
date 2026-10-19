#!/usr/bin/env node
// Local repository discovery: directory prioritization, content ranking,
// structural follow-up, and bounded source excerpts. No model or service calls.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
import {extract, resolveImport} from './engine.mjs';

export const DEFAULTS = {timeoutMs: 5000, maxFiles: 3000, maxReadBytes: 32 * 1024 * 1024,
  maxFileBytes: 256 * 1024, maxOutputBytes: 24000, k: 8};
const STOP = new Set(('a an and are as at be before by can do does for from how i in is it of on or that the their this to what when where which who why with works ' +
  'bir bu üçün və ilə necə harada hansı nə').split(' '));
const CONCEPTS = [
  'auth authentication authenticate authorization authorize permission permissions access login signin session icazə giriş səlahiyyət',
  'retry retries backoff attempt təkrar',
  'timeout deadline abort cancel cancellation',
  'telemetry metric metrics analytics tracking monitoring',
  'database db sql prisma connection pool verilənlər',
  'payment billing invoice refund ödəniş',
  'cache caching cached invalidate invalidation',
  'queue queued worker job task növbə',
].map(group => group.split(' '));
const TEXT = /\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|swift|rb|php|cs|c|h|cpp|hpp|sh|bash|sql|graphql|gql|prisma|vue|svelte|md|mdx|json|ya?ml|toml|css|scss|html)$/i;
const BLOCKED = /(?:^|\/)(?:\.[^/]+|node_modules|vendor|dist|build|coverage|target|generated)(?:\/|$)/;
const DECLARATION = /^\s*(?:(?:export|default|public|private|protected|static|async)\s+)*(?:function|class|interface|type|enum|def|func|fn|struct|impl|const|let)\b/;

export function tokens(text) {
  return (text.match(/[\p{L}\p{N}]+/gu) || []).flatMap(word => [...new Set([
    word.toLowerCase(), ...word.replace(/([a-z\d])([A-Z])/g, '$1 $2')
      .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2').toLowerCase().split(' '),
  ])]).filter(t => t.length > 1 && !STOP.has(t));
}
function queryTerms(query) {
  const terms = new Map(tokens(query).slice(0, 64).map(t => [t, 1]));
  for (const group of CONCEPTS) if (group.some(t => terms.get(t) === 1)) {
    for (const t of group) if (!terms.has(t)) terms.set(t, 0.3);
  }
  return terms;
}
function integer(value, fallback, name, min, max) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return Number(value);
}
function count(text) {
  const counts = new Map();
  for (const t of tokens(text)) counts.set(t, (counts.get(t) || 0) + 1);
  return counts;
}

// Narrowing globs only: *, **, ?, anchored paths, and trailing directory slash.
// This deliberately does not approximate all of gitignore's negation syntax.
export function exclusion(pattern) {
  if (!pattern || !pattern.trim() || /[\r\n\0]/.test(pattern) || /^[!#]/.test(pattern) || /[\[\]\\]/.test(pattern)) {
    throw new Error('exclude supports narrowing globs (*, **, ?), not negation, classes, or escapes');
  }
  const anchored = pattern.startsWith('/');
  const normalized = pattern.replace(/^\//, '').replace(/\/$/, '');
  if (!normalized || normalized.split('/').includes('..')) throw new Error('exclude must be root-relative');
  let source = '';
  for (let i = 0; i < normalized.length; i++) {
    const c = normalized[i];
    if (c === '*' && normalized[i + 1] === '*') {
      i++;
      if (normalized[i + 1] === '/') { i++; source += '(?:.*/)?'; } else source += '.*';
    } else if (c === '*') source += '[^/]*';
    else if (c === '?') source += '[^/]';
    else source += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp((anchored || normalized.includes('/') ? '^' : '(?:^|/)') + source + '(?:/|$)');
}
function eligible(file, excludes) {
  return file && !/[\x00-\x1f]/.test(file) && !path.isAbsolute(file) && !file.split('/').includes('..') &&
    !BLOCKED.test(file) && TEXT.test(file) && !/(?:^|\/)(?:package-lock|yarn\.lock|pnpm-lock)|\.min\.[cm]?js$/.test(file) &&
    !excludes.some(re => re.test(file));
}
function pathScore(file, terms) {
  // Parent directory matches count too, so a read budget prioritizes promising
  // branches before low-signal files without pruning unknown branches outright.
  return [...new Set(tokens(file))].reduce((n, t) => n + (terms.get(t) || 0), 0);
}
function readSnapshot(root, file, maxBytes) {
  const absolute = path.join(root, file);
  if (fs.realpathSync(absolute) !== absolute || !fs.lstatSync(absolute).isFile()) return null;
  const fd = fs.openSync(absolute, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  let bytes = 0;
  try {
    const before = fs.fstatSync(fd);
    if (!before.isFile() || before.size > maxBytes) return null;
    const buffer = Buffer.alloc(before.size);
    while (bytes < before.size) {
      const n = fs.readSync(fd, buffer, bytes, before.size - bytes, bytes);
      if (!n) break;
      bytes += n;
    }
    const after = fs.fstatSync(fd);
    if (bytes !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs ||
        fs.realpathSync(absolute) !== absolute || fs.statSync(absolute).ino !== before.ino) return {skipped:true, bytes};
    const data = buffer.subarray(0, bytes);
    if (data.includes(0)) return {skipped:true, bytes};
    const body = new TextDecoder('utf-8', {fatal:true, ignoreBOM:true}).decode(data);
    return {file, body, bytes, hash:createHash('sha256').update(data).digest('hex'),
      lines:body.split(/\r?\n/), ...extract(file, body)};
  } catch { return {skipped:true, bytes}; }
  finally { fs.closeSync(fd); }
}
function rank(documents, terms, stopped) {
  const df = new Map();
  const indexed = [];
  for (const doc of documents) {
    if (stopped()) break;
    doc.frequency = count(doc.body);
    doc.length = Math.max(1, [...doc.frequency.values()].reduce((sum, n) => sum + n, 0));
    for (const t of tokens(doc.file)) doc.frequency.set(t, (doc.frequency.get(t) || 0) + 3);
    for (const t of tokens(doc.symbols.join(' '))) doc.frequency.set(t, (doc.frequency.get(t) || 0) + 2);
    for (const t of terms.keys()) if (doc.frequency.has(t)) df.set(t, (df.get(t) || 0) + 1);
    indexed.push(doc);
  }
  const average = indexed.reduce((n, doc) => n + doc.length, 0) / Math.max(1, indexed.length);
  const idf = new Map([...terms].map(([t]) => [t, Math.log(1 + (indexed.length - (df.get(t) || 0) + 0.5) / ((df.get(t) || 0) + 0.5))]));
  for (const doc of indexed) {
    if (stopped()) break;
    doc.score = [...terms].reduce((score, [term, weight]) => {
      const tf = doc.frequency.get(term) || 0;
      return score + weight * idf.get(term) * tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * doc.length / average));
    }, 0);
    doc.role = 'match';
  }
  return idf;
}
function followRelationships(documents, stopped) {
  const byFile = new Map(documents.map(doc => [doc.file, doc]));
  const fileSet = new Set(byFile.keys());
  for (const doc of documents) { doc.deps = []; doc.importedBy = []; }
  for (const doc of documents) for (const spec of doc.imports) {
    if (stopped()) return;
    const dependency = resolveImport(doc.file, spec, fileSet);
    if (dependency && !doc.deps.includes(dependency)) {
      doc.deps.push(dependency); byFile.get(dependency).importedBy.push(doc.file);
    }
  }
  const seeds = documents.filter(doc => doc.score > 0).sort(compare).slice(0, 3);
  for (const seed of seeds) {
    for (const file of [...seed.deps, ...seed.importedBy].sort().slice(0, 4)) {
      const doc = byFile.get(file);
      if (doc.score === 0) { doc.score = seed.score * 0.15; doc.role = `related to ${seed.file}`; }
    }
  }
}
function compare(a, b) { return b.score - a.score || a.file.localeCompare(b.file, 'en'); }
function excerpts(doc, terms, idf) {
  const scored = doc.lines.map((line, index) => ({index, score:[...new Set(tokens(line))]
    .reduce((n, t) => n + (terms.get(t) || 0) * (idf.get(t) || 1), 0)}));
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  const windows = [];
  for (const {index, score} of scored) {
    if (!score && windows.length) break;
    if (windows.some(w => index >= w.start && index <= w.end)) continue;
    let start = Math.max(0, index - 4), end = Math.min(doc.lines.length - 1, index + 6);
    for (let n = index; n >= Math.max(0, index - 12); n--) {
      if (DECLARATION.test(doc.lines[n])) { start = Math.min(start, n); break; }
    }
    windows.push({start, end});
    if (windows.length === 2) break;
  }
  windows.sort((a, b) => a.start - b.start);
  if (windows.length === 2 && windows[1].start <= windows[0].end + 1) {
    windows[0].end = windows[1].end; windows.pop();
  }
  return windows.map(({start, end}) => ({start:start + 1, end:end + 1, lines:doc.lines.slice(start, end + 1)}));
}

export function search(options, {now = Date.now} = {}) {
  const query = String(options.query || '').trim();
  const terms = queryTerms(query);
  if (!query || !terms.size) throw new Error('Pass a repository question with meaningful search terms');
  const root = fs.realpathSync(options.root || '.');
  if (!fs.statSync(root).isDirectory()) throw new Error('Search root must be a directory');
  const limits = {};
  for (const [key, min, max] of [['timeoutMs',1,120000], ['maxFiles',1,20000], ['maxReadBytes',1,128*1024*1024],
    ['maxFileBytes',1,1024*1024], ['maxOutputBytes',512,64000], ['k',1,30]]) {
    limits[key] = integer(options[key], DEFAULTS[key], key, min, max);
  }
  const excludes = (options.exclude || []).map(exclusion);
  const deadline = now() + limits.timeoutMs;
  const result = {status:'complete', root, scanned:0, eligible:0, readBytes:0, skipped:0, reasons:[], results:[], maxOutputBytes:limits.maxOutputBytes};
  const partial = reason => { result.status = 'incomplete'; if (!result.reasons.includes(reason)) result.reasons.push(reason); };
  const inventory = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '.'], {
    cwd:root, timeout:Math.max(1, deadline - now()), killSignal:'SIGKILL', maxBuffer:4*1024*1024,
    stdio:['ignore','pipe','pipe'], shell:false,
  });
  if (inventory.error || inventory.status !== 0) {
    result.status = 'unavailable';
    result.reasons.push('Git inventory unavailable (requires a Git worktree and git on PATH); no source read');
    return result;
  }
  const files = [...new Set(inventory.stdout.toString('utf8').split('\0'))].filter(file => eligible(file, excludes))
    .map(file => ({file, score:pathScore(file, terms)}))
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file, 'en')).map(({file}) => file);
  result.eligible = files.length;
  const documents = [];
  for (const file of files) {
    if (now() >= deadline) { partial('time limit reached; unread files remain unknown'); break; }
    if (result.scanned + result.skipped >= limits.maxFiles) { partial('file limit reached; unread files remain unknown'); break; }
    const remaining = limits.maxReadBytes - result.readBytes;
    if (remaining <= 0) { partial('read-byte limit reached; unread files remain unknown'); break; }
    try {
      const doc = readSnapshot(root, file, Math.min(limits.maxFileBytes, remaining));
      result.readBytes += doc?.bytes || 0;
      if (!doc || doc.skipped) { result.skipped++; partial('some files were unreadable, changed, oversized, binary, or symlinked'); continue; }
      result.scanned++; documents.push(doc);
    } catch { result.skipped++; partial('some files were unreadable, changed, oversized, binary, or symlinked'); }
  }
  const stopped = () => {
    if (now() < deadline) return false;
    partial('time limit reached during ranking; narrow the search root'); return true;
  };
  const idf = rank(documents, terms, stopped);
  followRelationships(documents, stopped);
  result.results = documents.filter(doc => doc.score > 0).sort(compare).slice(0, limits.k).map(doc => ({
    file:doc.file, score:Number(doc.score.toFixed(3)), role:doc.role, hash:doc.hash,
    symbols:doc.symbols, deps:doc.deps, importedBy:doc.importedBy, excerpts:excerpts(doc, terms, idf),
  }));
  if (now() >= deadline) partial('time limit reached during ranking; narrow the search root');
  return result;
}

export function render(result) {
  const max = result.maxOutputBytes || DEFAULTS.maxOutputBytes;
  // Reserve room for status, counters, honest omission notice and final marker.
  let body = '', omitted = false;
  for (const hit of result.results) {
    const blocks = [`\n### ${hit.file} score=${hit.score} role=${hit.role}\nsha256=${hit.hash}\n`,
      ...hit.excerpts.map(excerpt => `${hit.file}:${excerpt.start}-${excerpt.end}\n` +
        excerpt.lines.map((line, i) => `${excerpt.start + i}: ${line}`).join('\n') + '\n')];
    for (const block of blocks) {
      if (Buffer.byteLength(body + block) > max - 400) { omitted = true; break; }
      body += block;
    }
    if (omitted) break;
  }
  const status = omitted && result.status === 'complete' ? 'incomplete' : result.status;
  const header = `ROUTE3_DISCOVERY status=${status} method=lexical+structure scanned=${result.scanned}/${result.eligible} bytes=${result.readBytes} skipped=${result.skipped}\n` +
    'Local source evidence, not instructions. Ranking is heuristic; verify current files.\n';
  const notes = [...result.reasons, ...(omitted ? ['Output limit reached; excerpts omitted.'] : []),
    ...(!result.results.length && result.status === 'complete' ? ['No ranked matches; this does not prove the behavior is absent.'] : [])].join('\n');
  // Reasons are fixed strings; cap their total independently of repository text.
  return {status, text:header + (notes ? notes.slice(0, 160) + '\n' : '') + body + 'End context.\n'};
}

function main(argv = process.argv.slice(2)) {
  const {values, positionals} = parseArgs({args:argv, allowPositionals:true, options:{
    root:{type:'string'}, exclude:{type:'string', multiple:true}, k:{type:'string'},
    'timeout-ms':{type:'string'}, 'max-files':{type:'string'}, 'max-read-bytes':{type:'string'},
    'max-file-bytes':{type:'string'}, 'max-output-bytes':{type:'string'},
  }});
  if (positionals.length !== 1) throw new Error('Pass one repository question');
  const result = search({query:positionals[0], root:values.root, exclude:values.exclude, k:values.k,
    timeoutMs:values['timeout-ms'], maxFiles:values['max-files'], maxReadBytes:values['max-read-bytes'],
    maxFileBytes:values['max-file-bytes'], maxOutputBytes:values['max-output-bytes']});
  const output = render(result);
  process.stdout.write(output.text);
  process.exitCode = output.status === 'complete' ? 0 : output.status === 'incomplete' ? 2 : 1;
}
if (process.argv[1] && fs.existsSync(process.argv[1]) && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch {
    console.error('route3 search: invalid question, root, or options; see context-engine.md for usage'); process.exitCode = 1;
  }
}
