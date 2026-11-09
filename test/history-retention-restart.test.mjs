import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
test('a committed cleanup survives graceful restart and a failed next activity resumes',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'retention-restart-')),origin='http://127.0.0.1:19942',ids=[randomUUID(),randomUUID()].sort();
 const start=()=>new Miniflare({...convertV4MiniflareOptions({port:19942,host:'127.0.0.1',modules:true,scriptPath:'dist/index.js',compatibilityDate:'2026-07-30',d1Databases:['DB'],bindings:{ORIGIN:origin,ADMIN_DISCORD_ID:'999'}}),resourcePersistencePath:dir});
 let mf=start();
 try{
  let db=await mf.getD1Database('DB');
  for(const f of (await readdir('migrations')).sort())for(const q of (await readFile('migrations/'+f,'utf8')).split(/;\s*(?=(?:CREATE|ALTER|INSERT|UPDATE|DROP|$))/i).map(x=>x.trim()).filter(Boolean))await db.prepare(q).run();
  const hash=x=>createHash('sha256').update(x).digest('hex'),sid='a'.repeat(64),csrf='f'.repeat(64);
  await db.prepare("INSERT INTO approved_streamers(user_id) VALUES ('200')").run();
  await db.prepare('INSERT INTO sessions VALUES (?,?,?,unixepoch()+3600)').bind(hash(sid),'999',hash(csrf)).run();
  for(const id of ids){await db.prepare("INSERT INTO activities(id,owner_id,status,rule_version,created_at) VALUES (?,'200','settled',1,1)").bind(id).run();await db.prepare("INSERT INTO activity_settlements VALUES (?,'200','',0,1)").bind(id).run();await db.prepare("INSERT INTO registrations(activity_id,owner_id,viewer_id,ordinal) VALUES (?,'200','300',1)").bind(id).run();}
  const headers={Cookie:`__Host-session=${sid}`,Origin:origin,'X-CSRF-Token':csrf,'Content-Type':'application/json'};
  const send=()=>mf.dispatchFetch(origin+'/api/admin/history-retention',{method:'POST',headers,body:JSON.stringify({owner_id:'200',dry_run:false})});
  let result=await send();assert.equal(result.status,200);assert.deepEqual(await result.json(),{owner_id:'200',eligible:1,deleted:1,has_more:true,dry_run:false});
  await db.prepare("CREATE TRIGGER retention_restart_fail BEFORE DELETE ON registrations BEGIN SELECT RAISE(ABORT,'fixture'); END").run();
  assert.equal((await send()).status,500);await mf.dispose();mf=start();db=await mf.getD1Database('DB');
  assert.equal((await db.prepare('SELECT count(*) n FROM activity_tombstones').first()).n,1);
  assert.equal((await db.prepare('SELECT count(*) n FROM registrations').first()).n,1);
  await db.prepare('DROP TRIGGER retention_restart_fail').run();result=await send();assert.equal(result.status,200);assert.equal((await result.json()).deleted,1);
  assert.equal((await db.prepare('SELECT count(*) n FROM activity_tombstones').first()).n,2);
  assert.equal((await (await send()).json()).deleted,0);
 }finally{await mf.dispose();await rm(dir,{recursive:true,force:true});}
});
test('a partially cleaned large activity resumes after graceful runtime restart',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'retention-page-restart-')),origin='http://127.0.0.1:19944',id=randomUUID();
 const start=()=>new Miniflare({...convertV4MiniflareOptions({port:19944,host:'127.0.0.1',modules:true,scriptPath:'dist/index.js',compatibilityDate:'2026-07-30',d1Databases:['DB'],bindings:{ORIGIN:origin,ADMIN_DISCORD_ID:'999'}}),resourcePersistencePath:dir});
 let mf=start();
 try{
  let db=await mf.getD1Database('DB');for(const f of (await readdir('migrations')).sort())for(const q of (await readFile('migrations/'+f,'utf8')).split(/;\s*(?=(?:CREATE|ALTER|INSERT|UPDATE|DROP|$))/i).map(x=>x.trim()).filter(Boolean))await db.prepare(q).run();
  const hash=x=>createHash('sha256').update(x).digest('hex'),sid='a'.repeat(64),csrf='f'.repeat(64);
  await db.prepare("INSERT INTO approved_streamers(user_id) VALUES ('200')").run();
  await db.prepare('INSERT INTO sessions VALUES (?,?,?,unixepoch()+3600)').bind(hash(sid),'999',hash(csrf)).run();
  await db.prepare("INSERT INTO activities(id,owner_id,status,rule_version,created_at) VALUES (?,'200','settled',1,1)").bind(id).run();
  await db.prepare("INSERT INTO activity_settlements VALUES (?,'200','',0,1)").bind(id).run();
  const viewers=Array.from({length:205},(_,i)=>String(10000+i));
  await db.prepare("INSERT INTO registrations(activity_id,owner_id,viewer_id,ordinal) SELECT ?,'200',value,CAST(key AS INTEGER)+1 FROM json_each(?)").bind(id,JSON.stringify(viewers)).run();
  const headers={Cookie:`__Host-session=${sid}`,Origin:origin,'X-CSRF-Token':csrf,'Content-Type':'application/json'},send=()=>mf.dispatchFetch(origin+'/api/admin/history-retention',{method:'POST',headers,body:JSON.stringify({owner_id:'200',dry_run:false})});
  assert.equal((await (await send()).json()).deleted,0);assert.equal((await db.prepare('SELECT count(*) n FROM registrations').first()).n,105);
  await mf.dispose();mf=start();db=await mf.getD1Database('DB');
  assert.equal((await db.prepare('SELECT count(*) n FROM activity_tombstones WHERE id=?').bind(id).first()).n,1);
  assert.equal((await (await send()).json()).deleted,0);assert.equal((await db.prepare('SELECT count(*) n FROM registrations').first()).n,5);
  assert.equal((await (await send()).json()).deleted,1);assert.equal((await (await send()).json()).deleted,0);
 }finally{await mf.dispose();await rm(dir,{recursive:true,force:true});}
});
