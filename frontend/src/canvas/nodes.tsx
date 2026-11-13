/**
 * nodes.tsx —— 万象画布对象实现
 *
 * 每个节点体是一个纯展示/编辑组件：
 *  - 源节点（matrixSource/slider/ticker）：编辑参数 → onParams 上抛，画布沿连线广播；
 *  - 变换节点（rotor/matmul）：有输入有输出，输入值经 engine 求值；
 *  - 视图节点（transformView/fieldView/...）：接收输入渲染，未连线显示占位；
 *  - 学习节点（quiz/spark）：消费输入做"先猜再看"与历史记录；
 *  - 文字节点（textNote/latexNote）：无端口。
 *
 * 新增对象类型 = 在 `NODE_DEFS` 里注册一项（端口、徽标、组件），画布其余部分不需要改动。
 */
import { useEffect, useRef, useState, type ComponentType } from 'react';
import { Formula } from '@/components/showcase/Formula';
import type { CanvasNode, NodeType, PortSpec, PortValue } from './types.ts';
import { det, tr, eigen, rankOf, fmt, clamp, paramsM, type M2 } from './math.ts';
import { physCycle, samplePath } from './physics.ts';
import { FunctionSourceBody, FunctionPlotBody, DerivativeBody, LimitBody, IntegralBody, TaylorBody } from './CalculusNodes';
import styles from './canvas.module.css';

export interface NodeBodyProps {
  node: CanvasNode;
  /** 各输入端口的当前值（键 = 端口 id），无输入节点为空对象 */
  values: Record<string, PortValue | null>;
  /** 本节点输出的求值结果（无输出为 null），供源/变换节点自显 */
  self: PortValue | null;
  /** 参数写回（画布负责传播与持久化） */
  onParams?: (patch: Record<string, number>) => void;
  /** 文本写回 */
  onText?: (text: string) => void;
  /** composite：请求展开（解封装）回本层 */
  onExplode?: () => void;
}

export interface NodeDef {
  title: string;
  badge: '源' | '变换' | '视图' | '学习' | '文字' | '实验';
  width: number;
  inputs?: readonly PortSpec[];
  outputs?: readonly PortSpec[];
  Body: ComponentType<NodeBodyProps>;
}

const IN_M2: PortSpec = { id: 'in', label: 'in', kind: 'matrix2' };
const OUT_M2: PortSpec = { id: 'out', label: 'out', kind: 'matrix2' };

const MATRIX_PRESETS: readonly { label: string; m: M2 }[] = [
  { label: '单位', m: { a: 1, b: 0, c: 0, d: 1 } },
  { label: '旋转90°', m: { a: 0, b: -1, c: 1, d: 0 } },
  { label: '剪切', m: { a: 1, b: 1, c: 0, d: 1 } },
  { label: '拉伸×2', m: { a: 2, b: 0, c: 0, d: 1 } },
  { label: '投影', m: { a: 1, b: 0, c: 0, d: 0 } },
  { label: '奇异', m: { a: 1, b: 1, c: 1, d: 1 } },
];

function unconnected(kind: string): JSX.Element {
  return (
    <div className={styles.unwired} role="status">
      <span aria-hidden="true">◇</span>
      未连线：把某个<span className={styles.unwiredSrc}>源</span>的红点拖到这里，{kind}就活了
    </div>
  );
}

const asM2 = (v: PortValue | null | undefined): M2 | null =>
  v && v.kind === 'matrix2' ? v : null;

/* ============================== 源 ============================== */

function MatrixSourceBody({ node, onParams }: NodeBodyProps): JSX.Element {
  const m = paramsM(node.params);
  const set = (k: keyof M2, raw: string): void => {
    const v = parseFloat(raw);
    if (Number.isFinite(v)) onParams?.({ [k]: clamp(v, -9, 9) });
  };
  return (
    <div>
      <div className={styles.matgrid}>
        {(['a', 'b', 'c', 'd'] as const).map((k) => (
          <input
            key={k}
            aria-label={`矩阵元素 ${k}`}
            inputMode="decimal"
            value={fmt(m[k], 2)}
            onChange={(e) => set(k, e.target.value)}
          />
        ))}
      </div>
      <div className={styles.presets}>
        {MATRIX_PRESETS.map((p) => (
          <button key={p.label} type="button" onClick={() => onParams?.({ ...p.m })}>
            {p.label}
          </button>
        ))}
      </div>
      <div className={styles.miniRead}>
        det <b className={styles.live}>{fmt(det(m))}</b> · tr <b className={styles.live}>{fmt(tr(m))}</b>
      </div>
    </div>
  );
}

function SliderBody({ node, onParams }: NodeBodyProps): JSX.Element {
  const v = node.params.v ?? 0.3;
  const min = node.params.min ?? 0, max = node.params.max ?? 1;
  return (
    <div>
      <input
        type="range"
        className={styles.slider}
        min={min} max={max} step={0.005}
        value={v}
        aria-label="滑杆值"
        onChange={(e) => onParams?.({ v: parseFloat(e.target.value) })}
      />
      <div className={styles.miniRead}>
        v = <b className={styles.live}>{fmt(v, 3)}</b>
        <span className={styles.dim}> · {fmt(min)} ~ {fmt(max)}</span>
      </div>
    </div>
  );
}

