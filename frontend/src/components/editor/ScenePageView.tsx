import { useEffect, useState } from 'react';
import { VectorLine, VectorControls } from './VectorLine';
import {MathSceneView,MathSceneControls} from './MathSceneView';
import {SlideDiagramNode} from './SlideDiagramNode';
import {SlideDemoNode} from './SlideDemoNode';
import { BasisRelationOverlay, useBasisPlayback } from './BasisComposition';
import {memo,type CSSProperties,type ReactNode} from 'react';
import { allowsViewerParameter, evaluatePageRelations, normalizePageRelations, relationDependencies } from '@/document/relations';
import type {NodePatch,SceneNode,ScenePage,TextStyle} from '@/document/types';
import {resizeVector} from '@/document/vectorGeometry';
import {same} from '@/document/model';
import {resolveMatrixSource} from '@/document/mathScene';
import {MatrixImageLayer} from '@/components/presentation/live/LiveLayer';
import {VegaSpecView} from '@/components/ispec/views/VegaSpecView';
import type {ISpec} from '@/ispec/types';
import styles from './ScenePageView.module.css';

export function textCss(style:Partial<TextStyle>):CSSProperties {
  return {fontFamily:style.font_family,fontSize:style.font_size,color:style.color,
    fontWeight:style.bold===undefined?undefined:style.bold?'bold':'normal',fontStyle:style.italic===undefined?undefined:style.italic?'italic':'normal',textDecoration:style.underline===undefined?undefined:style.underline?'underline':'none',
    letterSpacing:typeof style.letter_spacing==='number'?style.letter_spacing:undefined,
    textAlign:style.align,lineHeight:style.line_height??1.15};
}
/**
 * Placed raster geometry measured by the PowerPoint exporter.  PowerPoint
 * exports overflow text and shadows, so the bitmap is larger than the shape
 * frame; placing it at its measured offset keeps glyphs at their original
 * aspect instead of stretching them into the text box.
 */
export function rasterCss(node:SceneNode,which:'image'|'background'):CSSProperties {
  const frame=which==='image'?node.image_frame:node.background_frame;
  const scale=which==='image'?node.image_scale:node.background_scale;
  const size=which==='image'?node.image_size:node.background_size;
  if(frame&&size&&scale&&scale>0) return {left:-frame[0],top:-frame[1],width:size[0],height:size[1]};
  return {inset:0,width:'100%',height:'100%'};
}
export function textChanged(node:SceneNode){return node.text!==node.base_text||!same(node.style,node.base_style)||
  (node.base_width!==undefined&&node.width!==node.base_width)||(node.base_height!==undefined&&node.height!==node.base_height);}
