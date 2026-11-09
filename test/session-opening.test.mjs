import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import worker from '../dist/index.js';
const origin='http://localhost';
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:process.env.WUWA_TEST_BUNDLE||'dist/index.js',compatibilityDate:'2026-07-30',d1Databases:['DB'],bindings:{ORIGIN:origin,ADMIN_DISCORD_ID:'100'}}));
const db=await mf.getD1Database('DB');
for(const file of ['migrations/0001_init.sql','migrations/0002_login_budget.sql','migrations/0003_streamer_status.sql','migrations/0004_activities.sql','migrations/0005_opening_generation.sql','migrations/0006_activity_defaults.sql','migrations/0007_registrations.sql','migrations/0008_viewer_oauth.sql','migrations/0009_guild_proofs.sql','migrations/0010_guild_invite.sql']) for(const sql of (await readFile(file,'utf8')).split(';').map(s=>s.trim()).filter(Boolean)) await db.prepare(sql).run();
const digest=x=>createHash('sha256').update(x).digest('hex');
async function identity(id,c){const sid=c.length===64?c:c.repeat(64),csrf='f'.repeat(64);await db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').bind(digest(sid),id,digest(csrf),Math.floor(Date.now()/1000)+300).run();return {Cookie:`__Host-session=${sid}; __Host-csrf=${csrf}`,Origin:origin,'X-CSRF-Token':csrf,'Content-Type':'application/json'};}
await db.prepare("INSERT INTO approved_streamers(user_id,status,version) VALUES ('200','approved',1)").run();
const owner=await identity('200','a');
const req=(path,h,method='GET',body)=>mf.dispatchFetch(origin+path,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)});
test('approved owner opens an identified activity',async()=>{const r=await req('/api/activities/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',owner,'PUT',{rule_version:1,expected_generation:0,guild_id:null});assert.equal(r.status,201);});
const path=id=>'/api/activities/'+id;
const body={rule_version:1,expected_generation:0,guild_id:null};
const id=n=>`${String(n).padStart(8,'0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
test('owner guild default is versioned and does not alter open or paused snapshots',async()=>{
 await db.prepare("INSERT INTO approved_streamers(user_id) VALUES ('213')").run();const h=await identity('213','ab'.repeat(32));
 assert.deepEqual(await (await req('/api/activity-default',h)).json(),{guild_id:null,guild_invite_url:null,version:0});
 assert.equal((await req('/api/activity-default',h,'PUT',{guild_id:'123',version:0})).status,200);
 assert.equal((await req(path(id(19)),h,'PUT',{...body,guild_id:'123'})).status,201);
 for(const [status,v] of [['open',1],['paused',2]]) {if(status==='paused')await db.prepare("UPDATE activities SET status='paused' WHERE id=?").bind(id(19)).run();assert.equal((await req('/api/activity-default',h,'PUT',{guild_id:'456',version:v})).status,200);const a=(await (await req('/api/activities/current',h)).json()).activity;assert.equal(a.guild_id,'123');assert.equal(a.rule_version,1);}
 assert.equal((await req('/api/activity-default',h,'PUT',{guild_id:null,version:1})).status,409);
 for(const b of [null,[],{guild_id:'x',version:3},{guild_id:null,version:null},{guild_id:null,version:3,owner_id:'200'},{guild_id:null,version:3,formula:'x'}])assert.equal((await req('/api/activity-default',h,'PUT',b)).status,400);
 const admin=await identity('100','bc'.repeat(32));assert.deepEqual(await (await req('/api/activity-default',admin)).json(),{guild_id:null,guild_invite_url:null,version:0});assert.equal((await req('/api/activity-default?owner=213',admin,'PUT',{guild_id:null,version:0})).status,400);
 await db.prepare("UPDATE approved_streamers SET status='disabled' WHERE user_id='213'").run();assert.equal((await req('/api/activity-default',h,'PUT',{guild_id:null,version:3})).status,403);assert.deepEqual(await (await req('/api/activity-default',h)).json(),{guild_id:'456',guild_invite_url:null,version:3});
});
test('same owner concurrent requests occupy exactly one slot, retry remains bound',async()=>{
 await db.prepare("INSERT INTO approved_streamers(user_id) VALUES ('201')").run();const h=await identity('201','b');
 const results=await Promise.all([req(path(id(1)),h,'PUT',body),req(path(id(2)),h,'PUT',body)]);assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
 const current=(await (await req('/api/activities/current',h)).json()).activity;assert.ok([id(1),id(2)].includes(current.id));
 assert.equal((await req(path(current.id),h,'PUT',body)).status,200);
 assert.equal((await req(path(current.id),h,'PUT',{...body,guild_id:'123'})).status,409);
 for(const status of ['paused','initializing','settling','cancelling']){await db.prepare('UPDATE activities SET status=? WHERE id=?').bind(status,current.id).run();assert.equal((await req(path(id(3)),h,'PUT',body)).status,409);}
 await db.prepare("UPDATE activities SET status='cancelled' WHERE id=?").bind(current.id).run();assert.equal((await req(path(id(3)),h,'PUT',{...body,expected_generation:1})).status,201);const late=await req(path(current.id),h,'PUT',body);assert.equal(late.status,200);assert.equal((await late.json()).activity.status,'cancelled');assert.equal((await (await req('/api/activities/current',h)).json()).activity.id,id(3));
});
test('owners isolated, admin cannot operate another and forged fields rejected',async()=>{
 await db.prepare("INSERT INTO approved_streamers(user_id) VALUES ('202')").run();const h=await identity('202','c'),admin=await identity('100','d');
 assert.equal((await req(path(id(4)),h,'PUT',{rule_version:1,expected_generation:0,guild_id:'234'})).status,201);
 assert.equal((await req(path(id(4)),admin,'PUT',{rule_version:1,expected_generation:0,guild_id:'234'})).status,403);
 assert.equal((await req('/api/activities/current?owner=202',admin)).status,400);
 assert.equal((await (await req('/api/activities/current',admin)).json()).activity,null);
 assert.equal((await req(path(id(5)),admin,'PUT',{...body,owner_id:'202'})).status,400);
 assert.equal((await req(path(id(5)),admin,'PUT',body)).status,403);
 for(const extra of [{weights:[1]}, {formula:'custom'}, {rule_version:2}, {guild_id:'bad'}]) assert.equal((await req(path(id(6)),h,'PUT',{...body,...extra})).status,400);
});
test('all historical nonzero scores copied without truncation and failure rolls back',async()=>{
 await db.prepare("INSERT INTO approved_streamers(user_id) VALUES ('203')").run();const h=await identity('203','e');
 for(let i=0;i<1101;i+=50)await db.batch(Array.from({length:Math.min(50,1101-i)},(_,j)=>db.prepare('INSERT INTO viewer_scores VALUES (?,?,?)').bind('203',String(i+j),1+(i+j)%10)));
 await db.prepare("CREATE TRIGGER fail_baseline BEFORE INSERT ON activity_score_baselines BEGIN SELECT RAISE(ABORT, 'injected'); END").run();
 assert.equal((await req(path(id(7)),h,'PUT',body)).status,500);
 assert.equal(await db.prepare('SELECT id FROM activities WHERE id=?').bind(id(7)).first(),null);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM activity_score_baselines WHERE activity_id=?').bind(id(7)).first()).n,0);
 await db.prepare('DROP TRIGGER fail_baseline').run();assert.equal((await req(path(id(7)),h,'PUT',body)).status,201);
 const c=await db.prepare('SELECT COUNT(*) n, SUM(score) total FROM activity_score_baselines WHERE activity_id=?').bind(id(7)).first();const expected=await db.prepare('SELECT COUNT(*) n,SUM(score) total FROM viewer_scores WHERE owner_id=?').bind('203').first();assert.deepEqual(c,expected);assert.equal(c.n,1101);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM viewer_scores s LEFT JOIN activity_score_baselines b ON b.activity_id=? AND b.owner_id=s.owner_id AND b.viewer_id=s.viewer_id WHERE s.owner_id=? AND (b.score IS NULL OR b.score<>s.score)').bind(id(7),'203').first()).n,0);
});
test('disabled committed before opening denies writes while retaining existing state',async()=>{
 await db.prepare("INSERT INTO approved_streamers(user_id) VALUES ('204')").run();const h=await identity('204','1');
 await db.prepare("UPDATE approved_streamers SET status='disabled' WHERE user_id='204'").run();assert.equal((await req(path(id(8)),h,'PUT',body)).status,403);assert.equal((await (await req('/api/activities/current',h)).json()).activity,null);
 await db.prepare("UPDATE approved_streamers SET status='disabled' WHERE user_id='200'").run();assert.equal((await (await req('/api/activities/current',owner)).json()).activity.id,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
});
test('logout and a new login session do not end activity',async()=>{
 assert.equal((await req('/api/logout',owner,'POST')).status,204);assert.equal((await req('/api/activities/current',owner)).status,401);const next=await identity('200','2');assert.equal((await (await req('/api/activities/current',next)).json()).activity.status,'open');
});
test('different approved owners can open concurrently',async()=>{
 await db.prepare("INSERT INTO approved_streamers(user_id) VALUES ('205'),('206')").run();const a=await identity('205','3'),b=await identity('206','4');
 const r=await Promise.all([req(path(id(9)),a,'PUT',body),req(path(id(10)),b,'PUT',body)]);assert.deepEqual(r.map(x=>x.status),[201,201]);
 assert.equal((await (await req('/api/activities/current',a)).json()).activity.id,id(9));assert.equal((await (await req('/api/activities/current',b)).json()).activity.id,id(10));
});
test('concurrent retries with identical activity id converge without duplicate baseline',async()=>{
 await db.prepare("INSERT INTO approved_streamers(user_id) VALUES ('208')").run();const h=await identity('208','6');await db.prepare('INSERT INTO viewer_scores VALUES (?,?,?)').bind('208','viewer',7).run();
 const results=await Promise.all([req(path(id(12)),h,'PUT',body),req(path(id(12)),h,'PUT',body)]);assert.deepEqual(results.map(x=>x.status).sort(),[200,201]);assert.equal((await db.prepare('SELECT COUNT(*) n FROM activity_score_baselines WHERE activity_id=?').bind(id(12)).first()).n,1);
});
test('simultaneous HTTP disable and open yield a legal serialized outcome',async()=>{
 const admin=await identity('100','7');
 for(const [ownerId,char,n] of [['209','8',13],['210','9',14]]){
  await db.prepare('INSERT INTO approved_streamers(user_id) VALUES (?)').bind(ownerId).run();const h=await identity(ownerId,char);
  const [o,d]=await Promise.all([req(path(id(n)),h,'PUT',body),req('/api/admin/streamers/'+ownerId,admin,'PUT',{status:'disabled',version:1})]);
  assert.equal(d.status,200);assert.ok([201,403].includes(o.status));
  const state=await (await req('/api/activities/current',h)).json();
  assert.equal((await (await req('/api/admin/streamers/'+ownerId,admin)).json()).status,'disabled');
  if(o.status===403){assert.equal(state.activity,null);assert.equal(state.opening_generation,0);}else{assert.equal(state.activity.id,id(n));assert.equal(state.opening_generation,1);}
 }
});
test('locked rule and guild survive unrelated environment changes in open and paused',async()=>{
 await db.prepare("INSERT INTO approved_streamers(user_id) VALUES ('211')").run();const h=await identity('211','0');
 assert.equal((await req('/api/environment',h,'PUT',{value:'before',version:0})).status,200);
 const payload={rule_version:1,expected_generation:0,guild_id:'456789'};assert.equal((await req(path(id(15)),h,'PUT',payload)).status,201);
 for(const [status,version] of [['open',1],['paused',2]]){if(status==='paused')await db.prepare("UPDATE activities SET status='paused' WHERE id=?").bind(id(15)).run();assert.equal((await req('/api/environment',h,'PUT',{value:'after-'+status,version})).status,200);const activity=(await (await req('/api/activities/current',h)).json()).activity;assert.equal(activity.status,status);assert.equal(activity.rule_version,1);assert.equal(activity.guild_id,'456789');assert.equal((await req(path(id(15)),h,'PUT',{...payload,guild_id:'999'})).status,409);assert.equal((await req(path(id(15)),h,'PUT',{...payload,rule_version:2})).status,400);}
});
test('disable immediately before opening batch commits first and prevents creation',async()=>{
 await db.prepare("INSERT INTO approved_streamers(user_id) VALUES ('207')").run();const h=await identity('207','5');let injected=false;
 const wrapped={prepare:sql=>db.prepare(sql),async batch(stmts){await db.prepare("UPDATE approved_streamers SET status='disabled' WHERE user_id='207'").run();injected=true;return db.batch(stmts);}};
 const response=await worker.fetch(new Request(origin+path(id(11)),{method:'PUT',headers:h,body:JSON.stringify(body)}),{DB:wrapped,ORIGIN:origin});
 assert.equal(injected,true);assert.equal(response.status,403);assert.equal(await db.prepare('SELECT id FROM activities WHERE id=?').bind(id(11)).first(),null);
});
test('stale first submission is fenced after another activity ends',async()=>{
 await db.prepare("INSERT INTO approved_streamers(user_id) VALUES ('212')").run();const h=await identity('212','f');
 const before=await (await req('/api/activities/current',h)).json();assert.equal(before.opening_generation,0);
 const b={...body,expected_generation:before.opening_generation};
 assert.equal((await req(path(id(17)),h,'PUT',b)).status,201);
 await db.prepare("UPDATE activities SET status='cancelled' WHERE id=?").bind(id(17)).run();
 assert.equal((await req(path(id(16)),h,'PUT',b)).status,409);
 assert.equal((await req(path(id(17)),h,'PUT',b)).status,200);
 assert.equal((await (await req('/api/activities/current',h)).json()).opening_generation,1);
});
test('generation is strict and exact retry includes its generation',async()=>{
 const h={...owner}; h.Cookie=`__Host-session=${'f'.repeat(64)}; __Host-csrf=${'f'.repeat(64)}`;
 for(const value of [-1,1.5,'0',null,Number.MAX_SAFE_INTEGER]) assert.equal((await req(path(id(18)),h,'PUT',{...body,expected_generation:value})).status,400);
 assert.equal((await req(path(id(17)),h,'PUT',{...body,expected_generation:1})).status,409);
});
test('invite is validated, persisted in defaults, and locked to an activity',async()=>{
 await db.prepare("INSERT INTO approved_streamers(user_id) VALUES ('214')").run();const h=await identity('214','cd'.repeat(32));
 const invite='https://discord.gg/Example123';
 for(const bad of ['http://discord.gg/a','https://discord.gg/a?x=1','https://discord.gg@evil.test/a','https://discord.gg/a/b','https://discord.com/invite/a#x','https://discord.gg/','https://discord.gg:443/a','https://user@discord.gg/a','https://discord.com/invite/','https://discord.gg/a\n','https://discord.gg/%61']) assert.equal((await req('/api/activity-default',h,'PUT',{guild_id:'123',guild_invite_url:bad,version:0})).status,400);
 assert.equal((await req('/api/activity-default',h,'PUT',{guild_id:null,guild_invite_url:invite,version:0})).status,400);
 assert.equal((await req('/api/activity-default',h,'PUT',{guild_id:'123',guild_invite_url:invite,version:0})).status,200);
 const payload={...body,guild_id:'123',guild_invite_url:invite};
 assert.equal((await req(path(id(20)),h,'PUT',payload)).status,201);
 assert.equal((await req(path(id(20)),h,'PUT',payload)).status,200);
 assert.equal((await req('/api/activity-default',h,'PUT',{guild_id:'456',guild_invite_url:null,version:1})).status,200);
 assert.deepEqual(await (await req('/api/activity-default',h)).json(),{guild_id:'456',guild_invite_url:null,version:2});
 assert.equal((await (await req('/api/activities/current',h)).json()).activity.guild_invite_url,invite);
 await db.prepare("UPDATE activities SET status='paused' WHERE id=?").bind(id(20)).run();assert.equal((await req('/api/activity-default',h,'PUT',{guild_id:'789',guild_invite_url:'https://discord.com/invite/ABC',version:2})).status,200);assert.equal((await (await req('/api/activities/current',h)).json()).activity.guild_invite_url,invite);
 assert.equal((await req(path(id(20)),h,'PUT',{...payload,guild_invite_url:'https://discord.gg/other'})).status,409);
 assert.equal((await (await req('/api/viewer/214',h)).json()).activity.guild_invite_url,invite);
});
after(()=>mf.dispose());