function TickerBody({ node, self, onParams }: NodeBodyProps): JSX.Element {
  const running = (node.params.running ?? 1) !== 0;
  const period = Math.max(0.5, node.params.period ?? 6);
  const t = self && self.kind === 'scalar' ? self.v : 0;
  const ang = t * 2 * Math.PI;
  return (
    <div>
      <div className={styles.tickerRow}>
        <svg width="46" height="46" viewBox="0 0 46 46" role="img" aria-label={`时间 t = ${fmt(t, 2)}`}>
          <circle cx="23" cy="23" r="18" fill="none" stroke="#EDE7DA" strokeWidth="4" />
          <circle cx="23" cy="23" r="18" fill="none" stroke="#FF7A59" strokeWidth="4"
            strokeDasharray={`${t * 113} 113`} strokeLinecap="round" transform="rotate(-90 23 23)" />
          <line x1="23" y1="23" x2={23 + Math.cos(ang - Math.PI / 2) * 12} y2={23 + Math.sin(ang - Math.PI / 2) * 12}
            stroke="#121B27" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <div className={styles.tickerCtl}>
          <button type="button" className={styles.tbtn} onClick={() => onParams?.({ running: running ? 0 : 1 })}>
            {running ? '⏸ 暂停' : '▶ 运行'}
          </button>
          <span className={styles.dim}>t = {fmt(t, 2)}</span>
        </div>
      </div>
      <input
        type="range" className={styles.slider}
        min={1} max={20} step={0.5} value={period}
        aria-label="周期（秒/圈）"
        onChange={(e) => onParams?.({ period: parseFloat(e.target.value) })}
      />
      <div className={styles.miniRead}>周期 <b className={styles.live}>{fmt(period, 1)}s</b>/圈 → 输出 t ∈ [0,1)</div>
    </div>
  );
}

/* ============================== 变换 ============================== */

function RotorBody({ node, values, onParams }: NodeBodyProps): JSX.Element {
  const wired = values.in != null;
  const t = wired && values.in!.kind === 'scalar' ? values.in!.v : node.params.theta ?? 0;
  return (
    <div>
      {!wired ? (
        <input
          type="range" className={styles.slider}
          min={0} max={1} step={0.005} value={node.params.theta ?? 0}
          aria-label="转角（圈）"
          onChange={(e) => onParams?.({ theta: parseFloat(e.target.value) })}
        />
      ) : null}
      <div className={styles.miniRead}>
        θ = <b className={styles.live}>{fmt(t * 360, 0)}°</b>（{fmt(t, 3)} 圈）→ 旋转矩阵 R(θ)
      </div>
      <div className={styles.eigVerdict}>
        {wired ? 'θ 由输入驱动' : '未连线：拖滑杆/时钟到左侧蓝圈，或直接拖上面滑杆'}
      </div>
    </div>
  );
}

function MatmulBody({ self }: NodeBodyProps): JSX.Element {
  const m = asM2(self);
  if (!m) {
    return (
      <div className={styles.unwired} role="status">
        <span aria-hidden="true">◇</span>
        连两个<span className={styles.unwiredSrc}>矩阵源</span>到 A、B 口 → 输出 A×B。<br />
        试试 A×B 和 B×A 各连一个视图：顺序不同，结果不同。
      </div>
    );
  }
  return (
    <div>
      <div className={styles.matgrid}>
        {([m.a, m.b, m.c, m.d] as const).map((v, i) => (
          <div key={i} className={styles.rocell}>{fmt(v)}</div>
        ))}
      </div>
      <div className={styles.miniRead}>
        det(A×B) = <b className={styles.live}>{fmt(det(m))}</b>
      </div>
    </div>
  );
}

/* ============================== 视图 ============================== */

function TransformSvg({ m }: { m: M2 }): JSX.Element {
  const W = 560, H = 330, CX = 280, CY = 170, S = 40, RN = 5;
  const px = (x: number, y: number): [number, number] => [CX + x * S, CY - y * S];
  const { a, b, c, d } = m;
  const lattice: JSX.Element[] = [];
  for (let k = -RN; k <= RN; k++) {
    lattice.push(
      <line key={`v${k}`} x1={px(a * k - b * RN, c * k - d * RN)[0]} y1={px(a * k - b * RN, c * k - d * RN)[1]}
        x2={px(a * k + b * RN, c * k + d * RN)[0]} y2={px(a * k + b * RN, c * k + d * RN)[1]} />,
      <line key={`h${k}`} x1={px(-a * RN + b * k, -c * RN + d * k)[0]} y1={px(-a * RN + b * k, -c * RN + d * k)[1]}
        x2={px(a * RN + b * k, c * RN + d * k)[0]} y2={px(a * RN + b * k, c * RN + d * k)[1]} />,
    );
  }
  let ellipse = '';
  for (let i = 0; i <= 64; i++) {
    const t = (i / 64) * 2 * Math.PI;
    const p = px(a * Math.cos(t) + b * Math.sin(t), c * Math.cos(t) + d * Math.sin(t));
    ellipse += `${i ? 'L' : 'M'}${fmt(p[0], 1)},${fmt(p[1], 1)}`;
  }
  const arrow = (x: number, y: number, color: string, label: string, key: string): JSX.Element => {
    const [ex, ey] = px(x, y);
    const an = Math.atan2(ey - CY, ex - CX), h = 9;
    return (
      <g key={key}>
        <line x1={CX} y1={CY} x2={ex} y2={ey} stroke={color} strokeWidth={2.2} strokeLinecap="round" />
        <path d={`M${ex},${ey}L${ex - h * Math.cos(an - 0.4)},${ey - h * Math.sin(an - 0.4)}L${ex - h * Math.cos(an + 0.4)},${ey - h * Math.sin(an + 0.4)}Z`} fill={color} />
        <text x={ex + 6} y={ey - 8} fill={color} fontSize={11} fontWeight={700}>{label}</text>
      </g>
    );
  };
  const grid: JSX.Element[] = [];
  for (let k = -RN; k <= RN; k++) {
    grid.push(
      <line key={`gv${k}`} x1={px(k, -RN)[0]} y1={px(k, -RN)[1]} x2={px(k, RN)[0]} y2={px(k, RN)[1]} />,
      <line key={`gh${k}`} x1={px(-RN, k)[0]} y1={px(-RN, k)[1]} x2={px(RN, k)[0]} y2={px(RN, k)[1]} />,
    );
  }
  return (
    <svg className={styles.objSvg} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="矩阵作用的网格与单位圆">
      <g stroke="#EDE7DA" strokeWidth={1}>{grid}</g>
      <line x1={0} y1={CY} x2={W} y2={CY} stroke="#D5CCB9" />
      <line x1={CX} y1={0} x2={CX} y2={H} stroke="#D5CCB9" />
      <g stroke="#C9C4F5" strokeWidth={1}>{lattice}</g>
      <circle cx={CX} cy={CY} r={S} fill="none" stroke="#C7BFAE" strokeDasharray="4 4" />
      <path d={ellipse + 'Z'} fill="rgba(79,70,229,.06)" stroke="#4F46E5" strokeWidth={1.6} />
      {arrow(a, c, '#4F46E5', 'i′', 'v1')}
      {arrow(b, d, '#B8431F', 'j′', 'v2')}
    </svg>
  );
}

