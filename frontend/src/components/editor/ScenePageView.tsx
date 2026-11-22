import { useEffect, useState } from 'react';
import { VectorLine, VectorControls } from './VectorLine';
import {MathSceneView,MathSceneControls} from './MathSceneView';
import {SlideDiagramNode} from './SlideDiagramNode';
import {SlideDemoNode} from './SlideDemoNode';
import { BasisComposition, useBasisPlayback } from './BasisComposition';
import {memo,type CSSProperties,type ReactNode} from 'react';
import type {SceneNode,ScenePage,TextStyle} from '@/document/types';
import {resizeVector,type vectorGeometry} from '@/document/vectorGeometry';
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
const NodeView=memo(function NodeView({node,editing,editingText,onText,onCompose,onTextBlur,selectable}:{node:SceneNode;editing:boolean;editingText:boolean;
  onText?:(id:string,text:string)=>void;onCompose?:(composing:boolean)=>void;onTextBlur?:()=>void;selectable:boolean}){
  const changed=textChanged(node);const src=node.image_data||node.image_url;
  const crop=node.crop;const imageStyle:CSSProperties=crop?{position:'absolute',width:`${100/(1-crop.left-crop.right)}%`,height:`${100/(1-crop.top-crop.bottom)}%`,
    left:`${-100*crop.left/(1-crop.left-crop.right)}%`,top:`${-100*crop.top/(1-crop.top-crop.bottom)}%`}:{};
  const tableChanged=node.type==='table'&&!same(node.table,node.base_table);
  const chartChanged=node.type==='chart'&&!same(node.chart,node.base_chart);
  return <div className={styles.node} data-node-id={node.id} data-node-type={node.type} data-locked={node.locked}
    role={selectable?'button':undefined} tabIndex={selectable?0:undefined} aria-label={selectable?`选择：${node.text?.slice(0,28)||node.name}`:undefined}
    style={{left:node.x,top:node.y,width:node.width,height:node.height,transform:`rotate(${node.rotation}deg)`,zIndex:node.z+10001,opacity:node.opacity,
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
  onGenerateDemo?:(id:string)=>void;generating?:Record<string,boolean>;}
export function ScenePageView({page,scale,editing=false,editingId,preview,children,onText,onCompose,onTextBlur,presentVectors,vectorId,onVectorSelect,onVectorPatch,onGenerateDemo,generating}:Props){
  const frozen=page.preparation?.frozen_ids??[];
  const visible = page.nodes.filter(n=>!n.deleted&&!n.hidden&&!frozen.includes(n.id));
  const vectors = visible.filter(node=>node.type==='vector');
  const mathNodes = visible.filter(node=>node.type==='math_scene');
  const richNodes = visible.filter(node=>node.type==='diagram'||node.type==='demo');
  const matrixImages = visible.filter(node=>node.type==='image'&&node.matrix_ocr);
  const basis = vectors.find(node=>node.basis)?.basis;
  const first = vectors.find(node=>node.id===basis?.firstId);
  const second = vectors.find(node=>node.id===basis?.secondId);
  const result = vectors.find(node=>node.id===basis?.resultId);
  const [basisDraft, setBasisDraft] = useState<ReturnType<typeof vectorGeometry>>(null);
  const [resetVersion,setResetVersion]=useState(0);
  const playback = useBasisPlayback(basis?`${basis.secondId}:${resetVersion}`:undefined);
  const basisActive = !!(basis && first && second && result);
  const fixed = (node: SceneNode) => presentVectors && basisActive && (node.id===first?.id || node.id===result?.id);
  const [overrides, setOverrides] = useState<Record<string, import('@/document/types').NodePatch>>({});
  useEffect(()=>{setOverrides({});setChoice(undefined);setResetVersion(v=>v+1);},[page.page_no,page.id]);
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
  const canChangeGeometry = (node:SceneNode)=>!node.locked&&node.viewer_editable!==false&&(!node.viewer_parameters||node.viewer_parameters.includes('geometry'));
  const hasScaleBind = vectors.some(node => node.style.bind_mode === 'scale'&&canChangeGeometry(node));
  const hasRotateBind = vectors.some(node => node.style.bind_mode === 'rotate'&&canChangeGeometry(node));
  const animSteps = [...new Set(vectors.map(node => node.style.anim_step ?? 0).filter(step => step >= 1))].sort((a, b) => a - b);
  const selected = vectors.find(node=>node.id===choice && !fixed(node)) ?? second ?? vectors[0];
  const selectedMath = mathNodes.find(node=>node.id===choice)??mathNodes[0];
  const editableVector = (node:SceneNode)=>node.viewer_editable!==false&&!node.locked;
  const withOverride = (node: SceneNode) => {
    const patch = presentVectors ? overrides[node.id] : undefined;
    let current = patch ? {...node,...patch,style:{...node.style,...patch.style}} : node;
    if (presentVectors&&canChangeGeometry(node)) {
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
  const vectorProgress = (node: SceneNode) => {
    const step = node.style.anim_step ?? 0;
    if (!presentVectors || !step || stepState.target === null) return 1;
    if (step < stepState.target) return 1;
    if (step === stepState.target) return stepState.progress;
    return 0;
  };
  const change = (id: string, patch: import('@/document/types').NodePatch,key?:string) => {
    const target=visible.find(node=>node.id===id);
    if(target?.locked||(!editing&&target?.viewer_editable===false))return;
    if (!presentVectors) { onVectorPatch?.(id, patch,key); return; }
    setChoice(id);
    setOverrides(current=>({...current,[id]:{...current[id],...patch,style:{...current[id]?.style,...patch.style}}}));
  };
  return <div className={styles.canvas} style={{width:page.width,height:page.height,transform:`scale(${scale})`}} data-scene-page={page.page_no}>
    <div className={styles.contentLayer}>
      {page.background_url&&<img className={styles.pageBackground} src={page.background_url} alt="" draggable={false}/>}
      {visible.filter(node=>node.type!=='vector'&&node.type!=='math_scene'&&node.type!=='diagram'&&node.type!=='demo').map(node=><NodeView key={node.id} node={preview?.[node.id]?{...node,...preview[node.id]}:node}
        editing={editing} editingText={editingId===node.id} selectable={editing} onText={onText} onCompose={onCompose} onTextBlur={onTextBlur}/>)}
      {matrixImages.map(node=><MatrixImageLayer key={node.id} node={withOverride(node)} interactive={presentVectors||editing}
        onPatch={(patch,key)=>change(node.id,patch,key)}/>)}
      {vectors.map(node=><VectorLine key={node.id} node={withOverride(preview?.[node.id] ? {...node,...preview[node.id]} : node)}
        progress={vectorProgress(node)}
        onSelect={presentVectors && !fixed(node) ? ()=>setChoice(node.id) : editing && onVectorSelect ? ()=>onVectorSelect(node.id) : undefined}
        endOnly={presentVectors && basisActive && node.id===second?.id}
        onPreview={basisActive && node.id===second?.id ? setBasisDraft : undefined}
        onCommit={!fixed(node) && !node.locked && ((presentVectors&&canChangeGeometry(node)) || (editing && vectorId===node.id && onVectorPatch)) ? patch=>change(node.id,patch) : undefined}/>)}
      {mathNodes.map(node=><div key={node.id} data-node-id={node.id} data-node-type="math_scene" style={{display:'contents'}}
        onPointerDown={event=>{if(editing)onVectorSelect?.(node.id);else {setChoice(node.id);event.stopPropagation();}}}>
        <MathSceneView key={`${node.id}:${resetVersion}`} node={withOverride(preview?.[node.id]?{...node,...preview[node.id]}:node)}
          editing={editing} interactive={(presentVectors&&editableVector(node))|| (editing&&vectorId===node.id&&!node.locked)} onPatch={(patch,key)=>change(node.id,patch,key)}/>
      </div>)}
      {richNodes.map(node=>{
        const shown=withOverride(preview?.[node.id]?{...node,...preview[node.id]}:node);
        const props={node:shown,editing,interactive:!!presentVectors||(editing&&vectorId===node.id),onPatch:(patch:import('@/document/types').NodePatch,key?:string)=>change(node.id,patch,key)};
        return <div key={node.id} data-node-id={node.id} data-node-type={node.type} style={{display:'contents'}}
          onPointerDown={()=>{if(editing)onVectorSelect?.(node.id);}}>
          {node.type==='diagram'?<SlideDiagramNode key={`${node.id}:${resetVersion}`} {...props}/>:
            <SlideDemoNode key={`${node.id}:${resetVersion}`} {...props} generating={generating?.[node.id]} onGenerate={onGenerateDemo?()=>onGenerateDemo(node.id):undefined}/>}
        </div>;
      })}
      {basis && first && second && result && <BasisComposition basis={basis} first={withOverride(first)}
        second={{...withOverride(second), ...basisDraft}} result={withOverride(result)} progress={playback.value}/>}
    </div>
    {presentVectors && selected && <div className={styles.vectorControls} data-no-pan aria-label="放映线条控制">
      {vectors.length>1 && <select aria-label="选择线条" value={selected.id} onChange={e=>setChoice(e.target.value)}>
        {vectors.filter(node=>!fixed(node)).map((node,i)=><option key={node.id} value={node.id}>{node.name} {i+1}</option>)}
      </select>}
      {editableVector(selected) && <VectorControls node={withOverride(selected)} onPatch={patch=>change(selected.id,patch)}/>}
      {hasScaleBind && <label>联动倍率<input type="range" aria-label="联动倍率" min="0.2" max="2.5" step="0.05"
        value={scaleFactor} onChange={e=>setScaleFactor(Number(e.target.value))}/></label>}
      {hasRotateBind && <label>联动角度<input type="range" aria-label="联动角度" min="-180" max="180" step="1"
        value={rotateOffset} onChange={e=>setRotateOffset(Number(e.target.value))}/></label>}
      <button type="button" onClick={()=>{setOverrides({});setScaleFactor(1);setRotateOffset(0);setStepState({target:null,progress:1});}}>重置线条</button>
      {animSteps.map(step => <button key={step} type="button" onClick={()=>setStepState({target:step,progress:0})}>第 {step} 步</button>)}
      {animSteps.length>0 && stepState.target!==null && <button type="button" onClick={()=>setStepState({target:null,progress:1})}>全部显示</button>}
      {basisActive && <>
        <button type="button" disabled={!!playback.animation} onClick={()=>playback.play(1)}>第 1 步：沿 b₁</button>
        <button type="button" disabled={!!playback.animation || playback.completed<1} onClick={()=>playback.play(2)}>第 2 步：沿 b₂</button>
      </>}
    </div>}
    {editing&&visible.find(node=>node.id===vectorId&&(node.type==='vector'||node.type==='math_scene')&&!node.locked)&&(()=>{
      const node=withOverride(visible.find(node=>node.id===vectorId)!);
      const toolbarWidth=Math.min(530,page.width*scale-16);
      const left=Math.max(8/scale,Math.min(node.x,page.width-(toolbarWidth+8)/scale));
      const top=node.type==='math_scene'?node.y+node.height+12/scale:
        node.y>=132/scale?node.y-132/scale:node.y+node.height+16/scale;
      return <div className={styles.inlineControls} data-no-pan aria-label="原位图形属性"
        style={{left,top,width:toolbarWidth,transform:`scale(${1/scale})`,transformOrigin:'top left'}}
        onPointerDown={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()}>
        {node.type==='vector'?<VectorControls node={node} onPatch={(patch,key)=>onVectorPatch?.(node.id,patch,key)} author/>:
          <MathSceneControls key={node.id} node={withOverride(node)} onPatch={(patch,key)=>onVectorPatch?.(node.id,patch,key)} author compact hidePlayback/>}
      </div>;
    })()}
    {presentVectors&&selectedMath&&<div className={styles.mathPresentationControls} data-no-pan aria-label="放映数学图控制">
      <details open={selectedMath.math_scene?.template?undefined:true}>
      <summary>图形参数</summary>
      {mathNodes.length>1&&<select aria-label="选择数学图" value={selectedMath.id} onChange={e=>setChoice(e.target.value)}>{mathNodes.map(node=><option key={node.id} value={node.id}>{node.name}</option>)}</select>}
      {editableVector(selectedMath)&&<MathSceneControls key={`${selectedMath.id}:${resetVersion}`} node={withOverride(selectedMath)} onPatch={patch=>change(selectedMath.id,patch)} hidePlayback={!!selectedMath.math_scene?.template}/>}
      </details>
    </div>}
    {presentVectors&&(vectors.length>0||mathNodes.length>0||matrixImages.length>0||richNodes.length>0)&&<button className={styles.resetDynamics} type="button" data-no-pan onClick={()=>{
      setOverrides({});setScaleFactor(1);setRotateOffset(0);setStepState({target:null,progress:1});setBasisDraft(null);setResetVersion(v=>v+1);
    }}>一键重置</button>}
    {children}
  </div>;
}
