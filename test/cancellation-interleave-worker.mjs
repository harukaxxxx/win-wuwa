import worker from '../src/index';
export default {async fetch(req,env){
 let mode=req.headers.get('x-test-mode'),nested='none';const raw=env.DB,marked=new WeakMap(),id=new URL(req.url).pathname.split('/')[3];
 const db={prepare(sql){const stmt=raw.prepare(sql),kind=sql.startsWith("UPDATE activities SET status='cancelling'")?'cancel':sql.startsWith("UPDATE activities SET status='settling'")?'settle':sql.startsWith('UPDATE viewer_scores SET score=COALESCE')?'page':sql.startsWith('UPDATE activity_cancellations SET completed_at=')?'finish':sql.startsWith('INSERT INTO draws(id,')?'draw':null;if(!kind)return stmt;return {bind(...args){const q=stmt.bind(...args);marked.set(q,kind);return q;}};},async batch(stmts){const kind=marked.get(stmts[0]),m=mode;
  if(m===`revoke-${kind}`||m===`expire-${kind}`){mode=null;const digest=req.headers.get('x-test-session-hash');if(m.startsWith('revoke-'))await raw.prepare('DELETE FROM sessions WHERE session_hash=?').bind(digest).run();else await raw.prepare('UPDATE sessions SET expires=unixepoch() WHERE session_hash=?').bind(digest).run();nested=m;}
  if((m==='settle-before-cancel'&&kind==='cancel')||(m==='cancel-before-settle'&&kind==='settle')||(m==='cancel-before-draw'&&kind==='draw')||(['draw-before-cancel','register-before-cancel','register-after-cancel','withdraw-before-cancel','withdraw-after-cancel'].includes(m)&&kind==='cancel')){
   mode=null;const run=async()=>{const h=new Headers(req.headers);h.delete('x-test-mode');let path,method='PUT',body={rule_version:1};if(m.startsWith('register-')||m.startsWith('withdraw-')){path=`/api/viewer/250/${m.startsWith('register-')?'register':'withdraw'}`;method='POST';h.set('Cookie',req.headers.get('x-test-viewer'));body={activity_id:id,rule_version:1};}else path=`/api/activities/${id}/${m==='settle-before-cancel'?'settlements':m==='draw-before-cancel'?'draws':'cancellations'}/nested`;const r=await worker.fetch(new Request(new URL(path,req.url),{method,headers:h,body:JSON.stringify(body)}),env);nested=String(r.status);};
   if(m.endsWith('after-cancel')){const r=await raw.batch(stmts);await run();return r;}await run();
  }
  return raw.batch(stmts);
 }};
 const r=await worker.fetch(req,{...env,DB:db}),h=new Headers(r.headers);h.set('x-test-nested-status',nested);return new Response(r.body,{status:r.status,headers:h});
}};
