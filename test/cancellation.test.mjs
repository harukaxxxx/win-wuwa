import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
const origin='http://127.0.0.1:19818';
const mf=new Miniflare(convertV4MiniflareOptions({port:19818,host:'127.0.0.1',modules:true,scriptPath:'dist/index.js',compatibilityDate:'2026-07-30',d1Databases:['DB'],bindings:{ORIGIN:origin}}));
const db=await mf.getD1Database('DB');
for(const f of (await readdir('migrations')).sort()) for(const sql of (await readFile('migrations/'+f,'utf8')).split(/;\s*(?=(?:CREATE|ALTER|INSERT|UPDATE|DROP|$))/i).map(x=>x.trim()).filter(Boolean)) await db.prepare(sql).run();
const hash=x=>createHash('sha256').update(x).digest('hex');let seq=0;
async function identity(id){const sid=(++seq).toString(16).padStart(64,'0'),csrf='f'.repeat(64);await db.prepare('INSERT INTO sessions VALUES (?,?,?,unixepoch()+3600)').bind(hash(sid),id,hash(csrf)).run();return {Cookie:`__Host-session=${sid}`,Origin:origin,'X-CSRF-Token':csrf,'Content-Type':'application/json'};}
const req=(path,h,method='GET',body)=>mf.dispatchFetch(origin+path,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)});
const cancel=(id,h,key='key')=>req(`/api/activities/${id}/cancellations/${key}`,h,'PUT',{rule_version:1});
test('cancel restores only this activity winners and retains invalid history',async()=>{
 const owner='200',h=await identity(owner),v=await identity('300'),id=randomUUID();
 await db.prepare("INSERT INTO approved_streamers(user_id) VALUES ('200'),('201')").run();
 await db.prepare("INSERT INTO viewer_scores VALUES ('200','300',7),('200','301',5),('201','300',9)").run();
 assert.equal((await req(`/api/activities/${id}`,h,'PUT',{expected_generation:0,guild_id:null,rule_version:1})).status,201);
 assert.equal((await req('/api/viewer/200/register',v,'POST',{activity_id:id,rule_version:1})).status,200);
 assert.equal((await req(`/api/activities/${id}/draws/one`,h,'PUT',{rule_version:1})).status,200);
 await db.prepare("UPDATE approved_streamers SET status='disabled' WHERE user_id='200'").run();
 const r=await cancel(id,h);assert.equal(r.status,200);assert.deepEqual(await r.json(),{status:'cancelled'});
 assert.deepEqual((await db.prepare('SELECT * FROM viewer_scores ORDER BY owner_id,viewer_id').all()).results,[{owner_id:'200',viewer_id:'300',score:7},{owner_id:'200',viewer_id:'301',score:5},{owner_id:'201',viewer_id:'300',score:9}]);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM draw_candidates').first()).n,1);
 assert.equal((await db.prepare('SELECT status FROM registrations WHERE activity_id=?').bind(id).first()).status,'winner');
 assert.deepEqual((await (await req('/api/viewer/200/results',{})).json()).winners,[]);
 assert.equal((await (await req(`/api/activities/${id}/draws/one`,h)).json()).invalid,true);
 assert.equal((await (await req(`/api/activities/${id}/draw-results/latest`,h)).json()).invalid,true);
 assert.equal((await req(`/api/activities/${id}/settlements/late`,h,'PUT',{rule_version:1})).status,409);
 assert.equal((await cancel(id,h,'retry')).status,200);
});
test('failed restoration rolls back its page, retains slot and resumes without touching non-winners',async()=>{
 const owner='210',h=await identity(owner),id=randomUUID();
 await db.prepare('INSERT INTO approved_streamers(user_id) VALUES (?)').bind(owner).run();
 const ids=Array.from({length:1101},(_,i)=>String(10000+i));
 await db.prepare('INSERT INTO viewer_scores(owner_id,viewer_id,score) SELECT ?,value,5 FROM json_each(?)').bind(owner,JSON.stringify(ids)).run();
 assert.equal((await req(`/api/activities/${id}`,h,'PUT',{expected_generation:0,guild_id:null,rule_version:1})).status,201);
 await db.prepare("INSERT INTO registrations(activity_id,owner_id,viewer_id,ordinal,status) SELECT ?,?,value,CAST(key AS INTEGER)+1,'winner' FROM json_each(?)").bind(id,owner,JSON.stringify(ids.slice(0,205))).run();
 await db.prepare("INSERT INTO draws(id,activity_id,owner_id,request_key,rule_version,winner_id,winner_ordinal,created_at) SELECT 'd'||key,?,?, 'k'||key,1,value,CAST(key AS INTEGER)+1,1 FROM json_each(?)").bind(id,owner,JSON.stringify(ids.slice(0,205))).run();
 await db.prepare('UPDATE viewer_scores SET score=0 WHERE owner_id=? AND viewer_id IN (SELECT value FROM json_each(?))').bind(owner,JSON.stringify(ids.slice(0,205))).run();
 await db.prepare("CREATE TRIGGER cancel_fail BEFORE UPDATE OF score ON viewer_scores WHEN OLD.owner_id='210' AND OLD.viewer_id='10100' BEGIN SELECT RAISE(ABORT,'injected'); END").run();
 assert.equal((await cancel(id,h)).status,500);
 assert.deepEqual(await db.prepare('SELECT cursor,completed_at FROM activity_cancellations WHERE activity_id=?').bind(id).first(),{cursor:'10099',completed_at:null});
 assert.equal((await db.prepare("SELECT score FROM viewer_scores WHERE owner_id='210' AND viewer_id='10099'").first()).score,5);
 assert.equal((await db.prepare("SELECT score FROM viewer_scores WHERE owner_id='210' AND viewer_id='10100'").first()).score,0);
 assert.equal((await req(`/api/activities/${randomUUID()}`,h,'PUT',{expected_generation:1,guild_id:null,rule_version:1})).status,409);
 await db.prepare('DROP TRIGGER cancel_fail').run();
 const rs=await Promise.all([cancel(id,h,'one'),cancel(id,h,'two')]);assert.deepEqual(rs.map(x=>x.status),[200,200]);
 assert.equal((await db.prepare("SELECT count(*) n FROM viewer_scores WHERE owner_id='210' AND score<>5").first()).n,0);
 const next=randomUUID();assert.equal((await req(`/api/activities/${next}`,h,'PUT',{expected_generation:1,guild_id:null,rule_version:1})).status,201);
 assert.equal((await cancel(id,h,'late')).status,200);assert.equal((await db.prepare('SELECT status FROM activities WHERE id=?').bind(next).first()).status,'open');
});
test('session expiring inside a page aborts score and cursor; fresh owner session resumes',async()=>{
 const owner='220',h=await identity(owner),id=randomUUID();
 await db.prepare('INSERT INTO approved_streamers(user_id) VALUES (?)').bind(owner).run();
 await db.prepare("INSERT INTO viewer_scores VALUES ('220','301',6)").run();
 assert.equal((await req(`/api/activities/${id}`,h,'PUT',{expected_generation:0,guild_id:null,rule_version:1})).status,201);
 const v=await identity('301');assert.equal((await req('/api/viewer/220/register',v,'POST',{activity_id:id,rule_version:1})).status,200);
 assert.equal((await req(`/api/activities/${id}/draws/win`,h,'PUT',{rule_version:1})).status,200);
 await db.prepare("CREATE TRIGGER cancel_expire AFTER UPDATE OF score ON viewer_scores WHEN NEW.owner_id='220' BEGIN UPDATE sessions SET expires=unixepoch() WHERE user_id='220'; END").run();
 assert.equal((await cancel(id,h)).status,500);
 assert.deepEqual(await db.prepare('SELECT cursor,completed_at FROM activity_cancellations WHERE activity_id=?').bind(id).first(),{cursor:'',completed_at:null});
 assert.equal((await db.prepare("SELECT score FROM viewer_scores WHERE owner_id='220' AND viewer_id='301'").first()).score,0);
 assert.equal((await db.prepare('SELECT status FROM activities WHERE id=?').bind(id).first()).status,'cancelling');
 await db.prepare('DROP TRIGGER cancel_expire').run();const fresh=await identity(owner);assert.equal((await cancel(id,fresh,'fresh')).status,200);
 assert.equal((await db.prepare("SELECT score FROM viewer_scores WHERE owner_id='220' AND viewer_id='301'").first()).score,6);
});
test('finish and cancellation competing for one activity select exactly one terminal outcome',async()=>{
 for(const owner of ['230','231','232']){
  const h=await identity(owner),id=randomUUID();await db.prepare('INSERT INTO approved_streamers(user_id) VALUES (?)').bind(owner).run();
  assert.equal((await req(`/api/activities/${id}`,h,'PUT',{expected_generation:0,guild_id:null,rule_version:1})).status,201);
  const finish=()=>req(`/api/activities/${id}/settlements/k`,h,'PUT',{rule_version:1});
  const [a,b]=await Promise.all([cancel(id,h),finish()]);assert.deepEqual([a.status,b.status].sort(),[200,409]);
  const status=(await db.prepare('SELECT status FROM activities WHERE id=?').bind(id).first()).status;assert.ok(['settled','cancelled'].includes(status));
 }
});
test('new winner remains zero, paused cancellation preserves non-winners and new activity has a fresh roster',async()=>{
 const owner='240',h=await identity(owner),v=await identity('600'),n=await identity('601'),id=randomUUID();
 await db.prepare('INSERT INTO approved_streamers(user_id) VALUES (?)').bind(owner).run();
 await db.prepare("INSERT INTO viewer_scores VALUES ('240','601',9)").run();
 assert.equal((await req(`/api/activities/${id}`,h,'PUT',{expected_generation:0,guild_id:null,rule_version:1})).status,201);
 assert.equal((await req('/api/viewer/240/register',v,'POST',{activity_id:id,rule_version:1})).status,200);
 assert.equal((await req(`/api/activities/${id}/draws/one`,h,'PUT',{rule_version:1})).status,200);
 assert.equal((await req('/api/viewer/240/register',n,'POST',{activity_id:id,rule_version:1})).status,200);
 assert.equal((await req(`/api/activities/${id}/status`,h,'PUT',{status:'paused',rule_version:1,version:0})).status,200);
 assert.equal((await cancel(id,h)).status,200);
 assert.deepEqual((await db.prepare("SELECT viewer_id,score FROM viewer_scores WHERE owner_id='240' ORDER BY viewer_id").all()).results,[{viewer_id:'600',score:0},{viewer_id:'601',score:9}]);
 const next=randomUUID();assert.equal((await req(`/api/activities/${next}`,h,'PUT',{expected_generation:1,guild_id:'123',rule_version:1})).status,201);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM registrations WHERE activity_id=?').bind(next).first()).n,0);
 assert.equal((await req('/api/viewer/240/register',v,'POST',{activity_id:next,rule_version:1})).status,403);
 assert.equal((await req('/api/viewer/240/register',v,'POST',{activity_id:id,rule_version:1})).status,409);
 await db.prepare("INSERT INTO guild_membership_proofs(session_hash,user_id,owner_id,activity_id,rule_version,guild_id,status,expires) VALUES (?,'600','240',?,1,'123','member',unixepoch()+300)").bind(hash(v.Cookie.slice('__Host-session='.length)),next).run();
 const reg=await req('/api/viewer/240/register',v,'POST',{activity_id:next,rule_version:1});assert.equal(reg.status,200);assert.equal((await reg.json()).ordinal,1);
});
// Direct SQL is a synthetic fixture; there is no supported score-write API here.
test('a winner without an opening baseline restores zero, not a later pre-draw fixture score',async()=>{
 const owner='245',h=await identity(owner),v=await identity('700'),id=randomUUID();
 await db.prepare('INSERT INTO approved_streamers(user_id) VALUES (?)').bind(owner).run();
 assert.equal((await req(`/api/activities/${id}`,h,'PUT',{expected_generation:0,guild_id:null,rule_version:1})).status,201);
 await db.prepare("INSERT INTO viewer_scores VALUES ('245','700',8)").run();
 assert.equal((await req('/api/viewer/245/register',v,'POST',{activity_id:id,rule_version:1})).status,200);
 assert.equal((await req(`/api/activities/${id}/draws/one`,h,'PUT',{rule_version:1})).status,200);
 assert.equal((await cancel(id,h)).status,200);
 assert.equal((await db.prepare("SELECT score FROM viewer_scores WHERE owner_id='245' AND viewer_id='700'").first()).score,0);
});
after(()=>mf.dispose());
