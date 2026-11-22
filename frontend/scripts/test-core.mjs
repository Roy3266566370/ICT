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
    'src/ispec/functionSeries.ts','src/components/presentation/deckHistory.ts','src/components/presentation/editorDraft.ts',
    '--target','ES2022','--module','commonjs','--rewriteRelativeImportExtensions','--outDir',dir,'--strict','--skipLibCheck'],{stdio:'inherit'});
  const {sampleFunction}=require(path.join(dir,'ispec/functionSeries.js'));
  const {createHistory,commitHistory,undoHistory,redoHistory,changeDeckParameter}=require(path.join(dir,'components/presentation/deckHistory.js'));
  const {inferMatrix,initialEditorMode,elementText}=require(path.join(dir,'components/presentation/editorDraft.js'));
  const source={page:1,element_id:'p01_s01',bbox:null,status:'original',excerpt:'y=a*x^2'};
  const p=(id,value)=>({id,label:id,default:value,type:'number',min:-10,max:10,source});
  const spec={spec_version:'1.0',object_id:'formula',kind:'parametric',parameters:[p('a',2),p('x',3)],
    expressions:[{id:'y',expr:'a*x**2'}],views:[{type:'text',template:'y={{y}}'}]};
  let points=sampleFunction(spec,{a:2,x:3},'x','y',-2,2,5);
  assert.deepEqual(points.map(p=>p?.y),[8,2,0,2,8]);
  assert.equal(sampleFunction(spec,{a:3,x:3},'x','y',-2,2,5)[0].y,12,'Changing another coefficient must update the curve');
  assert.equal(sampleFunction({...spec,expressions:[{id:'y',expr:'1/x'}]},{a:2,x:3},'x','y',-1,1,3)[1],null,'Undefined values must create gaps');
  assert.equal(sampleFunction({...spec,expressions:[{id:'y',expr:'1/(1/x)'}]},{a:2,x:3},'x','y',-1,1,3)[1],null,'An undefined intermediate cannot turn into a finite plotted value');
  assert.deepEqual(sampleFunction(spec,{},'x','y',2,-2),[],'Invalid ranges do not sample');
  assert.deepEqual(sampleFunction(spec,{},'missing','y',-1,1),[]);
  assert.equal(points.length,5);
  assert.equal(spec.parameters[1].default,3,'Sampling never mutates the original');

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
  const steps={...spec,kind:'step',parameters:[p('steps_rotate_angle_deg',90)],views:[{type:'figure',spec_ref:'step_diagram'}]};
  assert.equal(inferMatrix(steps),undefined,'A step figure must never become a zero matrix');
  assert.equal(initialEditorMode({kind:'picture'},steps),'keep','Text correction preserves the existing interaction');
  assert.equal(elementText({text:'',math_text:'y=x+1'}),'y=x+1','Native math is editable even with empty DrawingML text');
  console.log('PASS: formula sampling, undefined gaps, immutable history, shared values, and safe editor defaults');
} finally {
  assert.equal(path.dirname(dir),path.resolve(tmpdir()));
  assert.ok(path.basename(dir).startsWith('xiangsheng-core-'));
  rmSync(dir,{recursive:true,force:true});
}
