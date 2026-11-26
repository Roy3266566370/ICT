import { createPortal } from 'react-dom';
import {useCallback,useEffect,useRef,useState,useSyncExternalStore,type Dispatch,type PointerEvent as ReactPointerEvent,type SetStateAction} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import type {MaterialDetail} from '@/api/types';
import {getDocument,prepareDocumentPage,reinteractDocumentPage,createSceneDiagram,suggestPageRelations} from '@/api/documents';
import {createPageLab} from '@/api/pptAI';
import {errorMessage} from '@/api/client';
import {useScopedQueryKeys} from '@/api/queryKeys';
import type {DocumentController} from '@/document/controller';
import {newNode,patchNodes,distributeNodes} from '@/document/model';
import {SHAPE_CATALOG} from '@/document/shapeCatalog';
import type {SceneNode,ScenePage,NodePatch,NodeInteraction,RelationSuggestion,SceneRelation,SceneParagraph} from '@/document/types';
import type {ISpec} from '@/ispec/types';
import {ZoomControl} from '@/components/ui/ZoomControl';
import {fitZoom,wheelZoom} from '@/components/ui/zoom';
import {workshopPluginConfigForTemplate} from '@/canvas/templateCatalog';
import {ScenePageView} from './ScenePageView';
import {StandaloneDemoDialog} from './SlideDemoNode';
import {standaloneDemos} from './standaloneDemos';
import {FigureVectorizationDialog} from './FigureVectorizationDialog';
import {NodeProperties} from './NodeProperties';
import {WorkshopPluginPicker,type WorkshopPluginSelection} from './WorkshopPluginPicker';
import {groupResize,intersects,rotatedBounds,rotatedBox,rotateSelection,snapAxis,type Box,type GapGuide} from './canvasGestures';
import styles from './FreeDeckEditor.module.css';

interface Props {
  materialId:string;controller:DocumentController;material:MaterialDetail;
  activePageNo:number;onSelectPage:(pageNo:number)=>void;
  zoom:number|'fit';onZoom:Dispatch<SetStateAction<number|'fit'>>;
  headerActionsHost?: HTMLElement | null;
}
interface Drag {kind:'move'|'resize'|'rotate';direction:string;startX:number;startY:number;nodes:SceneNode[];box:Box;preview:Record<string,Partial<SceneNode>>;}
interface Drawing {start:{x:number;y:number};kind:'select'|'ai'|'diagram'|'demo';selection:string[];box:Box;clicked?:string}
const identifier=()=>`u_${crypto.randomUUID().replaceAll('-','')}`;
const round=(n:number)=>Math.round(n*100)/100;
const bounds=(nodes:SceneNode[])=>{const x=Math.min(...nodes.map(n=>n.x)),y=Math.min(...nodes.map(n=>n.y));return {x,y,width:Math.max(...nodes.map(n=>n.x+n.width))-x,height:Math.max(...nodes.map(n=>n.y+n.height))-y};};
const countFigureObjects=(nodes:SceneNode[])=>new Set(nodes.map(node=>`${node.figure_source_id}:${node.figure_object_id??node.id}`)).size;
const preparationStage=(page:ScenePage)=>{
  const status=page.preparation?.status??'unprepared';
  return status==='ready'&&page.native_fallback?page.preparation?.fallback_status??status:status;
};

