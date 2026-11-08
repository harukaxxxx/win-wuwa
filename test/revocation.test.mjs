import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import worker from '../dist/index.js';

test('real D1 revocation between approval read and insert cannot write',async()=>{
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:'dist/index.js',compatibilityDate:'2026-07-30',d1Databases:['DB']}));
 try {
  const db=await mf.getD1Database('DB');
  for(const file of ['migrations/0001_init.sql','migrations/0002_login_budget.sql']) for(const q of (await readFile(file,'utf8')).split(';').map(x=>x.trim()).filter(Boolean)) await db.prepare(q).run();
  const sid='d'.repeat(64),csrf='e'.repeat(64),hash=x=>createHash('sha256').update(x).digest('hex');
  await db.prepare('INSERT INTO approved_streamers VALUES (?)').bind('77').run();
  await db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').bind(hash(sid),'77',hash(csrf),Math.floor(Date.now()/1000)+300).run();
  let revoked=false;
  const wrapped={prepare(sql){const stmt=db.prepare(sql); if(sql!=='SELECT user_id FROM approved_streamers WHERE user_id=?') return stmt; return {bind(...args){const bound=stmt.bind(...args); return {async first(){const row=await bound.first(); await db.prepare('DELETE FROM approved_streamers WHERE user_id=?').bind('77').run(); revoked=true; return row;}}}};}};
  const req=new Request('http://localhost/api/environment',{method:'PUT',headers:{Cookie:`__Host-session=${sid}`,Origin:'http://localhost','X-CSRF-Token':csrf,'Content-Type':'application/json'},body:JSON.stringify({value:'forbidden',version:0})});
  const response=await worker.fetch(req,{DB:wrapped,ORIGIN:'http://localhost'});
  assert.equal(revoked,true); assert.equal(response.status,409); assert.equal(await db.prepare('SELECT * FROM environments WHERE owner_id=?').bind('77').first(),null);
 } finally {await mf.dispose();}
});

test('real D1 revocation between approval read and update preserves value and version',async()=>{
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:'dist/index.js',compatibilityDate:'2026-07-30',d1Databases:['DB']}));
 try {
  const db=await mf.getD1Database('DB');
  // Test-only schema permits the otherwise FK-blocked revocation interleaving.
  for(const file of ['migrations/0001_init.sql','migrations/0002_login_budget.sql']) for(const q of (await readFile(file,'utf8')).replace(' REFERENCES approved_streamers(user_id)','').split(';').map(x=>x.trim()).filter(Boolean)) await db.prepare(q).run();
  const sid='d'.repeat(64),csrf='e'.repeat(64),hash=x=>createHash('sha256').update(x).digest('hex');
  await db.prepare('INSERT INTO approved_streamers VALUES (?)').bind('77').run();
  await db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').bind(hash(sid),'77',hash(csrf),Math.floor(Date.now()/1000)+300).run();
  await db.prepare('INSERT INTO environments VALUES (?,?,?)').bind('77','original',2).run();
  let revoked=false;
  const wrapped={prepare(sql){const stmt=db.prepare(sql); if(sql!=='SELECT user_id FROM approved_streamers WHERE user_id=?') return stmt; return {bind(...args){const bound=stmt.bind(...args); return {async first(){const row=await bound.first(); await db.prepare('DELETE FROM approved_streamers WHERE user_id=?').bind('77').run(); revoked=true; return row;}}}};}};
  const req=new Request('http://localhost/api/environment',{method:'PUT',headers:{Cookie:`__Host-session=${sid}`,Origin:'http://localhost','X-CSRF-Token':csrf,'Content-Type':'application/json'},body:JSON.stringify({value:'forbidden',version:2})});
  const response=await worker.fetch(req,{DB:wrapped,ORIGIN:'http://localhost'});
  assert.equal(revoked,true); assert.equal(response.status,409);
  assert.deepEqual(await db.prepare('SELECT value,version FROM environments WHERE owner_id=?').bind('77').first(),{value:'original',version:2});
 } finally {await mf.dispose();}
});
