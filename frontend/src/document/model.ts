import type {SceneDocument,SceneNode,ScenePage,SceneRelation,NodePatch,NodeChange,PageAction,PageMetadata,TextStyle} from './types';
import {defaultDiagram} from './inlineSystems.ts';
import {currentParagraphs,inheritRunStyle,preserveTextRuns} from './richText.ts';
export const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const figureKeys=['cleaned_asset_id','figure_scene'] as const;
export const mutableKeys=['x','y','width','height','rotation','z','opacity','locked','hidden','deleted','text','paragraphs','table','chart','crop','interaction','basis','flow','viewer_editable','viewer_parameters','diagram','demo','workshop_plugin',...figureKeys] as const;
export function patchNodes(document:SceneDocument,pageNo:number,ids:string[],patch:NodePatch):SceneDocument {
  return {...document,pages:document.pages.map(page=>page.page_no!==pageNo?page:{...page,modified:true,nodes:page.nodes.map(node=>{
    if(!ids.includes(node.id))return node;
    let rich=patch.paragraphs;
    const updatingText=patch.text!==undefined&&patch.text!==node.text;
    if(!rich&&node.paragraphs?.length&&(updatingText||patch.style)){
      const paragraphs=currentParagraphs(node);
      rich=updatingText?preserveTextRuns({...node,paragraphs},patch.text!):paragraphs;
      if(patch.style)rich=inheritRunStyle(rich,Object.keys(patch.style) as Array<keyof TextStyle>);
      if(same(rich,node.paragraphs))rich=undefined;
    }
    const base=rich&&node.base_paragraphs===undefined?node.paragraphs??[]:node.base_paragraphs;
    return {...node,...patch,...(rich?{paragraphs:rich,base_paragraphs:base}:{}),style:patch.style?{...node.style,...patch.style}:node.style};
  })})};
}
export function patchPageRelations(document:SceneDocument,pageNo:number,relations:SceneRelation[]):SceneDocument {
  return {...document,pages:document.pages.map(page=>page.page_no!==pageNo?page:{...page,modified:true,relations})};
}
export function patchPageMetadata(document:SceneDocument,pageNo:number,patch:PageMetadata&{background_modified?:boolean}):SceneDocument {
  return {...document,pages:document.pages.map(page=>page.page_no!==pageNo?page:{...page,...patch,
    ...('background_color' in patch?{background_modified:patch.background_modified??patch.background_color!==null}:{}),modified:true})};
}
const pageOrder=(document:SceneDocument)=>document.pages.map(page=>page.page_no);
const pageChange=(pageNo:number,action:PageAction):NodeChange=>({page_no:pageNo,id:'__page__',page_action:action});
const archived=(doc:SceneDocument,pageNo:number)=>doc.archived_pages?.find(page=>page.page_no===pageNo);
const findPage=(doc:SceneDocument,pageNo:number)=>doc.pages.find(page=>page.page_no===pageNo)??archived(doc,pageNo);
export function removePage(document:SceneDocument,pageNo:number):SceneDocument {
  const page=document.pages.find(item=>item.page_no===pageNo);
  if(!page||document.pages.length===1)return document;
  return {...document,structure_modified:true,pages:document.pages.filter(item=>item.page_no!==pageNo),archived_pages:[...(document.archived_pages??[]),page]};
}
function arrangePages(document:SceneDocument,order:number[]):SceneDocument {
  const indices=new Map(order.map((pageNo,i)=>[pageNo,i]));
  return {...document,structure_modified:true,pages:[...document.pages].sort((a,b)=>(indices.get(a.page_no)??order.length)-(indices.get(b.page_no)??order.length))};
}
export function copyPage(page:ScenePage,pageNo:number):ScenePage {
  return {...page,id:`p_${pageNo}`,page_no:pageNo,source_page_no:page.source_page_no===undefined?page.page_no:page.source_page_no,
    copy_from_page_no:page.page_no,modified:true};
}
function pageMetadata(page:ScenePage|undefined){
  return {notes:page?.notes??'',background_color:page?.background_color??null,background_modified:!!page?.background_modified};
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
  const payload:Record<string,unknown>={type:node.type,name:node.name,style:node.style,shape:node.shape};
  for(const key of [...mutableKeys,'image_data'] as const)if(node[key]!==undefined)payload[key]=node[key];
  if(node.figure_source_id){
    payload.figure_source_id=node.figure_source_id;
    payload.figure_object_id=node.figure_object_id;
    payload.figure_provenance=node.figure_provenance;
  }
  return payload;
}
export function diffDocuments(base:SceneDocument,current:SceneDocument):NodeChange[] {
  const changes:NodeChange[]=[];
  const structural:NodeChange[]=[];
  const previousPages=new Map(base.pages.map(page=>[page.page_no,page]));
  const currentPages=new Set(pageOrder(current));
  const removed=base.pages.filter(page=>!currentPages.has(page.page_no));
  for(const page of current.pages) {
    let before=previousPages.get(page.page_no);
    if(!before){
      before=archived(base,page.page_no);
      if(before)structural.push(pageChange(page.page_no,{kind:'restore_page'}));
      else {
        let from=page.copy_from_page_no;
        const visited=new Set<number>();
        while(from!==undefined&&!findPage(base,from)&&!visited.has(from)){
          visited.add(from);
          from=findPage(current,from)?.copy_from_page_no;
        }
        if(from!==undefined)before=findPage(base,from);
        if(before)structural.push(pageChange(page.page_no,{kind:'duplicate_page',from:before.page_no}));
        else structural.push(pageChange(page.page_no,{kind:'add_page',width:page.width,height:page.height}));
      }
    }
    const metadata=pageMetadata(page),oldMetadata=pageMetadata(before);
    const patch:ReturnType<typeof pageMetadata>|Partial<ReturnType<typeof pageMetadata>>={};
    if(metadata.notes!==oldMetadata.notes)patch.notes=metadata.notes;
    if(metadata.background_color!==oldMetadata.background_color||metadata.background_modified!==oldMetadata.background_modified){
      patch.background_color=metadata.background_color;patch.background_modified=metadata.background_modified;
    }
    if(Object.keys(patch).length)changes.push(pageChange(page.page_no,{kind:'page_metadata',patch}));
    const original=new Map(before?.nodes.map(n=>[n.id,n]));
    const currentIds=new Set(page.nodes.map(node=>node.id));
    for(const node of page.nodes) {
      const old=original.get(node.id);
      if(!old) {if(!node.deleted)changes.push({page_no:page.page_no,id:node.id,create:createPayload(node)});continue;}
      const patch:NodePatch={};
      for(const key of mutableKeys)if(key!=='paragraphs'&&node[key]!==undefined&&!same(node[key],old[key])) Object.assign(patch,{[key]:node[key]});
      if(!same(node.paragraphs??[],old.paragraphs??[]))patch.paragraphs=node.paragraphs??[];
      for(const key of figureKeys){
        if(node[key]==null&&old[key]==null)delete patch[key];
        else if(node[key]===undefined&&old[key]!=null)Object.assign(patch,{[key]:null});
      }
      const style:Record<string,unknown>={};
      for(const key of Object.keys(node.style) as Array<keyof SceneNode['style']>)if(!same(node.style[key],old.style[key]))style[key]=node.style[key];
      if(Object.keys(style).length)patch.style=style;
      if(Object.keys(patch).length)changes.push({page_no:page.page_no,id:node.id,patch});
    }
    for(const node of before?.nodes??[])if(!node.deleted&&!currentIds.has(node.id))changes.push({page_no:page.page_no,id:node.id,patch:{deleted:true}});
    if(!same(page.relations??[],before?.relations??[])) {
      changes.push({page_no:page.page_no,id:'__page__',relations:page.relations??[]});
    }
  }
  for(const page of removed){
    const cached=archived(current,page.page_no);
    if(cached)changes.push(...diffDocuments({...base,pages:[page]},{...current,pages:[cached]}));
    changes.push(pageChange(page.page_no,{kind:'delete_page'}));
  }
  if(!same(pageOrder(base),pageOrder(current)))changes.push(pageChange(0,{kind:'reorder_pages',order:pageOrder(current)}));
  return [...structural,...changes];
}
export function applyChanges(document:SceneDocument,changes:NodeChange[],source?:SceneDocument):SceneDocument {
  let next=document;
  for(const change of changes) {
    const action=change.page_action;
    if(action){
      if(action.kind==='delete_page')next=removePage(next,change.page_no);
      else if(action.kind==='reorder_pages')next=arrangePages(next,action.order);
      else if(action.kind==='page_metadata')next=patchPageMetadata(next,change.page_no,action.patch);
      else {
        const page=source&&findPage(source,change.page_no);
        if(page&&!next.pages.some(p=>p.page_no===page.page_no)){
          next={...next,structure_modified:true,pages:[...next.pages,page],archived_pages:next.archived_pages?.filter(p=>p.page_no!==page.page_no)};
        }
      }
    }
    else if(change.relations!==undefined) {
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
  const conflicts:string[]=[];
  const renumber=new Map<number,number>();
  let newPageNo=Math.max(0,...[...server.pages,...(server.archived_pages??[]),...draft.pages,...(draft.archived_pages??[])].map(page=>page.page_no))+1;
  for(const page of draft.pages){
    if(findPage(base,page.page_no))continue;
    const remote=findPage(server,page.page_no);
    if(remote&&(page.source_page_no!==remote.source_page_no||diffDocuments({...base,pages:[remote]},{...draft,pages:[page]}).length)){
      conflicts.push(`${page.page_no}/新增页面`);
      renumber.set(page.page_no,newPageNo++);
    }
  }
  if(renumber.size)draft={...draft,pages:draft.pages.map(page=>{
    const pageNo=renumber.get(page.page_no);
    const from=page.copy_from_page_no===undefined?undefined:renumber.get(page.copy_from_page_no);
    return {...page,...(pageNo?{page_no:pageNo,id:`p_${pageNo}`}:{}) ,...(from?{copy_from_page_no:from}:{})};
  })};
  const changes=diffDocuments(base,draft);
  const restoring=new Set(changes.filter(change=>change.page_action?.kind==='restore_page').map(change=>change.page_no));
  for(const change of changes) {
    if(change.page_action){
      const action=change.page_action;
      if(action.kind==='reorder_pages'){
        if(!same(pageOrder(base),pageOrder(server))&&!same(action.order,pageOrder(server)))conflicts.push('页面顺序');
      }else if(action.kind==='page_metadata'){
        const old=pageMetadata(findPage(base,change.page_no)),remote=pageMetadata(findPage(server,change.page_no));
        for(const key of Object.keys(action.patch) as Array<keyof typeof old>){
          if(!same(old[key],remote[key])&&!same(remote[key],action.patch[key]))conflicts.push(`${change.page_no}/${key}`);
        }
      }else if(action.kind==='delete_page'){
        const before=findPage(base,change.page_no),remote=server.pages.find(p=>p.page_no===change.page_no);
        if(before&&remote&&diffDocuments({...base,pages:[before]},{...server,pages:[remote]}).length)conflicts.push(`${change.page_no}/删除页面`);
      }
      continue;
    }
    const introducingPage=!findPage(base,change.page_no)&&!findPage(server,change.page_no);
    if(introducingPage)continue;
    if(change.relations!==undefined) {
      const beforeRels=base.pages.find(p=>p.page_no===change.page_no)?.relations??[];
      const remoteRels=server.pages.find(p=>p.page_no===change.page_no)?.relations??[];
      if(!same(beforeRels,remoteRels)&&!same(remoteRels,change.relations)) {
        conflicts.push(`${change.page_no}/__page__/relations`);
      }
      continue;
    }
    const before=findPage(base,change.page_no)?.nodes.find(n=>n.id===change.id);
    const remote=(restoring.has(change.page_no)?findPage(server,change.page_no):server.pages.find(p=>p.page_no===change.page_no))?.nodes.find(n=>n.id===change.id);
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
  const width=type==='workshop_plugin'?760:type==='diagram'?640:type==='demo'?620:type==='text'||type==='table'?320:type==='chart'?400:200,
    height=type==='workshop_plugin'?460:type==='diagram'?280:type==='demo'?360:type==='chart'?250:type==='text'?70:type==='vector'?16:140;
  return {id,type,name:type==='text'?'新文字':type==='image'?'新图片':type==='vector'?'线条':type==='workshop_plugin'?'万象工坊插件':'新图形',
    x:Math.round((page.width-width)/2),y:Math.round((page.height-height)/2),
    width,height,
    ...(type==='diagram'?{diagram:defaultDiagram(),viewer_editable:true,name:'原位流程图',flow:{enabled:true,speed:1}}:{}),
    ...(type==='demo'?{demo:null,viewer_editable:true,name:'AI 演示框'}:{}),
    ...(type==='workshop_plugin'?{workshop_plugin:{template_kind:'taylor-error',title:'Taylor 展开与余项',category:'高等数学'},viewer_editable:true,name:'Taylor 展开与余项'}:{}),
    ...(type==='table'?{name:'教学表格',table:[['项目','数值'],['甲','2'],['乙','4']]}:{}),
    ...(type==='chart'?{name:'教学图表',chart:{categories:['甲','乙','丙'],series:[{name:'示例',values:[2,4,3]}],title:'教学图表',chart_type:'COLUMN_CLUSTERED'}}:{}),
    ...(type==='vector'?{flow:{enabled:false,speed:1},viewer_editable:true}:{}),
    rotation:0,z:Math.max(0,...page.nodes.map(n=>n.z))+1,opacity:1,locked:false,hidden:false,deleted:false,
    text:type==='text'?'新文字':'',base_text:null,style:{font_size:28,font_family:reference?.style.font_family??'Arial',color:reference?.style.color??'#18233D',line_height:1.15,align:'left',vertical_align:'top',
      ...(type==='vector'?{stroke:'#167abc',stroke_width:3}:{}),
      ...(type==='shape'?{fill:'#E9E4FF',stroke:'#7966CE',stroke_width:1}: {})},base_style:{} as SceneNode['style'],shape:'rect',source_element_id:null};
}
