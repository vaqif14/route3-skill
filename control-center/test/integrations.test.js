'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {Integrations,commandFor}=require('../integrations');
test('Telegram lifecycle explicitly targets observed default account, never all accounts',async()=>{
 const calls=[];
 const integrations=new Integrations({command:'/fake',run:async(command,args)=>{calls.push(args);return {code:0,output:JSON.stringify({channelDefaultAccountId:{telegram:'work'},channelAccounts:{telegram:[{accountId:'personal',configured:true},{accountId:'work',configured:true,running:true}]}})};}});
 await integrations.action('telegram','stop');
 assert.equal(calls.length,2);
 assert.deepEqual(JSON.parse(calls[1][calls[1].indexOf('--params')+1]),{channel:'telegram',accountId:'work'});
 assert.throws(()=>commandFor('telegram','stop'),/verified Telegram account/);
});
test('Telegram refuses lifecycle without a verified configured account',async()=>{
 let calls=0;
 const integrations=new Integrations({command:'/fake',run:async()=>{calls++;return {code:0,output:'{"channels":{}}'};}});
 assert.equal((await integrations.action('telegram','start')).status,'not_configured');assert.equal(calls,1);
});
