import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const dir=mkdtempSync(path.join(tmpdir(),'xiangsheng-core-'));
try {
  execFileSync(process.execPath,['node_modules/typescript/lib/tsc.js',
    'src/ispec/dataset.ts','src/components/presentation/deckHistory.ts',
    '--target','ES2022','--module','commonjs','--rewriteRelativeImportExtensions','--outDir',dir,'--strict','--skipLibCheck'],{stdio:'inherit'});
  const {resolveChartDataset}=require(path.join(dir,'ispec/dataset.js'));
  const {evaluateSpec}=require(path.join(dir,'ispec/evaluate.js'));
  const {createHistory,commitHistory,undoHistory,redoHistory,changeDeckParameter}=require(path.join(dir,'components/presentation/deckHistory.js'));
  const source={page:1,element_id:'p01_s01',bbox:null,status:'original',excerpt:'y=a*x^2'};
  const p=(id,value)=>({id,label:id,default:value,type:'number',min:-10,max:10,source});
  const view={type:'vega',spec_ref:'line',x:'x',y:'y'};
  const spec={spec_version:'1.0',object_id:'formula',kind:'parametric',
    parameters:[p('a',2),{...p('x',1),options:[-2,-1,0,1,2]}],
    expressions:[{id:'y',expr:'a*x**2'}],views:[view]};
  const chart=(formula,values={},chartView=view)=>resolveChartDataset(formula,evaluateSpec(formula,values),chartView);
  const points=chart(spec);
  assert.equal(points.origin,'option_sweep');
  assert.deepEqual(points.rows,[{x:-2,y:8},{x:-1,y:2},{x:0,y:0},{x:1,y:2},{x:2,y:8}]);
  assert.equal(chart(spec,{a:3}).rows[0].y,12,'Changing another coefficient must update the curve');
  for(const expr of ['1/x','1/(1/x)']){
    const result=chart({...spec,expressions:[{id:'y',expr}]});
    assert.deepEqual(result.rows[2],{x:0},'An undefined value must leave a gap in the curve');
    assert.equal(result.missing,false,'Other samples in the curve remain available');
  }
  const missing=chart(spec,{},{...view,x:'unknown'});
  assert.equal(missing.missing,true);
  assert.deepEqual(missing.rows,[]);
  assert.equal(spec.parameters[1].default,1,'Evaluating a chart never mutates its defaults');

  const original={one:{a:1,b:2},two:{a:3}};
  let h=createHistory(original);
  h=commitHistory(h,{...original,one:{a:4,b:2}},'one.a',1000);
  h=commitHistory(h,{...original,one:{a:5,b:2}},'one.a',1100);
  assert.equal(h.past.length,1,'Continuous slider movement is one undo action');
  h=undoHistory(h); assert.deepEqual(h.present,original);
  h=redoHistory(h); assert.equal(h.present.one.a,5);
  h=undoHistory(h); h=commitHistory(h,{...original,one:{a:1,b:7}},'one.b',2000);
  assert.equal(h.future.length,0,'A new action discards the redo branch');
  assert.deepEqual(original.one,{a:1,b:2});
  const linked=[{...spec,object_id:'one',parameters:[{...p('a',1),shared_key:'verified'}]},
    {...spec,object_id:'two',parameters:[{...p('b',1),shared_key:'verified'}]},
    {...spec,object_id:'other',parameters:[{...p('a',1),source:{...source,excerpt:'different'}}]}];
  const next=changeDeckParameter(linked,{one:{a:1},two:{b:1},other:{a:1}},'one','a',4);
  assert.deepEqual(next,{one:{a:4},two:{b:4},other:{a:1}},'A declared shared parameter changes atomically');
  console.log('PASS: chart formula sampling, undefined gaps, immutable history and shared values');
} finally {
  assert.equal(path.dirname(dir),path.resolve(tmpdir()));
  assert.ok(path.basename(dir).startsWith('xiangsheng-core-'));
  rmSync(dir,{recursive:true,force:true});
}
