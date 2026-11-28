import { createPortal } from 'react-dom';
import {useCallback,useEffect,useRef,useState,useSyncExternalStore,type Dispatch,type PointerEvent as ReactPointerEvent,type SetStateAction} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import type {MaterialDetail} from '@/api/types';
import {getDocument,prepareDocumentPage,reinteractDocumentPage,createSceneDiagram} from '@/api/documents';
import {errorMessage} from '@/api/client';
import {useScopedQueryKeys} from '@/api/queryKeys';
import type {DocumentController} from '@/document/controller';
import {newNode,patchNodes,distributeNodes} from '@/document/model';
import {applySlideLayout,isImagePlaceholder,isImagePlaceholderHint,isLayoutDecoration,layoutNodes,SLIDE_LAYOUTS,type SlideLayout} from '@/document/layouts';
import {THEMES,presetTheme} from '@/document/themes';
import {SHAPE_CATALOG} from '@/document/shapeCatalog';
import type {DeckTheme,SceneNode,ScenePage,NodePatch,NodeInteraction,SceneParagraph,TextStyle} from '@/document/types';
import type {ISpec} from '@/ispec/types';
import {ZoomControl} from '@/components/ui/ZoomControl';
import {fitZoom,wheelZoom} from '@/components/ui/zoom';
import {workshopPluginConfigForTemplate} from '@/canvas/templateCatalog';
import {ScenePageView} from './ScenePageView';
import {NodeProperties} from './NodeProperties';
import {FormulaPopover} from './FormulaPopover';
import {ImageCropOverlay} from './ImageCropOverlay';
import {FloatingFormatBar} from './FloatingFormatBar';
import {WorkshopPluginPicker,type WorkshopPluginSelection} from './WorkshopPluginPicker';
import {groupResize,intersects,rotatedBounds,rotatedBox,rotateSelection,snapAxis,type Box,type GapGuide} from './canvasGestures';
import styles from './FreeDeckEditor.module.css';

