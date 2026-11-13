import {Link} from 'react-router-dom';
import type {ISpec} from '@/ispec/types';
import styles from './ConversionReview.module.css';

export function ConversionReview({materialId,title,pageCount,specs}:{materialId:string;title:string;pageCount:number;specs:ISpec[]}) {
  const interactivePages=new Set(specs.map(s=>s.anchor?.page??s.parameters[0]?.source.page));
  return <main className={styles.page}>
    <nav className={styles.nav}><Link to="/">首页</Link> / <Link to="/space">工作空间</Link> / 转换详情</nav>
    <header><div><span className={styles.eyebrow}>材料转换结果</span><h1>{title}</h1>
      <p>{pageCount} 页原稿 · {interactivePages.size} 页包含交互 · {specs.length} 个交互对象</p></div>
      <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
        <Link className={styles.primary} to={`/materials/${materialId}/ai`}>PPT AI 交互规划 →</Link>
        <Link className={styles.primary} to={`/materials/${materialId}/work`}>打开交互演示 →</Link>
      </div></header>
    <p className={styles.notice}>请逐项核对识别依据。图片推断需要人工检查；可在演示页点击“编辑内容”，纠正文字、数据或交互关系。其余页面保留原稿。</p>
    <section aria-label="已生成的交互对象">{specs.map(spec=>{
      const sources=[...new Map(spec.parameters.map(p=>[`${p.source.page}.${p.source.element_id}.${p.source.excerpt}`,p.source])).values()];
      const page=spec.anchor?.page??sources[0]?.page??1;
      const inferred=spec.parameters.some(p=>p.source.status==='inferred');
      return <article key={spec.object_id}>
        <div className={styles.itemHead}><span className={styles.pageNo}>第 {page} 页</span><span className={styles.badge} data-inferred={inferred}>{inferred?'含推断，请核对':'已提取 / 已确认'}</span></div>
        <h2>{spec.title??'交互对象'}</h2><p>{spec.parameters.length} 个可调参数 · {spec.views.some(v=>v.type==='figure')?'图形与计算同步':spec.kind==='filter'?'图表与数据筛选':'公式与数值同步'}</p>
        <details><summary>识别依据与说明</summary>{sources.map((source,i)=><blockquote key={i}>
          第 {source.page} 页 · {source.status==='inferred'?'系统推断':source.status==='confirmed'?'用户确认':'原文提取'}<p>{source.excerpt}</p></blockquote>)}<p>{spec.notes}</p></details>
        <Link to={`/materials/${materialId}/work?page=${page}`}>在原页核对与操作 ↗</Link>
      </article>;
    })}</section>
  </main>;
}
