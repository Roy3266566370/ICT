import { studyNodeDefs } from './StudyStageNodes';
import { studyStages, type StudyStage } from './studyStages';
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
import { lazy, Suspense, useEffect, useRef, useState, type ComponentType } from 'react';
import { Formula } from '@/components/showcase/Formula';
import type { CanvasNode, NodeType, PortSpec, PortValue } from './types.ts';
import { det, tr, eigen, rankOf, fmt, clamp, paramsM, type M2 } from './math.ts';
import {
  FunctionSourceBody, FunctionPlotBody, DerivativeBody, LimitBody, IntegralBody, TaylorBody,
  CALCULUS_BLOCK_DEFS, CALCULUS_BLOCK_DEFAULTS,
} from './CalculusNodes';
import { DoubleIntegralBody, FourierLabBody, FtcViewBody, Func2dSourceBody, GradientContourBody, OdeSlopeFieldBody } from './CalculusAdvancedNodes';
import { PHYSICS_BLOCK_DEFS, PHYSICS_BLOCK_DEFAULTS } from './PhysicsBlockNodes';
import {
  CollisionBody, EnergyBody, InclineBody, PendulumBody, ProjectileBody, ResonanceBody, SpringBody, TrailBody, WaveBody,
} from './PhysicsNodes';
import { CacheSplitBody, DsTraversalBody, IpSubnetBody, Lab408WorkbenchBody, PageReplaceBody } from './Lab408Nodes';
import { CacheSimBody, CpuScheduleBody, PipelineBody, TcpCongestionBody } from './Lab408SimNodes';
import { BankerBody, DsStepBody, Ieee754Body, SlidingWindowBody } from './Lab408SimMoreNodes';
import { Lab408PipelineNode } from './Lab408PipelineNode';
import { pipelinePorts } from './lab408Pipeline.ts';
import { PhysicsPipelineNode } from './PhysicsPipelineNode';
import { physicsPipelinePorts } from './physicsPipeline.ts';
import { CalculusPipelineNode } from './CalculusPipelineNode';
import { calculusPipelinePorts } from './calculusPipeline.ts';
import { BusinessPipelineNode } from './BusinessPipelineNode.tsx';
import { businessPipelinePorts } from './businessPipeline.ts';
import { AttentionSimBody, PageLabSimBody } from './SimNodes';
import { AI_RULE_DEFS } from './AiRuleBlockNode';
import { UNIVERSAL_STAGE_DEFS } from './UniversalStageView';
import { OFFICE_BLOCK_DEFS, OFFICE_DEFAULTS } from './OfficeBlockNodes';
import { DEEP_MODERN_DEFS, DEEP_MODERN_DEFAULTS } from './DeepModernNodes';
import { LAB408_BLOCK_DEFS, LAB408_BLOCK_DEFAULTS } from './Lab408BlockNodes';
import { DEEP_FIRST_DEFS, deepFirstDefaults } from './DeepFirstNodes';
import { DEEP_CORE_DEFS, deepCoreDefaults } from './DeepCoreNodes';
import { DEEP_ADVANCED_DEFS, deepAdvancedDefaults } from './DeepAdvancedNodes';
import styles from './canvas.module.css';

