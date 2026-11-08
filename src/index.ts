interface Env { DB: D1Database; ASSETS: Fetcher; DISCORD_CLIENT_ID?: string; DISCORD_CLIENT_SECRET?: string; ORIGIN?: string }
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
  const day=Math.floor(now()/86400); await env.DB.prepare('DELETE FROM login_budget WHERE day<>?').bind(day).run();
  const budget=await env.DB.prepare('INSERT INTO login_budget VALUES (?,1) ON CONFLICT(day) DO UPDATE SET starts=starts+1 WHERE starts<1000 RETURNING starts').bind(day).first(); if (!budget) return json({error:'login capacity'},503);
  await env.DB.batch([env.DB.prepare('DELETE FROM oauth_states WHERE state_hash IN (SELECT state_hash FROM oauth_states WHERE expires<=? LIMIT 100)').bind(now()),env.DB.prepare('DELETE FROM sessions WHERE session_hash IN (SELECT session_hash FROM sessions WHERE expires<=? LIMIT 100)').bind(now())]);
  const state = random(), verifier = random(); const admitted = await env.DB.prepare('INSERT INTO oauth_states SELECT ?,?,? WHERE (SELECT COUNT(*) FROM oauth_states)<1000 RETURNING state_hash').bind(await hash(state), now()+300, verifier).first(); if (!admitted) return json({error:'login capacity'},503);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const a = new URL('https://discord.com/oauth2/authorize'); a.search = new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, redirect_uri: origin + '/auth/callback', response_type: 'code', scope: 'identify', state, code_challenge: challenge, code_challenge_method:'S256' }).toString();
  return redirect(a.toString(), [setCookie('__Host-oauth', state, 300)]);
 }
 if (u.pathname === '/auth/callback' && req.method === 'GET') {
  if (!origin || u.origin !== origin || !env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET) return json({error:'OAuth not configured'},503);
  const state = u.searchParams.get('state') ?? ''; const code = u.searchParams.get('code') ?? '';
  if (!/^[a-f0-9]{64}$/.test(state) || state !== cookie(req, '__Host-oauth') || !code || u.searchParams.get('iss') !== 'https://discord.com') return json({error:'invalid authorization'},400);
  const used = await env.DB.prepare('DELETE FROM oauth_states WHERE state_hash=? AND expires>? RETURNING verifier').bind(await hash(state), now()).first<{verifier:string}>();
  if (!used) return json({error:'invalid authorization'},400);
  const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {method:'POST', redirect:'manual', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:new URLSearchParams({client_id:env.DISCORD_CLIENT_ID,client_secret:env.DISCORD_CLIENT_SECRET,grant_type:'authorization_code',code,redirect_uri:origin+'/auth/callback',code_verifier:used.verifier})});
  if (!tokenResponse.ok) return json({error:'provider failed'},502);
  const token = await tokenResponse.json<{access_token?:string; token_type?:string}>(); if (!token.access_token || token.token_type?.toLowerCase() !== 'bearer') return json({error:'provider failed'},502);
  const userResponse = await fetch('https://discord.com/api/users/@me', {headers:{Authorization:`Bearer ${token.access_token}`}, redirect:'manual'}); if (!userResponse.ok) return json({error:'provider failed'},502);
  const user = await userResponse.json<{id?:string}>(); if (!user.id || !/^\d{1,32}$/.test(user.id)) return json({error:'provider failed'},502);
  const sid=random(), csrf=random(); const admitted=await env.DB.prepare('INSERT INTO sessions SELECT ?,?,?,? WHERE (SELECT COUNT(*) FROM sessions)<1000 RETURNING session_hash').bind(await hash(sid),user.id,await hash(csrf),now()+28800).first(); if (!admitted) return json({error:'login capacity'},503);
  return redirect('/',[setCookie('__Host-session',sid,28800),setCookie('__Host-oauth','',0),setCookie('__Host-csrf',csrf,28800)]);
 }
 if (u.pathname.startsWith('/api/')) {
  const s = await session(req,env); if (!s) return json({error:'unauthenticated'},401);
  if (req.method !== 'GET') { const c = req.headers.get('X-CSRF-Token') ?? ''; if (!origin || u.origin !== origin || req.headers.get('Origin') !== origin || !/^[a-f0-9]{64}$/.test(c) || await hash(c) !== s.csrf_hash) return json({error:'csrf'},403); }
  if (u.pathname === '/api/session' && req.method === 'GET') { const c=cookie(req,'__Host-csrf'); if (!/^[a-f0-9]{64}$/.test(c) || await hash(c)!==s.csrf_hash) return json({error:'session invalid'},401); const approved=await env.DB.prepare('SELECT user_id FROM approved_streamers WHERE user_id=?').bind(s.user_id).first(); return json({csrf:c,approved:!!approved}); }
  if (u.pathname === '/api/logout' && req.method === 'POST') { await env.DB.prepare('DELETE FROM sessions WHERE session_hash=?').bind(await hash(cookie(req,'__Host-session'))).run(); const h=new Headers(headers); h.append('Set-Cookie',setCookie('__Host-session','',0)); h.append('Set-Cookie',setCookie('__Host-csrf','',0)); return new Response(null,{status:204,headers:h}); }
  if (u.pathname === '/api/environment') {
   const approved=await env.DB.prepare('SELECT user_id FROM approved_streamers WHERE user_id=?').bind(s.user_id).first(); if (!approved) return json({error:'not approved'},403);
   if (req.method==='GET') { const row=await env.DB.prepare('SELECT value, version FROM environments WHERE owner_id=?').bind(s.user_id).first(); return json(row ?? {value:'',version:0}); }
   if (req.method==='PUT') { let body: {value?:unknown;version?:unknown}; try { body=await req.json(); } catch { return json({error:'invalid'},400); } if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.value !== 'string' || body.value.length>2000 || !Number.isSafeInteger(body.version) || (body.version as number)<0) return json({error:'invalid'},400);
    const ver=body.version as number; const stmt=ver===0 ? env.DB.prepare('INSERT INTO environments(owner_id,value,version) SELECT ?,?,1 WHERE EXISTS (SELECT 1 FROM approved_streamers WHERE user_id=?) ON CONFLICT(owner_id) DO NOTHING RETURNING value,version').bind(s.user_id,body.value,s.user_id) : env.DB.prepare('UPDATE environments SET value=?,version=version+1 WHERE owner_id=? AND version=? AND EXISTS (SELECT 1 FROM approved_streamers WHERE user_id=?) RETURNING value,version').bind(body.value,s.user_id,ver,s.user_id);
    const row=await stmt.first(); return row ? json(row) : json({error:'conflict'},409);
   }
  }
  return json({error:'not found'},404);
 }
 return env.ASSETS.fetch(req);
}
export default { async fetch(req: Request, env: Env): Promise<Response> { try { return await handler(req,env); } catch { return json({error:'request failed'},500); } } };
