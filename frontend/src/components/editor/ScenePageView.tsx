import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { VectorLine, VectorControls } from './VectorLine';
import {SlideDiagramNode} from './SlideDiagramNode';
import {SlideDemoNode} from './SlideDemoNode';
import {standaloneDemos} from './standaloneDemos';
import {SlideWorkshopPluginNode} from './SlideWorkshopPluginNode';
import { BasisRelationOverlay, useBasisPlayback } from './BasisComposition';
import {memo,type CSSProperties,type ReactNode} from 'react';
import { allowsViewerParameter, evaluatePageRelations, normalizePageRelations, relationDependencies } from '@/document/relations';
import type {NodePatch,SceneNode,ScenePage,SceneParagraph,TextStyle} from '@/document/types';
import {SHAPE_CATALOG} from '@/document/shapeCatalog';
import {displayParagraphs} from '@/document/richText';
import {InlineRichText} from './InlineRichText';
import {Formula} from '@/components/showcase/Formula';
import {resizeVector} from '@/document/vectorGeometry';
import {same} from '@/document/model';
import {VegaSpecView} from '@/components/ispec/views/VegaSpecView';
import type {ISpec} from '@/ispec/types';
import styles from './ScenePageView.module.css';

export function textCss(style:Partial<TextStyle>):CSSProperties {
  return {fontFamily:style.font_family,fontSize:style.font_size,color:style.color,
    fontWeight:style.bold===undefined?undefined:style.bold?'bold':'normal',fontStyle:style.italic===undefined?undefined:style.italic?'italic':'normal',textDecoration:style.underline===undefined?undefined:style.underline?'underline':'none',
    letterSpacing:typeof style.letter_spacing==='number'?style.letter_spacing:undefined,
    textAlign:style.align,lineHeight:style.line_height??1.15,backgroundColor:style.highlight,
    ...(style.baseline?{position:'relative',top:`${-style.baseline/100}em`}:{})};
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
  (node.base_paragraphs!==undefined&&!same(node.paragraphs??[],node.base_paragraphs))||
  (node.base_width!==undefined&&node.width!==node.base_width)||(node.base_height!==undefined&&node.height!==node.base_height);}