interface Props {
  materialId:string;controller:DocumentController;material:MaterialDetail;
  activePageNo:number;onSelectPage:(pageNo:number)=>void;
  zoom:number|'fit';onZoom:Dispatch<SetStateAction<number|'fit'>>;
  headerActionsHost?: HTMLElement | null;
}
interface Drag {kind:'move'|'resize'|'rotate';direction:string;startX:number;startY:number;nodes:SceneNode[];box:Box;preview:Record<string,Partial<SceneNode>>;editOnClickTextId?:string;moved?:boolean;}
interface Drawing {start:{x:number;y:number};selection:string[];box:Box;clicked?:string}
const identifier=()=>`u_${crypto.randomUUID().replaceAll('-','')}`;
const NODE_CLIPBOARD_TYPE='application/x-wanxiang-slide-nodes';
const acceptsText=(node:SceneNode)=>node.type==='text'||node.type==='shape'&&!node.whole_group;
const round=(n:number)=>Math.round(n*100)/100;
const bounds=(nodes:SceneNode[])=>{const x=Math.min(...nodes.map(n=>n.x)),y=Math.min(...nodes.map(n=>n.y));return {x,y,width:Math.max(...nodes.map(n=>n.x+n.width))-x,height:Math.max(...nodes.map(n=>n.y+n.height))-y};};
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
  const [selection,setSelected]=useState<string[]>([]);const [editingId,setEditingId]=useState<string|null>(null);
  const [isolatedObject,setIsolatedObject]=useState<string|null>(null);
  const clipboard=useRef<{token:string;pageNo:number;nodes:SceneNode[];text:string}|null>(null);
  const currentPageNo=useRef(page.page_no);
  currentPageNo.current=page.page_no;
  const [preview,setPreview]=useState<Record<string,Partial<SceneNode>>>({});
  const [movingObject,setMovingObject]=useState(false);
  const [guides,setGuides]=useState<{x?:number;y?:number;gaps?:GapGuide[]}>({});
  const [tab,setTab]=useState<'pages'|'layers'>('pages');
  const drawing=useRef<Drawing|null>(null);
  const [drawBox,setDrawBox]=useState<Box|null>(null);
  const [pageMenuFor,setPageMenuFor]=useState<number|null>(null);
  const [contextMenu,setContextMenu]=useState<{x:number;y:number;onObject:boolean}|null>(null);
  const [formulaOpen,setFormulaOpen]=useState(false);
  const [relayoutOpen,setRelayoutOpen]=useState(false);
  const [cropId,setCropId]=useState<string|null>(null);
  const [painter,setPainter]=useState<{style:Partial<TextStyle>;repeat:boolean}|null>(null);
  const replacement=useRef<string|null>(null);
  const imageSlot=useRef<string|null>(null);
  const draggedPage=useRef<number|null>(null);
  const [dropPage,setDropPage]=useState<number|null>(null);
  const [generating,setGenerating]=useState<Record<string,boolean>>({});
  const mounted=useRef(true);useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const [panMode,setPanMode]=useState(false);const [spaceHeld,setSpaceHeld]=useState(false);const spaceRef=useRef(false);
  const [panning,setPanning]=useState(false);const panRef=useRef<{x:number;y:number;left:number;top:number}|null>(null);
  const [reference,setReference]=useState(false);const [retry,setRetry]=useState(0);const retryUsed=useRef(0);const [message,setMessage]=useState('');
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
  const fit=fitZoom(area,{...page,width:page.width*(reference?2:1)},reference?64:80,.15,1.7);
  const scale=zoom==='fit'?fit:zoom;
  const displayWidth=page.width*scale*(reference?2:1)+(reference?64:80);
  const canPan=displayWidth>area.width+1||page.height*scale+80>area.height+1;
  const source=page.source_page_no===null?undefined:material.slides.find(p=>p.page_no===(page.source_page_no??page.page_no));
  const groupIds=new Set(page.nodes.filter(n=>selection.includes(n.id)&&n.id!==isolatedObject).map(n=>n.group_id).filter(Boolean));
  const selected=page.nodes.filter(n=>!n.deleted&&(selection.includes(n.id)||
    (n.group_id&&groupIds.has(n.group_id)&&!n.hidden))).map(n=>n.id);
  const selectedNodes=page.nodes.filter(n=>selected.includes(n.id));const primary=selectedNodes[0]??null;
  const unlocked=selectedNodes.filter(n=>!n.locked&&!n.hidden&&!page.preparation?.frozen_ids?.includes(n.id));
  const slideSelection=unlocked.length&&unlocked.length===selectedNodes.length?rotatedBounds(unlocked):null;
  const canMoveInside=slideSelection&&slideSelection.width<=page.width&&slideSelection.height<=page.height&&
    (slideSelection.x<0||slideSelection.y<0||
      slideSelection.x+slideSelection.width>page.width||slideSelection.y+slideSelection.height>page.height);
  const shown=selectedNodes.filter(n=>!n.hidden).map(n=>preview[n.id]?{...n,...preview[n.id]}:n);
  const box=shown.length?(shown.length===1?bounds(shown):rotatedBounds(shown)):null;
  const canTransform=canEdit&&unlocked.length===shown.length&&!editingId&&(shown.length>1||primary?.type!=='vector');
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
  useEffect(()=>()=>{controller.setComposing(false);},[controller]);
  useEffect(()=>{
    if(tab==='pages')rail.current?.querySelector('[aria-current="page"]')?.scrollIntoView({block:'nearest',inline:'nearest'});
  },[page.page_no,tab]);
  useEffect(()=>{
    setSelected([]);setEditingId(null);setIsolatedObject(null);setPreview({});setGuides({});setReference(false);
    setDrawBox(null);setPluginPickerOpen(false);setContextMenu(null);setFormulaOpen(false);setCropId(null);setRelayoutOpen(false);
    setPageMenuFor(current=>current===page.page_no?current:null);
    drawing.current=null;drag.current=null;setMovingObject(false);lastTap.current=null;
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
    const groups=new Map<string,string>();
    for(const node of selectedNodes){const id=identifier();ids.push(id);const copy={...node,id,duplicate_from:node.id,source_element_id:null,source_shape_id:null,
      cleaned_asset_id:undefined,cleaned_url:undefined,figure_scene:undefined,figure_source_id:undefined,figure_object_id:undefined,figure_provenance:undefined,
      name:node.name+' 副本',x:node.x+18,y:node.y+18,z:Math.max(...page.nodes.map(n=>n.z))+ids.length,locked:false};
      if(node.group_id){
        if(!groups.has(node.group_id))groups.set(node.group_id,identifier());
        copy.group_id=groups.get(node.group_id);
      }
      next={...next,pages:next.pages.map(p=>p.page_no===page.page_no?{...p,modified:true,nodes:[...p.nodes,copy]}:p)};}
    controller.replace(next);setSelected(ids);setEditingId(null);
  };
  const remove=()=>{if(canEdit){controller.patch(page.page_no,unlocked.map(n=>n.id),{deleted:true});setSelected([]);setEditingId(null);}};
  const groupSelection=(ungroup:boolean)=>{
    if(!canEdit||!unlocked.length||(!ungroup&&unlocked.length<2))return;
    controller.patch(page.page_no,unlocked.map(n=>n.id),{group_id:ungroup?null:identifier()});
  };
  const startPainter=(repeat=false)=>{
    if(!canEdit||!primary)return;
    const {anim_step,bind_mode,arrow_start,arrow_end,...style}=primary.style;
    setPainter({style,repeat});
    setMessage('点击要应用格式的对象。按 Esc 退出格式刷。');
  };
  const applyTheme=(requested:DeckTheme)=>{
    const latest=controller.getSnapshot().document;
    const previous=latest.theme;
    if(!canEdit)return;
    const theme={...requested,master:requested.master??previous?.master};
    if(JSON.stringify(previous)===JSON.stringify(theme))return;
    const recolor=(value:string|undefined)=>{
      if(!previous||!value)return value;
      const role=(['primary','accent','text','surface','border'] as const).find(key=>
        previous.palette[key].toLowerCase()===value.toLowerCase());
      return role?theme.palette[role]:value;
    };
    controller.replace({...latest,theme,pages:latest.pages.map(slide=>{
      if(slide.source_page_no!==null)return theme.master?{...slide,modified:true}:slide;
      const inherits=!slide.background_modified||slide.background_color===previous?.palette.background;
      return {...slide,modified:true,
        ...(inherits?{background_color:theme.palette.background,background_modified:true}:{}),
        nodes:slide.nodes.map(node=>{
          if(node.locked||node.deleted)return node;
          const style={...node.style};
          if(node.type==='text'){
            style.color=previous?(recolor(style.color)??style.color):theme.palette[style.bold?'primary':'text'];
            if(!previous||style.font_family===previous.fonts.body||style.font_family===previous.fonts.heading)
              style.font_family=theme.fonts[style.bold?'heading':'body'];
          }
          const decoration=node.type==='shape'&&isLayoutDecoration(slide,node);
          const roleColor=(value:string,role:'surface'|'border')=>
            decoration&&previous?.palette[role].toLowerCase()===value.toLowerCase()?theme.palette[role]:recolor(value);
          if(style.fill)style.fill=roleColor(style.fill,'surface');
          if(style.stroke)style.stroke=roleColor(style.stroke,'border');
          return {...node,style};
        }),
      };
    })},'theme.apply');
  };
  const useThemePreset=(id:string)=>{
    const theme=presetTheme(id,document.theme?.aspect_ratio??(page.width/page.height<1.55?'4:3':'16:9'));
    if(theme)applyTheme(theme);
  };
  const applyPageLayout=(id:SlideLayout)=>{
    const latest=controller.getSnapshot().document;
    const current=latest.pages.find(item=>item.page_no===page.page_no);
    if(!canEdit||!current)return;
    controller.replace(applySlideLayout(latest,current,id,identifier));
    setSelected([]);setEditingId(null);
  };
  const add=(type:'text'|'shape'|'table'|'chart',shape:SceneNode['shape']='rect')=>{
    if(!canEdit)return;
    const node={...newNode(page,identifier(),type,document.theme),shape};
    if(type==='shape')node.name=SHAPE_CATALOG.find(item=>item.id===shape)?.label??node.name;
    controller.add(page.page_no,node);setSelected([node.id]);setEditingId(type==='text'?node.id:null);
  };
  const addVector = (arrow: boolean) => {
    if (!canEdit) return;
    const node = newNode(page, identifier(), 'vector', document.theme);
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
  const generateDiagram=async(id:string,text:string,ai:boolean)=>{
    const pageNo=page.page_no;
    const original=controller.getSnapshot().document.pages.find(p=>p.page_no===pageNo)?.nodes.find(n=>n.id===id);
    if(!canEdit||!original||original.locked||generating[id])return;
    const content=JSON.stringify(original.diagram);
    setGenerating(current=>({...current,[id]:true}));setMessage('');
    try{
      if(!await controller.save())throw new Error('请先完成当前修改的同步，再根据本页生成。');
      const patch={diagram:(await createSceneDiagram(materialId,pageNo,text,ai)).diagram};
      const latest=controller.getSnapshot().document.pages.find(p=>p.page_no===pageNo)?.nodes.find(n=>n.id===id);
      if(!latest||latest.deleted||latest.locked||JSON.stringify(latest.diagram)!==content){
        if(mounted.current)setMessage('生成期间目标图框已变更，请重新生成。');return;
      }
      controller.patch(pageNo,[id],patch);
      if(mounted.current)setMessage(`已生成到第 ${controller.getSnapshot().document.pages.findIndex(p=>p.page_no===pageNo)+1} 页，可直接演示。`);
    }catch(error){if(mounted.current)setMessage(errorMessage(error));}
    finally{if(mounted.current)setGenerating(current=>({...current,[id]:false}));}
  };
  const imageData=async(image:Blob)=>{
    if(!['image/png','image/jpeg','image/webp'].includes(image.type)||image.size>20*1024*1024)throw new Error('请选择 20 MB 以内的 PNG、JPEG 或 WebP 图片');
    const bitmap=await createImageBitmap(image);
    const {width,height}=bitmap;
    let source=image;
    try {
      if(Math.max(width,height)>1920||image.size>600*1024){
        const ratio=Math.min(1,1920/Math.max(width,height));
        const canvas=window.document.createElement('canvas');
        canvas.width=Math.max(1,Math.round(width*ratio));canvas.height=Math.max(1,Math.round(height*ratio));
        canvas.getContext('2d')?.drawImage(bitmap,0,0,canvas.width,canvas.height);
        const encoded=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/webp',.82));
        if(encoded)source=encoded;
      }
    }finally{bitmap.close();}
    if(source.size>4*1024*1024)throw new Error('压缩后的图片超过 4 MB');
    const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(reader.error);reader.readAsDataURL(source);});
    return {data,width,height};
  };
  const addImage=async(image:File,replaceId?:string|null,slotId?:string|null)=>{
    const asset=await imageData(image);
    if(replaceId){
      controller.patch(page.page_no,[replaceId],{image_data:asset.data,cleaned_asset_id:null,
        crop:{left:0,right:0,top:0,bottom:0}});
      return;
    }
    const latest=controller.getSnapshot().document;
    const targetPage=latest.pages.find(item=>item.page_no===page.page_no);
    const slot=targetPage?.nodes.find(item=>item.id===slotId&&isImagePlaceholder(targetPage,item));
    const maxWidth=slot?.width??Math.min(page.width*.5,400);
    const maxHeight=slot?.height??page.height*.7;
    const width=Math.min(maxWidth,maxHeight*asset.width/asset.height);
    const height=width*asset.height/asset.width;
    const node={...newNode(page,identifier(),'image'),image_data:asset.data,width,height,text:'',
      x:slot?slot.x+(slot.width-width)/2:(page.width-width)/2,y:slot?slot.y+(slot.height-height)/2:(page.height-height)/2};
    if(slot&&targetPage){
      controller.replace({...latest,pages:latest.pages.map(item=>item===targetPage?{
        ...item,modified:true,nodes:[...item.nodes.map(n=>n.id===slot.id||
          (isImagePlaceholderHint(targetPage,n)&&n.x>=slot.x&&n.x<slot.x+slot.width)?{...n,deleted:true}:n),node],
      }:item)});
    }else controller.add(page.page_no,node);
    if(currentPageNo.current===page.page_no)setSelected([node.id]);
  };
  const pasteNodes=async(entry:NonNullable<typeof clipboard.current>)=>{
    const offset=page.page_no===entry.pageNo?18:0;
    const groups=new Map<string,string>();
    const clones=await Promise.all(entry.nodes.map(async node=>{
      if(node.group_id&&!groups.has(node.group_id))groups.set(node.group_id,identifier());
      const image=node.type==='image'&&!node.image_data
        ?await imageData(await fetch(node.cleaned_url||node.image_url||'').then(response=>{
          if(!response.ok)throw new Error('无法读取待复制的图片');
          return response.blob();
        })):null;
      const {duplicate_from,figure_source_id,figure_object_id,figure_provenance,basis,...copy}=node;
      return {...copy,id:identifier(),group_id:node.group_id?groups.get(node.group_id):node.group_id,
        image_data:image?.data??node.image_data,locked:false,
        source_element_id:null,source_shape_id:null,base_text:null,base_style:node.style,asset_id:null,
        cleaned_asset_id:undefined,cleaned_url:undefined,figure_scene:undefined,native_file:undefined,
        x:node.x+offset,y:node.y+offset};
    }));
    const latest=controller.getSnapshot().document;
    const destination=latest.pages.find(item=>item.page_no===page.page_no);
    if(!destination||!mounted.current)return;
    const maxZ=Math.max(0,...destination.nodes.map(node=>node.z));
    clones.forEach((node,index)=>{node.z=maxZ+index+1;});
    controller.replace({...latest,pages:latest.pages.map(item=>item===destination?{
      ...item,modified:true,nodes:[...item.nodes,...clones],
    }:item)});
    if(currentPageNo.current===page.page_no)setSelected(clones.map(node=>node.id));
  };
  const copySelection=()=>{
    if(!canEdit||!unlocked.length)return null;
    const nodes=unlocked.filter(node=>!node.whole_group&&node.type!=='demo');
    if(nodes.length!==unlocked.length){setMessage('选区包含无法复制的旧版对象');return null;}
    const token=identifier(),text=nodes.map(node=>node.text).filter(Boolean).join('\n')||'通文册对象';
    const entry={token,pageNo:page.page_no,nodes,text};
    clipboard.current=entry;
    return entry;
  };
  const copyFromMenu=(cut:boolean)=>{
    const entry=copySelection();if(!entry)return;
    if(cut)remove();
    void navigator.clipboard?.writeText(entry.text).catch(()=>{});
  };
  useEffect(()=>{
    const isEditingText=(event:Event)=>event.target instanceof Element&&
      event.target.closest('input,textarea,select,[contenteditable=true],dialog');
    const copy=(event:ClipboardEvent)=>{
      if(!canEdit||isEditingText(event)||!unlocked.length||!event.clipboardData)return;
      const entry=copySelection();if(!entry)return;
      event.clipboardData.setData(NODE_CLIPBOARD_TYPE,entry.token);
      event.clipboardData.setData('text/plain',entry.text);
      event.preventDefault();
      if(event.type==='cut')remove();
    };
    const paste=(event:ClipboardEvent)=>{
      if(!canEdit||isEditingText(event)||!event.clipboardData)return;
      const data=event.clipboardData;
      const image=[...data.files].find(file=>file.type.startsWith('image/'));
      const entry=clipboard.current;
      const token=data.getData(NODE_CLIPBOARD_TYPE);
      const text=data.getData('text/plain');
      if(image){event.preventDefault();void addImage(image).catch(error=>setMessage(errorMessage(error)));return;}
      if(entry&&(token===entry.token||(!token&&text===entry.text))){
        event.preventDefault();void pasteNodes(entry).catch(error=>setMessage(errorMessage(error)));return;
      }
      if(text.trim()){
        event.preventDefault();
        const node={...newNode(page,identifier(),'text',document.theme),text:text.slice(0,12000)};
        controller.add(page.page_no,node);setSelected([node.id]);
      }
    };
    window.addEventListener('copy',copy);window.addEventListener('cut',copy);window.addEventListener('paste',paste);
    return()=>{window.removeEventListener('copy',copy);window.removeEventListener('cut',copy);window.removeEventListener('paste',paste);};
  });
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
  const layerStep=(direction:-1|1)=>{
    if(!canEdit||!unlocked.length)return;
    const nodes=page.nodes.filter(n=>!n.deleted).sort((a,b)=>a.z-b.z);
    const ids=new Set(unlocked.map(n=>n.id));
    const order=direction===1?[...nodes.keys()].reverse():[...nodes.keys()];
    for(const index of order){
      const other=index+direction;
      if(!nodes[other]||!ids.has(nodes[index]!.id)||ids.has(nodes[other]!.id))continue;
      [nodes[index],nodes[other]]=[nodes[other]!,nodes[index]!];
    }
    controller.replace(nodes.reduce((doc,n,index)=>n.z===index?doc:patchNodes(doc,page.page_no,[n.id],{z:index}),
      controller.getSnapshot().document));
  };
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
    if(panMode||spaceRef.current||cropId)return;
    if(!canEdit||e.button!==0||(e.target as Element).closest('textarea,input,select,button,a,[contenteditable=true],[data-editor-control]'))return;
    const handle=(e.target as Element).closest<HTMLElement>('[data-handle]')?.dataset.handle;
    const target=e.target as Element;
    const id=target.closest<HTMLElement>('[data-node-id]')?.dataset.nodeId??
      (target.matches('[data-vector-select]')?target.closest<SVGSVGElement>('[data-vector-node]')?.dataset.vectorNode:undefined);
    const fallbackNode=id?page.nodes.find(n=>n.id===id):undefined;
    if(painter&&fallbackNode&&!fallbackNode.locked&&!page.preparation?.frozen_ids?.includes(fallbackNode.id)){
      controller.patch(page.page_no,[fallbackNode.id],{style:painter.style});
      setSelected([fallbackNode.id]);setEditingId(null);
      if(!painter.repeat){setPainter(null);setMessage('');}
      e.preventDefault();e.stopPropagation();return;
    }
    if(!handle&&(!id||fallbackNode?.locked)){
      setIsolatedObject(null);
      const start=point(e);
      lastTap.current=null;
      const selection=e.shiftKey?[...selected]:[];
      drawing.current={start,selection,box:{...start,width:0,height:0},clicked:id};
      setEditingId(null);e.preventDefault();e.stopPropagation();e.currentTarget.setPointerCapture(e.pointerId);return;
    }
    if(target.closest('[data-no-pan]')&&!handle&&!id)return;
    let nodes=unlocked;
    let editOnClickTextId:string|undefined;
    if(!handle){
      if(!id||!fallbackNode)return;
      const node=fallbackNode;
      const prior=lastTap.current;
      if(acceptsText(node)&&!node.locked&&prior?.id===id&&Date.now()-prior.time<450&&Math.hypot(e.clientX-prior.x,e.clientY-prior.y)<6){
        e.preventDefault();drag.current=null;setMovingObject(false);lastTap.current=null;
        if(node.group_id)setIsolatedObject(id);
        setSelected([id]);setEditingId(id);return;
      }
      lastTap.current={id,time:Date.now(),x:e.clientX,y:e.clientY};
      let ids=selected;
      if(isolatedObject&&isolatedObject!==id)setIsolatedObject(null);
      const members=node.group_id&&node.id!==isolatedObject?page.nodes.filter(item=>item.group_id===node.group_id&&!item.hidden&&!item.deleted).map(item=>item.id):[id];
      if(e.shiftKey){ids=selected.includes(id)?selected.filter(n=>!members.includes(n)):[...selected,...members];setSelected(ids);e.stopPropagation();return;}
      else if(!selected.includes(id)){ids=members;setSelected(ids);}
      else if(node.type==='text'&&!node.locked&&selected.length===1&&selected[0]===id){editOnClickTextId=id;}
      nodes=page.nodes.filter(n=>ids.includes(n.id)&&!n.locked&&!n.hidden&&!n.deleted&&!page.preparation?.frozen_ids?.includes(n.id));
      if(!nodes.length)return;
    }
    if(!nodes.length)return;
    setEditingId(null);e.preventDefault();e.stopPropagation();e.currentTarget.setPointerCapture(e.pointerId);
    const kind=handle==='rotate'?'rotate':handle?'resize':'move';
    setMovingObject(kind==='move');
    const start=point(e);drag.current={kind,direction:handle??'',startX:start.x,startY:start.y,nodes,
      box:kind!=='move'&&nodes.length===1?bounds(nodes):rotatedBounds(nodes),preview:{},editOnClickTextId};
  };
  const measureDrawing=(e:ReactPointerEvent<HTMLDivElement>)=>{
    const active=drawing.current!;
    const now=point(e),start=active.start;
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
      setSelected(drawnSelection(active));
      return;
    }
    const active=drag.current;if(!active)return;
    const current=point(e);let dx=current.x-active.startX,dy=current.y-active.startY;
    const result:Record<string,Partial<SceneNode>>={};const lines:typeof guides={};
    if(Math.hypot(dx,dy)>4){lastTap.current=null;active.moved=true;}
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
    setMovingObject(false);
    if(!cancel&&active.editOnClickTextId&&!active.moved&&!Object.keys(active.preview).length){
      setPreview({});setGuides({});setEditingId(active.editOnClickTextId);return;
    }
    if(!cancel){let next=controller.getSnapshot().document;for(const [id,value]of Object.entries(active.preview))next=patchNodes(next,page.page_no,[id],value);controller.replace(next);}
    setPreview({});setGuides({});
  };
  const finishPointer=(e:ReactPointerEvent<HTMLDivElement>)=>{
    if(!drawing.current){
      if(drag.current&&Object.keys(drag.current.preview).length)move(e);
      end();return;
    }
    const active=measureDrawing(e);
    drawing.current=null;setDrawBox(null);
    setSelected(drawnSelection(active));
  };
  useEffect(()=>{
    const key=(e:KeyboardEvent)=>{
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();void controller.save();return;}
      if((e.target as Element)?.closest('input,textarea,select,[contenteditable=true]'))return;
      if(e.key==='Escape'){if(contextMenu){setContextMenu(null);return;}if(painter){setPainter(null);setMessage('');return;}
        setEditingId(null);setSelected([]);setIsolatedObject(null);setDrawBox(null);drawing.current=null;end(true);return;}
      if(!reinteracting&&(e.ctrlKey||e.metaKey)&&['z','y'].includes(e.key.toLowerCase())){e.preventDefault();e.shiftKey||e.key.toLowerCase()==='y'?controller.redo():controller.undo();return;}
      if(!canEdit)return;
      if((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key.toLowerCase()==='c'){e.preventDefault();startPainter();return;}
      if((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key.toLowerCase()==='v'&&painter&&unlocked.length){
        e.preventDefault();controller.patch(page.page_no,unlocked.map(node=>node.id),{style:painter.style});
        if(!painter.repeat){setPainter(null);setMessage('');}return;
      }
      if((e.ctrlKey||e.metaKey)&&(e.key===']'||e.key==='[')){e.preventDefault();layerStep(e.key===']'?1:-1);return;}
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='g'){e.preventDefault();groupSelection(e.shiftKey);return;}
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='a'){
        e.preventDefault();
        setSelected(page.nodes.filter(n=>!n.deleted&&!n.hidden&&!n.locked&&!page.preparation?.frozen_ids?.includes(n.id)).map(n=>n.id));
        return;
      }
      if(e.key==='Enter'&&primary&&acceptsText(primary)&&!primary.locked){e.preventDefault();setEditingId(primary.id);return;}
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
      <div className={styles.toolGroup}><select aria-label="应用主题到全册" title="应用主题到全册" value={document.theme?.palette.primary===document.theme?.palette.secondary?'':document.theme?.id??''}
        disabled={!canEdit} onChange={event=>useThemePreset(event.target.value)}>
        <option value="" disabled>应用主题 ▾</option>
        {THEMES.map(([id,name])=><option key={id} value={id}>{name}</option>)}
      </select></div>
      <div className={styles.toolGroup}><button onClick={()=>add('text')} disabled={!canEdit}>＋ 文字</button><button onClick={()=>{replacement.current=null;imageSlot.current=null;file.current?.click();}} disabled={!canEdit}>＋ 图片</button>
        <div className={styles.formulaAnchor}>
          <button type="button" aria-expanded={formulaOpen} disabled={!canEdit} onClick={()=>setFormulaOpen(value=>!value)}>∑ 插入公式</button>
          {formulaOpen&&<FormulaPopover onClose={()=>setFormulaOpen(false)} onInsert={tex=>{
            const node=newNode(page,identifier(),'text',document.theme);
            controller.add(page.page_no,{...node,name:'公式',text:`$${tex}$`,
              style:{...node.style,align:'center',vertical_align:'middle'}});
            setSelected([node.id]);setEditingId(null);setFormulaOpen(false);
          }}/>}
        </div>
        <select aria-label="插入教学图形" value="" disabled={!canEdit} onChange={e=>{const shape=SHAPE_CATALOG.find(item=>item.id===e.target.value);if(shape)add('shape',shape.id);}}>
          <option value="" disabled>＋ 图形</option>{SHAPE_CATALOG.map(shape=><option key={shape.id} value={shape.id}>{shape.label}</option>)}
        </select>
        <select aria-label="插入表格或图表" value="" disabled={!canEdit} onChange={e=>{if(e.target.value==='table'||e.target.value==='chart')add(e.target.value);}}>
          <option value="" disabled>＋ 表格或图表</option><option value="table">表格</option><option value="chart">图表</option>
        </select></div>
      <div className={styles.toolGroup}><button onClick={()=>addVector(false)} disabled={!canEdit}>＋ 线条</button><button onClick={()=>addVector(true)} disabled={!canEdit}>＋ 箭头</button></div>
      <div className={`${styles.toolGroup} ${styles.featureGroup}`}><button className={styles.featurePrimary} onClick={()=>setPluginPickerOpen(true)} disabled={!canEdit}>🎛️ 插入定象坊插件</button>
        </div>
      <input type="file" accept="image/png,image/jpeg,image/webp" ref={file} hidden onChange={e=>{
        const image=e.target.files?.[0],id=replacement.current,slotId=imageSlot.current;
        replacement.current=null;imageSlot.current=null;
        if(image)void addImage(image,id,slotId).catch(error=>setMessage(errorMessage(error)));e.target.value='';
      }}/>
      {selectedNodes.length>0&&<div className={styles.toolGroup}><button onClick={duplicate} disabled={!selectedNodes.length||!canEdit}>复制</button><button onClick={remove} disabled={!unlocked.length||!canEdit}>删除</button>
        <button type="button" aria-pressed={!!painter} disabled={!primary||!canEdit} title="双击可连续套用"
          onClick={()=>startPainter()} onDoubleClick={()=>startPainter(true)}>格式刷</button>
        <button type="button" onClick={()=>groupSelection(false)} disabled={unlocked.length<2||!canEdit} title="Ctrl+G">组合</button>
        {unlocked.some(node=>node.group_id)&&<button type="button" onClick={()=>groupSelection(true)} disabled={!canEdit} title="Ctrl+Shift+G">取消组合</button>}
        <button onClick={()=>layer(true)} disabled={!unlocked.length||!canEdit}>置顶</button><button onClick={()=>layer(false)} disabled={!unlocked.length||!canEdit}>置底</button>
        <button type="button" onClick={()=>layerStep(1)} disabled={!unlocked.length||!canEdit}>上移一层</button>
        <button type="button" onClick={()=>layerStep(-1)} disabled={!unlocked.length||!canEdit}>下移一层</button>
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
          onClick={()=>selectPage(controller.addPage(page.page_no))} disabled={reinteracting}>＋</button>}
        {tab==='pages'&&<select aria-label="新建页版式" value="" disabled={reinteracting} onChange={event=>{
          if(event.target.value)selectPage(controller.addPage(page.page_no,event.target.value as SlideLayout));
        }}>
          <option value="">版式</option>
          {SLIDE_LAYOUTS.map(([value,label])=><option key={value} value={value}>{label}</option>)}
        </select>}</div>
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
                <div className={styles.thumbCanvas}><ScenePageView page={p} scale={148/p.width}
                  master={document.theme?{theme:document.theme,index:index+1,total:document.pages.length}:undefined}/></div>:
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
        {(ready&&stage==='failed')&&<div className={styles.canvasChips}>
          {ready&&stage==='failed'&&<button className={styles.retryLayers} onClick={()=>setRetry(n=>n+1)}>重试复杂图层</button>}
        </div>}
        <div className={styles.viewport} ref={viewport} data-fit={zoom==='fit'} data-pan-ready={canPan&&(panMode||spaceHeld)} data-panning={panning} data-moving-object={movingObject}
          onContextMenu={event=>{
            const target=event.target as Element;
            if(!canEdit||target.closest('input,textarea,select,[contenteditable=true]'))return;
            event.preventDefault();
            const node=target.closest<HTMLElement>('[data-node-id]')?.dataset.nodeId
              ??target.closest<SVGSVGElement>('[data-vector-node]')?.dataset.vectorNode;
            if(node&&!selected.includes(node))setSelected([node]);
            if(!node)setSelected([]);
            setContextMenu({x:event.clientX,y:event.clientY,onObject:!!node});
          }}
          onDragOver={event=>{if(canEdit&&event.dataTransfer.types.includes('Files'))event.preventDefault();}}
          onDrop={event=>{
            if(!canEdit||!event.dataTransfer.files.length)return;
            event.preventDefault();
            const image=event.dataTransfer.files[0]!;
            void addImage(image).catch(error=>setMessage(errorMessage(error)));
          }}
          onPointerDown={panDown} onPointerMove={panMove} onPointerUp={panEnd} onPointerCancel={panEnd}>
          <div className={styles.workarea} data-comparing={reference}
            style={zoom==='fit'?undefined:{minWidth:displayWidth,minHeight:page.height*scale+80}}
            onPointerDownCapture={e=>{if((e.target as Element).matches('[data-vector-select]')||
              (e.shiftKey&&(e.target as Element).closest('[data-node-id]')))begin(e);}}
            onPointerDown={e=>{if(!(e.target as Element).matches('[data-vector-select]')&&
              !(e.shiftKey&&(e.target as Element).closest('[data-node-id]')))begin(e);}}
            onPointerMove={move} onPointerUp={finishPointer} onDoubleClick={e=>{
              if(!canEdit||panMode||spaceRef.current)return;
              const recent=lastTap.current;
              const id=(e.target as Element).closest<HTMLElement>('[data-node-id]')?.dataset.nodeId??
                (recent&&Date.now()-recent.time<500&&Math.hypot(e.clientX-recent.x,e.clientY-recent.y)<6?recent.id:undefined);
              const node=page.nodes.find(n=>n.id===id);
              if(node?.group_id&&!node.locked){setSelected([node.id]);setIsolatedObject(node.id);}
              if(node?.type==='image'&&!node.locked){setSelected([node.id]);setCropId(node.id);}
              else if(node&&acceptsText(node)&&!node.locked){setSelected([node.id]);setEditingId(node.id);}
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
                <ScenePageView page={page} scale={scale}
                  master={document.theme?{theme:document.theme,index:pageIndex+1,total:document.pages.length}:undefined} editing={canEdit} editingId={editingId} preview={preview} onText={onText} onCompose={onCompose} onTextBlur={closeText} vectorId={primary?.id}
                  fallbackImageUrl={page.native_fallback && stage !== 'ready' && !page.modified ? source?.image_url ?? undefined : undefined}
                  onVectorSelect={id=>{setSelected(ids=>ids.includes(id)?ids:[id]);setEditingId(null);}}
                  onVectorPatch={(id, patch,key)=>{
                    if(key==='workshop-preview'&&patch.workshop_plugin)controller.cacheWorkshopPreview(page.page_no,id,patch.workshop_plugin);
                    else controller.patch(page.page_no,[id],patch,key?`${id}.${key}`:'');
                  }}>
                  {guides.x!==undefined&&<div className={styles.guideX} style={{left:guides.x}}/>}{guides.y!==undefined&&<div className={styles.guideY} style={{top:guides.y}}/>}
                  {guides.gaps?.map(({axis,from,to,cross},index)=><div key={index} className={styles.gapGuide} data-axis={axis}
                    style={axis==='x'?{left:from,top:cross,width:to-from}:{left:cross,top:from,height:to-from}}/>)}
                  {page.nodes.filter(node=>!node.hidden&&!node.deleted&&(node.style.anim_step??0)>0).map(node=>
                    <span key={node.id} className={styles.stepBadge} aria-hidden="true"
                      style={{left:node.x,top:node.y,transform:`scale(${1/scale})`}}>{node.style.anim_step}</span>)}
                  {cropId&&primary?.id===cropId&&<ImageCropOverlay key={cropId} node={primary} scale={scale} onCancel={()=>setCropId(null)}
                    onConfirm={crop=>{controller.patch(page.page_no,[cropId],{crop});setCropId(null);}}/>}
                  {canEdit&&page.nodes.filter(node=>isImagePlaceholder(page,node)).map(node=>
                    <button type="button" className={styles.imageSlot} data-editor-control key={node.id}
                      style={{left:node.x+node.width/2,top:node.y+node.height/2}}
                      onClick={()=>{replacement.current=null;imageSlot.current=node.id;file.current?.click();}}>选择图片</button>)}
                  {box&&canEdit&&unlocked.length>0&&!editingId&&!cropId&&!drawBox&&!movingObject&&!Object.keys(preview).length&&
                    (unlocked.length>1||primary&&['text','shape','image'].includes(primary.type))&&
                    <FloatingFormatBar node={unlocked.length===1?primary:null} box={box} scale={scale} pageWidth={page.width}
                      onStyle={style=>patch({style})} onAlign={align} onGroup={()=>groupSelection(false)} onDelete={remove}
                      onCrop={primary?.type==='image'?()=>setCropId(primary.id):undefined}
                      onReplace={primary?.type==='image'?()=>{replacement.current=primary.id;imageSlot.current=null;file.current?.click();}:undefined}/>}
                  {drawBox&&<div className={styles.drawBox} style={{...drawBox,borderWidth:1/scale}}/>}
                  {box&&(shown.length>1||primary?.type!=='vector')&&<div className={styles.selection} style={{left:box.x,top:box.y,width:box.width,height:box.height,
                    transform:shown.length===1?`rotate(${shown[0]!.rotation}deg)`:undefined,borderWidth:1/scale}}>
                    {canTransform&&!drawBox&&<>
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
      <NodeProperties node={primary} count={selectedNodes.length}
        generating={!!(primary&&generating[primary.id])}
        onDiagramBuild={(text,ai)=>primary?generateDiagram(primary.id,text,ai):undefined}
        pageMeta={{notes:page.notes??'',backgroundColor:page.background_color??document.theme?.palette.background??'#ffffff',backgroundModified:!!page.background_modified,
          transition:page.transition,hideMaster:!!page.hide_master,background:page.background}}
        theme={document.theme} onThemeChange={applyTheme} onApplyLayout={applyPageLayout}
        onSmartRelayout={()=>setRelayoutOpen(true)}
        onCropImage={primary?.type==='image'?()=>setCropId(primary.id):undefined}
        onReplaceImage={primary?.type==='image'?()=>{replacement.current=primary.id;imageSlot.current=null;file.current?.click();}:undefined}
        onBackgroundImage={file=>void imageData(file).then(({data})=>controller.patchPage(page.page_no,{
          background:{kind:'image',image_data:data,image_opacity:1},
        })).catch(error=>setMessage(errorMessage(error)))}
        onApplyBackground={()=>{
          const latest=controller.getSnapshot().document;
          if(page.background?.kind==='image'&&page.background.image_data.length*latest.pages.length>6_000_000){
            setMessage('全册背景图片超过保存上限，请使用较小的图片。');return;
          }
          controller.replace({...latest,pages:latest.pages.map(slide=>({...slide,modified:true,
            background:page.background??null,background_color:page.background_color??null,
            background_modified:!!page.background_modified,
          }))});
        }}
        onPatchPage={patchValue=>controller.patchPage(page.page_no,patchValue)}
        onApplyTransition={()=>{
          const latest=controller.getSnapshot().document;
          controller.replace({...latest,pages:latest.pages.map(slide=>({
            ...slide,modified:true,transition:page.transition??null,
          }))});
        }}
        onInsertPlugin={canEdit?()=>setPluginPickerOpen(true):undefined}
        disabled={!canEdit||!!(primary&&page.preparation?.frozen_ids?.includes(primary.id))}
        onPatch={patch} onDuplicate={duplicate} onDelete={remove}/>
    </div>
    <footer className={styles.footer}><span>拖动空白处框选 · Shift 增减选 · Alt 暂停吸附 · 空格/中键平移 · Ctrl+Z 撤销</span>
      <div><button disabled={pageIndex===0} onClick={()=>{const previous=document.pages[pageIndex-1];if(previous)selectPage(previous.page_no);}}>上一页</button><span>{pageIndex+1} / {document.pages.length}</span>
        <button disabled={!nextPage} onClick={()=>{if(nextPage)selectPage(nextPage.page_no);}}>下一页</button></div>
      <div className={styles.footerTools}>
        <button aria-pressed={reference} disabled={!source?.image_url} onClick={()=>{setReference(!reference);setEditingId(null);}}>原稿对照</button>
        <button aria-pressed={panMode} title="放大后拖动画布；也可按住空格或鼠标中键拖动" onClick={()=>{setPanMode(value=>!value);setEditingId(null);}}>平移</button>
        <ZoomControl className={styles.zoomControl} value={zoom} fitValue={fit} min={.25} max={4} step={.1} onChange={setZoom}/>
        <span className={styles.sync} data-error={!!state.error||!online} data-dirty={state.dirty&&!state.saving} role="status" aria-live="polite">{syncText}</span>
      </div></footer>
    {relayoutOpen&&createPortal(<div className={styles.relayoutBackdrop} onClick={()=>setRelayoutOpen(false)}>
      <section className={styles.relayoutPanel} role="dialog" aria-modal="true" aria-label="智能重排"
        onClick={event=>event.stopPropagation()} onKeyDown={event=>{
          if(event.key==='Escape'){event.stopPropagation();setRelayoutOpen(false);}
        }}>
        <header><h2>智能重排</h2><button autoFocus type="button" onClick={()=>setRelayoutOpen(false)}>关闭</button></header>
        <p>选择一个版式，保留文字内容并重新安排位置。</p>
        <div className={styles.relayoutGrid}>{(['lesson','two-column','text-image'] as const).map(id=>{
          const liveText=page.nodes.filter(node=>node.type==='text'&&!node.deleted&&!node.hidden);
          let slot=0;
          const nodes=layoutNodes(page,id,document.theme).map(node=>node.type==='text'?
            {...node,text:(liveText[slot++]?.text??node.text).slice(0,140)}:node);
          return <button key={id} type="button" onClick={()=>{applyPageLayout(id);setRelayoutOpen(false);}}>
            <span className={styles.relayoutThumbnail} style={{height:156*page.height/page.width}}>
              <ScenePageView page={{...page,nodes,background_url:undefined}} scale={156/page.width}/>
            </span>
            {SLIDE_LAYOUTS.find(([value])=>value===id)?.[1]}
          </button>;
        })}</div>
      </section>
    </div>,window.document.body)}
    {contextMenu&&createPortal(<div className={styles.contextBackdrop} onPointerDown={()=>setContextMenu(null)}>
      <div className={styles.contextMenu} role="group" aria-label="画布右键操作"
        onPointerDown={event=>event.stopPropagation()}
        style={{left:Math.max(4,Math.min(contextMenu.x,window.innerWidth-184)),
          top:Math.max(4,Math.min(contextMenu.y,window.innerHeight-300))}}>
        {[...(contextMenu.onObject?[
          ['剪切',()=>copyFromMenu(true)],['复制',()=>copyFromMenu(false)],['复制副本',duplicate],['置于顶层',()=>layer(true)],['上移一层',()=>layerStep(1)],
          ['下移一层',()=>layerStep(-1)],['置于底层',()=>layer(false)],
          ...(unlocked.length>=2?[['组合',()=>groupSelection(false)] as const]:[]),
          ...(unlocked.some(n=>n.group_id)?[['取消组合',()=>groupSelection(true)] as const]:[]),
          [primary?.locked?'解锁':'锁定',()=>patch({locked:!primary?.locked})],['删除',remove],
        ] as const:[
          ['新建文本框',()=>add('text')],['切换本页版式',()=>setRelayoutOpen(true)],
          ['修改背景色',()=>window.document.querySelector<HTMLInputElement>('[data-free-editor] [aria-label="页面背景色"]')?.click()],
         ] as const),...(clipboard.current?[['粘贴对象',()=>void pasteNodes(clipboard.current!).catch(error=>setMessage(errorMessage(error)))] as const]:[]) ]
          .map(([label,action],index)=><button key={label} type="button" autoFocus={index===0}
          onClick={()=>{setContextMenu(null);action();}}>{label}</button>)}
      </div>
    </div>,window.document.body)}
    {pluginPickerOpen&&canEdit&&<WorkshopPluginPicker key={page.page_no} onSelect={addWorkshopPlugin} onClose={()=>setPluginPickerOpen(false)}/>}
  </div>;
}