export interface NodeBodyProps {
  node: CanvasNode;
  /** 渲染在画布卡片内为 true（检查器/仪器台复用同一 Body 时为缺省 false），供卡片精简内容用 */
  inCard?: boolean;
  /** 各输入端口的当前值（键 = 端口 id），无输入节点为空对象 */
  values: Record<string, PortValue | null>;
  /** 本节点输出的求值结果（无输出为 null），供源/变换节点自显 */
  self: PortValue | null;
  /** 参数写回（画布负责传播与持久化） */
  onParams?: (patch: Record<string, number>) => void;
  /** 文本写回 */
  onText?: (text: string) => void;
  /** 载荷写回（如上传真实图片、导入 CSV 数据集） */
  onPayload?: (payload: string | undefined) => void;
  /** composite：请求展开（解封装）回本层 */
  onExplode?: () => void;
  /** composite：存入跨画布个人积木库 */
  onSaveBlock?: () => void;
  onLive?: (outputs: Record<string, PortValue>) => void;
  timeline?: { step: number; last: number; onStep: (step: number) => void };
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

function MatrixSourceBody({ node, onParams, inCard }: NodeBodyProps): JSX.Element {
  const m = paramsM(node.params);
  const set = (k: keyof M2, raw: string): void => {
    const v = parseFloat(raw);
    if (Number.isFinite(v)) onParams?.({ [k]: clamp(v, -9, 9) });
  };
  return (
    <div>
      <div className={styles.matgrid}>
        {(['a', 'b', 'c', 'd'] as const).map((k) => (
          inCard
            ? <div key={k} className={styles.rocell}>{fmt(m[k])}</div>
            : <input
                key={k}
                aria-label={`矩阵元素 ${k}`}
                inputMode="decimal"
                value={fmt(m[k], 2)}
                onChange={(e) => set(k, e.target.value)}
              />
        ))}
      </div>
      {!inCard && <div className={styles.presets}>
        {MATRIX_PRESETS.map((p) => (
          <button key={p.label} type="button" onClick={() => onParams?.({ ...p.m })}>
            {p.label}
          </button>
        ))}
      </div>}
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
        min={min} max={max} step={node.params.step ?? 0.005}
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

function TickerBody({ node, self, onParams, inCard }: NodeBodyProps): JSX.Element {
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
      {!inCard && <input
        type="range" className={styles.slider}
        min={1} max={20} step={0.5} value={period}
        aria-label="周期（秒/圈）"
        onChange={(e) => onParams?.({ period: parseFloat(e.target.value) })}
      />}
      <div className={styles.miniRead}>周期 <b className={styles.live}>{fmt(period, 1)}s</b>/圈 → 输出 t ∈ [0,1)</div>
    </div>
  );
}

/* ============================== 变换 ============================== */

function RotorBody({ node, values, onParams, inCard }: NodeBodyProps): JSX.Element {
  const wired = values.in != null;
  const t = wired && values.in!.kind === 'scalar' ? values.in!.v : node.params.theta ?? 0;
  return (
    <div>
      {!wired && !inCard ? (
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
  if (v.kind !== 'matrix2') return null;
  return Math.abs(v.a * v.d - v.b * v.c);
}

function SparkBody({ values, node }: NodeBodyProps): JSX.Element {
  const n = extract(values.in);
  const validation = extract(values.validation);
  const validationHist = useRef<number[]>([]);
  const hist = useRef<number[]>([]);
  useEffect(() => {
    hist.current = [];
    validationHist.current = [];
  }, [node.id]);
  useEffect(() => {
    if (n === null) return;
    const last = hist.current[hist.current.length - 1];
    if (last === undefined || Math.abs(last - n) > 1e-9) {
      hist.current = [...hist.current.slice(-119), n];
    }
  }, [n]);
  useEffect(() => {
    if (validation !== null && Number.isFinite(validation)) validationHist.current = [...validationHist.current.slice(-119), validation];
  }, [validation]);
  if (n === null) return unconnected('记录仪');
  const h = hist.current;
  const secondary = validation === null ? [] : validationHist.current;
  const lo = Math.min(...h, ...secondary, n), hi = Math.max(...h, ...secondary, n);
  const span = Math.max(hi - lo, 1e-6);
  const pts = h.map((v, i) =>
    `${(i / Math.max(h.length - 1, 1)) * 186 + 7},${64 - ((v - lo) / span) * 52 - 6}`).join(' ');
  const label = values.in!.kind === 'scalar' ? 'v' : values.in!.kind === 'body' ? '|v|' : '|det|';
  return (
    <div>
      <svg className={styles.objSvg} viewBox="0 0 200 70" role="img" aria-label={`${label} 历史记录`}>
        <polyline points={pts} fill="none" stroke="#FF7A59" strokeWidth={1.8} strokeLinejoin="round" />
        {secondary.length ? <polyline points={secondary.map((v, i) => `${7 + i / Math.max(secondary.length - 1, 1) * 186},${58 - (v - lo) / span * 52}`).join(' ')} fill="none" stroke="#4f46e5" strokeWidth={1.8} /> : null}
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

const FormulaCardEditor = lazy(() => import('./FormulaCardEditor'));

function LatexNoteBody({ node, onText }: NodeBodyProps): JSX.Element {
  const [editing, setEditing] = useState(false);
  const tex = (node.text ?? '').trim();
  if (editing && onText) return <Suspense fallback={<p role="status">正在打开公式编辑器…</p>}>
    <FormulaCardEditor initialValue={tex}
      onComplete={(next) => { if (next !== tex) onText(next); setEditing(false); }}
      onCancel={() => setEditing(false)} />
  </Suspense>;
  return <div className={styles.formulaCard}>
    {tex && <div className={styles.texview}><Formula tex={tex} block /></div>}
    {onText && <button type="button" className={styles.editFormula} onClick={() => setEditing(true)}>编辑公式</button>}
  </div>;
}

function CobwebBody({ node, onParams, inCard }: NodeBodyProps): JSX.Element {
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
      {!inCard && <input
        type="range" className={styles.slider}
        min={2.5} max={4} step={0.01} value={r}
        aria-label="增长率 r"
        onChange={(e) => onParams?.({ r: parseFloat(e.target.value) })}
      />}
      <div className={styles.miniRead}>
        r = <b className={styles.live}>{fmt(r)}</b> · <span className={styles.dim}>{mode}</span>
      </div>
    </div>
  );
}

/* ============================== 自制积木 ============================== */

function HiddenPortBody(): JSX.Element {
  return <></>;
}

function CompositeBody({ node, onText, onExplode, onSaveBlock }: NodeBodyProps): JSX.Element {
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
      <div className={styles.miniRead}>
        <button type="button" className={styles.tbtn} onClick={() => onSaveBlock?.()}>
          💾 存入我的积木库
        </button>
      </div>
      <button type="button" className={styles.tbtn} onClick={() => onExplode?.()}>
        ↩ 展开积木
      </button>
    </div>
  );
}

/** 动态端口解析：composite 的端口来自 sub.ports，其余类型取 NODE_DEFS 静态声明 */
export function nodePorts(node: CanvasNode, dir: 'in' | 'out'): readonly PortSpec[] {
  if (node.type === 'lab408Stage') return pipelinePorts(node, dir);
  if (node.type === 'physicsStage') return physicsPipelinePorts(node, dir);
  if (node.type === 'calculusStage') return calculusPipelinePorts(node, dir);
  if (node.type === 'businessStage') return businessPipelinePorts(node, dir);
  if (node.type === 'composite') {
    return (node.sub?.ports ?? [])
      .filter((p) => p.dir === dir)
      .map((p) => ({ id: p.id, label: p.label, kind: p.kind }));
  }
  const def = NODE_DEFS[node.type];
  return (dir === 'in' ? def?.inputs : def?.outputs) ?? [];
}

export const NODE_DEFS: Record<NodeType, NodeDef> = {
  ...studyNodeDefs,
  ...DEEP_FIRST_DEFS,
  ...DEEP_CORE_DEFS,
  ...DEEP_ADVANCED_DEFS,
  ...OFFICE_BLOCK_DEFS,
  ...PHYSICS_BLOCK_DEFS,
  ...CALCULUS_BLOCK_DEFS,
  ...LAB408_BLOCK_DEFS,
  ...DEEP_MODERN_DEFS,
  ...AI_RULE_DEFS,
  ...UNIVERSAL_STAGE_DEFS,
  functionSource: { title: '函数源', badge: '源', width: 280, outputs: [{ id: 'out', label: 'f(x)', kind: 'function' }], Body: FunctionSourceBody },
  functionPlot: { title: '函数图像', badge: '视图', width: 370, inputs: [{ id: 'in', label: 'f(x)', kind: 'function' }, { id: 'x', label: 'x₀', kind: 'scalar' }], Body: FunctionPlotBody },
  limitProbe: { title: '极限观察', badge: '实验', width: 310, inputs: [{ id: 'in', label: 'f(x)', kind: 'function' }, { id: 'x', label: 'x₀', kind: 'scalar' }], outputs: [{ id: 'out', label: '数值候选', kind: 'scalar' }], Body: LimitBody },
  derivative: { title: '导数切线', badge: '实验', width: 370, inputs: [{ id: 'in', label: 'f(x)', kind: 'function' }, { id: 'x', label: 'x₀', kind: 'scalar' }], outputs: [{ id: 'out', label: '斜率', kind: 'scalar' }], Body: DerivativeBody },
  integral: { title: '黎曼积分', badge: '实验', width: 370, inputs: [{ id: 'in', label: 'f(x)', kind: 'function' }], outputs: [{ id: 'out', label: '数值参考', kind: 'scalar' }], Body: IntegralBody },
  taylor: { title: '泰勒近似', badge: '变换', width: 370, inputs: [{ id: 'in', label: 'f(x)', kind: 'function' }, { id: 'x', label: 'x₀', kind: 'scalar' }], outputs: [{ id: 'out', label: 'Pₙ(x)', kind: 'function' }], Body: TaylorBody },
  ftcView: { title: '变上限积分', badge: '变换', width: 380, inputs: [{ id: 'in', label: 'f(x)', kind: 'function' }], outputs: [{ id: 'out', label: 'F(x)', kind: 'scalar' }], Body: FtcViewBody },
  fourierLab: { title: '傅里叶合成', badge: '实验', width: 400, Body: FourierLabBody },
  odeSlopeField: { title: '斜率场', badge: '实验', width: 400, Body: OdeSlopeFieldBody },
  func2dSource: { title: '二元函数源', badge: '源', width: 280, outputs: [{ id: 'out', label: 'f(x,y)', kind: 'function2d' }], Body: Func2dSourceBody },
  gradientContour: { title: '梯度等高线', badge: '变换', width: 400, inputs: [{ id: 'in', label: 'f(x,y)', kind: 'function2d' }], outputs: [{ id: 'out', label: 'D_θ f', kind: 'scalar' }], Body: GradientContourBody },
  doubleIntegralView: { title: '二重积分微元', badge: '实验', width: 400, Body: DoubleIntegralBody },
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
  spark: { title: '记录仪', badge: '学习', width: 210, inputs: [{ id: 'in', label: '训练' }, { id: 'validation', label: '验证' }], Body: SparkBody },
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
  inclineLab: {
    title: '斜面', badge: '源', width: 300,
    inputs: [{ id: 't', label: 't', kind: 'scalar' }],
    outputs: [{ id: 'out', label: 'body', kind: 'body' }],
    Body: InclineBody,
  },
  collisionLab: {
    title: '一维碰撞', badge: '源', width: 320,
    inputs: [{ id: 't', label: 't', kind: 'scalar' }],
    outputs: [{ id: 'out', label: 'body', kind: 'body' }],
    Body: CollisionBody,
  },
  resonanceLab: {
    title: '受迫共振', badge: '源', width: 330,
    inputs: [{ id: 't', label: 't', kind: 'scalar' }],
    outputs: [{ id: 'out', label: 'body', kind: 'body' }],
    Body: ResonanceBody,
  },
  waveLab: {
    title: '波场', badge: '源', width: 330,
    inputs: [{ id: 't', label: 't', kind: 'scalar' }],
    outputs: [{ id: 'out', label: 'body', kind: 'body' }],
    Body: WaveBody,
  },
  dsTraversal: { title: '二叉树遍历', badge: '实验', width: 280, Body: DsTraversalBody },
  cacheSplit: { title: 'Cache 地址划分', badge: '实验', width: 310, Body: CacheSplitBody },
  pageReplace: { title: '页面置换', badge: '实验', width: 370, Body: PageReplaceBody },
  ipSubnet: { title: 'IPv4 子网划分', badge: '实验', width: 310, Body: IpSubnetBody },
  lab408Workbench: { title: '408 全题型工作台', badge: '实验', width: 460, Body: Lab408WorkbenchBody },
  lab408Stage: { title: '408 模块', badge: '实验', width: 400, Body: Lab408PipelineNode },
  physicsStage: { title: '大学物理模块', badge: '实验', width: 400, Body: PhysicsPipelineNode },
  calculusStage: { title: '高等数学模块', badge: '实验', width: 400, Body: CalculusPipelineNode },
  businessStage: { title: '办公决策模块', badge: '实验', width: 400, Body: BusinessPipelineNode },
  cacheSimLab: { title: 'Cache 组相联', badge: '实验', width: 380, Body: CacheSimBody },
  pipelineLab: { title: '流水线时空图', badge: '实验', width: 400, Body: PipelineBody },
  ieee754Lab: { title: 'IEEE754 解码', badge: '实验', width: 330, Body: Ieee754Body },
  cpuScheduleLab: { title: 'CPU 调度', badge: '实验', width: 400, Body: CpuScheduleBody },
  bankerLab: { title: '银行家算法', badge: '实验', width: 400, Body: BankerBody },
  tcpCongestionLab: { title: 'TCP 拥塞窗口', badge: '实验', width: 360, Body: TcpCongestionBody },
  slidingWindowLab: { title: '滑动窗口', badge: '实验', width: 380, Body: SlidingWindowBody },
  dsStepLab: { title: '数据结构步进器', badge: '实验', width: 380, Body: DsStepBody },
  attentionSim: { title: '注意力实验', badge: '实验', width: 340, Body: AttentionSimBody },
  pageLabSim: { title: 'AI 交互模型', badge: '实验', width: 400, Body: PageLabSimBody },
  composite: { title: '自制积木', badge: '实验', width: 230, Body: CompositeBody },
  // 边界节点只存在于 sub 子图内部（不渲染、不进调色板），注册仅为类型完备
  portIn: { title: '入口', badge: '源', width: 0, Body: HiddenPortBody },
  portOut: { title: '出口', badge: '视图', width: 0, Body: HiddenPortBody },
} as Record<NodeType, NodeDef>;

/** 调色板（按类别分组） */
export const PALETTE_GROUPS: readonly { label: string; types: readonly NodeType[] }[] = [
  { label: '深度学习 · 输入', types: ['dataset2dSource', 'pixelGridSource', 'tokenSeqSource', 'studyTokens'] },
  { label: '深度学习 · 算子', types: ['linearOp', 'activationOp', 'residualJoin', 'normOp', 'conv2dOp', 'attentionOp',
    ...(Object.keys(studyStages) as StudyStage[]).filter((type) => type !== 'studyTokens' && studyStages[type].outputs.length > 0)] },
  { label: '深度学习 · 训练与更新', types: ['mlpTrainer', 'optimizerArena', 'svmLab', 'qLearningLab', 'lossProbeOp', 'loraAdapterOp', 'quantProbeOp'] },
  { label: '深度学习 · 观察', types: ['boundaryView', 'matrixHeatmapView', 'gradFlowMeter',
    ...(Object.keys(studyStages) as StudyStage[]).filter((type) => studyStages[type].outputs.length === 0), 'activationProbe', 'attentionAB',
    'kvCache', 'resnetLab', 'sequenceMemory', 'multiheadLab', 'autoencoderLab', 'diffusionLab', 'samplingDecoderView'] },
  { label: '高数 · 一元与级数', types: ['functionSource', 'functionPlot', 'limitProbe', 'derivative', 'integral', 'taylor', 'ftcView', 'fourierLab', 'odeSlopeField', 'funcCombineOp', 'probDistSource'] },
  { label: '高数 · 多元与线代', types: ['func2dSource', 'gradientContour', 'doubleIntegralView', 'matrixSource', 'transformView', 'eigRead', 'svdDecomposeOp', 'linearSolveView'] },
  { label: '408', types: ['cacheSimLab', 'pipelineLab', 'ieee754Lab', 'cpuScheduleLab', 'bankerLab',
    'tcpCongestionLab', 'slidingWindowLab', 'dsStepLab', 'dsTraversal', 'cacheSplit', 'pageReplace', 'ipSubnet',
    'arraySource', 'sortCompareView', 'graphSource', 'shortestPathView', 'memAddrSource', 'addrTranslateView', 'cacheMapView'] },
  { label: '办公 · 数据与决策', types: ['bizTableSource', 'bizGrowthSource', 'bizScenarioFork', 'bizDiscountOp', 'bizDecisionMatrix', 'bizWaterfallView'] },
  { label: 'AI · 创作引擎', types: ['aiRuleBlock', 'universalStageView'] },
  { label: '源', types: ['slider', 'ticker'] },
  { label: '变换', types: ['rotor', 'matmul'] },
  { label: '视图', types: ['fieldView', 'detGauge', 'squareView', 'cobweb'] },
  { label: '学习', types: ['quiz', 'spark', 'attentionSim'] },
  { label: '大学物理 · 力学', types: ['projectile', 'springOsc', 'pendulum', 'trailView', 'energyMeter', 'inclineLab', 'collisionLab', 'resonanceLab', 'waveLab'] },
  { label: '大学物理 · 电磁光学热学', types: ['emFieldSource', 'emFieldView', 'rlcCircuitLab', 'opticsBench', 'thermoCycle'] },
  { label: '文字', types: ['textNote', 'latexNote'] },
];

/** 新节点默认参数 */
export function defaultParams(type: NodeType): Record<string, number> {
  const deep = deepFirstDefaults(type) ?? deepCoreDefaults(type) ?? deepAdvancedDefaults(type);
  if (deep) return deep;
  const office = OFFICE_DEFAULTS[type];
  if (office) return { ...office };
  const physics = PHYSICS_BLOCK_DEFAULTS[type];
  if (physics) return { ...physics };
  const calculus = CALCULUS_BLOCK_DEFAULTS[type];
  if (calculus) return { ...calculus };
  const lab408 = LAB408_BLOCK_DEFAULTS[type];
  if (lab408) return { ...lab408 };
  const deepModern = DEEP_MODERN_DEFAULTS[type];
  if (deepModern) return { ...deepModern };
  if (type === 'aiRuleBlock') return { a: 1, b: 0, c: 0 };
  switch (type) {
    case 'functionSource': return { a: 1, b: 0, c: 0 };
    case 'functionPlot': return { min: -3, max: 3, x: 0 };
    case 'limitProbe': return { x: 0, side: 0, eps: 0.1 };
    case 'derivative': return { x: 1, h: 0.5, showDerivative: 0 };
    case 'integral': return { lower: 0, upper: 1, n: 12, method: 1, area: 0 };
    case 'taylor': return { center: 0, degree: 3, x: 0.5, span: 2 };
    case 'ftcView': return { a: 0, x: 1, n: 122 };
    case 'fourierLab': return { waveform: 0, n: 5, span: 6.283185307179586 };
    case 'odeSlopeField': return { x0: 0, y0: 1, min: -3, max: 3, step: 0.02, steps: 150 };
    case 'func2dSource': return { a: 1, b: 1 };
    case 'gradientContour': return { x: 1, y: 1, theta: 0.7853981633974483, span: 2.5, gx: 0, gy: 0 };
    case 'doubleIntegralView': return { mode: 0, n: 20, rMax: 1, theta1: 0, theta2: 6.283185307179586 };
    case 'matrixSource': return { a: 1, b: 0.5, c: 0, d: 1 };
    case 'slider': return { v: 0.3, min: 0, max: 1 };
    case 'ticker': return { period: 6, running: 1 };
    case 'rotor': return { theta: 0 };
    case 'cobweb': return { r: 3.2 };
    case 'projectile': return { v0: 8, angle: 55, g: 9.8, m: 1, running: 1, showForce: 0, showVelocity: 0, showStrobe: 0, compare: 0, fan: 0 };
    case 'springOsc': return { k: 6, m: 1, x0: 1, running: 1, showForce: 0, showVelocity: 0, showStrobe: 0 };
    case 'pendulum': return { L: 1.5, theta0: 25, g: 9.8, m: 1, running: 1, showForce: 0, showVelocity: 0, showStrobe: 0, alt: 1 };
    case 'trailView': return { mode: 0 };
    case 'energyMeter': return {};
    case 'inclineLab': return { alpha: 30, mu: 0.3, g: 9.8, m: 1, L: 2, running: 1, showForce: 1 };
    case 'collisionLab': return { m1: 1, v1: 2, m2: 2, v2: -1, e: 1, running: 1, showForce: 1 };
    case 'resonanceLab': return { k: 10, m: 1, c: 0.5, f0: 1, wd: 3.16, running: 1 };
    case 'waveLab': return { amp: 0.6, freq: 1, lambda: 2, mode: 0, running: 1 };
    case 'dsTraversal': return { order: 0 };
    case 'cacheSplit': return { addrBits: 32, blockBytes: 64, cacheKB: 64, ways: 4 };
    case 'pageReplace': return { algorithm: 0, capacity: 3 };
    case 'ipSubnet': return { prefix: 26, index: 0 };
    case 'lab408Workbench': return { subjectIndex: 0, typeIndex: 0 };
    case 'cacheSimLab': return { addrBits: 32, blockBytes: 64, cacheKB: 64, ways: 4 };
    case 'pipelineLab': return { forwarding: 1 };
    case 'ieee754Lab': return { bits: 32 };
    case 'cpuScheduleLab': return { algo: 0, quantum: 2 };
    case 'bankerLab': return { available0: 3 };
    case 'tcpCongestionLab': return { ssthresh: 8 };
    case 'slidingWindowLab': return { winSize: 4, mode: 0 };
    case 'dsStepLab': return { mode: 0, order: 0 };
    case 'attentionSim': return { query: 1, temperature: 1, causal: 0 };
    default: return {};
  }
}
