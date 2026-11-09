import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

const origin='http://localhost';
const restricted='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const unrestricted='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let membership='member', calls=[], scope='identify guilds.members.read';
const member={user:{id:'300'},roles:[],joined_at:'2020-01-02T03:04:05.000000+00:00',deaf:false,mute:false,flags:0};
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:process.env.WUWA_TEST_BUNDLE||'dist/index.js',compatibilityDate:'2026-07-30',d1Databases:['DB'],bindings:{ORIGIN:origin,DISCORD_CLIENT_ID:'client',DISCORD_CLIENT_SECRET:'secret'},outboundService:async req=>{const path=new URL(req.url).pathname;calls.push(path);if(path==='/api/oauth2/token')return Response.json({access_token:'fixture-token',token_type:'Bearer',scope});if(path==='/api/users/@me')return Response.json({id:'300'});assert.equal(path,'/api/users/@me/guilds/42/member');if(membership==='member')return Response.json(member);if(membership==='pending')return Response.json({...member,pending:true});if(membership==='nonmember')return Response.json({code:10007,message:'Unknown Member'},{status:404});if(membership==='unknown-guild')return Response.json({code:10004},{status:404});if(membership==='unknown-404')return new Response('',{status:404});if(membership==='mismatch')return Response.json({...member,user:{id:'301'}});if(membership==='missing-user')return Response.json({...member,user:undefined});if(membership==='bad-date')return Response.json({...member,joined_at:'2024-02-30T00:00:00Z'});if(membership==='bad-optional-date')return Response.json({...member,premium_since:'invalid'});if(membership==='bad-role')return Response.json({...member,roles:['abc']});if(membership==='missing-flags')return Response.json({...member,flags:undefined});if(membership==='reauth')return new Response('',{status:401});if(membership==='rate')return Response.json({retry_after:3},{status:429});if(membership==='malformed')return Response.json({roles:[]});if(membership==='badjson')return new Response('{',{status:200});if(membership==='badpending')return Response.json({...member,pending:'false'});if(membership==='forbidden')return new Response('',{status:403});if(membership==='throw')throw new Error('synthetic network failure');if(membership==='server500')return new Response('',{status:500});return new Response('',{status:503});}}));
const db=await mf.getD1Database('DB');
for(const f of (await readdir('migrations')).sort()) for(const sql of (await readFile('migrations/'+f,'utf8')).split(';').map(x=>x.trim()).filter(Boolean)) await db.prepare(sql).run();
await db.prepare("INSERT INTO approved_streamers(user_id) VALUES ('123'),('124')").run();
await db.prepare("INSERT INTO activities(id,owner_id,status,rule_version,guild_id,created_at) VALUES (?,'123','open',1,'42',1),(?,'124','open',1,NULL,1)").bind(restricted,unrestricted).run();
const start=(owner,id)=>mf.dispatchFetch(`${origin}/auth/login?owner=${owner}&activity_id=${id}&rule_version=1`,{redirect:'manual'});

