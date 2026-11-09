import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

class Element {
  constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.listeners={};this.hidden=false;this.disabled=false;this.dataset={};this.textContent='';}
  append(...els){this.children.push(...els);}
  insertBefore(el){this.append(el);}
  replaceChildren(...els){this.children=[...els];}
  setAttribute(){} removeAttribute(){} querySelectorAll(){return [];}
  addEventListener(name,fn){(this.listeners[name]??=[]).push(fn);}
  click(){if(!this.disabled)for(const fn of this.listeners.click??[])fn({});}
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const response=data=>({ok:true,status:200,json:async()=>data,arrayBuffer:async()=>new ArrayBuffer(0)});
async function setup(file,fetch){const elements=new Map();const document={getElementById(id){if(!elements.has(id))elements.set(id,new Element());return elements.get(id);},createElement(tag){return new Element(tag);}};const store={getItem(){return null;},setItem(){},removeItem(){}};const c=vm.createContext({document,fetch,location:{pathname:'/s/123',search:'',assign(){}},URLSearchParams,sessionStorage:store,localStorage:store,navigator:{clipboard:{}},crypto:{randomUUID:()=>''},confirm:()=>true,console});vm.runInContext(await readFile(new URL('../public/'+file,import.meta.url),'utf8'),c);await tick();return {c,elements,eval:s=>vm.runInContext(s,c)};}
const row=n=>({ordinal:n,display_name:'name'+n,status:'registered',score:0,discord_id:'',username:''});

test('roster suppresses reentry and discards obsolete same and other selection responses',async()=>{
 const calls=[];const queue=[];
 const h=await setup('app.js',async url=>{if(url==='/api/session')return {status:401,ok:false};if(String(url).includes('/roster?')){const d=deferred();calls.push(url);queue.push(d);return d.promise;}return response({});});
 const select=id=>h.eval(`rosterPage('${id}',true)`);const more=()=>h.eval('rosterMore.click()');
 const a=select('a');queue.shift().resolve(response({total:2,registrations:[row(1)],next_cursor:1}));await a;
 more();more();assert.equal(calls.length,2);assert.equal(calls[1],'/api/activities/a/roster?cursor=1');assert.equal(h.eval('rosterMore.disabled'),true);
 queue.shift().resolve(response({total:2,registrations:[row(2)],next_cursor:null}));await tick();assert.equal(h.eval('privateList.children.length'),2);
 const old=select('a');const current=select('a');const oldD=queue.shift(),currentD=queue.shift();oldD.resolve(response({total:99,registrations:[row(99)],next_cursor:null}));await old;assert.equal(h.eval('rosterMore.disabled'),true);assert.equal(h.eval('privateList.children.length'),0);currentD.resolve(response({total:1,registrations:[row(3)],next_cursor:null}));await current;assert.match(h.eval('privateList.children[0].children[0].textContent'),/序號 3/);
 const stale=select('a');const fresh=select('b');const staleD=queue.shift(),freshD=queue.shift();freshD.resolve(response({total:1,registrations:[row(4)],next_cursor:null}));await fresh;staleD.resolve(response({total:1,registrations:[row(5)],next_cursor:null}));await stale;assert.match(h.eval('privateList.children[0].children[0].textContent'),/序號 4/);assert.equal(h.eval('privateList.children.length'),1);
});

test('registration retry refreshes chance and old responses cannot overwrite new activity',async()=>{
 let selfCalls=0;const chances=[];const oldChance=deferred();let deferChance=false;
 const h=await setup('viewer.js',async url=>{url=String(url);if(url==='/api/session')return response({user_id:'300',csrf:'x'});if(url==='/api/viewer/123')return response({activity:{id:'a',rule_version:1,status:'open',count:0}});if(url.includes('/results?'))return response({winners:[],next_cursor:null});if(url.includes('/self?')){selfCalls++;if(selfCalls===2)return {ok:false,status:503};return response(selfCalls===1?{ordinal:null,status:null}:{ordinal:1,status:'registered'});}if(url.endsWith('/register'))throw Error('lost');if(url.includes('/chance?')){chances.push(url);if(deferChance)return oldChance.promise;return response(selfCalls<3?{status:null,probability:null,candidate_revision:0}:{status:'registered',ordinal:1,score:0,probability:1,candidate_revision:2});}throw Error(url);});
 await tick();h.elements.get('register').click();await tick();await tick();assert.match(h.eval('chanceText.textContent'),/未知/);h.elements.get('retry').click();await tick();await tick();assert.match(h.eval('chanceText.textContent'),/100\.00%/);assert.match(h.eval('chanceText.textContent'),/資料版本 2/);
 deferChance=true;const old=h.eval('refreshChance()');h.eval("activity={id:'b',rule_version:1,status:'open'}");deferChance=false;await h.eval('refreshChance()');const current=h.eval('chanceText.textContent');oldChance.resolve(response({status:null,probability:null,candidate_revision:0}));await old;assert.equal(h.eval('chanceText.textContent'),current);assert.ok(chances.some(x=>x.includes('activity_id=b')));
});
