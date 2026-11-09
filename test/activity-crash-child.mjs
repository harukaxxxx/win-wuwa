import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
const [mode,dir]=process.argv.slice(2), origin='http://localhost', sid='a'.repeat(64), csrf='b'.repeat(64), id='12345678-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const hash=x=>createHash('sha256').update(x).digest('hex');
const headers={Cookie:`__Host-session=${sid}; __Host-csrf=${csrf}`,Origin:origin,'X-CSRF-Token':csrf,'Content-Type':'application/json'};
const mf=new Miniflare({...convertV4MiniflareOptions({modules:true,scriptPath:process.env.WUWA_TEST_BUNDLE||'dist/index.js',compatibilityDate:'2026-07-30',d1Databases:['DB'],bindings:{ORIGIN:origin}}),resourcePersistencePath:dir});
const db=await mf.getD1Database('DB');
const send=(path,method='GET',body)=>mf.dispatchFetch(origin+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
try {
 if(mode==='commit'){
  for(const f of ['migrations/0001_init.sql','migrations/0002_login_budget.sql','migrations/0003_streamer_status.sql','migrations/0004_activities.sql','migrations/0005_opening_generation.sql','migrations/0006_activity_defaults.sql','migrations/0010_guild_invite.sql']) for(const q of (await readFile(f,'utf8')).split(';').map(x=>x.trim()).filter(Boolean)) await db.prepare(q).run();
  await db.prepare("INSERT INTO approved_streamers(user_id) VALUES ('10')").run();
  await db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').bind(hash(sid),'10',hash(csrf),Math.floor(Date.now()/1000)+300).run();
  for(const [viewer,score] of [['101',3],['102',10],['103',1]]) await db.prepare('INSERT INTO viewer_scores VALUES (?,?,?)').bind('10',viewer,score).run();
  const r=await send('/api/activities/'+id,'PUT',{rule_version:1,expected_generation:0,guild_id:'456789'});
  if(r.status!==201)throw Error('open failed '+r.status);
  // The parent receives only a commit marker, never the HTTP result or activity ID.
  process.send({event:'committed'}); setInterval(()=>{},1000);
 } else {
  const retry=await send('/api/activities/'+id,'PUT',{rule_version:1,expected_generation:0,guild_id:'456789'}), activity=(await retry.json()).activity;
  const conflict=await send('/api/activities/22345678-aaaa-4aaa-8aaa-aaaaaaaaaaaa','PUT',{rule_version:1,expected_generation:0,guild_id:'456789'});
  const current=await send('/api/activities/current');
  const rows=(await db.prepare('SELECT viewer_id,score FROM activity_score_baselines WHERE activity_id=? ORDER BY viewer_id').bind(id).all()).results;
  const count=await db.prepare('SELECT COUNT(*) n FROM activities WHERE owner_id=?').bind('10').first();
  await mf.dispose(); process.send({event:'restored',retry:retry.status,activity,conflict:conflict.status,current:await current.json(),rows,count},()=>process.disconnect());
 }
} catch(e){console.error(e);try{await mf.dispose();}catch{}process.send?.({event:'error',message:String(e)},()=>process.disconnect());process.exitCode=1;}
