import {useCallback,useEffect,useRef,useState,useSyncExternalStore,type PointerEvent as ReactPointerEvent} from 'react';
import {useNavigate,useSearchParams,Link} from 'react-router-dom';
import {useQueryClient} from '@tanstack/react-query';
import type {MaterialDetail} from '@/api/types';
import {getDocument,prepareDocumentPage,reinteractDocumentPage,createSceneDiagram} from '@/api/documents';
import {createPageLab} from '@/api/pptAI';
import {errorMessage} from '@/api/client';
import {useScopedQueryKeys} from '@/api/queryKeys';
import type {DocumentController} from '@/document/controller';
import {newNode,patchNodes,distributeNodes} from '@/document/model';
import {resolveMatrixSource} from '@/document/mathScene';
import type {SceneNode,NodePatch,NodeInteraction} from '@/document/types';
import type {ISpec} from '@/ispec/types';
import {ZoomControl} from '@/components/ui/ZoomControl';
import {fitZoom,wheelZoom} from '@/components/ui/zoom';
import {ScenePageView} from './ScenePageView';
import {FigureVectorizationDialog} from './FigureVectorizationDialog';
import {NodeProperties} from './NodeProperties';
import styles from './FreeDeckEditor.module.css';

interface Props {materialId:string;controller:DocumentController;material:MaterialDetail;}
interface Drag {kind:'move'|'resize'|'rotate';direction:string;startX:number;startY:number;nodes:SceneNode[];box:{x:number;y:number;width:number;height:number};preview:Record<string,Partial<SceneNode>>;}
const identifier=()=>`u_${crypto.randomUUID().replaceAll('-','')}`;
const round=(n:number)=>Math.round(n*100)/100;
const bounds=(nodes:SceneNode[])=>{const x=Math.min(...nodes.map(n=>n.x)),y=Math.min(...nodes.map(n=>n.y));return {x,y,width:Math.max(...nodes.map(n=>n.x+n.width))-x,height:Math.max(...nodes.map(n=>n.y+n.height))-y};};
const countFigureObjects=(nodes:SceneNode[])=>new Set(nodes.map(node=>`${node.figure_source_id}:${node.figure_object_id??node.id}`)).size;

