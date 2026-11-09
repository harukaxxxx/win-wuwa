import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
const origin='http://127.0.0.1:19941';
const mf=new Miniflare(convertV4MiniflareOptions({port:19941,host:'127.0.0.1',modules:true,scriptPath:'dist/index.js',compatibilityDate:'2026-07-30',d1Databases:['DB'],bindings:{ORIGIN:origin,ADMIN_DISCORD_ID:'999'}}));
const db=await mf.getD1Database('DB');
for(const f of (await readdir('migrations')).sort()) for(const sql of (await readFile('migrations/'+f,'utf8')).split(/;\s*(?=(?:CREATE|ALTER|INSERT|UPDATE|DROP|$))/i).map(x=>x.trim()).filter(Boolean)) await db.prepare(sql).run();
const hash=x=>createHash('sha256').update(x).digest('hex');let seq=0;
async function identity(id){const sid=(++seq).toString(16).padStart(64,'0'),csrf='f'.repeat(64);await db.prepare('INSERT INTO sessions VALUES (?,?,?,unixepoch()+3600)').bind(hash(sid),id,hash(csrf)).run();return {Cookie:`__Host-session=${sid}`,Origin:origin,'X-CSRF-Token':csrf,'Content-Type':'application/json'};}
const req=async(path,h,method='GET',body)=>{await mf.ready;return fetch(origin+path,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)});};
const op=(h,owner,dry_run=false)=>req('/api/admin/history-retention',h,'POST',{owner_id:owner,dry_run});
test('only admin may atomically purge expired finished history; terminal fences and scores survive',async()=>{
 await db.prepare("INSERT INTO approved_streamers(user_id) VALUES ('200'),('201')").run();
 const admin=await identity('999'),owner=await identity('200'),viewer=await identity('300'),other=await identity('201');
 const id=randomUUID();
 await db.prepare("INSERT INTO viewer_scores VALUES ('200','300',7),('201','300',9)").run();
 assert.equal((await req(`/api/activities/${id}`,owner,'PUT',{expected_generation:0,guild_id:null,rule_version:1})).status,201);
 assert.equal((await req('/api/viewer/200/register',viewer,'POST',{activity_id:id,rule_version:1})).status,200);
 assert.equal((await req(`/api/activities/${id}/draws/one`,owner,'PUT',{rule_version:1})).status,200);
 assert.equal((await req(`/api/activities/${id}/settlements/one`,owner,'PUT',{rule_version:1})).status,200);
 await db.prepare('UPDATE activity_settlements SET completed_at=unixepoch()-7776001 WHERE activity_id=?').bind(id).run();
 assert.equal((await op(owner,'200')).status,403);
 assert.equal((await op(other,'200')).status,403);
 assert.equal((await op({},'200')).status,401);
 assert.equal((await op({...admin,Origin:'https://evil.invalid'},'200')).status,403);
 const dry=await op(admin,'200',true);assert.equal(dry.status,200);assert.equal((await dry.json()).eligible,1);
 assert.equal((await db.prepare('SELECT count(*) n FROM registrations WHERE activity_id=?').bind(id).first()).n,1);
 await db.prepare("CREATE TRIGGER retention_fail BEFORE DELETE ON registrations BEGIN SELECT RAISE(ABORT,'injected'); END").run();
 assert.equal((await op(admin,'200')).status,500);
 assert.equal((await db.prepare('SELECT count(*) n FROM draw_candidates').first()).n,1);
 assert.equal((await db.prepare('SELECT count(*) n FROM activity_tombstones').first()).n,0);
 await db.prepare('DROP TRIGGER retention_fail').run();
 const result=await op(admin,'200');assert.equal(result.status,200);assert.equal((await result.json()).deleted,1);
 assert.equal((await db.prepare('SELECT count(*) n FROM registrations WHERE activity_id=?').bind(id).first()).n,0);
 assert.equal((await db.prepare('SELECT count(*) n FROM draw_candidates').first()).n,0);
 assert.equal((await db.prepare('SELECT count(*) n FROM activities WHERE id=?').bind(id).first()).n,0);
 assert.deepEqual((await db.prepare('SELECT owner_id,viewer_id,score FROM viewer_scores ORDER BY owner_id').all()).results,[{owner_id:'200',viewer_id:'300',score:0},{owner_id:'201',viewer_id:'300',score:9}]);
 assert.equal((await op(admin,'200')).status,200);assert.equal((await (await op(admin,'200')).json()).deleted,0);
 const next=randomUUID();assert.equal((await req(`/api/activities/${next}`,owner,'PUT',{expected_generation:1,guild_id:null,rule_version:1})).status,201);
 assert.equal((await req(`/api/activities/${id}`,owner,'PUT',{expected_generation:0,guild_id:null,rule_version:1})).status,409);
 assert.equal((await req(`/api/activities/${id}`,other,'PUT',{expected_generation:0,guild_id:null,rule_version:1})).status,409);
 assert.equal((await req(`/api/activities/${id}/settlements/one`,owner,'PUT',{rule_version:1})).status,404);
 assert.equal((await req(`/api/activities/${id}/cancellations/one`,owner,'PUT',{rule_version:1})).status,404);
 assert.equal((await req(`/api/activities/${id}/draws/one`,owner,'PUT',{rule_version:1})).status,409);
 assert.equal((await req('/api/viewer/200/register',viewer,'POST',{activity_id:id,rule_version:1})).status,409);
 assert.equal((await db.prepare('SELECT status FROM activities WHERE id=?').bind(next).first()).status,'open');
 assert.deepEqual((await db.prepare('SELECT owner_id,viewer_id,score FROM viewer_scores ORDER BY owner_id').all()).results,[{owner_id:'200',viewer_id:'300',score:0},{owner_id:'201',viewer_id:'300',score:9}]);
});
test('retention boundary, unknown completion and in-progress states are protected',async()=>{
 const admin=await identity('999');
 const owners=['210','211','212','213','214','215','216','217'];
 for(const owner of owners)await db.prepare('INSERT INTO approved_streamers(user_id) VALUES (?)').bind(owner).run();
 const ids=owners.map(()=>randomUUID());
 for(let i=0;i<ids.length;i++){
  const status=['settled','cancelled','settled','cancelled','open','paused','settling','cancelling'][i];
  await db.prepare('INSERT INTO activities(id,owner_id,status,rule_version,created_at) VALUES (?,?,?,1,1)').bind(ids[i],owners[i],status).run();
 }
 // Dates are synthetic completed-journal fixtures, not invented migration backfills.
 await db.prepare('INSERT INTO activity_settlements(activity_id,owner_id,has_draw,completed_at) VALUES (?,?,0,unixepoch()-7689600),(?,?,0,NULL),(?,?,0,1)').bind(ids[0],owners[0],ids[2],owners[2],ids[6],owners[6]).run();
 await db.prepare('INSERT INTO activity_cancellations(activity_id,owner_id,completed_at) VALUES (?,?,unixepoch()-7776001),(?,?,NULL),(?,?,1)').bind(ids[1],owners[1],ids[3],owners[3],ids[7],owners[7]).run();
 for(const i of [0,2,3,4,5,6,7])assert.equal((await (await op(admin,owners[i],true)).json()).eligible,0);
 assert.equal((await (await op(admin,owners[1],true)).json()).eligible,1);
 assert.equal((await (await op(admin,owners[1])).json()).deleted,1);
 assert.equal((await db.prepare('SELECT status FROM activity_tombstones WHERE id=?').bind(ids[1]).first()).status,'cancelled');
 // At exact 90 days, compare in a single SQL second; repeat if the wall clock ticks.
 let checked=false;
 for(let attempt=0;attempt<10&&!checked;attempt++){
  const t=(await db.prepare('SELECT unixepoch() AS n').first()).n;
  await db.prepare('UPDATE activity_settlements SET completed_at=?-7776000 WHERE activity_id=?').bind(t,ids[0]).run();
  const r=await (await op(admin,owners[0],true)).json();
  const end=(await db.prepare('SELECT unixepoch() AS n').first()).n;
  if(t===end){assert.equal(r.eligible,0);checked=true;}
 }
 assert.equal(checked,true);
});
test('cleanup deletes all activity-scoped private children only and rolls back on expired admin session',async()=>{
 const owner='250',admin=await identity('999'),id=randomUUID(),otherId=randomUUID();
 await db.prepare("INSERT INTO approved_streamers(user_id) VALUES ('250'),('251')").run();
 await db.prepare("INSERT INTO activities(id,owner_id,status,rule_version,created_at) VALUES (?,'250','settled',1,1),(?,'251','settled',1,1)").bind(id,otherId).run();
 await db.prepare("INSERT INTO activity_settlements(activity_id,owner_id,has_draw,completed_at) VALUES (?,'250',1,unixepoch()-7776001),(?,'251',0,unixepoch()-7776001)").bind(id,otherId).run();
 await db.prepare("INSERT INTO activity_score_baselines VALUES (?,'250','300',7),(?,'251','300',6)").bind(id,otherId).run();
 await db.prepare("INSERT INTO registrations(activity_id,owner_id,viewer_id,ordinal,display_name_snapshot,name_source) VALUES (?,'250','300',1,'private-name','global_name'),(?,'251','300',1,'other-name','global_name')").bind(id,otherId).run();
 await db.prepare("INSERT INTO draws(id,activity_id,owner_id,request_key,rule_version,winner_id,winner_ordinal,created_at,winner_display_name) VALUES ('private-draw',?,'250','secretkey',1,'300',1,1,'private-name')").bind(id).run();
 await db.prepare("INSERT INTO draw_candidates VALUES ('private-draw','300',1,7,1,1)").run();
 await db.prepare("INSERT INTO guild_membership_proofs(session_hash,user_id,owner_id,activity_id,rule_version,guild_id,status,expires,nickname) VALUES ('session','300','250',?,1,'1','member',unixepoch()+100,'private-nick')").bind(id).run();
 await db.prepare("INSERT INTO viewer_login_intents VALUES ('intent','session','250',?,1,unixepoch()+100)").bind(id).run();
 await db.prepare("INSERT INTO viewer_oauth_context VALUES ('state','250',?,1,unixepoch()+100,'1')").bind(id).run();
 await db.prepare("INSERT INTO oauth_states VALUES ('state',unixepoch()+100,'verifier')").run();
 await db.prepare("INSERT INTO discord_identities VALUES ('300','global-private','contact-private')").run();
 await db.prepare("INSERT INTO environments VALUES ('250','settings-private',1)").run();
 await db.prepare("CREATE TRIGGER retention_expire AFTER DELETE ON registrations WHEN OLD.owner_id='250' BEGIN UPDATE sessions SET expires=unixepoch() WHERE user_id='999'; END").run();
 assert.equal((await op(admin,owner)).status,500);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM draw_candidates WHERE draw_id=\'private-draw\'').first()).n,1);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM activity_tombstones WHERE id=?').bind(id).first()).n,0);
 await db.prepare('DROP TRIGGER retention_expire').run();
 const fresh=await identity('999');assert.equal((await (await op(fresh,owner)).json()).deleted,1);
 for(const table of ['activity_score_baselines','registrations','draws','activity_settlements','guild_membership_proofs','viewer_login_intents','viewer_oauth_context'])assert.equal((await db.prepare(`SELECT count(*) n FROM ${table} WHERE activity_id=? AND owner_id=?`).bind(id,owner).first()).n,0,table);
 assert.equal((await db.prepare("SELECT count(*) n FROM draw_candidates WHERE draw_id='private-draw'").first()).n,0);
 assert.equal((await db.prepare("SELECT count(*) n FROM oauth_states WHERE state_hash='state'").first()).n,0);
 assert.equal((await db.prepare('SELECT count(*) n FROM registrations WHERE activity_id=?').bind(otherId).first()).n,1);
 assert.equal((await db.prepare('SELECT count(*) n FROM activity_score_baselines WHERE activity_id=?').bind(otherId).first()).n,1);
 assert.deepEqual(await db.prepare("SELECT * FROM discord_identities WHERE user_id='300'").first(),{user_id:'300',display_name:'global-private',username:'contact-private'});
 assert.equal((await db.prepare("SELECT value FROM environments WHERE owner_id='250'").first()).value,'settings-private');
 assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
 assert.equal((await (await op(fresh,'251',true)).json()).eligible,1);
});
test('a real cancelled activity is retained until its restoration completion time expires',async()=>{
 const admin=await identity('999'),owner=await identity('280'),viewer=await identity('281'),id=randomUUID();
 await db.prepare("INSERT INTO approved_streamers(user_id) VALUES ('280')").run();
 await db.prepare("INSERT INTO viewer_scores VALUES ('280','281',8)").run();
 assert.equal((await req(`/api/activities/${id}`,owner,'PUT',{expected_generation:0,guild_id:null,rule_version:1})).status,201);
 assert.equal((await req('/api/viewer/280/register',viewer,'POST',{activity_id:id,rule_version:1})).status,200);
 assert.equal((await req(`/api/activities/${id}/draws/key`,owner,'PUT',{rule_version:1})).status,200);
 assert.equal((await req(`/api/activities/${id}/cancellations/key`,owner,'PUT',{rule_version:1})).status,200);
 assert.equal((await db.prepare("SELECT score FROM viewer_scores WHERE owner_id='280' AND viewer_id='281'").first()).score,8);
 assert.equal((await (await op(admin,'280')).json()).deleted,0);
 await db.prepare('UPDATE activity_cancellations SET completed_at=unixepoch()-7776001 WHERE activity_id=?').bind(id).run();
 assert.equal((await (await op(admin,'280')).json()).deleted,1);
 assert.equal((await db.prepare("SELECT score FROM viewer_scores WHERE owner_id='280' AND viewer_id='281'").first()).score,8);
 assert.equal((await req(`/api/activities/${id}/cancellations/key`,owner,'PUT',{rule_version:1})).status,404);
 assert.equal((await req(`/api/activities/${id}/settlements/key`,owner,'PUT',{rule_version:1})).status,404);
});
test('large activity advances in bounded pages with a durable terminal fence',async()=>{
 const admin=await identity('999'),owner=await identity('290'),id=randomUUID();
 await db.prepare("INSERT INTO approved_streamers(user_id) VALUES ('290')").run();
 await db.prepare("INSERT INTO activities(id,owner_id,status,rule_version,created_at) VALUES (?,'290','settled',1,1)").bind(id).run();
 await db.prepare("INSERT INTO activity_settlements VALUES (?,'290','',1,1)").bind(id).run();
 const ids=Array.from({length:251},(_,i)=>String(10000+i));
 await db.prepare("INSERT INTO registrations(activity_id,owner_id,viewer_id,ordinal) SELECT ?,'290',value,CAST(key AS INTEGER)+1 FROM json_each(?)").bind(id,JSON.stringify(ids)).run();
 await db.prepare("INSERT INTO draws(id,activity_id,owner_id,request_key,rule_version,winner_id,winner_ordinal,created_at) VALUES ('big',?,'290','key',1,'10000',1,1)").bind(id).run();
 await db.prepare("INSERT INTO draw_candidates SELECT 'big',value,CAST(key AS INTEGER)+1,0,1,0.01 FROM json_each(?)").bind(JSON.stringify(ids)).run();
 let r=await (await op(admin,'290')).json();assert.equal(r.deleted,0);assert.equal(r.has_more,true);
 assert.equal((await db.prepare("SELECT count(*) n FROM draw_candidates WHERE draw_id='big'").first()).n,151);
 assert.equal((await db.prepare('SELECT count(*) n FROM registrations WHERE activity_id=?').bind(id).first()).n,151);
 assert.equal((await db.prepare('SELECT count(*) n FROM activity_tombstones WHERE id=?').bind(id).first()).n,1);
 assert.equal((await req(`/api/activities/${id}/settlements/key`,owner,'PUT',{rule_version:1})).status,200);
 r=await (await op(admin,'290')).json();assert.equal(r.deleted,0);assert.equal(r.has_more,true);
 r=await (await op(admin,'290')).json();assert.equal(r.deleted,1);assert.equal(r.has_more,false);
 assert.equal((await db.prepare('SELECT count(*) n FROM activities WHERE id=?').bind(id).first()).n,0);
 assert.equal((await (await op(admin,'290')).json()).deleted,0);
});
test('overlapping cleanup requests converge without changing scores',async()=>{
 const admin=await identity('999'),id=randomUUID();
 await db.prepare("INSERT INTO approved_streamers(user_id) VALUES ('295')").run();
 await db.prepare("INSERT INTO activities(id,owner_id,status,rule_version,created_at) VALUES (?,'295','settled',1,1)").bind(id).run();
 await db.prepare("INSERT INTO activity_settlements VALUES (?,'295','',0,1)").bind(id).run();
 await db.prepare("INSERT INTO viewer_scores VALUES ('295','300',4)").run();
 const viewers=Array.from({length:205},(_,i)=>String(50000+i));
 await db.prepare("INSERT INTO registrations(activity_id,owner_id,viewer_id,ordinal) SELECT ?,'295',value,CAST(key AS INTEGER)+1 FROM json_each(?)").bind(id,JSON.stringify(viewers)).run();
 const responses=await Promise.all([op(admin,'295'),op(admin,'295')]);
 assert.deepEqual(responses.map(r=>r.status),[200,200]);
 const results=await Promise.all(responses.map(r=>r.json()));assert.equal(results.reduce((n,r)=>n+r.deleted,0),0);
 assert.equal((await db.prepare('SELECT count(*) n FROM registrations WHERE activity_id=?').bind(id).first()).n,5);
 assert.equal((await (await op(admin,'295')).json()).deleted,1);
 assert.equal((await db.prepare("SELECT score FROM viewer_scores WHERE owner_id='295' AND viewer_id='300'").first()).score,4);
 assert.equal((await db.prepare('SELECT count(*) n FROM activity_tombstones WHERE id=?').bind(id).first()).n,1);
});
test('delayed legacy OAuth writes cannot recreate retired activity children',async()=>{
 const admin=await identity('999'),id=randomUUID(),other=randomUUID(),owner='296';
 await db.prepare("INSERT INTO approved_streamers(user_id) VALUES ('296')").run();
 await db.prepare("INSERT INTO activities(id,owner_id,status,rule_version,created_at) VALUES (?,'296','settled',1,1)").bind(id).run();
 await db.prepare("INSERT INTO activity_settlements VALUES (?,'296','',0,1)").bind(id).run();
 await db.prepare("INSERT INTO viewer_scores VALUES ('296','300',6)").run();
 await db.prepare("INSERT INTO viewer_oauth_context VALUES ('delayed','296',?,1,unixepoch()+100,'1')").bind(id).run();
 // The old callback consumes its context before waiting for Discord.
 const context=await db.prepare("DELETE FROM viewer_oauth_context WHERE state_hash='delayed' RETURNING owner_id,activity_id,rule_version,guild_id").first();
 const protectedTables=['viewer_scores','approved_streamers','environments','activity_defaults','discord_identities','activity_opening_generations'];
 const snapshot=async()=>Promise.all(protectedTables.map(async table=>(await db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results));
 const before=await snapshot();
 assert.equal((await (await op(admin,owner)).json()).deleted,1);
 const inserts=[
  db.prepare("INSERT INTO guild_membership_proofs (session_hash,user_id,owner_id,activity_id,rule_version,guild_id,status,retry_after,expires,nickname) VALUES (?,?,?,?,?,?,?,?,?,?)").bind('late','300',context.owner_id,context.activity_id,context.rule_version,context.guild_id,'member',null,9999999999,'private'),
  db.prepare('INSERT INTO viewer_login_intents VALUES (?,?,?,?,?,?)').bind('late','late',context.owner_id,context.activity_id,context.rule_version,9999999999),
  db.prepare('INSERT INTO viewer_oauth_context (state_hash,owner_id,activity_id,rule_version,expires,guild_id) VALUES (?,?,?,?,?,?)').bind('late',context.owner_id,context.activity_id,context.rule_version,9999999999,context.guild_id)
 ];
 for(const statement of inserts)await assert.rejects(statement.run());
 // Other legacy records remain writable, but retargeting any one to a tombstone fails.
 await db.prepare("INSERT INTO guild_membership_proofs (session_hash,user_id,owner_id,activity_id,rule_version,guild_id,status,expires) VALUES ('safe','300','296',?,1,'1','member',9999999999)").bind(other).run();
 await db.prepare("INSERT INTO viewer_login_intents VALUES ('safe','safe','296',?,1,9999999999)").bind(other).run();
 await db.prepare("INSERT INTO viewer_oauth_context VALUES ('safe','296',?,1,9999999999,NULL)").bind(other).run();
 for(const table of ['guild_membership_proofs','viewer_login_intents','viewer_oauth_context']){
  await assert.rejects(db.prepare(`UPDATE ${table} SET activity_id=? WHERE activity_id=?`).bind(id,other).run());
  assert.equal((await db.prepare(`SELECT count(*) n FROM ${table} WHERE activity_id=?`).bind(id).first()).n,0,table);
  assert.equal((await db.prepare(`SELECT count(*) n FROM ${table} WHERE activity_id=?`).bind(other).first()).n,1,table);
 }
 assert.deepEqual(await snapshot(),before);
});
after(()=>mf.dispose());
