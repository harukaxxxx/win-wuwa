const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
// Journal completion is written in the same transaction as the terminal status.
// Unknown legacy completion times are intentionally ineligible.
const eligible=`SELECT a.id,a.owner_id,a.status,CASE WHEN a.status='settled' THEN s.completed_at ELSE c.completed_at END AS completed_at
 FROM activities a LEFT JOIN activity_settlements s ON s.activity_id=a.id AND s.owner_id=a.owner_id
 LEFT JOIN activity_cancellations c ON c.activity_id=a.id AND c.owner_id=a.owner_id
 WHERE a.owner_id=? AND ((a.status='settled' AND s.completed_at IS NOT NULL AND s.completed_at<unixepoch()-7776000)
 OR (a.status='cancelled' AND c.completed_at IS NOT NULL AND c.completed_at<unixepoch()-7776000))`;

// Each request advances one activity by at most 100 rows per child table.
// A permanent UUID fence is created atomically with the first page; the terminal
// activity and completion journal remain until every private child is gone.
export async function retention(req:Request,db:D1Database,admin:string,sessionHash:string):Promise<Response>{
 if(req.method!=='POST')return reply({error:'not found'},404);
 if(new URL(req.url).search)return reply({error:'invalid query'},400);
 let value:unknown;try{value=await req.json();}catch{return reply({error:'invalid'},400);}
 if(!value||typeof value!=='object'||Array.isArray(value))return reply({error:'invalid'},400);
 const body=value as Record<string,unknown>;
 if(Object.keys(body).sort().join(',')!=='dry_run,owner_id'||typeof body.owner_id!=='string'||!/^\d{1,32}$/.test(body.owner_id)||typeof body.dry_run!=='boolean')return reply({error:'invalid'},400);
 const owner=body.owner_id;
 const count=await db.prepare(`SELECT COUNT(*) AS n FROM (${eligible})`).bind(owner).first<{n:number}>();
 const n=count?.n ?? 0;
 if(body.dry_run||!n)return reply({owner_id:owner,eligible:n,deleted:0,has_more:n>0,dry_run:body.dry_run});
 const target=await db.prepare(`${eligible} ORDER BY completed_at,id LIMIT 1`).bind(owner).first<{id:string}>();
 if(!target)return reply({owner_id:owner,eligible:0,deleted:0,has_more:false,dry_run:false});
 const id=target.id;
 const fence=`EXISTS (SELECT 1 FROM activity_tombstones t WHERE t.id=? AND t.owner_id=?)`;
 const page=(table:string,where='activity_id=? AND owner_id=?')=>db.prepare(`DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} WHERE ${where} ORDER BY rowid LIMIT 100) AND ${fence}`).bind(id,owner,id,owner);
 const ready=`NOT EXISTS (SELECT 1 FROM draws WHERE activity_id=a.id AND owner_id=a.owner_id)
  AND NOT EXISTS (SELECT 1 FROM registrations WHERE activity_id=a.id AND owner_id=a.owner_id)
  AND NOT EXISTS (SELECT 1 FROM activity_score_baselines WHERE activity_id=a.id AND owner_id=a.owner_id)
  AND NOT EXISTS (SELECT 1 FROM guild_membership_proofs WHERE activity_id=a.id AND owner_id=a.owner_id)
  AND NOT EXISTS (SELECT 1 FROM viewer_login_intents WHERE activity_id=a.id AND owner_id=a.owner_id)
  AND NOT EXISTS (SELECT 1 FROM viewer_oauth_context WHERE activity_id=a.id AND owner_id=a.owner_id)`;
 const removeJournal=(table:string)=>db.prepare(`DELETE FROM ${table} WHERE activity_id=? AND owner_id=? AND ${fence} AND EXISTS (SELECT 1 FROM activities a WHERE a.id=${table}.activity_id AND a.owner_id=${table}.owner_id AND ${ready})`).bind(id,owner,id,owner);
 try {
  const result=await db.batch([
   db.prepare(`INSERT INTO activity_tombstones(id,owner_id,status,completed_at) SELECT id,owner_id,status,completed_at FROM (${eligible}) WHERE id=? ON CONFLICT(id) DO NOTHING`).bind(owner,id),
   page('draw_candidates','draw_id IN (SELECT id FROM draws WHERE activity_id=? AND owner_id=?)'),
   page('draws','activity_id=? AND owner_id=? AND NOT EXISTS (SELECT 1 FROM draw_candidates c WHERE c.draw_id=draws.id)'),
   page('registrations'),page('activity_score_baselines'),page('guild_membership_proofs'),page('viewer_login_intents'),
   db.prepare(`DELETE FROM oauth_states WHERE state_hash IN (SELECT state_hash FROM viewer_oauth_context WHERE activity_id=? AND owner_id=? ORDER BY rowid LIMIT 100) AND ${fence}`).bind(id,owner,id,owner),
   page('viewer_oauth_context'),
   removeJournal('activity_settlements'),removeJournal('activity_cancellations'),
   db.prepare(`DELETE FROM activities AS a WHERE id=? AND owner_id=? AND ${fence} AND ${ready} AND NOT EXISTS (SELECT 1 FROM activity_settlements WHERE activity_id=a.id AND owner_id=a.owner_id) AND NOT EXISTS (SELECT 1 FROM activity_cancellations WHERE activity_id=a.id AND owner_id=a.owner_id)`).bind(id,owner,id,owner),
   db.prepare("SELECT CASE WHEN EXISTS (SELECT 1 FROM sessions WHERE session_hash=? AND user_id=? AND expires>unixepoch()) THEN 1 ELSE json('invalid session') END").bind(sessionHash,admin)
  ]);
  const deleted=result[result.length-2].meta.changes ? 1 : 0;
  const remaining=await db.prepare(`SELECT COUNT(*) AS n FROM (${eligible})`).bind(owner).first<{n:number}>();
  return reply({owner_id:owner,eligible:remaining?.n ?? 0,deleted,has_more:(remaining?.n ?? 0)>0,dry_run:false});
 }catch{return reply({error:'cleanup interrupted; retry'},500);}
}
