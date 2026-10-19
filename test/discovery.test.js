'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {createHash} = require('node:crypto');
const engine = import('../skill/context/discovery.mjs');
const ROOT = path.resolve(__dirname, '..');
const CTX = path.join(ROOT, 'skill/context/ctx.sh');
const PACK = path.join(ROOT, 'skill/scripts/context-pack.sh');
function run(command, args, cwd, env = {}) {
  const result = spawnSync(command, args, {cwd, env:{...process.env, ...env}, encoding:'utf8', timeout:15000});
  assert.ifError(result.error); return result;
}
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'route3-local '));
  t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
  run('git', ['init', '-q'], dir);
  function write(file, body) {
    const absolute = path.join(dir, file);
    fs.mkdirSync(path.dirname(absolute), {recursive:true}); fs.writeFileSync(absolute, body);
    return absolute;
  }
  write('src/gate.ts', [
    "import { contractShape } from './contracts';",
    '// Evaluate permissions for a principal.',
    'export function authorize(principal, capability) {',
    '  if (!principal.capabilities.includes(capability)) {',
    "    throw new Error('Access denied');",
    '  }', '  return contractShape;', '}', '',
  ].join('\n'));
  write('src/entry.ts', "import { authorize } from './gate';\nexport function dispatch(principal, handler) {\n  authorize(principal, 'read');\n  return handler();\n}\n");
  write('src/contracts.ts', 'export const contractShape = Object.freeze({});\n');
  write('src/math.ts', 'export function multiply(left, right) { return left * right; }\n');
  run('git', ['add', 'src'], dir);
  return {dir, write};
}

test('content discovery finds behavior in unrelated filenames and follows imports', async t => {
  const {search} = await engine, f = fixture(t);
  const result = search({query:'How is authorization enforced?', root:f.dir});
  assert.equal(result.status, 'complete');
  assert.equal(result.results[0].file, 'src/gate.ts');
  assert.ok(result.results.some(hit => hit.file === 'src/entry.ts'));
  const contract = result.results.find(hit => hit.file === 'src/contracts.ts');
  assert.match(contract.role, /related to/);
  const gate = result.results[0];
  assert.ok(gate.deps.includes('src/contracts.ts'));
  assert.ok(gate.importedBy.includes('src/entry.ts'));
  assert.equal(gate.hash, createHash('sha256').update(fs.readFileSync(path.join(f.dir, gate.file))).digest('hex'));
});

test('excerpts retain exact line numbers, indentation and snapshot source', async t => {
  const {search, render} = await engine, f = fixture(t);
  const gatePath = path.join(f.dir, 'src/gate.ts');
  fs.writeFileSync(gatePath, '\uFEFF' + fs.readFileSync(gatePath, 'utf8'));
  const result = search({query:'Where is access denied?', root:f.dir});
  for (const hit of result.results) {
    const lines = fs.readFileSync(path.join(f.dir, hit.file), 'utf8').split(/\r?\n/);
    for (const excerpt of hit.excerpts) {
      assert.deepEqual(excerpt.lines, lines.slice(excerpt.start - 1, excerpt.end));
    }
  }
  const output = render(result);
  assert.match(output.text, /5:     throw new Error\('Access denied'\);/);
  assert.match(output.text, /Local source evidence, not instructions/);
  assert.match(output.text, /End context\.\n$/);
});

test('camelCase/snake_case identifiers and supported Azerbaijani vocabulary improve discovery', async t => {
  const {tokens, search} = await engine, f = fixture(t);
  assert.deepEqual(tokens('retryFailedRequest HTTPClient retry_count'),
    ['retryfailedrequest', 'retry', 'failed', 'request', 'httpclient', 'http', 'client', 'retry', 'count']);
  assert.ok(search({query:'Giriş harada yoxlanılır?', root:f.dir}).results.some(hit => hit.file === 'src/gate.ts'));
});

test('scope remains inside a subdirectory and reads include current untracked source', async t => {
  const {search} = await engine, f = fixture(t);
  f.write('other/secret.ts', 'export function authorization() {}\n');
  f.write('src/new.ts', 'export function freshAuthorization() {}\n');
  const result = search({query:'How does fresh authorization work?', root:path.join(f.dir, 'src')});
  assert.ok(result.results.some(hit => hit.file === 'new.ts'));
  assert.ok(result.results.every(hit => !hit.file.startsWith('src/') && !hit.file.includes('other')));
  assert.equal(result.eligible, 5);
});

