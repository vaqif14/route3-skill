#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function parseArgs(argv) {
  const options = {command: argv[0] || 'status', cwd: process.cwd(), session: null};
  for (let i=1; i<argv.length; i++) {
    if (!['--cwd','--session'].includes(argv[i]) || !argv[i+1]) throw new Error('Usage: session-budget.js status|snapshot|checkpoint [--cwd path] [--session id]');
    options[argv[i].slice(2)] = argv[++i];
  }
  if (!['status','snapshot','checkpoint'].includes(options.command)) throw new Error('Unknown command');
  options.cwd = fs.realpathSync(options.cwd);
  if(!fs.statSync(options.cwd).isDirectory())throw new Error('Workspace must be a directory');
  return options;
}
function writePrivate(file, value) {
  fs.mkdirSync(path.dirname(file), {recursive:true, mode:0o700});
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value,null,2)+'\n', {mode:0o600,flag:'wx'});
  fs.renameSync(temp,file);
}
function validateCheckpoint(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Checkpoint must be an object');
  for (const key of ['goal','nextAction']) if (typeof value[key] !== 'string' || !value[key].trim()) throw new Error(`Missing ${key}`);
  for (const key of ['constraints','changedFiles','verification','blockers','authorization']) {
    if (!Array.isArray(value[key]) || value[key].some(x=>typeof x !== 'string')) throw new Error(`${key} must be an array of strings`);
  }
  const text=JSON.stringify(value);
  if (Buffer.byteLength(text)>32768) throw new Error('Checkpoint exceeds 32 KB; keep a bounded handoff');
  if (/(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}|\b\d{6,}:[A-Za-z0-9_-]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/.test(text)) throw new Error('Possible credential detected; remove secrets before checkpointing');
  return Object.fromEntries(['goal','nextAction','constraints','changedFiles','verification','blockers','authorization'].map(k=>[k,value[k]]));
}
function runtimePath() {
  const candidates = [process.env.ROUTE3_CONTROL_ROOT, path.resolve(__dirname,'../../control-center'), path.join(os.homedir(),'.local/share/route3/control-center')].filter(Boolean);
  const root = candidates.find(p=>fs.existsSync(path.join(p,'telemetry.js')));
  if (!root) throw new Error('Route3 telemetry runtime is missing. Run route3-skill install from the current package.');
  return root;
}
async function main(argv=process.argv.slice(2)) {
  const options=parseArgs(argv), base=path.join(options.cwd,'.workflow/route3');
  if(options.command==='checkpoint') {
    const chunks=[]; let size=0;
    for await(const chunk of process.stdin) {size+=chunk.length;if(size>32768) throw new Error('Checkpoint input exceeds 32 KB');chunks.push(chunk);}
    const checkpoint=validateCheckpoint(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    const file=path.join(base,'CONTEXT_CHECKPOINT.json');
    writePrivate(file,{...checkpoint,savedAt:new Date().toISOString(),cwd:options.cwd,status:'checkpoint_saved'});
    console.log(JSON.stringify({status:'checkpoint_saved',file,compacted:false}));return;
  }
  const {collectTelemetry}=require(path.join(runtimePath(),'telemetry.js'));
  const telemetry=await collectTelemetry({limit:100,cwd:options.session?undefined:options.cwd,sessionId:options.session||undefined});
  const sessions=telemetry.sessions;
  const value={at:new Date().toISOString(),cwd:options.cwd,sessions,warnings:telemetry.warnings||[]};
  if(!sessions.length)value.warnings.push('No matching session telemetry; context occupancy and token usage are unknown.');
  if(sessions.length>1&&!options.session)value.warnings.push('Multiple sessions match this workspace; select --session for active-session decisions.');
  if(options.command==='snapshot'){
    const file=path.join(base,'SESSION_SNAPSHOT.json');let previous=null;
    try{if(fs.statSync(file).size<1048576)previous=JSON.parse(fs.readFileSync(file,'utf8'));}catch{/* first snapshot or malformed old snapshot */}
    value.deltas=usageDeltas(previous,value);
    writePrivate(file,value);
  }
  console.log(JSON.stringify(value,null,2));
}
function usageDeltas(previous,current){
  return current.sessions.map(session=>{
    const old=previous?.sessions?.find(item=>item.id===session.id&&item.provider===session.provider);
    const fields=['inputTokens','outputTokens','cachedInputTokens','totalTokens'];
    const comparable=old&&session.measurement?.usage==='reported_cumulative'&&old.measurement?.usage==='reported_cumulative';
    if(!comparable)return {id:session.id,provider:session.provider,status:'baseline_or_partial',reason:'A same-session cumulative baseline is required for reliable spend deltas.'};
    if(fields.some(key=>typeof session[key]==='number'&&typeof old[key]==='number'&&session[key]<old[key]))return {id:session.id,provider:session.provider,status:'counter_reset',reason:'Counters decreased; a new baseline is required.'};
    return {id:session.id,provider:session.provider,status:'measured_delta',since:previous.at,...Object.fromEntries(fields.map(key=>[key,typeof session[key]==='number'&&typeof old[key]==='number'?session[key]-old[key]:null]))};
  });
}
module.exports={parseArgs,validateCheckpoint,writePrivate,usageDeltas,main};
if(require.main===module)main().catch(error=>{console.error(`Route3: ${error.message}`);process.exitCode=1;});
