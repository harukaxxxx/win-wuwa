import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
const [mode,dir]=process.argv.slice(2),origin='http://localhost',id='eeeeeeee-aaaa-4aaa-8aaa-aaaaaaaaaaaa',sid='a'.repeat(64),csrf='b'.repeat(64);
const hash=x=>createHash('sha256').update(x).digest('hex');
const headers={Cookie:`__Host-session=${sid}`,Origin:origin,'X-CSRF-Token':csrf,'Content-Type':'application/json'};
const path=`/api/activities/${id}/draws/forced-key`;
const mf=new Miniflare({...convertV4MiniflareOptions({modules:true,scriptPath:'dist/index.js',compatibilityDate:'2026-07-30',d1Databases:['DB'],bindings:{ORIGIN:origin}}),resourcePersistencePath:dir});
const db=await mf.getD1Database('DB');
const send=(method)=>mf.dispatchFetch(origin+path,{method,headers,body:method==='PUT'?JSON.stringify({rule_version:1}):undefined});
try{
 if(mode==='commit'){
  for(const f of (await readdir('migrations')).sort())for(const q of (await readFile('migrations/'+f,'utf8')).split(/;\s*(?=(?:CREATE|ALTER|INSERT|UPDATE|DROP|$))/i).map(x=>x.trim()).filter(Boolean))await db.prepare(q).run();
  await db.prepare("INSERT INTO approved_streamers(user_id) VALUES ('220')").run();
  await db.prepare("INSERT INTO activities(id,owner_id,status,rule_version,created_at) VALUES (?,'220','paused',1,1)").bind(id).run();
  await db.prepare("INSERT INTO registrations(activity_id,owner_id,viewer_id,ordinal) VALUES (?,'220','800',1),(?,'220','801',2)").bind(id,id).run();
  await db.prepare("INSERT INTO viewer_scores VALUES ('220','800',7),('220','801',4)").run();
  await db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').bind(hash(sid),'220',hash(csrf),Math.floor(Date.now()/1000)+300).run();
  const server=createServer(async(req,res)=>{try{if(req.method!=='PUT'||req.url!==path){res.writeHead(404).end();return;}const response=await send('PUT'),body=await response.json();if(response.status!==200)throw Error('draw failed '+response.status);process.send({event:'committed-before-http-response',body});}catch(e){console.error(e);res.writeHead(500).end();}});
  server.listen(0,'127.0.0.1',()=>process.send({event:'ready',port:server.address().port}));
 }else{
  const get=await send('GET'),value=await get.json(),retry=await send('PUT'),again=await retry.json();
  const rows=(await db.prepare('SELECT viewer_id,score FROM viewer_scores ORDER BY viewer_id').all()).results;
  const regs=(await db.prepare('SELECT viewer_id,ordinal,status FROM registrations ORDER BY ordinal').all()).results;
  const count=await db.prepare('SELECT COUNT(*) n FROM draws').first();
  const snapshots=await db.prepare('SELECT COUNT(*) n FROM draw_candidates').first();
  await mf.dispose();process.send({event:'restored',get:get.status,retry:retry.status,value,again,rows,regs,count,snapshots},()=>process.disconnect());
 }
}catch(e){console.error(e);try{await mf.dispose();}catch{}process.send?.({event:'error',message:String(e)},()=>process.disconnect());process.exitCode=1;}
