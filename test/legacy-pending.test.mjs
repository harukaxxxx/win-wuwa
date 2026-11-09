import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

test('legacy pending is retained and never submitted until explicit discard',async()=>{
 const nodes=new Map(); const get=id=>{if(!nodes.has(id))nodes.set(id,{hidden:true,value:'',textContent:'',disabled:false,append(){},insertBefore(){},addEventListener(type,fn){this[type]=fn;}});return nodes.get(id);};
 const old=JSON.stringify({id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',guild_id:'123'});const local=new Map([['wuwa-open-123',old]]),tab=new Map();
 const storage=m=>({getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)});const writes=[];
 const response=v=>({ok:true,status:200,json:async()=>v});
 const fetch=async(url,options={})=>{if(options.method)writes.push([url,options.method]);if(url==='/api/session')return response({csrf:'x',user_id:'123',approved:true,admin:false});if(url==='/api/activity-default')return response({guild_id:null,guild_invite_url:null,version:0});if(url==='/api/activities/current')return response({activity:null,opening_generation:0});if(url==='/api/environment')return response({value:'',version:0});throw Error(url);};
 const context=vm.createContext({document:{getElementById:get,createElement:()=>({addEventListener(){}})},localStorage:storage(local),sessionStorage:storage(tab),fetch,crypto:{randomUUID:()=>{throw Error('unexpected id');}},console});
 vm.runInContext(await readFile('public/app.js','utf8'),context);await new Promise(resolve=>setTimeout(resolve,20));
 assert.equal(get('legacy-warning').hidden,false);assert.equal(get('legacy-evidence').textContent,old);assert.equal(get('open-activity').hidden,true);assert.equal(local.get('wuwa-open-123'),old);assert.deepEqual(writes,[]);
 get('open-activity').submit({preventDefault(){}});assert.deepEqual(writes,[]);assert.equal(local.get('wuwa-open-123'),old);
 get('discard-legacy').click();assert.equal(local.has('wuwa-open-123'),false);assert.equal(get('open-activity').hidden,false);assert.deepEqual(writes,[]);
});