function TransformViewBody({ values }: NodeBodyProps): JSX.Element {
  const m = asM2(values.in);
  if (!m) return unconnected('变换视图');
  return <TransformSvg m={m} />;
}

function FieldViewBody({ values }: NodeBodyProps): JSX.Element {
  const m = asM2(values.in);
  if (!m) return unconnected('向量场');
  const W = 240, H = 190, CX = 120, CY = 95, S = 38;
  const px = (x: number, y: number): [number, number] => [CX + x * S, CY - y * S];
  const arrows: JSX.Element[] = [];
  for (let i = -2; i <= 2; i++) {
    for (let j = -1.5; j <= 1.5; j += 0.75) {
      const vx = m.a * i + m.b * j;
      const vy = m.c * i + m.d * j;
      const len = Math.hypot(vx, vy);
      if (len < 1e-9) continue;
      const [x1, y1] = px(i, j);
      const [x2, y2] = px(i + (vx / len) * 0.42, j + (vy / len) * 0.42);
      const an = Math.atan2(y2 - y1, x2 - x1), h = 5;
      const hot = Math.min(len / 3, 1);
      const col = `rgba(${Math.round(79 + 176 * hot)},${Math.round(70 + 52 * hot)},${Math.round(229 - 140 * hot)},.9)`;
      arrows.push(
        <g key={`${i}_${j}`}>
          <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={col} strokeWidth={1.8} strokeLinecap="round" />
          <path d={`M${x2},${y2}L${x2 - h * Math.cos(an - 0.45)},${y2 - h * Math.sin(an - 0.45)}L${x2 - h * Math.cos(an + 0.45)},${y2 - h * Math.sin(an + 0.45)}Z`} fill={col} />
        </g>,
      );
    }
  }
  return (
    <svg className={styles.objSvg} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="矩阵作为向量场">
      <line x1={0} y1={CY} x2={W} y2={CY} stroke="#D5CCB9" />
      <line x1={CX} y1={0} x2={CX} y2={H} stroke="#D5CCB9" />
      {arrows}
    </svg>
  );
}

function DetGaugeBody({ values }: NodeBodyProps): JSX.Element {
  const m = asM2(values.in);
  if (!m) return unconnected('det 仪表');
  const d = det(m), ad = Math.abs(d);
  const cx = 100, cy = 112, r = 78;
  const val = Math.min(ad, 4);
  const ang = Math.PI - (val / 4) * Math.PI;
  const label = ad < 0.05 ? '压扁 · 丢维度' : ad < 1 ? '面积收缩' : d < 0 ? '翻转 + 放大' : '面积放大';
  const ticks: JSX.Element[] = [];
  for (let v = 0; v <= 4; v++) {
    const an = Math.PI - (v / 4) * Math.PI;
    ticks.push(
      <line key={v} x1={cx + Math.cos(an) * (r - 9)} y1={cy - Math.sin(an) * (r - 9)}
        x2={cx + Math.cos(an) * (r + 1)} y2={cy - Math.sin(an) * (r + 1)} stroke="#A8AFBA" strokeWidth={1.4} />,
      <text key={`t${v}`} x={cx + Math.cos(an) * (r + 15)} y={cy - Math.sin(an) * (r + 15) + 3}
        fontSize={8.5} fill="#A8AFBA" textAnchor="middle">{v}</text>,
    );
  }
  return (
    <svg className={styles.objSvg} viewBox="0 0 200 130" role="img" aria-label={`行列式仪表，当前 |det| = ${fmt(ad)}`}>
      <path d={`M${cx - r},${cy} A${r},${r} 0 0 1 ${cx + r},${cy}`} fill="none" stroke="#EDE7DA" strokeWidth={11} strokeLinecap="round" />
      {ticks}
      <line x1={cx} y1={cy} x2={cx + Math.cos(ang) * 62} y2={cy - Math.sin(ang) * 62} stroke="#FF7A59" strokeWidth={3} strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={5} fill="#FF7A59" />
      <text x={cx} y={cy - 18} fontSize={15} fontWeight={700} fill="#B8431F" textAnchor="middle" className={styles.mono}>|det| = {fmt(ad)}</text>
      <text x={cx} y={cy + 14} fontSize={10} fill="#7C8694" textAnchor="middle">{label}</text>
    </svg>
  );
}

function EigReadBody({ values }: NodeBodyProps): JSX.Element {
  const m = asM2(values.in);
  if (!m) return unconnected('特征值读数');
  const e = eigen(m);
  const verdict = Math.abs(det(m)) < 1e-9 ? '奇异：像被压成低维'
    : !e.real ? '含旋转成分（共轭复特征值）'
    : '两个实特征方向：沿它们只缩放不旋转';
  return (
    <div>
      <div className={styles.readouts}>
        <div className={styles.ro}><span>λ₁</span><b>{e.real ? fmt(e.l1) : `${fmt(e.l1)}+${fmt(e.imag)}i`}</b></div>
        <div className={styles.ro}><span>λ₂</span><b>{e.real ? fmt(e.l2) : `${fmt(e.l2)}−${fmt(e.imag)}i`}</b></div>
        <div className={styles.ro}><span>det A</span><b>{fmt(det(m))}</b></div>
        <div className={styles.ro}><span>tr A</span><b>{fmt(tr(m))}</b></div>
        <div className={styles.ro}><span>rank</span><b>{rankOf(m)}</b></div>
        <div className={styles.ro}><span>面积倍率</span><b>{fmt(Math.abs(det(m)))}×</b></div>
      </div>
      <div className={styles.eigVerdict}>{verdict}</div>
    </div>
  );
}

