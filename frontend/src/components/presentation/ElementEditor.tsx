import { useEffect, useState } from 'react';
import type { EditableElement, ElementEdit, InteractionConfig } from '@/api/editor';
import type { ISpec } from '@/ispec/types';
import styles from './ElementEditor.module.css';
import {inferMatrix,initialEditorMode,elementText,type EditorMode} from './editorDraft';

interface Props {element: EditableElement; page: number; specs: ISpec[]; busy: boolean; materialId: string;
  onSave: (change: ElementEdit) => void; onClose: () => void;}

export function ElementEditor({element, page, specs, busy, onSave, onClose}: Props) {
  const saved = element.override?.interaction;
  const sourceSpec = specs.find(spec => spec.anchor?.element_id===element.element_id ||
    spec.parameters.some(p => p.source.element_id===element.element_id));
  const inferredMatrix = inferMatrix(sourceSpec) ?? element.recognition?.matrix;
  const [text,setText]=useState('');
  const [mode,setMode]=useState<EditorMode>('none');
  const [matrix,setMatrix]=useState<number[][]>([[1,0],[0,1]]);
  const [vector,setVector]=useState([1,0]);
  const [formula,setFormula]=useState('');
  const [defaults,setDefaults]=useState<Record<string,number>>({});
  const [rows,setRows]=useState<string[][]>([]);
  const [categories,setCategories]=useState<string[]>([]);
  const [series,setSeries]=useState<Array<{name:string;values:number[]}>>([]);
  useEffect(()=>{
    setText(elementText(element));
    setMode(initialEditorMode(element,sourceSpec));
    setMatrix(saved?.matrix ?? inferredMatrix ?? [[1,0],[0,1]]);
    setVector(saved?.vector ?? [1,0]);
    setFormula(saved?.formula ?? (element.math_text?.includes('=') ? element.math_text : ''));
    setDefaults(saved?.defaults ?? {});
    setRows(element.table_data?.rows ?? []);
    setCategories(element.chart_data?.categories ?? saved?.categories ?? ['A','B','C']);
    setSeries(element.chart_data?.series ?? saved?.series ?? [{name:'数值',values:[0,0,0]}]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[element.element_id,element.override]);

  const formulaVars=[...new Set((formula.split('=')[1]?.match(/[A-Za-z][A-Za-z0-9_]*/g) ?? [])
    .filter(name=>!['sin','cos','tan','abs','sqrt','pow','log','exp','min','max','pi'].includes(name)))].slice(0,12);
  const image=element.kind==='picture';
  const save=()=>{
    const base={page,element_id:element.element_id};
    if(element.kind==='chart') onSave({...base,kind:'chart',categories,series});
    else if(element.kind==='table') onSave({...base,kind:'table',rows});
    else if(!image) onSave({...base,kind:'text',text});
    else if(mode==='keep') onSave({...base,kind:'recognition',text});
    else {
      const interaction: InteractionConfig = mode==='matrix'?{kind:mode,matrix,vector}:
        mode==='formula'?{kind:mode,formula,defaults:Object.fromEntries(formulaVars.map(id=>[id,defaults[id]??0]))}:
        mode==='chart'?{kind:mode,categories,series}:{kind:'none'};
      onSave({...base,kind:'interaction',text,interaction});
    }
  };
  const chartGrid=<div className={styles.scroller}><table><thead><tr><th>分类</th>{series.map((item,i)=><th key={i}>
    <input aria-label={`系列 ${i+1} 名称`} value={item.name} onChange={e=>setSeries(series.map((s,j)=>j===i?{...s,name:e.target.value}:s))}/></th>)}</tr></thead>
    <tbody>{categories.map((category,i)=><tr key={i}><td><input aria-label={`分类 ${i+1}`} value={category}
      onChange={e=>setCategories(categories.map((c,j)=>j===i?e.target.value:c))}/></td>{series.map((item,j)=><td key={j}>
        <input type="number" step="any" aria-label={`${item.name} 第 ${i+1} 行`} value={item.values[i]??0}
          onChange={e=>setSeries(series.map((s,k)=>k===j?{...s,values:s.values.map((v,n)=>n===i?Number(e.target.value):v)}:s))}/></td>)}</tr>)}</tbody></table></div>;

  return <aside className={styles.panel} aria-label="编辑所选内容">
    <header><div><b>编辑内容</b><span>第 {page} 页 · {element.kind==='text'?'文字':image?'图片 / 公式':element.kind==='chart'?'原生图表':'原生表格'}</span></div>
      <button aria-label="关闭内容编辑" onClick={onClose}>×</button></header>
    <div className={styles.body}>
      <p className={styles.hint}>{image?'图片保留原稿；可修正识别结果并配置交互，保存后直接操作所选区域。':'编辑的是这份 PPT 的真实元素；保存后重新生成原页预览。'}</p>
      {element.kind==='chart'?chartGrid:element.kind==='table'?<div className={styles.scroller}><table><tbody>{rows.map((row,i)=><tr key={i}>{row.map((value,j)=><td key={j}>
        <input aria-label={`第 ${i+1} 行第 ${j+1} 列`} value={value} onChange={e=>setRows(rows.map((r,n)=>n===i?r.map((v,k)=>k===j?e.target.value:v):r))}/>
      </td>)}</tr>)}</tbody></table></div>:<label className={styles.field}>{image?'图片识别文本（可纠正）':'文字内容'}
        <textarea aria-label={image?'图片识别文本':'文字内容'} rows={image?5:7} value={text} onChange={e=>setText(e.target.value)}/></label>}
      {image && <>
        {element.recognition?.reason && <p className={styles.hint}>{element.recognition.reason}</p>}
        <label className={styles.field}>交互类型<select aria-label="交互类型" value={mode} onChange={e=>setMode(e.target.value as EditorMode)}>
          {sourceSpec && <option value="keep">保留现有交互，仅纠正识别文本</option>}
          <option value="none">仅保留原图（移除交互）</option><option value="matrix">二维矩阵与向量</option><option value="formula">可计算公式</option><option value="chart">数据图表</option></select></label>
        {mode==='matrix' && <>
          {!inferredMatrix && !saved?.matrix && <p className={styles.warning}>未能确定原图矩阵。下面的单位矩阵是编辑初值，请按原图填写后保存。</p>}
          <div className={styles.field}>矩阵 A<div className={styles.matrix}>{matrix.map((row,i)=>row.map((v,j)=><input key={`${i}-${j}`} type="number" step="any"
            aria-label={`矩阵第 ${i+1} 行第 ${j+1} 列`} value={v} onChange={e=>setMatrix(matrix.map((r,n)=>n===i?r.map((v,k)=>k===j?Number(e.target.value):v):r))}/>))}</div></div>
          <div className={styles.field}>输入向量<div className={styles.matrix}>{vector.map((v,i)=><input key={i} type="number" step="any" aria-label={`输入向量 ${i===0?'x':'y'}`} value={v}
            onChange={e=>setVector(vector.map((n,j)=>j===i?Number(e.target.value):n))}/>)}</div></div>
          <p className={styles.hint}>保存后可拖动两个基向量，矩阵、变换后网格和行列式同步变化。</p>
        </>}
        {mode==='formula' && <>
          <label className={styles.field}>计算关系<textarea rows={3} aria-label="计算公式" placeholder="例如 y = x^2 + 2*x" value={formula} onChange={e=>setFormula(e.target.value)}/></label>
          {formulaVars.map(id=><label className={styles.field} key={id}>变量 {id} 初值<input type="number" step="any" aria-label={`变量 ${id} 初值`} value={defaults[id]??0}
            onChange={e=>setDefaults({...defaults,[id]:Number(e.target.value)})}/></label>)}
          <p className={styles.hint}>支持加减乘除、幂、sqrt、sin、cos 等受限函数；不会执行脚本。</p>
        </>}
        {mode==='chart' && <><p className={styles.hint}>请按原图核对数值。手工录入会明确标注为用户确认。</p>{chartGrid}</>}
      </>}
    </div>
    <footer><button className={styles.save} disabled={busy} onClick={save}>{busy?'正在生成页面…':image?'保存并生成交互':'保存内容并更新页面'}</button></footer>
  </aside>;
}
