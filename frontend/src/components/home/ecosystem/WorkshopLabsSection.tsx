/**
 * § 02 万象工坊精选 3 个真内核交互实验室（斜率场 RK4 / 黎曼和 / 梯度下降 + 一键切积木蓝图）
 */
import { useMemo, useState, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';

type LabId = 'ode' | 'riemann' | 'grad';
type RiemannRule = 'left' | 'mid' | 'right';

const ODE_PRESETS = {
  decay: { label: '指数衰减', a: 0.4, b: 0.8, x0: 0, y0: 1.2 },
  parabola: { label: '抛物线场', a: 1.0, b: 0, x0: -1.1, y0: -0.5 },
  saddle: { label: '鞍点分岔', a: 0.9, b: -0.6, x0: -0.4, y0: 0.3 },
} as const;

const BP_INFO: Record<LabId, { source: string; kernel: string; to: string }> = {
  ode: { source: 'y′ = a·x − b·y（斜率场方程源）', kernel: 'RK4 双向数值积分器', to: '/workshop' },
  riemann: { source: 'f(x) = x²，区间 [0, 1]', kernel: '黎曼矩形切片与误差求值', to: '/canvas?template=ftc-sweep' },
  grad: { source: 'f(x,y) = 0.5x² + 3.5y²', kernel: '梯度 ∇f 迭代与收敛检测', to: '/canvas?template=dlOptimizer' },
};

export function WorkshopLabsSection(): JSX.Element {
  const [activeLab, setActiveLab] = useState<LabId>('ode');
  const [showBlueprint, setShowBlueprint] = useState(false);

  // 例子 1：斜率场与 RK4
  const [ode, setOde] = useState({ a: 0.4, b: 0.8, x0: 0, y0: 1.2, preset: 'decay' as keyof typeof ODE_PRESETS | null });

  // 例子 2：黎曼和
  const [rmN, setRmN] = useState(12);
  const [rmRule, setRmRule] = useState<RiemannRule>('mid');

  // 例子 3：梯度下降
  const [gdLr, setGdLr] = useState(0.22);
  const [gdSteps, setGdSteps] = useState(18);

  const odeData = useMemo(() => {
    const W = 380, H = 225, L = 32, R = 14, T = 14, B = 24;
    const IW = W - L - R, IH = H - T - B;
    const XMIN = -3, XMAX = 3, YMIN = -2.5, YMAX = 2.5;
    const px = (x: number) => L + ((x - XMIN) / (XMAX - XMIN)) * IW;
    const py = (y: number) => (H - B) - ((y - YMIN) / (YMAX - YMIN)) * IH;
    const f = (x: number, y: number) => ode.a * x - ode.b * y;

    const rk4 = (h: number) => {
      const pts = [{ x: ode.x0, y: ode.y0 }];
      let x = ode.x0, y = ode.y0;
      for (let i = 0; i < 150; i += 1) {
        const k1 = f(x, y);
        const k2 = f(x + h / 2, y + (h * k1) / 2);
        const k3 = f(x + h / 2, y + (h * k2) / 2);
        const k4 = f(x + h, y + h * k3);
        x += h;
        y += (h / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
        if (!Number.isFinite(y) || Math.abs(y) > 8) break;
        pts.push({ x, y });
      }
      return pts;
    };

    const toPath = (pts: { x: number; y: number }[]) => {
      let d = '', open = false;
      for (const p of pts) {
        if (p.x < XMIN || p.x > XMAX || p.y < YMIN || p.y > YMAX) {
          open = false;
          continue;
        }
        d += `${open ? 'L' : 'M'}${px(p.x).toFixed(1)},${py(p.y).toFixed(1)} `;
        open = true;
      }
      return d;
    };

    const segs: { key: string; x1: number; y1: number; x2: number; y2: number }[] = [];
    for (let i = 0; i <= 15; i += 1) {
      const gx = XMIN + ((XMAX - XMIN) * i) / 15;
      for (let j = 0; j <= 10; j += 1) {
        const gy = YMIN + ((YMAX - YMIN) * j) / 10;
        const s = f(gx, gy);
        const len = 0.15;
        const norm = Math.hypot(1, s);
        const dx = len / norm, dy = (len * s) / norm;
        segs.push({ key: `${i}-${j}`, x1: px(gx - dx), y1: py(gy - dy), x2: px(gx + dx), y2: py(gy + dy) });
      }
    }

    return {
      segs,
      fwd: toPath(rk4(0.04)),
      bwd: toPath(rk4(-0.04)),
      cx: px(ode.x0),
      cy: py(ode.y0),
      x0Px: px(0),
      y0Py: py(0),
    };
  }, [ode]);

  const handleOdePick = (event: MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const vx = ((event.clientX - rect.left) / rect.width) * 380;
    const vy = ((event.clientY - rect.top) / rect.height) * 225;
    const x0 = Math.max(-3, Math.min(3, -3 + ((vx - 32) / 334) * 6));
    const y0 = Math.max(-2.5, Math.min(2.5, -2.5 + ((201 - vy) / 187) * 5));
    setOde((prev) => ({ ...prev, x0, y0, preset: null }));
  };

  const riemannData = useMemo(() => {
    const W = 380, H = 225, L = 38, R = 18, T = 18, B = 28;
    const IW = W - L - R, IH = H - T - B;
    const px = (x: number) => L + x * IW;
    const py = (y: number) => (H - B) - y * IH;
    let sum = 0;
    const rects: { key: number; x: number; y: number; w: number; h: number }[] = [];
    for (let i = 0; i < rmN; i += 1) {
      const x0 = i / rmN, x1 = (i + 1) / rmN;
      const xs = rmRule === 'left' ? x0 : rmRule === 'right' ? x1 : (x0 + x1) / 2;
      const hVal = xs * xs;
      sum += hVal / rmN;
      rects.push({ key: i, x: px(x0), y: py(hVal), w: IW / rmN, h: hVal * IH });
    }
    let curve = '';
    for (let i = 0; i <= 80; i += 1) {
      const x = i / 80;
      curve += `${i === 0 ? 'M' : 'L'}${px(x).toFixed(1)},${py(x * x).toFixed(1)} `;
    }
    return { rects, curve, sum, err: Math.abs(sum - 1 / 3) };
  }, [rmN, rmRule]);

  const gradData = useMemo(() => {
    const cx = 205, cy = 114, sx = 75, sy = 75;
    let x = -1.9, y = 0.85;
    const pts: [number, number][] = [[x, y]];
    for (let i = 0; i < gdSteps; i += 1) {
      x -= gdLr * x;
      y -= gdLr * 7 * y;
      pts.push([x, y]);
      if (Math.hypot(x, y) > 12) break;
    }
    const loss = 0.5 * x * x + 3.5 * y * y;
    const contours = [0.15, 0.5, 1.1, 2.0, 3.2].map((c) => ({
      c,
      rx: Math.sqrt(2 * c) * sx,
      ry: Math.sqrt(c / 3.5) * sy,
    }));
    const screenPts = pts.map(([pxv, pyv]) => [cx + pxv * sx, cy - pyv * sy] as const);
    const poly = screenPts.map(([u, v]) => `${u.toFixed(1)},${v.toFixed(1)}`).join(' ');
    const status = loss > 4 ? '发散 / 严重震荡' : gdLr > 0.25 ? '高频震荡收敛' : '平稳收敛';
    return { cx, cy, contours, screenPts, poly, loss, status };
  }, [gdLr, gdSteps]);

  const signB = ode.b >= 0 ? '−' : '+';
  const bpMeta = BP_INFO[activeLab];

  return (
    <section className="section" id="workshop">
      <div className="container">
        <header className="section-head">
          <div>
            <p className="eyebrow"><span className="sec-no">§ 02</span> WANXIANG WORKSHOP / 万象工坊精选实验</p>
            <h2>不用看假截图，<br />亲手调这三个真内核例子。</h2>
          </div>
          <p>
            这里精选了 3 个代表性实验室——每个都能直接拖动参数实时重算，还能一键切换查看它背后的<strong>工坊积木连线蓝图</strong>。
          </p>
        </header>

        <div className="lab-switcher" role="tablist" aria-label="切换精选实验">
          <button
            type="button"
            role="tab"
            aria-selected={activeLab === 'ode'}
            className={`lab-tab${activeLab === 'ode' ? ' is-active' : ''}`}
            onClick={() => { setActiveLab('ode'); setShowBlueprint(false); }}
          >
            <span>EXAMPLE 01 · 高等数学</span>
            <strong>斜率场与 RK4 数值积分</strong>
            <small>支持点击平面设初值、切换情景预设</small>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeLab === 'riemann'}
            className={`lab-tab${activeLab === 'riemann' ? ' is-active' : ''}`}
            onClick={() => { setActiveLab('riemann'); setShowBlueprint(false); }}
          >
            <span>EXAMPLE 02 · 微积分</span>
            <strong>黎曼和与定积分收敛</strong>
            <small>实时调节分割数 n 与端点采样方式</small>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeLab === 'grad'}
            className={`lab-tab${activeLab === 'grad' ? ' is-active' : ''}`}
            onClick={() => { setActiveLab('grad'); setShowBlueprint(false); }}
          >
            <span>EXAMPLE 03 · 深度学习 / 优化</span>
            <strong>梯度下降与学习率地形</strong>
            <small>直观感受学习率过小缓慢与过大震荡</small>
          </button>
        </div>

        <div className="lab-stage">
          <div className="lab-stage__head">
            <div className="mode-pills" role="tablist">
              <button type="button" className={!showBlueprint ? 'is-active' : ''} onClick={() => setShowBlueprint(false)}>
                仪表台演播态
              </button>
              <button type="button" className={showBlueprint ? 'is-active' : ''} onClick={() => setShowBlueprint(true)}>
                查看背后工坊积木
              </button>
            </div>
            <div className="lab-stage__right">
              <span className="lab-live-dot"><i aria-hidden="true" /> 浏览器本地真内核实时计算</span>
              <Link className="btn btn--sm" to={bpMeta.to}>去完整工坊打开 ↗</Link>
            </div>
          </div>

          {!showBlueprint && activeLab === 'ode' ? (
            <div className="lab-panel is-active">
              <div className="lab-canvas-box">
                <svg className="lab-svg is-pickable" viewBox="0 0 380 225" role="img" aria-label="斜率场与双向 RK4 积分曲线" onClick={handleOdePick}>
                  <line x1="32" y1={odeData.y0Py} x2="366" y2={odeData.y0Py} stroke="#c2bba8" />
                  <line x1={odeData.x0Px} y1="14" x2={odeData.x0Px} y2="201" stroke="#c2bba8" />
                  {odeData.segs.map((s) => (
                    <line key={s.key} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke="#b9b2a0" strokeWidth="1.15" />
                  ))}
                  <path d={odeData.bwd} fill="none" stroke="#2234d4" strokeWidth="2" strokeDasharray="5 4" />
                  <path d={odeData.fwd} fill="none" stroke="#de421f" strokeWidth="2.6" />
                  <circle cx={odeData.cx} cy={odeData.cy} r="5" fill="#0f766e" stroke="#fff" strokeWidth="1.8" />
                  <text x="32" y="218">-3</text>
                  <text x={odeData.x0Px} y="218" textAnchor="middle">0</text>
                  <text x="366" y="218" textAnchor="end">3</text>
                  <text x="27" y="19" textAnchor="end">2.5</text>
                  <text x="27" y="201" textAnchor="end">-2.5</text>
                </svg>
              </div>
              <div className="lab-control-box">
                <h3>一阶微分方程与斜率场</h3>
                <p>点击左侧平面任意位置重设初值 (x₀, y₀)，观察朱砂正向解与靛蓝反向解如何沿斜率场延伸。</p>
                <div className="formula-pill">y′ = {ode.a.toFixed(1)}·x {signB} {Math.abs(ode.b).toFixed(1)}·y</div>
                <div className="preset-row">
                  {(Object.keys(ODE_PRESETS) as (keyof typeof ODE_PRESETS)[]).map((key) => (
                    <button
                      key={key}
                      type="button"
                      className={`preset-btn${ode.preset === key ? ' is-active' : ''}`}
                      onClick={() => setOde({ ...ODE_PRESETS[key], preset: key })}
                    >
                      {ODE_PRESETS[key].label}
                    </button>
                  ))}
                </div>
                <label className="slider-row">
                  <span className="slider-row__top"><span>系数 a</span><output>{ode.a.toFixed(1)}</output></span>
                  <input
                    type="range"
                    min={-1.5}
                    max={1.5}
                    step={0.1}
                    value={ode.a}
                    onChange={(e) => {
                      const nextA = parseFloat(e.currentTarget.value);
                      setOde((p) => ({ ...p, a: nextA, preset: null }));
                    }}
                  />
                </label>
                <label className="slider-row">
                  <span className="slider-row__top"><span>初值 y₀</span><output>{ode.y0.toFixed(1)}</output></span>
                  <input
                    type="range"
                    min={-2.2}
                    max={2.2}
                    step={0.1}
                    value={ode.y0}
                    onChange={(e) => {
                      const nextY0 = parseFloat(e.currentTarget.value);
                      setOde((p) => ({ ...p, y0: nextY0, preset: null }));
                    }}
                  />
                </label>
                <div className="readout-box">当前初值 ({ode.x0.toFixed(2)}, {ode.y0.toFixed(2)}) · 步长 h = 0.04</div>
              </div>
            </div>
          ) : null}

          {!showBlueprint && activeLab === 'riemann' ? (
            <div className="lab-panel is-active">
              <div className="lab-canvas-box">
                <svg className="lab-svg" viewBox="0 0 380 225" role="img" aria-label="黎曼和与定积分面积">
                  <line x1="38" y1="197" x2="362" y2="197" stroke="#9a9586" />
                  <line x1="38" y1="18" x2="38" y2="197" stroke="#9a9586" />
                  {riemannData.rects.map((r) => (
                    <rect key={r.key} x={r.x} y={r.y} width={r.w} height={r.h} fill="rgba(34,52,212,.14)" stroke="#2234d4" strokeWidth="0.9" />
                  ))}
                  <path d={riemannData.curve} fill="none" stroke="#de421f" strokeWidth="2.5" />
                  <text x="38" y="216">0</text>
                  <text x="362" y="216" textAnchor="end">1</text>
                  <text x="32" y="23" textAnchor="end">1.0</text>
                </svg>
              </div>
              <div className="lab-control-box">
                <h3>黎曼和与定积分收敛</h3>
                <p>把区间 [0, 1] 切成 n 份薄片，比较左端点、中点、右端点采样如何逼近真实面积 1/3。</p>
                <div className="formula-pill">∫₀¹ x² dx = 1/3 ≈ 0.333333</div>
                <div className="preset-row">
                  {([['left', '左端点和'], ['mid', '中点法则'], ['right', '右端点和']] as const).map(([rule, label]) => (
                    <button key={rule} type="button" className={`preset-btn${rmRule === rule ? ' is-active' : ''}`} onClick={() => setRmRule(rule)}>
                      {label}
                    </button>
                  ))}
                </div>
                <label className="slider-row">
                  <span className="slider-row__top"><span>分割数 n</span><output>{rmN}</output></span>
                  <input type="range" min={3} max={48} step={1} value={rmN} onChange={(e) => setRmN(parseInt(e.currentTarget.value, 10))} />
                </label>
                <div className="readout-box">黎曼和 ≈ {riemannData.sum.toFixed(6)} · 绝对误差 {riemannData.err.toFixed(6)}</div>
              </div>
            </div>
          ) : null}

          {!showBlueprint && activeLab === 'grad' ? (
            <div className="lab-panel is-active">
              <div className="lab-canvas-box">
                <svg className="lab-svg" viewBox="0 0 380 225" role="img" aria-label="梯度下降等高线迭代轨迹">
                  {gradData.contours.map((ct) => (
                    <ellipse key={ct.c} cx={gradData.cx} cy={gradData.cy} rx={ct.rx} ry={ct.ry} fill="none" stroke="#cdc6b5" strokeWidth="1" />
                  ))}
                  <circle cx={gradData.cx} cy={gradData.cy} r="3.5" fill="#2234d4" />
                  <polyline points={gradData.poly} fill="none" stroke="#de421f" strokeWidth="2" />
                  {gradData.screenPts.map(([u, v], idx) => (
                    <circle key={idx} cx={u} cy={v} r={idx === gradData.screenPts.length - 1 ? 4.5 : 2.5} fill={idx === gradData.screenPts.length - 1 ? '#0f766e' : '#de421f'} />
                  ))}
                  <text x={gradData.cx + 8} y={gradData.cy + 4}>极小值 (0, 0)</text>
                </svg>
              </div>
              <div className="lab-control-box">
                <h3>梯度下降与学习率地形</h3>
                <p>在狭长椭圆谷底 f(x,y) = 0.5x² + 3.5y² 上调节学习率 η，亲眼看“稳步收敛”如何变成“剧烈震荡”。</p>
                <div className="formula-pill">θₜ₊₁ = θₜ − η · ∇f(θₜ)</div>
                <div className="preset-row">
                  {([[0.06, '保守 η=0.06'], [0.22, '均衡 η=0.22'], [0.28, '震荡 η=0.28']] as const).map(([val, label]) => (
                    <button key={val} type="button" className={`preset-btn${Math.abs(gdLr - val) < 0.005 ? ' is-active' : ''}`} onClick={() => setGdLr(val)}>
                      {label}
                    </button>
                  ))}
                </div>
                <label className="slider-row">
                  <span className="slider-row__top"><span>学习率 η</span><output>{gdLr.toFixed(2)}</output></span>
                  <input type="range" min={0.03} max={0.30} step={0.01} value={gdLr} onChange={(e) => setGdLr(parseFloat(e.currentTarget.value))} />
                </label>
                <label className="slider-row">
                  <span className="slider-row__top"><span>迭代步数</span><output>{gdSteps}</output></span>
                  <input type="range" min={2} max={30} step={1} value={gdSteps} onChange={(e) => setGdSteps(parseInt(e.currentTarget.value, 10))} />
                </label>
                <div className="readout-box">终点损失 f(x,y) = {gradData.loss.toFixed(4)} · 状态：{gradData.status}</div>
              </div>
            </div>
          ) : null}

          {showBlueprint ? (
            <div className="lab-blueprint is-active">
              <svg viewBox="0 0 820 220" role="img" aria-label="工坊积木数据流连线图">
                <g stroke="#7c93ff" strokeWidth="2.2" fill="none">
                  <path d="M210 110 C255 110, 255 68, 296 68" />
                  <path d="M210 110 C255 110, 255 154, 296 154" />
                  <path d="M510 68 C550 68, 550 110, 594 110" />
                  <path d="M510 154 C550 154, 550 110, 594 110" />
                </g>
                <g transform="translate(26,64)">
                  <rect width="184" height="92" rx="8" fill="#1a2760" stroke="#99adff" strokeWidth="1.6" />
                  <text x="16" y="28" fill="#fff" fontSize="14" fontWeight="700">表达式 / 地形源</text>
                  <text x="16" y="54" fill="#8df5e4" fontSize="12" fontFamily="monospace">{bpMeta.source}</text>
                  <text x="16" y="76" fill="#9fb2f5" fontSize="11">外露参数已绑定滑杆</text>
                </g>
                <g transform="translate(296,26)">
                  <rect width="214" height="84" rx="8" fill="#1a2760" stroke="#99adff" strokeWidth="1.6" />
                  <text x="16" y="28" fill="#fff" fontSize="14" fontWeight="700">数值内核计算节点</text>
                  <text x="16" y="52" fill="#cfd8ff" fontSize="12" fontFamily="monospace">{bpMeta.kernel}</text>
                  <text x="16" y="72" fill="#9fb2f5" fontSize="11">纯前端实时重算，零延迟</text>
                </g>
                <g transform="translate(296,116)">
                  <rect width="214" height="78" rx="8" fill="#1a2760" stroke="#ff9a80" strokeWidth="1.6" />
                  <text x="16" y="28" fill="#fff" fontSize="14" fontWeight="700">实时读数与误差监测</text>
                  <text x="16" y="52" fill="#ffd2c4" fontSize="12" fontFamily="monospace">自动输出结论与校验状态</text>
                </g>
                <g transform="translate(594,56)">
                  <rect width="198" height="108" rx="8" fill="#0f3e40" stroke="#4fd1c5" strokeWidth="2" />
                  <text x="16" y="30" fill="#fff" fontSize="14" fontWeight="700">活页插件封装出口</text>
                  <text x="16" y="56" fill="#9cf3e9" fontSize="12">✓ 可直接拖入万象活页</text>
                  <text x="16" y="78" fill="#b4e8e2" fontSize="11">✓ 支持情景预设与离线包</text>
                  <text x="16" y="96" fill="#b4e8e2" fontSize="11">✓ 听众可一键反钻工坊</text>
                </g>
              </svg>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
