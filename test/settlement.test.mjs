import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
const origin='http://127.0.0.1:19770';
const mf=new Miniflare(convertV4MiniflareOptions({port:19770,host:'127.0.0.1',modules:true,scriptPath:'dist/index.js',compatibilityDate:'2026-07-30',d1Databases:['DB'],bindings:{ORIGIN:origin,ADMIN_DISCORD_ID:'999'}}));
const db=await mf.getD1Database('DB');
for(const f of (await readdir('migrations')).sort())for(const sql of (await readFile('migrations/'+f,'utf8')).split(/;\s*(?=(?:CREATE|ALTER|INSERT|UPDATE|DROP|$))/i).map(x=>x.trim()).filter(Boolean))await db.prepare(sql).run();
const hash=x=>createHash('sha256').update(x).digest('hex');let seq=0;
async function identity(id){const sid=(++seq).toString(16).padStart(64,'0'),csrf='f'.repeat(64);await db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').bind(hash(sid),id,hash(csrf),Math.floor(Date.now()/1000)+3600).run();return {Cookie:`__Host-session=${sid}`,Origin:origin,'X-CSRF-Token':csrf,'Content-Type':'application/json'};}
const req=(path,h,method='GET',body)=>mf.dispatchFetch(origin+path,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)});
async function setup(owner){const id=randomUUID();await db.prepare('INSERT INTO approved_streamers(user_id) VALUES (?)').bind(owner).run();await db.prepare("INSERT INTO activities(id,owner_id,status,rule_version,created_at) VALUES (?,?,'open',1,1)").bind(id,owner).run();return {id,owner,h:await identity(owner)};}
const end=(a,key='key',h=a.h)=>req(`/api/activities/${a.id}/settlements/${key}`,h,'PUT',{rule_version:1});
const scores=async owner=>(await db.prepare('SELECT viewer_id,score FROM viewer_scores WHERE owner_id=? ORDER BY viewer_id').bind(owner).all()).results;
test('valid draw settles late registrations and all historical absences once',async()=>{
 const a=await setup('200');
 await db.prepare("INSERT INTO viewer_scores VALUES ('200','300',7),('200','301',10),('200','302',3),('200','303',6),('200','304',1)").run();
 await db.prepare("INSERT INTO registrations(activity_id,owner_id,viewer_id,ordinal,status) VALUES (?,'200','300',1,'registered'),(?,'200','301',2,'registered'),(?,'200','302',3,'withdrawn')").bind(a.id,a.id,a.id).run();
 assert.equal((await req(`/api/activities/${a.id}/draws/one`,a.h,'PUT',{rule_version:1})).status,200);
 await db.prepare("INSERT INTO registrations(activity_id,owner_id,viewer_id,ordinal) VALUES (?,'200','305',4)").bind(a.id).run();
 const url=await mf.ready;
 const send=key=>fetch(new URL(`/api/activities/${a.id}/settlements/${key}`,url),{method:'PUT',headers:a.h,body:JSON.stringify({rule_version:1})});
 const results=await Promise.all([send('one'),send('one'),send('two'),send('three')]);assert.deepEqual(results.map(r=>r.status),[200,200,200,200]);
 const rows=await scores('200');const winner=(await db.prepare('SELECT winner_id FROM draws WHERE activity_id=?').bind(a.id).first()).winner_id;
 assert.deepEqual(rows,[{viewer_id:'300',score:winner==='300'?0:8},{viewer_id:'301',score:winner==='301'?0:10},{viewer_id:'302',score:3},{viewer_id:'303',score:5},{viewer_id:'304',score:0},{viewer_id:'305',score:1}]);
 assert.equal((await end(a,'one')).status,200);assert.deepEqual(await scores('200'),rows);
 const next=randomUUID();await db.prepare("INSERT INTO activities(id,owner_id,status,rule_version,created_at) VALUES (?,'200','open',1,1)").bind(next).run();
 assert.equal((await end(a,'old')).status,200);assert.equal((await db.prepare('SELECT status FROM activities WHERE id=?').bind(next).first()).status,'open');assert.deepEqual(await scores('200'),rows);
});
test('owner only, CSRF and disabled owner may finish; empty and failed draws do not count',async()=>{
 const a=await setup('210'), other=await identity('999'), viewer=await identity('400');
 await db.prepare("INSERT INTO viewer_scores VALUES ('210','400',7),('210','401',5)").run();
 const before=await scores('210');
 assert.equal((await end(a,'x',other)).status,404);
 assert.equal((await end(a,'x',{...a.h,Origin:'https://evil.example'})).status,403);
 assert.equal((await req(`/api/activities/${a.id}/settlements/x`,{},'PUT',{rule_version:1})).status,401);
 assert.equal((await req(`/api/activities/${a.id}/draws/empty`,a.h,'PUT',{rule_version:1})).status,409);
 assert.equal((await req('/api/viewer/210/register',viewer,'POST',{activity_id:a.id,rule_version:1})).status,200);
 assert.equal((await req(`/api/activities/${a.id}/draws/invalid`,a.h,'PUT',{rule_version:2})).status,400);
 await db.prepare("UPDATE approved_streamers SET status='disabled' WHERE user_id='210'").run();
 assert.equal((await end(a)).status,200);assert.deepEqual(await scores('210'),before);
 assert.equal((await req('/api/viewer/210/register',viewer,'POST',{activity_id:a.id,rule_version:1})).status,409);
});
test('partial page failure rolls back and later resumes without releasing slot',async()=>{
 const a=await setup('220');
 const ids=Array.from({length:205},(_,i)=>String(1000+i));
 await db.prepare("INSERT INTO viewer_scores(owner_id,viewer_id,score) SELECT '220',value,5 FROM json_each(?)").bind(JSON.stringify(ids)).run();
 await db.prepare("INSERT INTO registrations(activity_id,owner_id,viewer_id,ordinal) VALUES (?,'220','9000',1)").bind(a.id).run();
 assert.equal((await req(`/api/activities/${a.id}/draws/one`,a.h,'PUT',{rule_version:1})).status,200);
 await db.prepare("INSERT INTO registrations(activity_id,owner_id,viewer_id,ordinal) VALUES (?,'220','1101',2)").bind(a.id).run();
 await db.prepare("CREATE TRIGGER fail_settlement BEFORE UPDATE OF score ON viewer_scores WHEN OLD.owner_id='220' AND OLD.viewer_id='1100' BEGIN SELECT RAISE(ABORT,'injected'); END").run();
 assert.equal((await end(a)).status,500);
 assert.equal((await db.prepare('SELECT status FROM activities WHERE id=?').bind(a.id).first()).status,'settling');
 assert.equal((await db.prepare('SELECT cursor FROM activity_settlements WHERE activity_id=?').bind(a.id).first()).cursor,'1099');
 assert.equal((await db.prepare("SELECT score FROM viewer_scores WHERE owner_id='220' AND viewer_id='1099'").first()).score,4);
 assert.equal((await db.prepare("SELECT score FROM viewer_scores WHERE owner_id='220' AND viewer_id='1100'").first()).score,5);
 assert.equal((await db.prepare("SELECT score FROM viewer_scores WHERE owner_id='220' AND viewer_id='1101'").first()).score,5);
 const open=await req(`/api/activities/${randomUUID()}`,a.h,'PUT',{expected_generation:0,guild_id:null,rule_version:1});assert.equal(open.status,409);
 await db.prepare('DROP TRIGGER fail_settlement').run();
 assert.equal((await end(a,'retry')).status,200);
 assert.equal((await db.prepare("SELECT count(*) AS n FROM viewer_scores WHERE owner_id='220' AND viewer_id NOT IN ('9000','1101') AND score<>4").first()).n,0);
 assert.equal((await db.prepare("SELECT score FROM viewer_scores WHERE owner_id='220' AND viewer_id='1101'").first()).score,6);
 assert.equal((await end(a,'different')).status,200);
 assert.equal((await db.prepare("SELECT count(*) AS n FROM viewer_scores WHERE owner_id='220' AND viewer_id NOT IN ('9000','1101') AND score<>4").first()).n,0);
 assert.equal((await db.prepare("SELECT score FROM viewer_scores WHERE owner_id='220' AND viewer_id='1101'").first()).score,6);
});
test('bounded work resumes beyond 1000 records without truncation or cross-owner writes',async()=>{
 const a=await setup('230'), b=await setup('231');
 const ids=Array.from({length:1101},(_,i)=>String(10000+i));
 await db.prepare("INSERT INTO viewer_scores(owner_id,viewer_id,score) SELECT '230',value,1 FROM json_each(?)").bind(JSON.stringify(ids)).run();
 await db.prepare("INSERT INTO viewer_scores VALUES ('231','10000',9)").run();
 await db.prepare("INSERT INTO registrations(activity_id,owner_id,viewer_id,ordinal) VALUES (?,'230','99999',1)").bind(a.id).run();
 assert.equal((await req(`/api/activities/${a.id}/draws/one`,a.h,'PUT',{rule_version:1})).status,200);
 assert.equal((await end(a)).status,202);assert.equal((await db.prepare('SELECT status FROM activities WHERE id=?').bind(a.id).first()).status,'settling');
 const ownerCurrent=await (await req('/api/activities/current',a.h)).json();assert.deepEqual(ownerCurrent.activity.settlement_progress,{processed:true});assert.ok(!JSON.stringify(ownerCurrent).includes('10999'));assert.ok(!('cursor' in ownerCurrent.activity));
 const viewer=await identity('99999');const self=await (await req(`/api/viewer/230/self?activity_id=${a.id}&rule_version=1`,viewer)).json();assert.equal(self.activity_status,'settling');assert.ok(!('cursor' in self));assert.ok(!('settlement_progress' in self));
 const publicState=await (await req('/api/viewer/230',{})).json();assert.equal(publicState.activity.status,'settling');assert.ok(!('settlement_progress' in publicState.activity));
 assert.equal((await end(a)).status,200);
 assert.equal((await db.prepare("SELECT count(*) AS n FROM viewer_scores WHERE owner_id='230' AND score<>0").first()).n,0);
 assert.equal((await scores(b.owner))[0].score,9);
});
test('stored ceiling has no hidden credit after repeated activities then absence',async()=>{
 const a=await setup('240');await db.prepare("INSERT INTO viewer_scores VALUES ('240','5000',10)").run();
 for(let i=0;i<3;i++){
  const id=i===0?a.id:randomUUID();
  if(i)await db.prepare("INSERT INTO activities(id,owner_id,status,rule_version,created_at) VALUES (?,'240','open',1,1)").bind(id).run();
  await db.prepare("INSERT INTO registrations(activity_id,owner_id,viewer_id,ordinal) VALUES (?,'240','6000',1)").bind(id).run();
  assert.equal((await req(`/api/activities/${id}/draws/one`,a.h,'PUT',{rule_version:1})).status,200);
  if(i<2)await db.prepare("INSERT INTO registrations(activity_id,owner_id,viewer_id,ordinal) VALUES (?,'240','5000',2)").bind(id).run();
  assert.equal((await end({...a,id})).status,200);
  assert.equal((await db.prepare("SELECT score FROM viewer_scores WHERE owner_id='240' AND viewer_id='5000'").first()).score,i===2?9:10);
 }
});
after(()=>mf.dispose());
