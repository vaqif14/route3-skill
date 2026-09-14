'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { ExpertRegistry, BUILTIN } = require('../experts');
const { JobManager } = require('../process-manager');
const { createServer } = require('../server');

function temporaryHome(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'route3-experts-test-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return home;
}

function fixtureCommand(directory) {
  const command = path.join(directory, 'fake-agent');
  fs.writeFileSync(command, `#!${process.execPath}\nlet input='';process.stdin.on('data',d=>input+=d);process.stdin.on('end',()=>{console.log(JSON.stringify({input}));});`, { mode: 0o700 });
  return command;
}

async function eventually(fn) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    let value;
    try { value = fn(); } catch { value = null; }
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.fail('Timed out waiting for the expected state.');
}

test('registry curates built-in experts and persists custom ones privately', t => {
  const home = temporaryHome(t);
  const registry = new ExpertRegistry({ home });
  assert.deepEqual(registry.list().map(expert => expert.id), BUILTIN.map(expert => expert.id));
  assert.equal(registry.list().every(expert => !('brief' in expert)), true);
  const frontend = registry.find('frontend');
  assert.equal(frontend.custom, false);
  assert.ok(frontend.brief.length > 100);
  const created = registry.create({ label: 'Mobil eksperti', focus: 'Flutter interfeys', brief: 'Work only in lib/. Match existing widget patterns. Verify with flutter analyze.' });
  assert.match(created.id, /^x-[0-9a-f]{8}$/);
  assert.equal(registry.find(created.id).label, 'Mobil eksperti');
  assert.equal(registry.list().filter(expert => expert.custom).length, 1);
  // A fresh instance reads the same persisted file.
  assert.equal(new ExpertRegistry({ home }).find(created.id).focus, 'Flutter interfeys');
  const stat = fs.statSync(path.join(home, '.local/share/route3/experts.json'));
  assert.equal(stat.mode & 0o077, 0);
  assert.throws(() => registry.remove('frontend'), /Built-in experts cannot be deleted/);
  assert.equal(registry.remove(created.id), true);
  assert.equal(new ExpertRegistry({ home }).find(created.id), null);
});

test('registry validates custom expert input and enforces the limit', t => {
  const home = temporaryHome(t);
  const registry = new ExpertRegistry({ home });
  assert.throws(() => registry.create({ label: '', brief: 'long enough brief for validation' }), /name must contain/);
  assert.throws(() => registry.create({ label: 'x'.repeat(61), brief: 'long enough brief for validation' }), /name must contain/);
  assert.throws(() => registry.create({ label: 'Valid name', brief: 'short' }), /instructions must contain/);
  assert.throws(() => registry.create({ label: 'Valid name', brief: 'y'.repeat(2001) }), /instructions must contain/);
  assert.throws(() => registry.create({ label: 'Valid name' }), /instructions must contain/);
  const secrets = registry.create({ label: 'Secret keeper', brief: 'Use api_key=super-secret-value while working.' });
  assert.equal(secrets.brief.includes('super-secret-value'), false);
  for (let i = 0; i < 11; i++) registry.create({ label: `Expert ${i}`, brief: 'Do focused work inside the assigned paths and verify the result.' });
  assert.throws(() => registry.create({ label: 'One too many', brief: 'Do focused work inside the assigned paths and verify the result.' }), /limit reached/);
});

test('jobs carry the expert assignment into the actual agent brief', async t => {
  const home = temporaryHome(t);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'route3-expert-job-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const registry = new ExpertRegistry({ home });
  const created = registry.create({ label: 'Mobil eksperti', focus: 'Flutter', brief: 'MATCH THIS EXPERT BRIEF MARKER' });
  const manager = new JobManager({ workspace: directory, experts: registry, commands: { codex: fixtureCommand(directory) } });
  t.after(() => manager.shutdown());
  assert.throws(() => manager.start({ agent: 'codex', prompt: 'test', expert: 'unknown-expert' }), /Unknown expert/);
  const job = manager.start({ agent: 'codex', prompt: 'test', expert: created.id });
  assert.equal(job.expert, created.id);
  assert.equal(job.expertLabel, 'Mobil eksperti');
  assert.match(job.routingReason, /Route3 expert Mobil eksperti/);
  const finished = await eventually(() => manager.list().find(item => item.id === job.id && item.status === 'completed') || null);
  const event = JSON.parse(finished.logTail.split('\n')[0]);
  assert.ok(event.input.includes('MATCH THIS EXPERT BRIEF MARKER'));
  assert.ok(event.input.includes('Route3 expert assignment'));
  assert.ok(event.input.endsWith('test'));
  const plain = manager.start({ agent: 'codex', prompt: 'no expert' });
  assert.equal(plain.expert, null);
  await eventually(() => manager.list().find(item => item.id === plain.id && item.status === 'completed') || null);
});

