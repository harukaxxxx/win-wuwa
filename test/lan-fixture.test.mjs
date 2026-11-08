import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import http from 'node:http';
import { createServer } from 'node:net';
import { lanConfig, allowedLanRequest, toWorkerCookies, toLanCookie } from './lan-policy.mjs';

test('LAN policy requires an assigned private interface and exact host and subnet peer', () => {
  const interfaces = { en0: [{family:'IPv4',internal:false,address:'192.168.1.100',netmask:'255.255.255.0'}] };
  const config=lanConfig('192.168.1.100', interfaces, 19481);
  assert.equal(allowedLanRequest(config, '192.168.1.100:19481', '192.168.1.42'),true);
  assert.equal(allowedLanRequest(config, '192.168.1.100:19481', '192.168.2.42'),false);
  assert.equal(allowedLanRequest(config, 'evil:19481', '192.168.1.42'),false);
  assert.equal(allowedLanRequest(config, '192.168.1.100:19481', '::1'),false);
  assert.throws(()=>lanConfig('8.8.8.8', interfaces,19481));
  assert.throws(()=>lanConfig('192.168.1.101', interfaces,19481));
  assert.equal(toWorkerCookies('__Host-session=bad; fixture_session=good; other=x'),'__Host-session=good');
  assert.equal(toLanCookie('__Host-session=x; Path=/; Secure; HttpOnly; SameSite=Lax'),'fixture_session=x; Path=/; HttpOnly; SameSite=Lax');
  assert.throws(()=>toLanCookie('unknown=x; Secure'));
});

const address = Object.values(networkInterfaces()).flat().find(x => x.family === 'IPv4' && !x.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(x.address))?.address;
test('LAN fixture rejects forged Host and completes synthetic cookie flow', { skip: !address, timeout: 30000 }, async () => {
  const probe = createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, address, resolve); });
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const child = spawn(process.execPath, ['test/browser-fixture.mjs'], { env: { ...process.env, WUWA_LAN_PREVIEW: address, WUWA_FIXTURE_PORT: String(port) }, stdio: ['ignore','pipe','pipe'] });
  let log=''; child.stdout.on('data', x => log += x); child.stderr.on('data', x => log += x);
  try {
    for (let i=0; i<200 && !log.includes('FIXTURE READY'); i++) { if (child.exitCode !== null) throw Error(log); await new Promise(r => setTimeout(r,50)); }
    assert.match(log, /FIXTURE READY/);
    const origin=`http://${address}:${port}`, jar=new Map();
    const request=(path, options={}) => new Promise((resolve,reject) => {
      const req=http.request(new URL(path, origin), { method: options.method || 'GET', headers: { ...(jar.size ? {cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; ')} : {}), ...options.headers } }, res => {
        const chunks=[]; res.on('data',x=>chunks.push(x)); res.on('end',()=>{ for(const c of res.headers['set-cookie'] || []) { const [pair,...attrs]=c.split(';'); const p=pair.indexOf('='); const name=pair.slice(0,p), value=pair.slice(p+1); assert.match(name,/^fixture_/); assert.ok(attrs.some(a=>a.trim().toLowerCase()==='httponly')); assert.ok(attrs.some(a=>a.trim().toLowerCase()==='path=/')); assert.ok(attrs.some(a=>a.trim().toLowerCase()==='samesite=lax')); assert.ok(!attrs.some(a=>a.trim().toLowerCase()==='secure')); if(value) jar.set(name,value); else jar.delete(name); } resolve({status:res.statusCode, headers:res.headers, body:Buffer.concat(chunks).toString()}); });
      }); req.on('error',reject); if(options.body) req.write(options.body); req.end();
    });
    assert.equal((await request('/',{headers:{host:'evil.example'}})).status,403);
    const page=await request('/'); assert.match(page.body,/區網合成測試・未加密・非真Discord，請勿輸入敏感資料/); assert.match(page.body,/以測試帳號登入/);
    let r=await request('/auth/login'); assert.equal(r.status,302); assert.ok(jar.has('fixture_oauth'));
    r=await request(r.headers.location); assert.equal(r.status,302);
    r=await request(r.headers.location); assert.equal(r.status,302); assert.ok(jar.has('fixture_session')); assert.ok(jar.has('fixture_csrf'));
    r=await request('/api/session'); assert.equal(r.status,200); const {csrf,approved}=JSON.parse(r.body); assert.equal(approved,true);
    r=await request('/api/environment',{method:'PUT',headers:{origin:'http://evil.example', 'content-type':'application/json','x-csrf-token':csrf},body:JSON.stringify({value:'bad',version:0})}); assert.equal(r.status,403);
    r=await request('/api/environment',{method:'PUT',headers:{origin, 'content-type':'application/json','x-csrf-token':csrf},body:JSON.stringify({value:'synthetic',version:0})}); assert.equal(r.status,200);
    r=await request('/api/environment'); assert.equal(JSON.parse(r.body).value,'synthetic');
    r=await request('/api/logout',{method:'POST',headers:{origin,'x-csrf-token':csrf}}); assert.equal(r.status,204);
    assert.equal((await request('/api/session')).status,401);
  } finally { child.kill('SIGTERM'); await new Promise(r => child.once('exit',r)); }
});