function SquareViewBody({ values }: NodeBodyProps): JSX.Element {
  const m = asM2(values.in);
  if (!m) return unconnected('像的形状');
  const cx = 100, cy = 112, S = 52;
  const px = (x: number, y: number): string => `${cx + x * S},${cy - y * S}`;
  const sq: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
  return (
    <div>
      <svg className={styles.objSvg} viewBox="0 0 200 150" role="img" aria-label="单位正方形经矩阵作用后的像">
        <line x1={0} y1={cy} x2={200} y2={cy} stroke="#D5CCB9" />
        <line x1={cx} y1={6} x2={cx} y2={148} stroke="#D5CCB9" />
        <polygon points={sq.map((p) => px(p[0], p[1])).join(' ')} fill="none" stroke="#C7BFAE" strokeDasharray="4 3" />
        <polygon
          points={sq.map((p) => px(m.a * p[0] + m.b * p[1], m.c * p[0] + m.d * p[1])).join(' ')}
          fill="rgba(255,122,89,.16)" stroke="#FF7A59" strokeWidth={2}
        />
      </svg>
      <div className={styles.sqArea}>面积 = <b className={styles.live}>{fmt(Math.abs(det(m)))}</b>（原面积 1）</div>
    </div>
  );
}

/* ============================== 学习 ============================== */

function QuizBody({ values }: NodeBodyProps): JSX.Element {
  const m = asM2(values.in);
  // 输入值每次求值都是新对象，用数值签名做依赖——真变了才重置揭示态
  const sig = m ? `${m.a}|${m.b}|${m.c}|${m.d}` : 'none';
  const [guess, setGuess] = useState(2);
  const [revealed, setRevealed] = useState(false);
  useEffect(() => { setRevealed(false); }, [sig]);
  if (!m) return unconnected('预测闸门');
  const truth = Math.abs(det(m));
  const dev = truth > 1e-9 ? Math.abs(guess - truth) / truth : Math.abs(guess - truth);
  const word = !revealed ? '' : dev < 0.1 ? '很准，心智模型在线'
    : dev < 0.3 ? '方向对，量级再校准一下'
    : truth < 0.05 ? '它几乎被压扁了——再看一眼网格'
    : '差得不少，回到变换视图拖一拖感受';
  return (
    <div>
      <div className={styles.quizQ}>先猜再看：|det| ≈ ?</div>
      <input
        type="range" className={styles.slider}
        min={0} max={4} step={0.05} value={guess}
        aria-label="你的猜测 |det|"
        disabled={revealed}
        onChange={(e) => setGuess(parseFloat(e.target.value))}
      />
      <div className={styles.miniRead}>你的猜测：<b>{fmt(guess)}</b></div>
      {!revealed ? (
        <button type="button" className={styles.quizBtn} onClick={() => setRevealed(true)}>揭示真值</button>
      ) : (
        <div className={styles.quizResult} role="status">
          真值 <b className={styles.live}>{fmt(truth)}</b> · 偏差 <b>{fmt(dev * 100, 0)}%</b>
          <div className={styles.eigVerdict}>{word}</div>
        </div>
      )}
    </div>
  );
}

function extract(v: PortValue | null | undefined): number | null {
  if (!v) return null;
  if (v.kind === 'scalar') return v.v;
  if (v.kind === 'body') return Math.hypot(v.vx, v.vy);
  if (v.kind === 'function') return null;
  return Math.abs(v.a * v.d - v.b * v.c);
}

function SparkBody({ values, node }: NodeBodyProps): JSX.Element {
  const n = extract(values.in);
  const hist = useRef<number[]>([]);
  useEffect(() => {
    hist.current = [];
  }, [node.id]);
  useEffect(() => {
    if (n === null) return;
    const last = hist.current[hist.current.length - 1];
    if (last === undefined || Math.abs(last - n) > 1e-9) {
      hist.current = [...hist.current.slice(-119), n];
    }
  }, [n]);
  if (n === null) return unconnected('记录仪');
  const h = hist.current;
  const lo = Math.min(...h, n), hi = Math.max(...h, n);
  const span = Math.max(hi - lo, 1e-6);
  const pts = h.map((v, i) =>
    `${(i / Math.max(h.length - 1, 1)) * 186 + 7},${64 - ((v - lo) / span) * 52 - 6}`).join(' ');
  const label = values.in!.kind === 'scalar' ? 'v' : values.in!.kind === 'body' ? '|v|' : '|det|';
  return (
    <div>
      <svg className={styles.objSvg} viewBox="0 0 200 70" role="img" aria-label={`${label} 历史记录`}>
        <polyline points={pts} fill="none" stroke="#FF7A59" strokeWidth={1.8} strokeLinejoin="round" />
        {h.length > 0 ? <circle cx={pts.split(' ').pop()!.split(',')[0]} cy={pts.split(' ').pop()!.split(',')[1]} r={3} fill="#FF7A59" /> : null}
      </svg>
      <div className={styles.miniRead}>
        {label} = <b className={styles.live}>{fmt(n)}</b>
        <span className={styles.dim}> · {h.length} 次 · {fmt(lo)}~{fmt(hi)}</span>
      </div>
    </div>
  );
}

/* ============================== 文字 / 自包含 ============================== */

