// Test-only instrumentation around the actual Worker. Never deployed.
import worker from '../src/index.ts';
export default {async fetch(req,env){
 const totals={rows_read:0,rows_written:0,statements:0,missing:0};
 const collect=r=>{const m=r?.meta;totals.statements++;if(typeof m?.rows_read!=='number'||typeof m?.rows_written!=='number')totals.missing++;else {totals.rows_read+=m.rows_read;totals.rows_written+=m.rows_written;}return r;};
 const originals=new WeakMap();
 const wrap=s=>{const p={bind(...args){return wrap(s.bind(...args));},async all(...args){return collect(await s.all(...args));},async run(...args){return collect(await s.run(...args));},async first(column){const r=collect(await s.all());const row=r.results[0]??null;return column===undefined?row:row?.[column]??null;},async raw(...args){const r=collect(await s.all());return args[0]?.columnNames?[Object.keys(r.results[0]??{}),...r.results.map(Object.values)]:r.results.map(Object.values);}};originals.set(p,s);return p;};
 const db={prepare(sql){return wrap(env.DB.prepare(sql));},async batch(stmts){return (await env.DB.batch(stmts.map(s=>originals.get(s)))).map(collect);},exec:env.DB.exec.bind(env.DB)};
 const response=await worker.fetch(req,{...env,DB:db});const headers=new Headers(response.headers);headers.set('x-capacity-metrics',JSON.stringify(totals));return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}};
