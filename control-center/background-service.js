#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const {spawnSync} = require('node:child_process');
const LABEL = 'az.itinnovations.route3.background';
const xml = value => String(value).replace(/[&<>"']/g, char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]));
function runtimePath(home, node = process.execPath, inherited = process.env.PATH || '') {
  const nvm = path.join(home,'.nvm/versions/node');
  let versions = [];
  try { versions = fs.readdirSync(nvm).filter(name=>/^v\d+\.\d+\.\d+$/.test(name)).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true})).map(name=>path.join(nvm,name,'bin')); } catch {}
  return [...new Set([path.dirname(node),path.join(home,'.local/bin'),path.join(home,'.kimi-code/bin'),'/opt/homebrew/bin','/usr/local/bin',...versions,...inherited.split(':'),'/usr/bin','/bin','/usr/sbin','/sbin'].filter(Boolean))].join(':');
}
function plist({home,workspace,server,node=process.execPath,port=43173}) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>
<key>Label</key><string>${LABEL}</string>
<key>ProgramArguments</key><array>${[node,server,'--workspace',workspace,'--port',String(port)].map(value=>`<string>${xml(value)}</string>`).join('')}</array>
<key>WorkingDirectory</key><string>${xml(workspace)}</string>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(runtimePath(home,node))}</string><key>ROUTE3_BACKGROUND_SERVICE</key><string>${LABEL}</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>30</integer>
<key>ProcessType</key><string>Background</string><key>StandardOutPath</key><string>/dev/null</string><key>StandardErrorPath</key><string>/dev/null</string>
</dict></plist>\n`;
}
function portFree(port) { return new Promise((resolve,reject)=>{ const socket = net.createServer(); socket.once('error',()=>reject(new Error('The Route3 port is occupied. Close the existing Route3 server before installing the background service.'))); socket.listen(port,'127.0.0.1',()=>socket.close(resolve)); }); }
class BackgroundService {
  constructor({home=os.homedir(), platform=process.platform, uid=process.getuid?.(), exec=spawnSync, checkPort=portFree, server=path.join(home,'.local/share/route3/control-center/server.js')}={}) {
    this.home=home;this.platform=platform;this.domain=`gui/${uid}`;this.exec=exec;this.checkPort=checkPort;this.server=server;
    this.file=path.join(home,'Library/LaunchAgents',`${LABEL}.plist`);
  }
  call(args) { return this.exec('/bin/launchctl',args,{encoding:'utf8',timeout:10000,maxBuffer:262144}); }
  status() {
    if(this.platform!=='darwin') return {supported:false,installed:false,running:false};
    const result=this.call(['print',`${this.domain}/${LABEL}`]);
    const output=result.stdout || '';
    return {supported:true,installed:fs.existsSync(this.file),loaded:result.status===0,running:result.status===0 && /state = running/.test(output),pid:Number(output.match(/\bpid = (\d+)/)?.[1])||null,plist:this.file};
  }
  async install({workspace=process.cwd(),port=43173}={}) {
    if(this.platform!=='darwin') throw new Error('Background service requires macOS.');
    if(!Number.isInteger(port)||port<1||port>65535) throw new Error('Invalid port.');
    workspace=fs.realpathSync(workspace);
    if(!fs.statSync(workspace).isDirectory()||!fs.existsSync(this.server)) throw new Error('Install Route3 and select an existing project first.');
    if(this.status().loaded) throw new Error('The background service is already loaded. Use service status; uninstall before changing its workspace.');
    await this.checkPort(port);
    fs.mkdirSync(path.dirname(this.file),{recursive:true});
    const contents=plist({home:this.home,workspace,server:this.server,port});
    let backup;
    if(fs.existsSync(this.file)) {
      if(!fs.lstatSync(this.file).isFile() || !fs.readFileSync(this.file,'utf8').includes(`<string>${LABEL}</string>`)) throw new Error('Existing LaunchAgent is not owned by Route3.');
      backup=path.join(this.home,'.local/share/route3/backups/service',`${Date.now()}.plist`);
      fs.mkdirSync(path.dirname(backup),{recursive:true,mode:0o700});fs.renameSync(this.file,backup);
    }
    fs.writeFileSync(this.file,contents,{mode:0o600,flag:'wx'});
    const result=this.call(['bootstrap',this.domain,this.file]);
    if(result.status!==0) {fs.unlinkSync(this.file);if(backup)fs.renameSync(backup,this.file);throw new Error('macOS could not load Route3. Check System Settings → Login Items & Extensions and the active login session.');}
    return this.status();
  }
  uninstall() {
    if(this.platform!=='darwin') throw new Error('Background service requires macOS.');
    if(this.status().loaded && this.call(['bootout',`${this.domain}/${LABEL}`]).status!==0) throw new Error('macOS could not stop the Route3 service.');
    if(fs.existsSync(this.file)) {
      if(!fs.lstatSync(this.file).isFile()||!fs.readFileSync(this.file,'utf8').includes(`<string>${LABEL}</string>`)) throw new Error('Existing LaunchAgent is not owned by Route3.');
      const backup=path.join(this.home,'.local/share/route3/backups/service',`removed-${Date.now()}.plist`);
      fs.mkdirSync(path.dirname(backup),{recursive:true,mode:0o700});fs.renameSync(this.file,backup);
    }
    return this.status();
  }
}
async function main(args=process.argv.slice(2)) {
  const action=args.shift();const options={};
  while(args.length) {const key=args.shift();if(!['--workspace','--port'].includes(key)||!args.length)throw new Error('Usage: route3-skill service install|status|uninstall [--workspace PATH] [--port 43173]');options[key.slice(2)]=key==='--port'?Number(args.shift()):args.shift();}
  if(!['install','status','uninstall'].includes(action))throw new Error('Use service install, status, or uninstall.');
  const service=new BackgroundService();console.log(JSON.stringify(await service[action](options),null,2));
}
module.exports={BackgroundService,plist,runtimePath,LABEL};
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
