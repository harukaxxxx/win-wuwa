// Deterministic research fixture only: production always uses Web Crypto.
import {select} from '../src/draw-formula.ts';
let state=0x14ac2026;
function bytes(a){for(let i=0;i<a.length;i++){state^=state<<13;state^=state>>>17;state^=state<<5;a[i]=state>>>24;}}
const counts=Array(12).fill(0), sessions=10000, drawsPerSession=3;
for(let s=0;s<sessions;s++){
 const pool=Array.from({length:12},(_,i)=>({viewer_id:String(i),ordinal:i+1,score:i%11}));
 for(let d=0;d<drawsPerSession;d++){const chosen=select(pool,bytes);counts[Number(chosen.viewer_id)]++;pool.splice(pool.indexOf(chosen),1);}
}
console.log(JSON.stringify({seed:'0x14ac2026',sessions,draws_per_session:drawsPerSession,initial_scores:Array.from({length:12},(_,i)=>i%11),winner_counts:counts,scope:'independent synthetic sessions; no settlement or persistent scores'},null,2));
