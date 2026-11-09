import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {once} from 'node:events';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const root=join(tmpdir(),'wuwa-open-crash-');
function start(mode,dir){const child=fork(new URL('./activity-crash-child.mjs',import.meta.url),[mode,dir],{stdio:['ignore','ignore','inherit','ipc']});const exit=once(child,'exit');return {child,exit,message:Promise.race([once(child,'message').then(([x])=>x),exit.then(()=>{throw Error(mode+' exited');}),new Promise((_,reject)=>{const t=setTimeout(()=>reject(Error(mode+' timeout')),30000);t.unref();})])};}
test('opening committed but HTTP result unknown to caller survives forced termination and same-key retry',{timeout:90000},async()=>{
 const dir=await mkdtemp(root);let a,b;
 try {a=start('commit',dir);assert.deepEqual(await a.message,{event:'committed'});assert.equal(a.child.kill('SIGKILL'),true);assert.deepEqual(await a.exit,[null,'SIGKILL']);
 b=start('restore',dir);const r=await b.message;assert.equal(r.event,'restored');assert.equal(r.retry,200);assert.equal(r.conflict,409);assert.equal(r.activity.id,'12345678-aaaa-4aaa-8aaa-aaaaaaaaaaaa');assert.equal(r.activity.status,'open');assert.equal(r.activity.guild_id,'456789');assert.equal(r.activity.rule_version,1);assert.deepEqual(r.current.activity,r.activity);assert.deepEqual(r.rows,[{viewer_id:'101',score:3},{viewer_id:'102',score:10},{viewer_id:'103',score:1}]);assert.equal(r.count.n,1);assert.deepEqual(await b.exit,[0,null]);
 } finally {for(const p of [a,b])if(p&&p.child.exitCode===null&&p.child.signalCode===null){p.child.kill('SIGKILL');await p.exit;}await rm(dir,{recursive:true,force:true});}
});
