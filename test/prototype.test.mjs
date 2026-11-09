import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Miniflare, convertV4MiniflareOptions, Log, LogLevel } from 'miniflare';
const origin='http://localhost';
const secret='synthetic-secret-never-real';
let requests=[], providerMode='ok';
const logs=[], scannedSecrets=new Set([secret,'fixture-token','fixture-refresh','fixture-code']);
class CaptureLog extends Log { log(message) { logs.push(String(message)); } }
const log=new CaptureLog(LogLevel.VERBOSE);
log.info('capture-sink-probe');
const options=convertV4MiniflareOptions({modules:true,scriptPath:'dist/index.js',compatibilityDate:'2026-07-30',d1Databases:['DB'],bindings:{ORIGIN:origin,DISCORD_CLIENT_ID:'fixture-id',DISCORD_CLIENT_SECRET:secret},outboundService:async req=>{
 const url=new URL(req.url); const body=await req.text(); requests.push({url:url.href,body,authorization:req.headers.get('authorization')});
 if(providerMode==='network' || (providerMode==='user-network' && url.pathname.endsWith('/@me'))) throw new Error(`${secret} fixture-token fixture-refresh fixture-code ${new URLSearchParams(requests.findLast(x=>x.url.endsWith('/token'))?.body).get('code_verifier') || ''}`);
 if(providerMode==='token-redirect' && url.pathname.endsWith('/token')) return new Response('fixture-token',{status:302,headers:{Location:'https://attacker.invalid/fixture-token'}});
 if(providerMode==='user-redirect' && url.pathname.endsWith('/@me')) return new Response('fixture-token',{status:302,headers:{Location:'https://attacker.invalid/fixture-token'}});
 if(providerMode==='malformed' && url.pathname.endsWith('/token')) return new Response('fixture-token not json');
 if(providerMode==='invalid-token' && url.pathname.endsWith('/token')) return Response.json({access_token:'fixture-token',token_type:'invalid',refresh_token:'fixture-refresh'});
 if(providerMode==='user-malformed' && url.pathname.endsWith('/@me')) return new Response('fixture-token not json');
 if(providerMode==='invalid-user' && url.pathname.endsWith('/@me')) return Response.json({id:'invalid'});
 if(url.href==='https://discord.com/api/oauth2/token') return Response.json({access_token:'fixture-token',token_type:'Bearer',refresh_token:'fixture-refresh',scope:'identify'});
 if(url.href==='https://discord.com/api/users/@me') return Response.json({id:'123'});
 return new Response('blocked',{status:500});
}});
const mf=new Miniflare({...options,log,handleStructuredLogs:entry=>logs.push(JSON.stringify(entry))});
const db=await mf.getD1Database('DB');
for(const file of ['migrations/0001_init.sql','migrations/0002_login_budget.sql','migrations/0003_streamer_status.sql']) for(const sql of (await readFile(file,'utf8')).split(';').map(x=>x.trim()).filter(Boolean)) await db.prepare(sql).run();
const fetcher=(path,opts={})=>mf.dispatchFetch(origin+path,{redirect:'manual',...opts});
const cookieString=r=>r.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
let sessionCookie,csrf;