function TextNoteBody({ node, onText }: NodeBodyProps): JSX.Element {
  return (
    <textarea
      className={styles.note}
      value={node.text ?? ''}
      placeholder="写点什么：思路、公式注释、待办……"
      spellCheck={false}
      rows={Math.max(3, Math.min(10, (node.text ?? '').split('\n').length + 1))}
      onChange={(e) => onText?.(e.target.value)}
    />
  );
}

function LatexNoteBody({ node, onText }: NodeBodyProps): JSX.Element {
  const tex = (node.text ?? '').trim();
  return (
    <div>
      <textarea
        className={styles.note}
        value={node.text ?? ''}
        placeholder="输入 LaTeX，如 A^TA = I 或 e^{i\pi}+1=0"
        spellCheck={false}
        rows={2}
        onChange={(e) => onText?.(e.target.value)}
      />
      <div className={styles.texview}>
        {tex ? <Formula tex={tex} block label={tex} /> : <span className={styles.dim}>公式会渲染在这里</span>}
      </div>
    </div>
  );
}

function CobwebBody({ node, onParams }: NodeBodyProps): JSX.Element {
  const r = node.params.r ?? 3.2;
  const W = 210, H = 170, S = 150;
  const px = (x: number): number => 8 + x * S;
  const py = (y: number): number => H - 8 - y * S;
  const f = (x: number): number => r * x * (1 - x);
  let parab = '';
  for (let i = 0; i <= 60; i++) {
    const x = i / 60;
    parab += `${i ? 'L' : 'M'}${fmt(px(x), 1)},${fmt(py(f(x)), 1)}`;
  }
  let web = '';
  let x = 0.21;
  const orbit: number[] = [x];
  for (let i = 0; i < 80; i++) {
    const y = f(x);
    web += `${i ? 'L' : 'M'}${fmt(px(x), 1)},${fmt(py(x), 1)} L${fmt(px(x), 1)},${fmt(py(y), 1)} L${fmt(px(y), 1)},${fmt(py(y), 1)} `;
    x = y;
    orbit.push(x);
  }
  const tail = orbit.slice(-16);
  const spread = Math.max(...tail) - Math.min(...tail);
  const mode = spread < 0.01 ? '收敛到不动点' : spread < 0.25 ? '周期振荡' : '混沌：轨道不重复';
  return (
    <div>
      <svg className={styles.objSvg} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="逻辑斯蒂迭代蛛网图">
        <line x1={px(0)} y1={py(0)} x2={px(1)} y2={py(0)} stroke="#D5CCB9" />
        <line x1={px(0)} y1={py(0)} x2={px(0)} y2={py(1)} stroke="#D5CCB9" />
        <line x1={px(0)} y1={py(0)} x2={px(1)} y2={py(1)} stroke="#C7BFAE" strokeDasharray="4 3" />
        <path d={parab} fill="none" stroke="#4F46E5" strokeWidth={1.6} />
        <path d={web} fill="none" stroke="#FF7A59" strokeWidth={1} opacity={0.85} />
      </svg>
      <input
        type="range" className={styles.slider}
        min={2.5} max={4} step={0.01} value={r}
        aria-label="增长率 r"
        onChange={(e) => onParams?.({ r: parseFloat(e.target.value) })}
      />
      <div className={styles.miniRead}>
        r = <b className={styles.live}>{fmt(r)}</b> · <span className={styles.dim}>{mode}</span>
      </div>
    </div>
  );
}

/* ============================== 注册表 ============================== */

/* ============================== 力学实验台 ============================== */

function SliderRow({ label, v, min, max, step, onChange }: {
  label: string; v: number; min: number; max: number; step: number;
  onChange: (v: number) => void;
}): JSX.Element {
  return (
    <div className={styles.miniRead}>
      <span className={styles.dim}>{label}</span>
      <input
        type="range" className={styles.slider} style={{ flex: 1 }}
        min={min} max={max} step={step} value={v}
        aria-label={label}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      <b className={styles.live}>{fmt(v)}</b>
    </div>
  );
}

const asBody = (v: PortValue | null | undefined): Extract<PortValue, { kind: 'body' }> | null =>
  v && v.kind === 'body' ? v : null;

function RunToggle({ node, onParams }: { node: CanvasNode; onParams?: (patch: Record<string, number>) => void }): JSX.Element {
  const running = (node.params.running ?? 1) !== 0;
  return (
    <button type="button" className={styles.tbtn} onClick={() => onParams?.({ running: running ? 0 : 1 })}>
      {running ? '⏸ 暂停' : '▶ 运行'}
    </button>
  );
}

function ProjectileBody({ node, self, onParams }: NodeBodyProps): JSX.Element {
  const b = asBody(self);
  const v0 = node.params.v0 ?? 8, ang = node.params.angle ?? 55, g = node.params.g ?? 9.8;
  const range = Math.max(0.1, (v0 * v0 * Math.sin(2 * ang * Math.PI / 180)) / g);
  const hMax = Math.max(0.05, (v0 * Math.sin(ang * Math.PI / 180)) ** 2 / (2 * g));
  const path = samplePath('projectile', node.params, physCycle('projectile', node.params));
  const pts = path.map(([x, y]) => `${(x / range) * 188 + 6},${82 - (y / hMax) * 74}`).join(' ');
  const bx = b ? (b.x / range) * 188 + 6 : 6;
  const by = b ? 82 - (b.y / hMax) * 74 : 82;
  return (
    <div>
      <svg className={styles.objSvg} viewBox="0 0 200 90" role="img" aria-label="抛体运动">
        <line x1="0" y1="82" x2="200" y2="82" stroke="#2F3A49" strokeWidth="1.2" />
        <polyline points={pts} fill="none" stroke="#EDE7DA" strokeWidth="1.4" strokeDasharray="3 3" />
        {b ? <circle cx={bx} cy={by} r={4.5} fill="#FF7A59" stroke="#fff" strokeWidth="1.2" /> : null}
      </svg>
      <div className={styles.miniRead}>
        <RunToggle node={node} onParams={onParams} />
        {b ? <span>x <b className={styles.live}>{fmt(b.x)}m</b> · v <b className={styles.live}>{fmt(Math.hypot(b.vx, b.vy))}m/s</b></span> : null}
      </div>
      <SliderRow label="v0" v={v0} min={1} max={20} step={0.5} onChange={(v) => onParams?.({ v0: v })} />
      <SliderRow label="角度°" v={ang} min={5} max={85} step={1} onChange={(v) => onParams?.({ angle: v })} />
      <SliderRow label="g" v={g} min={1} max={25} step={0.1} onChange={(v) => onParams?.({ g: v })} />
    </div>
  );
}

