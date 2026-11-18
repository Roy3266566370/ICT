import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import markUrl from '@/assets/brand/wanxiang-mark.png';
import { SiteNav } from '@/components/home/SiteNav';
import { HomeBench } from '@/components/home/redesign/HomeBench';
import { prefetchCommonRoutes } from '@/components/navigation/routePrefetch';
import { useUploadDialog } from '@/components/home/deck/useUploadDialog';
import { LivingUploadPanel } from '@/components/upload/LivingUploadPanel';
import './HomeRedesign.css';

const WORKSHOP_ITEMS = [
  { no: '01', label: '函数变换与图像', note: 'a / b / c 参数滑杆', node: 'plot' },
  { no: '02', label: '重要极限 sin x / x', note: '左右趋近与极限值', node: 'deriv' },
  { no: '03', label: '左右极限与间断', note: '单侧极限与可去间断', node: 'deriv' },
  { no: '04', label: '从割线走向切线', note: '差商、导数与斜率', node: 'deriv' },
  { no: '05', label: '黎曼和与定积分', note: '左 / 中 / 右端点', node: 'integral' },
  { no: '06', label: '定积分不等于几何面积', note: '正负抵消与绝对值', node: 'integral' },
  { no: '07', label: '泰勒展开与局部近似', note: '一至五阶与误差', node: 'taylor' },
] as const;

const BOUNDARIES = [
  {
    no: '01',
    title: '不替证明',
    body: '图形和数值只能作为核对证据。证明题仍然需要写出证明，我们不把“看起来成立”当作成立。',
  },
  {
    no: '02',
    title: '不硬答',
    body: '没建立可执行模型的题，保留原题、标注原因。不编造缺失条件，也不默认塞进一个教学示例。',
  },
  {
    no: '03',
    title: '不跳过核对',
    body: '图片里的指数、分式、根号与区间，先对照原稿确认。识别结果和候选都留痕，你点头之后才算数。',
  },
  {
    no: '04',
    title: '不带走隐私',
    body: '分享快照只保留轨迹、笔记与模型，不含会话信息和文件系统路径；链接可随时撤销。',
  },
] as const;

/* ------------------------------------------------------------------ */
/* Specimen figures                                                    */
/* ------------------------------------------------------------------ */

function IntegralSpecimenArt(): JSX.Element {
  return (
    <svg viewBox="0 0 520 220" role="img" aria-label="函数 y=x² 在 0 到 1 上的面积示意">
      <g className="art-grid">
        <path d="M60 20v170M60 190h430M138 20v170M216 20v170M294 20v170M372 20v170" />
        <path d="M60 58h430M60 96h430M60 134h430M60 172h430" />
      </g>
      <g className="art-rects">
        {[66, 94, 122, 150, 178, 206, 234, 262, 290, 318, 346, 374].map((x, index) => {
          const y = [166, 164, 160, 153, 145, 134, 120, 104, 85, 62, 36, 20][index] ?? 20;
          const height = 190 - y;
          return <rect key={x} x={x} y={y} width="21" height={height} />;
        })}
      </g>
      <path className="art-curve" d="M66 190C110 188 150 176 190 156C246 128 300 92 348 54C370 37 392 24 410 20" />
      <path className="art-axis" d="M60 20v170h430" />
      <g className="art-label">
        <text x="402" y="211">x</text><text x="46" y="30">y</text>
        <text x="58" y="211">0</text><text x="390" y="211">1</text>
        <text x="66" y="46">y = x²</text>
      </g>
      <g className="art-dim">
        <path d="M66 198h344M66 193v10M410 193v10" />
        <text x="224" y="216">Riemann sum · n = 12</text>
      </g>
    </svg>
  );
}

function DoubleIntegralSpecimenArt(): JSX.Element {
  return (
    <svg viewBox="0 0 360 220" role="img" aria-label="由 y 等于 x 平方与 y 等于根号 x 围成的区域">
      <g className="art-grid">
        <path d="M46 18v174M46 192h280M118 18v174M190 18v174M262 18v174" />
        <path d="M46 48h280M46 84h280M46 120h280M46 156h280" />
      </g>
      <path className="art-fill" d="M46 192C84 190 96 142 120 116C150 84 200 40 262 26C222 50 186 94 158 132C130 170 90 192 46 192Z" />
      <path className="art-curve" d="M46 192C84 190 96 142 120 116C150 84 200 40 262 26" />
      <path className="art-curve art-curve--alt" d="M46 192C90 192 130 170 158 132C186 94 222 50 262 26" />
      <path className="art-axis" d="M46 18v174h280" />
      <g className="art-label">
        <text x="160" y="130">D</text>
        <text x="270" y="206">x</text><text x="34" y="28">y</text>
        <text x="40" y="207">0</text><text x="256" y="207">1</text>
        <text x="166" y="62">y = √x</text><text x="142" y="168">y = x²</text>
      </g>
    </svg>
  );
}

