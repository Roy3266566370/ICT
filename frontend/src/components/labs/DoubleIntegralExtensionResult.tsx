import { MathText } from './ProblemText';
import type {DoubleIntegralExtension} from '@/labs/types';
import {LabFormula as Formula} from './ProblemText';
import styles from './ManualLabComposer.module.css';

export function DoubleIntegralExtensionResult({data,complete}:{data:DoubleIntegralExtension;complete:boolean}):JSX.Element{
 const points=data.region_points?.filter(point=>Number.isFinite(point.x)&&Number.isFinite(point.y)) ?? [];
 let path='';let limits='';
 if(points.length>2){
  const xs=points.map(p=>p.x),ys=points.map(p=>p.y);
  const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  const scale=Math.min(340/(maxX-minX || 1),190/(maxY-minY || 1));
  path=points.map((p,i)=>`${i===0?'M':'L'}${200+(p.x-(minX+maxX)/2)*scale},${120-(p.y-(minY+maxY)/2)*scale}`).join(' ')+' Z';
  limits=`x：${minX.toPrecision(4)} 至 ${maxX.toPrecision(4)}；y：${minY.toPrecision(4)} 至 ${maxY.toPrecision(4)}`;
 }
 return <section aria-label="二重积分扩展结果">
  <h4><MathText text={data.title} /></h4>
  {data.facts.map((fact,index)=><div key={index}><p><MathText text={String(fact.label ?? '')} /></p><div className={styles.formula}><Formula tex={fact.latex} block /></div></div>)}
  {complete && data.values.length ? <table className={styles.extensionTable}><caption>已核验的计算结果</caption><thead><tr><th>量</th><th>精确结果</th></tr></thead><tbody>{data.values.map(item=><tr key={item.id}><td><MathText text={String(item.label ?? '')} /></td><td><Formula tex={item.latex} /></td></tr>)}</tbody></table> : null}
  {complete && path ? <figure className={styles.mappingFigure}><svg viewBox="0 0 400 250" width="100%" role="img" aria-label="代换后的原坐标积分区域"><path d={path} fill="#f2dace" stroke="#b65a3c" strokeWidth="2"/></svg><p>{limits}</p><figcaption>原坐标x、y中的区域示意；图形用于观察，边界与雅可比以已核验条件为准。</figcaption></figure> : null}
  {data.notes.map((note,index)=><p key={index}><MathText text={note} /></p>)}
 </section>;
}