function TextContent({node}:{node:SceneNode}){
  const style=node.style;
  const changedFields=Object.keys(style).filter(k=>!same(style[k as keyof TextStyle],node.base_style[k as keyof TextStyle]));
  const nowrap=node.word_wrap===false;
  const baseParagraphs=node.paragraphs??[];
  const textParagraphs=node.text===node.base_text
    ? baseParagraphs
    : node.text.split('\n').map((text,index)=>{
        const original=baseParagraphs[index];
        return {text,align:freeAlign(original?.align,style.align),line_height:original?.line_height,
          line_spacing_pt:original?.line_spacing_pt,space_before:original?.space_before,space_after:original?.space_after,runs:[]};
      });
  return <div className={styles.textFrame} style={{padding:`${style.padding_top??0}px ${style.padding_right??0}px ${style.padding_bottom??0}px ${style.padding_left??0}px`,
    justifyContent:style.vertical_align==='middle'?'center':style.vertical_align==='bottom'?'flex-end':'flex-start',
    whiteSpace:nowrap?'pre':'pre-wrap',...textCss(style)}}>
    <div className={styles.textContent} data-text-content
      style={nowrap?{width:'max-content',overflowWrap:'normal',wordBreak:'normal'}:undefined}>
      {textParagraphs?.length?textParagraphs.map((p,i)=><p key={i} style={{
        textAlign:changedFields.includes('align')?style.align:p.align,
        lineHeight:typeof p.line_spacing_pt==='number'?`${p.line_spacing_pt}px`:(p.line_height??style.line_height??1.15),
        marginTop:p.space_before, marginBottom:p.space_after,
      }}>
        {'runs'in p&&p.runs.length?p.runs.map((run,j)=>{
          const specific={...run.style};for(const key of changedFields)delete specific[key as keyof TextStyle];
          return <span key={j} style={textCss(specific)}>{run.text}</span>;
        }):(p.text||'\u200b')}
      </p>):node.text}
    </div>
  </div>;
}
function freeAlign(value:TextStyle['align']|undefined,fallback:TextStyle['align']|undefined){return value??fallback??'left';}
function ChartContent({node}:{node:SceneNode}){
  const data=node.chart;if(!data)return null;
  const rows=data.series.flatMap(series=>data.categories.map((category,i)=>[category,series.name,series.values[i]??0]));
  const spec:ISpec={spec_version:'1.0',object_id:node.id,kind:'filter',parameters:[],
    datasets:[{id:'data',columns:['category','series','value'],rows}],views:[]};
  return <div className={styles.chart}><VegaSpecView spec={spec} evaluation={{values:{},derived:{},violations:[]}}
    view={{type:'vega',spec_ref:data.chart_type?.includes('LINE')?'line':'bar',dataset:'data',x:'category',y:'value',title:data.title??node.name}} reducedMotion/></div>;
}
const NodeView=memo(function NodeView({node,editing,editingText,onText,onCompose,onTextBlur,selectable,proofFigures,basisCoordLabel}:{node:SceneNode;editing:boolean;editingText:boolean;proofFigures?:boolean;
  onText?:(id:string,text:string)=>void;onCompose?:(composing:boolean)=>void;onTextBlur?:()=>void;selectable:boolean;basisCoordLabel?:boolean}){
  const changed=textChanged(node);
  const clean=node.type==='image'&&node.cleaned_asset_id&&node.cleaned_url;
  const src=(!proofFigures&&clean)||node.image_data||node.image_url;
  const transform=`rotate(${node.rotation}deg)${node.text_transform?` matrix(${node.text_transform.join(',')},0,0)`:''}`;
  const crop=node.crop;const imageStyle:CSSProperties=crop?{position:'absolute',width:`${100/(1-crop.left-crop.right)}%`,height:`${100/(1-crop.top-crop.bottom)}%`,
    left:`${-100*crop.left/(1-crop.left-crop.right)}%`,top:`${-100*crop.top/(1-crop.top-crop.bottom)}%`}:{};
  const tableChanged=node.type==='table'&&!same(node.table,node.base_table);
  const chartChanged=node.type==='chart'&&!same(node.chart,node.base_chart);
  return <div className={styles.node} data-node-id={node.id} data-node-type={node.type} data-locked={node.locked}
    data-basis-coordinates={basisCoordLabel?true:undefined}
    role={selectable?'button':undefined} tabIndex={selectable?0:undefined} aria-label={selectable?`选择：${node.text?.slice(0,28)||node.name}`:undefined}
    style={{left:node.x,top:node.y,width:node.width,height:node.height,transform,zIndex:node.z+10001,opacity:node.opacity*(proofFigures&&clean?0.35:1),
      pointerEvents:editing?'auto':'none'}}>
    {editingText?<>
      {node.background_url&&<img className={styles.raster} src={node.background_url} style={rasterCss(node,'background')} alt="" draggable={false}/>}
      <textarea autoFocus aria-label="画布文字编辑" className={styles.inlineText} value={node.text} style={{...textCss(node.style),padding:`${node.style.padding_top??0}px ${node.style.padding_right??0}px ${node.style.padding_bottom??0}px ${node.style.padding_left??0}px`}}
        onChange={e=>onText?.(node.id,e.target.value)} onBlur={onTextBlur} onCompositionStart={()=>onCompose?.(true)} onCompositionEnd={()=>onCompose?.(false)}
        onPointerDown={e=>e.stopPropagation()} onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();onTextBlur?.();}}}/>
    </>:node.type==='text'&&changed?<>
      {node.background_url&&<img className={styles.raster} src={node.background_url} style={rasterCss(node,'background')} alt="" draggable={false}/>}
      <TextContent node={node}/>
    </>:tableChanged?<table className={styles.table} style={textCss(node.style)}><tbody>{node.table?.map((row,i)=><tr key={i}>{row.map((cell,j)=><td key={j}>{cell}</td>)}</tr>)}</tbody></table>:
      chartChanged?<ChartContent node={node}/>:
      node.type==='shape'&&(!src||!same(node.style,node.base_style))?<div className={styles.shape} style={{background:node.style.fill??'transparent',border:`${node.style.stroke_width??0}px solid ${node.style.stroke??'transparent'}`,borderRadius:node.shape==='ellipse'?'50%':0}}/>:
      src?(crop?<div className={styles.imageClip}><img className={styles.raster} src={src} style={imageStyle} alt="" draggable={false}/></div>:
        <img className={styles.raster} src={src} style={rasterCss(node,'image')} alt="" draggable={false}/>):
      node.type==='text'?<TextContent node={node}/>:null}
  </div>;
});
interface Props {page:ScenePage;scale:number;editing?:boolean;editingId?:string|null;preview?:Record<string,Partial<SceneNode>>;children?:ReactNode;
  onText?:(id:string,text:string)=>void;onCompose?:(composing:boolean)=>void;onTextBlur?:()=>void; presentVectors?:boolean; vectorId?:string;
  onVectorSelect?:(id:string)=>void; onVectorPatch?:(id:string, patch:import('@/document/types').NodePatch,key?:string)=>void;
  onGenerateDemo?:(id:string)=>void;generating?:Record<string,boolean>;proofFigures?:boolean;}
