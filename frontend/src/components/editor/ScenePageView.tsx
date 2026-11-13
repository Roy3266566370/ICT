import {memo,type CSSProperties,type ReactNode} from 'react';
import type {SceneNode,ScenePage,TextStyle} from '@/document/types';
import {same} from '@/document/model';
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
  onText?:(id:string,text:string)=>void;onCompose?:(composing:boolean)=>void;onTextBlur?:()=>void;}
export function ScenePageView({page,scale,editing=false,editingId,preview,children,onText,onCompose,onTextBlur}:Props){
  const frozen=page.preparation?.frozen_ids??[];
  return <div className={styles.canvas} style={{width:page.width,height:page.height,transform:`scale(${scale})`}} data-scene-page={page.page_no}>
    <div className={styles.contentLayer}>
      {page.background_url&&<img className={styles.pageBackground} src={page.background_url} alt="" draggable={false}/>}
      {page.nodes.filter(n=>!n.deleted&&!n.hidden&&!frozen.includes(n.id)).map(node=><NodeView key={node.id} node={preview?.[node.id]?{...node,...preview[node.id]}:node}
        editing={editing} editingText={editingId===node.id} selectable={editing} onText={onText} onCompose={onCompose} onTextBlur={onTextBlur}/>)}
    </div>
    {children}
  </div>;
}
