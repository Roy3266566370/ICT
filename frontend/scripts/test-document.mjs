import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
const compiled=await build({entryPoints:['src/document/controller.ts'],bundle:true,write:false,format:'cjs',platform:'node'});
const context={module:{exports:{}},exports:{},Date,Set,Map,Promise,JSON,Math,setTimeout,clearTimeout};
vm.createContext(context);vm.runInContext(compiled.outputFiles[0].text,context);
const {DocumentController,diffDocuments,rebaseDocument}=context.module.exports;
const node=(id,x)=>({id,type:'text',name:id,x,y:20,width:100,height:40,rotation:0,z:0,opacity:1,
  text:'Original',base_text:'Original',style:{font_size:24,color:'#000000'},base_style:{font_size:24,color:'#000000'},locked:false,hidden:false,deleted:false});
const original={schema_version:'1.0',revision:0,title:'Free edit',source_key:'test',pages:[{page_no:1,width:720,height:405,nodes:[node('one',10),node('two',80)]}]};
let calls=[];let release;let pending=true;
const editor=new DocumentController(original,{save:async(revision,operation,changes)=>{
  calls.push({revision,operation,changes});if(pending) await new Promise(r=>{release=r;});return {revision:revision+1};
},autosaveDelay:100000});
editor.patch(1,['one'],{text:'Instant',style:{color:'#ff0000'}},'typing.one');
assert.equal(editor.getSnapshot().document.pages[0].nodes[0].text,'Instant','Edits render before saving');
assert.equal(editor.getSnapshot().document.pages[0].nodes[1].text,'Original');
assert.equal(original.pages[0].nodes[0].text,'Original');
const saving=editor.save();await new Promise(r=>setImmediate(r));
editor.patch(1,['one'],{x:120});
pending=false;release();assert.equal(await saving,true);
assert.equal(calls.length,2,'Edits made during a save must be sent after its acknowledgement');
assert.equal(calls[1].revision,1);
assert.equal(editor.getSnapshot().document.pages[0].nodes[0].x,120);
assert.equal(editor.getSnapshot().dirty,false);
editor.undo();assert.equal(editor.getSnapshot().document.pages[0].nodes[0].x,10);
assert.equal(editor.getSnapshot().document.pages[0].nodes[0].text,'Instant');
editor.redo();assert.equal(editor.getSnapshot().document.pages[0].nodes[0].x,120);
const before=editor.getSnapshot().document;
editor.patch(1,['one','two'],{y:50});editor.undo();
assert.equal(editor.getSnapshot().document.pages[0].nodes[1].y,20,'Multi-object changes undo atomically');
const remote=JSON.parse(JSON.stringify(original));remote.revision=2;remote.pages[0].nodes[1].x=90;
const rebased=rebaseDocument(original,before,remote);
assert.equal(rebased.conflicts.length,0);
assert.equal(rebased.document.pages[0].nodes[1].x,90,'Unrelated remote changes must survive rebase');
assert.equal(rebased.document.pages[0].nodes[0].x,120);
remote.pages[0].nodes[0].x=70;
assert.ok(rebaseDocument(original,before,remote).conflicts.length>0,'Same-field remote edits must conflict');
editor.dispose();
const failing=new DocumentController(original,{save:async()=>{throw new Error('offline');},autosaveDelay:100000});
failing.patch(1,['one'],{text:'Preserved draft'});assert.equal(await failing.save(),false);
assert.equal(failing.getSnapshot().document.pages[0].nodes[0].text,'Preserved draft');
assert.equal(failing.getSnapshot().dirty,true);
assert.ok(diffDocuments(original,failing.getSnapshot().document).length);
failing.dispose();
const mergedEditor=new DocumentController(original,{save:async()=>({revision:3}),autosaveDelay:100000});
mergedEditor.patch(1,['one'],{x:20});
const unrelated=structuredClone(original);unrelated.revision=1;unrelated.pages[0].nodes[1].x=90;
assert.equal(mergedEditor.mergeServer(unrelated),true);mergedEditor.undo();
assert.equal(mergedEditor.getSnapshot().document.pages[0].nodes[1].x,90,'Undo must never replay stale remote fields after merging');
mergedEditor.dispose();
const created=structuredClone(original);created.pages[0].nodes.push({...node('u_added',50),text:'LATEST',opacity:.25,hidden:true,locked:true,crop:{left:.1,right:0,top:0,bottom:0}});
const createChange=diffDocuments(original,created).at(-1).create;
assert.equal(createChange.opacity,.25);assert.equal(createChange.hidden,true);assert.equal(createChange.locked,true);assert.equal(createChange.crop.left,.1);
const acknowledged=structuredClone(created);acknowledged.revision=1;acknowledged.pages[0].nodes.at(-1).text='EARLIER';
let persisted;
const recovery=new DocumentController(acknowledged,{save:async()=>({revision:2}),persist:(_,doc)=>{persisted=doc;},autosaveDelay:100000});
recovery.recoverDraft(original,created);
await new Promise(resolve=>setTimeout(resolve,260));
assert.equal(recovery.getSnapshot().document.pages[0].nodes.at(-1).text,'LATEST','Lost acknowledgement recovery must retain newer local content');
assert.equal(recovery.getSnapshot().dirty,true);assert.equal(recovery.getSnapshot().conflict,true);assert.equal(persisted.pages[0].nodes.at(-1).text,'LATEST');recovery.dispose();
const draftBundle=await build({entryPoints:['src/document/drafts.ts'],bundle:true,write:false,format:'cjs',platform:'node'});
const storage=new Map();const draftContext={module:{exports:{}},exports:{},Date,Set,Map,Promise,JSON,Math,
  localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)}};
vm.createContext(draftContext);vm.runInContext(draftBundle.outputFiles[0].text,draftContext);
const {writeDraft,readDraft}=draftContext.module.exports;
// 指纹随文档版本变化（C-DRAFT-SCOPE@1）；本脚本模拟同一浏览器内的访客会话。
const draftFingerprint=document=>({sourceKey:document.source_key??'',revision:document.revision});
await writeDraft('deck','guest',draftFingerprint(created),original,created,'tab-b');
await writeDraft('deck','guest',draftFingerprint(original),original,original,'tab-a');
assert.equal((await readDraft('deck','guest',draftFingerprint(created),'tab-b')).document.pages[0].nodes.at(-1).text,'LATEST','Saving another editor must not erase this draft');
await Promise.all([
  writeDraft('deck','guest',draftFingerprint(created),original,created,'tab-a'),
  writeDraft('deck','guest',draftFingerprint(created),created,created,'tab-a'),
]);
assert.equal(await readDraft('deck','guest',draftFingerprint(created),'tab-a'),null,'Late persistence must not restore a synchronized draft');
console.log('PASS: instant immutable edits, atomic history, serialized saves, edits during save, offline drafts and field conflict detection');
