import {useEffect,useState} from 'react';
import {evaluateSpec} from '@/ispec/evaluate';
import type {ISpec} from '@/ispec/types';
import {formatNumberSmart as fmt,type SpecCell} from '@/ispec/format';
import styles from './ScenarioCompare.module.css';
const cell=(v:SpecCell|undefined)=>typeof v==='number'?fmt(v):v===undefined?'—':String(v);

interface Baseline {values:Record<string,SpecCell>;time:string;}
interface Props {identity:string;spec:ISpec;values:Record<string,SpecCell>;onRestore:(values:Record<string,SpecCell>)=>void;}
export function ScenarioCompare({identity,spec,values,onRestore}:Props) {
  const key=`xiangsheng.compare.v1.${identity}.${spec.object_id}`;
  const [baseline,setBaseline]=useState<Baseline|null>(null);
  useEffect(()=>{
    try {
      const stored=JSON.parse(localStorage.getItem(key)??'null') as Baseline|null;
      const valid=stored?.values && spec.parameters.every(p=>typeof stored.values[p.id]===typeof p.default);
      setBaseline(valid?stored:null);
    }catch{setBaseline(null);}
  },[key,spec.parameters]);
  const original=Object.fromEntries(spec.parameters.map(parameter=>[parameter.id,parameter.source_default??parameter.default]));
  const baselineValues=baseline?.values??original;
  const before=evaluateSpec(spec,baselineValues);
  const after=evaluateSpec(spec,values);
  const rows=[...spec.parameters.map(p=>({id:p.id,label:p.label,unit:p.unit})),...(spec.expressions??[]).filter(p=>p.id!=='pi').map(p=>({id:p.id,label:p.label??p.id,unit:p.unit}))];
  const old={...before.values,...before.derived},now={...after.values,...after.derived};
  const changed=rows.filter(row=>old[row.id]!==now[row.id]);
  const save=()=>{
    const item={values:{...values},time:new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})};
    setBaseline(item);try{localStorage.setItem(key,JSON.stringify(item));}catch{ /* in-memory comparison still works */ }
  };
  return <details className={styles.root} aria-label="参数与结果比较">
    <summary>对比条件与结果 <span>{changed.length?`${changed.length} 项变化`:'与基线一致'}</span></summary>
    <p>基线：{baseline?`本机保存于 ${baseline.time}`:'原始参数'}。只比较当前对象，恢复基线也可以撤销。</p>
    <div className={styles.actions}><button onClick={save}>将当前状态设为基线</button>
      <button onClick={()=>onRestore(baselineValues)} disabled={!changed.length}>恢复基线</button></div>
    <div className={styles.scroll}><table><thead><tr><th>参数 / 结果</th><th>基线</th><th>当前</th><th>差额</th></tr></thead>
      <tbody>{rows.slice(0,40).map(row=>{
        const a=old[row.id],b=now[row.id];
        return <tr key={row.id} data-changed={a!==b}><th>{row.label}{row.unit?` (${row.unit})`:''}</th><td>{cell(a)}</td><td>{cell(b)}</td>
          <td>{typeof a==='number'&&typeof b==='number'?fmt(b-a):a===b?'—':'已变更'}</td></tr>;
      })}</tbody></table></div>
  </details>;
}
