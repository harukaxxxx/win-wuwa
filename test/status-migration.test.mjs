import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

test('0011 preserves every 0010 row and initializes status versions',async()=>{
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:'dist/index.js',compatibilityDate:'2026-07-30',d1Databases:['DB']}));
 try{
  const db=await mf.getD1Database('DB');
  const migrate=async file=>{for(const sql of (await readFile(`migrations/${file}`,'utf8')).split(';').map(x=>x.trim()).filter(Boolean))await db.prepare(sql).run();};
  for(const file of (await readdir('migrations')).sort().filter(f=>f<'0011'))await migrate(file);
  await db.prepare("INSERT INTO approved_streamers(user_id) VALUES ('1'),('2')").run();
  await db.prepare("INSERT INTO activities(id,owner_id,status,rule_version,guild_id,created_at,expected_generation,guild_invite_url) VALUES ('a','1','open',1,'123',42,3,'https://discord.gg/abc'),('b','2','paused',1,NULL,43,4,NULL)").run();
  await db.prepare("INSERT INTO registrations VALUES ('a','1','v1',1,'registered'),('a','1','v2',2,'withdrawn'),('b','2','v3',1,'registered')").run();
  await db.prepare("INSERT INTO activity_defaults VALUES ('1','123',4,'https://discord.gg/abc'),('2',NULL,2,NULL)").run();
  await db.prepare("INSERT INTO guild_membership_proofs VALUES ('hash','v1','1','a',1,'123','member',NULL,9999999999)").run();
  await db.prepare("INSERT INTO viewer_scores VALUES ('1','v1',7)").run();
  await db.prepare("INSERT INTO activity_score_baselines VALUES ('a','1','v1',6)").run();
  const tables=['activities','registrations','activity_defaults','guild_membership_proofs','viewer_scores','activity_score_baselines','activity_opening_generations'];
  const snapshot=async()=>Object.fromEntries(await Promise.all(tables.map(async table=>[table,(await db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results])));
  const before=await snapshot(); await migrate('0011_activity_status_version.sql'); const after=await snapshot();
  assert.deepEqual(after.activities.map(({status_version,...row})=>row),before.activities);
  assert.deepEqual(after.activities.map(row=>row.status_version),[0,0]);
  for(const table of tables.slice(1))assert.deepEqual(after[table],before[table],table);
  await assert.rejects(db.prepare("UPDATE activities SET status_version=-1 WHERE id='a'").run());
 }finally{await mf.dispose();}
});
