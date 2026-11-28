import {useEffect,useRef,useState} from 'react';
import katex from 'katex';
import styles from './FreeDeckEditor.module.css';

const snippets=[
  ['分数',String.raw`\frac{a}{b}`],['积分',String.raw`\int_a^b`],
  ['求和',String.raw`\sum_{i=1}^{n}`],['极限',String.raw`\lim_{x\to 0}`],
  ['矩阵',String.raw`\begin{pmatrix}a&b\\c&d\end{pmatrix}`],['α',String.raw`\alpha`],
  ['上标','x^{2}'],['下标','x_{1}'],
] as const;

export function FormulaPopover({onInsert,onClose}:{onInsert:(tex:string)=>void;onClose:()=>void}){
  const [tex,setTex]=useState('');
  const preview=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if(!preview.current)return;
    if(tex.trim())katex.render(tex,preview.current,{throwOnError:false,trust:false,displayMode:true});
    else preview.current.textContent='';
  },[tex]);
  return <form className={styles.formulaPopover} aria-label="公式构建器"
    onPointerDown={event=>event.stopPropagation()}
    onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();onClose();}}}
    onSubmit={event=>{event.preventDefault();if(tex.trim())onInsert(tex.trim());}}>
    <div className={styles.objectButtons}>{snippets.map(([name,value])=><button key={name} type="button"
      onClick={()=>setTex(previous=>(previous+' '+value).trim().slice(0,1000))}>{name}</button>)}</div>
    <textarea autoFocus aria-label="LaTeX 公式" rows={3} maxLength={1000} value={tex}
      onChange={event=>setTex(event.target.value)} placeholder="输入 LaTeX"/>
    <div aria-label="公式预览" ref={preview}/>
    <div className={styles.objectButtons}>
      <button type="button" onClick={onClose}>取消</button><button type="submit" disabled={!tex.trim()}>插入公式</button>
    </div>
  </form>;
}
