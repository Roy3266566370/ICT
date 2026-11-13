import { useId, useState } from 'react';
import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { RouteLink } from '@/components/navigation/RouteLink';
import { KnowledgeSketch } from '@/components/home/KnowledgeSketch';
import { TransformShowcase } from '@/components/home/TransformShowcase';
import type { HeroAccountLink } from '@/components/home/navAccountItems';
import { Build } from '@/components/home/deck/slideContext';
import type { DeckSlideDef } from '@/components/home/deck/DeckStage';
import styles from './HomeSlides.module.css';

export interface HomeSlideActions {
  onUpload: () => void;
  onTry: () => void;
  goTo: (slideId: string) => void;
  accountLink: HeroAccountLink | null;
}

function ArrowIcon({ diagonal = false }: { diagonal?: boolean }): JSX.Element {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
    <path d={diagonal ? 'M6 18 18 6M6 6h12v12' : 'M4 12h15m-6-6 6 6-6 6'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

/** 单位方格到剪切平行四边形的示意图；静态原稿与实验图共用。 */
function ShearFigure({ k, live }: { k: number; live: boolean }): JSX.Element {
  const W = 360;
  const H = 230;
  const ox = 52;
  const oy = 188;
  const unit = 96;
  const pt = (x: number, y: number): string => `${ox + x * unit},${oy - y * unit}`;
  const stroke = live ? '#e8552f' : '#26334a';
  const grid = live ? '#d9d7f2' : '#ece9e2';
  const axis = live ? '#566074' : '#26334a';
  return <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={live ? `实验图：剪切系数 ${k.toFixed(1)}，单位方格变为平行四边形` : '原稿图：单位方格与固定的平行四边形'}>
    {[0, 1, 2, 3].map((i) => <line key={`gx${i}`} x1={ox + i * unit} y1={oy - 2 * unit} x2={ox + i * unit} y2={oy} stroke={grid} strokeWidth=".8" />)}
    {[0, 1, 2].map((i) => <line key={`gy${i}`} x1={ox} y1={oy - i * unit} x2={ox + 3 * unit} y2={oy - i * unit} stroke={grid} strokeWidth=".8" />)}
    <path d={`M${ox} ${oy}h${3 * unit + 10}M${ox} ${oy + 6}V${oy - 2 * unit - 10}`} stroke={axis} strokeWidth="1.2" />
    <polygon points={`${pt(0, 0)} ${pt(1, 0)} ${pt(1, 1)} ${pt(0, 1)}`} fill="none" stroke={live ? '#4f46e5' : '#9aa3b2'} strokeWidth="1.4" strokeDasharray="5 4" />
    <polygon points={`${pt(0, 0)} ${pt(1, 0)} ${pt(1 + k, 1)} ${pt(k, 1)}`} fill={live ? 'rgba(255,122,89,.18)' : '#f0eee8'} stroke={stroke} strokeWidth="2" />
    {live ? <><line x1={ox} y1={oy} x2={ox + (1 + k) * unit} y2={oy - unit} stroke="#ff7a59" strokeWidth="2.2" /><circle cx={ox + (1 + k) * unit} cy={oy - unit} r="5" fill="#ff7a59" /></> : null}
  </svg>;
}

/** 原稿 / 实验 对比：拖动分隔线（原生滑块，可键盘操作）。 */
function CompareCard(): JSX.Element {
  const [pos, setPos] = useState(50);
  const id = useId();
  const k = 1.5;
  return <div className={styles.compare} style={{ '--pos': pos } as CSSProperties} data-deck-interactive>
    <div className={`${styles.layer} ${styles.layerStatic}`}>
      <p className={styles.layerHead}><span>原始课件</span><span>PPTX / 06</span></p>
      <h3 className={styles.layerTitle}>二维线性变换</h3>
      <p className={styles.layerSub}>A = [[1, 1], [0, 1]]</p>
      <ShearFigure k={1} live={false} />
      <p className={styles.layerFoot}><span>只能看一种情况</span><span>k = 1</span></p>
    </div>
    <div className={`${styles.layer} ${styles.layerLive}`} aria-hidden="true">
      <p className={styles.layerHead}><span>交互实验 / LIVE</span><span>实时联动</span></p>
      <h3 className={styles.layerTitle}>二维线性变换</h3>
      <p className={styles.layerSub}>A = [[1, {k.toFixed(1)}], [0, 1]]　A·x = ({(1 + k).toFixed(1)}, 1)</p>
      <ShearFigure k={k} live />
      <p className={styles.layerFoot}><span>面积比 <b>1.00</b></span><span>k 可调</span></p>
    </div>
    <div className={styles.divider} aria-hidden="true" />
    <input id={id} className={styles.compareRange} type="range" min={4} max={96} step={1} value={pos} onChange={(event) => setPos(Number(event.target.value))} aria-label="拖动分隔线，对比静态原稿与交互实验" />
    <span className={styles.handle} aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="m9 7-5 5 5 5M15 7l5 5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
  </div>;
}

const ABILITIES = [
  { no: '01', title: '参数可调', detail: '改变一个条件，亲眼看到图形与结果如何响应。', art: <svg viewBox="0 0 240 56" fill="none" aria-hidden="true"><path d="M4 28h232" stroke="currentColor" opacity=".3" strokeWidth="2" strokeLinecap="round" /><path d="M4 28h118" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /><circle cx="122" cy="28" r="10" fill="currentColor" /><path d="M170 44c20-6 34-26 66-36" stroke="currentColor" opacity=".5" strokeWidth="1.6" /></svg> },
  { no: '02', title: '过程可见', detail: '展开计算步骤，理解结论是怎样一步步得到的。', art: <svg viewBox="0 0 240 56" fill="none" aria-hidden="true"><circle cx="16" cy="28" r="9" stroke="currentColor" strokeWidth="2" /><circle cx="88" cy="28" r="9" stroke="currentColor" strokeWidth="2" /><circle cx="160" cy="28" r="9" stroke="currentColor" strokeWidth="2" /><circle cx="224" cy="28" r="9" fill="currentColor" /><path d="M26 28h52M98 28h52M170 28h44" stroke="currentColor" opacity=".5" strokeWidth="1.6" strokeDasharray="4 4" /></svg> },
  { no: '03', title: '来源可查', detail: '回到对应的原稿页，让每一次探索都有据可循。', art: <svg viewBox="0 0 240 56" fill="none" aria-hidden="true"><rect x="4" y="6" width="64" height="44" rx="4" stroke="currentColor" strokeWidth="2" /><path d="M14 20h34M14 30h44M14 40h24" stroke="currentColor" opacity=".5" strokeWidth="2" strokeLinecap="round" /><path d="M76 28h112" stroke="currentColor" strokeWidth="1.6" strokeDasharray="4 4" /><rect x="176" y="14" width="60" height="28" rx="14" fill="currentColor" /></svg> },
] as const;

const STEPS = [
  { title: '带来你的内容', detail: '上传一份 PPTX，或从交互示例开始。原稿保留，探索从这里发生。' },
  { title: '核对关键条件', detail: '确认识别出的参数与来源，再决定哪些内容值得进一步探索。' },
  { title: '动手改变参数', detail: '拖动、输入、比较。让抽象的关系变成看得见的变化。' },
  { title: '留下你的发现', detail: '保存运行快照，查看计算与校验结果，回顾这一次推演。' },
] as const;

const PILLARS = [
  { title: '识别结果，先由你核对', detail: '公式、条件与来源摘录都会列出，确认之后才进入计算。' },
  { title: '结论由计算内核生成', detail: '数值来自确定性计算，不是模型的口头回答。' },
  { title: '每个参数，都能回到原稿', detail: '标注来自哪一页、哪个元素。访客材料默认保留 24 小时。' },
] as const;

export function buildHomeSlides({ onUpload, onTry, goTo, accountLink }: HomeSlideActions): DeckSlideDef[] {
  return [
    {
      id: 'cover', title: '封面', tone: 'tint', builds: 0,
      render: () => <div className={styles.cover}>
        <div>
          <p className={styles.eyebrow}><span aria-hidden="true" />万象 · WANXIANG</p>
          <h1 className={styles.h1}>让每一页，<br /><em>都能回应你。</em></h1>
          <p className={styles.sub}>把静态课件，变成可亲手验证的交互实验。<br />改变参数，让图形、公式与结论一起回应你的好奇。</p>
          <div className={styles.actions}>
            <button type="button" className={styles.primary} onClick={onUpload}>上传 PPT，开始探索 <ArrowIcon /></button>
            <button type="button" className={styles.secondary} onClick={onTry}><span className={styles.playIcon} aria-hidden="true">▷</span>亲手试一试</button>
          </div>
          <ul className={styles.note}><li>PPTX</li><li>70 MB 以内</li><li>访客也可体验</li></ul>
        </div>
        <aside className={styles.coverAside} aria-label="交互知识的探索理念">
          <div className={styles.figLabel}><span>WANXIANG / KNOWLEDGE STUDIO</span><span>FIG. 01</span></div>
          <div className={styles.sketch}><KnowledgeSketch /></div>
          <div className={styles.sketchCap}><span className={styles.sketchIdx}>[ x → ∞ ]</span><p>从一个条件出发，<br />看见更多可能。</p></div>
        </aside>
      </div>,
    },
    {
      id: 'problem', title: '问题', tone: 'paper', builds: 0,
      render: () => <div className={`${styles.page} ${styles.problem}`}>
        <div>
          <p className={styles.kicker}>01 / THE PROBLEM</p>
          <h2 className={styles.h2}>一页课件，<br />只能看，<em>不能问。</em></h2>
          <p className={styles.lead}>公式、图形和结论都被冻结在一张图上。想知道“如果参数变了呢”，只能自己重画一遍。</p>
          <ol className={styles.questions}>
            <li><span>Q1</span>k 变成 2，图形会怎样？</li>
            <li><span>Q2</span>面积为什么没有变？</li>
            <li><span>Q3</span>这个结论是从哪一步来的？</li>
          </ol>
        </div>
        <CompareCard />
      </div>,
    },
    {
      id: 'demo', title: '亲手试一试', tone: 'paper', builds: 0,
      render: () => <div className={styles.page}>
        <header className={styles.demoHead}>
          <div><p className={styles.kicker}>02 / LIVE EXPLORATION</p><h2 className={styles.h2}>理解，从一个变化开始<em>。</em></h2></div>
          <p className={styles.demoDesc}>拖动右侧的剪切系数，<br />看看图形、公式与结果如何一起变化。</p>
        </header>
        <div className={styles.demoBox} data-deck-interactive><TransformShowcase /></div>
      </div>,
    },
    {
      id: 'abilities', title: '三项能力', tone: 'paper', builds: 3,
      render: () => <div className={styles.page}>
        <header><p className={styles.kicker}>03 / WHAT YOU GET</p><h2 className={styles.h2}>每一次探索，<br />都有三个落点<em>。</em></h2></header>
        <div className={styles.abilities} role="group" aria-label="核心能力">
          {ABILITIES.map((item, index) => <Build key={item.no} at={index + 1} className={styles.ability}>
            <span className={styles.abilityNo}>{item.no}</span>
            <h3>{item.title}</h3>
            <p>{item.detail}</p>
            <div className={styles.abilityArt}>{item.art}</div>
          </Build>)}
        </div>
      </div>,
    },
    {
      id: 'paths', title: '三个入口', tone: 'paper', builds: 3,
      render: () => <div className={styles.page}>
        <header><p className={styles.kicker}>04 / FIND YOUR STARTING POINT</p><h2 className={styles.h2}>好奇心，有自己的入口<em>。</em></h2></header>
        <div className={styles.paths}>
          <Build at={1} as="button" className={styles.path} extra={{ type: 'button', onClick: onUpload }}>
            <PathBody tag="从一份课件开始" drawText="PPTX → Web" title="让整份课件，动起来。" detail="上传 PPTX，识别公式、表格与图表，生成可翻页、可编辑、可调参的网页。" action="上传 PPT" inline
              art={<svg viewBox="0 0 200 90" fill="none"><rect x="12" y="22" width="84" height="52" rx="4" stroke="currentColor" opacity=".35" /><rect x="28" y="12" width="84" height="52" rx="4" fill="var(--deck-card)" stroke="currentColor" /><path d="M42 48l14-14 12 10 16-20" stroke="currentColor" strokeWidth="1.5" /><path d="M126 38h40m-10-10 10 10-10 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>} />
          </Build>
          <Build at={2} as={Link} className={styles.path} extra={{ to: '/labs' }}>
            <PathBody tag="从一道题开始" drawText="x² + y² = r²" title="让问题，变得可推演。" detail="上传题目或粘贴文字，在分步实验中探索条件、过程与答案。" action="进入题目实验室"
              art={<svg viewBox="0 0 300 90" fill="none"><path d="M10 70h280M55 85V5" stroke="currentColor" opacity=".2" /><path d="M35 75Q105-38 175 75M155 75Q210-13 265 45" stroke="currentColor" strokeWidth="1.4" /><circle cx="105" cy="19" r="4" fill="currentColor" /><path d="M105 19v51" stroke="currentColor" strokeDasharray="3 4" opacity=".4" /></svg>} />
          </Build>
          <Build at={3} as={Link} className={styles.path} extra={{ to: '/examples' }}>
            <PathBody tag="从一次体验开始" drawText="A → B → C" title="换个视角，重新理解。" detail="从数学、计算机到办公推演，打开一个示例，直接动手试。" action="探索交互示例"
              art={<svg viewBox="0 0 300 90" fill="none"><path d="M47 46h96l78-27M143 46l78 27" stroke="currentColor" strokeWidth="1.3" /><circle cx="47" cy="46" r="16" fill="var(--deck-card)" stroke="currentColor" /><circle cx="143" cy="46" r="16" fill="var(--deck-card)" stroke="currentColor" /><circle cx="235" cy="19" r="13" fill="var(--deck-card)" stroke="currentColor" /><circle cx="235" cy="73" r="13" fill="var(--deck-card)" stroke="currentColor" /><circle cx="143" cy="46" r="4" fill="currentColor" /></svg>} />
          </Build>
        </div>
      </div>,
    },
    {
      id: 'workflow', title: '工作流程', tone: 'paper', builds: 4,
      render: () => <div className={styles.page}>
        <header className={styles.flowHead}>
          <div><p className={styles.kicker}>05 / HOW IT WORKS</p><h2 className={styles.h2}>你的内容，<br />新的可能<em>。</em></h2></div>
          <button className={styles.textLink} type="button" onClick={onUpload}>从你的第一份 PPT 开始 <ArrowIcon /></button>
        </header>
        <ol className={styles.timeline}>
          {STEPS.map((step, index) => <Build key={step.title} as="li" at={index + 1} className={styles.step}>
            <span className={styles.stepNo}>0{index + 1}</span>
            <h3>{step.title}</h3>
            <p>{step.detail}</p>
          </Build>)}
        </ol>
      </div>,
    },
    {
      id: 'trust', title: '可信度', tone: 'tint', builds: 3,
      render: () => <div className={`${styles.page} ${styles.trust}`}>
        <div>
          <p className={styles.kicker}>06 / TRUST</p>
          <h2 className={styles.h2}>AI 会说错，<br /><em>每一步都留给你核对。</em></h2>
          <ul className={styles.pillars}>
            {PILLARS.map((item, index) => <Build key={item.title} as="li" at={index + 1} className={styles.pillar}>
              <span>0{index + 1}</span><h3>{item.title}</h3><p>{item.detail}</p>
            </Build>)}
          </ul>
          <div className={styles.actions}><RouteLink className={styles.textLink} to="/trust-demo">看看 AI 说错了会怎样 <ArrowIcon diagonal /></RouteLink></div>
        </div>
        <Build at={1} as="aside" className={styles.checkCard}>
          <p className={styles.checkHead}><span>核对示意 / ILLUSTRATION</span><span>识别结果</span></p>
          <div className={styles.checkRow}><div><b>识别到的公式</b><code>y = x² + 2x</code></div><span className={`${styles.badge} ${styles.badgeOk}`}>已确认</span></div>
          <div className={styles.checkRow}><div><b>积分区间</b><code>下限缺失</code></div><span className={`${styles.badge} ${styles.badgeWarn}`}>待核对</span></div>
          <div className={styles.checkRow}><div><b>来源</b><code>原稿 · 第 6 页</code></div><span className={`${styles.badge} ${styles.badgeOk}`}>可回看</span></div>
          <p className={styles.checkFoot}>条件补齐并确认之后，才会开始求解。</p>
        </Build>
      </div>,
    },
    {
      id: 'closing', title: '开始', tone: 'tint', builds: 0,
      render: () => <div className={`${styles.page} ${styles.closing}`}>
        <div className={styles.closingBody}>
          <p className={styles.kicker}>MAKE ROOM FOR CURIOSITY</p>
          <h2 className={styles.h1}>下一次发现，<br /><em>从你开始。</em></h2>
          <p className={styles.sub}>访客也可以直接体验，无需先注册。</p>
          <div className={styles.actions}>
            <button className={styles.primary} type="button" onClick={onUpload}>带来你的 PPT <ArrowIcon /></button>
          </div>
          <div className={styles.links}>
            <RouteLink className={styles.textLink} to="/examples">浏览交互示例 <ArrowIcon diagonal /></RouteLink>
            <RouteLink className={styles.textLink} to="/labs">进入题目实验室 <ArrowIcon diagonal /></RouteLink>
            {accountLink !== null && <Link className={styles.textLink} to={accountLink.to}>{accountLink.label} <ArrowIcon diagonal /></Link>}
          </div>
        </div>
        <footer className={styles.closingFoot}>
          <Link className={styles.brand} to="/" aria-label="万象首页">万象 <span>WANXIANG</span></Link>
          <p>让知识可见，让理解发生。</p>
          <button type="button" onClick={() => goTo('workflow')}>使用指南 <ArrowIcon diagonal /></button>
        </footer>
      </div>,
    },
  ];
}

interface PathBodyProps {
  tag: string; drawText: string; title: string; detail: string; action: string; art: JSX.Element;
  /** 放在 <button> 内时只能使用短语内容，标题和段落改用 span。 */
  inline?: boolean;
}

function PathBody({ tag, drawText, title, detail, action, art, inline = false }: PathBodyProps): JSX.Element {
  return <>
    <span className={styles.pathTag}>{tag}</span>
    <span className={styles.pathDraw} aria-hidden="true"><span>{drawText}</span>{art}</span>
    {inline ? <span className={styles.pathTitle}>{title}</span> : <h3 className={styles.pathTitle}>{title}</h3>}
    {inline ? <span className={styles.pathText}>{detail}</span> : <p className={styles.pathText}>{detail}</p>}
    <span className={styles.pathAction}>{action} <ArrowIcon /></span>
  </>;
}
