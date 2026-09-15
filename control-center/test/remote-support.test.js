'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {JobManager}=require('../process-manager');
const {BackgroundService,plist,LABEL}=require('../background-service');
const {createServer}=require('../server');
function home(t){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'route3-remote-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));return directory;}
test('job history restores bounded redacted context; interrupted jobs never auto launch',t=>{
 const root=home(t),file=path.join(root,'history.json');const options={workspace:root,commands:{codex:'/fixture/codex'},historyFile:file};
 const manager=new JobManager(options);let brief;manager.launchProcess=(job,def,agent,input)=>{brief=input;};
 const job=manager.start({agent:'codex',prompt:'Original requirements '+ 'ə'.repeat(10000)});
 assert.equal(fs.statSync(file).mode&0o777,0o600);assert.equal(manager.list()[0].prompt,undefined);
 const restored=new JobManager(options);assert.equal(restored.list()[0].status,'interrupted');assert.equal(restored.children.size,0);
 restored.launchProcess=(job,def,agent,input)=>{brief=input;};
 const next=restored.continueJob(job.id,'Finish the pending work');assert.notEqual(next.id,job.id);assert.equal(next.continuationOf,job.id);assert.match(brief,/Original requirements/);assert.match(brief,/Current user instruction:\nFinish/);assert.ok(Buffer.byteLength(brief)<32768);
 assert.throws(()=>restored.continueJob(next.id,'Again'),/previous job to stop/);assert.throws(()=>restored.continueJob('missing','task'),/not found/);
 const outsider=new JobManager({...options,workspace:os.tmpdir()}); // parent is a deliberately different workspace
 assert.equal(outsider.children.size,0);
});
test('history failure prevents launch; continuation rechecks project boundary',t=>{
 const root=home(t);const manager=new JobManager({workspace:root,commands:{codex:'/fixture/codex'},historyFile:path.join(root,'history.json')});let launched=false;manager.launchProcess=()=>{launched=true;};
 fs.mkdirSync(manager.history.file);assert.throws(()=>manager.start({agent:'codex',prompt:'task'}),/No agent was started/);assert.equal(launched,false);assert.equal(manager.list().length,0);
 fs.rmdirSync(manager.history.file);manager.jobs.set('old',{id:'old',agent:'codex',cwd:os.tmpdir(),status:'completed',taskClass:'code',summary:'task'});assert.throws(()=>manager.continueJob('old','continue'),/inside the configured workspace/);
});
test('LaunchAgent escapes paths, targets only owned user service and preserves file on bootstrap failure',async t=>{
 const root=home(t);const server=path.join(root,'server.js');fs.writeFileSync(server,'');const calls=[];let loaded=false,fail=false;
 const exec=(command,args)=>{calls.push({command,args});if(args[0]==='print')return {status:loaded?0:113,stdout:loaded?'state = running\npid = 987':''};if(args[0]==='bootstrap'){if(fail)return {status:5};loaded=true;}if(args[0]==='bootout')loaded=false;return {status:0};};
 const service=new BackgroundService({home:root,platform:'darwin',uid:501,server,exec,checkPort:async()=>{}});
 assert.match(plist({home:root,workspace:'/a&b/<project>',server}),/\/a&amp;b\/&lt;project&gt;/);
 const result=await service.install({workspace:root});assert.equal(result.running,true);assert.equal(result.pid,987);assert.equal(fs.statSync(service.file).mode&0o777,0o600);
 await assert.rejects(service.install({workspace:root}),/already loaded/);service.uninstall();assert.equal(fs.existsSync(service.file),false);assert.ok(calls.some(call=>call.args[0]==='bootout'&&call.args[1]===`gui/501/${LABEL}`));
 fs.mkdirSync(path.dirname(service.file),{recursive:true});const original=plist({home:root,workspace:root,server});fs.writeFileSync(service.file,original);fail=true;await assert.rejects(service.install({workspace:root}),/could not load/);assert.equal(fs.readFileSync(service.file,'utf8'),original);
});
test('Telegram API requires local CSRF and never publishes pairing code in state',async t=>{
 const root=home(t);const calls=[];const remote={configured:true,enabled:false,status:'stopped'};
 const telegram={snapshot:()=>remote,configure:async input=>{calls.push(input);},start:async()=>{remote.enabled=true;},stop:async()=>{remote.enabled=false;},pairing:()=>({code:'local-once',expiresAt:'2099-01-01',url:'https://t.me/example'}),unpair:async()=>{},disconnect:async()=>{},shutdown:async()=>{calls.push('shutdown');}};
 const server=createServer({home:root,workspace:root,telegramBridge:telegram,collectTelemetry:()=>({sessions:[]})});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{await server.route3.shutdown();await new Promise(resolve=>server.close(resolve));});
 const base=`http://127.0.0.1:${server.address().port}`;const bootstrap=await (await fetch(`${base}/api/bootstrap`)).json();
 const mutate=(action,extra={})=>fetch(`${base}/api/telegram/${action}`,{method:'POST',headers:{'content-type':'application/json','x-route3-token':bootstrap.token,...extra},body:JSON.stringify({token:'local-token'})});
 assert.equal((await mutate('configure',{'x-route3-token':'wrong'})).status,403);assert.equal((await mutate('configure',{origin:'https://elsewhere.example'})).status,403);assert.equal(calls.length,0);
 assert.equal((await mutate('configure')).status,200);assert.deepEqual(calls[0],{token:'local-token',enabled:false});assert.equal((await (await mutate('pairing')).json()).pairing.code,'local-once');
 const state=await (await fetch(`${base}/api/state`)).json();assert.equal(JSON.stringify(state).includes('local-once'),false);assert.equal(JSON.stringify(state).includes('local-token'),false);
});
