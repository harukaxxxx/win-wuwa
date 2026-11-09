import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
test('migration preserves existing history, scores and unknown terminal completion',async()=>{
 const mf=new Miniflare(convertV4MiniflareOptions({port:19943,host:'127.0.0.1',modules:true,scriptPath:'dist/index.js',compatibilityDate:'2026-07-30',d1Databases:['DB']}));
 try{
  const db=await mf.getD1Database('DB'),files=(await readdir('migrations')).sort();
  const apply=async f=>{for(const q of (await readFile('migrations/'+f,'utf8')).split(/;\s*(?=(?:CREATE|ALTER|INSERT|UPDATE|DROP|$))/i).map(x=>x.trim()).filter(Boolean))await db.prepare(q).run();};
  for(const f of files.filter(x=>x<'0018'))await apply(f);
  const id=randomUUID();await db.prepare("INSERT INTO approved_streamers(user_id) VALUES ('1'),('2')").run();
  await db.prepare("INSERT INTO viewer_scores VALUES ('1','3',7),('2','3',9)").run();
  await db.prepare("INSERT INTO activities(id,owner_id,status,rule_version,created_at) VALUES (?,'1','settled',1,1)").bind(id).run();
  await db.prepare("INSERT INTO registrations(activity_id,owner_id,viewer_id,ordinal,display_name_snapshot) VALUES (?,'1','3',1,'private')").bind(id).run();
  await db.prepare("INSERT INTO discord_identities VALUES ('3','display','username')").run();
  await db.prepare("INSERT INTO activity_defaults(owner_id,guild_id,version) VALUES ('1','123',1)").run();
  const tables=['approved_streamers','viewer_scores','activities','registrations','discord_identities','activity_defaults','activity_settlements','activity_cancellations'];
  const snapshot=async()=>Promise.all(tables.map(async t=>(await db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()).results));
  const before=await snapshot();await apply('0018_history_retention.sql');assert.deepEqual(await snapshot(),before);
  assert.equal((await db.prepare('SELECT count(*) n FROM activity_tombstones').first()).n,0);
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
 }finally{await mf.dispose();}
});
