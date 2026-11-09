// Instrument only the D1 batch boundary; nested operations use the production router and real D1.
import worker from '../src/index';
export default {async fetch(req,env){
 let mode=req.headers.get('x-test-mode'),nestedStatus='none';const raw=env.DB,marked=new WeakMap();
 const activity=new URL(req.url).pathname.split('/')[3];
 async function nested(kind){
  const h=new Headers(req.headers);h.delete('x-test-mode');h.delete('x-test-viewer');
  let path,method='PUT';
  if(kind==='register'||kind==='withdraw'){path=`/api/viewer/250/${kind}`;method='POST';h.set('Cookie',req.headers.get('x-test-viewer'));}
  else if(kind==='draw')path=`/api/activities/${activity}/draws/nested`;
  else path=`/api/activities/${activity}/settlements/nested`;
  const body=kind==='register'||kind==='withdraw'?{activity_id:activity,rule_version:1}:{rule_version:1};
  const r=await worker.fetch(new Request(new URL(path,req.url),{method,headers:h,body:JSON.stringify(body)}),env);nestedStatus=String(r.status);
 }
 const db={prepare(sql){const stmt=raw.prepare(sql);const kind=sql.startsWith("UPDATE activities SET status='settling'")?'fence':sql.startsWith('INSERT INTO viewer_scores(owner_id,viewer_id,score) SELECT r.owner_id')?'page':sql.startsWith('UPDATE activity_settlements SET completed_at=')?'finish':sql.startsWith('INSERT INTO draws(id,')?'draw':null;if(!kind)return stmt;return {bind(...args){const q=stmt.bind(...args);marked.set(q,kind);return q;}};},async batch(stmts){const kind=marked.get(stmts[0]);const m=mode;
  if(m===`revoke-${kind}`||m===`expire-${kind}`){mode=null;if(m==='expire-fence')await new Promise(resolve=>setTimeout(resolve,1200));const digest=req.headers.get('x-test-session-hash');if(m.startsWith('revoke-'))await raw.prepare('DELETE FROM sessions WHERE session_hash=?').bind(digest).run();else await raw.prepare("UPDATE sessions SET expires=unixepoch() WHERE session_hash=?").bind(digest).run();nestedStatus=m;}
  if(m && ((kind==='fence' && m.startsWith('before-'))||(kind==='page'&&m==='nested-settle')||(kind==='draw'&&m==='draw-before-end'))){ mode=null;await nested(m==='nested-settle'||m==='draw-before-end'?'settle':m.slice(7));}
  const result=await raw.batch(stmts);
  if(m && kind==='fence' && m.startsWith('after-')){mode=null;await nested(m.slice(6));}
  return result;
 }};
 const r=await worker.fetch(req,{...env,DB:db});const h=new Headers(r.headers);h.set('x-test-nested-status',nestedStatus);return new Response(r.body,{status:r.status,headers:h});
}};
