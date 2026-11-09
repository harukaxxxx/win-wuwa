const response=(x:unknown,status=200)=>Response.json(x,{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
type State={status:string;cursor:string|null};
// Restore only winners to their opening baseline (missing means zero).
// The zero guard preserves later nonzero writes, but is not a version fence.
export async function cancel(req:Request,db:D1Database,owner:string,sessionHash:string,activity:string):Promise<Response>{
 if(new URL(req.url).search)return response({error:'invalid query'},400);
 if(req.method!=='PUT')return response({error:'not found'},404);
 let body:unknown;try{body=await req.json();}catch{return response({error:'invalid'},400);}
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).join(',')!=='rule_version'||(body as {rule_version:unknown}).rule_version!==1)return response({error:'invalid'},400);
 const live="EXISTS (SELECT 1 FROM sessions WHERE session_hash=? AND user_id=? AND expires>unixepoch())";
 const guard=()=>db.prepare(`SELECT CASE WHEN ${live} THEN 1 ELSE json('invalid session') END`).bind(sessionHash,owner);
 try{
  // Same row and admissible statuses as settlement: first committed fence wins.
  await db.batch([
   db.prepare(`UPDATE activities SET status='cancelling',status_version=status_version+1 WHERE id=? AND owner_id=? AND rule_version=1 AND status IN ('open','paused') AND ${live}`).bind(activity,owner,sessionHash,owner),
   db.prepare(`INSERT INTO activity_cancellations(activity_id,owner_id) SELECT id,owner_id FROM activities WHERE id=? AND owner_id=? AND rule_version=1 AND status='cancelling' AND ${live} ON CONFLICT(activity_id) DO NOTHING`).bind(activity,owner,sessionHash,owner),
   guard()
  ]);
  for(let page=0;page<10;page++){
   const state=await db.prepare('SELECT a.status,j.cursor FROM activities a LEFT JOIN activity_cancellations j ON j.activity_id=a.id AND j.owner_id=a.owner_id WHERE a.id=? AND a.owner_id=? AND a.rule_version=1').bind(activity,owner).first<State>();
   if(!state)return response({error:'not found'},404);
   if(state.status==='cancelled'&&state.cursor!==null)return response({status:'cancelled'});
   if(state.status!=='cancelling'||state.cursor===null)return response({error:'cancellation unavailable'},409);
   const cursor=state.cursor;
   const rows=(await db.prepare('SELECT winner_id FROM draws WHERE activity_id=? AND owner_id=? AND winner_id>? ORDER BY winner_id LIMIT 100').bind(activity,owner,cursor).all<{winner_id:string}>()).results;
   if(!rows.length){
    await db.batch([
     db.prepare(`UPDATE activity_cancellations SET completed_at=unixepoch() WHERE activity_id=? AND owner_id=? AND cursor=? AND completed_at IS NULL AND EXISTS (SELECT 1 FROM activities WHERE id=? AND owner_id=? AND status='cancelling') AND NOT EXISTS (SELECT 1 FROM draws WHERE activity_id=? AND owner_id=? AND winner_id>?) AND ${live}`).bind(activity,owner,cursor,activity,owner,activity,owner,cursor,sessionHash,owner),
     db.prepare(`UPDATE activities SET status='cancelled',status_version=status_version+1 WHERE id=? AND owner_id=? AND status='cancelling' AND EXISTS (SELECT 1 FROM activity_cancellations WHERE activity_id=? AND owner_id=? AND completed_at IS NOT NULL) AND ${live}`).bind(activity,owner,activity,owner,sessionHash,owner),guard()
    ]);continue;
   }
   const ids=JSON.stringify(rows.map(r=>r.winner_id)),last=rows[rows.length-1].winner_id;
   await db.batch([
    db.prepare(`UPDATE viewer_scores SET score=COALESCE((SELECT score FROM activity_score_baselines b WHERE b.activity_id=? AND b.owner_id=viewer_scores.owner_id AND b.viewer_id=viewer_scores.viewer_id),0) WHERE owner_id=? AND score=0 AND viewer_id IN (SELECT value FROM json_each(?)) AND EXISTS (SELECT 1 FROM activity_cancellations c JOIN activities a ON a.id=c.activity_id AND a.owner_id=c.owner_id WHERE c.activity_id=? AND c.owner_id=? AND c.cursor=? AND c.completed_at IS NULL AND a.status='cancelling') AND ${live}`).bind(activity,owner,ids,activity,owner,cursor,sessionHash,owner),
    db.prepare(`UPDATE activity_cancellations SET cursor=? WHERE activity_id=? AND owner_id=? AND cursor=? AND completed_at IS NULL AND EXISTS (SELECT 1 FROM activities WHERE id=? AND owner_id=? AND status='cancelling') AND ${live}`).bind(last,activity,owner,cursor,activity,owner,sessionHash,owner),guard()
   ]);
  }
  const state=await db.prepare('SELECT status FROM activities WHERE id=? AND owner_id=?').bind(activity,owner).first<{status:string}>();
  return state?.status==='cancelled'?response({status:'cancelled'}):response({status:'cancelling'},202);
 }catch{return response({error:'cancellation interrupted; retry'},500);}
}