function SpringBody({ node, self, onParams }: NodeBodyProps): JSX.Element {
  const b = asBody(self);
  const A = Math.max(0.1, node.params.x0 ?? 1);
  const k = node.params.k ?? 6, m = node.params.m ?? 1;
  const w = Math.sqrt(k / m);
  const mx = b ? 108 + (b.x / A) * 66 : 108 + 66;
  // 弹簧折线：墙(14) → 滑块左缘(mx-10)
  const seg = 7, sx0 = 16, sx1 = Math.max(sx0 + 8, mx - 12);
  const coil = Array.from({ length: seg + 1 }, (_, i) => {
    const px = sx0 + ((sx1 - sx0) * i) / seg;
    const py = i === 0 || i === seg ? 40 : i % 2 ? 28 : 52;
    return `${px},${py}`;
  }).join(' ');
  return (
    <div>
      <svg className={styles.objSvg} viewBox="0 0 200 80" role="img" aria-label="弹簧振子">
        <line x1="14" y1="10" x2="14" y2="70" stroke="#2F3A49" strokeWidth="2.4" />
        <line x1="0" y1="70" x2="200" y2="70" stroke="#2F3A49" strokeWidth="1.2" />
        <polyline points={coil} fill="none" stroke="#2F3A49" strokeWidth="1.6" />
        <rect x={mx - 10} y={28} width={20} height={24} rx={3} fill="#FF7A59" stroke="#fff" strokeWidth="1.2" />
      </svg>
      <div className={styles.miniRead}>
        <RunToggle node={node} onParams={onParams} />
        {b ? <span>x <b className={styles.live}>{fmt(b.x)}m</b> · v <b className={styles.live}>{fmt(b.vx)}m/s</b></span> : null}
        <span className={styles.dim}>· ω={fmt(w)}</span>
      </div>
      <SliderRow label="k" v={k} min={0.5} max={40} step={0.5} onChange={(v) => onParams?.({ k: v })} />
      <SliderRow label="m" v={m} min={0.1} max={10} step={0.1} onChange={(v) => onParams?.({ m: v })} />
      <SliderRow label="振幅" v={A} min={0.2} max={2} step={0.1} onChange={(v) => onParams?.({ x0: v })} />
    </div>
  );
}

function PendulumBody({ node, self, onParams }: NodeBodyProps): JSX.Element {
  const b = asBody(self);
  const L = node.params.L ?? 1.5, th0 = node.params.theta0 ?? 25, g = node.params.g ?? 9.8;
  const s = 56 / Math.max(0.2, L); // 世界→像素
  const px = 100, py = 10; // 悬点
  const arc = samplePath('pendulum', node.params, physCycle('pendulum', node.params) / 2)
    .map(([x, y]) => `${px + x * s},${py - y * s}`).join(' ');
  const bx = b ? px + b.x * s : px;
  const by = b ? py - b.y * s : py + 56;
  const w = Math.sqrt(g / L);
  return (
    <div>
      <svg className={styles.objSvg} viewBox="0 0 200 86" role="img" aria-label="单摆">
        <circle cx={px} cy={py} r={2.6} fill="#2F3A49" />
        <polyline points={arc} fill="none" stroke="#EDE7DA" strokeWidth="1.4" strokeDasharray="3 3" />
        {b ? <line x1={px} y1={py} x2={bx} y2={by} stroke="#2F3A49" strokeWidth="1.6" /> : null}
        {b ? <circle cx={bx} cy={by} r={5} fill="#FF7A59" stroke="#fff" strokeWidth="1.2" /> : null}
      </svg>
      <div className={styles.miniRead}>
        <RunToggle node={node} onParams={onParams} />
        {b ? <span>θ <b className={styles.live}>{fmt(Math.atan2(b.x, -b.y) / (Math.PI / 180))}°</b> · T <b className={styles.live}>{fmt((2 * Math.PI) / w)}s</b></span> : null}
      </div>
      <SliderRow label="摆长" v={L} min={0.3} max={3} step={0.1} onChange={(v) => onParams?.({ L: v })} />
      <SliderRow label="θ0°" v={th0} min={2} max={60} step={1} onChange={(v) => onParams?.({ theta0: v })} />
      <SliderRow label="g" v={g} min={1} max={25} step={0.1} onChange={(v) => onParams?.({ g: v })} />
    </div>
  );
}

function TrailBody({ values, node }: NodeBodyProps): JSX.Element {
  const b = asBody(values.in);
  const hist = useRef<[number, number][]>([]);
  useEffect(() => { hist.current = []; }, [node.id]);
  useEffect(() => {
    if (!b) return;
    const last = hist.current[hist.current.length - 1];
    if (!last || Math.hypot(last[0] - b.x, last[1] - b.y) > 1e-4) {
      hist.current = [...hist.current.slice(-199), [b.x, b.y]];
    }
  }, [b]);
  if (!b) return unconnected('轨迹仪');
  const h = hist.current;
  const xs = h.map((p) => p[0]), ys = h.map((p) => p[1]);
  const x0 = Math.min(...xs, b.x), x1 = Math.max(...xs, b.x);
  const y0 = Math.min(...ys, b.y), y1 = Math.max(...ys, b.y);
  const sx = Math.max(x1 - x0, 1e-6), sy = Math.max(y1 - y0, 1e-6);
  const toPt = ([x, y]: [number, number]) =>
    `${((x - x0) / sx) * 178 + 8},${76 - ((y - y0) / sy) * 62}`;
  const pts = h.map(toPt).join(' ');
  const [bx, by] = toPt([b.x, b.y]).split(',');
  return (
    <div>
      <svg className={styles.objSvg} viewBox="0 0 194 82" role="img" aria-label="运动轨迹">
        <polyline points={pts} fill="none" stroke="#FF7A59" strokeWidth={1.8} strokeLinejoin="round" />
        <circle cx={bx} cy={by} r={3.4} fill="#2F3A49" />
      </svg>
      <div className={styles.miniRead}>
        位置 <b className={styles.live}>({fmt(b.x)}, {fmt(b.y)})</b>
        <span className={styles.dim}> · {h.length} 点</span>
      </div>
    </div>
  );
}

