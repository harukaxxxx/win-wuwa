interface Env { DB: D1Database; ASSETS: Fetcher; DISCORD_CLIENT_ID?: string; DISCORD_CLIENT_SECRET?: string; ADMIN_DISCORD_ID?: string; ORIGIN?: string }
const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };
const json = (x: unknown, status = 200) => Response.json(x, { status, headers });
const random = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('');
async function hash(s: string) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))), n => n.toString(16).padStart(2, '0')).join(''); }
function cookie(req: Request, name: string) { return req.headers.get('Cookie')?.split(';').map(x => x.trim()).find(x => x.startsWith(name + '='))?.slice(name.length + 1) ?? ''; }
const setCookie = (name: string, value: string, max: number) => `${name}=${value}; Path=/; Max-Age=${max}; Secure; HttpOnly; SameSite=Lax`;
const now = () => Math.floor(Date.now() / 1000);
function redirect(url: string, cookies: string[] = []) { const h = new Headers(headers); h.set('Location', url); for (const c of cookies) h.append('Set-Cookie', c); return new Response(null, { status: 302, headers: h }); }
async function session(req: Request, env: Env) { const id = cookie(req, '__Host-session'); if (!/^[a-f0-9]{64}$/.test(id)) return null; return env.DB.prepare('SELECT user_id, csrf_hash FROM sessions WHERE session_hash=? AND expires>?').bind(await hash(id), now()).first<{ user_id: string; csrf_hash: string }>(); }
async function handler(req: Request, env: Env): Promise<Response> {
 const u = new URL(req.url); const origin = env.ORIGIN;
 if (u.pathname === '/auth/login' && req.method === 'GET') {
  if (!origin || !env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET || u.origin !== origin) return json({ error: 'OAuth not configured' }, 503);
  const params=[...u.searchParams]; let context: {owner:string;id:string;version:number}|null=null;
  if(params.length) {
   if(params.length!==3 || !['owner','activity_id','rule_version'].every(k=>u.searchParams.getAll(k).length===1)) return json({error:'invalid login context'},400);
   const owner=u.searchParams.get('owner')!,id=u.searchParams.get('activity_id')!,v=u.searchParams.get('rule_version')!;
   if(!/^\d{1,32}$/.test(owner)||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id)||!/^[1-9]\d*$/.test(v)||!Number.isSafeInteger(Number(v)))return json({error:'invalid login context'},400);
   const found=await env.DB.prepare("SELECT id FROM activities WHERE id=? AND owner_id=? AND rule_version=? AND status IN ('initializing','open','paused','settling','cancelling')").bind(id,owner,Number(v)).first();
   if(!found)return json({error:'stale activity or rules'},409); context={owner,id,version:Number(v)};
  }
  const day=Math.floor(now()/86400); await env.DB.prepare('DELETE FROM login_budget WHERE day<>?').bind(day).run();
  const budget=await env.DB.prepare('INSERT INTO login_budget VALUES (?,1) ON CONFLICT(day) DO UPDATE SET starts=starts+1 WHERE starts<1000 RETURNING starts').bind(day).first(); if (!budget) return json({error:'login capacity'},503);
  await env.DB.batch([env.DB.prepare('DELETE FROM oauth_states WHERE state_hash IN (SELECT state_hash FROM oauth_states WHERE expires<=? LIMIT 100)').bind(now()),env.DB.prepare('DELETE FROM sessions WHERE session_hash IN (SELECT session_hash FROM sessions WHERE expires<=? LIMIT 100)').bind(now())]);
  const state = random(), verifier = random(); const admitted = await env.DB.prepare('INSERT INTO oauth_states SELECT ?,?,? WHERE (SELECT COUNT(*) FROM oauth_states)<1000 RETURNING state_hash').bind(await hash(state), now()+300, verifier).first(); if (!admitted) return json({error:'login capacity'},503);
  if(context) { await env.DB.batch([env.DB.prepare('DELETE FROM viewer_oauth_context WHERE expires<=?').bind(now()),env.DB.prepare('DELETE FROM viewer_login_intents WHERE expires<=?').bind(now()),env.DB.prepare('INSERT INTO viewer_oauth_context VALUES (?,?,?,?,?)').bind(await hash(state),context.owner,context.id,context.version,now()+300)]); }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const a = new URL('https://discord.com/oauth2/authorize'); a.search = new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, redirect_uri: origin + '/auth/callback', response_type: 'code', scope: 'identify', state, code_challenge: challenge, code_challenge_method:'S256' }).toString();
  return redirect(a.toString(), [setCookie(context ? '__Host-oauth-'+state : '__Host-oauth', state, 300)]);
 }
 if (u.pathname === '/auth/callback' && req.method === 'GET') {
  if (!origin || u.origin !== origin || !env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET) return json({error:'OAuth not configured'},503);
  const state = u.searchParams.get('state') ?? ''; const code = u.searchParams.get('code') ?? '';
  if (!/^[a-f0-9]{64}$/.test(state) || (state !== cookie(req, '__Host-oauth-'+state) && state !== cookie(req, '__Host-oauth')) || !code || u.searchParams.get('iss') !== 'https://discord.com') return json({error:'invalid authorization'},400);
  const used = await env.DB.prepare('DELETE FROM oauth_states WHERE state_hash=? AND expires>? RETURNING verifier').bind(await hash(state), now()).first<{verifier:string}>();
  if (!used) return json({error:'invalid authorization'},400);
  const viewerFlow=state===cookie(req,'__Host-oauth-'+state);
  const context=viewerFlow ? await env.DB.prepare('DELETE FROM viewer_oauth_context WHERE state_hash=? AND expires>? RETURNING owner_id,activity_id,rule_version').bind(await hash(state),now()).first<{owner_id:string;activity_id:string;rule_version:number}>() : null;
  if(viewerFlow&&!context)return json({error:'invalid authorization'},400);
  const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {method:'POST', redirect:'manual', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:new URLSearchParams({client_id:env.DISCORD_CLIENT_ID,client_secret:env.DISCORD_CLIENT_SECRET,grant_type:'authorization_code',code,redirect_uri:origin+'/auth/callback',code_verifier:used.verifier})});
  if (!tokenResponse.ok) return json({error:'provider failed'},502);
  const token = await tokenResponse.json<{access_token?:string; token_type?:string}>(); if (!token.access_token || token.token_type?.toLowerCase() !== 'bearer') return json({error:'provider failed'},502);
  const userResponse = await fetch('https://discord.com/api/users/@me', {headers:{Authorization:`Bearer ${token.access_token}`}, redirect:'manual'}); if (!userResponse.ok) return json({error:'provider failed'},502);
  const user = await userResponse.json<{id?:string}>(); if (!user.id || !/^\d{1,32}$/.test(user.id)) return json({error:'provider failed'},502);
  const sid=random(), csrf=random(); const admitted=await env.DB.prepare('INSERT INTO sessions SELECT ?,?,?,? WHERE (SELECT COUNT(*) FROM sessions)<1000 RETURNING session_hash').bind(await hash(sid),user.id,await hash(csrf),now()+28800).first(); if (!admitted) return json({error:'login capacity'},503);
  let destination='/'; if(context) { const intent=random(); await env.DB.prepare('INSERT INTO viewer_login_intents VALUES (?,?,?,?,?,?)').bind(await hash(intent),await hash(sid),context.owner_id,context.activity_id,context.rule_version,now()+1800).run(); destination='/s/'+context.owner_id+'?intent='+intent; }
  return redirect(destination,[setCookie('__Host-session',sid,28800),setCookie(context?'__Host-oauth-'+state:'__Host-oauth','',0),setCookie('__Host-csrf',csrf,28800)]);
 }
 const viewerPublic=u.pathname.match(/^\/api\/viewer\/(\d{1,32})$/);
 if(viewerPublic && req.method==='GET') {
  if(u.search) return json({error:'invalid query'},400);
  const activity=await env.DB.prepare("SELECT a.id,a.status,a.rule_version,CASE WHEN a.guild_id IS NULL THEN 0 ELSE 1 END AS guild_required,(SELECT COUNT(*) FROM registrations r WHERE r.activity_id=a.id AND r.status='registered') AS count FROM activities a WHERE a.owner_id=? AND a.status IN ('initializing','open','paused','settling','cancelling')").bind(viewerPublic[1]).first();
  return json({activity:activity ?? null});
 }
 if (u.pathname.startsWith('/api/')) {
  const s = await session(req,env); if (!s) return json({error:'unauthenticated'},401);
  if (req.method !== 'GET') { const c = req.headers.get('X-CSRF-Token') ?? ''; if (!origin || u.origin !== origin || req.headers.get('Origin') !== origin || !/^[a-f0-9]{64}$/.test(c) || await hash(c) !== s.csrf_hash) return json({error:'csrf'},403); }
  const admin=!!env.ADMIN_DISCORD_ID && /^\d{1,32}$/.test(env.ADMIN_DISCORD_ID) && s.user_id===env.ADMIN_DISCORD_ID;
  if (u.pathname === '/api/session' && req.method === 'GET') { const c=cookie(req,'__Host-csrf'); if (!/^[a-f0-9]{64}$/.test(c) || await hash(c)!==s.csrf_hash) return json({error:'session invalid'},401); const approved=await env.DB.prepare("SELECT user_id FROM approved_streamers WHERE user_id=? AND status='approved'").bind(s.user_id).first(); return json({csrf:c,approved:!!approved,admin,user_id:s.user_id}); }
  if (u.pathname === '/api/logout' && req.method === 'POST') { await env.DB.prepare('DELETE FROM sessions WHERE session_hash=?').bind(await hash(cookie(req,'__Host-session'))).run(); const h=new Headers(headers); h.append('Set-Cookie',setCookie('__Host-session','',0)); h.append('Set-Cookie',setCookie('__Host-csrf','',0)); return new Response(null,{status:204,headers:h}); }
  const intent=u.pathname.match(/^\/api\/viewer-intent\/([a-f0-9]{64})$/);
  if(intent && req.method==='GET') { if(u.search)return json({error:'invalid query'},400); const row=await env.DB.prepare('SELECT owner_id,activity_id,rule_version FROM viewer_login_intents WHERE intent_hash=? AND session_hash=? AND expires>?').bind(await hash(intent[1]),await hash(cookie(req,'__Host-session')),now()).first(); return row ? json(row) : json({error:'invalid intent'},404); }
  const self=u.pathname.match(/^\/api\/viewer\/(\d{1,32})\/self$/);
  if(self && req.method==='GET') {
   const params=[...u.searchParams];
   if(params.length!==2 || !u.searchParams.has('activity_id') || !u.searchParams.has('rule_version') || !/^[1-9]\d*$/.test(u.searchParams.get('rule_version') ?? ''))return json({error:'invalid query'},400);
   const id=u.searchParams.get('activity_id'),version=Number(u.searchParams.get('rule_version'));
   const activity=await env.DB.prepare('SELECT status FROM activities WHERE id=? AND owner_id=? AND rule_version=?').bind(id,self[1],version).first<{status:string}>();
   if(!activity)return json({error:'stale activity or rules'},409);
   const row=await env.DB.prepare('SELECT ordinal,status FROM registrations WHERE activity_id=? AND owner_id=? AND viewer_id=?').bind(id,self[1],s.user_id).first();
   const result=row ?? {ordinal:null,status:null};
   return json(['cancelled','settled'].includes(activity.status) ? {...result,terminal:true} : result);
  }
  const registration=u.pathname.match(/^\/api\/viewer\/(\d{1,32})\/register$/);
  if(registration && req.method==='POST') {
   if(u.search) return json({error:'invalid query'},400);
   let value:unknown; try{value=await req.json();}catch{return json({error:'invalid'},400);}
   if(!value || typeof value!=='object' || Array.isArray(value))return json({error:'invalid'},400);
   const b=value as Record<string,unknown>;
   if(Object.keys(b).sort().join(',')!=='activity_id,rule_version' || typeof b.activity_id!=='string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(b.activity_id) || !Number.isSafeInteger(b.rule_version))return json({error:'invalid'},400);
   const owner=registration[1],id=b.activity_id;
   const row=await env.DB.prepare("INSERT INTO registrations(activity_id,owner_id,viewer_id,ordinal) SELECT a.id,a.owner_id,?,COALESCE((SELECT MAX(ordinal) FROM registrations WHERE activity_id=a.id),0)+1 FROM activities a JOIN approved_streamers s ON s.user_id=a.owner_id WHERE a.id=? AND a.owner_id=? AND a.rule_version=? AND a.status='open' AND a.guild_id IS NULL AND s.status='approved' ON CONFLICT(activity_id,viewer_id) DO NOTHING RETURNING ordinal,status").bind(s.user_id,id,owner,b.rule_version).first();
   if(row)return json(row);
   const state=await env.DB.prepare("SELECT a.status,a.guild_id,s.status AS owner_status FROM activities a JOIN approved_streamers s ON s.user_id=a.owner_id WHERE a.id=? AND a.owner_id=? AND a.rule_version=?").bind(id,owner,b.rule_version).first<{status:string;guild_id:string|null;owner_status:string}>();
   if(!state || state.status!=='open')return json({error:'stale activity or rules'},409);
   if(state.owner_status!=='approved')return json({error:'streamer disabled'},403);
   if(state.guild_id!==null)return json({error:'需要群資格驗證，尚未可用'},403);
   const existing=await env.DB.prepare('SELECT ordinal,status FROM registrations WHERE activity_id=? AND owner_id=? AND viewer_id=?').bind(id,owner,s.user_id).first();
   return existing ? json(existing) : json({error:'conflict'},409);
  }
  if (u.pathname.startsWith('/api/admin/')) {
   if (!admin) return json({error:'forbidden'},403);
   if (u.pathname==='/api/admin/usage' && req.method==='GET') { if(u.search) return json({error:'invalid query'},400); const day=Math.floor(now()/86400); const row=await env.DB.prepare('SELECT starts FROM login_budget WHERE day=?').bind(day).first<{starts:number}>(); return json({utc_day:day,login_starts:row?.starts ?? 0,scope:'admitted_login_starts'}); }
   const match=u.pathname.match(/^\/api\/admin\/streamers\/(\d{1,32})$/);
   if (match && req.method==='GET') { if(u.search) return json({error:'invalid query'},400); const row=await env.DB.prepare('SELECT user_id,status,version FROM approved_streamers WHERE user_id=?').bind(match[1]).first(); return row ? json(row) : json({error:'not found'},404); }
   if (match && req.method==='PUT') {
    let body: unknown; try { body=await req.json(); } catch { return json({error:'invalid'},400); }
    if (!body || typeof body!=='object' || Array.isArray(body)) return json({error:'invalid'},400);
    const b=body as Record<string,unknown>;
    if (Object.keys(b).sort().join(',')!=='status,version' || !['approved','disabled'].includes(b.status as string) || !Number.isSafeInteger(b.version) || (b.version as number)<0) return json({error:'invalid'},400);
    const ver=b.version as number;
    const row=ver===0 && b.status==='approved' ? await env.DB.prepare("INSERT INTO approved_streamers(user_id,status,version) VALUES (?,'approved',1) ON CONFLICT(user_id) DO NOTHING RETURNING status,version").bind(match[1]).first() : await env.DB.prepare('UPDATE approved_streamers SET status=?,version=version+CASE WHEN status=? THEN 0 ELSE 1 END WHERE user_id=? AND version=? RETURNING status,version').bind(b.status,b.status,match[1],ver).first();
    if (row) return json(row);
    if (ver===0 && b.status==='approved') { const existing=await env.DB.prepare("SELECT status,version FROM approved_streamers WHERE user_id=? AND status='approved' AND version=1").bind(match[1]).first(); if(existing) return json(existing); }
    return json({error:'conflict'},409);
   }
   if (u.pathname==='/api/admin/streamers' && req.method==='GET') { const params=[...u.searchParams]; if(params.some(([k])=>k!=='cursor') || params.length>1 || (params.length===1 && !/^\d{1,32}$/.test(params[0][1]))) return json({error:'invalid query'},400); const cursor=params[0]?.[1] ?? ''; const rows=await env.DB.prepare('SELECT user_id,status,version FROM approved_streamers WHERE user_id>? ORDER BY user_id LIMIT 101').bind(cursor).all<{user_id:string;status:string;version:number}>(); const more=rows.results.length>100; const page=rows.results.slice(0,100); return json({streamers:page,has_more:more,next_cursor:more ? page[page.length-1].user_id : null}); }
   return json({error:'not found'},404);
  }
  if (u.pathname === '/api/activity-default') {
   if(u.search) return json({error:'invalid query'},400);
   if(req.method==='GET') { const row=await env.DB.prepare('SELECT guild_id,version FROM activity_defaults WHERE owner_id=?').bind(s.user_id).first(); return json(row ?? {guild_id:null,version:0}); }
   if(req.method==='PUT') {
    let value:unknown; try { value=await req.json(); } catch { return json({error:'invalid'},400); }
    if(!value || typeof value!=='object' || Array.isArray(value)) return json({error:'invalid'},400);
    const b=value as Record<string,unknown>;
    if(Object.keys(b).sort().join(',')!=='guild_id,version' || !(b.guild_id===null || (typeof b.guild_id==='string' && /^\d{1,32}$/.test(b.guild_id))) || !Number.isSafeInteger(b.version) || (b.version as number)<0 || (b.version as number)>=Number.MAX_SAFE_INTEGER) return json({error:'invalid'},400);
    const stmt=b.version===0 ? env.DB.prepare("INSERT INTO activity_defaults(owner_id,guild_id,version) SELECT ?,?,1 WHERE EXISTS (SELECT 1 FROM approved_streamers WHERE user_id=? AND status='approved') ON CONFLICT(owner_id) DO NOTHING RETURNING guild_id,version").bind(s.user_id,b.guild_id,s.user_id) : env.DB.prepare("UPDATE activity_defaults SET guild_id=?,version=version+1 WHERE owner_id=? AND version=? AND EXISTS (SELECT 1 FROM approved_streamers WHERE user_id=? AND status='approved') RETURNING guild_id,version").bind(b.guild_id,s.user_id,b.version,s.user_id);
    const row=await stmt.first(); if(row) return json(row);
    const approved=await env.DB.prepare("SELECT 1 FROM approved_streamers WHERE user_id=? AND status='approved'").bind(s.user_id).first(); return approved ? json({error:'conflict'},409) : json({error:'not approved'},403);
   }
  }
  if (u.pathname === '/api/activities/current' && req.method==='GET') {
   if(u.search) return json({error:'invalid query'},400);
   const state=await env.DB.prepare("SELECT COALESCE((SELECT generation FROM activity_opening_generations WHERE owner_id=?),0) AS opening_generation, (SELECT json_object('id',id,'status',status,'rule_version',rule_version,'guild_id',guild_id,'created_at',created_at,'expected_generation',expected_generation) FROM activities WHERE owner_id=? AND status IN ('initializing','open','paused','settling','cancelling')) AS activity").bind(s.user_id,s.user_id).first<{opening_generation:number;activity:string|null}>();
   return json({activity:state?.activity ? JSON.parse(state.activity) : null,opening_generation:state?.opening_generation ?? 0});
  }
  const activityMatch=u.pathname.match(/^\/api\/activities\/([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/);
  if(activityMatch && req.method==='PUT') {
   if(u.search) return json({error:'invalid query'},400);
   let value:unknown; try { value=await req.json(); } catch { return json({error:'invalid'},400); }
   if(!value || typeof value!=='object' || Array.isArray(value)) return json({error:'invalid'},400);
   const b=value as Record<string,unknown>;
   if(Object.keys(b).sort().join(',')!=='expected_generation,guild_id,rule_version' || b.rule_version!==1 || !Number.isSafeInteger(b.expected_generation) || (b.expected_generation as number)<0 || (b.expected_generation as number)>=Number.MAX_SAFE_INTEGER || !(b.guild_id===null || (typeof b.guild_id==='string' && /^\d{1,32}$/.test(b.guild_id)))) return json({error:'invalid'},400);
   const id=activityMatch[1], guild=b.guild_id as string|null, expected=b.expected_generation as number;
   const lookup=()=>env.DB.prepare('SELECT id,status,rule_version,guild_id,created_at,expected_generation FROM activities WHERE id=? AND owner_id=?').bind(id,s.user_id).first<{id:string;status:string;rule_version:number;guild_id:string|null;created_at:number;expected_generation:number}>();
   const existing=await lookup();
   if(existing) return existing.rule_version===1 && existing.guild_id===guild && existing.expected_generation===expected ? json({activity:existing}) : json({error:'conflict'},409);
   try {
    const results=await env.DB.batch([
     env.DB.prepare("INSERT INTO activities(id,owner_id,status,rule_version,guild_id,created_at,expected_generation) SELECT ?,?,'initializing',1,?,?,? WHERE EXISTS (SELECT 1 FROM approved_streamers WHERE user_id=? AND status='approved') AND COALESCE((SELECT generation FROM activity_opening_generations WHERE owner_id=?),0)=?").bind(id,s.user_id,guild,now(),expected,s.user_id,s.user_id,expected),
     env.DB.prepare("INSERT INTO activity_opening_generations(owner_id,generation) SELECT ?,?+1 WHERE EXISTS (SELECT 1 FROM activities WHERE id=? AND owner_id=? AND status='initializing' AND expected_generation=?) ON CONFLICT(owner_id) DO UPDATE SET generation=excluded.generation WHERE activity_opening_generations.generation=?").bind(s.user_id,expected,id,s.user_id,expected,expected),
     env.DB.prepare("INSERT INTO activity_score_baselines(activity_id,owner_id,viewer_id,score) SELECT ?,owner_id,viewer_id,score FROM viewer_scores WHERE owner_id=? AND score>0 AND EXISTS (SELECT 1 FROM activities WHERE id=? AND owner_id=? AND status='initializing')").bind(id,s.user_id,id,s.user_id),
     env.DB.prepare("UPDATE activities SET status='open' WHERE id=? AND owner_id=? AND status='initializing' AND EXISTS (SELECT 1 FROM approved_streamers WHERE user_id=? AND status='approved')").bind(id,s.user_id,s.user_id)
    ]);
    if(!results[0].meta.changes) { const retry=await lookup(); if(retry) return retry.guild_id===guild && retry.expected_generation===expected ? json({activity:retry}) : json({error:'conflict'},409); const approved=await env.DB.prepare("SELECT 1 FROM approved_streamers WHERE user_id=? AND status='approved'").bind(s.user_id).first(); return approved ? json({error:'conflict'},409) : json({error:'not approved'},403); }
   } catch {
    const retry=await lookup(); if(retry) return retry.rule_version===1 && retry.guild_id===guild && retry.expected_generation===expected ? json({activity:retry}) : json({error:'conflict'},409);
    const conflict=await env.DB.prepare("SELECT 1 FROM activities WHERE id=? OR (owner_id=? AND status IN ('initializing','open','paused','settling','cancelling')) LIMIT 1").bind(id,s.user_id).first();
    return conflict ? json({error:'conflict'},409) : json({error:'request failed'},500);
   }
   const created=await lookup(); return created ? json({activity:created},201) : json({error:'not approved'},403);
  }
  if (u.pathname === '/api/environment') {
   const approved=await env.DB.prepare("SELECT user_id FROM approved_streamers WHERE user_id=? AND status='approved'").bind(s.user_id).first(); if (!approved) return json({error:'not approved'},403);
   if (req.method==='GET') { const row=await env.DB.prepare('SELECT value, version FROM environments WHERE owner_id=?').bind(s.user_id).first(); return json(row ?? {value:'',version:0}); }
   if (req.method==='PUT') { let body: {value?:unknown;version?:unknown}; try { body=await req.json(); } catch { return json({error:'invalid'},400); } if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).sort().join(',')!=='value,version' || typeof body.value !== 'string' || body.value.length>2000 || !Number.isSafeInteger(body.version) || (body.version as number)<0) return json({error:'invalid'},400);
    const ver=body.version as number; const stmt=ver===0 ? env.DB.prepare("INSERT INTO environments(owner_id,value,version) SELECT ?,?,1 WHERE EXISTS (SELECT 1 FROM approved_streamers WHERE user_id=? AND status='approved') ON CONFLICT(owner_id) DO NOTHING RETURNING value,version").bind(s.user_id,body.value,s.user_id) : env.DB.prepare("UPDATE environments SET value=?,version=version+1 WHERE owner_id=? AND version=? AND EXISTS (SELECT 1 FROM approved_streamers WHERE user_id=? AND status='approved') RETURNING value,version").bind(body.value,s.user_id,ver,s.user_id);
    const row=await stmt.first(); return row ? json(row) : json({error:'conflict'},409);
   }
  }
  return json({error:'not found'},404);
 }
 if (/^\/s\/\d{1,32}$/.test(u.pathname)) { const target=new URL('/viewer',u); return env.ASSETS.fetch(new Request(target,req)); }
 return env.ASSETS.fetch(req);
}
export default { async fetch(req: Request, env: Env): Promise<Response> { try { return await handler(req,env); } catch { return json({error:'request failed'},500); } } };