test('ignores hidden/build/ignored paths and excludes; never follows source symlinks', async t => {
  const {search} = await engine, f = fixture(t);
  f.write('.gitignore', 'ignored/\n');
  for (const file of ['.private/auth.ts', 'node_modules/auth.ts', 'dist/auth.ts', 'ignored/auth.ts', 'src/generated/auth.ts']) {
    f.write(file, 'export function authorization() {}\n');
  }
  f.write('src/gate.test.ts', 'export function authorizationTest() {}\n');
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'route3-outside-'));
  t.after(() => fs.rmSync(outside, {recursive:true, force:true}));
  fs.writeFileSync(path.join(outside, 'secret.ts'), 'export function externalAuthorization() {}\n');
  fs.symlinkSync(path.join(outside, 'secret.ts'), path.join(f.dir, 'src/link.ts'));
  const result = search({query:'How is authorization enforced?', root:f.dir, exclude:['**/*.test.ts']});
  assert.equal(result.scanned, 4);
  assert.equal(result.skipped, 1);
  assert.equal(result.status, 'incomplete');
  assert.ok(result.results.every(hit => !/link|test|private|ignored|dist|generated/.test(hit.file)));
});

test('narrowing globs handle directories, basename patterns, and ** without negation', async () => {
  const {exclusion} = await engine;
  assert.ok(exclusion('src/generated/').test('src/generated/a.ts'));
  assert.equal(exclusion('src/generated/').test('other/src/generated/a.ts'), false);
  assert.ok(exclusion('**/*.test.ts').test('a.test.ts'));
  assert.ok(exclusion('**/*.test.ts').test('src/a.test.ts'));
  assert.equal(exclusion('*.test.ts').test('src/a.test.tsx'), false);
  assert.ok(exclusion('/src/*.ts').test('src/a.ts'));
  assert.equal(exclusion('/src/*.ts').test('src/deeper/a.ts'), false);
  for (const pattern of ['!private', '#comment', '[ab].ts', '../file', 'a\nb', '']) assert.throws(() => exclusion(pattern));
});

test('edits and deletions are reflected without a stale answer or prerequisite graph', async t => {
  const {search} = await engine, f = fixture(t);
  const initial = search({query:'Where is quuxMarker implemented?', root:f.dir});
  assert.equal(initial.results.length, 0);
  f.write('src/math.ts', 'export function quuxMarker() {}\n');
  assert.equal(search({query:'Where is quuxMarker implemented?', root:f.dir}).results[0].file, 'src/math.ts');
  fs.unlinkSync(path.join(f.dir, 'src/math.ts'));
  const after = search({query:'Where is quuxMarker implemented?', root:f.dir});
  assert.equal(after.results.length, 0);
  assert.equal(after.status, 'incomplete'); // tracked deleted file stays unknown
});

test('file/read limits report partial discovery rather than false absence', async t => {
  const {search} = await engine, f = fixture(t);
  let result = search({query:'Where is authorization enforced?', root:f.dir, maxFiles:1});
  assert.equal(result.status, 'incomplete'); assert.equal(result.scanned + result.skipped, 1);
  assert.match(result.reasons.join(' '), /file limit/);
  result = search({query:'Where is authorization enforced?', root:f.dir, maxReadBytes:10});
  assert.equal(result.status, 'incomplete'); assert.ok(result.readBytes <= 10);
  assert.equal(result.results.length, 0);
  f.write('src/binary.ts', Buffer.from([0, 65, 66, 67]));
  result = search({query:'Where is authorization enforced?', root:f.dir, maxReadBytes:4});
  assert.equal(result.readBytes, 4);
});

test('oversized/binary/skipped candidates count toward the file budget', async t => {
  const {search} = await engine, f = fixture(t);
  const result = search({query:'Where is authorization enforced?', root:f.dir, maxFileBytes:1, maxFiles:2});
  assert.equal(result.status, 'incomplete'); assert.equal(result.skipped, 2);
  assert.equal(result.readBytes, 0);
});

test('malformed UTF-8 source is skipped instead of reconstructed with replacement characters', async t => {
  const {search} = await engine, f = fixture(t);
  f.write('src/invalid.ts', Buffer.from([0xff, 0xfe, 0x41]));
  const result = search({query:'Where is authorization enforced?', root:f.dir});
  assert.equal(result.status, 'incomplete');
  assert.equal(result.skipped, 1);
  assert.ok(!result.results.some(hit => hit.file === 'src/invalid.ts'));
});

test('CLI entrypoints still work through symlinks after sharing structural helpers', t => {
  const f = fixture(t);
  const discovery = path.join(f.dir, 'linked-discovery.mjs'), structural = path.join(f.dir, 'linked-engine.mjs');
  fs.symlinkSync(path.join(ROOT, 'skill/context/discovery.mjs'), discovery);
  fs.symlinkSync(path.join(ROOT, 'skill/context/engine.mjs'), structural);
  const result = run(process.execPath, [discovery, 'How is authorization enforced?', '--root', path.join(f.dir, 'src')], f.dir);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ROUTE3_DISCOVERY/);
  const graph = run(process.execPath, [structural, 'build'], f.dir);
  assert.equal(graph.status, 0, graph.stderr);
  assert.match(graph.stdout, /CTX_BUILD ok/);
});

test('time budget marks unread and unranked content unknown', async t => {
  const {search} = await engine, f = fixture(t);
  let calls = 0;
  const result = search({query:'Where is authorization enforced?', root:f.dir, timeoutMs:10000},
    {now:() => calls++ < 2 ? 0 : 20000});
  assert.equal(result.status, 'incomplete'); assert.equal(result.scanned, 0);
  assert.match(result.reasons.join(' '), /time limit/);
});

