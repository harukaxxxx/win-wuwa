import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

// Execute the actual browser scripts with a small DOM and programmable HTTP boundary.
async function page(script, {storage={}, fetch:handler}) {
  const elements=new Map(), buttons=[];
  class Element {
    constructor(id=''){this.id=id;this.hidden=false;this.disabled=false;this.textContent='';this.value='';this.children=[];this.handlers={};this.dataset={};}
    addEventListener(type,fn){this.handlers[type]=fn;}
    insertBefore(el){el.parentElement=this;this.children.push(el);buttons.push(el);}
    append(el){el.parentElement=this;this.children.push(el);buttons.push(el);}
    querySelectorAll(){return [];}
    removeAttribute(){}
    async click(){assert.ok(!this.hidden&&!this.disabled,`button inaccessible: ${this.id||this.textContent}`);return this.handlers.click?.({preventDefault(){}});}
  }
  const document={getElementById(id){if(!elements.has(id))elements.set(id,new Element(id));return elements.get(id);},createElement(){return new Element();}};
  const data=new Map(Object.entries(storage));
  const store={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
  const calls=[];
  let uuid=0;
  const context={document,location:{pathname:'/s/123',search:'',assign(){}},URLSearchParams,crypto:{randomUUID:()=>uuid++?'dddddddd-dddd-4ddd-8ddd-dddddddddddd':'cccccccc-cccc-4ccc-8ccc-cccccccccccc'},sessionStorage:store,localStorage:{getItem(){return null;}},confirm:()=>true,console,fetch:async(url,options={})=>{calls.push({url,method:options.method||'GET'});return handler(url,options);}};
  vm.runInNewContext(await readFile(new URL(`../public/${script}`,import.meta.url),'utf8'),context);
  for(let i=0;i<100;i++){await new Promise(r=>setTimeout(r,1));if(calls.length>=2)break;}
  return {get:id=>document.getElementById(id),button:text=>buttons.find(b=>b.textContent===text),calls,data};
}
const response=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body,arrayBuffer:async()=>new ArrayBuffer(0)});
const old={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',rule_version:1};
const current={id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',rule_version:1,status:'open',count:0};
const flush=()=>new Promise(r=>setTimeout(r,30));
test('fresh tab reads last persisted draw without sending a draw',async()=>{
 const p=await page('app.js',{fetch:async(url)=>{
  if(url==='/api/session')return response({user_id:'123',csrf:'x',approved:true});
  if(url==='/api/activity-default')return response({version:0,guild_id:null,guild_invite_url:null});
  if(url==='/api/activities/current')return response({activity:{...old,status:'open'},opening_generation:1});
  if(url==='/api/environment')return response({version:1,value:''});
  if(url===`/api/activities/${old.id}/draw-results/latest`)return response({draw:{winner_ordinal:7,rule_version:1,created_at:1}});
  throw Error(url);
 }});await flush();assert.match(p.get('draw-result').textContent,/7/);assert.equal(p.calls.filter(c=>c.method==='PUT').length,0);
});

test('old withdrawal reconciliation restores registration controls for new activity',async()=>{
  let oldReads=0;
  const p=await page('viewer.js',{storage:{'wuwa-withdraw-123-300':JSON.stringify(old)},fetch:async url=>{
    if(url==='/api/session')return response({user_id:'300',csrf:'x'});
    if(url==='/api/viewer/123')return response({activity:current});
    if(url.includes('/self?')){if(url.includes(old.id)){oldReads++;return oldReads===1?response({},503):response({status:'withdrawn',ordinal:1,terminal:true});}return response({status:null,ordinal:null});}
    throw Error(url);
  }});await flush();
  assert.equal(p.get('register').hidden,true);
  await p.button('重新確認退出結果').click();
  assert.equal(p.get('register').hidden,false);
  assert.equal(p.data.has('wuwa-withdraw-123-300'),false);
  assert.equal(p.calls.filter(c=>c.method==='POST').length,0);
  assert.equal(oldReads,2);
});

test('pending registration readback reveals withdrawal control',async()=>{
  let reads=0;
  const p=await page('viewer.js',{storage:{'wuwa-register-123-300':JSON.stringify(current)},fetch:async url=>{
    if(url==='/api/session')return response({user_id:'300',csrf:'x'});
    if(url==='/api/viewer/123')return response({activity:current});
    if(url.includes('/self?'))return ++reads===1?response({},503):response({status:'registered',ordinal:1});
    throw Error(url);
  }});await flush();
  await p.get('retry').click();
  assert.equal(p.button('退出本場').hidden,false);
  assert.equal(p.calls.filter(c=>c.method==='POST').length,0);
});

test('owner can reconcile old status pending without a current activity',async()=>{
  const pending={...old,version:0,status:'paused'};
  const p=await page('app.js',{storage:{'wuwa-status-123':JSON.stringify(pending)},fetch:async url=>{
    if(url==='/api/session')return response({user_id:'123',csrf:'x',approved:true});
    if(url==='/api/activity-default')return response({version:0,guild_id:null,guild_invite_url:null});
    if(url==='/api/activities/current')return response({activity:null,opening_generation:1});
    if(url===`/api/activities/${old.id}/status`)return response({...old,status:'cancelled',status_version:2});
    if(url==='/api/environment')return response({version:1,value:''});
    throw Error(url);
  }});await flush();
  const retry=p.button('重新確認狀態');
  assert.equal(retry.parentElement.hidden,false);
  assert.equal(retry.hidden,false);
  await retry.click();
  assert.equal(p.data.has('wuwa-status-123'),false);
  assert.equal(p.get('reload-activity').disabled,false);
  assert.equal(p.calls.filter(c=>c.method==='PUT').length,0);
  assert.equal(p.calls.filter(c=>c.url===`/api/activities/${old.id}/status`).length,1);
});

test('status 409 with failed exact read keeps pending until conservative readback',async()=>{
  let reads=0;
  const activity={...old,status:'open',status_version:0};
  const p=await page('app.js',{fetch:async(url,options={})=>{
    if(url==='/api/session')return response({user_id:'123',csrf:'x',approved:true});
    if(url==='/api/activity-default')return response({version:0,guild_id:null,guild_invite_url:null});
    if(url==='/api/activities/current')return response({activity,opening_generation:1});
    if(url==='/api/environment')return response({version:1,value:''});
    if(url===`/api/activities/${old.id}/status`){
      if(options.method==='PUT')return response({},409);
      return ++reads===1?response({},503):response({...old,status:'paused',status_version:1});
    }
    throw Error(url);
  }});await flush();
  await p.button('暫停報名').click();
  assert.equal(p.data.has('wuwa-status-123'),true);
  assert.match(p.get('activity-message').textContent,/無法確認原場狀態/);
  await p.button('重新確認狀態').click();
  assert.equal(p.data.has('wuwa-status-123'),false);
  assert.equal(p.get('activity-message').textContent,'原場狀態已變更，已確認目前狀態。');
  assert.equal(p.calls.filter(c=>c.method==='PUT').length,1);
  assert.equal(p.calls.filter(c=>c.url===`/api/activities/${old.id}/status`&&c.method==='GET').length,2);
});

test('unknown draw stays fenced after 404 and recovers exact persisted result',async()=>{
  let reads=0;
  const activity={...old,status:'paused',status_version:1};
  const path=`/api/activities/${old.id}/draws/cccccccc-cccc-4ccc-8ccc-cccccccccccc`;
  const p=await page('app.js',{fetch:async(url,options={})=>{
    if(url==='/api/session')return response({user_id:'123',csrf:'x',approved:true});
    if(url==='/api/activity-default')return response({version:0,guild_id:null,guild_invite_url:null});
    if(url==='/api/activities/current')return response({activity,opening_generation:1});
    if(url==='/api/environment')return response({version:1,value:''});
    if(url===path && options.method==='PUT')throw Error('lost response');
    if(url===path)return ++reads===1?response({},404):response({draw:{winner_ordinal:7,rule_version:1,created_at:1}});
    throw Error(url);
  }});await flush();
  await p.button('抽選').click();
  assert.equal(p.button('抽選').hidden,true);
  assert.equal(p.data.has('wuwa-draw-123'),true);
  await p.button('重新確認抽選結果').click();
  assert.match(p.get('draw-result').textContent,/7/);
  assert.equal(p.button('抽選').hidden,false);
  assert.equal(p.calls.filter(c=>c.method==='PUT').length,1);
  assert.equal(reads,2);
});

test('old pending 404 stays fenced after reload and never targets new activity',async()=>{
  const op={...old,key:'original-key'};
  const p=await page('app.js',{storage:{'wuwa-draw-123':JSON.stringify(op)},fetch:async(url)=>{
    if(url==='/api/session')return response({user_id:'123',csrf:'x',approved:true});
    if(url==='/api/activity-default')return response({version:0,guild_id:null,guild_invite_url:null});
    if(url==='/api/activities/current')return response({activity:current,opening_generation:2});
    if(url==='/api/environment')return response({version:1,value:''});
    if(url===`/api/activities/${old.id}/draws/original-key`)return response({},404);
    throw Error(url);
  }});await flush();
  assert.equal(p.button('抽選').hidden,true);
  await p.button('重新確認抽選結果').click();
  assert.equal(p.data.get('wuwa-draw-123'),JSON.stringify(op));
  assert.equal(p.calls.filter(c=>c.method==='PUT').length,0);
  assert.equal(p.calls.filter(c=>c.url===`/api/activities/${old.id}/draws/original-key`).length,2);
});

test('definitive 409 with exact 404 clears rejected draw without reporting winner',async()=>{
  const p=await page('app.js',{fetch:async(url,options={})=>{
    if(url==='/api/session')return response({user_id:'123',csrf:'x',approved:true});
    if(url==='/api/activity-default')return response({version:0,guild_id:null,guild_invite_url:null});
    if(url==='/api/activities/current')return response({activity:{...old,status:'paused'},opening_generation:1});
    if(url==='/api/environment')return response({version:1,value:''});
    if(url.includes('/draws/'))return response({},options.method==='PUT'?409:404);
    throw Error(url);
  }});await flush();await p.button('抽選').click();
  assert.match(p.get('draw-result').textContent,/遭拒絕/);
  assert.equal(p.data.has('wuwa-draw-123'),false);
  assert.equal(p.button('抽選').hidden,false);
});

test('winner first clears pending withdrawal and hides stale withdraw button',async()=>{
  let reads=0;
  const p=await page('viewer.js',{fetch:async(url,options={})=>{
    if(url==='/api/session')return response({user_id:'300',csrf:'x'});
    if(url==='/api/viewer/123')return response({activity:current});
    if(url.includes('/self?'))return ++reads===1?response({status:'registered',ordinal:1}):response({status:'winner',ordinal:1});
    if(url.endsWith('/withdraw')&&options.method==='POST')return response({},409);
    throw Error(url);
  }});await flush();await p.button('退出本場').click();
  assert.equal(p.button('退出本場').hidden,true);
  assert.match(p.get('self').textContent,/已中獎/);
  assert.equal(p.data.has('wuwa-withdraw-123-300'),false);
});

test('a later draw needs an explicit click and a new request key',async()=>{
  const p=await page('app.js',{fetch:async(url,options={})=>{
    if(url==='/api/session')return response({user_id:'123',csrf:'x',approved:true});
    if(url==='/api/activity-default')return response({version:0,guild_id:null,guild_invite_url:null});
    if(url==='/api/activities/current')return response({activity:{...old,status:'open'},opening_generation:1});
    if(url==='/api/environment')return response({version:1,value:''});
    if(url.includes('/draws/'))return response({draw:{winner_ordinal:url.includes('cccccccc')?1:2,rule_version:1,created_at:1}});
    throw Error(url);
  }});await flush();
  await p.button('抽選').click();assert.match(p.get('draw-result').textContent,/序號 1/);
  assert.equal(p.calls.filter(c=>c.method==='PUT').length,1);
  await p.button('抽選').click();assert.match(p.get('draw-result').textContent,/序號 2/);
  const puts=p.calls.filter(c=>c.method==='PUT');assert.equal(puts.length,2);assert.notEqual(puts[0].url,puts[1].url);
});
