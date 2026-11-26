/**
 * § 03 通文册 Before/After 可拖拽卷帘实景对比（0% ~ 100% 拉到底 + 真实泰勒级数逼近）
 */
import { useCallback, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

const TAYLOR_FORMULAS: Record<number, string> = {
  1: 'P₁(x) = x',
  3: 'P₃(x) = x − x³/3!',
  5: 'P₅(x) = x − x³/3! + x⁵/5!',
  7: 'P₇(x) = x − x³/3! + x⁵/5! − x⁷/7!',
  9: 'P₉(x) = x − x³/3! + x⁵/5! − x⁷/7! + x⁹/9!',
};

function factorial(k: number): number {
  let r = 1;
  for (let i = 2; i <= k; i += 1) r *= i;
  return r;
}

function evalTaylorSin(x: number, n: number): number {
  let sum = 0;
  let sign = 1;
  for (let k = 1; k <= n; k += 2) {
    sum += (sign * Math.pow(x, k)) / factorial(k);
    sign = -sign;
  }
  return sum;
}

export function LivingCompareSection(): JSX.Element {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [split, setSplit] = useState(46);
  const [dragging, setDragging] = useState(false);
  const [degree, setDegree] = useState(5);

  const updateSplit = useCallback((clientX: number) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect || !rect.width) return;
    const pct = ((clientX - rect.left) / rect.width) * 100;
    setSplit(Math.max(0, Math.min(100, pct)));
  }, []);

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (dragging) updateSplit(event.clientX);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') setSplit((prev) => Math.max(0, prev - 5));
    if (event.key === 'ArrowRight') setSplit((prev) => Math.min(100, prev + 5));
  };

  const taylorPlot = useMemo(() => {
    const W = 360, H = 185, L = 24, R = 16, T = 16, B = 20;
    const IW = W - L - R, IH = H - T - B;
    const XMIN = -4.2, XMAX = 4.2, YMIN = -2.0, YMAX = 2.0;
    const px = (x: number) => L + ((x - XMIN) / (XMAX - XMIN)) * IW;
    const py = (y: number) => (H - B) - ((y - YMIN) / (YMAX - YMIN)) * IH;

    let sinD = '', tayD = '', tayOpen = false;
    for (let i = 0; i <= 120; i += 1) {
      const x = XMIN + ((XMAX - XMIN) * i) / 120;
      const ys = Math.sin(x);
      const yt = evalTaylorSin(x, degree);
      sinD += `${i === 0 ? 'M' : 'L'}${px(x).toFixed(1)},${py(ys).toFixed(1)} `;
      if (yt >= YMIN - 0.3 && yt <= YMAX + 0.3) {
        tayD += `${tayOpen ? 'L' : 'M'}${px(x).toFixed(1)},${py(yt).toFixed(1)} `;
        tayOpen = true;
      } else {
        tayOpen = false;
      }
    }
    return {
      sinD,
      tayD,
      err: Math.abs(Math.sin(2) - evalTaylorSin(2, degree)),
      x0: px(0),
      y0: py(0),
      dotX: px(2),
      dotY: py(Math.sin(2)),
    };
  }, [degree]);

  return (
    <section className="section" id="living">
      <div className="container">
        <header className="section-head">
          <div>
            <p className="eyebrow"><span className="sec-no">§ 03</span> TONGWEN ATLAS / 通文册</p>
            <h2>拉动中间手柄，<br />看静态 PPT 如何当场“复活”。</h2>
          </div>
          <p>
            不用重做整套课件。保留你原本的页面结构，把写死的截图原地替换成定象坊活仪器——课堂上不用切软件，拖动滑杆就能现场回应追问。
          </p>
        </header>

        <div className="compare-shell">
          <div className="compare-bar">
            <div className="window-dots">
              <i /><i /><i />
              <span>高等数学 · 第 07 页 · 泰勒展开误差分析.pptx</span>
            </div>
            <span className="mono compare-bar__hint">◀ 左右拖动中间卷帘 · 也可以直接拖动右图阶数滑杆 ▶</span>
          </div>

          <div className="compare-viewport" ref={viewportRef}>
            {/* 底层：通文册（动态激活） */}
            <div className="compare-layer layer-after">
              <div>
                <span className="after-tag">AFTER · 通文册（动态激活）</span>
                <h3 className="slide-title">sin(x) 的泰勒多项式逼近</h3>
                <p className="slide-desc">保留原稿讲解文字与公式，右侧配图已替换为定象坊真实内核。讲台上直接把阶数从 1 推到 9，看多项式如何贴合正弦波。</p>
                <div className="formula-pill formula-pill--sm">{TAYLOR_FORMULAS[degree]}</div>
              </div>

              <div className="taylor-card">
                <div className="taylor-card__top">
                  <strong>嵌入仪器 · 泰勒近似</strong>
                  <span className="mono taylor-card__err">x=2 处误差：{taylorPlot.err.toFixed(4)}</span>
                </div>
                <svg className="taylor-svg" viewBox="0 0 360 185" role="img" aria-label="正弦函数与泰勒多项式动态逼近">
                  <line x1="24" y1={taylorPlot.y0} x2="344" y2={taylorPlot.y0} stroke="#ccc5b4" />
                  <line x1={taylorPlot.x0} y1="16" x2={taylorPlot.x0} y2="165" stroke="#ccc5b4" />
                  <path d={taylorPlot.sinD} fill="none" stroke="#2234d4" strokeWidth="2.2" />
                  <path d={taylorPlot.tayD} fill="none" stroke="#de421f" strokeWidth="2.4" strokeDasharray="6 4" />
                  <circle cx={taylorPlot.dotX} cy={taylorPlot.dotY} r="4" fill="#0f766e" />
                </svg>
                <div className="taylor-controls">
                  <label className="slider-row">
                    <span className="slider-row__top">
                      <span>展开阶数 N（现场可调）</span>
                      <output>{degree} 阶</output>
                    </span>
                    <input type="range" min={1} max={9} step={2} value={degree} onChange={(e) => setDegree(parseInt(e.currentTarget.value, 10))} />
                  </label>
                  <span className="mono taylor-badge">离线可算</span>
                </div>
              </div>
            </div>

            {/* 顶层：传统静态 PPT（卷帘裁剪） */}
            <div className="compare-layer layer-before" style={{ clipPath: `inset(0 ${(100 - split).toFixed(2)}% 0 0)` }}>
              <div>
                <span className="before-tag">BEFORE · 传统静态 PPT</span>
                <h3 className="slide-title slide-title--muted">sin(x) 的泰勒多项式逼近</h3>
                <p className="slide-desc slide-desc--muted">从教材里截了一张固定 N=3 的静态图片贴在页面上。一旦有同学问“N=7 会偏到哪里去”，老师只能口头比划。</p>
                <div className="pain-note">× 痛点：公式与配图彻底写死，改一个参数就要切软件重画</div>
              </div>

              <div className="static-png-box">
                <div className="static-png-box__head">
                  <span>taylor_static_n3.png</span>
                  <span>锁定 · 不可交互</span>
                </div>
                <svg viewBox="0 0 320 140" className="static-png-box__svg">
                  <line x1="16" y1="70" x2="304" y2="70" stroke="#8a8474" />
                  <path d="M20 70 Q90 10 160 70 T300 70" fill="none" stroke="#555" strokeWidth="2" />
                  <path d="M20 120 Q90 0 160 70 T300 10" fill="none" stroke="#888" strokeWidth="2" strokeDasharray="4 4" />
                </svg>
                <div className="pain-note">× 课后发给学生的 PDF 也是死图，无法动手验证</div>
              </div>
            </div>

            {/* 中间卷帘分隔线与手柄 */}
            <div
              className="compare-divider"
              style={{ left: `${split}%` }}
              role="slider"
              aria-label="拖动对比静态课件与通文册"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(split)}
              tabIndex={0}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={() => setDragging(false)}
              onPointerCancel={() => setDragging(false)}
              onKeyDown={handleKeyDown}
            >
              <div className="compare-handle">◀ ▶</div>
            </div>
          </div>

          <div className="compare-hint">
            <span><strong>原稿保真</strong>：不破坏原有 PPTX / PDF 排版</span>
            <span><strong>三种形态</strong>：完整仪表台 / 精简调参 / 纯舞台浮层</span>
            <span><strong>离线演播</strong>：导出单文件 HTML，教室断网照常推演</span>
          </div>
        </div>
      </div>
    </section>
  );
}