function EnergyBody({ values }: NodeBodyProps): JSX.Element {
  const b = asBody(values.in);
  if (!b) return unconnected('能量表');
  const ke = b.ke ?? 0, pe = b.pe ?? 0;
  const total = Math.max(ke + pe, 1e-9);
  const keW = (ke / total) * 100;
  return (
    <div>
      <svg className={styles.objSvg} viewBox="0 0 194 34" role="img" aria-label="能量守恒">
        <rect x={4} y={8} width={186 * (keW / 100)} height={16} rx={4} fill="#FF7A59" />
        <rect x={4 + 186 * (keW / 100)} y={8} width={186 - 186 * (keW / 100)} height={16} rx={4} fill="#8ECAE6" />
      </svg>
      <div className={styles.miniRead}>
        <span style={{ color: '#FF7A59' }}>■</span> 动 <b className={styles.live}>{fmt(ke)}J</b>
        <span style={{ color: '#8ECAE6' }}>■</span> 势 <b className={styles.live}>{fmt(pe)}J</b>
        <span className={styles.dim}>· 总 {fmt(total)}J 守恒</span>
      </div>
    </div>
  );
}

/* ============================== 自制积木 ============================== */

function HiddenPortBody(): JSX.Element {
  return <></>;
}

function CompositeBody({ node, onText, onExplode }: NodeBodyProps): JSX.Element {
  const sub = node.sub;
  if (!sub) return unconnected('自制积木');
  const ins = sub.ports.filter((p) => p.dir === 'in');
  const outs = sub.ports.filter((p) => p.dir === 'out');
  const innerKinds = [...new Set(sub.nodes.filter((n) => n.type !== 'portIn' && n.type !== 'portOut').map((n) => NODE_DEFS[n.type]?.title ?? n.type))];
  return (
    <div>
      <input
        className={styles.brickName}
        value={node.text ?? ''}
        placeholder="给积木起个名字…"
        aria-label="积木名称"
        spellCheck={false}
        onChange={(e) => onText?.(e.target.value)}
      />
      <div className={styles.miniRead}>
        <span className={styles.dim}>{sub.nodes.length - ins.length - outs.length} 个对象封装在内</span>
      </div>
      {ins.length > 0 ? (
        <div className={styles.portList}>
          {ins.map((p) => <span key={p.id} className={styles.portInChip}>▸ {p.label}</span>)}
        </div>
      ) : null}
      {outs.length > 0 ? (
        <div className={styles.portList}>
          {outs.map((p) => <span key={p.id} className={styles.portOutChip}>{p.label} ▸</span>)}
        </div>
      ) : null}
      {innerKinds.length > 0 ? (
        <div className={styles.miniRead}>
          <span className={styles.dim}>内含：{innerKinds.slice(0, 4).join(' · ')}{innerKinds.length > 4 ? ` +${innerKinds.length - 4}` : ''}</span>
        </div>
      ) : null}
      <button type="button" className={styles.tbtn} onClick={() => onExplode?.()}>
        ↩ 展开积木
      </button>
    </div>
  );
}

/** 动态端口解析：composite 的端口来自 sub.ports，其余类型取 NODE_DEFS 静态声明 */
export function nodePorts(node: CanvasNode, dir: 'in' | 'out'): readonly PortSpec[] {
  if (node.type === 'composite') {
    return (node.sub?.ports ?? [])
      .filter((p) => p.dir === dir)
      .map((p) => ({ id: p.id, label: p.label, kind: p.kind }));
  }
  const def = NODE_DEFS[node.type];
  return (dir === 'in' ? def?.inputs : def?.outputs) ?? [];
}

