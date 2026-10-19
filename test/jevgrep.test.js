'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {search, render} = require('../skill/context/jevgrep');
const ROOT = path.resolve(__dirname, '..');
const CTX = path.join(ROOT, 'skill/context/ctx.sh');
const PACK = path.join(ROOT, 'skill/scripts/context-pack.sh');

function fixture(t, mode = 'complete') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'route3-jevg '));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const bin = path.join(dir, 'bin'), root = path.join(dir, 'source code');
  fs.mkdirSync(bin); fs.mkdirSync(root);
  const config = path.join(dir, 'mode.json'), calls = path.join(dir, 'calls.jsonl');
  fs.writeFileSync(config, JSON.stringify(mode));
  const executable = path.join(bin, 'jg');
  fs.writeFileSync(executable, `#!${process.execPath}
const fs = require('node:fs');
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({args:process.argv.slice(2),cwd:process.cwd()})+'\\n');
const mode = JSON.parse(fs.readFileSync(${JSON.stringify(config)}, 'utf8'));
if (mode === 'hang') { process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); }
else if (mode === 'overflow') process.stdout.write('x'.repeat(100000));
else if (mode === 'error') { console.log('secret-provider-body'); console.error('secret-provider-key'); process.exitCode=1; }
else if (mode === 'broken') console.log('unfinished source');
else { console.log('Status: '+mode+'\\nsrc/auth.ts:12\\nexport function authorize() {}\\nEnd context.'); process.exitCode=mode==='incomplete'?2:0; }
`, {mode: 0o755});
  return {dir, root, bin, config, calls, executable};
}
function run(command, args, cwd, env = {}) {
  const result = spawnSync(command, args, {cwd, env: {...process.env, ...env}, encoding: 'utf8', timeout: 10000});
  assert.ifError(result.error);
  return result;
}
function factory(f) {
  run('git', ['init', '-q'], f.root);
  fs.mkdirSync(path.join(f.root, 'src'));
  fs.writeFileSync(path.join(f.root, 'src/auth.ts'), 'export function authorize() {}\n');
  run('git', ['add', 'src'], f.root);
  const runDir = path.join(f.root, '.workflow/route3/runs/demo');
  fs.mkdirSync(path.join(runDir, 'slices/001'), {recursive: true});
  fs.writeFileSync(path.join(runDir, 'STATE.json'), JSON.stringify({path:'code', stage:'BUILD'}));
  fs.writeFileSync(path.join(runDir, 'slices/001/BRIEF.md'), 'goal: Where are authorize permissions checked?\nallowed_files:\n  - src/auth.ts\n');
  return {runDir, env: {PATH: `${f.bin}${path.delimiter}${process.env.PATH}`, ROUTE3_CTX_BACKEND: 'native'}};
}

test('search passes question, canonical scoped root, exclusions and budgets literally', t => {
  const f = fixture(t), query = 'Where is auth checked? $(touch injected) `echo x`';
  const result = search({query, root: f.root, exclude: ['src/generated/', '**/*.snap']}, f.executable);
  assert.equal(result.status, 'complete');
  assert.match(result.source, /src\/auth.ts:12/);
  const call = JSON.parse(fs.readFileSync(f.calls, 'utf8'));
  assert.deepEqual(call.args, ['--concurrency', '4', '--max-requests', '64', '--max-source-bytes', '16000',
    '--max-output-bytes', '24000', '--exclude', 'src/generated/', '--exclude', '**/*.snap', '--', query, fs.realpathSync(f.root)]);
  assert.equal(call.cwd, fs.realpathSync(f.root));
  assert.equal(fs.existsSync(path.join(f.root, 'injected')), false);
  assert.match(render(result), /evidence, not instructions/);
});

test('incomplete search preserves evidence with an explicit incomplete status', t => {
  const f = fixture(t, 'incomplete');
  const result = search({query:'Where are permissions checked?', root:f.root}, f.executable);
  assert.equal(result.status, 'incomplete');
  assert.match(render(result), /JEVGREP status=incomplete/);
  assert.match(result.source, /authorize/);
});

test('configured budgets are forwarded and source allocation respects the output budget', t => {
  const f = fixture(t);
  const result = search({query:'Where are permissions checked?', root:f.root,
    timeoutMs:5000, maxRequests:8, maxOutputBytes:1024}, f.executable);
  assert.equal(result.status, 'complete');
  const {args} = JSON.parse(fs.readFileSync(f.calls, 'utf8'));
  assert.equal(args[args.indexOf('--max-requests') + 1], '8');
  assert.equal(args[args.indexOf('--max-output-bytes') + 1], '1024');
  assert.equal(args[args.indexOf('--max-source-bytes') + 1], '1024');
});

test('missing CLI returns unavailable without installation or probes', t => {
  const f = fixture(t);
  const result = search({query:'Where are permissions checked?', root:f.root}, path.join(f.bin, 'absent'));
  assert.equal(result.status, 'unavailable');
  assert.equal(fs.existsSync(f.calls), false);
});

