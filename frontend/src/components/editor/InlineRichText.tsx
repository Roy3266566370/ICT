import {useEffect,useLayoutEffect,useRef,useState,type CSSProperties} from 'react';
import type {SceneNode,SceneParagraph,TextStyle} from '@/document/types';
import {appendRun,displayParagraphs} from '@/document/richText';
import styles from './ScenePageView.module.css';

const LEGACY_FONT_SIZES=[10,13,16,18,24,32,48];
const colorHex=(value:string)=>{
  const rgb=value.match(/^rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)$/);
  return rgb?`#${rgb.slice(1).map(n=>Number(n).toString(16).padStart(2,'0')).join('')}`:
    /^#[a-f\d]{6}$/i.test(value)?value:undefined;
};

function readParagraphs(root:HTMLElement,original:SceneParagraph[]):SceneParagraph[]{
  const paragraphs:SceneParagraph[]=[];
  let metadata:Omit<SceneParagraph,'text'|'runs'>={};
  let runs:SceneParagraph['runs']=[];
  const push=()=>{
    paragraphs.push({...metadata,text:runs.map(run=>run.text).join(''),runs});
    runs=[];
  };
  const walk=(element:Node,inherited:Partial<TextStyle>)=>{
    if(element.nodeType===Node.TEXT_NODE){appendRun(runs,(element.textContent??'').replace(/\u00a0/g,' '),inherited);return;}
    if(!(element instanceof HTMLElement))return;
    if(element.tagName==='BR'){
      if(element.nextSibling||element.hasAttribute('data-rich-soft-break'))appendRun(runs,'\v',inherited);
      return;
    }
    if(element.matches('ul,ol')){if(runs.length)push();element.childNodes.forEach(child=>walk(child,inherited));return;}
    const block=element.matches('p,div,li');
    if(element.parentNode===root&&element===root.lastElementChild&&element.previousElementSibling?.matches('ul,ol')&&
      element.matches('p,div')&&element.dataset.richParagraph===undefined&&element.childNodes.length===1&&element.firstElementChild?.tagName==='BR')return;
    if(block&&runs.length)push();
    if(block){
      const baseline=element.dataset.richParagraph===undefined?undefined:original[Number(element.dataset.richParagraph)];
      const {text:_,runs:__,...properties}=baseline??{text:'',runs:[]};
      metadata={...properties,bullet:element.tagName==='LI'||undefined};
    }
    const css=element.style;
    const originalStyle:Partial<TextStyle>=element.dataset.richStyle?JSON.parse(element.dataset.richStyle):{};
    const style:Partial<TextStyle>={...inherited,...originalStyle};
    const color=colorHex(css.color||element.getAttribute('color')||'');
    if(color&&color.toLowerCase()!==style.color?.toLowerCase())style.color=color;
    const highlight=colorHex(css.backgroundColor);
    if(highlight&&highlight.toLowerCase()!==style.highlight?.toLowerCase())style.highlight=highlight;
    const length=css.fontSize.endsWith('px')?parseFloat(css.fontSize):LEGACY_FONT_SIZES[Number(element.getAttribute('size'))-1];
    if(length)style.font_size=length;
    if(element.matches('b,strong')||css.fontWeight||originalStyle.bold!==undefined)style.bold=element.matches('b,strong')||css.fontWeight==='bold'||Number(css.fontWeight)>=600;
    if(element.matches('i,em')||css.fontStyle||originalStyle.italic!==undefined)style.italic=element.matches('i,em')||css.fontStyle==='italic';
    if(element.matches('u')||css.textDecorationLine||originalStyle.underline!==undefined)style.underline=element.matches('u')||css.textDecorationLine.includes('underline');
    if(element.tagName==='SUP')style.baseline=30;
    if(element.tagName==='SUB')style.baseline=-25;
    element.childNodes.forEach(child=>walk(child,style));
    if(block){push();metadata={};}
  };
  root.childNodes.forEach(child=>walk(child,{}));
  if(runs.length||!paragraphs.length)push();
  return paragraphs;
}

