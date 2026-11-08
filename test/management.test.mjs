import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
const origin='http://localhost';
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:process.env.WUWA_TEST_BUNDLE||'dist/index.js',compatibilityDate:'2026-07-30',d1Databases:['DB'],bindings:{ORIGIN:origin,ADMIN_DISCORD_ID:'100',DISCORD_CLIENT_ID:'fixture',DISCORD_CLIENT_SECRET:'fixture'}}));
const db=await mf.getD1Database('DB');
for(const f of ['migrations/0001_init.sql','migrations/0002_login_budget.sql']) for(const sql of (await readFile(f,'utf8')).split(';').map(x=>x.trim()).filter(Boolean)) await db.prepare(sql).run();
await db.prepare('INSERT INTO approved_streamers VALUES (?)').bind('200').run();
await db.prepare('INSERT INTO environments VALUES (?,?,?)').bind('200','private',1).run();
for(const sql of (await readFile('migrations/0003_streamer_status.sql','utf8')).split(';').map(x=>x.trim()).filter(Boolean)) await db.prepare(sql).run();
const digest=x=>createHash('sha256').update(x).digest('hex');
async function identity(id,char){const sid=char.repeat(64),csrf='f'.repeat(64); await db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').bind(digest(sid),id,digest(csrf),Math.floor(Date.now()/1000)+300).run(); return {Cookie:`__Host-session=${sid}; __Host-csrf=${csrf}`,Origin:origin,'X-CSRF-Token':csrf,'Content-Type':'application/json'};}
const admin=await identity('100','a'),streamer=await identity('200','b'),unknown=await identity('300','c');
const req=(path,headers,method='GET',body)=>mf.dispatchFetch(origin+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
test('exact streamer read requires administrator and distinguishes missing targets',async()=>{
 const path='/api/admin/streamers/200';
 assert.equal((await req(path,{})).status,401);
 assert.equal((await req(path,streamer)).status,403);
 assert.equal((await req(path,unknown)).status,403);
 assert.equal((await req('/api/admin/streamers/999999',admin)).status,404);
 assert.equal((await req(path+'?x=1',admin)).status,400);
 assert.deepEqual(await (await req(path,admin)).json(),{user_id:'200',status:'approved',version:1});
});
test('administrator can disable and reapprove without deleting migrated private data',async()=>{
 assert.equal((await req('/api/environment',streamer)).status,200);
 assert.equal((await req('/api/admin/streamers/200',unknown,'PUT',{status:'disabled',version:1})).status,403);
 let r=await req('/api/admin/streamers/200',admin,'PUT',{status:'disabled',version:1}); assert.equal(r.status,200);
 assert.equal((await req('/api/environment',streamer)).status,403);
 assert.equal((await req('/api/admin/streamers/200',admin,'PUT',{status:'approved',version:2})).status,200);
 assert.deepEqual(await (await req('/api/environment',streamer)).json(),{value:'private',version:1});
});
test('management requires CSRF, rejects unknown fields and stale versions',async()=>{
 assert.equal((await req('/api/admin/streamers/400',{...admin,Origin:'http://evil.test'},'PUT',{status:'approved',version:0})).status,403);
 assert.equal(await db.prepare('SELECT user_id FROM approved_streamers WHERE user_id=?').bind('400').first(),null);
 for(const body of [null,[],{status:'approved',version:0,owner:'200'},{status:null,version:0}]) assert.equal((await req('/api/admin/streamers/400',admin,'PUT',body)).status,400);
 assert.equal((await req('/api/admin/streamers/400',admin,'PUT',{status:'approved',version:0})).status,200);
 assert.equal((await req('/api/admin/streamers/400',admin,'PUT',{status:'disabled',version:0})).status,409);
 assert.equal((await req('/api/admin/streamers/400',admin,'PUT',{status:'approved',version:1})).status,200);
 assert.deepEqual(await (await req('/api/environment',admin)).json(),{error:'not approved'});
 assert.equal((await req('/api/environment',streamer,'PUT',{value:'x',version:1,owner:'400'})).status,400);
});
test('initial approval retry returns existing approved row but cannot reapprove disabled',async()=>{
 const path='/api/admin/streamers/777';
 assert.deepEqual(await (await req(path,admin,'PUT',{status:'approved',version:0})).json(),{status:'approved',version:1});
 assert.deepEqual(await (await req(path,admin,'PUT',{status:'approved',version:0})).json(),{status:'approved',version:1});
 assert.equal((await req(path,admin,'PUT',{status:'disabled',version:1})).status,200);
 assert.equal((await req(path,admin,'PUT',{status:'approved',version:0})).status,409);
 assert.equal((await req(path,admin,'PUT',{status:'approved',version:1})).status,409);
 assert.deepEqual(await (await req(path,admin,'PUT',{status:'approved',version:2})).json(),{status:'approved',version:3});
});
test('management list pages to exhaustion and rejects malformed queries',async()=>{
 for(let i=0;i<105;i++) await db.prepare("INSERT INTO approved_streamers(user_id,status,version) VALUES (?,'approved',1)").bind(String(10000+i)).run();
 let cursor='',ids=[];
 do {const r=await req('/api/admin/streamers'+(cursor?'?cursor='+cursor:''),admin); assert.equal(r.status,200);const page=await r.json();ids.push(...page.streamers.map(x=>x.user_id)); assert.equal(typeof page.has_more,'boolean'); cursor=page.next_cursor;assert.equal(Boolean(cursor),page.has_more);} while(cursor);
 assert.equal(new Set(ids).size,ids.length);for(let i=0;i<105;i++) assert.ok(ids.includes(String(10000+i)));
 for(const q of ['?cursor=bad','?cursor=1&cursor=2','?limit=2','?cursor=']) assert.equal((await req('/api/admin/streamers'+q,admin)).status,400);
});
test('usage exposes only current UTC login admission aggregate to admin',async()=>{
 const day=Math.floor(Date.now()/86400000);assert.equal((await mf.dispatchFetch(origin+'/auth/login',{redirect:'manual'})).status,302);
 let r=await req('/api/admin/usage',unknown);assert.equal(r.status,403);
 r=await req('/api/admin/usage',admin);assert.equal(r.status,200);assert.deepEqual(await r.json(),{utc_day:day,login_starts:1,scope:'admitted_login_starts'});
 assert.equal((await req('/api/admin/usage?x=1',admin)).status,400);
});
test('administrator role never grants access to another private environment',async()=>{
 assert.equal((await req('/api/environment?owner=200',admin)).status,403);
 assert.equal((await req('/api/admin/streamers/100',admin,'PUT',{status:'approved',version:0})).status,200);
 assert.deepEqual(await (await req('/api/environment?owner=200',admin)).json(),{value:'',version:0});
 assert.equal((await req('/api/environment',admin,'PUT',{value:'forged',version:0,owner_id:'200'})).status,400);
 assert.equal((await req('/api/environment',admin,'PUT',{value:'own',version:0})).status,200);
 assert.deepEqual(await (await req('/api/environment',streamer)).json(),{value:'private',version:1});
 assert.equal((await req('/api/admin/streamers/100',streamer,'PUT',{status:'disabled',version:1})).status,403);
});
test('missing or malformed administrator configuration fails closed',async()=>{
 for(const id of [undefined,'not-a-discord-id']){
  const bindings={ORIGIN:origin,...(id===undefined?{}:{ADMIN_DISCORD_ID:id})};
  const instance=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:process.env.WUWA_TEST_BUNDLE||'dist/index.js',compatibilityDate:'2026-07-30',d1Databases:['DB'],bindings}));
  try{const d=await instance.getD1Database('DB');for(const f of ['migrations/0001_init.sql','migrations/0002_login_budget.sql','migrations/0003_streamer_status.sql']) for(const sql of (await readFile(f,'utf8')).split(';').map(x=>x.trim()).filter(Boolean)) await d.prepare(sql).run();await d.prepare('INSERT INTO sessions VALUES (?,?,?,?)').bind(digest('a'.repeat(64)),'100',digest('f'.repeat(64)),Math.floor(Date.now()/1000)+300).run();
   assert.equal((await instance.dispatchFetch(origin+'/api/admin/streamers',{headers:admin})).status,403);const session=await instance.dispatchFetch(origin+'/api/session',{headers:admin});assert.equal((await session.json()).admin,false);
  }finally{await instance.dispose();}
 }
});
after(()=>mf.dispose());
