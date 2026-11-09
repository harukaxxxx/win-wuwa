import {test} from 'node:test';
import assert from 'node:assert/strict';
import {snapshot,uniform,select} from '../src/draw-formula.ts';
test('rule 1 worked example, total and safe ordinal bound',()=>{
 const rows=snapshot([{viewer_id:'a',ordinal:1,score:0},{viewer_id:'b',ordinal:51,score:10}]);
 assert.equal(rows[0].weight,1.2);assert.equal(rows[1].weight,5.5);
 assert.ok(Math.abs(rows[0].probability-0.33955223880597013)<1e-15);
 assert.ok(Math.abs(rows[0].probability+rows[1].probability-1)<1e-15);
 const extreme=snapshot([{viewer_id:'x',ordinal:Number.MAX_SAFE_INTEGER,score:10}]);assert.equal(extreme[0].probability,1);
 assert.throws(()=>snapshot([{viewer_id:'x',ordinal:Number.MAX_SAFE_INTEGER+1,score:0}]));
});
test('uniform integer rejects out of range rather than reducing modulo',()=>{
 const sequence=[255,3,2];let calls=0;
 assert.equal(uniform(3n,a=>{a[0]=sequence[calls++];}),2n);assert.equal(calls,3);
});
test('controlled entropy reaches both mixture branches and rational rejection',()=>{
 const rows=[{viewer_id:'a',ordinal:1,score:0},{viewer_id:'b',ordinal:51,score:10}];
 const values=[0,1];assert.equal(select(rows,a=>{a.fill(0);a[a.length-1]=values.shift();}).viewer_id,'b');
 const v=[1,0,1000,1,0];assert.equal(select(rows,a=>{const n=v.shift();a.fill(0);if(a.length>1)a[a.length-2]=n>>>8;a[a.length-1]=n&255;}).viewer_id,'b');
});
