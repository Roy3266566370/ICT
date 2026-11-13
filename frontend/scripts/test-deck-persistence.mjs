import assert from 'node:assert/strict';
import vm from 'node:vm';
import {build} from 'esbuild';

// Exercise the actual persistence hook with deterministic hook slots and an unavailable API.
// This checks decisions/state transitions, not React's scheduler (covered in browser acceptance).
const slots=[];let cursor=0,effects=[];
const sameDeps=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((item,index)=>item===b[index]);
// `useDeckValues` 通过 `useAccountScope()` 读取账号 scope，zustand 会经
// use-sync-external-store 的 with-selector shim 调用下列 React API；沙箱需提供同形状的最小实现。
const react={
  useState(initial){const i=cursor++;if(!(i in slots)) slots[i]=initial;return [slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v;}];},
  useRef(initial){const i=cursor++;if(!(i in slots)) slots[i]={current:initial};return slots[i];},
  useCallback(fn){cursor++;return fn;},
  useMemo(factory,deps){const i=cursor++,old=slots[i];if(!old||!sameDeps(old.deps,deps)) slots[i]={value:factory(),deps};return slots[i].value;},
  useEffect(fn,deps){const i=cursor++,old=slots[i];if(!old||!sameDeps(old,deps)) effects.push(fn);slots[i]=deps;},
  useLayoutEffect(fn,deps){const i=cursor++,old=slots[i];if(!old||!sameDeps(old,deps)) effects.push(fn);slots[i]=deps;},
  // 固定的外部快照：store 未变化时直接返回快照，shim 内部会缓存 selector 结果。
  useSyncExternalStore(_subscribe,getSnapshot){return getSnapshot();},
  useDebugValue(){},
  startTransition(callback){callback();},
};
const compiled=await build({entryPoints:['src/components/presentation/useDeckValues.ts'],bundle:true,write:false,format:'cjs',platform:'node',
  plugins:[{name:'hook-test',setup(b){
    b.onResolve({filter:/^(react|@\/api\/client)$/},a=>({path:a.path,namespace:'mock'}));
    b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='react'?'module.exports=globalThis.__react':'module.exports=globalThis.__api'}));
  }}]});
let offline=true,puts=0;
// 键含账号 scope（C-DRAFT-SCOPE@1）：未登录时 scope 为 guest。
const storage=new Map([['xiangsheng.deck.v1.guest.persistence-test',JSON.stringify({values:{one:{x:5}},dirty:[],versions:{one:'v1'}})]]);
const mockApi={api:{getISpecValues:async()=>{if(offline) throw new Error('network unavailable');return {values:{x:6},updated_at:'v2'};},
  putISpecValues:async(_material,_object,values)=>{puts++;return {values,updated_at:'v3'};}},
  errorMessage:e=>e.message,isApiError:()=>false};
const context={module:{exports:{}},exports:{},Date,Set,Promise,console,
  // use-sync-external-store 的 dev 版在模块求值时读取 NODE_ENV。
  process:{env:{NODE_ENV:'development'}},
  localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)},__react:react,__api:mockApi};
vm.createContext(context);vm.runInContext(compiled.outputFiles[0].text,context);
const spec={object_id:'one',spec_version:'1.0',kind:'parametric',parameters:[{id:'x',default:3,label:'x'}],views:[]};
function render(){cursor=0;effects=[];const state=context.module.exports.useDeckValues([spec],'persistence-test','material');for(const effect of effects) effect();return state;}
render();await new Promise(r=>setImmediate(r));let state=render();
assert.equal(state.values.one.x,5);
assert.equal(state.loadFailed,true);
assert.equal(await state.save(),false,'Export/save must fail when server values have not been loaded, even with no dirty draft');
assert.equal(puts,0);
offline=false;await state.loadSaved();state=render();
assert.equal(state.loadFailed,false);
assert.equal(state.values.one.x,6);
assert.equal(await state.save(),true);
state.change(spec,'x',7);state=render();assert.equal(state.values.one.x,7);
assert.equal(await state.save(),true);assert.equal(puts,1);
state.undo();state=render();assert.equal(state.values.one.x,6,'Undo must restore loaded server inputs');
console.log('PASS: failed load blocks export, explicit recovery loads current inputs, save and undo retain one state');