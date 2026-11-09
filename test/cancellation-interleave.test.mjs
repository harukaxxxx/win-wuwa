import {test} from 'node:test';import assert from 'node:assert/strict';
import {readFile,readdir,mkdtemp,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {execFileSync} from 'node:child_process';import {createHash,randomUUID} from 'node:crypto';import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
test('cancellation exact SQL commit-boundary interleavings',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'cancel-boundary-'));execFileSync('node_modules/.bin/esbuild',['test/cancellation-interleave-worker.mjs','--bundle','--format=esm','--platform=browser',`--outfile=${dir}/worker.js`]);
 const origin='http://127.0.0.1:19819',mf=new Miniflare(convertV4MiniflareOptions({port:19819,host:'127.0.0.1',modules:true,script:await readFile(`${dir}/worker.js`,'utf8'),compatibilityDate:'2026-07-30',d1Databases:['DB'],bindings:{ORIGIN:origin}}));
 try{
  const db=await mf.getD1Database('DB');for(const f of (await readdir('migrations')).sort())for(const q of (await readFile('migrations/'+f,'utf8')).split(/;\s*(?=(?:CREATE|ALTER|INSERT|UPDATE|DROP|$))/i).map(x=>x.trim()).filter(Boolean))await db.prepare(q).run();
  const hash=x=>createHash('sha256').update(x).digest('hex'),csrf='f'.repeat(64),sid='a'.repeat(64),vsid='b'.repeat(64);
  await db.prepare("INSERT INTO approved_streamers(user_id) VALUES ('250')").run();await db.prepare("INSERT INTO sessions VALUES (?,'250',?,unixepoch()+3600),(?,'400',?,unixepoch()+3600)").bind(hash(sid),hash(csrf),hash(vsid),hash(csrf)).run();
  const headers={Cookie:`__Host-session=${sid}`,Origin:origin,'X-CSRF-Token':csrf,'Content-Type':'application/json','x-test-viewer':`__Host-session=${vsid}`};
  const send=(id,op,h=headers)=>mf.dispatchFetch(origin+`/api/activities/${id}/${op}/main`,{method:'PUT',headers:h,body:JSON.stringify({rule_version:1})});
  for(const mode of ['settle-before-cancel','cancel-before-settle','cancel-before-draw','draw-before-cancel','register-before-cancel','register-after-cancel','withdraw-before-cancel','withdraw-after-cancel'])await t.test(mode,async()=>{
   const id=randomUUID();await db.prepare("INSERT INTO activities(id,owner_id,status,rule_version,created_at) VALUES (?,'250','open',1,1)").bind(id).run();
   if(mode==='cancel-before-draw'||mode==='draw-before-cancel'||mode.startsWith('withdraw-'))await db.prepare("INSERT INTO registrations(activity_id,owner_id,viewer_id,ordinal) VALUES (?,'250','400',1)").bind(id).run();
   if(mode==='draw-before-cancel'){await db.prepare("INSERT INTO viewer_scores VALUES ('250','400',7) ON CONFLICT(owner_id,viewer_id) DO UPDATE SET score=7").run();await db.prepare("INSERT INTO activity_score_baselines VALUES (?,'250','400',7)").bind(id).run();}
   const op=mode==='cancel-before-settle'?'settlements':mode==='cancel-before-draw'?'draws':'cancellations';const r=await send(id,op,{...headers,'x-test-mode':mode});
   assert.equal(r.status,mode==='settle-before-cancel'||mode==='cancel-before-settle'||mode==='cancel-before-draw'?409:200);
   assert.equal(r.headers.get('x-test-nested-status'),mode.endsWith('after-cancel')?'409':'200');
   assert.equal((await db.prepare('SELECT status FROM activities WHERE id=?').bind(id).first()).status,mode==='settle-before-cancel'?'settled':'cancelled');
   if(mode.startsWith('register-'))assert.equal((await db.prepare('SELECT COUNT(*) n FROM registrations WHERE activity_id=?').bind(id).first()).n,mode==='register-before-cancel'?1:0);
   if(mode==='cancel-before-draw')assert.equal((await db.prepare('SELECT COUNT(*) n FROM draws WHERE activity_id=?').bind(id).first()).n,0);
   if(mode==='draw-before-cancel'){assert.equal((await db.prepare('SELECT COUNT(*) n FROM draws WHERE activity_id=?').bind(id).first()).n,1);assert.equal((await db.prepare("SELECT score FROM viewer_scores WHERE owner_id='250' AND viewer_id='400'").first()).score,7);}
   if(mode.startsWith('withdraw-'))assert.equal((await db.prepare('SELECT status FROM registrations WHERE activity_id=?').bind(id).first()).status,mode==='withdraw-before-cancel'?'withdrawn':'registered');
  });
  for(const mode of ['revoke-cancel','expire-cancel','revoke-page','expire-page','revoke-finish','expire-finish'])await t.test(mode,async()=>{
   const id=randomUUID(),rawsid=randomUUID().replaceAll('-','').repeat(2),sessionHash=hash(rawsid);await db.prepare('INSERT INTO sessions VALUES (?,\'250\',?,unixepoch()+3600)').bind(sessionHash,hash(csrf)).run();
   await db.prepare("INSERT INTO activities(id,owner_id,status,rule_version,created_at) VALUES (?,'250','open',1,1)").bind(id).run();
   if(!mode.endsWith('cancel')){await db.prepare("UPDATE activities SET status='cancelling' WHERE id=?").bind(id).run();await db.prepare("INSERT INTO activity_cancellations(activity_id,owner_id) VALUES (?,'250')").bind(id).run();}
   if(mode.endsWith('page')){await db.prepare("INSERT INTO viewer_scores VALUES ('250','500',0) ON CONFLICT(owner_id,viewer_id) DO UPDATE SET score=0").run();await db.prepare("INSERT INTO activity_score_baselines VALUES (?,'250','500',7)").bind(id).run();await db.prepare("INSERT INTO draws(id,activity_id,owner_id,request_key,rule_version,winner_id,winner_ordinal,created_at) VALUES (?,?,'250','x',1,'500',1,1)").bind(randomUUID(),id).run();}
   const h={...headers,Cookie:`__Host-session=${rawsid}`,'x-test-mode':mode,'x-test-session-hash':sessionHash};const r=await send(id,'cancellations',h);assert.equal(r.headers.get('x-test-nested-status'),mode);assert.equal(r.status,500);
   assert.equal((await db.prepare('SELECT status FROM activities WHERE id=?').bind(id).first()).status,mode.endsWith('cancel')?'open':'cancelling');
   const j=await db.prepare('SELECT cursor,completed_at FROM activity_cancellations WHERE activity_id=?').bind(id).first();assert.deepEqual(j,mode.endsWith('cancel')?null:{cursor:'',completed_at:null});
   if(mode.endsWith('page'))assert.equal((await db.prepare("SELECT score FROM viewer_scores WHERE owner_id='250' AND viewer_id='500'").first()).score,0);
   assert.equal((await send(id,'cancellations')).status,200);
  });
 }finally{await mf.dispose();await rm(dir,{recursive:true,force:true});}
});
