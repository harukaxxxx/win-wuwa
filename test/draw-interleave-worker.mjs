// Test-only harness: mutate the real D1 between the candidate read and batch.
import worker from '../src/index';
export default {
 async fetch(req,env) {
  let action=req.headers.get('x-test-interleave');
  const nested=req.clone();
  const raw=env.DB;
  const db={
   prepare(sql){
    const stmt=raw.prepare(sql);
    if(sql.startsWith('SELECT winner_ordinal,rule_version,created_at FROM draws') && action?.startsWith('winner-')) return {bind(...args){const q=stmt.bind(...args);return {async first(){
     const row=await q.first();
     if(!row && action){const mode=action;action=null;const winner=await worker.fetch(nested,env);if(winner.status!==200)throw Error(`nested draw: ${winner.status}`);
      if(mode==='winner-disable')await raw.prepare("UPDATE approved_streamers SET status='disabled' WHERE user_id='210'").run();
      if(mode==='winner-terminal')await raw.prepare("UPDATE activities SET status='cancelled' WHERE id=?").bind(args[0]).run();
     }
     return row;
    }};}};
    if(!sql.startsWith('SELECT r.viewer_id,r.ordinal,COALESCE'))return stmt;
    return {bind(...args){const q=stmt.bind(...args);return {async all(){
     const rows=await q.all();
     const mode=action;action=null;
     if(mode==='register')await raw.prepare("INSERT INTO registrations(activity_id,owner_id,viewer_id,ordinal) VALUES (?,'210','701',2)").bind(args[0]).run();
     if(mode==='withdraw')await raw.prepare("UPDATE registrations SET status='withdrawn' WHERE activity_id=? AND viewer_id='700'").bind(args[0]).run();
     if(mode==='score')await raw.prepare("UPDATE viewer_scores SET score=8 WHERE owner_id='210' AND viewer_id='700'").run();
     if(mode==='disable')await raw.prepare("UPDATE approved_streamers SET status='disabled' WHERE user_id='210'").run();
     return rows;
    }};}};
   },
   batch(statements){
    if(action==='failbatch'){action=null;return raw.batch([...statements,raw.prepare("INSERT INTO draw_candidates(draw_id,viewer_id,ordinal,score,weight,probability) VALUES ('missing','fail',1,-1,1,1)")]);}
    return raw.batch(statements);
   }
  };
  // failbatch is retained through the read so the actual D1 batch receives it.
  if(action==='failbatch') {
   const original=db.prepare;db.prepare=sql=>sql.startsWith('SELECT r.viewer_id,r.ordinal,COALESCE')?raw.prepare(sql):original(sql);
  }
  return worker.fetch(req,{...env,DB:db});
 }
};
