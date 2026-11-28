import {useEffect,useLayoutEffect,useRef,useState,type CSSProperties} from 'react';
import type {SceneNode,SceneParagraph,TextStyle} from '@/document/types';
import {appendRun,displayParagraphs} from '@/document/richText';
import {FONT_FAMILIES} from './fontFamilies';
import {FormulaPopover} from './FormulaPopover';
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
      const list_type=element.tagName==='LI'?(element.parentElement?.tagName==='OL'?'ordered':'bullet'):undefined;
      metadata={...properties,bullet:list_type==='bullet'||undefined,list_type};
    }
    const css=element.style;
    const originalStyle:Partial<TextStyle>=element.dataset.richStyle?JSON.parse(element.dataset.richStyle):{};
    const style:Partial<TextStyle>={...inherited,...originalStyle};
    const fontFamily=css.fontFamily||element.getAttribute('face');
    if(fontFamily)style.font_family=fontFamily.replace(/^(['"])(.*)\1$/, '$2');
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
  const [formulaOpen,setFormulaOpen]=useState(false);
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
  const applyPointSize=(size:number)=>{
    const element=editor.current,range=selection.current;
    if(!element||!range||range.collapsed||!element.contains(range.startContainer)||
      !Number.isFinite(size)||size<1||size>500)return;
    const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);
    const nodes:Text[]=[];
    for(let node=walker.nextNode();node;node=walker.nextNode())if(range.intersectsNode(node))nodes.push(node as Text);
    const spans:HTMLElement[]=[];
    for(const node of nodes){
      const end=node===range.endContainer?range.endOffset:node.length;
      const start=node===range.startContainer?range.startOffset:0;
      if(end<=start)continue;
      if(end<node.length)node.splitText(end);
      const selected=start?node.splitText(start):node;
      const span=document.createElement('span');
      span.style.fontSize=`${size}px`;
      selected.before(span);
      span.append(selected);
      spans.push(span);
    }
    if(!spans.length)return;
    element.focus();
    const next=document.createRange();
    next.setStartBefore(spans[0]!);next.setEndAfter(spans.at(-1)!);
    const selected=document.getSelection();
    selected?.removeAllRanges();selected?.addRange(next);
    rememberSelection();publish();
  };
  const buttons=[['bold','加粗','B'],['italic','斜体','I'],['underline','下划线','U'],['superscript','上标','x²'],
    ['subscript','下标','x₂'],['insertUnorderedList','项目符号','•'],['insertOrderedList','有序列表','1.'],['removeFormat','清除格式','Tx']];
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
      <select aria-label="选中文字的字体" value="" onChange={event=>command('fontName',event.target.value)}>
        <option value="" disabled>字体</option>{FONT_FAMILIES.map(font=><option key={font} value={font}>{font}</option>)}
      </select>
      <input type="number" min={1} max={500} className={styles.exactFontSize} placeholder="字号"
        aria-label="选中文字的字号" title="输入字号后按 Enter"
        onKeyDown={event=>{if(event.key==='Enter'){
          event.preventDefault();event.stopPropagation();applyPointSize(event.currentTarget.valueAsNumber);
        }}}/>
      <input type="color" aria-label="选中文字的颜色" defaultValue={colorHex(node.style.color)??'#18233d'}
        onChange={event=>command('foreColor',event.target.value)}/>
      <input type="color" aria-label="选中文字的高亮颜色" defaultValue="#fff0a6"
        onChange={event=>command('hiliteColor',event.target.value)}/>
      <button type="button" title="插入行内公式，可在 $ 符号之间编辑 LaTeX" aria-label="插入行内公式"
        onMouseDown={event=>event.preventDefault()} onClick={()=>{rememberSelection();setFormulaOpen(value=>!value);}}>∑</button>
      {formulaOpen&&<FormulaPopover onClose={()=>setFormulaOpen(false)} onInsert={tex=>{
        command('insertText',`$${tex}$`);setFormulaOpen(false);
      }}/>}
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
    if(paragraph.list_type==='ordered'){
      let start=1;
      for(let p=i-1;p>=0&&paragraphs[p]?.list_type==='ordered';p--)start++;
      return <ol key={i} start={start}><li data-rich-paragraph={i} style={style}>{content}</li></ol>;
    }
    if(paragraph.bullet||paragraph.list_type==='bullet')return <ul key={i}><li data-rich-paragraph={i} style={style}>{content}</li></ul>;
    return <p key={i} data-rich-paragraph={i} style={style}>{content}</p>;
  }));
  return <>{elements}</>;
};