test('viewer OAuth requests guild membership scope only when the exact activity requires it',async()=>{
 const normal=await start('124',unrestricted);
 assert.equal(normal.status,302);
 const normalUrl=new URL(normal.headers.get('location'));
 assert.equal(normalUrl.searchParams.get('scope'),'identify');
 assert.equal(normalUrl.searchParams.get('code_challenge_method'),'S256');
 const gated=await start('123',restricted);
 assert.equal(gated.status,302);
 const gatedUrl=new URL(gated.headers.get('location'));
 assert.deepEqual(new Set(gatedUrl.searchParams.get('scope').split(' ')),new Set(['identify','guilds.members.read']));
 assert.equal(gatedUrl.searchParams.get('code_challenge_method'),'S256');
});
const cookies=r=>r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
async function login(owner,id){const s=await start(owner,id),state=new URL(s.headers.get('location')).searchParams.get('state');const r=await mf.dispatchFetch(`${origin}/auth/callback?code=fixture&iss=https%3A%2F%2Fdiscord.com&state=${state}`,{headers:{Cookie:cookies(s)},redirect:'manual'});assert.equal(r.status,302);return cookies(r);}
const self=(cookie,owner,id)=>mf.dispatchFetch(`${origin}/api/viewer/${owner}/self?activity_id=${id}&rule_version=1`,{headers:{Cookie:cookie}});
const post=(cookie,owner,id)=>mf.dispatchFetch(`${origin}/api/viewer/${owner}/register`,{method:'POST',headers:{Cookie:cookie,Origin:origin,'X-CSRF-Token':cookie.match(/__Host-csrf=([^;]+)/)[1],'Content-Type':'application/json'},body:JSON.stringify({activity_id:id,rule_version:1})});
test('unrestricted callback performs no membership lookup',async()=>{calls=[];const c=await login('124',unrestricted);assert.deepEqual(calls,['/api/oauth2/token','/api/users/@me']);assert.equal((await post(c,'124',unrestricted)).status,200);});
for(const status of ['nonmember','pending','reauth','forbidden','rate','providerfailure','malformed','badjson','badpending','throw','server500','unknown-guild','unknown-404','mismatch','missing-user','bad-date','bad-optional-date','bad-role','missing-flags']) test(`${status} is visible only to session and cannot register`,async()=>{membership=status;calls=[];const c=await login('123',restricted);assert.equal(calls.at(-1),'/api/users/@me/guilds/42/member');const d=await (await self(c,'123',restricted)).json();const expected=['nonmember','pending','reauth','rate'].includes(status)?status:status==='forbidden'?'reauth':'providerfailure';assert.equal(d.membership.status,expected);if(status==='rate')assert.equal(d.membership.retry_after,3);assert.equal((await post(c,'123',restricted)).status,403);assert.equal(calls.length,3);});
test('missing granted membership scope fails before identity and proof',async()=>{scope='identify';calls=[];const s=await start('123',restricted),state=new URL(s.headers.get('location')).searchParams.get('state');const r=await mf.dispatchFetch(`${origin}/auth/callback?code=fixture&iss=https%3A%2F%2Fdiscord.com&state=${state}`,{headers:{Cookie:cookies(s)},redirect:'manual'});assert.equal(r.status,502);assert.deepEqual(calls,['/api/oauth2/token']);scope='identify guilds.members.read';});
test('an expired member proof cannot authorize a first registration',async()=>{membership='member';const c=await login('123',restricted);await db.prepare("UPDATE guild_membership_proofs SET expires=0 WHERE status='member'").run();assert.equal((await (await self(c,'123',restricted)).json()).membership.status,'reauth');assert.equal((await post(c,'123',restricted)).status,403);});
test('every proof binding and post-proof owner and activity guard fail closed',async()=>{
 membership='member';calls=[];const c=await login('123',restricted);const n=calls.length;
 const sid=c.match(/__Host-session=([^;]+)/)[1],hash=createHash('sha256').update(sid).digest('hex');
 for(const [column,wrong,right] of [['user_id','301','300'],['owner_id','124','123'],['activity_id',unrestricted,restricted],['rule_version',2,1],['guild_id','43','42']]){await db.prepare(`UPDATE guild_membership_proofs SET ${column}=? WHERE session_hash=?`).bind(wrong,hash).run();assert.equal((await post(c,'123',restricted)).status,403,column);await db.prepare(`UPDATE guild_membership_proofs SET ${column}=? WHERE session_hash=?`).bind(right,hash).run();}
 await db.prepare('UPDATE guild_membership_proofs SET expires=? WHERE session_hash=?').bind(Math.floor(Date.now()/1000),hash).run();assert.equal((await post(c,'123',restricted)).status,403);
 await db.prepare('UPDATE guild_membership_proofs SET expires=? WHERE session_hash=?').bind(Math.floor(Date.now()/1000)+300,hash).run();
 await db.prepare('UPDATE sessions SET expires=? WHERE session_hash=?').bind(Math.floor(Date.now()/1000),hash).run();assert.equal((await post(c,'123',restricted)).status,401);await db.prepare('UPDATE sessions SET expires=? WHERE session_hash=?').bind(Math.floor(Date.now()/1000)+300,hash).run();
 await db.prepare("UPDATE approved_streamers SET status='disabled' WHERE user_id='123'").run();assert.equal((await post(c,'123',restricted)).status,403);await db.prepare("UPDATE approved_streamers SET status='approved' WHERE user_id='123'").run();
 await db.prepare("UPDATE activities SET status='paused' WHERE id=?").bind(restricted).run();assert.equal((await post(c,'123',restricted)).status,409);await db.prepare("UPDATE activities SET status='open' WHERE id=?").bind(restricted).run();
 assert.equal(calls.length,n);
});
test('member proof permits registration, retries do not require fresh proof, and cannot cross session or activity',async()=>{membership='member';const c=await login('123',restricted);assert.equal((await (await self(c,'123',restricted)).json()).membership.status,'member');const other=await login('124',unrestricted);assert.equal((await post(other,'123',restricted)).status,403);assert.equal((await post(c,'123',restricted)).status,200);const callsBeforeRetry=calls.length;await db.prepare("UPDATE guild_membership_proofs SET expires=0 WHERE status='member'").run();assert.equal((await post(c,'123',restricted)).status,200);assert.equal(calls.length,callsBeforeRetry);await db.prepare("UPDATE guild_membership_proofs SET expires=? WHERE status='member'").bind(Math.floor(Date.now()/1000)+300).run();await db.prepare("UPDATE activities SET status='cancelled' WHERE id=?").bind(restricted).run();const next='cccccccc-cccc-4ccc-8ccc-cccccccccccc';await db.prepare("INSERT INTO activities(id,owner_id,status,rule_version,guild_id,created_at) VALUES (?,'123','open',1,'42',1)").bind(next).run();assert.equal((await post(c,'123',next)).status,403);});
after(()=>mf.dispose());
