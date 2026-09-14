'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs'),path=require('node:path'),os=require('node:os');const {spawnSync}=require('node:child_process');
test('failed native compilation preserves the working app and removes staging files',{skip:process.platform==='win32'},t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'route3-native-build-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const bin=path.join(directory,'bin'),output=path.join(directory,"App's & output"),app=path.join(output,'Route3 Control.app');fs.mkdirSync(bin);fs.mkdirSync(app,{recursive:true});fs.writeFileSync(path.join(app,'working-version'),'keep');fs.writeFileSync(path.join(bin,'swiftc'),'#!/bin/sh\nexit 17\n',{mode:0o700});
 const result=spawnSync('/bin/bash',[path.resolve(__dirname,'../control-center/mac/build.sh'),'--output',output],{env:{...process.env,PATH:[bin,path.dirname(process.execPath),'/usr/bin','/bin'].join(path.delimiter)},encoding:'utf8'});
 assert.equal(result.status,17,result.stderr);assert.equal(fs.readFileSync(path.join(app,'working-version'),'utf8'),'keep');assert.deepEqual(fs.readdirSync(output),['Route3 Control.app']);
});
