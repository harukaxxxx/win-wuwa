import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
const origin='http://127.0.0.1:19717';
const mf=new Miniflare(convertV4MiniflareOptions({port:19717,host:'127.0.0.1',modules:true,scriptPath:'dist/index.js',compatibilityDate:'2026-07-30',d1Databases:['DB'],bindings:{ORIGIN:origin,ADMIN_DISCORD_ID:'999'}}));
const db=await mf.getD1Database('DB');
for(const f of (await readdir('migrations')).sort())for(const sql of (await readFile('migrations/'+f,'utf8')).split(/;\s*(?=(?:CREATE|ALTER|INSERT|UPDATE|DROP|$))/i).map(x=>x.trim()).filter(Boolean))await db.prepare(sql).run();
const digest=x=>createHash('sha256').update(x).digest('hex');
async function identity(id,t){const sid=t.repeat(64),csrf='f'.repeat(64);await db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').bind(digest(sid),id,digest(csrf),Math.floor(Date.now()/1000)+3600).run();return {Cookie:`__Host-session=${sid}; __Host-csrf=${csrf}`,Origin:origin,'X-CSRF-Token':csrf,'Content-Type':'application/json'};}
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
await db.prepare("INSERT INTO approved_streamers(user_id) VALUES ('200'),('201')").run();
await db.prepare("INSERT INTO activities(id,owner_id,status,rule_version,created_at) VALUES (?,'200','open',1,1)").bind(id).run();
await db.prepare("INSERT INTO registrations(activity_id,owner_id,viewer_id,ordinal,display_name_snapshot,name_source) VALUES (?,'200','300',1,'Visible winner','global_name'),(?,'200','301',2,'Other display','global_name')").bind(id,id).run();
await db.prepare("INSERT INTO viewer_scores VALUES ('200','300',4),('200','301',8)").run();
await db.prepare("INSERT INTO discord_identities VALUES ('300','Visible winner','secret_username'),('301','Other display','fixture-contact')").run();
const host=await identity('200','a'),viewer=await identity('300','b'),other=await identity('301','c'),admin=await identity('999','d');
const req=(p,h={},method='GET',body)=>fetch(origin+p,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)});
test('self chance reflects coherent candidate snapshot without exposing other scores',async()=>{const path=`/api/viewer/200/chance?activity_id=${id}&rule_version=1`;assert.equal((await req(path)).status,401);const response=await req(path,viewer);assert.equal(response.status,200);const b=await response.json();assert.equal(b.status,'registered');assert.equal(b.ordinal,1);assert.equal(b.score,4);const w1=(1+0.4*4)*(1+10/50),w2=(1+0.4*8)*(1+10/51);assert.ok(Math.abs(b.probability-(0.25+0.5*w1/(w1+w2)))<1e-12);assert.ok(Number.isInteger(b.as_of));assert.ok(!JSON.stringify(b).includes('301'));await db.prepare("UPDATE activities SET status='paused' WHERE id=?").bind(id).run();assert.equal((await (await req(path,viewer)).json()).probability,b.probability);await db.prepare("UPDATE viewer_scores SET score=0 WHERE owner_id='200' AND viewer_id='301'").run();assert.notEqual((await (await req(path,viewer)).json()).probability,b.probability);await db.prepare("UPDATE viewer_scores SET score=8 WHERE owner_id='200' AND viewer_id='301'").run();await db.prepare("UPDATE activities SET status='open' WHERE id=?").bind(id).run();});
test('candidate version is durable and changes only for the relevant pool',async()=>{
 const path=`/api/viewer/200/chance?activity_id=${id}&rule_version=1`;
 const read=async()=>await (await req(path,viewer)).json();
 const a=await read(),b=await read();assert.ok(Number.isSafeInteger(a.candidate_revision));assert.equal(a.candidate_revision,b.candidate_revision);assert.equal(a.candidate_updated_at,b.candidate_updated_at);assert.match(a.candidate_updated_at,/^\d{4}-\d\d-\d\dT/);
 await db.prepare("INSERT INTO viewer_scores VALUES ('201','301',9)").run();await db.prepare("UPDATE viewer_scores SET score=4 WHERE owner_id='200' AND viewer_id='300'").run();assert.equal((await read()).candidate_revision,a.candidate_revision);
 await db.prepare("UPDATE viewer_scores SET score=1 WHERE owner_id='200' AND viewer_id='301'").run();const c=await read();assert.ok(c.candidate_revision>a.candidate_revision);assert.notEqual(c.probability,a.probability);assert.equal(c.score,4);
 await db.prepare("UPDATE viewer_scores SET score=8 WHERE owner_id='200' AND viewer_id='301'").run();
});
test('chance revision and weights stay coherent during concurrent score changes',async()=>{
 const path=`/api/viewer/200/chance?activity_id=${id}&rule_version=1`,read=async()=>await (await req(path,viewer)).json();
 await db.prepare("UPDATE viewer_scores SET score=0 WHERE owner_id='200' AND viewer_id='301'").run();const start=await read();
 const writer=(async()=>{for(let i=0;i<30;i++)await db.prepare("UPDATE viewer_scores SET score=? WHERE owner_id='200' AND viewer_id='301'").bind((i+1)%2).run();})();
 for(let i=0;i<30;i++){const b=await read(),score=(b.candidate_revision-start.candidate_revision)%2;const w1=2.6*1.2,w2=(1+0.4*score)*(1+10/51);assert.ok(Math.abs(b.probability-(0.25+0.5*w1/(w1+w2)))<1e-12);}
 await writer;await db.prepare("UPDATE viewer_scores SET score=8 WHERE owner_id='200' AND viewer_id='301'").run();
});
test('HTTP registration, withdrawal and empty settlement advance only the affected activity',async()=>{
 const otherId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',host2=await identity('201','e'),viewer2=await identity('302','9');
 await db.prepare("INSERT INTO activities(id,owner_id,status,rule_version,created_at) VALUES (?,'201','open',1,1)").bind(otherId).run();
 const path=`/api/viewer/201/chance?activity_id=${otherId}&rule_version=1`,read=async()=>await (await req(path,viewer2)).json(),main=async()=>await (await req(`/api/viewer/200/chance?activity_id=${id}&rule_version=1`,viewer)).json();
 const first=await read(),unchanged=await main();assert.equal(first.candidate_revision,0);assert.equal(first.candidate_updated_at,null);
 const body={activity_id:otherId,rule_version:1};assert.equal((await req('/api/viewer/201/register',viewer2,'POST',body)).status,200);const registered=await read();assert.ok(registered.candidate_revision>first.candidate_revision);assert.equal(registered.probability,1);
 assert.equal((await req('/api/viewer/201/withdraw',viewer2,'POST',body)).status,200);const withdrawn=await read();assert.ok(withdrawn.candidate_revision>registered.candidate_revision);assert.equal(withdrawn.probability,null);
 assert.equal((await req(`/api/activities/${otherId}/settlements/empty`,host2,'PUT',{rule_version:1})).status,200);const settled=await read();assert.ok(settled.candidate_revision>withdrawn.candidate_revision);assert.equal(settled.activity_status,'settled');
 assert.equal((await main()).candidate_revision,unchanged.candidate_revision);
});
test('raw public endpoints never include private registration and contact fields',async()=>{for(const path of ['/api/viewer/200','/api/viewer/200/results']){const response=await req(path);assert.equal(response.status,200);const body=await response.json();const visit=value=>{if(Array.isArray(value))for(const x of value)visit(x);else if(value&&typeof value==='object')for(const [key,item] of Object.entries(value)){assert.ok(!/^(?:registrations|viewer_id|winner_id|username|discord_id|contact|score|candidates|probability)$/i.test(key),key);visit(item);}};visit(body);const raw=JSON.stringify(body);for(const value of ['300','301','secret_username','fixture-contact'])assert.ok(!raw.includes(value),value);}});
test('private roster enforces owner even for admin and disabled owner retains access',async()=>{const path=`/api/activities/${id}/roster`;assert.equal((await req(path)).status,401);assert.equal((await req(path,viewer)).status,404);assert.equal((await req(path,other)).status,404);assert.equal((await req(path,admin)).status,404);await db.prepare("UPDATE approved_streamers SET status='disabled' WHERE user_id='200'").run();const r=await req(path,host);assert.equal(r.status,200);const b=await r.json();assert.equal(b.total,2);assert.equal(b.registrations[0].discord_id,'300');assert.equal(b.registrations[0].username,'secret_username');await db.prepare("UPDATE approved_streamers SET status='approved' WHERE user_id='200'").run();});
test('persisted winner projection excludes private fields and survives identity changes',async()=>{await db.prepare("UPDATE registrations SET status='withdrawn' WHERE viewer_id='301'").run();const path=`/api/viewer/200/chance?activity_id=${id}&rule_version=1`,before=await (await req(path,viewer)).json();const r=await req(`/api/activities/${id}/draws/example`,host,'PUT',{rule_version:1});assert.equal(r.status,200);const pub=await req('/api/viewer/200/results');const b=await pub.json();assert.deepEqual(b.winners,[{display_name:'Visible winner'}]);const raw=JSON.stringify(b);for(const forbidden of ['300','301','secret_username','viewer_id','username','score','discord_id','winner_ordinal','probability'])assert.ok(!raw.includes(forbidden),forbidden);await db.prepare("UPDATE discord_identities SET display_name='Changed later',username='other_secret' WHERE user_id='300'").run();assert.deepEqual((await (await req('/api/viewer/200/results')).json()).winners,b.winners);const chance=await (await req(path,viewer)).json();assert.ok(chance.candidate_revision>before.candidate_revision);assert.equal(chance.status,'winner');assert.equal(chance.probability,null);const withdrawn=await (await req(`/api/viewer/200/chance?activity_id=${id}&rule_version=1`,other)).json();assert.equal(withdrawn.status,'withdrawn');assert.equal(withdrawn.probability,null);});
test('roster HTTP total and page agree during concurrent inserts, including empty pages',async()=>{
 const activity='cccccccc-cccc-4ccc-8ccc-cccccccccccc';await db.prepare("INSERT INTO approved_streamers(user_id) VALUES ('202')").run();await db.prepare("INSERT INTO activities(id,owner_id,status,rule_version,created_at) VALUES (?,'202','open',1,1)").bind(activity).run();const h=await identity('202','8'),path=`/api/activities/${activity}/roster`;
 const empty=await (await req(path,h)).json();assert.equal(empty.total,0);assert.deepEqual(empty.registrations,[]);
 const writer=(async()=>{for(let i=1;i<=30;i++)await db.prepare("INSERT INTO registrations(activity_id,owner_id,viewer_id,ordinal) VALUES (?,'202',?,?)").bind(activity,String(5000+i),i).run();})();
 for(let i=0;i<30;i++){const response=await req(path,h);assert.equal(response.status,200);const data=await response.json();assert.equal(data.total,data.registrations.length);assert.equal(data.next_cursor,null);}
 await writer;const beyond=await (await req(path+'?cursor=100',h)).json();assert.equal(beyond.total,30);assert.deepEqual(beyond.registrations,[]);
});
test('roster keyset pagination returns all rows in stable order and accurate total',async()=>{for(let n=0;n<105;n++)await db.prepare("INSERT INTO registrations(activity_id,owner_id,viewer_id,ordinal) VALUES (?,'200',?,?)").bind(id,String(10000+n),n+3).run();let cursor=0,rows=[],total;do{const r=await req(`/api/activities/${id}/roster?cursor=${cursor}`,host);assert.equal(r.status,200);const d=await r.json();total=d.total;rows.push(...d.registrations);cursor=d.next_cursor;}while(cursor!==null);assert.equal(total,107);assert.equal(rows.length,total);assert.deepEqual(rows.map(x=>x.ordinal),Array.from({length:107},(_,i)=>i+1));});
test('fixed entry without a current activity exposes no winners',async()=>{assert.deepEqual(await (await req('/api/viewer/201')).json(),{activity:null});assert.deepEqual(await (await req('/api/viewer/201/results')).json(),{winners:[],next_cursor:null});assert.equal((await req('/api/viewer/200/results?cursor=-1')).status,400);});
test('settled result and contact remain readable only to the owner through real HTTP',async()=>{
 const settled=await req(`/api/activities/${id}/settlements/results-test`,host,'PUT',{rule_version:1});assert.equal(settled.status,200);assert.equal((await settled.json()).status,'settled');
 assert.equal((await (await req('/api/viewer/200')).json()).activity,null);
 assert.deepEqual(await (await req('/api/viewer/200/results')).json(),{winners:[],next_cursor:null});
 const history=await req('/api/activities/history',host);assert.equal(history.status,200);assert.ok((await history.json()).activities.some(a=>a.id===id&&a.status==='settled'));
 const path=`/api/activities/${id}/roster`;for(const h of [viewer,other,admin])assert.equal((await req(path,h)).status,404);assert.equal((await req(path)).status,401);
 const roster=await req(path,host);assert.equal(roster.status,200);const data=await roster.json();assert.equal(data.activity.status,'settled');assert.equal(data.registrations[0].status,'winner');assert.equal(data.registrations[0].discord_id,'300');assert.equal(data.registrations[0].username,'other_secret');
});
after(()=>mf.dispose());
