'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {mergeInstall,parseArgs,pathsFor}=require('../bin/route3-skill');
function temp(t){const p=fs.mkdtempSync(path.join(os.tmpdir(),'route3-install-'));t.after(()=>fs.rmSync(p,{recursive:true,force:true}));return p;}
test('upgrade retains local additions and backs up original files',t=>{
 const p=temp(t),src=path.join(p,'source'),dest=path.join(p,'installed');fs.mkdirSync(src);fs.mkdirSync(dest);
 fs.writeFileSync(path.join(src,'SKILL.md'),'new');fs.writeFileSync(path.join(dest,'SKILL.md'),'old');fs.writeFileSync(path.join(dest,'local.json'),'custom');
 mergeInstall(src,dest,{quiet:true});assert.equal(fs.readFileSync(path.join(dest,'SKILL.md'),'utf8'),'new');assert.equal(fs.readFileSync(path.join(dest,'local.json'),'utf8'),'custom');
 const backup=fs.readdirSync(p).find(f=>f.startsWith('installed.backup-'));assert.equal(fs.readFileSync(path.join(p,backup,'SKILL.md'),'utf8'),'old');
});
test('dry run never creates target or backups',t=>{const p=temp(t),src=path.join(p,'s');fs.mkdirSync(src);mergeInstall(src,path.join(p,'d'),{quiet:true,dryRun:true});assert.deepEqual(fs.readdirSync(p),['s']);});
test('symlink installation preserves target and old symlink in backup',t=>{const p=temp(t),src=path.join(p,'s'),original=path.join(p,'original'),dest=path.join(p,'d');fs.mkdirSync(src);fs.mkdirSync(original);fs.writeFileSync(path.join(src,'SKILL.md'),'new');fs.writeFileSync(path.join(original,'SKILL.md'),'old');fs.symlinkSync(original,dest);mergeInstall(src,dest,{quiet:true});assert.equal(fs.readFileSync(path.join(original,'SKILL.md'),'utf8'),'old');assert.equal(fs.readFileSync(path.join(dest,'SKILL.md'),'utf8'),'new');assert.ok(fs.lstatSync(path.join(p,fs.readdirSync(p).find(f=>f.startsWith('d.backup-')))).isSymbolicLink());});
test('missing source fails without touching installation',t=>{const p=temp(t),dest=path.join(p,'d');fs.mkdirSync(dest);assert.throws(()=>mergeInstall(path.join(p,'missing'),dest,{quiet:true}),/Missing/);assert.ok(fs.existsSync(dest));});
test('target parsing includes Codex and OpenClaw, rejects unknown flags',()=>{assert.deepEqual(parseArgs(['install','--codex']).targets,['codex']);assert.ok(parseArgs(['install','--all']).targets.includes('openclaw'));assert.throws(()=>parseArgs(['install','--bogus']));assert.equal(pathsFor('/tmp/test','codex').skill,'/tmp/test/.codex/skills/route3');});

test('explicit backup root keeps old skill out of discovery',t=>{const p=temp(t),src=path.join(p,'s'),dest=path.join(p,'skills/route3'),backupRoot=path.join(p,'recovery');fs.mkdirSync(src);fs.mkdirSync(dest,{recursive:true});fs.writeFileSync(path.join(src,'SKILL.md'),'new');fs.writeFileSync(path.join(dest,'SKILL.md'),'old');mergeInstall(src,dest,{quiet:true,backupRoot});assert.deepEqual(fs.readdirSync(path.dirname(dest)),['route3']);const backup=fs.readdirSync(backupRoot)[0];assert.equal(fs.readFileSync(path.join(backupRoot,backup,'SKILL.md'),'utf8'),'old');});
