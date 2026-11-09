import {snapshot,type Candidate} from './draw-formula';
const json=(x:unknown,status=200)=>Response.json(x,{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
function page(u:URL):number|null {const p=[...u.searchParams];if(p.length>1||p.some(([k,v])=>k!=='cursor'||!/^\d{1,15}$/.test(v)))return null;const n=Number(u.searchParams.get('cursor')||0);return Number.isSafeInteger(n)?n:null;}
export async function publicResults(req:Request,db:D1Database,owner:string):Promise<Response>{
 const u=new URL(req.url),cursor=page(u);if(cursor===null)return json({error:'invalid query'},400);
 const rows=await db.prepare("SELECT COALESCE(d.winner_display_name,'中獎者') AS display_name FROM draws d JOIN activities a ON a.id=d.activity_id AND a.owner_id=d.owner_id WHERE a.owner_id=? AND a.status IN ('initializing','open','paused','settling') ORDER BY d.rowid LIMIT 51 OFFSET ?").bind(owner,cursor).all<{display_name:string}>();
 return json({winners:rows.results.slice(0,50),next_cursor:rows.results.length>50?cursor+50:null});
}
export async function chance(req:Request,db:D1Database,owner:string,viewer:string):Promise<Response>{
 const u=new URL(req.url),p=[...u.searchParams],id=u.searchParams.get('activity_id'),version=u.searchParams.get('rule_version');
 if(p.length!==2||u.searchParams.getAll('activity_id').length!==1||u.searchParams.getAll('rule_version').length!==1||!id||!uuid.test(id)||version!=='1')return json({error:'invalid query'},400);
 // Revision, its last known change, observation time and all weights share one snapshot.
 const row=await db.prepare(`SELECT a.status AS activity_status,unixepoch() AS as_of,a.candidate_revision,a.candidate_updated_at,
 (SELECT json_object('ordinal',r.ordinal,'status',r.status,'score',COALESCE(s.score,0)) FROM registrations r LEFT JOIN viewer_scores s ON s.owner_id=r.owner_id AND s.viewer_id=r.viewer_id WHERE r.activity_id=a.id AND r.owner_id=a.owner_id AND r.viewer_id=?) AS own,
 (SELECT json_group_array(json_object('viewer_id',r.viewer_id,'ordinal',r.ordinal,'score',COALESCE(s.score,0))) FROM registrations r LEFT JOIN viewer_scores s ON s.owner_id=r.owner_id AND s.viewer_id=r.viewer_id WHERE r.activity_id=a.id AND r.owner_id=a.owner_id AND r.status='registered') AS candidates
 FROM activities a WHERE a.id=? AND a.owner_id=? AND a.rule_version=?`).bind(viewer,id,owner,Number(version)).first<{activity_status:string;as_of:number;candidate_revision:number;candidate_updated_at:string|null;own:string|null;candidates:string}>();
 if(!row)return json({error:'stale activity or rules'},409);
 const own=row.own?JSON.parse(row.own) as {ordinal:number;status:string;score:number}:null;
 let probability:number|null=null;
 if(own?.status==='registered'&&['open','paused'].includes(row.activity_status)) {const candidates=JSON.parse(row.candidates) as Candidate[];probability=snapshot(candidates).find(x=>x.viewer_id===viewer)?.probability ?? null;}
 return json({ordinal:own?.ordinal??null,status:own?.status??null,score:own?.score??null,probability,as_of:row.as_of,candidate_revision:row.candidate_revision,candidate_updated_at:row.candidate_updated_at,activity_status:row.activity_status});
}
export async function roster(req:Request,db:D1Database,owner:string,id:string):Promise<Response>{
 const u=new URL(req.url),cursor=page(u);if(cursor===null||!uuid.test(id))return json({error:'invalid query'},400);
 const row=await db.prepare(`SELECT a.id,a.status,
 (SELECT COUNT(*) FROM registrations r WHERE r.activity_id=a.id AND r.owner_id=a.owner_id) AS total,
 (SELECT json_group_array(json_object('ordinal',p.ordinal,'status',p.status,'discord_id',p.discord_id,'display_name',p.display_name,'username',p.username,'score',p.score,'won_at',p.won_at)) FROM
  (SELECT r.ordinal,r.status,r.viewer_id AS discord_id,i.display_name,i.username,COALESCE(s.score,0) AS score,d.created_at AS won_at FROM registrations r LEFT JOIN discord_identities i ON i.user_id=r.viewer_id LEFT JOIN viewer_scores s ON s.owner_id=r.owner_id AND s.viewer_id=r.viewer_id LEFT JOIN draws d ON d.activity_id=r.activity_id AND d.owner_id=r.owner_id AND d.winner_id=r.viewer_id WHERE r.activity_id=a.id AND r.owner_id=a.owner_id AND r.ordinal>? ORDER BY r.ordinal LIMIT 51) p) AS rows
 FROM activities a WHERE a.id=? AND a.owner_id=?`).bind(cursor,id,owner).first<{id:string;status:string;total:number;rows:string}>();
 if(!row)return json({error:'not found'},404);
 const rows=JSON.parse(row.rows) as {ordinal:number}[],data=rows.slice(0,50);return json({activity:{id:row.id,status:row.status},total:row.total,registrations:data,next_cursor:rows.length>50?data[data.length-1].ordinal:null});
}
export async function ownedActivities(req:Request,db:D1Database,owner:string):Promise<Response>{
 const u=new URL(req.url),cursor=page(u);if(cursor===null)return json({error:'invalid query'},400);
 const rows=await db.prepare('SELECT id,status,created_at FROM activities WHERE owner_id=? ORDER BY rowid DESC LIMIT 51 OFFSET ?').bind(owner,cursor).all();return json({activities:rows.results.slice(0,50),next_cursor:rows.results.length>50?cursor+50:null});
}
