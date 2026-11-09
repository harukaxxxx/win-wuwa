import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {once} from 'node:events';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
function start(mode,dir){const child=fork(new URL('./draw-crash-child.mjs',import.meta.url),[mode,dir],{stdio:['ignore','ignore','inherit','ipc']});const exit=once(child,'exit');const message=()=>Promise.race([once(child,'message').then(([m])=>m),exit.then(()=>{throw Error(mode+' exited');}),new Promise((_,reject)=>{const t=setTimeout(()=>reject(Error(mode+' timeout')),30000);t.unref();})]);return {child,exit,message};}
test('SIGKILL after Worker commit but before proxy HTTP response preserves exact same-key draw',{timeout:90000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'wuwa-draw-kill-'));let a,b;
 try{a=start('commit',dir);const ready=await a.message();assert.equal(ready.event,'ready');const pending=a.message();const request=fetch(`http://127.0.0.1:${ready.port}/api/activities/eeeeeeee-aaaa-4aaa-8aaa-aaaaaaaaaaaa/draws/forced-key`,{method:'PUT'}).then(()=>false,()=>true);const committed=await pending;assert.equal(committed.event,'committed-before-http-response');assert.equal(a.child.kill('SIGKILL'),true);assert.deepEqual(await a.exit,[null,'SIGKILL']);assert.equal(await request,true);
 b=start('restore',dir);const r=await b.message();assert.equal(r.event,'restored');assert.equal(r.get,200);assert.equal(r.retry,200);assert.deepEqual(r.value,committed.body);assert.deepEqual(r.again,committed.body);assert.equal(r.count.n,1);assert.equal(r.snapshots.n,2);const winner=r.regs.find(x=>x.status==='winner');assert.equal(winner.ordinal,r.value.draw.winner_ordinal);assert.equal(r.regs.filter(x=>x.status==='winner').length,1);assert.equal(r.rows.find(x=>x.viewer_id===winner.viewer_id).score,0);const other=r.rows.find(x=>x.viewer_id!==winner.viewer_id);assert.equal(other.score,other.viewer_id==='800'?7:4);assert.deepEqual(await b.exit,[0,null]);
 }finally{for(const p of [a,b])if(p&&p.child.exitCode===null&&p.child.signalCode===null){p.child.kill('SIGKILL');await p.exit;}await rm(dir,{recursive:true,force:true});}
});
