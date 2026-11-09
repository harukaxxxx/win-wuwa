import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile,readdir,mkdtemp,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {createHash,randomUUID} from 'node:crypto';import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
test('graceful restart resumes acknowledged settling cursor',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'settlement-restart-')),origin='http://127.0.0.1:19772',id=randomUUID();
 const start=()=>new Miniflare({...convertV4MiniflareOptions({port:19772,host:'127.0.0.1',modules:true,scriptPath:'dist/index.js',compatibilityDate:'2026-07-30',d1Databases:['DB'],bindings:{ORIGIN:origin}}),resourcePersistencePath:dir});let mf=start();
 try{
  const db=await mf.getD1Database('DB');for(const f of (await readdir('migrations')).sort())for(const q of (await readFile('migrations/'+f,'utf8')).split(';').map(x=>x.trim()).filter(Boolean))await db.prepare(q).run();
  const hash=x=>createHash('sha256').update(x).digest('hex'),sid='a'.repeat(64),csrf='f'.repeat(64);await db.prepare("INSERT INTO approved_streamers(user_id) VALUES ('260')").run();await db.prepare("INSERT INTO activities(id,owner_id,status,rule_version,created_at) VALUES (?,'260','open',1,1)").bind(id).run();await db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').bind(hash(sid),'260',hash(csrf),Math.floor(Date.now()/1000)+3600).run();
  const ids=Array.from({length:1101},(_,i)=>String(10000+i));await db.prepare("INSERT INTO viewer_scores(owner_id,viewer_id,score) SELECT '260',value,5 FROM json_each(?)").bind(JSON.stringify(ids)).run();await db.prepare("INSERT INTO registrations(activity_id,owner_id,viewer_id,ordinal) VALUES (?,'260','99999',1)").bind(id).run();
  const headers={Cookie:`__Host-session=${sid}`,Origin:origin,'X-CSRF-Token':csrf,'Content-Type':'application/json'},send=(path)=>mf.dispatchFetch(origin+path,{method:'PUT',headers,body:JSON.stringify({rule_version:1})});
  assert.equal((await send(`/api/activities/${id}/draws/one`)).status,200);assert.equal((await send(`/api/activities/${id}/settlements/one`)).status,202);
  const cursor=(await db.prepare('SELECT cursor FROM activity_settlements WHERE activity_id=?').bind(id).first()).cursor;assert.notEqual(cursor,'');await mf.dispose();mf=start();
  assert.equal((await send(`/api/activities/${id}/settlements/two`)).status,200);const db2=await mf.getD1Database('DB');assert.equal((await db2.prepare("SELECT count(*) AS n FROM viewer_scores WHERE owner_id='260' AND viewer_id<>'99999' AND score<>4").first()).n,0);assert.equal((await db2.prepare('SELECT status FROM activities WHERE id=?').bind(id).first()).status,'settled');
 }finally{await mf.dispose();await rm(dir,{recursive:true,force:true});}
});
