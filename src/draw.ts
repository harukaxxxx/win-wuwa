import {snapshot,select,type Candidate} from './draw-formula';
const response=(x:unknown,status=200)=>Response.json(x,{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
export async function draw(req:Request,db:D1Database,owner:string,sessionHash:string,activity:string,key:string):Promise<Response> {
 if(new URL(req.url).search)return response({error:'invalid query'},400);
 const lookup=()=>db.prepare('SELECT winner_ordinal,rule_version,created_at FROM draws WHERE activity_id=? AND owner_id=? AND request_key=?').bind(activity,owner,key).first();
 const result=async (stored:unknown)=>{const state=await db.prepare('SELECT status FROM activities WHERE id=? AND owner_id=?').bind(activity,owner).first<{status:string}>();return response({draw:stored,...(state&&['cancelling','cancelled'].includes(state.status)?{invalid:true}:{})});};
 if(req.method==='GET'){const old=await lookup();return old?result(old):response({error:'not found'},404);}
 if(req.method!=='PUT')return response({error:'not found'},404);
 let body:unknown;try{body=await req.json();}catch{return response({error:'invalid'},400);}
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).join(',')!=='rule_version'||(body as {rule_version:unknown}).rule_version!==1)return response({error:'invalid'},400);
 const old=await lookup();if(old)return result(old);
 for(let attempt=0;attempt<5;attempt++) {
  const state=await db.prepare("SELECT a.status,s.status AS owner_status FROM activities a JOIN approved_streamers s ON s.user_id=a.owner_id WHERE a.id=? AND a.owner_id=? AND a.rule_version=1").bind(activity,owner).first<{status:string;owner_status:string}>();
  if(!state||!['open','paused'].includes(state.status)||state.owner_status!=='approved'){const retry=await lookup();return retry?result(retry):response({error:'draw unavailable'},409);}
  const rows=(await db.prepare("SELECT r.viewer_id,r.ordinal,COALESCE(s.score,0) AS score FROM registrations r LEFT JOIN viewer_scores s ON s.owner_id=r.owner_id AND s.viewer_id=r.viewer_id WHERE r.activity_id=? AND r.owner_id=? AND r.status='registered' ORDER BY r.ordinal").bind(activity,owner).all<Candidate>()).results;
  if(!rows.length){const retry=await lookup();return retry?result(retry):response({error:'empty'},409);}
  const snap=snapshot(rows), chosen=select(rows), token=crypto.randomUUID(), data=JSON.stringify(snap), time=Math.floor(Date.now()/1000);
  try {
   const batch=await db.batch([
    db.prepare(`INSERT INTO draws(id,activity_id,owner_id,request_key,rule_version,winner_id,winner_ordinal,created_at,winner_display_name)
     SELECT ?,a.id,a.owner_id,?,a.rule_version,?,?,?,(SELECT display_name_snapshot FROM registrations WHERE activity_id=a.id AND owner_id=a.owner_id AND viewer_id=?) FROM activities a JOIN approved_streamers o ON o.user_id=a.owner_id
     WHERE a.id=? AND a.owner_id=? AND a.rule_version=1 AND a.status IN ('open','paused') AND o.status='approved'
     AND EXISTS (SELECT 1 FROM sessions WHERE session_hash=? AND user_id=a.owner_id AND expires>?)
     AND (SELECT COUNT(*) FROM registrations r WHERE r.activity_id=a.id AND r.status='registered')=json_array_length(?)
     AND NOT EXISTS (SELECT 1 FROM json_each(?) j LEFT JOIN registrations r ON r.activity_id=a.id AND r.owner_id=a.owner_id AND r.viewer_id=json_extract(j.value,'$.viewer_id') AND r.status='registered' LEFT JOIN viewer_scores s ON s.owner_id=r.owner_id AND s.viewer_id=r.viewer_id WHERE r.viewer_id IS NULL OR r.ordinal<>json_extract(j.value,'$.ordinal') OR COALESCE(s.score,0)<>json_extract(j.value,'$.score'))
     ON CONFLICT(activity_id,request_key) DO NOTHING`).bind(token,key,chosen.viewer_id,chosen.ordinal,time,chosen.viewer_id,activity,owner,sessionHash,time,data,data),
    db.prepare("INSERT INTO draw_candidates(draw_id,viewer_id,ordinal,score,weight,probability) SELECT ?,json_extract(j.value,'$.viewer_id'),json_extract(j.value,'$.ordinal'),json_extract(j.value,'$.score'),json_extract(j.value,'$.weight'),json_extract(j.value,'$.probability') FROM json_each(?) j WHERE EXISTS (SELECT 1 FROM draws WHERE id=?)").bind(token,data,token),
    db.prepare("UPDATE registrations SET status='winner' WHERE activity_id=? AND owner_id=? AND viewer_id=? AND status='registered' AND EXISTS (SELECT 1 FROM draws WHERE id=?)").bind(activity,owner,chosen.viewer_id,token),
    db.prepare("INSERT INTO viewer_scores(owner_id,viewer_id,score) SELECT ?,?,0 WHERE EXISTS (SELECT 1 FROM draws WHERE id=?) ON CONFLICT(owner_id,viewer_id) DO UPDATE SET score=0").bind(owner,chosen.viewer_id,token)
   ]);
   if(batch[0].meta.changes){const stored=await lookup();if(!stored)throw Error('missing draw');return result(stored);}
  }catch {const retry=await lookup();if(retry)return result(retry);return response({error:'request failed'},500);}
  const retry=await lookup();if(retry)return result(retry);
 }
 return response({error:'candidates changed; retry same key'},409);
}
