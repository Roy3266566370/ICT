import {useMemo,useState} from 'react';
import type {ISpec,SpecEvaluation} from '@/ispec/types';
import {sampleFunction} from '@/ispec/functionSeries';
import {formatNumberSmart as fmt,type SpecCell} from '@/ispec/format';
import styles from './FormulaExplorer.module.css';

interface Props {spec:ISpec;evaluation:SpecEvaluation;onChange:(id:string,value:SpecCell)=>void;onPage?:boolean;}
export function FormulaExplorer({spec,evaluation,onChange,onPage=false}:Props) {
  const inputs=spec.parameters.filter(p=>p.type===undefined || p.type==='number' || p.type==='integer');
  const outputs=(spec.expressions??[]).filter(p=>!['pi'].includes(p.id));
  const [input,setInput]=useState(inputs.find(p=>p.id==='x')?.id ?? inputs[0]?.id ?? '');
  const [output,setOutput]=useState(outputs.at(-1)?.id ?? '');
  const parameter=inputs.find(p=>p.id===input);
  const [range,setRange]=useState<[number,number]>([parameter?.min??-10,parameter?.max??10]);
  const points=useMemo(()=>sampleFunction(spec,evaluation.values,input,output,...range),[spec,evaluation.values,input,output,range]);
  const finite=points.filter(p=>p!==null);
  if(!parameter || !outputs.length) return null;
  const ys=finite.map(p=>p.y).sort((a,b)=>a-b);
  // Trim the display range at a pole; clipped segments are left disconnected.
  let lo=Math.min(0,ys[Math.floor(ys.length*.03)]??0),hi=Math.max(0,ys[Math.floor(ys.length*.97)]??1);
  if(hi-lo<1e-9) {lo-=1;hi+=1;}
  const pad=(hi-lo)*.08;lo-=pad;hi+=pad;
  const px=(x:number)=>40+(x-range[0])/(range[1]-range[0])*260;
  const py=(y:number)=>185-(y-lo)/(hi-lo)*155;
  let pen=false,previous:number|undefined;
  const path=points.map(point=>{
    if(!point || point.y<lo || point.y>hi) {pen=false;previous=undefined;return '';}
    const jump=previous!==undefined && Math.abs(previous-point.y)>(hi-lo)*.65;
    const command=pen&&!jump?'L':'M';pen=true;previous=point.y;
    return `${command}${px(point.x).toFixed(2)},${py(point.y).toFixed(2)}`;
  }).join(' ');
  const currentX=evaluation.values[input];const currentY=evaluation.derived[output];
  const hasCurrent=typeof currentX==='number' && typeof currentY==='number' && Number.isFinite(currentY) &&
    currentX>=range[0] && currentX<=range[1] && currentY>=lo && currentY<=hi;
  return <section className={`${styles.root} ${onPage?styles.onPage:''}`} aria-label="公式探索">
    <h4>{onPage?spec.title:'公式探索'}</h4>
    <div className={styles.choices}><label>自变量<select aria-label="曲线自变量" value={input} onChange={e=>{
      const p=inputs.find(p=>p.id===e.target.value)!;setInput(p.id);setRange([p.min??-10,p.max??10]);
    }}>{inputs.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
    <label>观察结果<select aria-label="曲线结果" value={output} onChange={e=>setOutput(e.target.value)}>
      {outputs.map(p=><option key={p.id} value={p.id}>{p.label??p.id}</option>)}</select></label></div>
    <div className={styles.range}>{range.map((n,i)=><label key={i}>{i?'至':'范围'}<input type="number" step="any" aria-label={i?'曲线范围上限':'曲线范围下限'}
      value={n} onChange={e=>setRange(i?[range[0],Number(e.target.value)]:[Number(e.target.value),range[1]])}/></label>)}</div>
    {points.length ? <>
      <svg viewBox="0 0 325 220" role="img" aria-label={`${output} 随 ${input} 变化的曲线`} onClick={e=>{
        const rect=e.currentTarget.getBoundingClientRect();const x=((e.clientX-rect.left)/rect.width*325-40)/260*(range[1]-range[0])+range[0];
        if(x>=range[0] && x<=range[1]) onChange(input,x);
      }}>
        {[0,.5,1].map(t=><g key={t}><line x1="40" x2="300" y1={30+t*155} y2={30+t*155}/>
          <text x="35" y={34+t*155} textAnchor="end">{fmt(hi-t*(hi-lo))}</text></g>)}
        <line x1="40" y1="185" x2="300" y2="185"/>
        <text x="40" y="205">{fmt(range[0])}</text><text x="300" y="205" textAnchor="end">{fmt(range[1])}</text>
        <path d={path} fill="none" stroke="#6553cc" strokeWidth="2.2"/>
        {hasCurrent && <circle cx={px(currentX as number)} cy={py(currentY as number)} r="5" fill="#ee7758"><title>当前值</title></circle>}
      </svg>
      <p className={styles.result} data-formula-point>{input} = {typeof currentX==='number'?fmt(currentX):'—'}，{output} = {typeof currentY==='number'?fmt(currentY):'—'}</p>
      <p>点击曲线改变输入；其他参数保持当前值。无定义的部分留空。</p>
      {!finite.length && <p role="status">该范围内没有可绘制的有限结果，请检查公式定义域。</p>}
    </>:<p role="status">范围下限须小于上限，且位于该参数允许范围内。</p>}
  </section>;
}