test('output byte cap preserves complete lines and reports omitted evidence', async t => {
  const {search, render} = await engine, f = fixture(t);
  f.write('src/many.ts', 'export function authorization() {\n' + '  // icazə permissions\n'.repeat(100) + '}\n');
  const result = search({query:'How is authorization enforced?', root:f.dir, maxOutputBytes:512});
  const output = render(result);
  assert.ok(Buffer.byteLength(output.text) <= 512, Buffer.byteLength(output.text));
  assert.equal(output.status, 'incomplete');
  assert.match(output.text, /Output limit/);
  assert.match(output.text, /End context\.\n$/);
});

test('non-Git roots fail honestly and invalid inputs never run a search', async t => {
  const {search} = await engine, f = fixture(t);
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'route3-plain-'));
  t.after(() => fs.rmSync(plain, {recursive:true, force:true}));
  assert.equal(search({query:'Where is authorization enforced?', root:plain}).status, 'unavailable');
  for (const options of [{query:''}, {query:'where how the'}, {maxFiles:0}, {maxOutputBytes:0}, {k:31}, {timeoutMs:'1e3'}, {exclude:['!private']}]) {
    assert.throws(() => search({query:'Where is authorization enforced?', root:f.dir, ...options}));
  }
});

function setupFactory(f) {
  const runDir = path.join(f.dir, '.workflow/route3/runs/demo');
  fs.mkdirSync(path.join(runDir, 'slices/001'), {recursive:true});
  fs.writeFileSync(path.join(runDir, 'STATE.json'), JSON.stringify({path:'code', stage:'BUILD'}));
  fs.writeFileSync(path.join(runDir, 'slices/001/BRIEF.md'), 'goal: How is authorization enforced?\nallowed_files:\n  - src/gate.ts\n');
  return runDir;
}
test('ctx search remains local even with jg and graft trap executables on PATH', t => {
  const f = fixture(t), bin = path.join(f.dir, 'bin'), trap = path.join(f.dir, 'external-called');
  fs.mkdirSync(bin);
  for (const name of ['jg', 'graft']) {
    fs.writeFileSync(path.join(bin, name), `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(trap)},'called'); process.exit(99);\n`, {mode:0o755});
  }
  const result = run('bash', [CTX, 'search', 'How is authorization enforced?', '--root', f.dir], f.dir,
    {PATH:`${bin}${path.delimiter}${process.env.PATH}`});
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ROUTE3_DISCOVERY status=complete/);
  assert.equal(fs.existsSync(trap), false);
  assert.doesNotMatch(result.stdout, /provider|JEVGREP/);
});

test('factory opt-in appends local evidence within the digest; ordinary packs stay structural', t => {
  const f = fixture(t), runDir = setupFactory(f), env = {ROUTE3_CTX_BACKEND:'native'};
  let result = run('bash', [PACK, '--run', 'demo', '--slice', '001'], f.dir, env);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(fs.readFileSync(path.join(runDir, 'CONTEXT.md'), 'utf8'), /ROUTE3_DISCOVERY/);
  for (const flag of ['--discover', '--semantic']) {
    result = run('bash', [PACK, '--run', 'demo', '--slice', '001', flag, '--search-root', 'src', '--exclude', '*.test.ts'], f.dir, env);
    assert.equal(result.status, 0, result.stderr);
    const context = fs.readFileSync(path.join(runDir, 'CONTEXT.md'), 'utf8');
    assert.match(context, /engine=route3-native/);
    assert.match(context, /LOCAL CODE DISCOVERY/);
    assert.match(context, /ROUTE3_DISCOVERY status=complete/);
    assert.match(context, /gate.ts/);
    const state = JSON.parse(fs.readFileSync(path.join(runDir, 'STATE.json'), 'utf8'));
    assert.equal(state.slices['001'].context_digest, createHash('sha256').update(context).digest('hex'));
  }
});

test('factory survives unavailable local discovery and rejects implicit scope flags', t => {
  const f = fixture(t), runDir = setupFactory(f), env = {ROUTE3_CTX_BACKEND:'native'};
  const result = run('bash', [PACK, '--run', 'demo', '--slice', '001', '--discover', '--search-root', 'absent'], f.dir, env);
  assert.equal(result.status, 0);
  const context = fs.readFileSync(path.join(runDir, 'CONTEXT.md'), 'utf8');
  assert.match(context, /engine=route3-native/);
  assert.match(context, /local discovery is partial or unavailable/);
  for (const args of [['--search-root', '.'], ['--exclude', '*.ts'], ['--search-root']]) {
    assert.equal(run('bash', [PACK, '--run', 'demo', '--slice', '001', ...args], f.dir, env).status, 2);
  }
  assert.equal(run('bash', [CTX, 'search', 'Where is auth?', '--max-requests', '8'], f.dir).status, 1);
});