export function FreeDeckEditor({materialId,controller,material,activePageNo,onSelectPage:selectPage,zoom,onZoom:setZoom,headerActionsHost}:Props){
  const state=useSyncExternalStore(controller.subscribe,controller.getSnapshot);const document=state.document;
  const queryClient=useQueryClient();
  // 材料详情缓存键带账号 scope：退出/切换账号时由 bootstrap 的 scope 监听统一清理
  const keys=useScopedQueryKeys();
  const page=document.pages.find(p=>p.page_no===activePageNo)??document.pages[0]!;
  const pageIndex=document.pages.indexOf(page);
  const [selected,setSelected]=useState<string[]>([]);const [editingId,setEditingId]=useState<string|null>(null);
  const [preview,setPreview]=useState<Record<string,Partial<SceneNode>>>({});
  const [guides,setGuides]=useState<{x?:number;y?:number;gaps?:GapGuide[]}>({});
  const [tab,setTab]=useState<'pages'|'layers'>('pages');
  const [insertMode,setInsertMode]=useState<'diagram'|'demo'|'ai'|null>(null);
  const drawing=useRef<Drawing|null>(null);
  const [drawBox,setDrawBox]=useState<Box|null>(null);
  const [aiBox,setAIBox]=useState<Box|null>(null);
  const [aiRelations,setAIRelations]=useState(false);
  const [aiInstruction,setAIInstruction]=useState('');
  const [aiSuggestion,setAISuggestion]=useState<RelationSuggestion|null>(null);
  const [aiPending,setAIPending]=useState(false);
  const aiRequest=useRef<AbortController|null>(null);
  const [pageMenuFor,setPageMenuFor]=useState<number|null>(null);
  const draggedPage=useRef<number|null>(null);
  const [dropPage,setDropPage]=useState<number|null>(null);
  const [generating,setGenerating]=useState<Record<string,boolean>>({});
  const mounted=useRef(true);useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const [panMode,setPanMode]=useState(false);const [spaceHeld,setSpaceHeld]=useState(false);const spaceRef=useRef(false);
  const [panning,setPanning]=useState(false);const panRef=useRef<{x:number;y:number;left:number;top:number}|null>(null);
  const [reference,setReference]=useState(false);const [retry,setRetry]=useState(0);const retryUsed=useRef(0);const [message,setMessage]=useState('');
  const [demoPage,setDemoPage]=useState<number|null>(null);
  const [proofFigures,setProofFigures]=useState(false);
  const [figureTarget,setFigureTarget]=useState<string|null>(null);
  const [pluginPickerOpen,setPluginPickerOpen]=useState(false);
  const [reinteracting,setReinteracting]=useState(false);const [online,setOnline]=useState(()=>typeof navigator==='undefined'||navigator.onLine);
  const viewport=useRef<HTMLDivElement>(null);const frame=useRef<HTMLDivElement>(null);const rail=useRef<HTMLDivElement>(null);
  const drag=useRef<Drag|null>(null);const file=useRef<HTMLInputElement>(null);
  const lastTap=useRef<{id:string;time:number;x:number;y:number}|null>(null);
  const [area,setArea]=useState({width:1050,height:680});const status=page.preparation?.status??'unprepared';
  const stage=preparationStage(page);
  const nextPage=document.pages[pageIndex+1];
  const nextStage=nextPage&&preparationStage(nextPage);
  const ready=status==='ready';const canEdit=ready&&!reinteracting;
  const separateDemos = ready ? standaloneDemos(page) : [];
  const fit=fitZoom(area,{...page,width:page.width*(reference?2:1)},reference?64:80,.15,1.7);
  const scale=zoom==='fit'?fit:zoom;
  const displayWidth=page.width*scale*(reference?2:1)+(reference?64:80);
  const canPan=displayWidth>area.width+1||page.height*scale+80>area.height+1;
  const source=page.source_page_no===null?undefined:material.slides.find(p=>p.page_no===(page.source_page_no??page.page_no));
  const selectedNodes=page.nodes.filter(n=>selected.includes(n.id)&&!n.deleted);const primary=selectedNodes[0]??null;
  const figureNode=figureTarget&&primary?.id===figureTarget?primary:null;
  const canVectorize=canEdit&&online&&selectedNodes.length===1&&primary?.type==='image'&&!primary.whole_group&&
    !primary.hidden&&!primary.locked&&!primary.cleaned_asset_id&&!page.preparation?.frozen_ids?.includes(primary.id);
  const hasAppliedFigures=page.nodes.some(node=>node.cleaned_asset_id&&!node.deleted);
  const unlocked=selectedNodes.filter(n=>!n.locked&&!n.hidden&&!page.preparation?.frozen_ids?.includes(n.id));
  const slideSelection=unlocked.length&&unlocked.length===selectedNodes.length&&
    !separateDemos.some(node=>selected.includes(node.id))?rotatedBounds(unlocked):null;
  const canMoveInside=slideSelection&&slideSelection.width<=page.width&&slideSelection.height<=page.height&&
    (slideSelection.x<0||slideSelection.y<0||
      slideSelection.x+slideSelection.width>page.width||slideSelection.y+slideSelection.height>page.height);
  const shown=selectedNodes.filter(n=>!n.hidden).map(n=>preview[n.id]?{...n,...preview[n.id]}:n);
  const box=shown.length?(shown.length===1?bounds(shown):rotatedBounds(shown)):null;
  const canTransform=canEdit&&unlocked.length===shown.length&&!editingId&&(shown.length>1||primary?.type!=='vector');
  const aiInset=Math.min(page.width*scale/2,150);
  useEffect(()=>{
    const node=viewport.current;if(!node)return;
    const measure=()=>{
      // 使用不受内部滚动条影响的 offsetWidth/offsetHeight，防止滚动条出现/消失触发 ResizeObserver 震荡
      const width=Math.floor(node.offsetWidth);
      const height=Math.floor(node.offsetHeight);
      if(width>0&&height>0)setArea(prev=>prev.width===width&&prev.height===height?prev:{width,height});
    };
    measure();
    const observer=new ResizeObserver(measure);
    observer.observe(node);
    window.addEventListener('resize',measure);
    return()=>{observer.disconnect();window.removeEventListener('resize',measure);};
  },[]);
  useEffect(()=>{
    const node=viewport.current;if(!node)return;
    const onWheel=(event:WheelEvent)=>{
      if(!(event.ctrlKey||event.metaKey))return;
      event.preventDefault();
      setZoom(current=>wheelZoom(current==='fit'?fit:current,event.deltaY));
    };
    node.addEventListener('wheel',onWheel,{passive:false});
    return()=>node.removeEventListener('wheel',onWheel);
  },[fit,setZoom]);
  useEffect(()=>{
    const editable=(target:EventTarget|null)=>target instanceof Element&&!!target.closest('input,textarea,select,button,a,summary,[contenteditable=true],[data-standalone-demo]');
    const down=(event:KeyboardEvent)=>{
      if(event.code!=='Space'||editable(event.target))return;
      if(spaceRef.current)return;
      spaceRef.current=true;setSpaceHeld(true);event.preventDefault();
    };
    const up=(event:KeyboardEvent)=>{if(event.code==='Space'){spaceRef.current=false;setSpaceHeld(false);}};
    const blur=()=>{spaceRef.current=false;setSpaceHeld(false);};
    window.addEventListener('keydown',down);window.addEventListener('keyup',up);window.addEventListener('blur',blur);
    return()=>{window.removeEventListener('keydown',down);window.removeEventListener('keyup',up);window.removeEventListener('blur',blur);};
  },[]);
  useEffect(()=>()=>{controller.setComposing(false);aiRequest.current?.abort();},[controller]);
  useEffect(()=>{
    if(tab==='pages')rail.current?.querySelector('[aria-current="page"]')?.scrollIntoView({block:'nearest',inline:'nearest'});
  },[page.page_no,tab]);
  useEffect(()=>{
    setSelected([]);setEditingId(null);setPreview({});setGuides({});setReference(false);setInsertMode(null);
    setFigureTarget(null);setProofFigures(false);
    setDrawBox(null);setAIBox(null);setAIRelations(false);setAISuggestion(null);setAIInstruction('');setAIPending(false);setDemoPage(null);setPluginPickerOpen(false);
    setPageMenuFor(current=>current===page.page_no?current:null);
    drawing.current=null;drag.current=null;lastTap.current=null;aiRequest.current?.abort();aiRequest.current=null;
  },[page.page_no]);
  useEffect(()=>{
    if(pageMenuFor===null)return;
    const close=(e:PointerEvent)=>{if(!(e.target as Element).closest('[data-page-menu]'))setPageMenuFor(null);};
    const key=(e:KeyboardEvent)=>{if(e.key==='Escape')setPageMenuFor(null);};
    window.addEventListener('pointerdown',close);window.addEventListener('keydown',key);
    return()=>{window.removeEventListener('pointerdown',close);window.removeEventListener('keydown',key);};
  },[pageMenuFor]);
  useEffect(()=>{
    if(stage==='ready'||stage==='unavailable')return;
    let alive=true;let timer:ReturnType<typeof setTimeout>|undefined;
    const poll=async()=>{
      if(!alive)return;
      try{
        const remote=await getDocument(materialId);if(!alive)return;controller.updateAssets(remote);
        const current=remote.pages.find(p=>p.page_no===page.page_no),next=current&&preparationStage(current);
        if(next==='unprepared'||next==='queued'||next==='preparing')timer=setTimeout(()=>void poll(),1000);
      }catch(error){
        if(!alive)return;
        if(!ready)setMessage(errorMessage(error));
        timer=setTimeout(()=>void poll(),2500);
      }
    };
    const manual=stage==='failed'&&retry!==retryUsed.current;
    if(stage==='unprepared'||manual){
      retryUsed.current=retry;
      void prepareDocumentPage(materialId,page.page_no).then(()=>void poll()).catch(error=>{if(alive&&(!ready||manual))setMessage(errorMessage(error));});
    }else if(stage==='queued'||stage==='preparing')timer=setTimeout(()=>void poll(),700);
    return()=>{alive=false;clearTimeout(timer);};
  },[materialId,page.page_no,stage,ready,retry,controller]);
  // 当前页就绪后，悄悄把下一页的对象也准备好：翻页时基本不用再等。
  useEffect(()=>{
    if(!ready||!nextPage||nextStage!=='unprepared')return;
    const timer=setTimeout(()=>{void prepareDocumentPage(materialId,nextPage.page_no).catch(()=>{});},900);
    return ()=>clearTimeout(timer);
  },[materialId,nextPage?.page_no,ready,nextStage]);
  useEffect(()=>{
    const reconnect=()=>{setOnline(true);void controller.save();};
    const offline=()=>setOnline(false);
    window.addEventListener('online',reconnect);window.addEventListener('offline',offline);
    return()=>{window.removeEventListener('online',reconnect);window.removeEventListener('offline',offline);};
  },[controller]);
  const syncText=!online?(state.dirty||state.saving?'离线修改 · 仅保存在当前浏览器':'离线 · 已载入本机草稿'):
    state.error?'同步失败 · 本机草稿已保留':state.saving?'有修改，正在保存到服务端…':
    state.dirty?'有修改，正在保存…':'已保存到服务端';

  const patch=useCallback((value:NodePatch,key='')=>{
    if(!canEdit||!primary)return;
    // Locked objects can be selected in the layer list and explicitly unlocked.
    const ids=('locked' in value)?selected:unlocked.map(n=>n.id);
    controller.patch(page.page_no,ids,value,key?`${ids.join('.')}.${key}`:'');setMessage('');
  },[controller,canEdit,primary,selected,unlocked,page.page_no]);
  const duplicate=()=>{
    if(!canEdit||!selectedNodes.length)return;
    const ids:string[]=[];let next=controller.getSnapshot().document;
    for(const node of selectedNodes){const id=identifier();ids.push(id);const copy={...node,id,duplicate_from:node.id,source_element_id:null,source_shape_id:null,
      cleaned_asset_id:undefined,cleaned_url:undefined,figure_scene:undefined,figure_source_id:undefined,figure_object_id:undefined,figure_provenance:undefined,
      name:node.name+' 副本',x:node.x+18,y:node.y+18,z:Math.max(...page.nodes.map(n=>n.z))+ids.length,locked:false};
      next={...next,pages:next.pages.map(p=>p.page_no===page.page_no?{...p,modified:true,nodes:[...p.nodes,copy]}:p)};}
    controller.replace(next);setSelected(ids);setEditingId(null);
  };
  const remove=()=>{if(canEdit){controller.patch(page.page_no,unlocked.map(n=>n.id),{deleted:true});setSelected([]);setEditingId(null);}};
  const add=(type:'text'|'shape'|'table'|'chart',shape:SceneNode['shape']='rect')=>{
    if(!canEdit)return;
    const node={...newNode(page,identifier(),type),shape};
    if(type==='shape')node.name=SHAPE_CATALOG.find(item=>item.id===shape)?.label??node.name;
    controller.add(page.page_no,node);setSelected([node.id]);setEditingId(type==='text'?node.id:null);
  };
  const addVector = (arrow: boolean) => {
    if (!canEdit) return;
    const node = newNode(page, identifier(), 'vector');
    node.name = arrow ? '箭头' : '线条';
    node.y += (page.nodes.filter(item => item.type === 'vector' && !item.deleted).length % 5) * 22;
    node.style.arrow_end = arrow;
    controller.add(page.page_no, node);
    setSelected([node.id]);
    setEditingId(null);
  };
  const addWorkshopPlugin = (entry: WorkshopPluginSelection) => {
    if (!canEdit) return;
    const node = newNode(page, identifier(), 'workshop_plugin');
    node.name = [...entry.name].slice(0, 100).join('');
    node.workshop_plugin = 'work_id' in entry ? {
      template_kind: entry.kind,
      title: entry.name,
      category: entry.category,
      work_id: entry.work_id,
      doc: entry.doc,
    } : workshopPluginConfigForTemplate(entry);
    controller.add(page.page_no, node);
    setSelected([node.id]);
    setEditingId(null);
    setPluginPickerOpen(false);
    setMessage(`已插入定象坊插件「${entry.name}」，可拖动位置或在演示态直接操作。`);
  };
  const generateNode=async(id:string,kind:'demo'|'diagram',text='',ai=false)=>{
    const pageNo=page.page_no;
    const original=controller.getSnapshot().document.pages.find(p=>p.page_no===pageNo)?.nodes.find(n=>n.id===id);
    if(!canEdit||!original||original.locked||generating[id])return;
    const content=JSON.stringify(kind==='demo'?original.demo:original.diagram);
    setGenerating(current=>({...current,[id]:true}));setMessage('');
    try{
      if(!await controller.save())throw new Error('请先完成当前修改的同步，再根据本页生成。');
      const patch:NodePatch=kind==='demo'?{demo:(await createPageLab(materialId,pageNo,!!original.demo)).lab}:
        {diagram:(await createSceneDiagram(materialId,pageNo,text,ai)).diagram};
      const latest=controller.getSnapshot().document.pages.find(p=>p.page_no===pageNo)?.nodes.find(n=>n.id===id);
      if(!latest||latest.deleted||latest.locked||JSON.stringify(kind==='demo'?latest.demo:latest.diagram)!==content){
        if(mounted.current)setMessage('生成期间目标图框已变更，请重新生成。');return;
      }
      controller.patch(pageNo,[id],patch);
      if(mounted.current)setMessage(`已生成到第 ${controller.getSnapshot().document.pages.findIndex(p=>p.page_no===pageNo)+1} 页，可直接演示。`);
    }catch(error){if(mounted.current)setMessage(errorMessage(error));}
    finally{if(mounted.current)setGenerating(current=>({...current,[id]:false}));}
  };
  const suggestRelations=async(instruction:string,signal?:AbortSignal):Promise<RelationSuggestion>=>{
    const targetPageNo=page.page_no;
    if(!canEdit)throw new Error('当前页面暂不可编辑，无法生成动态关系。');
    if(!await controller.save())throw new Error('请先完成当前修改的同步，再生成动态关系。');
    const latest=controller.getSnapshot().document;
    return suggestPageRelations(materialId,targetPageNo,{
      instruction,
      selected_node_ids:selected,
      expected_revision:latest.revision,
    },signal);
  };
  const applyRelationSuggestion=(suggestion:RelationSuggestion):string|null=>{
    if(!canEdit)return '当前页面暂不可编辑。';
    const targetPageNo=page.page_no;
    const latest=controller.getSnapshot().document;
    if(latest.revision!==suggestion.source_revision||controller.getSnapshot().dirty){
      return '页面在生成预览后已发生变化，请重新生成动态关系预览。';
    }
    const targetPage=latest.pages.find(item=>item.page_no===targetPageNo);
    if(!targetPage)return '未找到当前页面，请刷新后重试。';
    const mergedRelations:SceneRelation[]=[...(targetPage.relations??[])];
    for(const proposed of suggestion.relations){
      const existingIndex=mergedRelations.findIndex(item=>item.id===proposed.id);
      if(existingIndex>=0)mergedRelations[existingIndex]=proposed;
      else mergedRelations.push(proposed);
    }
    const updatesByNode=new Map(suggestion.viewer_updates.map(item=>[item.nodeId,item]));
    const next={
      ...latest,
      pages:latest.pages.map(item=>item.page_no!==targetPageNo?item:{
        ...item,
        modified:true,
        relations:mergedRelations,
        nodes:item.nodes.map(node=>{
          const update=updatesByNode.get(node.id);
          if(!update)return node;
          const nextNode:SceneNode={...node};
          if(typeof update.viewer_editable==='boolean')nextNode.viewer_editable=update.viewer_editable;
          if(Array.isArray(update.viewer_parameters))nextNode.viewer_parameters=[...update.viewer_parameters];
          return nextNode;
        }),
      }),
    };
    controller.replace(next,'relations.nl.apply');
    setMessage(`已应用 ${suggestion.relations.length} 条动态关系，可按 Ctrl+Z 一次性撤销。`);
    return null;
  };
  const closeAI=()=>{
    aiRequest.current?.abort();aiRequest.current=null;
    setAIBox(null);setAIRelations(false);setAISuggestion(null);setAIPending(false);
  };
  const armInsert=(kind:'diagram'|'demo'|'ai')=>{
    setInsertMode(current=>current===kind?null:kind);setPanMode(false);setEditingId(null);closeAI();
    if(kind==='ai'){
      if(insertMode!=='ai'&&shown.length)setAIBox(rotatedBounds(shown));
      setMessage(insertMode==='ai'?'':'在画布圈出目标区域，或从选区直接打开 AI 操作。');
    }else{setSelected([]);setMessage('在幻灯片上拖出图框；按 Esc 取消。');}
  };
  const insertFrame=(kind:'diagram'|'demo',region:Box)=>{
    const minH=kind==='demo'?320:30;
    const width=Math.min(page.width,Math.max(kind==='demo'?320:40,region.width)),height=Math.min(page.height,Math.max(minH,region.height));
    const node={...newNode(page,identifier(),kind),x:Math.max(0,Math.min(page.width-width,region.x)),
      y:Math.max(0,Math.min(page.height-height,region.y)),width,height};
    controller.add(page.page_no,node);setSelected([node.id]);return node;
  };
  const openDemo=()=>{
    if(!aiBox)return;
    const node=primary?.type==='demo'&&!primary.locked&&selectedNodes.length===1?primary:insertFrame('demo',aiBox);
    closeAI();setInsertMode(null);void generateNode(node.id,'demo');
  };
  const generateAIRelations=async()=>{
    aiRequest.current?.abort();
    const request=new AbortController();
    aiRequest.current=request;
    setAIPending(true);setAISuggestion(null);
    try{const suggestion=await suggestRelations(aiInstruction,request.signal);if(!request.signal.aborted)setAISuggestion(suggestion);}
    catch(error){if(!request.signal.aborted)setMessage(errorMessage(error));}
    finally{if(aiRequest.current===request){aiRequest.current=null;if(mounted.current)setAIPending(false);}}
  };
  const addImage=async(image:File)=>{
    if(!['image/png','image/jpeg','image/webp'].includes(image.type)||image.size>4*1024*1024){setMessage('请选择4MB以内的PNG、JPEG或WebP图片');return;}
    const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(reader.error);reader.readAsDataURL(image);});
    const bitmap=await createImageBitmap(image);const width=Math.min(page.width*.5,400),height=width*bitmap.height/bitmap.width;bitmap.close();
    const node={...newNode(page,identifier(),'image'),image_data:data,width,height,text:''};controller.add(page.page_no,node);setSelected([node.id]);
  };
  const align=(mode:string)=>{
    if(!canEdit||!unlocked.length)return;
    if(mode==='inside-slide'){
      if(!canMoveInside||!slideSelection)return;
      const dx=Math.max(-slideSelection.x,Math.min(0,page.width-slideSelection.x-slideSelection.width));
      const dy=Math.max(-slideSelection.y,Math.min(0,page.height-slideSelection.y-slideSelection.height));
      const next=unlocked.reduce((doc,node)=>patchNodes(doc,page.page_no,[node.id],{x:node.x+dx,y:node.y+dy}),
        controller.getSnapshot().document);
      controller.replace(next);
      return;
    }
    const target=unlocked.length===1?{x:0,y:0,width:page.width,height:page.height}:bounds(unlocked);let next=controller.getSnapshot().document;
    for(const node of unlocked){const value:NodePatch=mode==='left'?{x:target.x}:mode==='right'?{x:target.x+target.width-node.width}:mode==='center'?{x:target.x+(target.width-node.width)/2}:
      mode==='top'?{y:target.y}:mode==='bottom'?{y:target.y+target.height-node.height}:{y:target.y+(target.height-node.height)/2};next=patchNodes(next,page.page_no,[node.id],value);}
    controller.replace(next);
  };
  const layer=(front:boolean)=>{if(canEdit&&unlocked.length){let next=controller.getSnapshot().document;
    const extreme=front?Math.max(...page.nodes.map(n=>n.z))+1:Math.min(...page.nodes.map(n=>n.z))-unlocked.length;
    unlocked.forEach((node,i)=>{next=patchNodes(next,page.page_no,[node.id],{z:extreme+i});});controller.replace(next);}};
  const distribute=(axis:'h'|'v')=>{if(canEdit&&unlocked.length>=3)controller.replace(distributeNodes(controller.getSnapshot().document,page.page_no,unlocked.map(n=>n.id),axis),`distribute.${axis}`);};
  const point=(e:{clientX:number;clientY:number})=>{const rect=frame.current!.getBoundingClientRect();return {x:(e.clientX-rect.left)/scale,y:(e.clientY-rect.top)/scale};};
  const panDown=(e:ReactPointerEvent<HTMLDivElement>)=>{
    if(!canPan||(e.button!==0&&e.button!==1)||!(panMode||spaceRef.current||e.button===1))return;
    if((e.target as Element).closest('input,textarea,select,button,a,[contenteditable=true]'))return;
    const node=e.currentTarget;
    panRef.current={x:e.clientX,y:e.clientY,left:node.scrollLeft,top:node.scrollTop};
    setPanning(true);node.setPointerCapture(e.pointerId);e.preventDefault();
  };
  const panMove=(e:ReactPointerEvent<HTMLDivElement>)=>{
    const pan=panRef.current;if(!pan)return;
    e.currentTarget.scrollLeft=pan.left-(e.clientX-pan.x);
    e.currentTarget.scrollTop=pan.top-(e.clientY-pan.y);
  };
  const panEnd=(e:ReactPointerEvent<HTMLDivElement>)=>{
    if(!panRef.current)return;
    panRef.current=null;setPanning(false);
    if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const begin=(e:ReactPointerEvent<HTMLDivElement>)=>{
    if(panMode||spaceRef.current)return;
    if(!canEdit||e.button!==0||(e.target as Element).closest('textarea,input,select,button,a,[contenteditable=true],[data-editor-control]'))return;
    const handle=(e.target as Element).closest<HTMLElement>('[data-handle]')?.dataset.handle;
    const target=e.target as Element;
    const id=target.closest<HTMLElement>('[data-node-id]')?.dataset.nodeId??
      (target.matches('[data-vector-select]')?target.closest<SVGSVGElement>('[data-vector-node]')?.dataset.vectorNode:undefined);
    const fallbackNode=id?page.nodes.find(n=>n.id===id):undefined;
    if(insertMode||(!handle&&(!id||fallbackNode?.locked))){
      if(insertMode&&insertMode!=='ai'&&!frame.current?.contains(e.target as Node))return;
      const start=point(e);
      if(insertMode==='diagram'||insertMode==='demo'){
        start.x=Math.max(0,Math.min(page.width,start.x));start.y=Math.max(0,Math.min(page.height,start.y));
      }
      closeAI();lastTap.current=null;
      const selection=e.shiftKey?[...selected]:[];
      drawing.current={start,kind:insertMode??'select',selection,box:{...start,width:0,height:0},clicked:id};
      setEditingId(null);e.preventDefault();e.stopPropagation();e.currentTarget.setPointerCapture(e.pointerId);return;
    }
    if(target.closest('[data-no-pan]')&&!handle&&!id)return;
    closeAI();
    let nodes=unlocked;
    if(!handle){
      if(!id||!fallbackNode)return;
      const node=fallbackNode;
      const prior=lastTap.current;
      if(node.type==='text'&&!node.locked&&prior?.id===id&&Date.now()-prior.time<450&&Math.hypot(e.clientX-prior.x,e.clientY-prior.y)<6){
        e.preventDefault();drag.current=null;lastTap.current=null;setSelected([id]);setEditingId(id);return;
      }
      lastTap.current={id,time:Date.now(),x:e.clientX,y:e.clientY};
      let ids=selected;
      if(e.shiftKey){ids=selected.includes(id)?selected.filter(n=>n!==id):[...selected,id];setSelected(ids);e.stopPropagation();return;}
      else if(!selected.includes(id)){ids=[id];setSelected(ids);}
      nodes=page.nodes.filter(n=>ids.includes(n.id)&&!n.locked&&!n.hidden&&!n.deleted&&!page.preparation?.frozen_ids?.includes(n.id));
      if(!nodes.length)return;
    }
    if(!nodes.length)return;
    setEditingId(null);e.preventDefault();e.stopPropagation();e.currentTarget.setPointerCapture(e.pointerId);
    const kind=handle==='rotate'?'rotate':handle?'resize':'move';
    const start=point(e);drag.current={kind,direction:handle??'',startX:start.x,startY:start.y,nodes,
      box:kind!=='move'&&nodes.length===1?bounds(nodes):rotatedBounds(nodes),preview:{}};
  };
  const measureDrawing=(e:ReactPointerEvent<HTMLDivElement>)=>{
    const active=drawing.current!;
    const now=point(e),start=active.start;
    if(active.kind==='diagram'||active.kind==='demo'){
      now.x=Math.max(0,Math.min(page.width,now.x));now.y=Math.max(0,Math.min(page.height,now.y));
    }
    active.box={x:Math.min(start.x,now.x),y:Math.min(start.y,now.y),width:Math.abs(now.x-start.x),height:Math.abs(now.y-start.y)};
    return active;
  };
  const drawnSelection=(active:Drawing)=>{
    const ids=(Math.max(active.box.width,active.box.height)*scale>=4
      ?page.nodes.filter(n=>!n.deleted&&!n.hidden&&!n.locked&&!page.preparation?.frozen_ids?.includes(n.id)&&intersects(active.box,rotatedBox(n))).map(n=>n.id)
      :active.clicked?[active.clicked]:[]);
    return [...active.selection.filter(id=>!ids.includes(id)),...ids.filter(id=>!active.selection.includes(id))];
  };
  const move=(e:ReactPointerEvent<HTMLDivElement>)=>{
    if(drawing.current){
      const active=measureDrawing(e);setDrawBox(active.box);
      if(active.kind==='select'||active.kind==='ai')setSelected(drawnSelection(active));
      return;
    }
    const active=drag.current;if(!active)return;
    const current=point(e);let dx=current.x-active.startX,dy=current.y-active.startY;
    const result:Record<string,Partial<SceneNode>>={};const lines:typeof guides={};
    if(Math.hypot(dx,dy)>4)lastTap.current=null;
    if(active.kind==='move'){
      if(!e.altKey){
        const ids=new Set(active.nodes.map(n=>n.id));
        const others=page.nodes.filter(n=>!ids.has(n.id)&&!n.hidden&&!n.deleted).map(rotatedBox);
        const horizontal=snapAxis('x',active.box,dx,dy,others,page.width,6/scale);
        const vertical=snapAxis('y',active.box,dy,horizontal.offset,others,page.height,6/scale);
        dx=horizontal.offset;dy=vertical.offset;
        lines.x=horizontal.line;lines.y=vertical.line;lines.gaps=[...horizontal.gaps??[],...vertical.gaps??[]];
      }
      dx=Math.max(Math.max(...active.nodes.map(node=>-20000-node.x)),Math.min(Math.min(...active.nodes.map(node=>20000-node.x)),dx));
      dy=Math.max(Math.max(...active.nodes.map(node=>-20000-node.y)),Math.min(Math.min(...active.nodes.map(node=>20000-node.y)),dy));
      for(const node of active.nodes)result[node.id]={x:round(node.x+dx),y:round(node.y+dy)};
    }else if(active.kind==='rotate'){
      const cx=active.box.x+active.box.width/2,cy=active.box.y+active.box.height/2;
      const start=Math.atan2(active.startY-cy,active.startX-cx),end=Math.atan2(current.y-cy,current.x-cx);
      const delta=(end-start)*180/Math.PI;
      const rotation=e.shiftKey?Math.round(delta/15)*15:delta;
      for(const node of active.nodes)result[node.id]=rotateSelection(node,active.box,rotation);
    }else if(active.nodes.length>1){
      const resized=groupResize(active.nodes,active.box,active.direction,dx,dy,e.shiftKey);
      active.nodes.forEach((node,index)=>{result[node.id]=resized[index]!;});
    }else{
      const node=active.nodes[0]!;const angle=node.rotation*Math.PI/180,cx=node.x+node.width/2,cy=node.y+node.height/2;
        const localX=dx*Math.cos(angle)+dy*Math.sin(angle),localY=-dx*Math.sin(angle)+dy*Math.cos(angle);const direction=active.direction;
        const horizontal=direction.includes('e')?1:direction.includes('w')?-1:0,vertical=direction.includes('s')?1:direction.includes('n')?-1:0;
        let width=Math.min(20000,Math.max(Math.min(5,node.width),node.width+localX*horizontal));
        let height=Math.min(20000,Math.max(Math.min(5,node.height),node.height+localY*vertical));
        if(e.shiftKey&&horizontal&&vertical){
          const sx=width/node.width,sy=height/node.height;
          const factor=Math.min(20000/Math.max(node.width,node.height),Math.abs(sx-1)>=Math.abs(sy-1)?sx:sy);
          width=Math.max(.1,node.width*factor);height=Math.max(.1,node.height*factor);
        }
        const shiftX=direction.includes('w')?-(width-node.width)/2:direction.includes('e')?(width-node.width)/2:0;
        const shiftY=direction.includes('n')?-(height-node.height)/2:direction.includes('s')?(height-node.height)/2:0;
        result[node.id]={width:round(width),height:round(height),
          x:round(Math.max(-20000,Math.min(20000,cx+shiftX*Math.cos(angle)-shiftY*Math.sin(angle)-width/2))),
          y:round(Math.max(-20000,Math.min(20000,cy+shiftX*Math.sin(angle)+shiftY*Math.cos(angle)-height/2)))};
    }
    active.preview=result;setPreview(result);setGuides(lines);
  };
  const end=(cancel=false)=>{
    const active=drag.current;if(!active)return;drag.current=null;
    if(!cancel){let next=controller.getSnapshot().document;for(const [id,value]of Object.entries(active.preview))next=patchNodes(next,page.page_no,[id],value);controller.replace(next);}
    setPreview({});setGuides({});
  };
  const finishPointer=(e:ReactPointerEvent<HTMLDivElement>)=>{
    if(!drawing.current){
      if(drag.current&&Object.keys(drag.current.preview).length)move(e);
      end();return;
    }
    const active=measureDrawing(e),region=active.box;
    drawing.current=null;setDrawBox(null);
    if(active.kind==='select'||active.kind==='ai'){
      const ids=drawnSelection(active);setSelected(ids);
      if(active.kind==='ai'){
        const nodes=page.nodes.filter(node=>ids.includes(node.id));
        if(region.width*scale>=4&&region.height*scale>=4)setAIBox(region);
        else if(nodes.length)setAIBox(rotatedBounds(nodes));
      }
      return;
    }
    const size=newNode(page,'',active.kind);
    insertFrame(active.kind,{...region,width:region.width>=80?Math.max(160,region.width):size.width,
      height:region.height>=60?Math.max(120,region.height):size.height});
    setInsertMode(null);setMessage('');
  };
  useEffect(()=>{
    const key=(e:KeyboardEvent)=>{
      if (demoPage===page.page_no||figureNode) return;
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();void controller.save();return;}
      if((e.target as Element)?.closest('input,textarea,select,[contenteditable=true]'))return;
      if(e.key==='Escape'){setEditingId(null);setSelected([]);setInsertMode(null);setDrawBox(null);drawing.current=null;end(true);closeAI();return;}
      if(!reinteracting&&(e.ctrlKey||e.metaKey)&&['z','y'].includes(e.key.toLowerCase())){e.preventDefault();e.shiftKey||e.key.toLowerCase()==='y'?controller.redo():controller.undo();return;}
      if(!canEdit)return;
      if(!e.ctrlKey&&!e.metaKey&&!e.altKey&&e.key.toLowerCase()==='a'&&!e.repeat){e.preventDefault();armInsert('ai');return;}
      if(e.key==='Enter'&&primary?.type==='text'&&!primary.locked){e.preventDefault();setEditingId(primary.id);return;}
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='d'){e.preventDefault();duplicate();return;}
      if(e.key==='Delete'||e.key==='Backspace'){if(selected.length){e.preventDefault();remove();}return;}
      const delta=e.shiftKey?10:1;const value=e.key==='ArrowLeft'?[-delta,0]:e.key==='ArrowRight'?[delta,0]:e.key==='ArrowUp'?[0,-delta]:e.key==='ArrowDown'?[0,delta]:null;
      if(value&&unlocked.length){e.preventDefault();let next=controller.getSnapshot().document;for(const node of unlocked)next=patchNodes(next,page.page_no,[node.id],{x:node.x+value[0]!,y:node.y+value[1]!});controller.replace(next,'keyboard.move');}
    };
    window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
  });
  /** 文字放不下时把文本框按实际内容高度撑开（只增不减，避免与用户手动拉高互相打架）。 */
  const growText=useCallback((id:string)=>{
    window.requestAnimationFrame(()=>{
      const nodeEl=frame.current?.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"]`);
      const content=nodeEl?.querySelector<HTMLElement>('[data-text-content]');
      if(!content)return;
      const target=controller.getSnapshot().document.pages.find(p=>p.page_no===page.page_no)?.nodes.find(n=>n.id===id);
      if(!target||target.type!=='text')return;
      const rect=content.getBoundingClientRect();
      const needed=rect.height/scale+(target.style.padding_top??0)+(target.style.padding_bottom??0);
      const patch:NodePatch={};
      if(needed>target.height+1)patch.height=Math.ceil(needed);
      if(target.word_wrap===false&&(target.text!==target.base_text||target.base_text===null)){
        const neededWidth=rect.width/scale+(target.style.padding_left??0)+(target.style.padding_right??0);
        if(neededWidth>target.width+1)patch.width=Math.ceil(neededWidth);
      }
      if(Object.keys(patch).length)controller.patch(page.page_no,[id],patch,`grow.${id}`);
    });
  },[controller,page.page_no,scale]);
  // 画布内输入结束、或在右侧面板改文字后，内容超过框高就自动撑高（400ms 去抖，避免逐字触发）。
  useEffect(()=>{
    const node=primary;
    if(!node||node.type!=='text'||editingId===node.id)return;
    const timer=setTimeout(()=>growText(node.id),400);
    return ()=>clearTimeout(timer);
  }, [primary, editingId, growText]);
  const recover=async(mode:'merge'|'local'|'server')=>{try{const remote=await getDocument(materialId);if(mode==='server')controller.loadServer(remote);else controller.mergeServer(remote,mode==='local');}catch(error){setMessage(errorMessage(error));}};
  const autoSpecs=((material.ispecs??[]) as ISpec[]).filter(spec=>spec.anchor?.page===page.page_no||
    spec.parameters?.some(parameter=>parameter.source?.page===page.page_no));
  const reinteract=async()=>{
    if(!canEdit||reinteracting)return;
    setEditingId(null);setPreview({});setReinteracting(true);setMessage('正在按当前编辑内容提取本页交互…');
    try{
      if(!await controller.save()){setMessage('还有修改未同步，请先处理上方提示');return;}
      const result=await reinteractDocumentPage(materialId,page.page_no,controller.getSnapshot().document.revision);
      const remote=await getDocument(materialId);controller.loadServer(remote);
      await queryClient.invalidateQueries({queryKey:keys.material(materialId)});
      setMessage(`第 ${pageIndex+1} 页已按当前内容重新提取${result.refreshed_user_interactions?`，并恢复 ${result.refreshed_user_interactions} 个用户公式`:''}。位置和样式修改仍保留。`);
    }catch(error){setMessage(errorMessage(error));}
    finally{setReinteracting(false);}
  };
  const restoreContent=()=>{
    if(!canEdit||!primary?.source_element_id)return;
    const patch:NodePatch={};
    if(primary.text!==primary.base_text)patch.text=primary.base_text??'';
    if(primary.base_paragraphs&&JSON.stringify(primary.paragraphs)!==JSON.stringify(primary.base_paragraphs))
      patch.paragraphs=primary.base_paragraphs;
    if(JSON.stringify(primary.table)!==JSON.stringify(primary.base_table))patch.table=primary.base_table;
    if(JSON.stringify(primary.chart)!==JSON.stringify(primary.base_chart))patch.chart=primary.base_chart;
    if(!Object.keys(patch).length)return;
    controller.patch(page.page_no,[primary.id],patch,'restore.content');
    setMessage('已恢复这段内容为原稿；依赖它的自动交互会在演示页重新启用。');
  };
  const onText=useCallback((id:string,text:string,paragraphs?:SceneParagraph[])=>controller.patch(page.page_no,[id],{text,...(paragraphs?{paragraphs}:{})},`text.${id}`),[controller,page.page_no]);
  const onCompose=useCallback((active:boolean)=>controller.setComposing(active),[controller]);
  const closeText=useCallback(()=>setEditingId(null),[]);
  const removePage=()=>{
    if(document.pages.length<2)return;
    const fallback=document.pages[pageIndex+1]??document.pages[pageIndex-1];
    controller.deletePage(page.page_no);
    if(fallback)selectPage(fallback.page_no);
  };
  const sourceFor=(candidate:typeof page)=>candidate.source_page_no===null?undefined:
    material.slides.find(slide=>slide.page_no===(candidate.source_page_no??candidate.page_no));

  return <div className={styles.editor} data-free-editor>
    <div className={styles.toolbar}>
      <div className={styles.toolGroup}><button aria-label="撤销编辑" title="Ctrl+Z" onClick={()=>controller.undo()} disabled={!state.canUndo||reinteracting}>↶ 撤销</button>
        <button aria-label="重做编辑" title="Ctrl+Shift+Z" onClick={()=>controller.redo()} disabled={!state.canRedo||reinteracting}>↷ 重做</button></div>
      <div className={styles.toolGroup}><button onClick={()=>add('text')} disabled={!canEdit}>＋ 文字</button><button onClick={()=>file.current?.click()} disabled={!canEdit}>＋ 图片</button>
        <select aria-label="插入教学图形" value="" disabled={!canEdit} onChange={e=>{const shape=SHAPE_CATALOG.find(item=>item.id===e.target.value);if(shape)add('shape',shape.id);}}>
          <option value="" disabled>＋ 图形</option>{SHAPE_CATALOG.map(shape=><option key={shape.id} value={shape.id}>{shape.label}</option>)}
        </select>
        <select aria-label="插入表格或图表" value="" disabled={!canEdit} onChange={e=>{if(e.target.value==='table'||e.target.value==='chart')add(e.target.value);}}>
          <option value="" disabled>＋ 表格或图表</option><option value="table">表格</option><option value="chart">图表</option>
        </select></div>
      <div className={styles.toolGroup}><button onClick={()=>addVector(false)} disabled={!canEdit}>＋ 线条</button><button onClick={()=>addVector(true)} disabled={!canEdit}>＋ 箭头</button></div>
      <div className={`${styles.toolGroup} ${styles.featureGroup}`}><button className={styles.featurePrimary} onClick={()=>setPluginPickerOpen(true)} disabled={!canEdit}>🎛️ 插入定象坊插件</button>
        <button aria-pressed={insertMode==='diagram'} onClick={()=>armInsert('diagram')} disabled={!canEdit}>＋ 流程图</button>
        <button aria-pressed={insertMode==='demo'} onClick={()=>armInsert('demo')} disabled={!canEdit}>＋ AI 演示框</button>
        <button aria-pressed={insertMode==='ai'} onClick={()=>armInsert('ai')} disabled={!canEdit} aria-keyshortcuts="A" title="圈选本页要处理的对象（A）">AI 圈选</button></div>
      <input type="file" accept="image/png,image/jpeg,image/webp" ref={file} hidden onChange={e=>{const image=e.target.files?.[0];if(image)void addImage(image).catch(error=>setMessage(errorMessage(error)));e.target.value='';}}/>
      {selectedNodes.length>0&&<div className={styles.toolGroup}><button onClick={duplicate} disabled={!selectedNodes.length||!canEdit}>复制</button><button onClick={remove} disabled={!unlocked.length||!canEdit}>删除</button>
        <button onClick={()=>layer(true)} disabled={!unlocked.length||!canEdit}>置顶</button><button onClick={()=>layer(false)} disabled={!unlocked.length||!canEdit}>置底</button>
        <select aria-label="对齐对象" value="" disabled={!unlocked.length||!canEdit} onChange={e=>align(e.target.value)}><option value="" disabled>对齐 ▾</option>
          <option value="left">左对齐</option><option value="center">水平居中</option><option value="right">右对齐</option><option value="top">顶端对齐</option><option value="middle">垂直居中</option><option value="bottom">底端对齐</option>
          <option value="inside-slide" disabled={!canMoveInside}>移入幻灯片</option></select>
        <select aria-label="分布对象" value="" disabled={unlocked.length<3||!canEdit} onChange={e=>distribute(e.target.value as 'h'|'v')}><option value="" disabled>分布 ▾</option>
          <option value="h">横向等距</option><option value="v">纵向等距</option></select></div>}
      {headerActionsHost ? createPortal(<button type="button" className={styles.headerSave}
          onClick={()=>void controller.save()} disabled={state.saving||reinteracting}>立即保存</button>, headerActionsHost)
          : <div className={styles.toolbarEnd}><button onClick={()=>void controller.save()} disabled={state.saving||reinteracting}>立即保存</button></div>}
    </div>
    {(state.error||message)&&<div className={styles.notice} role="alert">{state.error||message}
      {state.conflict?<><button onClick={()=>void recover('merge')}>合并最新修改</button><button onClick={()=>void recover('local')}>使用本机冲突项</button><button onClick={()=>void recover('server')}>放弃草稿并载入服务端</button></>:
        state.error?<button onClick={()=>void controller.save()}>重试同步</button>:null}<button onClick={()=>setMessage('')} aria-label="关闭提示">×</button></div>}
    <div className={styles.workspace}>
      <aside className={styles.rail}><div className={styles.tabs}><button aria-pressed={tab==='pages'} onClick={()=>setTab('pages')}>页面</button><button aria-pressed={tab==='layers'} onClick={()=>setTab('layers')}>图层</button>
        {tab==='pages'&&<button type="button" className={styles.addPage} aria-label="新建空白页" title="在当前页之后新建空白页"
          onClick={()=>selectPage(controller.addPage(page.page_no))} disabled={reinteracting}>＋</button>}</div>
        <div ref={rail} className={styles.railBody}>{tab==='pages'?document.pages.map((p,index)=>{
          const original=sourceFor(p);
          return <div key={p.page_no} className={styles.thumbWrap}>
            <button className={styles.thumbnail} aria-current={p.page_no===page.page_no?'page':undefined}
              aria-label={`编辑第 ${index+1} 页`} onClick={()=>selectPage(p.page_no)} draggable={!reinteracting}
              data-drop={dropPage===p.page_no}
              onContextMenu={e=>{e.preventDefault();selectPage(p.page_no);setPageMenuFor(p.page_no);}}
              onDragStart={e=>{draggedPage.current=p.page_no;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',String(p.page_no));}}
              onDragOver={e=>{if(draggedPage.current!==null&&draggedPage.current!==p.page_no){e.preventDefault();e.dataTransfer.dropEffect='move';setDropPage(p.page_no);}}}
              onDragLeave={e=>{if(!(e.relatedTarget instanceof Node)||!e.currentTarget.contains(e.relatedTarget))setDropPage(null);}}
              onDrop={e=>{e.preventDefault();const dragged=draggedPage.current;draggedPage.current=null;setDropPage(null);if(dragged!==null)controller.movePage(dragged,index);}}
              onDragEnd={()=>{draggedPage.current=null;setDropPage(null);}}>
              <div className={styles.thumbImage} style={{aspectRatio:`${p.width}/${p.height}`}}>{p.preparation?.status==='ready'&&(p.modified||!original?.image_url)?
                <div className={styles.thumbCanvas}><ScenePageView page={p} scale={148/p.width}/></div>:
                original?.image_url?<img src={original.image_url} alt="" loading="lazy" draggable={false}/>:null}</div>
              <span>{index+1}<b>{original?.title??`第 ${index+1} 页`}</b>{p.modified&&<i title="本页已改写自原稿"/>}</span>
            </button>
            <button type="button" className={styles.thumbOps} aria-label={`第 ${index+1} 页操作`} aria-expanded={pageMenuFor===p.page_no} data-page-menu
              onClick={e=>{e.stopPropagation();selectPage(p.page_no);setPageMenuFor(current=>current===p.page_no?null:p.page_no);}}>⋯</button>
            {pageMenuFor===p.page_no&&<div className={styles.thumbMenu} role="menu" data-page-menu>
              <button type="button" role="menuitem" disabled={reinteracting} onClick={()=>{setPageMenuFor(null);selectPage(controller.addPage(p.page_no,'lesson'));}}>插入教学版式</button>
              <button type="button" role="menuitem" disabled={reinteracting} onClick={()=>{setPageMenuFor(null);selectPage(controller.duplicatePage(p.page_no));}}>复制本页</button>
              <button type="button" role="menuitem" disabled={reinteracting||index===0} onClick={()=>{setPageMenuFor(null);controller.movePage(p.page_no,index-1);}}>向前移动</button>
              <button type="button" role="menuitem" disabled={reinteracting||index===document.pages.length-1} onClick={()=>{setPageMenuFor(null);controller.movePage(p.page_no,index+1);}}>向后移动</button>
              <button type="button" role="menuitem" disabled={reinteracting||document.pages.length===1} onClick={()=>{setPageMenuFor(null);removePage();}}>删除本页</button>
            </div>}
          </div>;
        }):[...page.nodes].filter(n=>!n.deleted).sort((a,b)=>b.z-a.z).map(node=>{const label=node.text?.trim().slice(0,20)||node.name;return <div className={styles.layerRow} key={node.id} data-selected={selected.includes(node.id)}>
            <button className={styles.layerSelect} aria-pressed={selected.includes(node.id)} onClick={e=>setSelected(e.shiftKey?[...new Set([...selected,node.id])]:[node.id])} title={node.text||node.name}>
              <span>{node.type==='text'?'T':node.type==='image'?'▧':node.type==='chart'?'▥':node.type==='table'?'▦':'◇'}</span>{label}</button>
            <button aria-label={`${node.hidden?'显示':'隐藏'}图层 ${label}`} onClick={()=>controller.patch(page.page_no,[node.id],{hidden:!node.hidden})} disabled={!canEdit}>{node.hidden?'◌':'◉'}</button>
            <button aria-label={`${node.locked?'解锁':'锁定'}图层 ${label}`} onClick={()=>controller.patch(page.page_no,[node.id],{locked:!node.locked})} disabled={!canEdit}>{node.locked?'🔒':'🔓'}</button>
          </div>;})}</div>
      </aside>
      <main className={styles.main}>
        {(separateDemos.length>0||(ready&&stage==='failed'))&&<div className={styles.canvasChips}>
          {separateDemos.length>0&&<button type="button" className={styles.retryLayers} onClick={()=>setDemoPage(page.page_no)}>独立演示</button>}
          {ready&&stage==='failed'&&<button className={styles.retryLayers} onClick={()=>setRetry(n=>n+1)}>重试复杂图层</button>}
        </div>}
        <div className={styles.viewport} ref={viewport} data-fit={zoom==='fit'} data-pan-ready={canPan&&(panMode||spaceHeld)} data-panning={panning}
          onPointerDown={panDown} onPointerMove={panMove} onPointerUp={panEnd} onPointerCancel={panEnd}>
          <div className={styles.workarea} data-comparing={reference}
            style={zoom==='fit'?undefined:{minWidth:displayWidth,minHeight:page.height*scale+80}}
            data-ai-mode={insertMode==='ai'}
            onPointerDownCapture={e=>{if(insertMode==='ai'||(e.target as Element).matches('[data-vector-select]')||
              (e.shiftKey&&(e.target as Element).closest('[data-node-id]')))begin(e);}}
            onPointerDown={e=>{if(insertMode!=='ai'&&!(e.target as Element).matches('[data-vector-select]')&&
              !(e.shiftKey&&(e.target as Element).closest('[data-node-id]')))begin(e);}}
            onPointerMove={move} onPointerUp={finishPointer} onDoubleClick={e=>{
              if(!canEdit||panMode||spaceRef.current||insertMode)return;
              const recent=lastTap.current;
              const id=(e.target as Element).closest<HTMLElement>('[data-node-id]')?.dataset.nodeId??
                (recent&&Date.now()-recent.time<500&&Math.hypot(e.clientX-recent.x,e.clientY-recent.y)<6?recent.id:undefined);
              const node=page.nodes.find(n=>n.id===id);
              if(node?.type==='text'&&!node.locked){setSelected([node.id]);setEditingId(node.id);}
            }}
            onLostPointerCapture={()=>{if(drag.current||drawing.current){drawing.current=null;setDrawBox(null);end(true);}}}
            onPointerCancel={()=>{drawing.current=null;setDrawBox(null);end(true);}}>
            {reference&&<figure className={styles.referenceFigure} onPointerDown={event=>event.stopPropagation()}>
              <figcaption>原稿</figcaption>
              <div className={styles.frame} style={{width:page.width*scale,height:page.height*scale}}>
                <img className={styles.original} src={source?.image_url??undefined} alt={`第 ${pageIndex+1} 页原稿`} draggable={false}/>
              </div>
            </figure>}
            <div ref={frame} className={styles.frame} style={{width:page.width*scale,height:page.height*scale}} aria-label={`可编辑画布第 ${pageIndex+1} 页`}>
              {reference&&<div className={styles.referenceLabel}>编辑稿</div>}
              {!ready?(source?.image_url?<img className={styles.original} src={source.image_url} alt={`第 ${pageIndex+1} 页原稿预览`} draggable={false}/>:null):
                <ScenePageView page={page} scale={scale} editing={canEdit} proofFigures={proofFigures} editingId={editingId} preview={preview} onText={onText} onCompose={onCompose} onTextBlur={closeText} vectorId={primary?.id}
                  onVectorSelect={id=>{setSelected(ids=>ids.includes(id)?ids:[id]);setEditingId(null);}}
                  generating={generating} onGenerateDemo={id=>void generateNode(id,'demo')}
                  onVectorPatch={(id, patch,key)=>{
                    if(key==='workshop-preview'&&patch.workshop_plugin)controller.cacheWorkshopPreview(page.page_no,id,patch.workshop_plugin);
                    else controller.patch(page.page_no,[id],patch,key?`${id}.${key}`:'');
                  }}>
                  {guides.x!==undefined&&<div className={styles.guideX} style={{left:guides.x}}/>}{guides.y!==undefined&&<div className={styles.guideY} style={{top:guides.y}}/>}
                  {guides.gaps?.map(({axis,from,to,cross},index)=><div key={index} className={styles.gapGuide} data-axis={axis}
                    style={axis==='x'?{left:from,top:cross,width:to-from}:{left:cross,top:from,height:to-from}}/>)}
                  {(drawBox??aiBox)&&<div className={styles.drawBox} style={{...(drawBox??aiBox),borderWidth:1/scale}}/>}
                  {box&&(shown.length>1||primary?.type!=='vector')&&!separateDemos.some(node=>shown.length===1&&node.id===primary?.id)&&<div className={styles.selection} style={{left:box.x,top:box.y,width:box.width,height:box.height,
                    transform:shown.length===1?`rotate(${shown[0]!.rotation}deg)`:undefined,borderWidth:1/scale}}>
                    {canTransform&&!drawBox&&insertMode!=='ai'&&<>
                      {['nw','n','ne','e','se','s','sw','w'].map(direction=><span key={direction} role="button" aria-label={`缩放手柄 ${direction}`} data-handle={direction}
                        className={styles.handle} data-direction={direction} style={{width:9/scale,height:9/scale,borderWidth:1/scale}}/>)}
                      <span className={styles.rotationLine} style={{height:24/scale,top:-24/scale}}/><span role="button" aria-label="旋转手柄" data-handle="rotate" className={styles.rotateHandle}
                        style={{top:-33/scale,width:12/scale,height:12/scale,borderWidth:1/scale}}/>
                    </>}
                  </div>}
                </ScenePageView>}
              {aiBox&&!drawBox&&<div role="group" aria-label="选区 AI 操作" className={styles.aiActions} data-editor-control
                data-above={aiBox.y+aiBox.height>page.height*.65}
                style={{left:Math.min(Math.max(aiInset,(aiBox.x+aiBox.width/2)*scale),page.width*scale-aiInset),
                  top:(aiBox.y+aiBox.height>page.height*.65?Math.max(0,aiBox.y):Math.min(page.height,aiBox.y+aiBox.height))*scale}}>
                <div>
                  {canVectorize&&<button type="button" onClick={()=>{setFigureTarget(primary.id);closeAI();setInsertMode(null);}}>图片矢量化</button>}
                  <button type="button" disabled={!canEdit||!online} onClick={openDemo}>生成 AI 演示</button>
                  <button type="button" disabled={!canEdit||!online||!selectedNodes.length} aria-expanded={aiRelations} onClick={()=>setAIRelations(open=>!open)}>添加联动关系</button>
                  <button type="button" aria-label="关闭选区 AI 操作" onClick={()=>{closeAI();setInsertMode(null);}}>×</button>
                </div>
                {aiRelations&&<form onSubmit={e=>{e.preventDefault();void generateAIRelations();}}>
                  <label>描述对象如何联动<input autoFocus value={aiInstruction} onChange={e=>setAIInstruction(e.target.value)} maxLength={500} required/></label>
                  <button type="submit" disabled={aiPending||!aiInstruction.trim()}>{aiPending?'正在生成…':'生成关系预览'}</button>
                  {aiSuggestion&&<div>
                    <p>{aiSuggestion.summary}</p>
                    {aiSuggestion.warnings.map(warning=><p key={warning}>{warning}</p>)}
                    <button type="button" disabled={!aiSuggestion.relations.length} onClick={()=>{
                      const error=applyRelationSuggestion(aiSuggestion);
                      if(error)setMessage(error);else{closeAI();setInsertMode(null);}
                    }}>应用 {aiSuggestion.relations.length} 条关系</button>
                  </div>}
                </form>}
              </div>}
            </div>
          </div>
        </div>
        {!ready&&<div className={styles.preparing} role="status">{status==='failed'?page.preparation?.message??'本页对象准备失败':'正在准备本页可编辑对象，首次需要几秒；后续输入和拖动即时显示。'}
          {status==='failed'&&<button onClick={()=>setRetry(n=>n+1)}>重新准备本页</button>}</div>}
      </main>
      <NodeProperties node={primary} count={selectedNodes.length} pageNodes={page.nodes}
        pageRelations={page.relations} onRelationsChange={(relations,key)=>controller.patchRelations(page.page_no,relations,key)}
        onSuggestRelations={online&&canEdit?suggestRelations:undefined}
        onApplyRelationSuggestion={canEdit?applyRelationSuggestion:undefined}
        generating={!!(primary&&generating[primary.id])} onDemoGenerate={()=>primary&&void generateNode(primary.id,'demo')}
        onVectorize={canVectorize?()=>setFigureTarget(primary.id):undefined}
        figureCount={primary?.cleaned_asset_id?countFigureObjects(page.nodes.filter(node=>!node.deleted&&node.figure_source_id===primary.id)):undefined}
        onDiagramBuild={(text,ai)=>primary?generateNode(primary.id,'diagram',text,ai):undefined}
        pageMeta={{notes:page.notes??'',backgroundColor:page.background_color??'#ffffff',backgroundModified:!!page.background_modified}}
        onPatchPage={patchValue=>controller.patchPage(page.page_no,patchValue)}
        onInsertPlugin={canEdit?()=>setPluginPickerOpen(true):undefined}
        onInsertDemo={canEdit?()=>armInsert('demo'):undefined}
        disabled={!canEdit||!!(primary&&page.preparation?.frozen_ids?.includes(primary.id))}
        onPatch={patch} onDuplicate={duplicate} onDelete={remove}/>
    </div>
    <footer className={styles.footer}><span>拖动空白处框选 · Shift 增减选 · Alt 暂停吸附 · 空格/中键平移 · Ctrl+Z 撤销</span>
      <div><button disabled={pageIndex===0} onClick={()=>{const previous=document.pages[pageIndex-1];if(previous)selectPage(previous.page_no);}}>上一页</button><span>{pageIndex+1} / {document.pages.length}</span>
        <button disabled={!nextPage} onClick={()=>{if(nextPage)selectPage(nextPage.page_no);}}>下一页</button></div>
      <div className={styles.footerTools}>
        <button aria-pressed={reference} disabled={!source?.image_url} onClick={()=>{setReference(!reference);setEditingId(null);closeAI();}}>原稿对照</button>
        {hasAppliedFigures&&<button aria-pressed={proofFigures} onClick={()=>setProofFigures(value=>!value)}>图示校对</button>}
        <button aria-pressed={panMode} title="放大后拖动画布；也可按住空格或鼠标中键拖动" onClick={()=>{setPanMode(value=>!value);setEditingId(null);}}>平移</button>
        <ZoomControl className={styles.zoomControl} value={zoom} fitValue={fit} min={.25} max={4} step={.1} onChange={setZoom}/>
        <span className={styles.sync} data-error={!!state.error||!online} data-dirty={state.dirty&&!state.saving} role="status" aria-live="polite">{syncText}</span>
      </div></footer>
    {demoPage===page.page_no&&separateDemos.length>0&&<StandaloneDemoDialog nodes={separateDemos} initialId={primary?.id} editing={canEdit}
      onPatch={(id,patch,key)=>{if(canEdit)controller.patch(page.page_no,[id],patch,key?`${id}.${key}`:'');}}
      onClose={()=>setDemoPage(null)}/>}
    {figureNode&&<FigureVectorizationDialog key={`${page.page_no}:${figureNode.id}`} materialId={materialId} pageNo={page.page_no} node={figureNode} controller={controller}
      onClose={()=>setFigureTarget(null)} onApplied={count=>{setProofFigures(false);setMessage(`已应用 ${count} 个图示对象，可撤销或选择对象继续编辑。`);}} onManual={addVector}/>}
    {pluginPickerOpen&&canEdit&&<WorkshopPluginPicker key={page.page_no} onSelect={addWorkshopPlugin} onClose={()=>setPluginPickerOpen(false)}/>}
  </div>;
}