export function ScenePageView({page,scale,editing=false,editingId,preview,children,onText,onCompose,onTextBlur,presentVectors,vectorId,onVectorSelect,onVectorPatch,onGenerateDemo,generating,proofFigures}:Props){
  const frozen=page.preparation?.frozen_ids??[];
  const rawVisible = page.nodes.filter(n=>!n.deleted&&!n.hidden&&!frozen.includes(n.id));
  const [liveDrafts, setLiveDrafts] = useState<Record<string, NodePatch>>({});
  const [resetVersion,setResetVersion]=useState(0);
  const [overrides, setOverrides] = useState<Record<string, NodePatch>>({});
  useEffect(()=>{setOverrides({});setLiveDrafts({});setChoice(undefined);setResetVersion(v=>v+1);},[page.page_no,page.id]);
  const [scaleFactor, setScaleFactor] = useState(1);
  const [rotateOffset, setRotateOffset] = useState(0);
  const [stepState, setStepState] = useState<{ target: number | null; progress: number }>({ target: null, progress: 1 });
  const [choice, setChoice] = useState<string>();
  useEffect(() => {
    if (stepState.target === null || stepState.progress >= 1) return;
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setStepState(current => ({ ...current, progress: 1 }));
      return;
    }
    let frame = 0;
    let start: number | undefined;
    const tick = (time: number) => {
      start ??= time;
      const elapsed = Math.min(1, (time - start) / 650);
      setStepState(current => current.target === null ? current : { ...current, progress: elapsed });
      if (elapsed < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [stepState.target, stepState.progress]);
  const canChangeGeometry = (node:SceneNode)=>allowsViewerParameter(node, 'geometry', editing);
  const editableVector = (node:SceneNode)=>node.viewer_editable!==false&&!node.locked;
  const applyBaseOverrides = (node: SceneNode) => {
    const previewPatch = preview?.[node.id];
    let current = previewPatch ? {...node, ...previewPatch, style: {...node.style, ...previewPatch.style}} : node;
    const patch = presentVectors ? overrides[node.id] : undefined;
    if (patch) current = {...current, ...patch, style: {...current.style, ...patch.style}};
    if (presentVectors&&canChangeGeometry(current)) {
      if (current.style.bind_mode === 'scale' && scaleFactor !== 1) {
        const resized = resizeVector(current, Math.max(0.1, current.width * scaleFactor), current.rotation);
        if (resized) current = { ...current, ...resized };
      } else if (current.style.bind_mode === 'rotate' && rotateOffset !== 0) {
        const rotated = resizeVector(current, current.width, current.rotation + rotateOffset);
        if (rotated) current = { ...current, ...rotated };
      }
    }
    if(current.math_scene){
      const sources=page.nodes.map(source=>presentVectors&&overrides[source.id]?{...source,...overrides[source.id],style:{...source.style,...overrides[source.id]?.style}}:source);
      current={...current,math_scene:resolveMatrixSource(current.math_scene,sources)};
    }
    return current;
  };
  const normalizedRelations = normalizePageRelations(rawVisible, page.relations);
  const primaryBasisRel = normalizedRelations.find((r): r is Extract<typeof r, {kind:'basis_decompose'}> => r.kind === 'basis_decompose' && r.enabled !== false);
  const playback = useBasisPlayback(primaryBasisRel ? `${primaryBasisRel.id}:${resetVersion}` : undefined);
  const relationEval = evaluatePageRelations(
    rawVisible.map(applyBaseOverrides),
    page.relations,
    liveDrafts,
    { basisProgress: playback.value },
  );
  const visible = relationEval.nodes;
  const vectors = visible.filter(node=>node.type==='vector');
  const mathNodes = visible.filter(node=>node.type==='math_scene');
  const richNodes = visible.filter(node=>node.type==='diagram'||node.type==='demo');
  const matrixImages = visible.filter(node=>node.type==='image'&&node.matrix_ocr);
  const basisActive = relationEval.overlays.length > 0;
  const basisLabelIds = new Set(
    normalizedRelations
      .filter((r): r is Extract<typeof r, {kind:'basis_decompose'}> => r.kind === 'basis_decompose' && r.enabled !== false && !!r.labelId)
      .map(r => r.labelId!),
  );
  const derivedOutputIds = new Set<string>();
  const legacyFixedIds = new Set<string>();
  const legacySecondOnlyIds = new Set<string>();
  for (const rel of normalizedRelations) {
    if (rel.enabled === false) continue;
    const { outputs } = relationDependencies(rel);
    for (const outId of outputs) derivedOutputIds.add(outId);
    if (rel.kind === 'basis_decompose' && rel.provenance === 'legacy') {
      legacyFixedIds.add(rel.firstId);
      legacyFixedIds.add(rel.resultId);
      legacySecondOnlyIds.add(rel.secondId);
    }
  }
  const fixed = (node: SceneNode) =>
    !!presentVectors && (
      !editableVector(node) ||
      derivedOutputIds.has(node.id) ||
      (node.viewer_editable === undefined && legacyFixedIds.has(node.id))
    );
  const hasScaleBind = vectors.some(node => node.style.bind_mode === 'scale'&&canChangeGeometry(node)&&!fixed(node));
  const hasRotateBind = vectors.some(node => node.style.bind_mode === 'rotate'&&canChangeGeometry(node)&&!fixed(node));
  const animSteps = [...new Set(vectors.map(node => node.style.anim_step ?? 0).filter(step => step >= 1))].sort((a, b) => a - b);
  const defaultMovable = primaryBasisRel ? vectors.find(node => node.id === primaryBasisRel.secondId && !fixed(node)) : undefined;
  const selected = vectors.find(node=>node.id===choice && !fixed(node)) ?? defaultMovable ?? vectors.find(node=>!fixed(node)) ?? vectors[0];
  const selectedMath = mathNodes.find(node=>node.id===choice)??mathNodes[0];
  const vectorProgress = (node: SceneNode) => {
    const step = node.style.anim_step ?? 0;
    if (!presentVectors || !step || stepState.target === null) return 1;
    if (step < stepState.target) return 1;
    if (step === stepState.target) return stepState.progress;
    return 0;
  };
  const updateLiveDraft = (id: string, patch: NodePatch | null) => {
    setLiveDrafts(current => {
      if (!patch) {
        if (!(id in current)) return current;
        const next = { ...current };
        delete next[id];
        return next;
      }
      return { ...current, [id]: patch };
    });
  };
  const change = (id: string, patch: NodePatch,key?:string) => {
    const target=visible.find(node=>node.id===id);
    if(target?.locked||(!editing&&target?.viewer_editable===false))return;
    if (!presentVectors) { onVectorPatch?.(id, patch,key); return; }
    setChoice(id);
    setOverrides(current=>({...current,[id]:{...current[id],...patch,style:{...current[id]?.style,...patch.style}}}));
  };
  return <div className={styles.canvas} style={{width:page.width,height:page.height,transform:`scale(${scale})`}} data-scene-page={page.page_no}>
    <div className={styles.contentLayer}>
      {page.background_url&&<img className={styles.pageBackground} src={page.background_url} alt="" draggable={false}/>}
      {visible.filter(node=>node.type!=='vector'&&node.type!=='math_scene'&&node.type!=='diagram'&&node.type!=='demo').map(node=><NodeView key={node.id} node={node}
        basisCoordLabel={basisLabelIds.has(node.id)}
        editing={editing} editingText={editingId===node.id} selectable={editing} proofFigures={proofFigures} onText={onText} onCompose={onCompose} onTextBlur={onTextBlur}/>)}
      {matrixImages.map(node=><MatrixImageLayer key={node.id} node={node} interactive={presentVectors||editing}
        onPatch={(patch,key)=>change(node.id,patch,key)}/>)}
      {vectors.map(node=>{
        const canEditVector = !node.locked && (
          (!!presentVectors && !fixed(node) && canChangeGeometry(node)) ||
          (editing && vectorId===node.id && !!onVectorPatch)
        );
        const dragStart = editing ? true : (allowsViewerParameter(node, 'start', false) && !(legacySecondOnlyIds.has(node.id) && !node.viewer_parameters));
        const dragEnd = editing ? true : allowsViewerParameter(node, 'end', false);
        return <VectorLine key={node.id} node={node}
          progress={vectorProgress(node)}
          onSelect={presentVectors && !fixed(node) ? ()=>setChoice(node.id) : editing && onVectorSelect ? ()=>onVectorSelect(node.id) : undefined}
          canDragStart={dragStart}
          canDragEnd={dragEnd}
          onPreview={canEditVector ? patch => updateLiveDraft(node.id, patch) : undefined}
          onCommit={canEditVector ? patch => { updateLiveDraft(node.id, null); change(node.id, patch); } : undefined}/>;
      })}
      {mathNodes.map(node=><div key={node.id} data-node-id={node.id} data-node-type="math_scene" style={{display:'contents'}}
        onPointerDown={event=>{if(editing)onVectorSelect?.(node.id);else {setChoice(node.id);event.stopPropagation();}}}>
        <MathSceneView key={`${node.id}:${resetVersion}`} node={node}
          editing={editing} interactive={(presentVectors&&editableVector(node))|| (editing&&vectorId===node.id&&!node.locked)} onPatch={(patch,key)=>change(node.id,patch,key)}/>
      </div>)}
      {richNodes.map(node=>{
        const props={node,editing,interactive:!!presentVectors||(editing&&vectorId===node.id),onPatch:(patch:NodePatch,key?:string)=>change(node.id,patch,key)};
        return <div key={node.id} data-node-id={node.id} data-node-type={node.type} style={{display:'contents'}}
          onPointerDown={()=>{if(editing)onVectorSelect?.(node.id);}}>
          {node.type==='diagram'?<SlideDiagramNode key={`${node.id}:${resetVersion}`} {...props}/>:
            <SlideDemoNode key={`${node.id}:${resetVersion}`} {...props} generating={generating?.[node.id]} onGenerate={onGenerateDemo?()=>onGenerateDemo(node.id):undefined}/>}
        </div>;
      })}
      {relationEval.overlays.map(ov => <BasisRelationOverlay key={ov.relationId} overlay={ov} progress={playback.value}/>)}
    </div>
    {presentVectors && selected && !fixed(selected) && <div className={styles.vectorControls} data-no-pan aria-label="放映线条控制">
      {vectors.filter(node=>!fixed(node)).length>1 && <select aria-label="选择线条" value={selected.id} onChange={e=>setChoice(e.target.value)}>
        {vectors.filter(node=>!fixed(node)).map((node,i)=><option key={node.id} value={node.id}>{node.name} {i+1}</option>)}
      </select>}
      {editableVector(selected) && <VectorControls node={selected} onPatch={patch=>change(selected.id,patch)}/>}
      {hasScaleBind && <label>联动倍率<input type="range" aria-label="联动倍率" min="0.2" max="2.5" step="0.05"
        value={scaleFactor} onChange={e=>setScaleFactor(Number(e.target.value))}/></label>}
      {hasRotateBind && <label>联动角度<input type="range" aria-label="联动角度" min="-180" max="180" step="1"
        value={rotateOffset} onChange={e=>setRotateOffset(Number(e.target.value))}/></label>}
      <button type="button" onClick={()=>{setOverrides({});setLiveDrafts({});setScaleFactor(1);setRotateOffset(0);setStepState({target:null,progress:1});}}>重置线条</button>
      {animSteps.map(step => <button key={step} type="button" onClick={()=>setStepState({target:step,progress:0})}>第 {step} 步</button>)}
      {animSteps.length>0 && stepState.target!==null && <button type="button" onClick={()=>setStepState({target:null,progress:1})}>全部显示</button>}
      {basisActive && <>
        <button type="button" disabled={!!playback.animation} onClick={()=>playback.play(1)}>第 1 步：沿 b₁</button>
        <button type="button" disabled={!!playback.animation || playback.completed<1} onClick={()=>playback.play(2)}>第 2 步：沿 b₂</button>
      </>}
    </div>}
    {editing&&visible.find(node=>node.id===vectorId&&(node.type==='vector'||node.type==='math_scene')&&!node.locked)&&(()=>{
      const node=visible.find(node=>node.id===vectorId)!;
      const toolbarWidth=Math.min(530,page.width*scale-16);
      const left=Math.max(8/scale,Math.min(node.x,page.width-(toolbarWidth+8)/scale));
      const top=node.type==='math_scene'?node.y+node.height+12/scale:
        node.y>=132/scale?node.y-132/scale:node.y+node.height+16/scale;
      return <div className={styles.inlineControls} data-no-pan aria-label="原位图形属性"
        style={{left,top,width:toolbarWidth,transform:`scale(${1/scale})`,transformOrigin:'top left'}}
        onPointerDown={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()}>
        {node.type==='vector'?<VectorControls node={node} onPatch={(patch,key)=>onVectorPatch?.(node.id,patch,key)} author/>:
          <MathSceneControls key={node.id} node={node} onPatch={(patch,key)=>onVectorPatch?.(node.id,patch,key)} author compact hidePlayback/>}
      </div>;
    })()}
    {presentVectors&&selectedMath&&<div className={styles.mathPresentationControls} data-no-pan aria-label="放映数学图控制">
      <details open={selectedMath.math_scene?.template?undefined:true}>
      <summary>图形参数</summary>
      {mathNodes.length>1&&<select aria-label="选择数学图" value={selectedMath.id} onChange={e=>setChoice(e.target.value)}>{mathNodes.map(node=><option key={node.id} value={node.id}>{node.name}</option>)}</select>}
      {editableVector(selectedMath)&&<MathSceneControls key={`${selectedMath.id}:${resetVersion}`} node={selectedMath} onPatch={patch=>change(selectedMath.id,patch)} hidePlayback={!!selectedMath.math_scene?.template}/>}
      </details>
    </div>}
    {presentVectors&&(vectors.length>0||mathNodes.length>0||matrixImages.length>0||richNodes.length>0)&&<button className={styles.resetDynamics} type="button" data-no-pan onClick={()=>{
      setOverrides({});setLiveDrafts({});setScaleFactor(1);setRotateOffset(0);setStepState({target:null,progress:1});setResetVersion(v=>v+1);
    }}>一键重置</button>}
    {children}
  </div>;
}
