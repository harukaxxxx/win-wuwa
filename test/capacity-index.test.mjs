import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

test('settlement registration lookup uses page IDs as indexed probes',async()=>{
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-07-30',d1Databases:['DB']}));
 try {
  const db=await mf.getD1Database('DB');
  for(const f of (await readdir('migrations')).sort())for(const sql of (await readFile('migrations/'+f,'utf8')).split(/;\s*(?=(?:CREATE|ALTER|INSERT|UPDATE|DROP|$))/i).map(x=>x.trim()).filter(Boolean))await db.prepare(sql).run();
  const source=await readFile('src/settlement.ts','utf8');
  const match=source.match(/db\.prepare\(`(INSERT INTO viewer_scores\(owner_id,viewer_id,score\).*?)`\)/s);
  assert.ok(match,'actual settlement statement must be found');
  const sql=match[1].replace('${liveSession}','1');
  const args=Array.from({length:(sql.match(/\?/g)||[]).length},()=> '');
  const plan=(await db.prepare('EXPLAIN QUERY PLAN '+sql).bind(...args).all()).results.map(x=>x.detail);
  assert.ok(plan.some(x=>/SEARCH r USING INDEX sqlite_autoindex_registrations_1 \(activity_id=\? AND viewer_id=\?\)/.test(x)),JSON.stringify(plan));
 }finally{await mf.dispose();}
});

test('candidate migration preserves snapshots and halves per-row local D1 writes',async()=>{
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-07-30',d1Databases:['DB']}));
 try {
  const db=await mf.getD1Database('DB');
  const files=(await readdir('migrations')).sort().filter(x=>x.endsWith('.sql'));
  const apply=async file=>{for(const sql of (await readFile('migrations/'+file,'utf8')).split(/;\s*(?=(?:CREATE|ALTER|INSERT|UPDATE|DROP|$))/i).map(x=>x.trim()).filter(Boolean))await db.prepare(sql).run();};
  for(const f of files.filter(x=>x<'0019'))await apply(f);
  await db.prepare("INSERT INTO approved_streamers(user_id) VALUES ('o')").run();
  await db.prepare("INSERT INTO activities(id,owner_id,status,rule_version,created_at) VALUES ('a','o','open',1,1)").run();
  await db.prepare("INSERT INTO draws(id,activity_id,owner_id,request_key,rule_version,winner_id,winner_ordinal,created_at) VALUES ('d','a','o','k',1,'v',1,1)").run();
  await db.prepare("INSERT INTO draw_candidates SELECT 'd',printf('v%05d',value),value,value%11,2.5,0.125 FROM json_each(?)").bind(JSON.stringify(Array.from({length:49050},(_,i)=>i))).run();
  const before=(await db.prepare('SELECT * FROM draw_candidates ORDER BY draw_id,viewer_id').all()).results;
  assert.ok(files.includes('0019_candidate_storage.sql'),'migration is required');
  await apply('0019_candidate_storage.sql');
  assert.deepEqual((await db.prepare('SELECT * FROM draw_candidates ORDER BY draw_id,viewer_id').all()).results,before);
  const result=await db.prepare("INSERT INTO draw_candidates VALUES ('d','v2',8,5,1.5,0.25)").run();
  assert.equal(result.meta.rows_written,1);
  await assert.rejects(db.prepare("INSERT INTO draw_candidates VALUES ('d','v2',8,5,1.5,0.25)").run());
  await assert.rejects(db.prepare("INSERT INTO draw_candidates VALUES ('missing','v3',8,5,1.5,0.25)").run());
 }finally{await mf.dispose();}
});