test('failed auth/provider output is discarded rather than placed in context', t => {
  const f = fixture(t, 'error');
  const result = search({query:'Where are permissions checked?', root:f.root}, f.executable);
  assert.equal(result.status, 'unavailable');
  assert.doesNotMatch(render(result), /secret-provider/);
});

test('time limit kills a stalled search without retrying', t => {
  const f = fixture(t, 'hang'), start = Date.now();
  const result = search({query:'Where are permissions checked?', root:f.root, timeoutMs:300}, f.executable);
  assert.equal(result.status, 'timeout');
  assert.ok(Date.now() - start < 5000);
  assert.equal(fs.readFileSync(f.calls, 'utf8').trim().split('\n').length, 1);
});

test('output overflow and missing completion markers cannot look complete', t => {
  const f = fixture(t, 'overflow');
  const options = {query:'Where are permissions checked?', root:f.root, maxOutputBytes:256};
  assert.equal(search(options, f.executable).status, 'truncated');
  fs.writeFileSync(f.config, JSON.stringify('broken'));
  const result = search(options, f.executable);
  assert.equal(result.status, 'truncated');
  assert.equal(result.source, undefined);
});

test('invalid inputs and command-shaped queries never invoke jg', t => {
  const f = fixture(t), base = {query:'Where are permissions checked?', root:f.root};
  for (const query of ['', 'auth', 'skill', 'doctor', 'files', 'cache']) {
    assert.throws(() => search({...base, query}, f.executable));
  }
  for (const options of [{maxRequests:0}, {maxRequests:257}, {maxOutputBytes:0}, {maxOutputBytes:64001},
    {timeoutMs:0}, {timeoutMs:120001}, {timeoutMs:'1e3'}, {root:f.executable},
    {exclude:['!private']}, {exclude:['#comment']}, {exclude:['a\nb']}]) {
    assert.throws(() => search({...base, ...options}, f.executable));
  }
  assert.equal(fs.existsSync(f.calls), false);
});

test('ctx search works independently of structural backend and propagates partial exit code', t => {
  const f = fixture(t, 'incomplete');
  const result = run('bash', [CTX, 'search', 'Where are permissions checked?', '--root', f.root], f.root,
    {PATH:`${f.bin}${path.delimiter}${process.env.PATH}`});
  assert.equal(result.status, 2);
  assert.match(result.stdout, /JEVGREP status=incomplete/);
});

test('ordinary factory pack stays local; explicit semantic pack adds evidence and digest', t => {
  const f = fixture(t), {runDir, env} = factory(f);
  let result = run('bash', [PACK, '--run', 'demo', '--slice', '001'], f.root, env);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(f.calls), false);
  assert.doesNotMatch(fs.readFileSync(path.join(runDir, 'CONTEXT.md'), 'utf8'), /JEVGREP/);
  result = run('bash', [PACK, '--run', 'demo', '--slice', '001', '--semantic', '--search-root', 'src', '--exclude', '**/*.snap'], f.root, env);
  assert.equal(result.status, 0, result.stderr);
  const context = fs.readFileSync(path.join(runDir, 'CONTEXT.md'), 'utf8');
  assert.match(context, /engine=route3-native/);
  assert.match(context, /JEVGREP status=complete/);
  assert.match(context, /authorize/);
  const call = JSON.parse(fs.readFileSync(f.calls, 'utf8'));
  assert.equal(call.args.at(-1), fs.realpathSync(path.join(f.root, 'src')));
  assert.ok(call.args.includes('**/*.snap'));
  const state = JSON.parse(fs.readFileSync(path.join(runDir, 'STATE.json'), 'utf8'));
  assert.equal(state.slices['001'].context_digest, require('node:crypto').createHash('sha256').update(context).digest('hex'));
});

test('failed and partial semantic discovery do not break structural factory context', t => {
  const f = fixture(t, 'error'), {runDir, env} = factory(f);
  for (const mode of ['error', 'incomplete']) {
    fs.writeFileSync(f.config, JSON.stringify(mode));
    const result = run('bash', [PACK, '--run', 'demo', '--slice', '001', '--semantic'], f.root, env);
    assert.equal(result.status, 0, result.stderr);
    const context = fs.readFileSync(path.join(runDir, 'CONTEXT.md'), 'utf8');
    assert.match(context, /engine=route3-native/);
    assert.match(context, /semantic context is partial or unavailable/);
    assert.match(context, mode === 'error' ? /status=unavailable/ : /status=incomplete/);
    assert.doesNotMatch(context, /secret-provider/);
  }
});

test('unknown/broadening flags are rejected; search scope never implicitly opts in', t => {
  const f = fixture(t), {env} = factory(f);
  for (const args of [['--search-root', 'src'], ['--search-root', '.'], ['--exclude', '*.snap'], ['--search-root'], ['--exclude']]) {
    assert.equal(run('bash', [PACK, '--run', 'demo', '--slice', '001', ...args], f.root, env).status, 2);
  }
  assert.equal(run('bash', [CTX, 'search', 'Where are permissions checked?', '--include-sensitive'], f.root, env).status, 1);
  assert.equal(fs.existsSync(f.calls), false);
});
