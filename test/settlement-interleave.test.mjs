import {test} from 'node:test';import assert from 'node:assert/strict';
import {readFile,readdir,mkdtemp,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {execFileSync} from 'node:child_process';import {createHash,randomUUID} from 'node:crypto';import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
test('real D1 commit-boundary interleavings',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'settlement-boundary-'));execFileSync('node_modules/.bin/esbuild',['test/settlement-interleave-worker.mjs','--bundle','--format=esm','--platform=browser',`--outfile=${dir}/worker.js`]);
 const origin='http://127.0.0.1:19771';const mf=new Miniflare(convertV4MiniflareOptions({port:19771,host:'127.0.0.1',modules:true,script:await readFile(`${dir}/worker.js`,'utf8'),compatibilityDate:'2026-07-30',d1Databases:['DB'],bindings:{ORIGIN:origin}}));
 try{
  const db=await mf.getD1Database('DB');for(const f of (await readdir('migrations')).sort())for(const q of (await readFile('migrations/'+f,'utf8')).split(';').map(x=>x.trim()).filter(Boolean))await db.prepare(q).run();
  const hash=x=>createHash('sha256').update(x).digest('hex'),csrf='f'.repeat(64);async function session(id,c){const sid=c.repeat(64);await db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').bind(hash(sid),id,hash(csrf),Math.floor(Date.now()/1000)+3600).run();return `__Host-session=${sid}`;}
  const host=await session('250','a'),viewer=await session('400','b');await db.prepare("INSERT INTO approved_streamers(user_id) VALUES ('250')").run();
  const headers={Cookie:host,Origin:origin,'X-CSRF-Token':csrf,'Content-Type':'application/json','x-test-viewer':viewer};
  for(const mode of ['before-register','after-register','before-withdraw','after-withdraw','before-draw','nested-settle','draw-before-end'])await t.test(mode,async()=>{
   const id=randomUUID();await db.prepare("INSERT INTO activities(id,owner_id,status,rule_version,created_at) VALUES (?,'250','open',1,1)").bind(id).run();
   await db.prepare("INSERT INTO viewer_scores VALUES ('250','400',4) ON CONFLICT(owner_id,viewer_id) DO UPDATE SET score=4").run();
   await db.prepare("INSERT INTO registrations(activity_id,owner_id,viewer_id,ordinal) VALUES (?,'250','999',1)").bind(id).run();
   const send=(path,h)=>mf.dispatchFetch(origin+path,{method:'PUT',headers:h,body:JSON.stringify({rule_version:1})});
   if(mode!=='draw-before-end'&&mode!=='before-draw')assert.equal((await send(`/api/activities/${id}/draws/initial`,headers)).status,200);
   if(mode.includes('withdraw'))await db.prepare("INSERT INTO registrations(activity_id,owner_id,viewer_id,ordinal) VALUES (?,'250','400',2)").bind(id).run();
   const path=mode==='draw-before-end'?`/api/activities/${id}/draws/late`:`/api/activities/${id}/settlements/main`;
   const r=await send(path,{...headers,'x-test-mode':mode});
   assert.equal(r.headers.get('x-test-nested-status'),mode==='after-register'||mode==='after-withdraw'?'409':'200');
   assert.equal(r.status,mode==='draw-before-end'?409:200);
   const score=(await db.prepare("SELECT score FROM viewer_scores WHERE owner_id='250' AND viewer_id='400'").first()).score;
   const expected=mode==='before-register'||mode==='after-withdraw'?5:mode==='draw-before-end'||mode==='before-withdraw'?4:3;
   assert.equal(score,expected);
   assert.equal((await db.prepare('SELECT status FROM activities WHERE id=?').bind(id).first()).status,'settled');
   if(mode==='draw-before-end')assert.equal((await db.prepare('SELECT count(*) AS n FROM draws WHERE activity_id=?').bind(id).first()).n,0);
  });
  for(const [i,mode] of ['revoke-fence','expire-fence','revoke-page','expire-page','revoke-finish','expire-finish'].entries())await t.test(mode,async()=>{
   const owner=String(260+i),id=randomUUID(),sid=(100+i).toString(16).padStart(64,'0');
   await db.prepare('INSERT INTO approved_streamers(user_id) VALUES (?)').bind(owner).run();
   await db.prepare('INSERT INTO sessions VALUES (?,?,?,unixepoch()+3600)').bind(hash(sid),owner,hash(csrf)).run();
   const h={Cookie:`__Host-session=${sid}`,Origin:origin,'X-CSRF-Token':csrf,'Content-Type':'application/json'};
   await db.prepare("INSERT INTO activities(id,owner_id,status,rule_version,created_at) VALUES (?,?,'open',1,1)").bind(id,owner).run();
   const send=(path,headers)=>mf.dispatchFetch(origin+path,{method:'PUT',headers,body:JSON.stringify({rule_version:1})});
   if(mode.endsWith('page')){
    await db.prepare('INSERT INTO viewer_scores(owner_id,viewer_id,score) SELECT ?,value,5 FROM json_each(?)').bind(owner,JSON.stringify(Array.from({length:120},(_,n)=>String(1000+n)))).run();
    await db.prepare('INSERT INTO registrations(activity_id,owner_id,viewer_id,ordinal) VALUES (?,?,?,1)').bind(id,owner,'9000').run();
    assert.equal((await send(`/api/activities/${id}/draws/start`,h)).status,200);
    await db.prepare('INSERT INTO registrations(activity_id,owner_id,viewer_id,ordinal) VALUES (?,?,?,2)').bind(id,owner,'1001').run();
   }
   if(!mode.endsWith('fence')){
    await db.prepare("UPDATE activities SET status='settling' WHERE id=?").bind(id).run();
    await db.prepare('INSERT INTO activity_settlements(activity_id,owner_id,has_draw) VALUES (?,?,?)').bind(id,owner,mode.endsWith('page')?1:0).run();
   }
   const rows=async()=>(await db.prepare('SELECT * FROM viewer_scores WHERE owner_id=? ORDER BY viewer_id').bind(owner).all()).results;
   const before=await rows(),path=`/api/activities/${id}/settlements/exact-key`;
   const r=await send(path,{...h,'x-test-mode':mode,'x-test-session-hash':hash(sid)});
   assert.equal(r.headers.get('x-test-nested-status'),mode);
   assert.deepEqual(await rows(),before,'session invalidation must not mutate scores');
   const state=await db.prepare('SELECT status FROM activities WHERE id=?').bind(id).first();
   const journal=await db.prepare('SELECT cursor,completed_at FROM activity_settlements WHERE activity_id=?').bind(id).first();
   assert.equal(state.status,mode.endsWith('fence')?'open':'settling');
   assert.deepEqual(journal,mode.endsWith('fence')?null:{cursor:'',completed_at:null});
   await assert.rejects(db.prepare("INSERT INTO activities(id,owner_id,status,rule_version,created_at) VALUES (?,?,'open',1,1)").bind(randomUUID(),owner).run());
   const fresh=(200+i).toString(16).padStart(64,'0');await db.prepare('INSERT INTO sessions VALUES (?,?,?,unixepoch()+3600)').bind(hash(fresh),owner,hash(csrf)).run();
   const freshHeaders={...h,Cookie:`__Host-session=${fresh}`};
   assert.equal((await send(path,freshHeaders)).status,200);
   assert.equal((await db.prepare('SELECT status FROM activities WHERE id=?').bind(id).first()).status,'settled');
   const final=await rows();assert.equal((await send(path,freshHeaders)).status,200);assert.deepEqual(await rows(),final);
   if(mode.endsWith('page')){assert.equal(final.find(x=>x.viewer_id==='1000').score,4);assert.equal(final.find(x=>x.viewer_id==='1001').score,6);}
  });
  await t.test('expiry between statements rolls back whole page',async()=>{
   const owner='270',id=randomUUID(),sid='9'.repeat(64);
   await db.prepare('INSERT INTO approved_streamers(user_id) VALUES (?)').bind(owner).run();
   await db.prepare('INSERT INTO sessions VALUES (?,?,?,unixepoch()+3600)').bind(hash(sid),owner,hash(csrf)).run();
   await db.prepare("INSERT INTO activities(id,owner_id,status,rule_version,created_at) VALUES (?,?,'settling',1,1)").bind(id,owner).run();
   await db.prepare('INSERT INTO activity_settlements(activity_id,owner_id,has_draw) VALUES (?,?,1)').bind(id,owner).run();
   await db.prepare("INSERT INTO registrations(activity_id,owner_id,viewer_id,ordinal) VALUES (?,?,'1001',1)").bind(id,owner).run();
   await db.prepare("INSERT INTO viewer_scores VALUES (?,'1001',5),(?,'1002',5)").bind(owner,owner).run();
   await db.prepare(`CREATE TRIGGER expire_in_page AFTER UPDATE OF score ON viewer_scores WHEN NEW.owner_id='270' AND NEW.viewer_id='1001' BEGIN UPDATE sessions SET expires=unixepoch() WHERE user_id='270'; END`).run();
   const h={Cookie:`__Host-session=${sid}`,Origin:origin,'X-CSRF-Token':csrf,'Content-Type':'application/json'};
   const send=()=>mf.dispatchFetch(origin+`/api/activities/${id}/settlements/exact-key`,{method:'PUT',headers:h,body:JSON.stringify({rule_version:1})});
   assert.equal((await send()).status,500);
   assert.deepEqual((await db.prepare('SELECT viewer_id,score FROM viewer_scores WHERE owner_id=? ORDER BY viewer_id').bind(owner).all()).results,[{viewer_id:'1001',score:5},{viewer_id:'1002',score:5}]);
   assert.deepEqual(await db.prepare('SELECT cursor,completed_at FROM activity_settlements WHERE activity_id=?').bind(id).first(),{cursor:'',completed_at:null});
   assert.equal((await db.prepare('SELECT status FROM activities WHERE id=?').bind(id).first()).status,'settling');
   await db.prepare('DROP TRIGGER expire_in_page').run();assert.equal((await send()).status,200);
   assert.deepEqual((await db.prepare('SELECT viewer_id,score FROM viewer_scores WHERE owner_id=? ORDER BY viewer_id').bind(owner).all()).results,[{viewer_id:'1001',score:6},{viewer_id:'1002',score:4}]);
  });
 }finally{await mf.dispose();await rm(dir,{recursive:true,force:true});}
});
