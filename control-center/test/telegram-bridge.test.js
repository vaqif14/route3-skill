'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {TelegramBridge} = require('../telegram-bridge');
const TOKEN = '123456789:abcdefghijklmnopqrstuvwx';
function fixture(t, overrides={}) {
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'route3-telegram-'));
  const calls=[], started=[], permissions=[], jobs=[];
  const manager={workspace:home,list:()=>jobs,agents:()=>[{label:'Fixture',status:'available'}],start:input=>{started.push(input);const job={id:`job-${started.length}`,agent:'codex',status:'running',summary:input.prompt,permissions:[]};jobs.push(job);return job;},continueJob:(id,prompt)=>manager.start({prompt}),cancel:id=>{const job=jobs.find(job=>job.id===id);job.status='cancelled';return job;},respondPermission:(id,input)=>{permissions.push({id,...input});jobs.find(job=>job.id===id).permissions=[];}};
  const fetchImpl=async(url,options)=>{const method=url.split('/').pop();const body=JSON.parse(options.body);calls.push({method,body});
    if(overrides.api){const value=await overrides.api(method,body,options);if(value)return value;}
    if(method==='getUpdates')return new Promise((resolve,reject)=>{if(options.signal.aborted)return reject(new Error('aborted'));options.signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});});
    return {ok:true,json:async()=>({ok:true,result:method==='getMe'?{id:123456789,is_bot:true,username:'route3_fixture_bot'}:method==='getWebhookInfo'?{url:''}:{message_id:1}})};
  };
  const bridge=new TelegramBridge({jobs:manager,home,workspace:home,fetchImpl,monitorMs:100000,...overrides.options});
  t.after(async()=>{await bridge.shutdown();fs.rmSync(home,{recursive:true,force:true});});
  const message=(text,user=42,chat=42,type='private')=>({message:{text,date:Math.floor(Date.now()/1000),from:{id:user,is_bot:false},chat:{id:chat,type}}});
  const pair=async()=>{await bridge.configure({token:TOKEN});const {code}=bridge.pairing();await bridge.dispatch(message(`/pair ${code}`));};
  return {bridge,home,calls,jobs,started,permissions,message,pair,manager};
}
test('token remains private; pairing expires, is single-use and binds exact private identity',async t=>{
  const f=fixture(t);await f.bridge.configure({token:TOKEN});
  assert.equal(fs.statSync(f.bridge.file).mode&0o777,0o600);
  assert.equal(JSON.stringify(f.bridge.snapshot()).includes(TOKEN),false);
  const p=f.bridge.pairing();assert.ok(p.code.length>=32);assert.equal(JSON.stringify(f.bridge.snapshot()).includes(p.code),false);
  await f.bridge.dispatch(f.message(`/pair ${p.code}`,42,42,'group'));assert.equal(f.bridge.snapshot().paired,null);
  f.bridge.pairCode.expiresAt=0;await f.bridge.dispatch(f.message(`/pair ${p.code}`));assert.equal(f.bridge.snapshot().paired,null);
  const q=f.bridge.pairing();await f.bridge.dispatch(f.message(`/pair ${q.code}`));assert.equal(f.bridge.snapshot().paired.userId,42);
  await f.bridge.dispatch(f.message(`/pair ${q.code}`,77,77));assert.equal(f.bridge.snapshot().paired.userId,42);
  for(const message of [f.message('/run bad',77,77),f.message('/run bad',42,77),f.message('/run bad',42,42,'supergroup')])await f.bridge.dispatch(message);
  assert.equal(f.started.length,0);await f.bridge.dispatch(f.message('/run build tests'));assert.equal(f.started.length,1);assert.equal(f.started[0].cwd,f.home);
});
test('active webhook is rejected without changing or deleting it',async t=>{
  const f=fixture(t,{api:async method=>method==='getWebhookInfo'?{ok:true,json:async()=>({ok:true,result:{url:'https://existing.example/hook'}})}:null});
  await assert.rejects(f.bridge.configure({token:TOKEN}),/active webhook/);assert.equal(f.bridge.snapshot().configured,false);assert.equal(f.calls.some(call=>call.method==='deleteWebhook'),false);
});
test('approvals are opaque, bound to identity and offered option, reject replay and stale buttons',async t=>{
  const f=fixture(t);await f.pair();await f.bridge.dispatch(f.message('/run task'));
  f.jobs[0].status='awaiting_approval';f.jobs[0].permissions=[{requestId:'r1',title:'Write file',detail:'bounded detail',options:[{optionId:'yes',name:'Allow once'},{optionId:'no',name:'Reject'}]}];
  await f.bridge.notifyJobs();const sent=f.calls.find(call=>call.body.reply_markup);const data=sent.body.reply_markup.inline_keyboard[0][0].callback_data;assert.ok(Buffer.byteLength(data)<=64);
  const query={id:'q1',data,from:{id:42},message:{chat:{id:42,type:'private'}}};
  await f.bridge.callback({...query,from:{id:77}});assert.equal(f.permissions.length,0);
  await f.bridge.callback(query);assert.deepEqual(f.permissions,[{id:'job-1',requestId:'r1',optionId:'yes'}]);
  await f.bridge.callback(query);assert.equal(f.permissions.length,1);assert.match(f.calls.at(-1).body.text,/expired|handled/);
});
test('only adopted jobs notify; failed sends retry and output is bounded',async t=>{
  let fail=false;const f=fixture(t,{api:async method=>{if(fail&&method==='sendMessage'){fail=false;throw new Error('offline with secret URL');}}});await f.pair();
  f.jobs.push({id:'panel-job',status:'completed',logTail:'x'.repeat(9000)});await f.bridge.notifyJobs();assert.equal(f.calls.length,3);
  await f.bridge.dispatch(f.message('/watch panel-job'));fail=true;await assert.rejects(f.bridge.notifyJobs(),/unreachable/);assert.equal(f.bridge.config.notified.includes('done:panel-job'),false);
  await f.bridge.notifyJobs();assert.equal(f.bridge.config.notified.includes('done:panel-job'),true);assert.ok(f.calls.filter(call=>call.method==='sendMessage').every(call=>call.body.text.length<=4096));
});
test('offset is persisted before dispatch, duplicates never start jobs twice, reconnect restores configuration',async t=>{
  const f=fixture(t);await f.pair();let batches=0;
  f.bridge.fetch=async(url,options)=>{
    if(url.endsWith('/getUpdates')){batches++;if(batches>1){f.bridge.running=false;return {ok:true,json:async()=>({ok:true,result:[]})};}return {ok:true,json:async()=>({ok:true,result:[{update_id:7,...f.message('/run once')},{update_id:7,...f.message('/run twice')}]})};}
    assert.equal(JSON.parse(fs.readFileSync(f.bridge.file)).offset,8);return {ok:true,json:async()=>({ok:true,result:{}})};
  };
  f.bridge.running=true;await f.bridge.poll();assert.equal(f.started.length,1);
  const restored=new TelegramBridge({jobs:f.manager,home:f.home,fetchImpl:f.bridge.fetch});assert.equal(restored.config.offset,8);assert.equal(restored.snapshot().paired.userId,42);await restored.shutdown();
});
test('poller conflict and invalid token stop retries; shutdown retains enabled state',async t=>{
  const f=fixture(t);await f.pair();await f.bridge.start();
  const other=new TelegramBridge({jobs:f.manager,home:f.home,fetchImpl:f.bridge.fetch});await assert.rejects(other.start(),/Another Route3 process/);await other.shutdown();
  await f.bridge.shutdown();assert.equal(f.bridge.snapshot().enabled,true);
  for(const code of [401,409]){f.bridge.fetch=async()=>({ok:false,status:code,json:async()=>({ok:false,error_code:code,description:TOKEN})});await f.bridge.start();await f.bridge.pollPromise;assert.equal(f.bridge.running,false);assert.equal(f.bridge.snapshot().status,code===401?'unauthorized':'conflict');assert.equal(JSON.stringify(f.bridge.snapshot()).includes(TOKEN),false);}
  await f.bridge.stop();assert.equal(f.bridge.snapshot().enabled,false);
});
test('network errors and 429 back off without exposing token URLs',async t=>{
  const f=fixture(t);await f.pair();let attempt=0;const delays=[];
  f.bridge.fetch=async()=>{if(++attempt===1)throw new Error(`https://api.telegram.org/bot${TOKEN}/getUpdates`);return {ok:false,status:429,json:async()=>({ok:false,error_code:429,parameters:{retry_after:7}})};};
  f.bridge.delay=async ms=>{delays.push(ms);if(delays.length===2)f.bridge.running=false;};f.bridge.running=true;await f.bridge.poll();assert.deepEqual(delays,[1000,7000]);assert.equal(JSON.stringify(f.bridge.snapshot()).includes(TOKEN),false);
});
test('configuration cannot be changed by another instance while its poller is active',async t=>{
 const f=fixture(t);await f.pair();await f.bridge.start();const other=new TelegramBridge({jobs:f.manager,home:f.home,fetchImpl:f.bridge.fetch});
 await assert.rejects(other.disconnect(),/Another Route3 process/);assert.throws(()=>other.pairing(),/Another Route3 process/);assert.equal(JSON.parse(fs.readFileSync(f.bridge.file)).token,TOKEN);await other.shutdown();
});
test('changing workspace requires local reconfiguration and fresh pairing',async t=>{
 const f=fixture(t);await f.pair();const other=new TelegramBridge({jobs:f.manager,home:f.home,workspace:path.join(f.home,'different'),fetchImpl:f.bridge.fetch});
 await assert.rejects(other.start(),/different project/);await other.configure({token:TOKEN});assert.equal(other.snapshot().paired,null);await other.shutdown();
});
test('failed durable receipt prevents command execution',async t=>{
 const f=fixture(t);await f.pair();f.bridge.fetch=async()=>({ok:true,json:async()=>({ok:true,result:[{update_id:9,...f.message('/run never')}]})});
 f.bridge.save=()=>{throw new Error('disk full');};f.bridge.running=true;await f.bridge.poll();assert.equal(f.started.length,0);assert.equal(f.bridge.snapshot().status,'error');
});
test('expired approval handles do not grant permissions and watch renews them',async t=>{
 const f=fixture(t);await f.pair();await f.bridge.dispatch(f.message('/run task'));f.jobs[0].permissions=[{requestId:'expiry',title:'Approve',options:[{optionId:'allow',name:'Allow'}]}];await f.bridge.notifyJobs();
 const [data,handle]=[...f.bridge.handles][0];handle.expiresAt=0;await f.bridge.callback({id:'q',data,from:{id:42},message:{chat:{id:42,type:'private'}}});assert.equal(f.permissions.length,0);
 await f.bridge.dispatch(f.message('/watch job-1'));await f.bridge.notifyJobs();assert.ok([...f.bridge.handles.keys()].some(key=>key!==data));
});
