import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const [mode, dir]=process.argv.slice(2);
const origin='http://localhost', sid='a'.repeat(64), csrf='b'.repeat(64);
const digest=x=>createHash('sha256').update(x).digest('hex');
const headers={Cookie:`__Host-session=${sid}`,Origin:origin,'X-CSRF-Token':csrf,'Content-Type':'application/json'};
const mf=new Miniflare({...convertV4MiniflareOptions({modules:true,scriptPath:'dist/index.js',compatibilityDate:'2026-07-30',d1Databases:['DB'],bindings:{ORIGIN:origin}}),resourcePersistencePath:dir});
try {
 if(mode==='commit') {
  const db=await mf.getD1Database('DB');
  for(const f of ['migrations/0001_init.sql','migrations/0002_login_budget.sql','migrations/0003_streamer_status.sql']) for(const q of (await readFile(f,'utf8')).split(';').map(x=>x.trim()).filter(Boolean)) await db.prepare(q).run();
  await db.prepare('INSERT INTO approved_streamers(user_id) VALUES (?)').bind('10').run();
  await db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').bind(digest(sid),'10',digest(csrf),Math.floor(Date.now()/1000)+300).run();
  const res=await mf.dispatchFetch(origin+'/api/environment',{method:'PUT',headers,body:JSON.stringify({value:'committed',version:0})});
  const body=await res.json();
  if(res.status!==200 || body.value!=='committed' || body.version!==1) throw new Error('commit not acknowledged');
  process.send({event:'committed'});
  // Stay alive until the parent kills this process, without disposing Miniflare.
  setInterval(()=>{},1000);
 } else if(mode==='restore') {
  const get=()=>mf.dispatchFetch(origin+'/api/environment',{headers});
  const first=await get(); const original=await first.json();
  const retry=await mf.dispatchFetch(origin+'/api/environment',{method:'PUT',headers,body:JSON.stringify({value:'stale',version:0})});
  const last=await get(); const after=await last.json();
  await mf.dispose();
  process.send({event:'restored',firstStatus:first.status,original,retryStatus:retry.status,lastStatus:last.status,after},()=>process.disconnect());
 } else throw new Error('unknown mode');
} catch {
 try { await mf.dispose(); } catch {}
 process.send?.({event:'error'},()=>process.disconnect());
 process.exitCode=1;
}