export const NODE_DEFS: Record<NodeType, NodeDef> = {
  functionSource: { title: '函数源', badge: '源', width: 280, outputs: [{ id: 'out', label: 'f(x)', kind: 'function' }], Body: FunctionSourceBody },
  functionPlot: { title: '函数图像', badge: '视图', width: 370, inputs: [{ id: 'in', label: 'f(x)', kind: 'function' }, { id: 'x', label: 'x₀', kind: 'scalar' }], Body: FunctionPlotBody },
  limitProbe: { title: '极限观察', badge: '实验', width: 310, inputs: [{ id: 'in', label: 'f(x)', kind: 'function' }, { id: 'x', label: 'x₀', kind: 'scalar' }], outputs: [{ id: 'out', label: '数值候选', kind: 'scalar' }], Body: LimitBody },
  derivative: { title: '导数切线', badge: '实验', width: 370, inputs: [{ id: 'in', label: 'f(x)', kind: 'function' }, { id: 'x', label: 'x₀', kind: 'scalar' }], outputs: [{ id: 'out', label: '斜率', kind: 'scalar' }], Body: DerivativeBody },
  integral: { title: '黎曼积分', badge: '实验', width: 370, inputs: [{ id: 'in', label: 'f(x)', kind: 'function' }], outputs: [{ id: 'out', label: '数值参考', kind: 'scalar' }], Body: IntegralBody },
  taylor: { title: '泰勒近似', badge: '变换', width: 370, inputs: [{ id: 'in', label: 'f(x)', kind: 'function' }, { id: 'x', label: 'x₀', kind: 'scalar' }], outputs: [{ id: 'out', label: 'Pₙ(x)', kind: 'function' }], Body: TaylorBody },
  matrixSource: { title: '矩阵源', badge: '源', width: 200, outputs: [OUT_M2], Body: MatrixSourceBody },
  slider: { title: '滑杆源', badge: '源', width: 190, outputs: [{ id: 'out', label: 'v', kind: 'scalar' }], Body: SliderBody },
  ticker: { title: '时间源', badge: '源', width: 190, outputs: [{ id: 'out', label: 't', kind: 'scalar' }], Body: TickerBody },
  rotor: { title: '旋转器', badge: '变换', width: 190, inputs: [{ id: 'in', label: 't', kind: 'scalar' }], outputs: [OUT_M2], Body: RotorBody },
  matmul: {
    title: '乘法器', badge: '变换', width: 200,
    inputs: [{ id: 'A', label: 'A', kind: 'matrix2' }, { id: 'B', label: 'B', kind: 'matrix2' }],
    outputs: [{ id: 'out', label: 'A×B', kind: 'matrix2' }],
    Body: MatmulBody,
  },
  transformView: { title: '变换视图', badge: '视图', width: 400, inputs: [IN_M2], Body: TransformViewBody },
  fieldView: { title: '向量场', badge: '视图', width: 240, inputs: [IN_M2], Body: FieldViewBody },
  detGauge: { title: 'det 仪表', badge: '视图', width: 200, inputs: [IN_M2], Body: DetGaugeBody },
  eigRead: { title: '特征值读数', badge: '视图', width: 200, inputs: [IN_M2], Body: EigReadBody },
  squareView: { title: '像的形状', badge: '视图', width: 200, inputs: [IN_M2], Body: SquareViewBody },
  quiz: { title: '预测闸门', badge: '学习', width: 210, inputs: [IN_M2], Body: QuizBody },
  spark: { title: '记录仪', badge: '学习', width: 210, inputs: [{ id: 'in', label: 'in' }], Body: SparkBody },
  textNote: { title: '便签', badge: '文字', width: 230, Body: TextNoteBody },
  latexNote: { title: '公式卡', badge: '文字', width: 240, Body: LatexNoteBody },
  cobweb: { title: '蛛网图', badge: '实验', width: 230, Body: CobwebBody },
  projectile: {
    title: '抛体', badge: '源', width: 220,
    inputs: [{ id: 't', label: 't', kind: 'scalar' }],
    outputs: [{ id: 'out', label: 'body', kind: 'body' }],
    Body: ProjectileBody,
  },
  springOsc: {
    title: '弹簧振子', badge: '源', width: 220,
    inputs: [{ id: 't', label: 't', kind: 'scalar' }],
    outputs: [{ id: 'out', label: 'body', kind: 'body' }],
    Body: SpringBody,
  },
  pendulum: {
    title: '单摆', badge: '源', width: 220,
    inputs: [{ id: 't', label: 't', kind: 'scalar' }],
    outputs: [{ id: 'out', label: 'body', kind: 'body' }],
    Body: PendulumBody,
  },
  trailView: { title: '轨迹仪', badge: '实验', width: 210, inputs: [{ id: 'in', label: 'body', kind: 'body' }], Body: TrailBody },
  energyMeter: { title: '能量表', badge: '实验', width: 210, inputs: [{ id: 'in', label: 'body', kind: 'body' }], Body: EnergyBody },
  composite: { title: '自制积木', badge: '实验', width: 230, Body: CompositeBody },
  // 边界节点只存在于 sub 子图内部（不渲染、不进调色板），注册仅为类型完备
  portIn: { title: '入口', badge: '源', width: 0, Body: HiddenPortBody },
  portOut: { title: '出口', badge: '视图', width: 0, Body: HiddenPortBody },
};

/** 调色板（按类别分组） */
export const PALETTE_GROUPS: readonly { label: string; types: readonly NodeType[] }[] = [
  { label: '高数', types: ['functionSource', 'functionPlot', 'limitProbe', 'derivative', 'integral', 'taylor'] },
  { label: '源', types: ['matrixSource', 'slider', 'ticker'] },
  { label: '变换', types: ['rotor', 'matmul'] },
  { label: '视图', types: ['transformView', 'fieldView', 'detGauge', 'eigRead', 'squareView', 'cobweb'] },
  { label: '学习', types: ['quiz', 'spark'] },
  { label: '力学', types: ['projectile', 'springOsc', 'pendulum', 'trailView', 'energyMeter'] },
  { label: '文字', types: ['textNote', 'latexNote'] },
];

/** 新节点默认参数 */
export function defaultParams(type: NodeType): Record<string, number> {
  switch (type) {
    case 'functionSource': return { a: 1, b: 0, c: 0 };
    case 'functionPlot': return { min: -3, max: 3, x: 0 };
    case 'limitProbe': return { x: 0, side: 0 };
    case 'derivative': return { x: 1, h: 0.5 };
    case 'integral': return { lower: 0, upper: 1, n: 12, method: 1, area: 0 };
    case 'taylor': return { center: 0, degree: 3, x: 0.5, span: 2 };
    case 'matrixSource': return { a: 1, b: 0.5, c: 0, d: 1 };
    case 'slider': return { v: 0.3, min: 0, max: 1 };
    case 'ticker': return { period: 6, running: 1 };
    case 'rotor': return { theta: 0 };
    case 'cobweb': return { r: 3.2 };
    case 'projectile': return { v0: 8, angle: 55, g: 9.8, m: 1, running: 1 };
    case 'springOsc': return { k: 6, m: 1, x0: 1, running: 1 };
    case 'pendulum': return { L: 1.5, theta0: 25, g: 9.8, m: 1, running: 1 };
    default: return {};
  }
}
