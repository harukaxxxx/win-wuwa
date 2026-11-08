import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

const runner=new URL('./d1-crash-child.mjs',import.meta.url);
function start(mode,dir) {
 const child=fork(runner,[mode,dir],{stdio:['ignore','ignore','ignore','ipc']});
 const exit=once(child,'exit');
 const message=Promise.race([
  once(child,'message').then(([m])=>m),
  exit.then(()=>{throw new Error(`${mode} exited before acknowledgement`);}),
  new Promise((_,reject)=>{const t=setTimeout(()=>reject(new Error(`${mode} timed out`)),30000); t.unref();})
 ]);
 return {child,exit,message};
}
test('acknowledged commit survives SIGKILL and stale retry is rejected', {timeout:90000}, async()=>{
 const root=process.env.TMPDIR || join(homedir(),'.hermes/profiles/makino-futsuki/cache/scratch');
 const dir=await mkdtemp(join(root,'wuwa-crash-')); let first,second;
 try {
  first=start('commit',dir);
  assert.deepEqual(await first.message,{event:'committed'});
  assert.equal(first.child.kill('SIGKILL'),true);
  const [code,signal]=await first.exit; assert.equal(code,null); assert.equal(signal,'SIGKILL');
  second=start('restore',dir);
  assert.deepEqual(await second.message,{event:'restored',firstStatus:200,original:{value:'committed',version:1},retryStatus:409,lastStatus:200,after:{value:'committed',version:1}});
  assert.deepEqual(await second.exit,[0,null]);
 } finally {
  for(const p of [first,second]) if(p && p.child.exitCode===null && p.child.signalCode===null) {p.child.kill('SIGKILL'); await p.exit;}
  await rm(dir,{recursive:true,force:true});
 }
});