test('anonymous rejected',async()=>assert.equal((await fetcher('/api/environment')).status,401));
test('OAuth state, PKCE, secure cookies, replay and no secret exposure',async()=>{
 const start=await fetcher('/auth/login'); assert.equal(start.status,302); const auth=new URL(start.headers.get('location')); const state=auth.searchParams.get('state'); assert.equal(auth.searchParams.get('scope'),'identify'); assert.equal(auth.searchParams.get('code_challenge_method'),'S256'); assert.equal(auth.searchParams.get('redirect_uri'),origin+'/auth/callback');
 const set=start.headers.getSetCookie(); assert.match(set[0],/Secure; HttpOnly; SameSite=Lax/); assert(!JSON.stringify([...start.headers]).includes(secret));
 const oauth=cookieString(start); const callback=`/auth/callback?code=fixture-code&state=${state}&iss=${encodeURIComponent('https://discord.com')}`;
 assert.equal((await fetcher(callback,{headers:{Cookie:'__Host-oauth='+'0'.repeat(64)}})).status,400);
 const res=await fetcher(callback,{headers:{Cookie:oauth}}); assert.equal(res.status,302); assert.equal(requests.length,2); const exchange=new URLSearchParams(requests[0].body); assert.equal(exchange.get('client_secret'),secret); assert.equal(exchange.get('redirect_uri'),origin+'/auth/callback'); assert.equal(createHash('sha256').update(exchange.get('code_verifier')).digest('base64url'),auth.searchParams.get('code_challenge')); assert.equal(requests[1].authorization,'Bearer fixture-token');
 for(const c of res.headers.getSetCookie()) assert.match(c,/Secure; HttpOnly; SameSite=Lax/);
 sessionCookie=cookieString(res); const text=JSON.stringify([...res.headers]); assert(!text.includes(secret)); assert(!text.includes('fixture-token')); assert.equal((await fetcher(callback,{headers:{Cookie:oauth}})).status,400);
 const info=await fetcher('/api/session',{headers:{Cookie:sessionCookie}}); const data=await info.json(); csrf=data.csrf; assert.equal(data.approved,false); assert.equal((await fetcher('/api/environment',{headers:{Cookie:sessionCookie}})).status,403);
});
test('owner-only environment, csrf and concurrent CAS',async()=>{
 await db.prepare('INSERT INTO approved_streamers(user_id) VALUES (?)').bind('123').run();
 const base={Cookie:sessionCookie,Origin:origin,'X-CSRF-Token':csrf,'Content-Type':'application/json'};
 for (const body of ['null','[]','42','"text"']) assert.equal((await fetcher('/api/environment',{method:'PUT',headers:base,body})).status,400);
 assert.equal((await fetcher('/api/session',{headers:{Cookie:sessionCookie.replaceAll('; ',';')}})).status,200);
 let r=await fetcher('/api/environment',{method:'PUT',headers:{...base,Origin:'http://evil.test'},body:JSON.stringify({value:'bad',version:0})}); assert.equal(r.status,403);
 r=await fetcher('/api/environment',{method:'PUT',headers:base,body:JSON.stringify({value:'initial',version:0})}); assert.equal(r.status,200);
 const contenders=await Promise.all(['one','two'].map(value=>fetcher('/api/environment',{method:'PUT',headers:base,body:JSON.stringify({value,version:1})}))); assert.deepEqual(contenders.map(r=>r.status).sort(),[200,409]);
 const row=await (await fetcher('/api/environment',{headers:{Cookie:sessionCookie}})).json(); assert.equal(row.version,2); assert(['one','two'].includes(row.value));
 // Retry after the response is lost: stale version must not commit twice.
 assert.equal((await fetcher('/api/environment',{method:'PUT',headers:base,body:JSON.stringify({value:'retry',version:1})})).status,409);
 assert.deepEqual(await (await fetcher('/api/environment',{headers:{Cookie:sessionCookie}})).json(),row);
});
test('real D1 unique constraints and failed atomic batch rollback',async()=>{
 await assert.rejects(db.prepare('INSERT INTO approved_streamers(user_id) VALUES (?)').bind('123').run());
 await assert.rejects(db.batch([db.prepare('INSERT INTO approved_streamers(user_id) VALUES (?)').bind('456'),db.prepare('INSERT INTO approved_streamers(user_id) VALUES (?)').bind('123')]));
 assert.equal(await db.prepare('SELECT user_id FROM approved_streamers WHERE user_id=?').bind('456').first(),null);
});
test('second approved identity cannot read or alter first environment',async()=>{
 const sid='b'.repeat(64), c='c'.repeat(64), digest=x=>createHash('sha256').update(x).digest('hex');
 await db.prepare('INSERT INTO approved_streamers(user_id) VALUES (?)').bind('789').run();
 await db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').bind(digest(sid),'789',digest(c),Math.floor(Date.now()/1000)+300).run();
 const headers={Cookie:`__Host-session=${sid}`,Origin:origin,'X-CSRF-Token':c,'Content-Type':'application/json'};
 assert.deepEqual(await (await fetcher('/api/environment',{headers})).json(),{value:'',version:0});
 assert.equal((await fetcher('/api/environment',{method:'PUT',headers,body:JSON.stringify({value:'second',version:0})})).status,200);
 assert.notEqual((await (await fetcher('/api/environment',{headers:{Cookie:sessionCookie}})).json()).value,'second');
});
test('expired state cannot exchange code',async()=>{
 const start=await fetcher('/auth/login'); const state=new URL(start.headers.get('location')).searchParams.get('state');
 await db.prepare('UPDATE oauth_states SET expires=0 WHERE state_hash=?').bind(createHash('sha256').update(state).digest('hex')).run();
 const count=requests.length; assert.equal((await fetcher(`/auth/callback?code=x&state=${state}&iss=${encodeURIComponent('https://discord.com')}`,{headers:{Cookie:cookieString(start)}})).status,400); assert.equal(requests.length,count);
});
test('expired records are cleaned and anonymous state admission is bounded',async()=>{
 await db.prepare("INSERT INTO sessions VALUES ('expired-session','1','x',0)").run();
 await db.prepare("INSERT INTO oauth_states VALUES ('expired-state',0,'x')").run();
 assert.equal((await fetcher('/auth/login')).status,302);
 assert.equal(await db.prepare("SELECT session_hash FROM sessions WHERE session_hash='expired-session'").first(),null);
 assert.equal(await db.prepare("SELECT state_hash FROM oauth_states WHERE state_hash='expired-state'").first(),null);
 await db.prepare('DELETE FROM oauth_states').run();
 await db.prepare("WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1000) INSERT INTO oauth_states SELECT 'limit-'||x, 9999999999, 'x' FROM n").run();
 assert.equal((await fetcher('/auth/login')).status,503);
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM oauth_states').first()).n,1000);
 await db.prepare('DELETE FROM oauth_states').run();
 await db.prepare('UPDATE login_budget SET starts=1000').run();
 assert.equal((await fetcher('/auth/login')).status,503);
 await db.prepare('DELETE FROM login_budget').run();
});
test('provider failures do not expose synthetic secrets in runtime logs or HTTP',async()=>{
 assert(logs.some(x=>x.includes('capture-sink-probe')));
 const probe=new Miniflare({...convertV4MiniflareOptions({modules:true,script:'export default {fetch() { console.log("runtime-console-probe"); return new Response("ok"); }}',compatibilityDate:'2026-07-30'}),log,handleStructuredLogs:entry=>logs.push(JSON.stringify(entry))});
 try { await probe.dispatchFetch(origin); } finally { await probe.dispose(); }
 assert(logs.some(x=>x.includes('runtime-console-probe')),'runtime console sink did not capture probe');
 for (const mode of ['token-redirect','user-redirect','malformed','invalid-token','user-malformed','invalid-user','network','user-network']) {
  providerMode=mode; const start=await fetcher('/auth/login'); const state=new URL(start.headers.get('location')).searchParams.get('state'); const before=requests.length;
  const verifier=(await db.prepare('SELECT verifier FROM oauth_states WHERE state_hash=?').bind(createHash('sha256').update(state).digest('hex')).first()).verifier;
  scannedSecrets.add(verifier);
  const res=await fetcher(`/auth/callback?code=fixture-code&state=${state}&iss=${encodeURIComponent('https://discord.com')}`,{headers:{Cookie:cookieString(start)}});
  assert([500,502].includes(res.status)); const exposed=JSON.stringify([...res.headers])+await res.text();
  for (const item of [secret,'fixture-token','fixture-refresh','fixture-code',verifier]) { assert(!exposed.includes(item),'secret leaked in HTTP'); assert(!logs.join('\n').includes(item),'secret leaked in runtime logs'); }
  const calls=requests.slice(before); assert.equal(calls.length,['user-redirect','user-network','user-malformed','invalid-user'].includes(mode)?2:1); assert(calls.every(x=>new URL(x.url).hostname==='discord.com'));
 }
 providerMode='ok';
});
test('logout revokes session',async()=>{const r=await fetcher('/api/logout',{method:'POST',headers:{Cookie:sessionCookie,Origin:origin,'X-CSRF-Token':csrf}});assert.equal(r.status,204);assert.equal((await fetcher('/api/session',{headers:{Cookie:sessionCookie}})).status,401)});
after(async()=>{await mf.dispose(); for(const item of scannedSecrets) assert(!logs.join('\n').includes(item),'secret leaked in runtime logs');});
