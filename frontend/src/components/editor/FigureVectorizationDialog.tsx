import {useEffect,useRef,useState} from 'react';
import {errorMessage} from '@/api/client';
import {vectorizeFigure} from '@/api/documents';
import type {DocumentController} from '@/document/controller';
import {same} from '@/document/model';
import type {FigureVectorization,SceneNode} from '@/document/types';
import {ScenePageView} from './ScenePageView';
import styles from './FreeDeckEditor.module.css';

interface Props {
  materialId:string;
  pageNo:number;
  node:SceneNode;
  controller:DocumentController;
  onClose:()=>void;
  onApplied:(count:number)=>void;
  onManual:(arrow:boolean)=>void;
}

export function FigureVectorizationDialog({materialId,pageNo,node,controller,onClose,onApplied,onManual}:Props){
  const dialog=useRef<HTMLDialogElement>(null);
  const request=useRef<AbortController>();
  const [result,setResult]=useState<FigureVectorization>();
  const [mode,setMode]=useState<'original'|'overlay'|'demo'>('overlay');
  const [busy,setBusy]=useState(true);
  const [enhancing,setEnhancing]=useState(false);
  const [error,setError]=useState('');
  const [visionError,setVisionError]=useState('');
  const [attempt,retry]=useState(0);
  const viewport=useRef<HTMLDivElement>(null);
  const [area,setArea]=useState({width:520,height:310});
  const source=useRef(node).current;
  const staleText='图示或文档版本已变更，请关闭预览后重新识别。';

  const current=(revision?:number)=>{
    const snapshot=controller.getSnapshot().document;
    const page=snapshot.pages.find(item=>item.page_no===pageNo);
    const latest=page?.nodes.find(item=>item.id===source.id);
    return page&&(latest===source||same(latest,source))&&(revision===undefined||snapshot.revision===revision)?{snapshot,page}:null;
  };
  const matches=(preview:FigureVectorization,revision:number)=>
    preview.source_node_id===source.id&&preview.source_revision===revision&&!!current(revision);

  const enhance=async(preview:FigureVectorization,signal:AbortSignal)=>{
    setEnhancing(true);setVisionError('');
    const timeout=AbortSignal.timeout(20_000);
    try {
      if(!current(preview.source_revision))throw new Error(staleText);
      const enriched=await vectorizeFigure(materialId,pageNo,source.id,preview.source_revision,'vision',AbortSignal.any([signal,timeout]),preview.preview_id);
      if(signal.aborted)return;
      if(enriched.preview_id!==preview.preview_id||!matches(enriched,preview.source_revision))throw new Error(staleText);
      if(enriched.diagnostics?.vision_status==='failed')throw new Error(enriched.diagnostics.warnings?.join('。')||'请稍后重试。');
      setResult(enriched);
    }catch(reason){
      if(!signal.aborted)setVisionError(timeout.aborted?'视觉服务响应超过 20 秒。':errorMessage(reason));
    }finally{
      if(!signal.aborted)setEnhancing(false);
    }
  };

  useEffect(()=>{
    const element=dialog.current;
    element?.showModal();
    return()=>element?.close();
  },[]);
  useEffect(()=>{
    const element=viewport.current;
    if(!element)return;
    const observer=new ResizeObserver(([entry])=>{
      if(entry)setArea({width:entry.contentRect.width,height:entry.contentRect.height});
    });
    observer.observe(element);
    return()=>observer.disconnect();
  },[]);
  useEffect(()=>{
    const active=new AbortController();
    request.current=active;
    const {signal}=active;
    setBusy(true);setError('');setVisionError('');setEnhancing(false);
    const recognize=async()=>{
      try {
        if(!await controller.save())throw new Error('请先同步当前修改，再识别图示。');
        if(signal.aborted)return;
        const saved=current();
        if(!saved)throw new Error(staleText);
        const revision=saved.snapshot.revision;
        const preview=await vectorizeFigure(materialId,pageNo,source.id,revision,'pixel',signal);
        if(signal.aborted)return;
        if(!matches(preview,revision))throw new Error(staleText);
        setResult(preview);
        if(preview.vision_available)void enhance(preview,signal);
      }catch(reason){
        if(!signal.aborted)setError(errorMessage(reason));
      }finally{
        if(!signal.aborted)setBusy(false);
      }
    };
    void recognize();
    return()=>active.abort();
  },[attempt,controller,materialId,pageNo,source]);

  const close=()=>{request.current?.abort();onClose();};
  const apply=()=>{
    if(!result?.cleaned_asset_id||!result.cleaned_url||!result.nodes.length)return;
    const target=current(result.source_revision);
    if(!target){setError(staleText);return;}
    const existing=new Set(target.page.nodes.filter(item=>!item.deleted).map(item=>item.id));
    const generated=result.nodes;
    const generatedIds=new Set(generated.map(item=>item.id));
    if(source.cleaned_asset_id||generatedIds.size!==generated.length||generated.some(item=>existing.has(item.id))){
      setError('这张图片已有关联对象，请重新选择图示。');return;
    }
    const updated=target.page.nodes.filter(item=>!generatedIds.has(item.id)).map(item=>item.id===source.id?{
      ...item,cleaned_asset_id:result.cleaned_asset_id,cleaned_url:result.cleaned_url,figure_scene:result.scene,
    }:item);
    const nextNodes=[...updated,...generated];
    const nextNodeIds=new Set(nextNodes.filter(item=>!item.deleted).map(item=>item.id));
    const incomingRelations=result.relations??[];
    const incomingRelIds=new Set(incomingRelations.map(rel=>rel.id));
    const figureRelReferences=(rel:import('@/document/types').SceneRelation)=>{
      if(rel.kind==='basis_decompose')return [rel.firstId,rel.secondId,rel.resultId,...(rel.guideIds??[]),...(rel.labelId?[rel.labelId]:[])];
      if(rel.kind==='linear_combo')return [rel.firstId,rel.secondId,rel.targetId,...(rel.guideIds??[])];
      if(rel.kind==='guide_bind')return [rel.targetId,rel.from.nodeId,rel.to.nodeId];
      return [rel.targetId];
    };
    const preservedRelations=(target.page.relations??[]).filter(rel=>
      !incomingRelIds.has(rel.id)&&figureRelReferences(rel).every(id=>nextNodeIds.has(id)&&!generatedIds.has(id)),
    );
    const nextRelations=[...preservedRelations,...incomingRelations];
    controller.replace({...target.snapshot,pages:target.snapshot.pages.map(item=>item.page_no===pageNo?{
      ...item,modified:true,nodes:nextNodes,
      ...(nextRelations.length||(item.relations?.length)?{relations:nextRelations}:{}),
    }:item)});
    close();onApplied(new Set(generated.map(item=>item.figure_object_id??item.id)).size);
  };

  const radians=source.rotation*Math.PI/180;
  const width=Math.abs(source.width*Math.cos(radians))+Math.abs(source.height*Math.sin(radians));
  const height=Math.abs(source.width*Math.sin(radians))+Math.abs(source.height*Math.cos(radians));
  const x=source.x+(source.width-width)/2;
  const y=source.y+(source.height-height)/2;
  const scale=Math.min(area.width/width,area.height/height);
  const useCrop=mode!=='demo'&&!!result?.source_url;
  const backdrop:SceneNode={...source,x:source.x-x,y:source.y-y,opacity:mode==='overlay'&&result?.scene.objects.length?0.35:1,
    cleaned_asset_id:mode==='demo'?result?.cleaned_asset_id:null,cleaned_url:result?.cleaned_url,
    ...(useCrop?{image_data:undefined,image_url:result?.source_url,crop:undefined,image_frame:source.crop?undefined:source.image_frame}:{}),
    matrix_ocr:undefined,
  };
  const overlays=mode==='original'?[]:(result?.nodes??[]).map(item=>({...item,x:item.x-x,y:item.y-y}));
  const warnings=[...new Set([...(result?.scene.warnings??[]),...(result?.diagnostics?.warnings??[])])];
  const candidates=result?.scene.objects.length??0;
  const applicableIds=new Set(result?.nodes.map(item=>item.figure_object_id??item.id));
  const applicable=applicableIds.size;
  const proofOnly=result?.scene.objects.filter(item=>!applicableIds.has(item.id))??[];
  const canApply=!!(result?.nodes.length&&result.cleaned_asset_id&&result.cleaned_url&&!error);
  const demoAvailable=!!(result?.cleaned_asset_id&&result.cleaned_url);

  return <dialog ref={dialog} className={styles.vectorizeDialog} aria-labelledby="figure-vectorization-title" onCancel={event=>{event.preventDefault();close();}}>
    <header className={styles.vectorizeHeader}>
      <div><h2 id="figure-vectorization-title">矢量化此图</h2><p>{source.name}</p></div>
      <button type="button" onClick={close} aria-label="关闭矢量化预览" autoFocus>关闭</button>
    </header>
    <div className={styles.vectorizeModes} aria-label="图示预览方式" role="group">
      <button type="button" aria-pressed={mode==='original'} onClick={()=>setMode('original')}>原图</button>
      <button type="button" aria-pressed={mode==='overlay'} onClick={()=>setMode('overlay')}>校对叠图</button>
      <button type="button" aria-pressed={mode==='demo'} onClick={()=>setMode('demo')} disabled={!demoAvailable}>演示效果</button>
    </div>
    <div className={styles.vectorizeViewport} ref={viewport} aria-label="图示预览">
      {scale>0&&<div className={styles.vectorizeCanvas} style={{width:width*scale,height:height*scale}}>
        <ScenePageView page={{page_no:pageNo,width,height,nodes:[backdrop,...overlays],relations:mode==='original'?[]:(result?.relations??[])}} scale={scale}>
          {mode==='overlay'&&result&&proofOnly.length>0&&<div className={styles.vectorizeCandidates}
            style={{left:backdrop.x,top:backdrop.y,width:source.width,height:source.height,transform:`rotate(${source.rotation}deg)`}}>
            <svg aria-label="仅供校对的候选" viewBox={`0 0 ${result.scene.frame.width} ${result.scene.frame.height}`} preserveAspectRatio="none"
              style={backdrop.image_frame&&backdrop.image_size?{
                left:-backdrop.image_frame[0],top:-backdrop.image_frame[1],width:backdrop.image_size[0],height:backdrop.image_size[1],
              }:undefined}>
              {proofOnly.map(item=>item.type==='text'?
                (item.bbox?<rect key={item.id} data-figure-candidate x={item.bbox[0]} y={item.bbox[1]} width={item.bbox[2]-item.bbox[0]} height={item.bbox[3]-item.bbox[1]}/>:
                  <circle key={item.id} data-figure-candidate cx={item.points[0]?.[0]} cy={item.points[0]?.[1]} r={4}/> ):
                <polyline key={item.id} data-figure-candidate points={item.points.map(point=>point.join(',')).join(' ')}/>)}
            </svg>
          </div>}
        </ScenePageView>
      </div>}
    </div>
    {error&&<div className={styles.vectorizeMessage} role="alert">{error} {!result&&<button type="button" onClick={()=>retry(value=>value+1)}>重试识别</button>}</div>}
    <p className={styles.vectorizeMessage} role="status">
      {busy?'正在从原图提取图示…':result?`识别 ${candidates} 个候选 · ${canApply?applicable:0} 个可应用对象`:null}
      {enhancing?' · 正在进行视觉增强':null}
      {result&&!result.vision_available?' · 使用本地像素识别':null}
    </p>
    {result&&!canApply&&!error&&<p className={styles.vectorizeMessage}>{candidates?'可校对已识别的候选，也可以手动描线。':'未找到可应用的图示对象，可以手动添加线条或箭头。'}</p>}
    {mode==='overlay'&&proofOnly.length>0&&<p className={styles.vectorizeMessage}>琥珀色虚线标出 {proofOnly.length} 个仅供校对的候选。</p>}
    {visionError&&<div className={styles.vectorizeMessage} role="alert">视觉增强失败，已保留当前预览。{visionError}
      {result&&request.current&&<button type="button" disabled={enhancing} onClick={()=>request.current&&void enhance(result,request.current.signal)}>重试增强</button>}
    </div>}
    {warnings.length>0&&<details className={styles.vectorizeMessage}><summary>查看识别提示（{warnings.length}）</summary><ul>{warnings.map(warning=><li key={warning}>{warning}</li>)}</ul></details>}
    <footer className={styles.vectorizeFooter}>
      <button type="button" onClick={()=>{close();onManual(false);}}>手动添加线条</button>
      <button type="button" onClick={()=>{close();onManual(true);}}>手动添加箭头</button>
      <button type="button" className={styles.vectorizeApply} disabled={!canApply} onClick={apply}>应用到文档</button>
    </footer>
  </dialog>;
}