function TextRuns({paragraph}:{paragraph:SceneParagraph}){
  let offset=0;
  const spans=paragraph.runs.flatMap(run=>{
    const start=paragraph.text.indexOf(run.text,offset);
    if(start<0)return [];
    const gap=start>offset?[{start:offset,end:start,style:{}}]:[];
    offset=start+run.text.length;
    return [...gap,{start,end:offset,style:run.style}];
  });
  if(offset<paragraph.text.length)spans.push({start:offset,end:paragraph.text.length,style:{}});
  const styled=(from:number,to:number)=>spans.filter(span=>span.end>from&&span.start<to).map(span=><span
    key={Math.max(span.start,from)} style={textCss(span.style)}>{paragraph.text.slice(Math.max(span.start,from),Math.min(span.end,to)).replace(/\v/g,'\n')}</span>);
  const parts:ReactNode[]=[];
  let start=0;
  for(const match of paragraph.text.matchAll(/(?<!\\)\$([^$\n\v]+)(?<!\\)\$/g)){
    const position=match.index;
    const style=spans.find(span=>span.start<=position&&span.end>position)?.style??{};
    parts.push(...styled(start,position),<span key={`formula-${position}`} style={textCss(style)}><Formula tex={match[1]!} label={match[1]}/></span>);
    start=position+match[0].length;
  }
  parts.push(...styled(start,paragraph.text.length));
  return parts.length?parts:'\u200b';
}
function TextContent({node}:{node:SceneNode}){
  const style=node.style;
  const changedFields=(Object.keys(style) as Array<keyof TextStyle>).filter(k=>!same(style[k],node.base_style[k]));
  const nowrap=node.word_wrap===false;
  const textParagraphs=displayParagraphs(node);
  return <div className={styles.textFrame} style={{padding:`${style.padding_top??0}px ${style.padding_right??0}px ${style.padding_bottom??0}px ${style.padding_left??0}px`,
    justifyContent:style.vertical_align==='middle'?'center':style.vertical_align==='bottom'?'flex-end':'flex-start',
    whiteSpace:nowrap?'pre':'pre-wrap',...textCss(style)}}>
    <div className={styles.textContent} data-text-content
      style={nowrap?{width:'max-content',overflowWrap:'normal',wordBreak:'normal'}:undefined}>
      {textParagraphs.map((p,i)=><p key={i} className={p.bullet?styles.bullet:undefined} style={{
        textAlign:changedFields.includes('align')?style.align:p.align,
        lineHeight:typeof p.line_spacing_pt==='number'?`${p.line_spacing_pt}px`:(p.line_height??style.line_height??1.15),
        marginTop:p.space_before, marginBottom:p.space_after,
      }}>
        <TextRuns paragraph={p}/>
      </p>)}
    </div>
  </div>;
}
function ShapeContent({node}:{node:SceneNode}){
  if(node.shape_paths?.length)return <>{node.shape_paths.map((shape,index)=><svg key={index} className={styles.shape}
    viewBox={`0 0 ${shape.width} ${shape.height}`} preserveAspectRatio="none" aria-hidden="true">
    <path d={shape.path} fill={shape.fill?node.style.fill??'none':'none'} stroke={shape.stroke?node.style.stroke??'none':'none'}
      strokeWidth={node.style.stroke_width??0} vectorEffect="non-scaling-stroke"/>
  </svg>)}</>;
  const shape=SHAPE_CATALOG.find(candidate=>candidate.id===node.shape)??SHAPE_CATALOG[0];
  return <svg className={styles.shape} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
    <path d={shape.path} fill={'open' in shape?'none':(node.style.fill??'none')}
      stroke={node.style.stroke??('open' in shape?node.style.color:'none')}
      strokeWidth={node.style.stroke_width??('open' in shape?1:0)} vectorEffect="non-scaling-stroke"/>
  </svg>;
}
function ChartContent({node}:{node:SceneNode}){
  const data=node.chart;if(!data)return null;
  const rows=data.series.flatMap(series=>data.categories.map((category,i)=>[category,series.name,series.values[i]??0]));
  const spec:ISpec={spec_version:'1.0',object_id:node.id,kind:'filter',parameters:[],
    datasets:[{id:'data',columns:['category','series','value'],rows}],views:[]};
  return <div className={styles.chart}><VegaSpecView spec={spec} evaluation={{values:{},derived:{},violations:[]}}
    view={{type:'vega',spec_ref:data.chart_type?.includes('LINE')?'line':'bar',dataset:'data',x:'category',y:'value',title:data.title??node.name}} reducedMotion/></div>;
}
const NodeView=memo(function NodeView({node,pageWidth,pageHeight,editing,editingText,onText,onCompose,onTextBlur,selectable,proofFigures,basisCoordLabel}:{node:SceneNode;pageWidth:number;pageHeight:number;editing:boolean;editingText:boolean;proofFigures?:boolean;
  onText?:(id:string,text:string,paragraphs?:SceneParagraph[])=>void;onCompose?:(composing:boolean)=>void;onTextBlur?:()=>void;selectable:boolean;basisCoordLabel?:boolean}){
  const changed=textChanged(node);
  const clean=node.type==='image'&&node.cleaned_asset_id&&node.cleaned_url;
  const src=(!proofFigures&&clean)||node.image_data||node.image_url;
  const transform=`rotate(${node.rotation+(node.text_rotation_offset??0)}deg)${node.text_transform?` matrix(${node.text_transform.join(',')},0,0)`:''}`;
  const crop=node.crop;const imageStyle:CSSProperties=crop?{position:'absolute',width:`${100/(1-crop.left-crop.right)}%`,height:`${100/(1-crop.top-crop.bottom)}%`,
    left:`${-100*crop.left/(1-crop.left-crop.right)}%`,top:`${-100*crop.top/(1-crop.top-crop.bottom)}%`}:{};
  const tableChanged=node.type==='table'&&!same(node.table,node.base_table);
  const chartChanged=node.type==='chart'&&!same(node.chart,node.base_chart);
  const underlay=node.background_url?<img className={styles.raster} src={node.background_url} style={rasterCss(node,'background')} alt="" draggable={false}/>:
    (node.style.fill||node.style.stroke)?<ShapeContent node={node}/>:null;
  return <div className={styles.node} data-node-id={node.id} data-node-type={node.type} data-locked={node.locked}
    data-basis-coordinates={basisCoordLabel?true:undefined}
    role={selectable?'button':undefined} tabIndex={selectable?0:undefined} aria-label={selectable?`选择：${node.text?.slice(0,28)||node.name}`:undefined}
    style={{left:node.x,top:node.y,width:node.width,height:node.height,transform,zIndex:editingText?35000:node.z+10001,opacity:node.opacity*(proofFigures&&clean?0.35:1),
      pointerEvents:editing?'auto':'none'}}>
    {editingText?<>
      {underlay}<InlineRichText node={node} pageSize={{width:pageWidth,height:pageHeight}} css={textCss} onText={onText} onCompose={onCompose} onClose={onTextBlur}/>
    </>:node.type==='text'&&(changed||!src)?<>
      {underlay}
      <TextContent node={node}/>
    </>:node.type==='table'&&node.table&&(!src||tableChanged)?<table className={styles.table} style={textCss(node.style)}><tbody>{node.table.map((row,i)=><tr key={i}>{row.map((cell,j)=><td key={j}>{cell}</td>)}</tr>)}</tbody></table>:
      node.type==='chart'&&node.chart&&(!src||chartChanged)?<ChartContent node={node}/>:
      node.type==='shape'&&(!src||!same(node.style,node.base_style))?<ShapeContent node={node}/>:
      src?(crop?<div className={styles.imageClip}><img className={styles.raster} src={src} style={imageStyle} alt="" draggable={false}/></div>:
        <img className={styles.raster} src={src} style={rasterCss(node,'image')} alt="" draggable={false}/>):
      node.type==='text'?<TextContent node={node}/>:null}
  </div>;
});
interface Props {page:ScenePage;scale:number;editing?:boolean;editingId?:string|null;preview?:Record<string,Partial<SceneNode>>;children?:ReactNode;
  onText?:(id:string,text:string,paragraphs?:SceneParagraph[])=>void;onCompose?:(composing:boolean)=>void;onTextBlur?:()=>void; presentVectors?:boolean; vectorId?:string;
  resetHost?:HTMLElement|null; lineControlsHost?:HTMLElement|null; onResetPresentation?:()=>void; resetForAi?:boolean; inlineAllDemos?:boolean;
  onVectorSelect?:(id:string)=>void; onVectorPatch?:(id:string, patch:import('@/document/types').NodePatch,key?:string)=>void;
  onGenerateDemo?:(id:string)=>void;generating?:Record<string,boolean>;proofFigures?:boolean;}
