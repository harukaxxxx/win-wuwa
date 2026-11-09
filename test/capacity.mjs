// Local synthetic capacity test. Run only against isolated Miniflare, never a real account.
import assert from 'node:assert/strict';
import {readFile,readdir,writeFile,appendFile,mkdir} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
const origin='http://127.0.0.1:19689', evidence=process.env.CAPACITY_EVIDENCE ?? 'evidence/issue22';
await mkdir(evidence,{recursive:true});await writeFile(`${evidence}/requests.jsonl`,'');
const mf=new Miniflare(convertV4MiniflareOptions({port:19689,host:'127.0.0.1',modules:true,scriptPath:'dist/capacity-worker.js',compatibilityDate:'2026-07-30',d1Databases:['DB'],bindings:{ORIGIN:origin},outboundService:()=>{throw Error('unexpected outbound request');}}));
const db=await mf.getD1Database('DB');
const hash=x=>createHash('sha256').update(x).digest('hex');
const sums={};let requests=0;
async function request(stage,path,headers,method,body){const start=performance.now();const res=await fetch(origin+path,{method,headers,body:JSON.stringify(body)});const text=await res.text();const m=JSON.parse(res.headers.get('x-capacity-metrics')??'null');assert.ok(m,'missing instrumentation');assert.equal(m.missing,0);const elapsed_ms=+(performance.now()-start).toFixed(2);const row={stage,path,status:res.status,elapsed_ms,...m};await appendFile(`${evidence}/requests.jsonl`,JSON.stringify(row)+'\n');const s=sums[stage]??={requests:0,rows_read:0,rows_written:0,statements:0,elapsed_ms:0,max_ms:0};s.requests++;for(const k of ['rows_read','rows_written','statements'])s[k]+=m[k];s.elapsed_ms+=elapsed_ms;s.max_ms=Math.max(s.max_ms,elapsed_ms);requests++;return {status:res.status,text,m};}
function headers(sid){const csrf='f'.repeat(64);return {Cookie:`__Host-session=${sid}`,Origin:origin,'X-CSRF-Token':csrf,'Content-Type':'application/json'};}
const sid=n=>n.toString(16).padStart(64,'0');
try{
 for(const f of (await readdir('migrations')).sort())for(const sql of (await readFile('migrations/'+f,'utf8')).split(/;\s*(?=(?:CREATE|ALTER|INSERT|UPDATE|DROP|$))/i).map(x=>x.trim()).filter(Boolean))await db.prepare(sql).run();
 const owners=Array.from({length:5},(_,i)=>({id:String(200+i),activity:randomUUID(),headers:headers(sid(i+1))}));
 const viewers=Array.from({length:500},(_,i)=>({id:String(100000+i),headers:headers(sid(i+100))}));
 const sessions=[...owners.map((o,i)=>({id:o.id,sid:sid(i+1)})),...viewers.map((v,i)=>({id:v.id,sid:sid(i+100)}))];
 const exp=Math.floor(Date.now()/1000)+7200,csrf=hash('f'.repeat(64));
 await db.prepare("INSERT INTO sessions SELECT json_extract(value,'$.hash'),json_extract(value,'$.id'),?,? FROM json_each(?)").bind(csrf,exp,JSON.stringify(sessions.map(x=>({id:x.id,hash:hash(x.sid)})))).run();
 const historic=Array.from({length:1101},(_,i)=>String(300000+i));
 for(const o of owners){await db.prepare('INSERT INTO approved_streamers(user_id) VALUES (?)').bind(o.id).run();await db.prepare("INSERT INTO activities(id,owner_id,status,rule_version,created_at) VALUES (?,?,'open',1,1)").bind(o.activity,o.id).run();await db.prepare('INSERT INTO viewer_scores(owner_id,viewer_id,score) SELECT ?,value,5 FROM json_each(?)').bind(o.id,JSON.stringify([...historic,...viewers.map(v=>v.id)])).run();}
 console.log('fixture: 5 owners, 500 viewer identities, 1101 distinct absent historical scores per owner; SQL fixture excluded from request metrics');
 // Real registration HTTP requests; 25 at a time, 5 owners operate concurrently.
 for(let offset=0;offset<500;offset+=25){await Promise.all(owners.flatMap(o=>viewers.slice(offset,offset+25).map(async v=>{const r=await request('register',`/api/viewer/${o.id}/register`,v.headers,'POST',{activity_id:o.activity,rule_version:1});assert.equal(r.status,200,r.text);})));}
 for(const o of owners)assert.equal((await db.prepare('SELECT count(*) n FROM registrations WHERE activity_id=?').bind(o.activity).first()).n,500);
 console.log('PASS registrations: 2500 HTTP 200, 500 per owner');
 for(let i=0;i<20;i++){
  await Promise.all(owners.map(async o=>{const r=await request('draw',`/api/activities/${o.activity}/draws/draw-${i}`,o.headers,'PUT',{rule_version:1});assert.equal(r.status,200,r.text);}));
  for(const o of owners){const row=await db.prepare('SELECT count(*) n FROM draw_candidates WHERE draw_id=(SELECT id FROM draws WHERE activity_id=? AND request_key=?)').bind(o.activity,`draw-${i}`).first();assert.equal(row.n,500-i);}
  console.log(`PASS draw ${i+1}/20: 5 concurrent owners, snapshot ${500-i} each`);
 }
 for(const o of owners){const n=await db.prepare('SELECT count(*) n,count(DISTINCT winner_id) distinct_n FROM draws WHERE activity_id=?').bind(o.activity).first();assert.equal(n.n,20);assert.equal(n.distinct_n,20);}
 await Promise.all(owners.map(async o=>{for(let i=0;i<10;i++){const r=await request('settle',`/api/activities/${o.activity}/settlements/end`,o.headers,'PUT',{rule_version:1});assert.ok([200,202].includes(r.status),r.text);if(r.status===200)return;}throw Error('settlement did not finish');}));
 for(const o of owners){const row=await db.prepare(`SELECT count(*) n,sum(CASE WHEN viewer_id BETWEEN '300000' AND '301100' AND score=4 THEN 1 ELSE 0 END) absent_correct,sum(CASE WHEN viewer_id BETWEEN '100000' AND '100499' AND score=6 THEN 1 ELSE 0 END) remaining_correct,sum(CASE WHEN viewer_id BETWEEN '100000' AND '100499' AND score=0 THEN 1 ELSE 0 END) winner_correct FROM viewer_scores WHERE owner_id=?`).bind(o.id).first();assert.deepEqual(row,{n:1601,absent_correct:1101,remaining_correct:480,winner_correct:20});assert.equal((await db.prepare('SELECT status FROM activities WHERE id=?').bind(o.activity).first()).status,'settled');}
 console.log('PASS settlement: each owner 1101/1101 absences score 5→4, 480 registered 5→6, 20 winners 0, 1601 score rows preserved');
 await Promise.all(owners.map(async o=>{const r=await request('history','/api/activities/history',o.headers,'GET');assert.equal(r.status,200,r.text);const body=JSON.parse(r.text);assert.ok(body.activities.some(a=>a.id===o.activity&&a.status==='settled'));assert.equal(body.next_cursor,null);}));
 console.log('PASS history: 5 authenticated owners read back their settled activity');
 const indexes=(await db.prepare("SELECT name,tbl_name,sql FROM sqlite_master WHERE type='index' ORDER BY tbl_name,name").all()).results;
 const tableCounts={};for(const table of ['viewer_scores','registrations','draws','draw_candidates','activity_settlements'])tableCounts[table]=(await db.prepare(`SELECT count(*) n FROM ${table}`).first()).n;
 const storageMeta=(await db.prepare('SELECT 1').all()).meta;
 let dbstat;try{dbstat=(await db.prepare('SELECT name, sum(pgsize) bytes FROM dbstat GROUP BY name ORDER BY name').all()).results;}catch(e){dbstat={unavailable:String(e)};}
 const report={generated_at:new Date().toISOString(),synthetic:true,scenario:{owners:5,registrations_per_owner:500,historical_absent_per_owner:1101,draws_per_owner:20},requests,stages:sums,tableCounts,indexes,sqlite:{size_after:storageMeta.size_after,dbstat}};
 await writeFile(`${evidence}/summary.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}catch(error){console.error('FAIL',error);process.exitCode=1;}finally{await mf.dispose();}
