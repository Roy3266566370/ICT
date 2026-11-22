import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {createServer} from 'vite';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
test('fake offline labs render controls while thumbnail and old-lab paths stay static',async()=>{
 const server=await createServer({configFile:false,root:process.cwd(),resolve:{alias:{'@':path.resolve('src')}},esbuild:{jsx:'automatic'},server:{middlewareMode:true,hmr:false,watch:null},appType:'custom'});
 try {
 const {SlideDemoNode}=await server.ssrLoadModule('/src/components/editor/SlideDemoNode.tsx');
 const fakePageLab={version:'1',page_no:1,title:'离线演示',summary:'示例',params:[{id:'x',label:'公开参数',min:0,max:10,step:1,default:2,unit:''},{id:'secret',label:'内部参数',min:0,max:1,step:1,default:0,unit:''}],public_params:['x'],timeline:{duration_s:2,stops:[{t:0,label:'开始'},{t:1,label:'结束'}]},program:'function render(input){return {width:100,height:100,nodes:[]}}',content_hash:'fake',explain:[],generator:{model:'fake',attempts:1},created_at:''};
 const node={id:'demo-1',demo:fakePageLab,x:10,y:20,width:600,height:400,rotation:0,z:1,opacity:1,locked:false};
 const render=(n:unknown,interactive:boolean)=>renderToStaticMarkup(createElement(SlideDemoNode,{node:n,interactive,editing:true,onPatch(){},onGenerate(){}}));
 const thumb=render(node,false);
 assert.ok(thumb.includes('离线演示'));assert.ok(!thumb.includes('<iframe'));assert.ok(!thumb.includes('tabindex'));assert.ok(thumb.includes('pointer-events:auto'));
 const active=render(node,true);
 assert.ok(active.includes('data-no-pan'));
 assert.ok(active.includes('<iframe'));assert.ok(active.includes('演示进度'));assert.ok(active.includes('公开参数'));assert.ok(!active.includes('内部参数'));assert.ok(active.includes('重新生成演示'));
 assert.ok(!render({...node,demo:{...fakePageLab,timeline:undefined}},true).includes('演示进度'));
 assert.ok(render({...node,demo:null},true).includes('AI 根据本页生成演示'));
 }finally{await server.close();}
});