function OptimizationSpecimenArt(): JSX.Element {
  return (
    <svg viewBox="0 0 320 210" role="img" aria-label="梯度下降在等高线上的迭代轨迹">
      <g className="art-grid">
        <path d="M30 16v178M30 194h270M100 16v178M170 16v178M240 16v178" />
        <path d="M30 54h270M30 100h270M30 146h270" />
      </g>
      <g className="art-contours">
        <ellipse cx="196" cy="106" rx="104" ry="54" transform="rotate(-18 196 106)" />
        <ellipse cx="196" cy="106" rx="78" ry="40" transform="rotate(-18 196 106)" />
        <ellipse cx="196" cy="106" rx="52" ry="26" transform="rotate(-18 196 106)" />
        <ellipse cx="196" cy="106" rx="26" ry="13" transform="rotate(-18 196 106)" />
      </g>
      <path className="art-path" d="M62 42 84 58 104 72 122 84 138 93 152 99 164 103 174 105 182 106 188 106" />
      <g className="art-points">
        <circle cx="62" cy="42" r="4" /><circle cx="104" cy="72" r="3" /><circle cx="138" cy="93" r="3" /><circle cx="164" cy="103" r="3" />
      </g>
      <circle className="art-point" cx="196" cy="106" r="5" />
      <g className="art-label">
        <text x="28" y="30">起点 (−1.6, 1.2)</text>
        <text x="205" y="100">驻点 (0, 0)</text>
        <text x="278" y="206">x</text>
      </g>
    </svg>
  );
}

function BfsSpecimenArt(): JSX.Element {
  return (
    <svg viewBox="0 0 320 210" role="img" aria-label="广度优先搜索的无向图与访问顺序">
      <g className="art-edges">
        <path d="M160 34 92 96M160 34l68 62M92 96l-36 76M92 96l40 76M228 96l34 76M132 172h96" />
      </g>
      <g className="art-nodes">
        <circle className="is-visited" cx="160" cy="34" r="17" /><text x="155" y="40">A</text>
        <circle className="is-visited" cx="92" cy="96" r="17" /><text x="87" y="102">B</text>
        <circle className="is-visited" cx="228" cy="96" r="17" /><text x="223" y="102">C</text>
        <circle className="is-frontier" cx="56" cy="172" r="17" /><text x="51" y="178">D</text>
        <circle className="is-frontier" cx="132" cy="172" r="17" /><text x="127" y="178">E</text>
        <circle className="is-frontier" cx="228" cy="172" r="17" /><text x="223" y="178">F</text>
      </g>
      <g className="art-label">
        <text x="20" y="24">queue → [ D, E, F ]</text>
        <text x="232" y="26">depth 2</text>
      </g>
    </svg>
  );
}

function OsSpecimenArt(): JSX.Element {
  return (
    <svg viewBox="0 0 320 210" role="img" aria-label="短作业优先调度的甘特图">
      <g className="art-grid">
        <path d="M44 18v164M44 182h250M94 18v164M144 18v164M194 18v164M244 18v164M294 18v164" />
      </g>
      <g className="art-label">
        <text x="46" y="44">P1</text><text x="46" y="82">P2</text><text x="46" y="120">P3</text><text x="46" y="158">P4</text>
        <text x="40" y="200">0</text><text x="118" y="200">2</text><text x="168" y="200">4</text><text x="218" y="200">6</text><text x="268" y="200">8</text>
      </g>
      <g className="art-bars">
        <rect x="44" y="30" width="50" height="18" /><rect x="144" y="30" width="74" height="18" />
        <rect x="94" y="68" width="38" height="18" /><rect x="218" y="68" width="58" height="18" />
        <rect x="132" y="106" width="38" height="18" /><rect x="170" y="106" width="38" height="18" />
        <rect x="208" y="144" width="34" height="18" /><rect x="242" y="144" width="48" height="18" />
      </g>
      <path className="art-line" d="M144 20v166" strokeDasharray="3 4" />
      <g className="art-label"><text x="150" y="18">SRTF · 切换点</text></g>
    </svg>
  );
}

