// Test-only loopback proxy: never forwards requests to Discord or any other upstream.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { lanConfig, allowedLanRequest, toWorkerCookies, toLanCookie } from './lan-policy.mjs';

const port = Number(process.env.WUWA_FIXTURE_PORT ?? 19481);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid fixture port');
const lan = process.env.WUWA_LAN_PREVIEW === undefined ? null : lanConfig(process.env.WUWA_LAN_PREVIEW, networkInterfaces(), port);
const managementQA = process.env.WUWA_MANAGEMENT_QA === '1' && !lan;
const viewerQA = process.env.WUWA_VIEWER_QA === '1' && !lan;
const statusQA = process.env.WUWA_STATUS_QA === '1' && viewerQA && managementQA && !lan;
let dropStatus=false,failStatusRead=false,dropWithdraw=false,failWithdrawRead=false,failOldSelf=false;
const statusCalls=[];
let viewerIdentity='300', pauseAuth=false, dropRegistration=false, failViewerSelf=false, blockRegistration=false;
const guildQA = process.env.WUWA_GUILD_QA === '1' && viewerQA && !lan;
let memberMode='member'; const outboundCalls=[], authorizationRequests=[], authorizationCodes=new Map();
const origin = `http://${lan ? lan.address : 'localhost'}:${port}`;
const assets = new Map([['/', ['public/index.html','text/html; charset=utf-8']], ['/viewer',['public/viewer.html','text/html; charset=utf-8']], ['/viewer.js',['public/viewer.js','text/javascript; charset=utf-8']], ['/app.js', ['public/app.js','text/javascript; charset=utf-8']], ['/style.css', ['public/style.css','text/css; charset=utf-8']]]);
const mf = new Miniflare(convertV4MiniflareOptions({
  modules: true, scriptPath: 'dist/index.js', compatibilityDate: '2026-07-30', d1Databases: ['DB'],
  bindings: { ORIGIN: origin, DISCORD_CLIENT_ID: 'synthetic-client', DISCORD_CLIENT_SECRET: 'synthetic-secret', ...(managementQA ? {ADMIN_DISCORD_ID:'123'} : {}) },
  serviceBindings: { ASSETS: async req => {
    const asset = assets.get(new URL(req.url).pathname);
    if (!asset) return new Response('Not found', { status: 404 });
    let body = await readFile(asset[0]);
    if (lan && asset[0] === 'public/index.html') body = Buffer.from(body.toString().replace('<main>', '<main><p role="alert" style="font-weight:bold;color:#a00">區網合成測試・未加密・非真Discord，請勿輸入敏感資料</p>').replace('以 Discord 登入', '以測試帳號登入'));
    return new Response(body, { headers: { 'content-type': asset[1] } });
  } },
  outboundService: async req => {
    const url = new URL(req.url);
    if(guildQA) outboundCalls.push(url.pathname);
    if(guildQA && /^\/api\/users\/@me\/guilds\/\d+\/member$/.test(url.pathname) && req.method==='GET') {
      if(memberMode==='nonmember')return Response.json({code:10007},{status:404});
      if(memberMode==='unknown-guild')return Response.json({code:10004},{status:404});
      if(memberMode==='rate')return Response.json({retry_after:30},{status:429});
      const id=(req.headers.get('Authorization')||'').replace('Bearer synthetic-','');
      return Response.json({user:{id},roles:[],joined_at:'2020-01-02T03:04:05.000000+00:00',deaf:false,mute:false,flags:0,...(memberMode==='pending'?{pending:true}:{})});
    }
    if (url.href === 'https://discord.com/api/oauth2/token' && req.method === 'POST') {const form=new URLSearchParams(await req.text()),code=form.get('code'),grant=authorizationCodes.get(code);if(!grant)return new Response('Unknown synthetic authorization code',{status:400});authorizationCodes.delete(code);return Response.json({ access_token: viewerQA ? 'synthetic-'+grant.identity : 'synthetic-token', token_type: 'Bearer', scope:grant.scope });}
    if (url.href === 'https://discord.com/api/users/@me' && req.method === 'GET') return Response.json({ id: viewerQA ? (req.headers.get('Authorization')||'').replace('Bearer synthetic-','') : '123' });
    return new Response('Blocked synthetic outbound', { status: 502 });
  }
}));
const db = await mf.getD1Database('DB');
for (const file of ['migrations/0001_init.sql','migrations/0002_login_budget.sql','migrations/0003_streamer_status.sql','migrations/0004_activities.sql','migrations/0005_opening_generation.sql','migrations/0006_activity_defaults.sql',...(viewerQA?['migrations/0007_registrations.sql','migrations/0008_viewer_oauth.sql','migrations/0009_guild_proofs.sql']:[]),'migrations/0010_guild_invite.sql','migrations/0011_activity_status_version.sql']) {
  for (const sql of (await readFile(file, 'utf8')).split(';').map(s => s.trim()).filter(Boolean)) await db.prepare(sql).run();
}
await db.prepare('INSERT INTO approved_streamers(user_id) VALUES (?)').bind('123').run();
if(viewerQA && !guildQA) await db.prepare("INSERT INTO activities(id,owner_id,status,rule_version,guild_id,created_at) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','123','open',1,NULL,1)").run();
if(managementQA) for(let i=10000;i<10105;i++) await db.prepare('INSERT INTO approved_streamers(user_id) VALUES (?)').bind(String(i)).run();
let dropPut=false, failGet=false, blockPut=false, dropActivity=false, failCurrent=false, blockActivity=false;
const server = createServer(async (req, res) => {
  try {
    if (lan && (req.rawHeaders.filter((_, i) => i % 2 === 0 && req.rawHeaders[i].toLowerCase() === 'host').length !== 1 || !allowedLanRequest(lan, req.headers.host, req.socket.remoteAddress))) { res.writeHead(403); res.end('Forbidden'); return; }
    const url = new URL(req.url, origin);
    if (url.origin !== origin) { res.writeHead(403); res.end('Forbidden'); return; }
    if(statusQA && url.pathname==='/__fixture/status' && req.method==='GET'){const activities=await db.prepare('SELECT id,status,status_version,rule_version FROM activities ORDER BY created_at').all();const registrations=await db.prepare('SELECT activity_id,viewer_id,status,ordinal FROM registrations ORDER BY activity_id,viewer_id').all();res.setHeader('content-type','application/json');res.end(JSON.stringify({calls:statusCalls,activities:activities.results,registrations:registrations.results}));return;}
    if(statusQA && url.pathname==='/__fixture/status' && req.method==='POST'){const chunks=[];for await(const c of req)chunks.push(c);const mode=Buffer.concat(chunks).toString();if(mode==='drop-status'){dropStatus=true;failStatusRead=true;}else if(mode==='drop-withdraw'){dropWithdraw=true;failWithdrawRead=true;}else if(mode==='fail-self')failViewerSelf=true;else if(mode==='fail-old-self')failOldSelf=true;else if(mode==='owner')viewerIdentity='123';else if(mode==='viewer')viewerIdentity='300';else if(mode==='reset-calls')statusCalls.length=0;else if(mode==='terminate')await db.prepare("UPDATE activities SET status='cancelled' WHERE owner_id='123' AND status IN ('open','paused')").run();else if(mode==='new')await db.prepare("INSERT INTO activities(id,owner_id,status,rule_version,guild_id,created_at) VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','123','open',1,NULL,2)").run();else {res.writeHead(400);res.end();return;}res.end('armed');return;}
    if(guildQA && url.pathname==='/__fixture/guild' && req.method==='GET'){res.setHeader('content-type','application/json');res.end(JSON.stringify({memberMode,outboundCalls,authorizationRequests}));return;}
    if(guildQA && url.pathname==='/__fixture/guild' && req.method==='POST'){const chunks=[];for await(const c of req)chunks.push(c);const mode=Buffer.concat(chunks).toString();if(['member','nonmember','pending','rate','unknown-guild'].includes(mode))memberMode=mode;else if(mode==='reset-calls')outboundCalls.length=0;else if(mode==='owner')viewerIdentity='123';else if(mode==='viewer')viewerIdentity='300';else {res.writeHead(400);res.end();return;}res.end('ok');return;}
    if(viewerQA && url.pathname==='/__fixture/viewer-control' && req.method==='POST') {const chunks=[];for await(const c of req)chunks.push(c);const mode=Buffer.concat(chunks).toString();if(['300','301'].includes(mode))viewerIdentity=mode;else if(mode==='pause')pauseAuth=true;else if(mode==='disable'||mode==='approve')await db.prepare('UPDATE approved_streamers SET status=? WHERE user_id=?').bind(mode==='disable'?'disabled':'approved','123').run();else if(mode==='drop-registration'){dropRegistration=true;failViewerSelf=true;}else if(mode==='block-registration')blockRegistration=true;else if(mode==='guild')await db.prepare("UPDATE activities SET guild_id='12' WHERE owner_id='123' AND status='open'").run();else if(mode==='replace'){await db.prepare("UPDATE activities SET status='cancelled' WHERE owner_id='123' AND status='open'").run();await db.prepare("INSERT INTO activities(id,owner_id,status,rule_version,guild_id,created_at) VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','123','open',1,NULL,2)").run();}else{res.writeHead(400);res.end();return;}res.end('ok');return;}
    if(managementQA && url.pathname==='/__fixture/control' && req.method==='POST') { const chunks=[];for await(const chunk of req)chunks.push(chunk);const mode=Buffer.concat(chunks).toString();if(mode==='drop-put')dropPut=true;else if(mode==='fail-get')failGet=true;else if(mode==='block-put')blockPut=true;else if(mode==='drop-activity')dropActivity=true;else if(mode==='block-activity')blockActivity=true;else if(mode==='fail-current')failCurrent=true;else if(mode==='terminate-fixture-activity'){const result=await db.prepare("UPDATE activities SET status='cancelled' WHERE owner_id='123' AND status='open' RETURNING id").all();res.setHeader('content-type','application/json');res.end(JSON.stringify(result.results));return;}else {res.writeHead(400);res.end();return;}res.end('armed');return; }
    if(managementQA && url.pathname==='/__fixture/rows' && req.method==='GET') {const rows=await db.prepare('SELECT user_id,status,version FROM approved_streamers ORDER BY user_id').all();res.setHeader('content-type','application/json');res.end(JSON.stringify(rows.results));return;}
    if (url.pathname === '/__fixture/authorize') {
      const original = new URL(url.searchParams.get('request'));
      if (original.origin !== 'https://discord.com' || original.pathname !== '/oauth2/authorize' || original.searchParams.get('redirect_uri') !== origin + '/auth/callback' || !original.searchParams.get('state')) throw Error('Invalid authorization request');
      const code='synthetic-'+crypto.randomUUID(),scope=original.searchParams.get('scope')||'';
      authorizationCodes.set(code,{identity:viewerIdentity,scope});
      if(guildQA)authorizationRequests.push({scope});
      const callback = new URL(original.searchParams.get('redirect_uri'));
      callback.search = new URLSearchParams({ code, state: original.searchParams.get('state'), iss: 'https://discord.com' }).toString();
      if(viewerQA && pauseAuth){pauseAuth=false;res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(`<p>合成授權已暫停</p><a href="${callback.pathname+callback.search.replaceAll('&','&amp;')}">繼續合成授權</a>`);return;}
      res.writeHead(302, { location: callback.href, 'cache-control': 'no-store' }); res.end();
      console.log('fixture authorize -> callback 302'); return;
    }
    const chunks=[]; for await (const chunk of req) chunks.push(chunk);
    if(statusQA && (/^\/api\/activities\/[0-9a-f-]+\/status$/.test(url.pathname)||/^\/api\/viewer\/123\/(self|withdraw|register)$/.test(url.pathname)))statusCalls.push({method:req.method,url:url.pathname+url.search,body:Buffer.concat(chunks).toString()});
    const headers = new Headers(); for (const [name,value] of Object.entries(req.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
    if (lan) { headers.delete('cookie'); const cookies = toWorkerCookies(req.headers.cookie); if (cookies) headers.set('cookie', cookies); }
    if(managementQA && blockPut && req.method==='PUT' && /^\/api\/admin\/streamers\/\d+$/.test(url.pathname)) {blockPut=false;console.log(`fixture blocked PUT before write ${url.pathname}`);res.writeHead(200,{'content-type':'application/json','content-length':'100'});res.write('{');res.flushHeaders();setTimeout(()=>res.destroy(),25);return;}
    if(managementQA && blockActivity && req.method==='PUT' && /^\/api\/activities\/[0-9a-f-]+$/.test(url.pathname)){blockActivity=false;console.log(`fixture blocked activity before write ${url.pathname}`);res.writeHead(200,{'content-type':'application/json','content-length':'100'});res.write('{');res.flushHeaders();setTimeout(()=>res.destroy(),25);return;}
    if(viewerQA && req.method==='POST' && url.pathname==='/api/viewer/123/register' && blockRegistration){blockRegistration=false;console.log('fixture blocked registration before write');res.writeHead(200,{'content-type':'application/json','content-length':'100'});res.write('{');res.flushHeaders();setTimeout(()=>res.destroy(),25);return;}
    const response = await mf.dispatchFetch(url.href, { method: req.method, headers, body: ['GET','HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks), redirect: 'manual' });
    if(statusQA && req.method==='PUT' && /^\/api\/activities\/[0-9a-f-]+\/status$/.test(url.pathname) && dropStatus){dropStatus=false;await response.arrayBuffer();console.log(`fixture truncate status after worker response ${response.status}`);res.writeHead(response.status,{'content-type':'application/json','content-length':'100'});res.write('{');res.flushHeaders();setTimeout(()=>res.destroy(),25);return;}
    if(statusQA && req.method==='POST' && url.pathname==='/api/viewer/123/withdraw' && dropWithdraw){dropWithdraw=false;await response.arrayBuffer();console.log(`fixture truncate withdraw after worker response ${response.status}`);res.writeHead(response.status,{'content-type':'application/json','content-length':'100'});res.write('{');res.flushHeaders();setTimeout(()=>res.destroy(),25);return;}
    if(statusQA && req.method==='GET' && /^\/api\/activities\/[0-9a-f-]+\/status$/.test(url.pathname) && failStatusRead){failStatusRead=false;res.writeHead(503);res.end();return;}
    if(statusQA && req.method==='GET' && url.pathname==='/api/viewer/123/self' && failOldSelf && url.searchParams.get('activity_id')==='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'){failOldSelf=false;res.writeHead(503);res.end();return;}
    if(statusQA && req.method==='GET' && url.pathname==='/api/viewer/123/self' && failWithdrawRead){failWithdrawRead=false;res.writeHead(503);res.end();return;}
    if(viewerQA && req.method==='POST' && url.pathname==='/api/viewer/123/register' && dropRegistration){dropRegistration=false;await response.arrayBuffer();console.log(`fixture truncated registration ${response.status}`);res.writeHead(response.status,{'content-type':'application/json','content-length':'100'});res.write('{');res.flushHeaders();setTimeout(()=>res.destroy(),25);return;}
    if(viewerQA && req.method==='GET' && url.pathname==='/api/viewer/123/self' && failViewerSelf){failViewerSelf=false;res.writeHead(503);res.end();return;}
    if(managementQA && req.method==='PUT' && /^\/api\/activities\/[0-9a-f-]+$/.test(url.pathname) && dropActivity){dropActivity=false;await response.arrayBuffer();console.log(`fixture dropped activity PUT ${url.pathname} ${response.status}`);res.writeHead(response.status,{'content-type':'application/json','content-length':'100'});res.write('{');res.flushHeaders();setTimeout(()=>res.destroy(),25);return;}
    if(managementQA && req.method==='GET' && url.pathname==='/api/activities/current' && failCurrent){failCurrent=false;console.log('fixture failed activity current GET');res.writeHead(503);res.end('fixture read failure');return;}
    if(managementQA && /^\/api\/admin\/streamers\/\d+$/.test(url.pathname)) {if(req.method==='PUT' && dropPut){dropPut=false;await response.arrayBuffer();console.log(`fixture dropped PUT response ${url.pathname} ${response.status}`);res.writeHead(response.status,{'content-type':'application/json','content-length':'100'});res.write('{');res.flushHeaders();setTimeout(()=>res.destroy(),25);return;}if(req.method==='GET' && failGet){failGet=false;console.log(`fixture failed GET response ${url.pathname}`);res.writeHead(503);res.end('fixture read failure');return;}}
    const out = {}; response.headers.forEach((value, key) => { if (key !== 'set-cookie') out[key] = value; });
    const cookies = response.headers.getSetCookie(); if (cookies.length) out['set-cookie'] = lan ? cookies.map(toLanCookie) : cookies;
    if (url.pathname === '/auth/login' && response.status === 302) {
      const target = new URL(response.headers.get('location'));
      if (target.origin !== 'https://discord.com' || target.pathname !== '/oauth2/authorize') throw Error('Unexpected authorize destination');
      const local = new URL('/__fixture/authorize', origin); local.searchParams.set('request', target.href); out.location = local.href;
    }
    if (out.location && /^https?:/i.test(out.location) && new URL(out.location, origin).origin !== origin) throw Error('External redirect blocked');
    const bytes = Buffer.from(await response.arrayBuffer());
    res.writeHead(response.status, out); res.end(bytes);
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) {
      const body = url.pathname === '/api/environment' ? ` ${bytes.toString('utf8')}` : '';
      console.log(`${req.method} ${url.pathname} ${response.status}${body}`);
    }
  } catch (e) { console.error('fixture request error:', e.message); if (!res.headersSent) res.writeHead(500); res.end('fixture error'); }
});
server.listen(port, lan ? lan.address : '127.0.0.1', () => console.log(`FIXTURE READY ${origin} (synthetic only)`));
for (const signal of ['SIGTERM','SIGINT']) process.on(signal, () => server.close(async () => { await mf.dispose(); process.exit(0); }));
