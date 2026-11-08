import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

test('graceful runtime recreation preserves commits and stale retry conflicts', async()=>{
 const dir=await mkdtemp(join(process.env.TMPDIR,'wuwa-d1-')); let mf;
 const origin='http://localhost', sid='a'.repeat(64), csrf='b'.repeat(64), digest=x=>createHash('sha256').update(x).digest('hex');
 const make=()=>new Miniflare({...convertV4MiniflareOptions({modules:true,scriptPath:'dist/index.js',compatibilityDate:'2026-07-30',d1Databases:['DB'],bindings:{ORIGIN:origin}}),resourcePersistencePath:dir});
 try {
  mf=make(); let db=await mf.getD1Database('DB');
  for(const f of ['migrations/0001_init.sql','migrations/0002_login_budget.sql','migrations/0003_streamer_status.sql']) for(const q of (await readFile(f,'utf8')).split(';').map(x=>x.trim()).filter(Boolean)) await db.prepare(q).run();
  await db.prepare('INSERT INTO approved_streamers(user_id) VALUES (?)').bind('10').run();
  await db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').bind(digest(sid),'10',digest(csrf),Math.floor(Date.now()/1000)+300).run();
  const headers={Cookie:`__Host-session=${sid}`,Origin:origin,'X-CSRF-Token':csrf,'Content-Type':'application/json'};
  const put=(v,version)=>mf.dispatchFetch(origin+'/api/environment',{method:'PUT',headers,body:JSON.stringify({value:v,version})});
  assert.equal((await put('saved',0)).status,200);
  await mf.dispose(); mf=make(); db=await mf.getD1Database('DB');
  assert.deepEqual(await db.prepare('SELECT value,version FROM environments WHERE owner_id=?').bind('10').first(),{value:'saved',version:1});
  assert.equal((await put('stale',0)).status,409);
  assert.deepEqual(await db.prepare('SELECT value,version FROM environments WHERE owner_id=?').bind('10').first(),{value:'saved',version:1});
  assert.equal((await put('next',1)).status,200);
  await mf.dispose(); mf=make(); db=await mf.getD1Database('DB');
  assert.deepEqual(await db.prepare('SELECT value,version FROM environments WHERE owner_id=?').bind('10').first(),{value:'next',version:2});
 } finally { if(mf) await mf.dispose(); await rm(dir,{recursive:true,force:true}); }
});
