import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
test('generation migration preserves existing activities, baseline and owner history',async()=>{
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:'dist/index.js',compatibilityDate:'2026-07-30',d1Databases:['DB']}));
 try {
  const db=await mf.getD1Database('DB');
  async function migrate(file){for(const q of (await readFile(file,'utf8')).split(';').map(x=>x.trim()).filter(Boolean))await db.prepare(q).run();}
  for(const f of ['0001_init','0002_login_budget','0003_streamer_status','0004_activities'])await migrate(`migrations/${f}.sql`);
  await db.prepare("INSERT INTO approved_streamers(user_id) VALUES ('1'),('2')").run();
  await db.prepare("INSERT INTO activities VALUES ('a','1','cancelled',1,'123',42),('b','1','open',1,NULL,43)").run();
  await db.prepare("INSERT INTO activity_score_baselines VALUES ('b','1','viewer',7)").run();
  await migrate('migrations/0005_opening_generation.sql');
  await migrate('migrations/0006_activity_defaults.sql');
  assert.deepEqual((await db.prepare('SELECT id,status,guild_id,created_at,expected_generation FROM activities ORDER BY id').all()).results,[{id:'a',status:'cancelled',guild_id:'123',created_at:42,expected_generation:0},{id:'b',status:'open',guild_id:null,created_at:43,expected_generation:0}]);
  assert.deepEqual((await db.prepare('SELECT * FROM activity_score_baselines').all()).results,[{activity_id:'b',owner_id:'1',viewer_id:'viewer',score:7}]);
  assert.deepEqual((await db.prepare('SELECT * FROM activity_opening_generations').all()).results,[{owner_id:'1',generation:2}]);
  assert.deepEqual((await db.prepare('SELECT * FROM activity_defaults').all()).results,[]);
  await db.prepare("INSERT INTO activity_defaults(owner_id,guild_id,version) VALUES ('1','123',2)").run();
  await migrate('migrations/0010_guild_invite.sql');
  assert.deepEqual((await db.prepare('SELECT id,guild_id,guild_invite_url FROM activities ORDER BY id').all()).results,[{id:'a',guild_id:'123',guild_invite_url:null},{id:'b',guild_id:null,guild_invite_url:null}]);
  assert.deepEqual(await db.prepare('SELECT guild_id,guild_invite_url,version FROM activity_defaults WHERE owner_id=?').bind('1').first(),{guild_id:'123',guild_invite_url:null,version:2});
 } finally {await mf.dispose();}
});
