// Test-only loopback proxy: never forwards requests to Discord or any other upstream.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { lanConfig, allowedLanRequest, toWorkerCookies, toLanCookie } from './lan-policy.mjs';

const port = Number(process.env.WUWA_FIXTURE_PORT ?? 19481);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid fixture port');
const lan = process.env.WUWA_LAN_PREVIEW === undefined ? null : lanConfig(process.env.WUWA_LAN_PREVIEW, networkInterfaces(), port);
const origin = `http://${lan ? lan.address : 'localhost'}:${port}`;
const assets = new Map([['/', ['public/index.html','text/html; charset=utf-8']], ['/app.js', ['public/app.js','text/javascript; charset=utf-8']]]);
const mf = new Miniflare(convertV4MiniflareOptions({
  modules: true, scriptPath: 'dist/index.js', compatibilityDate: '2026-07-30', d1Databases: ['DB'],
  bindings: { ORIGIN: origin, DISCORD_CLIENT_ID: 'synthetic-client', DISCORD_CLIENT_SECRET: 'synthetic-secret' },
  serviceBindings: { ASSETS: async req => {
    const asset = assets.get(new URL(req.url).pathname);
    if (!asset) return new Response('Not found', { status: 404 });
    let body = await readFile(asset[0]);
    if (lan && asset[0] === 'public/index.html') body = Buffer.from(body.toString().replace('<main>', '<main><p role="alert" style="font-weight:bold;color:#a00">區網合成測試・未加密・非真Discord，請勿輸入敏感資料</p>').replace('以 Discord 登入', '以測試帳號登入'));
    return new Response(body, { headers: { 'content-type': asset[1] } });
  } },
  outboundService: async req => {
    const url = new URL(req.url);
    if (url.href === 'https://discord.com/api/oauth2/token' && req.method === 'POST') return Response.json({ access_token: 'synthetic-token', token_type: 'Bearer' });
    if (url.href === 'https://discord.com/api/users/@me' && req.method === 'GET') return Response.json({ id: '123' });
    return new Response('Blocked synthetic outbound', { status: 502 });
  }
}));
const db = await mf.getD1Database('DB');
for (const file of ['migrations/0001_init.sql','migrations/0002_login_budget.sql']) {
  for (const sql of (await readFile(file, 'utf8')).split(';').map(s => s.trim()).filter(Boolean)) await db.prepare(sql).run();
}
await db.prepare('INSERT INTO approved_streamers VALUES (?)').bind('123').run();
const server = createServer(async (req, res) => {
  try {
    if (lan && (req.rawHeaders.filter((_, i) => i % 2 === 0 && req.rawHeaders[i].toLowerCase() === 'host').length !== 1 || !allowedLanRequest(lan, req.headers.host, req.socket.remoteAddress))) { res.writeHead(403); res.end('Forbidden'); return; }
    const url = new URL(req.url, origin);
    if (url.origin !== origin) { res.writeHead(403); res.end('Forbidden'); return; }
    if (url.pathname === '/__fixture/authorize') {
      const original = new URL(url.searchParams.get('request'));
      if (original.origin !== 'https://discord.com' || original.pathname !== '/oauth2/authorize' || original.searchParams.get('redirect_uri') !== origin + '/auth/callback' || !original.searchParams.get('state')) throw Error('Invalid authorization request');
      const callback = new URL(original.searchParams.get('redirect_uri'));
      callback.search = new URLSearchParams({ code: 'synthetic-code', state: original.searchParams.get('state'), iss: 'https://discord.com' }).toString();
      res.writeHead(302, { location: callback.href, 'cache-control': 'no-store' }); res.end();
      console.log('fixture authorize -> callback 302'); return;
    }
    const chunks=[]; for await (const chunk of req) chunks.push(chunk);
    const headers = new Headers(); for (const [name,value] of Object.entries(req.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
    if (lan) { headers.delete('cookie'); const cookies = toWorkerCookies(req.headers.cookie); if (cookies) headers.set('cookie', cookies); }
    const response = await mf.dispatchFetch(url.href, { method: req.method, headers, body: ['GET','HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks), redirect: 'manual' });
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