test('expert endpoints enforce tokens, validation and built-in protection', async t => {
  const home = temporaryHome(t);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'route3-expert-http-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const server = createServer({ workspace: directory, home, publicDir: directory, integrationOptions: { command: null }, collectTelemetry: async () => ({ sessions: [], summary: {}, warnings: [] }) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.route3.shutdown(); server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const port = server.address().port;
  const request = (url, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: url, method, headers }, res => {
      let text = ''; res.on('data', chunk => text += chunk); res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(text) }); } catch { resolve({ status: res.statusCode, body: text }); } });
    });
    req.on('error', reject); req.end(body === undefined ? undefined : JSON.stringify(body));
  });
  const state = await request('/api/state');
  assert.equal(state.body.experts.length, BUILTIN.length);
  const token = (await request('/api/bootstrap')).body.token;
  const headers = { 'Content-Type': 'application/json', 'X-Route3-Token': token };
  assert.equal((await request('/api/experts', { method: 'POST', body: {} })).status, 403);
  assert.equal((await request('/api/experts', { method: 'POST', headers, body: { label: 'X' } })).status, 400);
  const created = await request('/api/experts', { method: 'POST', headers, body: { label: 'DevOps eksperti', focus: 'CI və deploy', brief: 'Work only in .github/ and deploy scripts. Verify pipelines syntax.' } });
  assert.equal(created.status, 200);
  assert.equal((await request('/api/state')).body.experts.length, BUILTIN.length + 1);
  assert.equal((await request(`/api/experts/${created.body.expert.id}`, { method: 'DELETE', headers })).status, 200);
  assert.equal((await request('/api/experts/frontend', { method: 'DELETE', headers })).status, 400);
  assert.equal((await request('/api/experts/x-missing', { method: 'DELETE', headers })).status, 404);
  assert.equal((await request('/api/experts/x-missing', { method: 'DELETE' })).status, 403);
});

test('corrupted expert storage preserves last known entries and refuses overwriting the file', t => {
  const home=temporaryHome(t),registry=new ExpertRegistry({home});
  const created=registry.create({label:'Expert',brief:'Keep the working configuration intact.'});
  const file=registry.file;
  fs.writeFileSync(file,'{"broken":');
  assert.ok(registry.list().some(e=>e.id===created.id));
  assert.equal(registry.warnings().length,1);
  assert.throws(()=>registry.create({label:'Another',brief:'Do not overwrite a corrupt registry.'}),/could not be read/);
  assert.equal(fs.readFileSync(file,'utf8'),'{"broken":');
  assert.equal(fs.existsSync(file+'.lock'),false);
});

test('two registry instances preserve each other’s additions and deletions', t => {
  const home=temporaryHome(t),one=new ExpertRegistry({home}),two=new ExpertRegistry({home});
  const a=one.create({label:'First',brief:'First specialist instructions.'});
  const b=two.create({label:'Second',brief:'Second specialist instructions.'});
  assert.ok(one.find(b.id));assert.ok(two.find(a.id));
  one.remove(a.id);
  two.create({label:'Third',brief:'Third specialist instructions.'});
  assert.equal(new ExpertRegistry({home}).find(a.id),null);
  assert.equal(one.list().filter(e=>e.custom).length,2);
});

test('exclusive expert lock rejects another writer without losing the registry', t => {
  const home=temporaryHome(t),registry=new ExpertRegistry({home});
  registry.create({label:'Existing',brief:'Keep this entry during concurrent writes.'});
  const before=fs.readFileSync(registry.file,'utf8');
  fs.writeFileSync(registry.file+'.lock','other writer');
  assert.throws(()=>registry.create({label:'Blocked',brief:'Do not replace another writer’s lock.'}),/locked by another writer/);
  assert.equal(fs.readFileSync(registry.file,'utf8'),before);
  assert.equal(fs.readFileSync(registry.file+'.lock','utf8'),'other writer');
});
