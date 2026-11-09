import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
test('graceful restart retains the persisted idempotent result',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'wuwa-draw-restart-')),origin='http://127.0.0.1:19645',id='ffffffff-ffff-4fff-8fff-ffffffffffff';
 const start=()=>new Miniflare({...convertV4MiniflareOptions({port:19645,host:'127.0.0.1',modules:true,scriptPath:'dist/index.js',compatibilityDate:'2026-07-30',d1Databases:['DB'],bindings:{ORIGIN:origin}}),resourcePersistencePath:dir});
 let mf=start();
 try {
  const db=await mf.getD1Database('DB');for(const f of (await readdir('migrations')).sort())for(const q of (await readFile('migrations/'+f,'utf8')).split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(q).run();
  const hash=x=>createHash('sha256').update(x).digest('hex'),sid='a'.repeat(64),csrf='f'.repeat(64);await db.prepare("INSERT INTO approved_streamers(user_id) VALUES ('220')").run();await db.prepare("INSERT INTO activities(id,owner_id,status,rule_version,created_at) VALUES (?,'220','open',1,1)").bind(id).run();await db.prepare("INSERT INTO registrations(activity_id,owner_id,viewer_id,ordinal) VALUES (?,'220','800',1),(?,'220','801',2)").bind(id,id).run();await db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').bind(hash(sid),'220',hash(csrf),Math.floor(Date.now()/1000)+300).run();
  const headers={Cookie:`__Host-session=${sid}`,Origin:origin,'X-CSRF-Token':csrf,'Content-Type':'application/json'},path=`${origin}/api/activities/${id}/draws/key`;
  const send=()=>mf.dispatchFetch(path,{method:'PUT',headers,body:JSON.stringify({rule_version:1})});const first=await send();assert.equal(first.status,200);const value=await first.json();await mf.dispose();mf=start();const retry=await send();assert.equal(retry.status,200);assert.deepEqual(await retry.json(),value);const db2=await mf.getD1Database('DB');assert.equal((await db2.prepare('SELECT count(*) AS n FROM draws').first()).n,1);
 }finally{await mf.dispose();await rm(dir,{recursive:true,force:true});}
});
