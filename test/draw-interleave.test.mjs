import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
const origin='http://127.0.0.1:19644', id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
test('commit-boundary candidate, score, disable and failure interleavings',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'draw-interleave-'));
 execFileSync('node_modules/.bin/esbuild',['test/draw-interleave-worker.mjs','--bundle','--format=esm','--platform=browser',`--outfile=${dir}/worker.js`],{stdio:'pipe'});
 const mf=new Miniflare(convertV4MiniflareOptions({port:19644,host:'127.0.0.1',modules:true,script:await readFile(`${dir}/worker.js`,'utf8'),compatibilityDate:'2026-07-30',d1Databases:['DB'],bindings:{ORIGIN:origin}}));
 try {
  const db=await mf.getD1Database('DB');for(const f of (await readdir('migrations')).sort())for(const sql of (await readFile('migrations/'+f,'utf8')).split(/;\s*(?=(?:CREATE|ALTER|INSERT|UPDATE|DROP|$))/i).map(x=>x.trim()).filter(Boolean))await db.prepare(sql).run();
  const hash=x=>createHash('sha256').update(x).digest('hex'),sid='a'.repeat(64),csrf='f'.repeat(64);
  await db.prepare("INSERT INTO approved_streamers(user_id) VALUES ('210')").run();
  await db.prepare("INSERT INTO activities(id,owner_id,status,rule_version,created_at) VALUES (?,'210','open',1,1)").bind(id).run();
  await db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').bind(hash(sid),'210',hash(csrf),Math.floor(Date.now()/1000)+3600).run();
  const headers={Cookie:`__Host-session=${sid}`,Origin:origin,'X-CSRF-Token':csrf,'Content-Type':'application/json'};
  const send=mode=>mf.dispatchFetch(`${origin}/api/activities/${id}/draws/key`,{method:'PUT',headers:{...headers,'x-test-interleave':mode},body:JSON.stringify({rule_version:1})});
  async function reset(){await db.batch([db.prepare('DELETE FROM draw_candidates'),db.prepare('DELETE FROM draws'),db.prepare('DELETE FROM registrations'),db.prepare('DELETE FROM viewer_scores'),db.prepare("UPDATE approved_streamers SET status='approved' WHERE user_id='210'"),db.prepare("UPDATE activities SET status='open' WHERE id=?").bind(id),db.prepare("INSERT INTO registrations(activity_id,owner_id,viewer_id,ordinal) VALUES (?,'210','700',1)").bind(id),db.prepare("INSERT INTO viewer_scores VALUES ('210','700',7)")]);}
  for(const mode of ['winner-disable','winner-terminal','winner-empty']) await t.test(`same key committed after lookup before ${mode}`,async()=>{await reset();const r=await send(mode);assert.equal(r.status,200);assert.equal((await r.json()).draw.winner_ordinal,1);assert.equal((await db.prepare('SELECT count(*) AS n FROM draws').first()).n,1);});
  await t.test('registration after read is included after retry',async()=>{await reset();assert.equal((await send('register')).status,200);const rows=await db.prepare('SELECT viewer_id FROM draw_candidates ORDER BY viewer_id').all();assert.deepEqual(rows.results,[{viewer_id:'700'},{viewer_id:'701'}]);});
  await t.test('withdrawal after read wins and no draw commits',async()=>{await reset();assert.equal((await send('withdraw')).status,409);assert.equal((await db.prepare('SELECT count(*) AS n FROM draws').first()).n,0);assert.equal((await db.prepare("SELECT score FROM viewer_scores WHERE viewer_id='700'").first()).score,7);});
  await t.test('score change after read retries with current score',async()=>{await reset();assert.equal((await send('score')).status,200);assert.equal((await db.prepare('SELECT score FROM draw_candidates').first()).score,8);});
  await t.test('disable after read prevents commit',async()=>{await reset();assert.equal((await send('disable')).status,409);assert.equal((await db.prepare('SELECT count(*) AS n FROM draws').first()).n,0);});
  await t.test('later statement failure rolls back draw and winner reset',async()=>{await reset();assert.equal((await send('failbatch')).status,500);assert.equal((await db.prepare('SELECT count(*) AS n FROM draws').first()).n,0);assert.equal((await db.prepare("SELECT status FROM registrations WHERE viewer_id='700'").first()).status,'registered');assert.equal((await db.prepare("SELECT score FROM viewer_scores WHERE viewer_id='700'").first()).score,7);});
 } finally {await mf.dispose();await rm(dir,{recursive:true,force:true});}
});