interface Props {
  node:SceneNode;pageSize:{width:number;height:number};css:(style:Partial<TextStyle>)=>CSSProperties;
  onText?:(id:string,text:string,paragraphs?:SceneParagraph[])=>void;
  onCompose?:(composing:boolean)=>void;onClose?:()=>void;
}
export function InlineRichText({node,pageSize,css,onText,onCompose,onClose}:Props){
  const [initial]=useState(()=>displayParagraphs(node));
  const editor=useRef<HTMLDivElement>(null);
  const selection=useRef<Range|null>(null);
  const composing=useRef(false);
  const composeCallback=useRef(onCompose);composeCallback.current=onCompose;
  useEffect(()=>()=>{if(composing.current)composeCallback.current?.(false);},[]);
  useLayoutEffect(()=>{editor.current?.focus();},[]);

  const rememberSelection=()=>{
    const selected=document.getSelection();
    if(selected?.rangeCount&&editor.current?.contains(selected.anchorNode))selection.current=selected.getRangeAt(0).cloneRange();
  };
  const publish=()=>{
    const element=editor.current;
    if(!element||composing.current)return;
    const paragraphs=readParagraphs(element,initial);
    const text=paragraphs.map(p=>p.text).join('\n');
    if(text.length<=20000)onText?.(node.id,text,paragraphs);
  };
  const command=(name:string,value?:string)=>{
    const element=editor.current;
    if(!element)return;
    element.focus();
    const selected=document.getSelection();
    if(selection.current&&element.contains(selection.current.startContainer)){
      selected?.removeAllRanges();selected?.addRange(selection.current);
    }
    document.execCommand(name,false,value);
    rememberSelection();publish();
  };
  const buttons=[['bold','加粗','B'],['italic','斜体','I'],['underline','下划线','U'],['superscript','上标','x²'],
    ['subscript','下标','x₂'],['insertUnorderedList','项目符号','•']];
  const left=Math.max(-node.x,Math.min(0,pageSize.width-node.x-300));
  const dockAbove=pageSize.height-node.y-node.height<36&&node.y>=36;
  return <div className={styles.inlineRichFrame} data-no-pan onPointerDown={event=>event.stopPropagation()}
    onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))onClose?.();}}
    onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onClose?.();}}}>
    <div ref={editor} className={`${styles.inlineText} ${styles.textContent}`} contentEditable suppressContentEditableWarning role="textbox"
      aria-multiline="true" aria-label="画布文字编辑" style={{...css(node.style),padding:`${node.style.padding_top??0}px ${node.style.padding_right??0}px ${node.style.padding_bottom??0}px ${node.style.padding_left??0}px`}}
      onInput={publish} onMouseUp={rememberSelection} onKeyUp={rememberSelection} onBlur={rememberSelection}
      onCompositionStart={()=>{composing.current=true;onCompose?.(true);}}
      onCompositionEnd={()=>{composing.current=false;onCompose?.(false);publish();}}
      onDrop={event=>{event.preventDefault();}}
      onPaste={event=>{event.preventDefault();document.execCommand('insertText',false,event.clipboardData.getData('text/plain'));publish();}}>
      <InitialParagraphs paragraphs={initial} css={css}/>
    </div>
    <div className={styles.richToolbar} style={{left,...(dockAbove?{top:'auto',bottom:'calc(100% + 4px)'}:{})}} role="toolbar" aria-label="文字格式">
      {buttons.map(([name,label,glyph])=><button key={name} type="button" aria-label={label} title={label}
        onMouseDown={event=>event.preventDefault()} onClick={()=>command(name!)}>{glyph}</button>)}
      <select aria-label="选中文字的字号" value="" onChange={event=>command('fontSize',event.target.value)}>
        <option value="" disabled>字号</option>{LEGACY_FONT_SIZES.map((size,i)=><option key={size} value={i+1}>{size}</option>)}
      </select>
      <input type="color" aria-label="选中文字的颜色" defaultValue={colorHex(node.style.color)??'#18233d'}
        onChange={event=>command('foreColor',event.target.value)}/>
      <button type="button" title="插入行内公式，可在 $ 符号之间编辑 LaTeX" aria-label="插入行内公式"
        onMouseDown={event=>event.preventDefault()} onClick={()=>command('insertText','$x^2$')}>∑</button>
    </div>
  </div>;
}

// Browsers own live editing mutations. This element tree is mounted only at edit start.
const InitialParagraphs=({paragraphs,css}:{paragraphs:SceneParagraph[];css:Props['css']})=>{
  const [elements]=useState(()=>paragraphs.map((paragraph,i)=>{
    const textWithBreaks=(text:string)=>text.split('\v').map((part,j)=>j===0?part:<span key={j}><br data-rich-soft-break=""/>{part}</span>);
    const runs:SceneParagraph['runs']=[];
    let offset=0;
    for(const run of paragraph.runs){
      const start=paragraph.text.indexOf(run.text,offset);
      if(start<0)continue;
      appendRun(runs,paragraph.text.slice(offset,start),{});
      appendRun(runs,run.text,run.style);
      offset=start+run.text.length;
    }
    appendRun(runs,paragraph.text.slice(offset),{});
    const content=runs.length?runs.map((run,j)=><span key={j} data-rich-style={JSON.stringify(run.style)} style={css(run.style)}>{textWithBreaks(run.text)}</span>):<br/>;
    const style:CSSProperties={textAlign:paragraph.align,lineHeight:paragraph.line_spacing_pt?`${paragraph.line_spacing_pt}px`:paragraph.line_height,
      marginTop:paragraph.space_before,marginBottom:paragraph.space_after};
    if(paragraph.bullet)return <ul key={i}><li data-rich-paragraph={i} style={style}>{content}</li></ul>;
    return <p key={i} data-rich-paragraph={i} style={style}>{content}</p>;
  }));
  return <>{elements}</>;
};
