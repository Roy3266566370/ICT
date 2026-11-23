import type {SceneDocument,SceneNode,ScenePage,SceneRelation,NodePatch,NodeChange} from './types';
import {defaultMathScene} from './mathScene.ts';
import {defaultDiagram} from './inlineSystems.ts';
export const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const figureKeys=['cleaned_asset_id','figure_scene'] as const;
export const mutableKeys=['x','y','width','height','rotation','z','opacity','locked','hidden','deleted','text','table','chart','crop','interaction','basis','flow','viewer_editable','viewer_parameters','math_scene','matrix_ocr','diagram','demo',...figureKeys] as const;
export function patchNodes(document:SceneDocument,pageNo:number,ids:string[],patch:NodePatch):SceneDocument {
  return {...document,pages:document.pages.map(page=>page.page_no!==pageNo?page:{...page,modified:true,nodes:page.nodes.map(node=>{
    if(!ids.includes(node.id))return node;
    return {...node,...patch,style:patch.style?{...node.style,...patch.style}:node.style};
  })})};
}
export function patchPageRelations(document:SceneDocument,pageNo:number,relations:SceneRelation[]):SceneDocument {
  return {...document,pages:document.pages.map(page=>page.page_no!==pageNo?page:{...page,modified:true,relations})};
}
/** 等距分布：保持首尾对象不动，把剩余空隙平均分给相邻对象。 */
export function distributeNodes(document:SceneDocument,pageNo:number,ids:string[],axis:'h'|'v'):SceneDocument {
  const page=document.pages.find(p=>p.page_no===pageNo);if(!page)return document;
  const nodes=page.nodes.filter(node=>ids.includes(node.id)&&!node.deleted&&!node.hidden);if(nodes.length<3)return document;
  const size=(node:SceneNode)=>axis==='h'?node.width:node.height;
  const start=(node:SceneNode)=>axis==='h'?node.x:node.y;
  const sorted=[...nodes].sort((a,b)=>start(a)-start(b));
  const first=start(sorted[0]!),last=Math.max(...sorted.map(node=>start(node)+size(node)));
  const gap=(last-first-sorted.reduce((sum,node)=>sum+size(node),0))/(sorted.length-1);
  let next=document;let cursor=first;
  for(const node of sorted){const value=Math.round(cursor*100)/100;next=patchNodes(next,pageNo,[node.id],axis==='h'?{x:value}:{y:value});cursor+=size(node)+gap;}
  return next;
}
export function createPayload(node:SceneNode):Record<string,unknown> {
  if(node.duplicate_from) {
    const payload:Record<string,unknown>={duplicate_from:node.duplicate_from,style:node.style};
    for(const key of mutableKeys)if(node[key]!==undefined)payload[key]=node[key];
    return payload;
  }
  const payload:Record<string,unknown>={type:node.type,style:node.style,shape:node.shape};
  for(const key of [...mutableKeys,'image_data'] as const)if(node[key]!==undefined)payload[key]=node[key];
  if(node.figure_source_id){
    payload.name=node.name;
    payload.figure_source_id=node.figure_source_id;
    payload.figure_object_id=node.figure_object_id;
    payload.figure_provenance=node.figure_provenance;
  }
  return payload;
}
export function diffDocuments(base:SceneDocument,current:SceneDocument):NodeChange[] {
  const changes:NodeChange[]=[];
  for(const page of current.pages) {
    const before=base.pages.find(p=>p.page_no===page.page_no);
    const original=new Map(before?.nodes.map(n=>[n.id,n]));
    for(const node of page.nodes) {
      const old=original.get(node.id);
      if(!old) {if(!node.deleted)changes.push({page_no:page.page_no,id:node.id,create:createPayload(node)});continue;}
      const patch:NodePatch={};
      for(const key of mutableKeys)if(node[key]!==undefined&&!same(node[key],old[key])) Object.assign(patch,{[key]:node[key]});
      for(const key of figureKeys){
        if(node[key]==null&&old[key]==null)delete patch[key];
        else if(node[key]===undefined&&old[key]!=null)Object.assign(patch,{[key]:null});
      }
      const style:Record<string,unknown>={};
      for(const key of Object.keys(node.style) as Array<keyof SceneNode['style']>)if(!same(node.style[key],old.style[key]))style[key]=node.style[key];
      if(Object.keys(style).length)patch.style=style;
      if(Object.keys(patch).length)changes.push({page_no:page.page_no,id:node.id,patch});
    }
    for(const node of before?.nodes??[])if(!node.deleted&&!page.nodes.some(n=>n.id===node.id))changes.push({page_no:page.page_no,id:node.id,patch:{deleted:true}});
    if(!same(page.relations??[],before?.relations??[])) {
      changes.push({page_no:page.page_no,id:'__page__',relations:page.relations??[]});
    }
  }
  return changes;
}
export function applyChanges(document:SceneDocument,changes:NodeChange[],source?:SceneDocument):SceneDocument {
  let next=document;
  for(const change of changes) {
    if(change.relations!==undefined) {
      next=patchPageRelations(next,change.page_no,change.relations);
    }
    else if(change.patch){
      let patch:NodePatch&{cleaned_url?:SceneNode['cleaned_url']}=change.patch;
      if('cleaned_asset_id' in patch){
        const local=source?.pages.find(p=>p.page_no===change.page_no)?.nodes.find(n=>n.id===change.id);
        patch={...patch,cleaned_url:local?.cleaned_url};
      }
      next=patchNodes(next,change.page_no,[change.id],patch);
    }
    else if(change.create) {
      const node=source?.pages.find(p=>p.page_no===change.page_no)?.nodes.find(n=>n.id===change.id);
      if(node)next={...next,pages:next.pages.map(p=>p.page_no===change.page_no?{...p,modified:true,nodes:p.nodes.some(n=>n.id===node.id)?p.nodes.map(n=>n.id===node.id?{...n,...node}:n):[...p.nodes,node]}:p)};
    }
  }
  return next;
}
export function rebaseDocument(base:SceneDocument,draft:SceneDocument,server:SceneDocument):{document:SceneDocument;conflicts:string[]} {
  const changes=diffDocuments(base,draft);const conflicts:string[]=[];
  for(const change of changes) {
    if(change.relations!==undefined) {
      const beforeRels=base.pages.find(p=>p.page_no===change.page_no)?.relations??[];
      const remoteRels=server.pages.find(p=>p.page_no===change.page_no)?.relations??[];
      if(!same(beforeRels,remoteRels)&&!same(remoteRels,change.relations)) {
        conflicts.push(`${change.page_no}/__page__/relations`);
      }
      continue;
    }
    const before=base.pages.find(p=>p.page_no===change.page_no)?.nodes.find(n=>n.id===change.id);
    const remote=server.pages.find(p=>p.page_no===change.page_no)?.nodes.find(n=>n.id===change.id);
    if(change.create) {
      const local=draft.pages.find(p=>p.page_no===change.page_no)?.nodes.find(n=>n.id===change.id);
      if(remote&&local&&(mutableKeys.some(k=>!same(local[k],remote[k]))||!same(local.style,remote.style)))conflicts.push(`${change.page_no}/${change.id}/新增`);
      continue;
    }
    if(!before||!remote){conflicts.push(`${change.page_no}/${change.id}/对象`);continue;}
    for(const key of Object.keys(change.patch??{}) as Array<keyof NodePatch>) {
      if(key==='style') {
        for(const field of Object.keys(change.patch?.style??{}) as Array<keyof SceneNode['style']>)
          if(!same(before.style[field],remote.style[field])&&!same(remote.style[field],change.patch?.style?.[field]))conflicts.push(`${change.page_no}/${change.id}/样式.${field}`);
      } else if(!same(before[key],remote[key])&&!same(remote[key],change.patch?.[key]))conflicts.push(`${change.page_no}/${change.id}/${key}`);
    }
  }
  return {document:applyChanges(server,changes,draft),conflicts};
}
export function newNode(page:ScenePage,id:string,type:SceneNode['type']='text'):SceneNode {
  // 参考样式取本页字号最大的可见文字（通常就是标题），新建文字才不会继承到页脚小字；
  // 位置放在页面中央——左上角往往压着标题，用户第一眼会以为写错了地方。
  const reference=[...page.nodes].filter(n=>n.type==='text'&&!n.deleted&&!n.hidden&&n.text.trim())
    .sort((a,b)=>(b.style.font_size??0)-(a.style.font_size??0))[0];
  const width=type==='diagram'?640:type==='demo'?620:type==='math_scene'?480:type==='text'?320:200,height=type==='diagram'?280:type==='demo'?360:type==='math_scene'?360:type==='text'?70:type==='vector'?16:140;
  return {id,type,name:type==='text'?'新文字':type==='image'?'新图片':type==='vector'?'线条':'新图形',
    x:Math.round((page.width-width)/2),y:Math.round((page.height-height)/2),
    width,height,...(type==='math_scene'?{math_scene:defaultMathScene(),viewer_editable:true,name:'矩阵变换图'}:{}),
    ...(type==='diagram'?{diagram:defaultDiagram(),viewer_editable:true,name:'原位流程图',flow:{enabled:true,speed:1}}:{}),
    ...(type==='demo'?{demo:null,viewer_editable:true,name:'AI 演示框'}:{}),
    ...(type==='vector'?{flow:{enabled:false,speed:1},viewer_editable:true}:{}),
    rotation:0,z:Math.max(0,...page.nodes.map(n=>n.z))+1,opacity:1,locked:false,hidden:false,deleted:false,
    text:type==='text'?'新文字':'',base_text:null,style:{font_size:28,font_family:reference?.style.font_family??'Arial',color:reference?.style.color??'#18233D',line_height:1.15,align:'left',vertical_align:'top',
      ...(type==='vector'?{stroke:'#167abc',stroke_width:3}:{}),
      ...(type==='shape'?{fill:'#E9E4FF',stroke:'#7966CE',stroke_width:1}: {})},base_style:{} as SceneNode['style'],shape:'rect',source_element_id:null};
}
