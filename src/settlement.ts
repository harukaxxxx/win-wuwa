const response=(x:unknown,status=200)=>Response.json(x,{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
type State={status:string;cursor:string|null;has_draw:number|null};
// Each page and its cursor advance share one D1 batch transaction. The compare-and-swap
// cursor makes concurrent retries harmless, including after an unknown response.
export async function settle(req:Request,db:D1Database,owner:string,sessionHash:string,activity:string):Promise<Response>{
 if(new URL(req.url).search)return response({error:'invalid query'},400);
 if(req.method!=='PUT')return response({error:'not found'},404);
 let body:unknown;try{body=await req.json();}catch{return response({error:'invalid'},400);}
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).join(',')!=='rule_version'||(body as {rule_version:unknown}).rule_version!==1)return response({error:'invalid'},400);
 // The caller's session must still exist at every write boundary. The journal is
 // intentionally not tied to that session: a fresh login by the owner may resume.
 const liveSession="EXISTS (SELECT 1 FROM sessions WHERE session_hash=? AND user_id=? AND expires>unixepoch())";
 // A batch can cross an expiry second between SQL statements. Fail the last
 // statement to roll back the whole transaction if that happened.
 const requireLiveSession=()=>db.prepare(`SELECT CASE WHEN ${liveSession} THEN 1 ELSE json('invalid session') END`).bind(sessionHash,owner);
 try {
  await db.batch([
   db.prepare(`UPDATE activities SET status='settling',status_version=status_version+1 WHERE id=? AND owner_id=? AND rule_version=1 AND status IN ('open','paused') AND ${liveSession}`).bind(activity,owner,sessionHash,owner),
   db.prepare(`INSERT INTO activity_settlements(activity_id,owner_id,has_draw) SELECT a.id,a.owner_id,EXISTS(SELECT 1 FROM draws d WHERE d.activity_id=a.id AND d.owner_id=a.owner_id) FROM activities a WHERE a.id=? AND a.owner_id=? AND a.rule_version=1 AND a.status='settling' AND ${liveSession} ON CONFLICT(activity_id) DO NOTHING`).bind(activity,owner,sessionHash,owner),
   requireLiveSession()
  ]);
  for(let page=0;page<10;page++){
   const state=await db.prepare('SELECT a.status,j.cursor,j.has_draw FROM activities a LEFT JOIN activity_settlements j ON j.activity_id=a.id AND j.owner_id=a.owner_id WHERE a.id=? AND a.owner_id=? AND a.rule_version=1').bind(activity,owner).first<State>();
   if(!state)return response({error:'not found'},404);
   if(state.status==='settled' && state.cursor!==null)return response({status:'settled'});
   if(state.status!=='settling'||state.cursor===null)return response({error:'settlement unavailable'},409);
   const cursor=state.cursor;
   const rows=state.has_draw ? (await db.prepare('SELECT viewer_id FROM viewer_scores WHERE owner_id=? AND viewer_id>? UNION SELECT viewer_id FROM registrations WHERE activity_id=? AND owner_id=? AND viewer_id>? ORDER BY viewer_id LIMIT 100').bind(owner,cursor,activity,owner,cursor).all<{viewer_id:string}>()).results : [];
   if(!rows.length){
    await db.batch([
     db.prepare(`UPDATE activity_settlements SET completed_at=unixepoch() WHERE activity_id=? AND owner_id=? AND cursor=? AND completed_at IS NULL AND EXISTS (SELECT 1 FROM activities WHERE id=? AND owner_id=? AND status='settling') AND (has_draw=0 OR (NOT EXISTS (SELECT 1 FROM viewer_scores WHERE owner_id=? AND viewer_id>?) AND NOT EXISTS (SELECT 1 FROM registrations WHERE activity_id=? AND owner_id=? AND viewer_id>?))) AND ${liveSession}`).bind(activity,owner,cursor,activity,owner,owner,cursor,activity,owner,cursor,sessionHash,owner),
     db.prepare(`UPDATE activities SET status='settled',status_version=status_version+1 WHERE id=? AND owner_id=? AND status='settling' AND EXISTS (SELECT 1 FROM activity_settlements WHERE activity_id=? AND owner_id=? AND completed_at IS NOT NULL) AND ${liveSession}`).bind(activity,owner,activity,owner,sessionHash,owner),
     requireLiveSession()
    ]);
    continue;
   }
   const ids=JSON.stringify(rows.map(r=>r.viewer_id)),last=rows[rows.length-1].viewer_id;
   await db.batch([
    db.prepare(`INSERT INTO viewer_scores(owner_id,viewer_id,score) SELECT r.owner_id,r.viewer_id,1 FROM registrations r JOIN json_each(?) j ON j.value=r.viewer_id WHERE r.activity_id=? AND r.owner_id=? AND r.status='registered' AND EXISTS (SELECT 1 FROM activity_settlements s JOIN activities a ON a.id=s.activity_id AND a.owner_id=s.owner_id WHERE s.activity_id=? AND s.owner_id=? AND s.cursor=? AND s.completed_at IS NULL AND a.status='settling') AND ${liveSession} ON CONFLICT(owner_id,viewer_id) DO UPDATE SET score=MIN(10,viewer_scores.score+1)`).bind(ids,activity,owner,activity,owner,cursor,sessionHash,owner),
    db.prepare(`UPDATE viewer_scores SET score=score-1 WHERE owner_id=? AND score>0 AND viewer_id IN (SELECT value FROM json_each(?)) AND NOT EXISTS (SELECT 1 FROM registrations r WHERE r.activity_id=? AND r.owner_id=viewer_scores.owner_id AND r.viewer_id=viewer_scores.viewer_id) AND EXISTS (SELECT 1 FROM activity_settlements s JOIN activities a ON a.id=s.activity_id AND a.owner_id=s.owner_id WHERE s.activity_id=? AND s.owner_id=? AND s.cursor=? AND s.completed_at IS NULL AND a.status='settling') AND ${liveSession}`).bind(owner,ids,activity,activity,owner,cursor,sessionHash,owner),
    db.prepare(`UPDATE activity_settlements SET cursor=? WHERE activity_id=? AND owner_id=? AND cursor=? AND completed_at IS NULL AND EXISTS (SELECT 1 FROM activities WHERE id=? AND owner_id=? AND status='settling') AND ${liveSession}`).bind(last,activity,owner,cursor,activity,owner,sessionHash,owner),
    requireLiveSession()
   ]);
  }
  const state=await db.prepare('SELECT status FROM activities WHERE id=? AND owner_id=?').bind(activity,owner).first<{status:string}>();
  return state?.status==='settled'?response({status:'settled'}):response({status:'settling'},202);
 } catch{return response({error:'settlement interrupted; retry'},500);}
}
