import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile,readdir,mkdtemp,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {createHash,randomUUID} from 'node:crypto';import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
test('graceful restart resumes an acknowledged cancellation cursor',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'cancel-restart-')),origin='http://127.0.0.1:19820',id=randomUUID();
 const start=()=>new Miniflare({...convertV4MiniflareOptions({port:19820,host:'127.0.0.1',modules:true,scriptPath:'dist/index.js',compatibilityDate:'2026-07-30',d1Databases:['DB'],bindings:{ORIGIN:origin}}),resourcePersistencePath:dir});let mf=start();
 try{
  const db=await mf.getD1Database('DB');for(const f of (await readdir('migrations')).sort())for(const q of (await readFile('migrations/'+f,'utf8')).split(/;\s*(?=(?:CREATE|ALTER|INSERT|UPDATE|DROP|$))/i).map(x=>x.trim()).filter(Boolean))await db.prepare(q).run();
  const hash=x=>createHash('sha256').update(x).digest('hex'),sid='a'.repeat(64),csrf='f'.repeat(64);await db.prepare("INSERT INTO approved_streamers(user_id) VALUES ('260')").run();await db.prepare('INSERT INTO sessions VALUES (?,?,?,unixepoch()+3600)').bind(hash(sid),'260',hash(csrf)).run();
  const ids=Array.from({length:1101},(_,i)=>String(10000+i));await db.prepare("INSERT INTO viewer_scores(owner_id,viewer_id,score) SELECT '260',value,5 FROM json_each(?)").bind(JSON.stringify(ids)).run();
  const headers={Cookie:`__Host-session=${sid}`,Origin:origin,'X-CSRF-Token':csrf,'Content-Type':'application/json'},send=(path,body)=>mf.dispatchFetch(origin+path,{method:'PUT',headers,body:JSON.stringify(body)});
  assert.equal((await send(`/api/activities/${id}`,{rule_version:1,expected_generation:0,guild_id:null})).status,201);
  await db.prepare("INSERT INTO draws(id,activity_id,owner_id,request_key,rule_version,winner_id,winner_ordinal,created_at) SELECT 'd'||key,?,'260','k'||key,1,value,CAST(key AS INTEGER)+1,1 FROM json_each(?)").bind(id,JSON.stringify(ids)).run();await db.prepare("UPDATE viewer_scores SET score=0 WHERE owner_id='260'").run();
  assert.equal((await send(`/api/activities/${id}/cancellations/one`,{rule_version:1})).status,202);
  assert.equal((await db.prepare('SELECT cursor FROM activity_cancellations WHERE activity_id=?').bind(id).first()).cursor,'10999');await mf.dispose();mf=start();
  assert.equal((await send(`/api/activities/${id}/cancellations/two`,{rule_version:1})).status,200);const db2=await mf.getD1Database('DB');assert.equal((await db2.prepare("SELECT count(*) n FROM viewer_scores WHERE owner_id='260' AND score<>5").first()).n,0);assert.equal((await db2.prepare('SELECT status FROM activities WHERE id=?').bind(id).first()).status,'cancelled');
 }finally{await mf.dispose();await rm(dir,{recursive:true,force:true});}
});