export function FreeDeckEditor({materialId,controller,material}:Props){
  const state=useSyncExternalStore(controller.subscribe,controller.getSnapshot);const document=state.document;
  const [query,setQuery]=useSearchParams();const navigate=useNavigate();const pageNo=Number(query.get('page')??1);
  const queryClient=useQueryClient();
  // 材料详情缓存键带账号 scope：退出/切换账号时由 bootstrap 的 scope 监听统一清理
  const keys=useScopedQueryKeys();
  const page=document.pages.find(p=>p.page_no===pageNo)??document.pages[0]!;
  const [selected,setSelected]=useState<string[]>([]);const [editingId,setEditingId]=useState<string|null>(null);
  const [preview,setPreview]=useState<Record<string,Partial<SceneNode>>>({});const [guides,setGuides]=useState<{x?:number;y?:number}>({});
  const [tab,setTab]=useState<'pages'|'layers'>('pages');const [zoom,setZoom]=useState<number|'fit'>('fit');
  const [insertMode,setInsertMode]=useState<'diagram'|'demo'|null>(null);
  const drawing=useRef<{x:number;y:number}|null>(null);
  const [drawBox,setDrawBox]=useState<{x:number;y:number;width:number;height:number}|null>(null);
  const [generating,setGenerating]=useState<Record<string,boolean>>({});
  const currentPage=useRef(page.page_no);currentPage.current=page.page_no;
  const mounted=useRef(true);useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const [panMode,setPanMode]=useState(false);const [spaceHeld,setSpaceHeld]=useState(false);const spaceRef=useRef(false);
  const [panning,setPanning]=useState(false);const panRef=useRef<{x:number;y:number;left:number;top:number}|null>(null);
  const [reference,setReference]=useState(false);const [retry,setRetry]=useState(0);const [message,setMessage]=useState('');const [leaving,setLeaving]=useState(false);
  const [proofFigures,setProofFigures]=useState(false);
  const [figureTarget,setFigureTarget]=useState<{pageNo:number;nodeId:string}|null>(null);
  const [reinteracting,setReinteracting]=useState(false);const [online,setOnline]=useState(()=>typeof navigator==='undefined'||navigator.onLine);
  const viewport=useRef<HTMLDivElement>(null);const frame=useRef<HTMLDivElement>(null);const drag=useRef<Drag|null>(null);const file=useRef<HTMLInputElement>(null);
  const lastTap=useRef<{id:string;time:number;x:number;y:number}|null>(null);
  const [area,setArea]=useState({width:1050,height:680});const status=page.preparation?.status??'unprepared';
  const nextPage=document.pages.find(p=>p.page_no===page.page_no+1);
  const nextStatus=nextPage?.preparation?.status??'none';
  const ready=status==='ready';const canEdit=ready&&!reference&&!leaving&&!reinteracting;
  const fit=fitZoom(area,page,80,.15,1.7);
  const scale=zoom==='fit'?fit:zoom;
  const canPan=page.width*scale+80>area.width+1||page.height*scale+80>area.height+1;
  const source=material.slides.find(p=>p.page_no===page.page_no);
  const selectedNodes=page.nodes.filter(n=>selected.includes(n.id)&&!n.deleted);const primary=selectedNodes[0]??null;
  const unlocked=selectedNodes.filter(n=>!n.locked&&!page.preparation?.frozen_ids?.includes(n.id));
  const vectorized=page.nodes.filter(node=>!node.deleted&&node.figure_source_id);
  const hasAppliedFigures=page.nodes.some(node=>node.cleaned_asset_id&&!node.deleted);
  const figureNode=figureTarget?.pageNo===page.page_no&&figureTarget.nodeId===primary?.id&&selectedNodes.length===1?primary:null;
  const canVectorize=canEdit&&online&&selectedNodes.length===1&&primary?.type==='image'&&!primary.hidden&&!primary.cleaned_asset_id&&
    !primary.matrix_ocr&&!page.preparation?.frozen_ids?.includes(primary.id);
  const shown=selectedNodes.filter(n=>!n.hidden).map(n=>preview[n.id]?{...n,...preview[n.id]}:n);
  const box=shown.length?bounds(shown):null;
  useEffect(()=>{const node=viewport.current;if(!node)return;const observer=new ResizeObserver(()=>setArea({width:node.clientWidth,height:node.clientHeight}));observer.observe(node);return()=>observer.disconnect();},[]);
  useEffect(()=>{
    const node=viewport.current;if(!node)return;
    const onWheel=(event:WheelEvent)=>{
      if(!(event.ctrlKey||event.metaKey))return;
      event.preventDefault();
      setZoom(current=>wheelZoom(current==='fit'?fit:current,event.deltaY));
    };
    node.addEventListener('wheel',onWheel,{passive:false});
    return()=>node.removeEventListener('wheel',onWheel);
  },[fit]);
  useEffect(()=>{
    const editable=(target:EventTarget|null)=>target instanceof Element&&!!target.closest('input,textarea,select,button,a,summary,[contenteditable=true]');
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
  useEffect(()=>{setSelected([]);setEditingId(null);setPreview({});setReference(false);setInsertMode(null);setDrawBox(null);drawing.current=null;},[page.page_no]);
  useEffect(()=>{if(figureTarget&&!figureNode)setFigureTarget(null);},[figureNode,figureTarget]);
  useEffect(()=>{
    if(status==='ready')return;
    let alive=true;let timer:ReturnType<typeof setTimeout>|undefined;
    const poll=async()=>{try{const remote=await getDocument(materialId);if(!alive)return;controller.updateAssets(remote);
      if(remote.pages.find(p=>p.page_no===page.page_no)?.preparation?.status!=='ready')timer=setTimeout(()=>void poll(),1000);
    }catch(error){if(alive){setMessage(errorMessage(error));timer=setTimeout(()=>void poll(),2500);}}};
    if(status==='unprepared'||(status==='failed'&&retry))void prepareDocumentPage(materialId,page.page_no).then(()=>void poll()).catch(error=>setMessage(errorMessage(error)));
    else if(status==='queued'||status==='preparing')timer=setTimeout(()=>void poll(),700);
    return()=>{alive=false;clearTimeout(timer);};
  },[materialId,page.page_no,status,retry,controller]);
  // 当前页就绪后，悄悄把下一页的对象也准备好：翻页时基本不用再等。
  useEffect(()=>{
    if(status!=='ready'||nextStatus==='ready'||nextStatus==='preparing'||nextStatus==='none')return;
    const timer=setTimeout(()=>{void prepareDocumentPage(materialId,page.page_no+1).catch(()=>{});},900);
    return ()=>clearTimeout(timer);
  },[materialId,page.page_no,status,nextStatus]);
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
  const add=(type:'text'|'shape'|'math_scene',shape:'rect'|'ellipse'='rect')=>{
    if(!canEdit)return;const node={...newNode(page,identifier(),type),shape};controller.add(page.page_no,node);setSelected([node.id]);if(type==='text')setEditingId(node.id);
  };
  const addVector = (arrow: boolean) => {
    if (!canEdit) return;
    const node = newNode(page, identifier(), 'vector');
    node.y += (page.nodes.filter(item => item.type === 'vector' && !item.deleted).length % 5) * 22;
    node.style.arrow_end = arrow;
    controller.add(page.page_no, node);
    setSelected([node.id]);
    setEditingId(null);
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
      if(!mounted.current)return;
      const latest=controller.getSnapshot().document.pages.find(p=>p.page_no===pageNo)?.nodes.find(n=>n.id===id);
      if(currentPage.current!==pageNo||!latest||latest.deleted||latest.locked||JSON.stringify(kind==='demo'?latest.demo:latest.diagram)!==content){
        setMessage('生成已完成，原对象已变更；请回到目标图框后重新应用。');return;
      }
      controller.patch(pageNo,[id],patch);setMessage('已生成到当前图框，可直接演示。');
    }catch(error){if(mounted.current)setMessage(errorMessage(error));}
    finally{if(mounted.current)setGenerating(current=>({...current,[id]:false}));}
  };
  const armInsert=(kind:'diagram'|'demo')=>{setInsertMode(current=>current===kind?null:kind);setPanMode(false);setSelected([]);setEditingId(null);setMessage('在幻灯片上拖出图框；按 Esc 取消。');};
  const addImage=async(image:File)=>{
    if(!['image/png','image/jpeg','image/webp'].includes(image.type)||image.size>4*1024*1024){setMessage('请选择4MB以内的PNG、JPEG或WebP图片');return;}
    const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(reader.error);reader.readAsDataURL(image);});
    const bitmap=await createImageBitmap(image);const width=Math.min(page.width*.5,400),height=width*bitmap.height/bitmap.width;bitmap.close();
    const node={...newNode(page,identifier(),'image'),image_data:data,width,height,text:''};controller.add(page.page_no,node);setSelected([node.id]);
  };
  const align=(mode:string)=>{
    if(!canEdit||!unlocked.length)return;
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
    if(!canEdit||e.button!==0||(e.target as Element).closest('textarea,input,select'))return;
    if(insertMode){const start=point(e);drawing.current={x:Math.max(0,Math.min(page.width,start.x)),y:Math.max(0,Math.min(page.height,start.y))};
      setDrawBox({...drawing.current,width:0,height:0});e.preventDefault();e.stopPropagation();e.currentTarget.setPointerCapture(e.pointerId);return;}
    const handle=(e.target as Element).closest<HTMLElement>('[data-handle]')?.dataset.handle;
    const id=(e.target as Element).closest<HTMLElement>('[data-node-id]')?.dataset.nodeId;
    let nodes=unlocked;
    if(!handle){
      if(!id){setSelected([]);setEditingId(null);return;}
      const node=page.nodes.find(n=>n.id===id);if(!node)return;
      const prior=lastTap.current;
      if(node.type==='text'&&!node.locked&&prior?.id===id&&Date.now()-prior.time<450&&Math.hypot(e.clientX-prior.x,e.clientY-prior.y)<6){
        e.preventDefault();drag.current=null;lastTap.current=null;setSelected([id]);setEditingId(id);return;
      }
      lastTap.current={id,time:Date.now(),x:e.clientX,y:e.clientY};
      let ids=selected;
      if(e.shiftKey){ids=selected.includes(id)?selected.filter(n=>n!==id):[...selected,id];setSelected(ids);}
      else if(!selected.includes(id)){ids=[id];setSelected(ids);}
      nodes=page.nodes.filter(n=>ids.includes(n.id)&&!n.locked&&!n.hidden&&!n.deleted&&!page.preparation?.frozen_ids?.includes(n.id));
      if(!nodes.length)return;
    }
    setEditingId(null);e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);
    const start=point(e);drag.current={kind:handle==='rotate'?'rotate':handle?'resize':'move',direction:handle??'',startX:start.x,startY:start.y,nodes,box:bounds(nodes),preview:{}};
  };
  const move=(e:ReactPointerEvent<HTMLDivElement>)=>{
    if(drawing.current){const start=drawing.current,now=point(e),x=Math.max(0,Math.min(page.width,now.x)),y=Math.max(0,Math.min(page.height,now.y));
      setDrawBox({x:Math.min(start.x,x),y:Math.min(start.y,y),width:Math.abs(x-start.x),height:Math.abs(y-start.y)});return;}
    const active=drag.current;if(!active)return;
    const current=point(e);let dx=current.x-active.startX,dy=current.y-active.startY;const result:Record<string,Partial<SceneNode>>={};const lines:{x?:number;y?:number}={};
    if(Math.hypot(dx,dy)>4)lastTap.current=null;
    if(active.kind==='move'){
      if(!e.altKey){
        const others=page.nodes.filter(n=>!active.nodes.some(a=>a.id===n.id)&&!n.hidden&&!n.deleted&&!n.locked).slice(0,150);
        const xs=[0,page.width/2,page.width,...others.flatMap(n=>[n.x,n.x+n.width/2,n.x+n.width])];
        const ys=[0,page.height/2,page.height,...others.flatMap(n=>[n.y,n.y+n.height/2,n.y+n.height])];
        let bestX=6/scale,bestY=6/scale;
        for(const target of xs)for(const origin of [active.box.x,active.box.x+active.box.width/2,active.box.x+active.box.width])if(Math.abs(target-origin-dx)<bestX){bestX=Math.abs(target-origin-dx);lines.x=target;dx=target-origin;}
        for(const target of ys)for(const origin of [active.box.y,active.box.y+active.box.height/2,active.box.y+active.box.height])if(Math.abs(target-origin-dy)<bestY){bestY=Math.abs(target-origin-dy);lines.y=target;dy=target-origin;}
      }
      for(const node of active.nodes)result[node.id]={x:round(node.x+dx),y:round(node.y+dy)};
    }else{
      const node=active.nodes[0]!;const angle=node.rotation*Math.PI/180,cx=node.x+node.width/2,cy=node.y+node.height/2;
      if(active.kind==='rotate'){
        const start=Math.atan2(active.startY-cy,active.startX-cx),end=Math.atan2(current.y-cy,current.x-cx);
        const rotation=node.rotation+(end-start)*180/Math.PI;result[node.id]={rotation:e.shiftKey?Math.round(rotation/15)*15:round(rotation)};
      }else{
        const localX=dx*Math.cos(angle)+dy*Math.sin(angle),localY=-dx*Math.sin(angle)+dy*Math.cos(angle);const direction=active.direction;
        let width=Math.max(5,node.width+(direction.includes('e')?localX:direction.includes('w')?-localX:0));
        let height=Math.max(5,node.height+(direction.includes('s')?localY:direction.includes('n')?-localY:0));
        if(e.shiftKey&&direction.length===2){const factor=Math.max(width/node.width,height/node.height);width=node.width*factor;height=node.height*factor;}
        const shiftX=direction.includes('w')?-(width-node.width)/2:direction.includes('e')?(width-node.width)/2:0;
        const shiftY=direction.includes('n')?-(height-node.height)/2:direction.includes('s')?(height-node.height)/2:0;
        result[node.id]={width:round(width),height:round(height),x:round(cx+shiftX*Math.cos(angle)-shiftY*Math.sin(angle)-width/2),y:round(cy+shiftX*Math.sin(angle)+shiftY*Math.cos(angle)-height/2)};
      }
    }
    active.preview=result;setPreview(result);setGuides(lines);
  };
  const end=(cancel=false)=>{
    const active=drag.current;if(!active)return;drag.current=null;
    if(!cancel){let next=controller.getSnapshot().document;for(const [id,value]of Object.entries(active.preview))next=patchNodes(next,page.page_no,[id],value);controller.replace(next);}
    setPreview({});setGuides({});
  };
  useEffect(()=>{
    const key=(e:KeyboardEvent)=>{
      if(figureNode)return;
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();void controller.save();return;}
      if((e.target as Element)?.closest('input,textarea,select,[contenteditable=true]'))return;
      if(e.key==='Escape'){setEditingId(null);setSelected([]);setInsertMode(null);setDrawBox(null);drawing.current=null;return;}
      if(!canEdit)return;
      if(e.key==='Enter'&&primary?.type==='text'&&!primary.locked){e.preventDefault();setEditingId(primary.id);return;}
      if((e.ctrlKey||e.metaKey)&&['z','y'].includes(e.key.toLowerCase())){e.preventDefault();e.shiftKey||e.key.toLowerCase()==='y'?controller.redo():controller.undo();return;}
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='d'){e.preventDefault();duplicate();return;}
      if(e.key==='Delete'||e.key==='Backspace'){if(selected.length){e.preventDefault();remove();}return;}
      const delta=e.shiftKey?10:1;const value=e.key==='ArrowLeft'?[-delta,0]:e.key==='ArrowRight'?[delta,0]:e.key==='ArrowUp'?[0,-delta]:e.key==='ArrowDown'?[0,delta]:null;
      if(value&&unlocked.length){e.preventDefault();let next=controller.getSnapshot().document;for(const node of unlocked)next=patchNodes(next,page.page_no,[node.id],{x:node.x+value[0]!,y:node.y+value[1]!});controller.replace(next,'keyboard.move');}
    };
    window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
  });
  const finish=async()=>{
    setLeaving(true);setEditingId(null);
    if(!await controller.save()){setLeaving(false);return;}
    // 材料详情缓存了 30 秒（全局 staleTime），不主动失效的话，返回演示页会继续显示改之前的排版。
    await queryClient.invalidateQueries({queryKey:keys.material(materialId)});
    navigate(`/materials/${materialId}/work?page=${page.page_no}`);
  };
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
      setMessage(`第 ${page.page_no} 页已按当前内容重新提取${result.refreshed_user_interactions?`，并恢复 ${result.refreshed_user_interactions} 个用户公式`:''}。位置和样式修改仍保留。`);
    }catch(error){setMessage(errorMessage(error));}
    finally{setReinteracting(false);}
  };
  const restoreContent=()=>{
    if(!canEdit||!primary?.source_element_id)return;
    const patch:NodePatch={};
    if(primary.text!==primary.base_text)patch.text=primary.base_text??'';
    if(JSON.stringify(primary.table)!==JSON.stringify(primary.base_table))patch.table=primary.base_table;
    if(JSON.stringify(primary.chart)!==JSON.stringify(primary.base_chart))patch.chart=primary.base_chart;
    if(!Object.keys(patch).length)return;
    controller.patch(page.page_no,[primary.id],patch,'restore.content');
    setMessage('已恢复这段内容为原稿；依赖它的自动交互会在演示页重新启用。');
  };
  const onText=useCallback((id:string,text:string)=>controller.patch(page.page_no,[id],{text},`text.${id}`),[controller,page.page_no]);
  const onCompose=useCallback((active:boolean)=>controller.setComposing(active),[controller]);
  const closeText=useCallback(()=>setEditingId(null),[]);

  return <div className={styles.editor} data-free-editor>
    <header className={styles.header}><Link to="/" className={styles.brand}>万象<span>自由编辑</span></Link>
      <div className={styles.documentTitle}><h1>{document.title}</h1><span>{document.pages.length} 页 · 网页文档</span></div>
      <span className={styles.sync} data-error={!!state.error||!online} data-dirty={state.dirty&&!state.saving} role="status" aria-live="polite">{syncText}</span>
      <button onClick={()=>void controller.save()} disabled={state.saving||leaving}>立即保存</button>
      <button className={styles.primary} onClick={()=>void finish()} disabled={leaving}>{leaving?'正在同步…':'保存并返回演示'}</button>
    </header>
    <div className={styles.toolbar}>
      <div className={styles.toolGroup}><button aria-label="撤销编辑" title="Ctrl+Z" onClick={()=>controller.undo()} disabled={!state.canUndo||!canEdit}>↶ 撤销</button>
        <button aria-label="重做编辑" title="Ctrl+Shift+Z" onClick={()=>controller.redo()} disabled={!state.canRedo||!canEdit}>↷ 重做</button></div>
      <div className={styles.toolGroup}><button onClick={()=>add('text')} disabled={!canEdit}>＋ 文字</button><button onClick={()=>file.current?.click()} disabled={!canEdit}>＋ 图片</button>
        <button onClick={()=>add('shape')} disabled={!canEdit}>□ 矩形</button><button onClick={()=>add('shape','ellipse')} disabled={!canEdit}>○ 椭圆</button></div>
      <div className={styles.toolGroup}><button onClick={()=>addVector(false)} disabled={!canEdit}>＋ 线条</button><button onClick={()=>addVector(true)} disabled={!canEdit}>＋ 箭头</button></div>
      <div className={styles.toolGroup}><button onClick={()=>add('math_scene')} disabled={!canEdit}>＋ 数学图</button></div>
      <div className={styles.toolGroup}><button aria-pressed={insertMode==='diagram'} onClick={()=>armInsert('diagram')} disabled={!canEdit}>＋ 流程图</button>
        <button aria-pressed={insertMode==='demo'} onClick={()=>armInsert('demo')} disabled={!canEdit}>＋ AI 演示框</button></div>
      <input type="file" accept="image/png,image/jpeg,image/webp" ref={file} hidden onChange={e=>{const image=e.target.files?.[0];if(image)void addImage(image).catch(error=>setMessage(errorMessage(error)));e.target.value='';}}/>
      <div className={styles.toolGroup}><button onClick={duplicate} disabled={!selectedNodes.length||!canEdit}>复制</button><button onClick={remove} disabled={!unlocked.length||!canEdit}>删除</button>
        <button onClick={()=>layer(true)} disabled={!unlocked.length||!canEdit}>置顶</button><button onClick={()=>layer(false)} disabled={!unlocked.length||!canEdit}>置底</button>
        <select aria-label="对齐对象" value="" disabled={!unlocked.length||!canEdit} onChange={e=>align(e.target.value)}><option value="" disabled>对齐 ▾</option>
          <option value="left">左对齐</option><option value="center">水平居中</option><option value="right">右对齐</option><option value="top">顶端对齐</option><option value="middle">垂直居中</option><option value="bottom">底端对齐</option></select>
        <select aria-label="分布对象" value="" disabled={unlocked.length<3||!canEdit} onChange={e=>distribute(e.target.value as 'h'|'v')}><option value="" disabled>分布 ▾</option>
          <option value="h">横向等距</option><option value="v">纵向等距</option></select></div>
      <div className={styles.toolbarEnd}><button aria-pressed={reference} onClick={()=>{setReference(!reference);setEditingId(null);}}>原稿对照</button>
        {hasAppliedFigures&&<button aria-pressed={proofFigures} disabled={reference}
          onClick={()=>setProofFigures(value=>!value)} title="显示半透明原图和矢量对象">图示校对</button>}
        <button aria-pressed={panMode} title="放大后拖动画布；也可按住空格或鼠标中键拖动" onClick={()=>{setPanMode(value=>!value);setEditingId(null);}}>平移</button>
        <ZoomControl className={styles.zoomControl} value={zoom} fitValue={fit} min={.15} max={4} step={.1} onChange={setZoom}/></div>
    </div>
    {(state.error||message)&&<div className={styles.notice} role="alert">{state.error||message}
      {state.conflict?<><button onClick={()=>void recover('merge')}>合并最新修改</button><button onClick={()=>void recover('local')}>使用本机冲突项</button><button onClick={()=>void recover('server')}>放弃草稿并载入服务端</button></>:
        state.error?<button onClick={()=>void controller.save()}>重试同步</button>:null}<button onClick={()=>setMessage('')} aria-label="关闭提示">×</button></div>}
    <div className={styles.workspace}>
      <aside className={styles.rail}><div className={styles.tabs}><button aria-pressed={tab==='pages'} onClick={()=>setTab('pages')}>页面</button><button aria-pressed={tab==='layers'} onClick={()=>setTab('layers')}>图层</button></div>
        <div className={styles.railBody}>{tab==='pages'?document.pages.map(p=><button key={p.page_no} className={styles.thumbnail} aria-current={p.page_no===page.page_no?'page':undefined}
          aria-label={`编辑第 ${p.page_no} 页`} onClick={()=>setQuery({page:String(p.page_no)},{replace:true})}>
          <div className={styles.thumbImage} style={{aspectRatio:`${p.width}/${p.height}`}}>{p.modified&&p.preparation?.status==='ready'?<ScenePageView page={p} scale={148/p.width}/>:<img src={material.slides.find(s=>s.page_no===p.page_no)?.image_url??''} alt="" loading="lazy"/>}</div>
          <span>{p.page_no}<b>{material.slides.find(s=>s.page_no===p.page_no)?.title??`第 ${p.page_no} 页`}</b>{p.modified&&<i/>}</span></button>):[...page.nodes].filter(n=>!n.deleted).sort((a,b)=>b.z-a.z).map(node=><div className={styles.layerRow} key={node.id} data-selected={selected.includes(node.id)}>
            <button className={styles.layerSelect} aria-pressed={selected.includes(node.id)} onClick={e=>setSelected(e.shiftKey?[...new Set([...selected,node.id])]:[node.id])} title={node.text||node.name}>
              <span>{node.type==='text'?'T':node.type==='image'?'▧':node.type==='chart'?'▥':node.type==='table'?'▦':'◇'}</span>{node.text?.slice(0,20)||node.name}</button>
            <button aria-label={`${node.hidden?'显示':'隐藏'}图层 ${node.name}`} onClick={()=>controller.patch(page.page_no,[node.id],{hidden:!node.hidden})} disabled={!canEdit}>{node.hidden?'◌':'◉'}</button>
            <button aria-label={`${node.locked?'解锁':'锁定'}图层 ${node.name}`} onClick={()=>controller.patch(page.page_no,[node.id],{locked:!node.locked})} disabled={!canEdit}>{node.locked?'▣':'◇'}</button>
          </div>)}</div>
      </aside>
      <main className={styles.main}><div className={styles.pageHeading}><span>第 {page.page_no} 页</span><b>{source?.title??document.title}</b>
        {vectorized.length>0&&<span>已矢量化 {countFigureObjects(vectorized)} 个对象</span>}
        <span>{reference?'原稿对照':proofFigures&&hasAppliedFigures?'图示校对':`${Math.round(scale*100)}%`}</span></div>
        <div className={styles.viewport} ref={viewport} data-pan-ready={canPan&&(panMode||spaceHeld)} data-panning={panning}
          onPointerDown={panDown} onPointerMove={panMove} onPointerUp={panEnd} onPointerCancel={panEnd}>
          <div className={styles.workarea} style={{minWidth:page.width*scale+80,minHeight:page.height*scale+80}}>
            <div ref={frame} className={styles.frame} style={{width:page.width*scale,height:page.height*scale}} onPointerDown={begin} onPointerMove={move}
              onPointerUp={()=>{if(drawing.current&&insertMode&&drawBox){const node=newNode(page,identifier(),insertMode);
                const width=drawBox.width>=80?Math.max(160,drawBox.width):node.width,height=drawBox.height>=60?Math.max(120,drawBox.height):node.height;
                Object.assign(node,{x:Math.max(0,Math.min(page.width-width,drawBox.x)),y:Math.max(0,Math.min(page.height-height,drawBox.y)),width:Math.min(page.width,width),height:Math.min(page.height,height)});
                controller.add(page.page_no,node);setSelected([node.id]);drawing.current=null;setDrawBox(null);setInsertMode(null);setMessage('');return;}end();}}
              onPointerCancel={()=>{drawing.current=null;setDrawBox(null);end(true);}} onDoubleClick={e=>{
                if(!canEdit||panMode||spaceRef.current)return;const recent=lastTap.current;
                const id=(e.target as Element).closest<HTMLElement>('[data-node-id]')?.dataset.nodeId??
                  (recent&&Date.now()-recent.time<500&&Math.hypot(e.clientX-recent.x,e.clientY-recent.y)<6?recent.id:undefined);
                const node=page.nodes.find(n=>n.id===id);if(node?.type==='text'&&!node.locked){setSelected([node.id]);setEditingId(node.id);}
              }} aria-label={`可编辑画布第 ${page.page_no} 页`}>
              {reference||!ready?<img className={styles.original} src={source?.image_url??''} alt={`第 ${page.page_no} 页原稿`} draggable={false}/>:
                <ScenePageView page={page} scale={scale} editing={canEdit} proofFigures={proofFigures} editingId={editingId} preview={preview} onText={onText} onCompose={onCompose} onTextBlur={closeText} vectorId={primary?.id}
                  onVectorSelect={id=>{setSelected([id]);setEditingId(null);}}
                  generating={generating} onGenerateDemo={id=>void generateNode(id,'demo')}
                  onVectorPatch={(id, patch,key)=>controller.patch(page.page_no,[id],patch,key?`${id}.${key}`:'')}>
                  {guides.x!==undefined&&<div className={styles.guideX} style={{left:guides.x}}/>}{guides.y!==undefined&&<div className={styles.guideY} style={{top:guides.y}}/>}
                  {drawBox&&<div style={{position:'absolute',...drawBox,border:'2px dashed #1e73a8',background:'#e9f3fa55',pointerEvents:'none',zIndex:60000}}/>}
                  {box&&primary?.type!=='vector'&&<div className={styles.selection} style={{left:box.x,top:box.y,width:box.width,height:box.height,
                    transform:shown.length===1?`rotate(${shown[0]!.rotation}deg)`:undefined,borderWidth:1/scale}}>
                    {unlocked.length===1&&selectedNodes.length===1&&!editingId&&<>
                      {['nw','n','ne','e','se','s','sw','w'].map(direction=><span key={direction} role="button" aria-label={`缩放手柄 ${direction}`} data-handle={direction}
                        className={styles.handle} data-direction={direction} style={{width:9/scale,height:9/scale,borderWidth:1/scale}}/>)}
                      <span className={styles.rotationLine} style={{height:24/scale,top:-24/scale}}/><span role="button" aria-label="旋转手柄" data-handle="rotate" className={styles.rotateHandle}
                        style={{top:-33/scale,width:12/scale,height:12/scale,borderWidth:1/scale}}/>
                    </>}
                  </div>}
                </ScenePageView>}
            </div>
          </div>
        </div>
        {!ready&&<div className={styles.preparing} role="status">{status==='failed'?page.preparation?.message??'本页对象准备失败':'正在准备本页可编辑对象，首次需要几秒；后续输入和拖动即时显示。'}
          {status==='failed'&&<button onClick={()=>setRetry(n=>n+1)}>重新准备本页</button>}</div>}
      </main>
      <NodeProperties node={primary?.math_scene?{...primary,math_scene:resolveMatrixSource(primary.math_scene,page.nodes)}:primary} count={selectedNodes.length} pageNo={page.page_no} materialId={materialId} autoSpecs={autoSpecs} pageNodes={page.nodes}
        generating={!!(primary&&generating[primary.id])} onDemoGenerate={()=>primary&&void generateNode(primary.id,'demo')}
        onVectorize={canVectorize?()=>setFigureTarget({pageNo:page.page_no,nodeId:primary.id}):undefined}
        figureCount={countFigureObjects(vectorized.filter(node=>node.figure_source_id===primary?.id))}
        onDiagramBuild={(text,ai)=>primary?generateNode(primary.id,'diagram',text,ai):undefined}
        disabled={!canEdit||!!(primary&&page.preparation?.frozen_ids?.includes(primary.id))}
        onPatch={patch} onDuplicate={duplicate} onDelete={remove}
        onInteraction={(config:NodeInteraction|null)=>patch({interaction:config},'interaction')}
        onReinteract={()=>void reinteract()} reinteracting={reinteracting} onRestoreContent={restoreContent}/>
    </div>
    <footer className={styles.footer}><span>Shift 多选 · 对齐 / 分布 · 等比缩放 · Alt 暂停吸附 · 空格/中键拖动平移 · 方向键微调 · Ctrl+Z 撤销</span>
      <div><button disabled={page.page_no===1} onClick={()=>setQuery({page:String(page.page_no-1)},{replace:true})}>上一页</button><span>{page.page_no} / {document.pages.length}</span>
        <button disabled={page.page_no===document.pages.length} onClick={()=>setQuery({page:String(page.page_no+1)},{replace:true})}>下一页</button></div>
      <span>修改即时显示 · 网页自动保存</span></footer>
    {figureNode&&<FigureVectorizationDialog key={`${page.page_no}:${figureNode.id}`} materialId={materialId} pageNo={page.page_no} node={figureNode} controller={controller}
      onClose={()=>setFigureTarget(null)} onApplied={count=>{setProofFigures(false);setMessage(`已应用 ${count} 个图示对象，可撤销或选择对象继续编辑。`);}} onManual={addVector}/>}
  </div>;
}