function NetworkSpecimenArt(): JSX.Element {
  return (
    <svg viewBox="0 0 520 200" role="img" aria-label="小型全连接网络的前向与反向传播">
      <g className="art-net">
        <path d="M70 58 210 36M70 58 210 100M70 58 210 164M70 100 210 36M70 100 210 100M70 100 210 164M70 142 210 36M70 142 210 100M70 142 210 164M210 36 360 60M210 36 360 100M210 36 360 140M210 100 360 60M210 100 360 100M210 100 360 140M210 164 360 60M210 164 360 100M210 164 360 140" />
      </g>
      <g className="art-layer">
        <circle cx="70" cy="58" r="7" /><circle cx="70" cy="100" r="7" /><circle cx="70" cy="142" r="7" />
        <circle cx="210" cy="36" r="7" /><circle cx="210" cy="100" r="7" /><circle cx="210" cy="164" r="7" />
        <circle cx="360" cy="60" r="7" /><circle cx="360" cy="100" r="7" /><circle cx="360" cy="140" r="7" />
      </g>
      <g className="art-label">
        <text x="44" y="180">input · 3</text><text x="186" y="188">hidden · 3</text><text x="338" y="170">output · 3</text>
        <text x="418" y="58">MSE</text><text x="418" y="82">前向 → 反向</text>
        <path d="M398 100h64m-12-8 12 8-12 8" />
        <text x="414" y="130">∂L/∂W</text>
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------------ */

export function HomePage(): JSX.Element {
  const navigate = useNavigate();
  const { open: uploadOpen, openUpload, closeUpload, closeRef, dialogRef } = useUploadDialog();
  const [confirmed, setConfirmed] = useState(false);
  const [ask, setAsk] = useState('');
  const [activeNode, setActiveNode] = useState<string | null>(null);
  const rulerFillRef = useRef<HTMLElement>(null);
  const rulerNumRef = useRef<HTMLElement>(null);

  useEffect(() => { prefetchCommonRoutes(); }, []);
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, []);

  // Ruler progress: direct DOM updates, no per-frame React renders.
  useEffect(() => {
    let frame = 0;
    const update = (): void => {
      frame = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const pct = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      if (rulerFillRef.current) rulerFillRef.current.style.height = `${(pct * 100).toFixed(1)}%`;
      if (rulerNumRef.current) rulerNumRef.current.textContent = String(Math.round(pct * 100)).padStart(3, '0');
    };
    const onScroll = (): void => {
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(update);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    update();
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, []);

  // Reveal section-level blocks as they enter the viewport.
  useEffect(() => {
    const elements = Array.from(document.querySelectorAll<HTMLElement>('.wx-home .reveal'));
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) {
      elements.forEach((element) => element.classList.add('is-in'));
      return undefined;
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);

  const handleAsk = useCallback((event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const question = ask.trim();
    navigate(question === '' ? '/labs' : `/labs?question=${encodeURIComponent(question)}`);
  }, [ask, navigate]);

  const reveal = 'reveal';

  return (
    <>
      <SiteNav current="home" onUpload={openUpload} />

      <div className="wx-home">
        <div className="ruler" aria-hidden="true">
          <span className="ruler__label">SCROLL</span>
          <div className="ruler__track"><i ref={rulerFillRef} /></div>
          <span className="ruler__num" ref={rulerNumRef}>000</span>
        </div>

        <main id="main">
          {/* HERO */}
          <section className="hero" id="top">
            <div className="hero__meta">
              <span className="eyebrow"><i className="cross" aria-hidden="true" /> QUESTION LAB · 题目实验室</span>
              <span className="hero__meta-right">本地识别优先 · 可核对 · 可回放</span>
            </div>

            <div className="hero__grid">
              <div className="hero__copy">
                <h1 className="hero__title">
                  一道题，<br />
                  值得被<span className="brush">拆开<svg viewBox="0 0 220 18" preserveAspectRatio="none" aria-hidden="true"><path d="M4 12C58 4 148 3 214 9" /><path d="M12 16C74 10 154 9 206 14" /></svg></span>。
                </h1>

                <p className="hero__lead">
                  把题干、截图或整份试卷交给万象。我们把它读成条件、搭成模型，做成一张能亲手推演的实验台——<strong>答案只是起点，过程才是你的。</strong>
                </p>

                <div className="hero__actions">
                  <Link className="btn btn--primary" to="/labs">带一道题来 <span aria-hidden="true">↗</span></Link>
                  <a className="btn btn--quiet" href="#method">看它怎么拆 <span aria-hidden="true">↓</span></a>
                </div>

                <div className="hero__fineprint">
                  <span>PDF / PNG / JPG / PPTX / 文字</span>
                  <span>单次最多 6 份材料</span>
                  <span>公式先核对，再求解</span>
                </div>

                <div className="hero__note" aria-hidden="true">
                  <svg viewBox="0 0 96 54" fill="none"><path d="M4 48C30 46 72 38 88 8M76 12l13-6-2 14" /></svg>
                  <p>答案不是句号。<br />把条件改一改，<br />看它还成不成立。</p>
                </div>
              </div>

              <div className="hero__bench-wrap">
                <HomeBench />
              </div>
            </div>

            <div className="hero__subjects" aria-label="已覆盖的题目类型">
              <span className="hero__subjects-label">台面上已经跑过</span>
              <div className="hero__subjects-list">
                <span>微积分</span><i aria-hidden="true" />
                <span>二重积分</span><i aria-hidden="true" />
                <span>最优化</span><i aria-hidden="true" />
                <span>数据结构与算法</span><i aria-hidden="true" />
                <span>操作系统</span><i aria-hidden="true" />
                <span>深度学习</span>
              </div>
              <a className="hero__subjects-link" href="#specimens">看标本 <span aria-hidden="true">↓</span></a>
            </div>
          </section>

          {/* METHOD */}
          <section className="method section" id="method">
            <div className={`method__intro ${reveal}`}>
              <p className="eyebrow"><span className="sec-no">§ 01</span> METHOD / 拆题方法</p>
              <h2>拆题，<br />是门手艺。</h2>
              <p className="lead">不是把题目丢给一个黑箱，等一句“答案是”。是把题干、图形和数字逐层摊开，让每一步都有来处。</p>
              <figure className="method__quote">
                <blockquote>“把看不懂的那一步，<br />留在光下面。”</blockquote>
                <figcaption>万象实验手记 · 第 12 页</figcaption>
              </figure>
              <div className="method__seal" aria-hidden="true">手工<br />核对</div>
            </div>

            <div className="method__steps">
              <article className={`step ${reveal}`}>
                <div className="step__index"><span>01</span><i aria-hidden="true" /><em>READ</em></div>
                <div className="step__body">
                  <div className="step__head">
                    <h3>先读题，不急着算。</h3>
                    <span className="tag">文字层 / OCR</span>
                  </div>
                  <p>文字层优先，图片走本地 OCR。指数、分式、根号、积分上下限——凡是可能改变结果的地方，原图与候选一起保留。拿不准，就把问题交还给你。</p>

                  <div className={`checkcard${confirmed ? ' is-confirmed' : ''}`}>
                    <div className="checkcard__head">
                      <span>识别核对 · 原图对照</span>
                      <span className="checkcard__state">{confirmed ? '已确认' : '待确认'}</span>
                    </div>
                    <div className="checkcard__body">
                      <div className="checkcard__formula" aria-label="公式：从 0 到正无穷，x 乘 e 的负 x 次方，对 x 积分">
                        ∫<sub>0</sub><sup>+∞</sup> x·e<sup>−x</sup> dx
                      </div>
                      <div className="checkcard__chips">
                        <span>上限 +∞</span><span>指数 −x</span><span>一次项 x</span>
                      </div>
                    </div>
                    <div className="checkcard__foot">
                      <span className="checkcard__note">原图与 OCR 候选都保留</span>
                      <span className="checkcard__actions">
                        <Link className="mini-btn" to="/labs">去核对</Link>
                        <button
                          className="mini-btn mini-btn--solid"
                          type="button"
                          disabled={confirmed}
                          onClick={() => setConfirmed(true)}
                        >
                          {confirmed ? '已核对' : '确认'}
                        </button>
                      </span>
                    </div>
                  </div>
                  <p className="step__marginal">认不出的题，不硬答。没有可执行模型时，保留原题、说明原因，而不是套一个最优化示例。</p>
                </div>
              </article>

              <article className={`step ${reveal}`}>
                <div className="step__index"><span>02</span><i aria-hidden="true" /><em>MODEL</em></div>
                <div className="step__body">
                  <div className="step__head">
                    <h3>把句子，变成可执行的模型。</h3>
                    <span className="tag">声明式建模</span>
                  </div>
                  <p>题干被拆成区域、目标、约束与状态。每一行模型都能追溯到原题里的那一句话；参数不是猜的，来源写在旁边。</p>
                  <div className="modelcard" role="figure" aria-label="模型定义示意">
                    <div className="modelcard__row"><span className="modelcard__key">region</span><code>D = {'{ y² ≤ x, x² ≤ y }'}</code><em>题干第 1 句</em></div>
                    <div className="modelcard__row"><span className="modelcard__key">integrand</span><code>(x − y + 1)²</code><em>题干公式</em></div>
                    <div className="modelcard__row"><span className="modelcard__key">kernel</span><code>polynomial · 2D</code><em className="is-ok">已建模型</em></div>
                    <div className="modelcard__result"><span>内核结果</span><strong>71 / 210</strong><span>≈ 0.3381</span></div>
                  </div>
                </div>
              </article>

              <article className={`step ${reveal}`}>
                <div className="step__index"><span>03</span><i aria-hidden="true" /><em>PLAY</em></div>
                <div className="step__body">
                  <div className="step__head">
                    <h3>上手，才算真的看懂。</h3>
                    <span className="tag">参数 / 轨迹 / 追问</span>
                  </div>
                  <p>拖动滑杆、单步播放、在任意一帧停下来追问。最后带走的不是一张答案纸，而是一条能回放、能改写、能分享的思考路径。</p>
                  <div className="tracecard" role="figure" aria-label="迭代轨迹示意">
                    <div className="tracecard__head"><span><i aria-hidden="true" /> TRACE · 迭代回放</span><span>学习率 0.05</span></div>
                    <div className="tracecard__track" aria-hidden="true">
                      <span className="tracecard__bar" style={{ width: '72%' }} />
                      <i className="tracecard__dot" style={{ left: '14%' }} />
                      <i className="tracecard__dot" style={{ left: '38%' }} />
                      <i className="tracecard__dot is-now" style={{ left: '72%' }} />
                    </div>
                    <div className="tracecard__foot"><span>STEP 004 / 018</span><span>‖∇f‖ = 0.061</span><span className="is-now">停在这里 · 可局部追问</span></div>
                  </div>
                  <p className="step__marginal">数值与图形只作为证据，不替代证明；能给出的边界，我们写在明面上。</p>
                </div>
              </article>
            </div>
          </section>

          {/* SPECIMENS */}
          <section className="specimens section" id="specimens">
            <header className={`section-head ${reveal}`}>
              <div>
                <p className="eyebrow"><span className="sec-no">§ 02</span> SPECIMENS / 题目标本</p>
                <h2>六张标本，<br />六种拆法。</h2>
              </div>
              <div className="section-head__aside">
                <p>不是截图，也不靠编造：每个出现的数字，都能在实验室内核里重新跑一遍。</p>
                <span className="section-head__note">标本编号 A—01 至 A—06 · 持续更新</span>
              </div>
            </header>

            <div className="specimen-grid">
              <article className="specimen specimen--wide specimen--a">
                <header className="specimen__head"><span className="specimen__no">A—01</span><span className="specimen__field">微积分 / 定积分</span></header>
                <div className="specimen__art"><IntegralSpecimenArt /></div>
                <div className="specimen__meta"><h3>曲线下不是数字，是一叠薄片。</h3><p>黎曼和、解析值与误差同屏。把分割数调大，看它一步步走向 1/3。</p></div>
                <footer className="specimen__foot"><code>∫₀¹ x² dx = 1/3</code><Link to="/labs">打开实验 <span aria-hidden="true">↗</span></Link></footer>
              </article>

              <article className="specimen specimen--b">
                <header className="specimen__head"><span className="specimen__no">A—02</span><span className="specimen__field">微积分 / 二重积分</span></header>
                <div className="specimen__art"><DoubleIntegralSpecimenArt /></div>
                <div className="specimen__meta"><h3>两片边界，围出一个分数。</h3><p>区域、切片与二维中点同屏，模型里的每个不等号都有出处。</p></div>
                <footer className="specimen__foot"><code>71 / 210 ≈ 0.3381</code><Link to="/labs">打开实验 <span aria-hidden="true">↗</span></Link></footer>
              </article>

              <article className="specimen specimen--c">
                <header className="specimen__head"><span className="specimen__no">A—03</span><span className="specimen__field">最优化 / 梯度</span></header>
                <div className="specimen__art"><OptimizationSpecimenArt /></div>
                <div className="specimen__meta"><h3>每一步，都看得见为什么落下。</h3><p>梯度、学习率、轨迹与停止原因；鞍点和极小值分别标记。</p></div>
                <footer className="specimen__foot"><code>(0, 0) · ‖∇f‖ &lt; 1e−3</code><Link to="/labs">打开实验 <span aria-hidden="true">↗</span></Link></footer>
              </article>

              <article className="specimen specimen--d">
                <header className="specimen__head"><span className="specimen__no">A—04</span><span className="specimen__field">数据结构 / BFS</span></header>
                <div className="specimen__art"><BfsSpecimenArt /></div>
                <div className="specimen__meta"><h3>队列不是动画，是真的先进先出。</h3><p>真实队列、父节点与层级；暂停在任何一步，都能看到伪代码停在哪一行。</p></div>
                <footer className="specimen__foot"><code>A → B → C → D → E → F</code><Link to="/labs">打开实验 <span aria-hidden="true">↗</span></Link></footer>
              </article>

              <article className="specimen specimen--e">
                <header className="specimen__head"><span className="specimen__no">A—05</span><span className="specimen__field">操作系统 / 调度</span></header>
                <div className="specimen__art"><OsSpecimenArt /></div>
                <div className="specimen__meta"><h3>同一组进程，换一种调度再跑。</h3><p>甘特图、就绪队列、周转与等待时间逐帧联动，可切换五种算法对照。</p></div>
                <footer className="specimen__foot"><code>5 种调度 · 逐帧对照</code><Link to="/labs">打开实验 <span aria-hidden="true">↗</span></Link></footer>
              </article>

              <article className="specimen specimen--f">
                <header className="specimen__head"><span className="specimen__no">A—06</span><span className="specimen__field">深度学习 / 反向传播</span></header>
                <div className="specimen__figure"><NetworkSpecimenArt /></div>
                <div className="specimen__aside">
                  <div>
                    <h3>每个梯度，都指回它的那次前向。</h3>
                    <p>展开每一层看形状、中间值与梯度；权重来源标明“题目提供”或“教学初始化”。</p>
                    <footer className="specimen__foot"><code>3–3–3 · 逐层可查</code><Link to="/labs">打开实验 <span aria-hidden="true">↗</span></Link></footer>
                  </div>
                  <div className="specimen__roadmap">
                    <span className="specimen__roadmap-label">还在路上的标本</span>
                    <span>概率统计</span><span>线性代数</span><span>编译原理</span>
                    <p>没做完的，不写在能力清单里。</p>
                  </div>
                </div>
              </article>
            </div>
          </section>

          {/* WORKSHOP */}
          <section className="workshop" id="workshop">
            <div className="workshop__inner">
              <header className={`workshop__head ${reveal}`}>
                <p className="eyebrow"><span className="sec-no">§ 03</span> WORKSHOP / 万象工坊</p>
                <div className="workshop__headline">
                  <h2>没有题目的时候，<br />就自己搭一个。</h2>
                  <p>工坊是实验室的另一半。把函数、图像、极限、导数与积分拖上画布，或摆下 408 的全题型工作台与二叉树遍历、Cache 地址、页面置换、子网划分——接线、调参、封装成自己的积木。</p>
                </div>
              </header>

              <div className={`workshop__body ${reveal}`}>
                <div className="workshop__list-wrap">
                  <div className="workshop__list-head"><span>高数 7 组 · 408 全题型已接通</span><span>列表与蓝图对应</span></div>
                  <ol className="workshop__list">
                    {WORKSHOP_ITEMS.map((item) => (
                      <li key={item.no}>
                        <Link
                          className="workshop__item"
                          to="/workshop"
                          data-node={item.node}
                          onMouseEnter={() => setActiveNode(item.node)}
                          onMouseLeave={() => setActiveNode(null)}
                          onFocus={() => setActiveNode(item.node)}
                          onBlur={() => setActiveNode(null)}
                        >
                          <span>{item.no}</span><b>{item.label}</b><em>{item.note}</em>
                        </Link>
                      </li>
                    ))}
                  </ol>
                  <Link className="workshop__cta" to="/workshop">去工坊搭一个 <span aria-hidden="true">↗</span></Link>
                </div>

                <div className="workshop__board" aria-label="万象工坊积木连接示意">
                  <div className="board__label"><span>BLUEPRINT · 001</span><span>拖拽 · 接线 · 调参</span></div>
                  <svg className="board__svg" viewBox="0 0 640 430" role="img" aria-label="函数源、图像、导数切线、黎曼积分与泰勒近似的积木连接图">
                    <defs>
                      <pattern id="board-dots" width="24" height="24" patternUnits="userSpaceOnUse">
                        <circle cx="1.5" cy="1.5" r="1.1" fill="currentColor" opacity=".28" />
                      </pattern>
                    </defs>
                    <rect className="board__grid" x="0" y="0" width="640" height="430" fill="url(#board-dots)" />
                    <g className="board__wires">
                      <path d="M196 156C248 156 244 96 286 96" />
                      <path d="M196 156C248 156 244 248 286 248" />
                      <path d="M456 96C494 96 498 168 522 168" />
                      <path d="M196 156C250 156 246 352 286 352" />
                      <path d="M456 248C492 248 496 352 522 352" />
                      <path className="is-aux" d="M456 352h66" />
                    </g>
                    <g className="board__ports">
                      <circle cx="196" cy="156" r="4" /><circle cx="286" cy="96" r="4" /><circle cx="286" cy="248" r="4" />
                      <circle cx="456" cy="96" r="4" /><circle cx="456" cy="248" r="4" /><circle cx="286" cy="352" r="4" />
                      <circle cx="456" cy="352" r="4" /><circle cx="522" cy="168" r="4" /><circle cx="522" cy="352" r="4" />
                    </g>

                    <g className={`board__node${activeNode === 'fn' ? ' is-lit' : ''}`} data-node="fn" transform="translate(34,116)">
                      <rect width="162" height="80" rx="2" />
                      <text className="node-title" x="16" y="28">函数源</text>
                      <text className="node-sub" x="16" y="50">f(x) = sin x</text>
                      <text className="node-note" x="16" y="68">x · a · b · c · π · e</text>
                    </g>
                    <g className={`board__node${activeNode === 'plot' ? ' is-lit' : ''}`} data-node="plot" transform="translate(286,56)">
                      <rect width="170" height="80" rx="2" />
                      <text className="node-title" x="16" y="28">函数图像</text>
                      <path d="M18 64q22-34 44-8t44-10 46 2" />
                      <text className="node-note" x="112" y="68">描点 / 视图</text>
                    </g>
                    <g className={`board__node${activeNode === 'deriv' ? ' is-lit' : ''}`} data-node="deriv" transform="translate(286,208)">
                      <rect width="170" height="80" rx="2" />
                      <text className="node-title" x="16" y="28">导数 · 切线</text>
                      <path d="M18 64q22-30 44-6t44-16" />
                      <path className="node-tangent" d="M18 54 96 70" />
                      <text className="node-note" x="112" y="68">f′(x)</text>
                    </g>
                    <g className={`board__node${activeNode === 'taylor' ? ' is-lit' : ''}`} data-node="taylor" transform="translate(522,128)">
                      <rect width="90" height="80" rx="2" />
                      <text className="node-title" x="14" y="28">泰勒近似</text>
                      <text className="node-sub" x="14" y="50">n = 5</text>
                      <text className="node-note" x="14" y="68">误差可调</text>
                    </g>
                    <g className={`board__node${activeNode === 'integral' ? ' is-lit' : ''}`} data-node="integral" transform="translate(286,312)">
                      <rect width="170" height="80" rx="2" />
                      <text className="node-title" x="16" y="28">黎曼积分</text>
                      <g className="node-rects">
                        <rect x="18" y="54" width="10" height="16" /><rect x="30" y="48" width="10" height="22" />
                        <rect x="42" y="42" width="10" height="28" /><rect x="54" y="34" width="10" height="36" />
                        <rect x="66" y="46" width="10" height="24" /><rect x="78" y="56" width="10" height="14" />
                      </g>
                      <text className="node-note" x="112" y="68">n = 1024</text>
                    </g>
                    <g className="board__ghost" transform="translate(522,312)">
                      <rect width="90" height="80" rx="2" />
                      <text className="ghost-title" x="14" y="29">记录仪</text>
                      <text className="ghost-sub" x="14" y="50">待连接</text>
                      <text className="ghost-sub" x="14" y="66">标量输入</text>
                    </g>
                    <g className="board__note" transform="translate(500,250)">
                      <path d="M0 8h28m-9-7 9 7-9 7" />
                      <text x="4" y="32">接上记录仪，</text>
                      <text x="4" y="50">把每次调参留下来。</text>
                    </g>
                    <text className="board__vertical" x="632" y="400" transform="rotate(-90 632 400)">把好奇心接上线</text>
                  </svg>
                  <div className="board__foot"><span>函数源 → 图像 / 导数 / 积分 / 泰勒</span><span>端口类型自动检查</span></div>
                </div>
              </div>

              <div className="workshop__strip" aria-label="工坊特性">
                <span>自动保存</span><i aria-hidden="true" /><span>撤销 / 重做</span><i aria-hidden="true" />
                <span>发布快照</span><i aria-hidden="true" /><span>自制积木封装</span><i aria-hidden="true" /><span>原文对照</span>
              </div>
            </div>
          </section>

          {/* BOUNDARIES */}
          <section className="boundaries section" id="boundaries">
            <header className={`boundaries__head ${reveal}`}>
              <div className="boundaries__title">
                <p className="eyebrow"><span className="sec-no">§ 04</span> BOUNDARIES / 边界</p>
                <h2>克制，<br />也是实验室的一部分。</h2>
              </div>
              <p className="boundaries__lead">我们把能做的和不能做的，都写在台面上。比“什么都能做”更重要的，是知道什么时候该停下来。</p>
            </header>
            <div className="boundary-list">
              {BOUNDARIES.map((item) => (
                <article className={`boundary ${reveal}`} key={item.no}>
                  <span className="boundary__no">{item.no}</span>
                  <div><h3>{item.title}</h3><p>{item.body}</p></div>
                  <span className="boundary__mark" aria-hidden="true">×</span>
                </article>
              ))}
            </div>
            <div className="boundaries__stamp" aria-hidden="true">未核对<br />不求解</div>
          </section>

          {/* ASK */}
          <section className="ask" id="ask">
            <div className={`ask__inner ${reveal}`}>
              <p className="eyebrow"><span className="sec-no">§ 05</span> YOUR TURN</p>
              <h2>下一道题，<br />从你手里开始。</h2>
              <form className="ask__form" onSubmit={handleAsk}>
                <label className="ask__label" htmlFor="home-ask-input">题目 / QUESTION</label>
                <div className="ask__row">
                  <input
                    id="home-ask-input"
                    type="text"
                    autoComplete="off"
                    placeholder="粘贴一道题，进入题目实验室…"
                    value={ask}
                    onChange={(event) => setAsk(event.target.value)}
                  />
                  <button className="btn btn--primary ask__submit" type="submit">开始拆解 <span aria-hidden="true">↗</span></button>
                </div>
                <p className="ask__hint">
                  文字会带到题目实验室，可继续补充文件或核对条件 ·
                  <button type="button" className="ask__upload" onClick={openUpload}>上传文件</button>
                  <Link to="/labs">直接进入实验室</Link>
                </p>
              </form>
              <div className="ask__marginal" aria-hidden="true">
                <span className="ask__marginal-line" />
                <p>问题不需要漂亮。<br />它只需要是真的。</p>
              </div>
            </div>
          </section>
        </main>

        <footer className="site-foot">
          <div className="site-foot__brand">
            <img className="brand__mark" src={markUrl} width={24} height={24} alt="" />
            <div><strong>万象 · 题目实验室</strong><span>不在答案处停笔。</span></div>
          </div>
          <nav className="site-foot__links" aria-label="页脚导航">
            <Link to="/workshop">万象工坊</Link>
            <Link to="/labs">题目实验室</Link>
            <Link to="/living">万象活页</Link>
            <Link to="/examples">交互示例</Link>
            <Link to="/space">个人主页</Link>
          </nav>
          <div className="site-foot__meta"><span>万象 WANXIANG · 2026</span><span>纸 / 墨 / 计算内核</span></div>
        </footer>
      </div>

      {uploadOpen ? (
        <div className="wx-upload-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeUpload(); }}>
          <div ref={dialogRef} className="wx-upload-dialog" role="dialog" aria-modal="true" aria-label="上传材料生成活页">
            <button ref={closeRef} type="button" className="wx-upload-close" onClick={closeUpload} aria-label="关闭上传窗口">×</button>
            <div className="wx-upload-body"><LivingUploadPanel /></div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export default HomePage;
