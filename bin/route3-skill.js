#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {spawn}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..');
const TARGETS=['claude','cursor','codex','agents','openclaw'];
function parseArgs(argv){
 const result={cmd:argv[0]||'help',quiet:false,dryRun:false,targets:[]};
 for(const arg of argv.slice(1)){
  if(arg==='--quiet'||arg==='-q')result.quiet=true;
  else if(arg==='--dry-run')result.dryRun=true;
  else if(arg==='--all')result.targets=[...TARGETS];
  else if(TARGETS.includes(arg.slice(2))&&arg.startsWith('--'))result.targets.push(arg.slice(2));
  else throw new Error(`Unknown option: ${arg}`);
 }
 if(!result.targets.length)result.targets=[...TARGETS];
 result.targets=[...new Set(result.targets)];return result;
}
function pathsFor(home,target){
 const base=path.join(home,`.${target}`);
 return {skill:path.join(base,'skills/route3'),...(['claude','cursor'].includes(target)?{agents:path.join(base,'agents/route3'),command:path.join(base,'commands/route3.md')}:{})};
}
function mergeInstall(src,dest,options){
 if(!fs.existsSync(src))throw new Error(`Missing package resource: ${src}`);
 if(!options.quiet)console.log(`${options.dryRun?'Would install':'Installing'} ${dest}`);
 if(options.dryRun)return;
 const stamp=`${Date.now()}-${process.pid}`;
 const stage=`${dest}.stage-${stamp}`;
 const backup=options.backupRoot ? path.join(options.backupRoot,`${path.basename(dest)}-${stamp}`) : `${dest}.backup-${stamp}`;
 fs.mkdirSync(path.dirname(dest),{recursive:true});
 // Keep local additions and private configuration. Only packaged paths update.
 // Backups retain the exact old installation, including any symlink itself.
 const exists=fs.existsSync(dest)||(()=>{try{return !!fs.lstatSync(dest);}catch{return false;}})();
 try{
  if(exists)fs.cpSync(dest,stage,{recursive:true,dereference:true});
  fs.cpSync(src,stage,{recursive:true,force:true,dereference:true});
  if(exists){fs.mkdirSync(path.dirname(backup),{recursive:true,mode:0o700});fs.renameSync(dest,backup);}
  try{fs.renameSync(stage,dest);}catch(error){if(exists)fs.renameSync(backup,dest);throw error;}
  if(exists&&!options.quiet)console.log(`Backup: ${backup}`);
 }catch(error){fs.rmSync(stage,{recursive:true,force:true});throw error;}
}
function install(options,home=os.homedir()){
 for(const target of options.targets){
  const p=pathsFor(home,target);
  const targetOptions={...options,backupRoot:path.join(home,'.local/share/route3/backups',target)};
  mergeInstall(path.join(ROOT,'skill'),p.skill,{...targetOptions,backupRoot:path.join(targetOptions.backupRoot,'skills')});
  if(p.agents)mergeInstall(path.join(ROOT,'agents'),p.agents,{...targetOptions,backupRoot:path.join(targetOptions.backupRoot,'agents')});
  if(p.command)mergeInstall(path.join(ROOT,'skill/commands/route3.md'),p.command,{...targetOptions,backupRoot:path.join(targetOptions.backupRoot,'commands')});
 }
 mergeInstall(path.join(ROOT,'control-center'),path.join(home,'.local/share/route3/control-center'),{...options,backupRoot:path.join(home,'.local/share/route3/backups/runtime')});
 if(!options.quiet)console.log('Route3 installed. Run route3-skill center or route3-skill mac.');
}
function uninstall(options,home=os.homedir()){
 for(const target of options.targets){
  for(const [kind,dest] of Object.entries(pathsFor(home,target))){
   if(!fs.existsSync(dest))continue;
   const backup=path.join(home,'.local/share/route3/backups',target,`${kind}-uninstalled-${Date.now()}-${process.pid}`);
   if(!options.quiet)console.log(`${options.dryRun?'Would move':'Moving'} ${dest} to ${backup}`);
   if(!options.dryRun){fs.mkdirSync(path.dirname(backup),{recursive:true,mode:0o700});fs.renameSync(dest,backup);}
  }
 }
}
function run(command,args){const child=spawn(command,args,{stdio:'inherit',shell:false});child.on('error',e=>{console.error(e.message);process.exitCode=1;});child.on('exit',code=>{process.exitCode=code===null?1:code;});}
function help(){console.log(`Route3 — measured agent orchestration and Mac control center

  route3-skill install [--claude|--cursor|--codex|--agents|--openclaw|--all] [--dry-run]
  route3-skill uninstall [--all]      Move installed skills into recovery backups
  route3-skill center                 Start local control center
  route3-skill mac                    Build/install the native Mac app
  route3-skill sessions [--cwd PATH] [--session ID]
  route3-skill help

Existing installs are backed up and local additions preserved. Model credentials
remain with their own CLIs. No paid model probes run during installation.`);}
function main(argv=process.argv.slice(2)){
 const command=argv[0]||'help';
 if(command==='center')return run(process.execPath,[path.join(ROOT,'control-center/server.js'),...argv.slice(1)]);
 if(command==='sessions')return run(process.execPath,[path.join(ROOT,'skill/scripts/session-budget.js'),'status',...argv.slice(1)]);
 if(command==='mac')return run('/bin/bash',[path.join(ROOT,'control-center/mac/build.sh'),...argv.slice(1)]);
 const args=parseArgs(argv);
 if(['install','i'].includes(args.cmd))return install(args);
 if(['uninstall','remove','rm'].includes(args.cmd))return uninstall(args);
 if(['help','--help','-h'].includes(args.cmd))return help();
 throw new Error(`Unknown command: ${args.cmd}. Use route3-skill help.`);
}
module.exports={parseArgs,pathsFor,mergeInstall,install,uninstall,main};
if(require.main===module){try{main();}catch(e){console.error(`route3-skill: ${e.message}`);process.exitCode=1;}}