export function ScenePageView({page,scale,editing=false,editingId,preview,children,onText,onCompose,onTextBlur,presentVectors,vectorId,onVectorSelect,onVectorPatch,onGenerateDemo,generating,proofFigures,resetHost,lineControlsHost,onResetPresentation,resetForAi,inlineAllDemos}:Props){
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
  const separateIds = new Set(inlineAllDemos ? [] : standaloneDemos(page).map(node=>node.id));
  const richNodes = visible.filter(node=>node.type==='diagram'||(node.type==='demo'&&!separateIds.has(node.id))||node.type==='workshop_plugin');
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
  const vectorControls=presentVectors&&selected&&!fixed(selected)&&<div className={styles.vectorControls} data-external={!!lineControlsHost} data-no-pan aria-label="放映线条控制">
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
  </div>;
  return <div className={styles.canvas} style={{width:page.width,height:page.height,backgroundColor:page.background_color??'#fff',transform:`scale(${scale})`}} data-scene-page={page.page_no}>
    <div className={styles.contentLayer}>
      {page.background_url&&!page.background_modified&&<img className={styles.pageBackground} src={page.background_url} alt="" draggable={false}/>}
      {visible.filter(node=>node.type!=='vector'&&node.type!=='diagram'&&node.type!=='demo'&&node.type!=='workshop_plugin').map(node=><NodeView key={node.id} node={node} pageWidth={page.width} pageHeight={page.height}
        basisCoordLabel={basisLabelIds.has(node.id)}
        editing={editing} editingText={editingId===node.id} selectable={editing} proofFigures={proofFigures} onText={onText} onCompose={onCompose} onTextBlur={onTextBlur}/>)}
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
      {richNodes.map(node=>{
        const props={node,editing,interactive:!!presentVectors||(editing&&vectorId===node.id),onPatch:(patch:NodePatch,key?:string)=>change(node.id,patch,key)};
        return <div key={node.id} data-node-id={node.id} data-node-type={node.type} style={{display:'contents'}}
          onPointerDown={()=>{if(editing)onVectorSelect?.(node.id);}}>
          {node.type==='diagram'?<SlideDiagramNode key={`${node.id}:${resetVersion}`} {...props}/>:
            node.type==='workshop_plugin'?<SlideWorkshopPluginNode key={`${node.id}:${resetVersion}`} {...props} presentationKey={`${page.page_no}:${node.id}`}/>:
            <SlideDemoNode key={`${node.id}:${resetVersion}`} {...props} generating={generating?.[node.id]} onGenerate={onGenerateDemo?()=>onGenerateDemo(node.id):undefined}/>}
        </div>;
      })}
      {relationEval.overlays.map(ov => <BasisRelationOverlay key={ov.relationId} overlay={ov} progress={playback.value}/>)}
    </div>
    {lineControlsHost?createPortal(vectorControls,lineControlsHost):vectorControls}
    {editing&&visible.find(node=>node.id===vectorId&&node.type==='vector'&&!node.locked)&&(()=>{
      const node=visible.find(node=>node.id===vectorId)!;
      const toolbarWidth=Math.min(530,page.width*scale-16);
      const left=Math.max(8/scale,Math.min(node.x,page.width-(toolbarWidth+8)/scale));
      const top=node.y>=132/scale?node.y-132/scale:node.y+node.height+16/scale;
      return <div className={styles.inlineControls} data-no-pan aria-label="原位图形属性"
        style={{left,top,width:toolbarWidth,transform:`scale(${1/scale})`,transformOrigin:'top left'}}
        onPointerDown={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()}>
        <VectorControls node={node} onPatch={(patch,key)=>onVectorPatch?.(node.id,patch,key)} author/>
      </div>;
    })()}
    {presentVectors&&resetHost&&(vectors.length>0||richNodes.length>0||separateIds.size>0||resetForAi)&&createPortal(<button type="button" onClick={()=>{
      setOverrides({});setLiveDrafts({});setScaleFactor(1);setRotateOffset(0);setStepState({target:null,progress:1});setResetVersion(v=>v+1);onResetPresentation?.();
    }}>↺ 重置本页状态</button>,resetHost)}
    {children}
  </div>;
}
