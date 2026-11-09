// Rule 1 is fixed for the lifetime of an activity. Selection uses exact rational
// rejection sampling; floating point values below are for historical display only.
export interface Candidate { viewer_id:string; ordinal:number; score:number }
export interface Snapshot extends Candidate { weight:number; probability:number }
export function snapshot(rows:Candidate[]):Snapshot[] {
 for(const r of rows) if(!Number.isSafeInteger(r.ordinal)||r.ordinal<1||!Number.isInteger(r.score)||r.score<0||r.score>10) throw Error('invalid candidate');
 const weights=rows.map(r=>(1+0.4*r.score)*(1+10/(r.ordinal+49)));
 const total=weights.reduce((a,b)=>a+b,0);
 return rows.map((r,i)=>({...r,weight:weights[i],probability:0.5/rows.length+0.5*weights[i]/total}));
}
// Uniform integer below n, without modulo bias. n is BigInt to cover all valid ordinals.
export function uniform(n:bigint, bytes:(a:Uint8Array<ArrayBuffer>)=>void = a=>{crypto.getRandomValues(a);}):bigint {
 if(n<=0n) throw Error('invalid bound');
 const bits=(n-1n).toString(2).length, count=Math.ceil(bits/8), mask=(1n<<BigInt(bits))-1n;
 for(;;) {const a=new Uint8Array(count);bytes(a);let x=0n;for(const b of a)x=(x<<8n)|BigInt(b);x &= mask;if(x<n)return x;}
}
export function select(rows:Candidate[], bytes?:(a:Uint8Array)=>void):Candidate {
 if(!rows.length)throw Error('empty');
 const random=(n:bigint)=>uniform(n,bytes);
 if(random(2n)===0n)return rows[Number(random(BigInt(rows.length)))];
 // Uniform proposal, accept with probability w/6; 1 <= w <= 6.
 for(;;) {const r=rows[Number(random(BigInt(rows.length)))];const d=BigInt(r.ordinal)+49n;
  if(random(30n*d)<BigInt(5+2*r.score)*(d+10n))return r;
 }
}
