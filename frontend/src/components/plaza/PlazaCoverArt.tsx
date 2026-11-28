/**
 * PlazaCoverArt.tsx —— 广场宽卡的「真实图形封面」引擎
 *
 * 双层渲染优先级：
 *  1. 官方精选 8 件定制纸墨矢量插画（按 cover.preview_template 匹配）；
 *  2. 用户自创画布的真实节点拓扑缩略图 <MiniTopologyCover />（按 cover.topology）；
 *  都没有时回退为精致的点阵几何骨架图。
 *
 * 所有插画统一 16:10（viewBox 0 0 320 200）、细腻点阵坐标纸底纹、
 * 手绘感细线 + 学科色高亮，右上角点缀极小等宽公式标签。
 */
import { useId } from 'react';
import { SUBJECT_COLORS, type CoverTopology, type PlazaItem, type SUBJECTS } from '@/api/plazaTypes';

const INK = '#34372f';
const FAINT = '#9a9b8f';
const CORAL = '#de421f';

type Subject = keyof typeof SUBJECTS;

/** 细腻点阵坐标纸底纹（pattern id 需实例唯一，避免同页多卡片冲突）。 */
function PaperBase({ pid, w = 320, h = 200 }: { pid: string; w?: number; h?: number }) {
  return <>
    <defs>
      <pattern id={pid} width="11" height="11" patternUnits="userSpaceOnUse">
        <circle cx="1.1" cy="1.1" r="0.75" fill="#121513" opacity="0.10" />
      </pattern>
    </defs>
    <rect width={w} height={h} fill="#fffdf8" />
    <rect width={w} height={h} fill={`url(#${pid})`} />
  </>;
}

/** 右上角极小等宽公式标签。 */
function FormulaTag({ text, x = 316, y = 8 }: { text: string; x?: number; y?: number }) {
  const width = text.length * 4.6 + 10;
  return <g>
    <rect x={x - width} y={y} width={width} height="14" rx="7" fill="#fffdf8" opacity="0.86" stroke="#d8d3c4" strokeWidth="0.6" />
    <text x={x - width / 2} y={y + 9.8} textAnchor="middle" fontFamily="var(--font-family-mono, monospace)" fontSize="7.2" fill="#656a5e">{text}</text>
  </g>;
}

function artProps(pid: string) {
  return { viewBox: '0 0 320 200', preserveAspectRatio: 'xMidYMid slice', 'aria-hidden': true as const, focusable: false as const };
}

/* ---------- 1. 理想与阻力抛体（物理） ---------- */
function ProjectileDragArt() {
  const pid = useId();
  return <svg {...artProps(pid)}>
    <PaperBase pid={pid} />
    {/* 地面基准线 */}
    <line x1="18" y1="172" x2="302" y2="172" stroke={INK} strokeWidth="1" opacity="0.55" />
    {/* 理想虚线抛物线（无阻力，高远） */}
    <path d="M34,172 Q152,-48 268,172" fill="none" stroke={FAINT} strokeWidth="1.4" strokeDasharray="5 4" strokeLinecap="round" />
    {/* 阻力实线抛物线（低近，朱砂） */}
    <path d="M34,172 Q112,26 188,172" fill="none" stroke="#b5492e" strokeWidth="2" strokeLinecap="round" />
    {/* 发射点与落点 */}
    <circle cx="34" cy="172" r="3" fill="#b5492e" />
    <circle cx="268" cy="172" r="2" fill="none" stroke={FAINT} strokeWidth="1" />
    <circle cx="188" cy="172" r="2" fill="none" stroke="#b5492e" strokeWidth="1" />
    {/* 速度矢量（阻力轨道切线方向） */}
    <g stroke={INK} strokeWidth="1.4" strokeLinecap="round">
      <line x1="86" y1="105" x2="122" y2="88" />
      <line x1="122" y1="88" x2="113" y2="88.5" />
      <line x1="122" y1="88" x2="117" y2="95" />
    </g>
    <text x="128" y="86" fontFamily="var(--font-family-mono, monospace)" fontSize="8" fill={INK} fontStyle="italic">v</text>
    {/* 发射角标注 */}
    <path d="M62,172 A28,28 0 0 0 58,156" fill="none" stroke={INK} strokeWidth="0.8" opacity="0.7" />
    <text x="66" y="166" fontFamily="var(--font-family-mono, monospace)" fontSize="7.5" fill={INK}>θ</text>
    {/* 机械能双柱仪表 */}
    <g>
      <rect x="228" y="96" width="58" height="48" rx="5" fill="#fffdf8" opacity="0.9" stroke="#d8d3c4" strokeWidth="0.8" />
      <rect x="240" y="118" width="9" height="18" fill="#b5492e" opacity="0.85" rx="1" />
      <rect x="255" y="106" width="9" height="30" fill="#2b4c7e" opacity="0.8" rx="1" />
      <line x1="236" y1="136.5" x2="274" y2="136.5" stroke={INK} strokeWidth="0.8" />
      <text x="244.5" y="114" textAnchor="middle" fontFamily="var(--font-family-mono, monospace)" fontSize="6" fill="#656a5e">K</text>
      <text x="259.5" y="102" textAnchor="middle" fontFamily="var(--font-family-mono, monospace)" fontSize="6" fill="#656a5e">U</text>
    </g>
    <FormulaTag text="E = K + U · x¨ = −k v̄/m" />
  </svg>;
}

/* ---------- 2. 带电粒子偏转与磁轨（物理） ---------- */
function ChargedParticleArt() {
  const pid = useId();
  const crosses = [];
  for (let gx = 0; gx < 4; gx++) for (let gy = 0; gy < 4; gy++) {
    const cx = 172 + gx * 30, cy = 62 + gy * 26;
    crosses.push(<g key={`${gx}-${gy}`} stroke={FAINT} strokeWidth="0.9" opacity="0.75">
      <line x1={cx - 3} y1={cy - 3} x2={cx + 3} y2={cy + 3} />
      <line x1={cx + 3} y1={cy - 3} x2={cx - 3} y2={cy + 3} />
    </g>);
  }
  return <svg {...artProps(pid)}>
    <PaperBase pid={pid} />
    {/* 平行板电容器 */}
    <line x1="24" y1="66" x2="128" y2="66" stroke={INK} strokeWidth="2.2" strokeLinecap="round" />
    <line x1="24" y1="122" x2="128" y2="122" stroke={INK} strokeWidth="2.2" strokeLinecap="round" />
    {[38, 66, 94].map(px => <g key={px}>
      <text x={px} y="61" textAnchor="middle" fontSize="8" fill="#b5492e" fontFamily="var(--font-family-mono, monospace)">+</text>
      <text x={px} y="135" textAnchor="middle" fontSize="8" fill="#2b4c7e" fontFamily="var(--font-family-mono, monospace)">−</text>
    </g>)}
    {/* 板间电场方向 */}
    {[50, 78, 106].map(px => <line key={px} x1={px} y1="74" x2={px} y2="114" stroke={FAINT} strokeWidth="0.8" strokeDasharray="2.5 3" markerEnd="none" />)}
    {/* 粒子穿过极板的抛物线轨迹 + 出射直线 */}
    <path d="M16,94 Q76,94 128,110 L152,116" fill="none" stroke="#b5492e" strokeWidth="1.9" strokeLinecap="round" />
    {/* 磁场区域 */}
    <rect x="152" y="44" width="140" height="118" rx="8" fill="none" stroke="#d8d3c4" strokeWidth="1" strokeDasharray="4 3.5" />
    {crosses}
    {/* 磁轨圆弧偏转：圆心 (152,176)，半径 60，顺时针扫过 60° */}
    <path d="M152,116 A60,60 0 0 1 204,146" fill="none" stroke="#b5492e" strokeWidth="2" strokeLinecap="round" />
    {/* 半径标注 r */}
    <line x1="152" y1="176" x2="204" y2="146" stroke={INK} strokeWidth="0.8" strokeDasharray="3 2.5" opacity="0.7" />
    <circle cx="152" cy="176" r="1.6" fill={INK} />
    <text x="184" y="168" fontFamily="var(--font-family-mono, monospace)" fontSize="8.5" fill={INK} fontStyle="italic">r</text>
    {/* 粒子 */}
    <circle cx="16" cy="94" r="3" fill="#b5492e" />
    <FormulaTag text="r = mv / qB" />
  </svg>;
}

/* ---------- 3. RC 充放电（物理） ---------- */
function RcCircuitArt() {
  const pid = useId();
  return <svg {...artProps(pid)}>
    <PaperBase pid={pid} />
    {/* RC 回路简图：左电源、顶电阻、右电容、底导线 */}
    <g fill="none" stroke={INK} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {/* 顶边：左段 + 电阻锯齿 + 右段 */}
      <path d="M30,64 L72,64" />
      <path d="M72,64 L78,56 L86,72 L94,56 L102,72 L110,56 L116,64" stroke="#b5492e" strokeWidth="1.8" />
      <path d="M116,64 L150,64" />
      {/* 右边：上段 + 电容极板 + 下段 */}
      <path d="M150,64 L150,88" />
      <line x1="140" y1="92" x2="160" y2="92" strokeWidth="2.4" />
      <line x1="140" y1="100" x2="160" y2="100" strokeWidth="2.4" />
      <path d="M150,104 L150,128" />
      {/* 底边 */}
      <path d="M150,128 L30,128" />
      {/* 左边：下段 + 电源符号 + 上段 */}
      <path d="M30,128 L30,112" />
      <line x1="22" y1="108" x2="38" y2="108" strokeWidth="1.1" />
      <line x1="25" y1="98" x2="35" y2="98" strokeWidth="2.6" />
      <path d="M30,94 L30,64" />
    </g>
    <text x="94" y="52" textAnchor="middle" fontFamily="var(--font-family-mono, monospace)" fontSize="8" fill="#b5492e">R</text>
    <text x="168" y="99" fontFamily="var(--font-family-mono, monospace)" fontSize="8" fill={INK}>C</text>
    <text x="12" y="106" fontFamily="var(--font-family-mono, monospace)" fontSize="8" fill={INK}>ε</text>
    <text x="41" y="95" fontFamily="var(--font-family-mono, monospace)" fontSize="7" fill={FAINT}>+</text>
    {/* 充放电曲线 */}
    <g>
      <rect x="186" y="52" width="118" height="88" rx="6" fill="#fffdf8" opacity="0.82" stroke="#d8d3c4" strokeWidth="0.8" />
      <line x1="200" y1="126" x2="292" y2="126" stroke={INK} strokeWidth="0.9" />
      <line x1="200" y1="126" x2="200" y2="62" stroke={INK} strokeWidth="0.9" />
      {/* 渐近线 */}
      <line x1="200" y1="76" x2="292" y2="76" stroke={FAINT} strokeWidth="0.8" strokeDasharray="3 3" />
      {/* 充电指数曲线 */}
      <path d="M200,126 C222,80 246,77 292,76.5" fill="none" stroke="#b5492e" strokeWidth="1.9" strokeLinecap="round" />
      {/* 放电曲线（虚） */}
      <path d="M200,76 C214,120 240,125 292,126" fill="none" stroke="#2b4c7e" strokeWidth="1.5" strokeDasharray="4 3" strokeLinecap="round" />
      {/* τ 标注 */}
      <line x1="216" y1="126" x2="216" y2="98" stroke={INK} strokeWidth="0.7" strokeDasharray="2 2" opacity="0.7" />
      <text x="214" y="136" fontFamily="var(--font-family-mono, monospace)" fontSize="7.5" fill={INK}>τ</text>
      <text x="280" y="70" fontFamily="var(--font-family-mono, monospace)" fontSize="6.8" fill="#656a5e">Vc</text>
    </g>
    <FormulaTag text="τ = RC · q = Cε(1−e^(−t/RC))" />
  </svg>;
}

/* ---------- 4. Fourier 频谱与 Gibbs 现象（数学） ---------- */

/** 真实的方波 Fourier 部分和曲线：t ∈ [0, 3π] 映射到 x ∈ [28, 232]，±1 映射到 y ∈ [74, 150]。 */
function fourierSquarePath(harmonics = 7, samples = 160): string {
  const parts: string[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = (i / samples) * 3 * Math.PI;
    let sum = 0;
    for (let k = 1; k <= harmonics; k++) sum += Math.sin((2 * k - 1) * t) / (2 * k - 1);
    sum *= 4 / Math.PI;
    const x = 28 + (t / (3 * Math.PI)) * 204;
    const y = 112 - sum * 38;
    parts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return parts.join(' ');
}

const FOURIER_APPROX = fourierSquarePath();

function FourierGibbsArt() {
  const pid = useId();
  return <svg {...artProps(pid)}>
    <PaperBase pid={pid} />
    {/* 方波目标框（虚线）：t=π/2π 处跳变，对应 x=96/164 */}
    <path d="M28,74 L96,74 L96,150 L164,150 L164,74 L232,74" fill="none" stroke={FAINT} strokeWidth="1.2" strokeDasharray="4 3.5" strokeLinejoin="round" />
    {/* 多阶正弦叠加曲线（真实 7 阶部分和，含 Gibbs 过冲） */}
    <path d={FOURIER_APPROX} fill="none" stroke="#2b4c7e" strokeWidth="1.9" strokeLinecap="round" />
    {/* Gibbs 过冲高亮（第一个跳变点前） */}
    <circle cx="90" cy="70" r="9" fill="none" stroke={CORAL} strokeWidth="1.4" opacity="0.85" />
    <circle cx="90" cy="70" r="2" fill={CORAL} />
    <text x="102" y="56" fontFamily="var(--font-family-mono, monospace)" fontSize="7" fill={CORAL}>Gibbs 过冲 ≈ 8.9%</text>
    {/* 频谱小柱状图（奇次谐波振幅 ∝ 1/k） */}
    <g>
      <rect x="238" y="96" width="66" height="58" rx="5" fill="#fffdf8" opacity="0.88" stroke="#d8d3c4" strokeWidth="0.8" />
      {[34, 11.3, 6.8, 4.9].map((h, i) => <rect key={i} x={248 + i * 13} y={142 - h} width="8" height={h} fill="#2b4c7e" opacity={0.92 - i * 0.16} rx="1" />)}
      <line x1="244" y1="142" x2="298" y2="142" stroke={INK} strokeWidth="0.8" />
      <text x="249" y="106" fontFamily="var(--font-family-mono, monospace)" fontSize="6" fill="#656a5e">1   3   5   7</text>
    </g>
    <FormulaTag text="4/π · Σ sin((2k−1)x)/(2k−1)" />
  </svg>;
}

/* ---------- 5. 特征值与动力学（数学） ---------- */
function EigenDynamicsArt() {
  const pid = useId();
  // 倾斜坐标网格（变换后）
  const skewLines = [];
  for (let i = -2; i <= 6; i++) {
    skewLines.push(<line key={'a' + i} x1={40 + i * 22} y1="160" x2={86 + i * 22} y2="40" stroke="#d8d3c4" strokeWidth="0.7" />);
    skewLines.push(<line key={'b' + i} x1={18 + i * 22} y1="122" x2={170 + i * 22} y2="78" stroke="#d8d3c4" strokeWidth="0.7" />);
  }
  return <svg {...artProps(pid)}>
    <PaperBase pid={pid} />
    <g>{skewLines}</g>
    {/* 轨线相图（双曲流线） */}
    <path d="M52,150 C70,118 92,106 128,100" fill="none" stroke={FAINT} strokeWidth="0.9" opacity="0.85" />
    <path d="M60,60 C88,78 110,86 150,92" fill="none" stroke={FAINT} strokeWidth="0.9" opacity="0.85" />
    <path d="M170,150 C152,124 142,112 128,100" fill="none" stroke={FAINT} strokeWidth="0.9" opacity="0.7" />
    {/* 特征向量箭头（λ>1 拉伸，朱砂） */}
    <g stroke="#b5492e" strokeWidth="2.6" strokeLinecap="round">
      <line x1="104" y1="112" x2="176" y2="70" />
      <line x1="176" y1="70" x2="165" y2="69" />
      <line x1="176" y1="70" x2="169" y2="78" />
    </g>
    <text x="180" y="66" fontFamily="var(--font-family-mono, monospace)" fontSize="8" fill="#b5492e">λ₁=2.1</text>
    {/* 特征向量箭头（λ<1 压缩，黛青） */}
    <g stroke="#2b4c7e" strokeWidth="2.2" strokeLinecap="round">
      <line x1="104" y1="112" x2="70" y2="88" />
      <line x1="70" y1="88" x2="79" y2="89.5" />
      <line x1="70" y1="88" x2="76" y2="96" />
    </g>
    <text x="38" y="82" fontFamily="var(--font-family-mono, monospace)" fontSize="8" fill="#2b4c7e">λ₂=0.4</text>
    <circle cx="104" cy="112" r="2.6" fill={INK} />
    {/* 原标准网格小插图（变换前） */}
    <g opacity="0.9">
      <rect x="224" y="52" width="76" height="76" rx="5" fill="#fffdf8" opacity="0.85" stroke="#d8d3c4" strokeWidth="0.8" />
      {[0, 1, 2, 3].map(i => <g key={i}>
        <line x1={232 + i * 20} y1="60" x2={232 + i * 20} y2="120" stroke="#d8d3c4" strokeWidth="0.7" />
        <line x1="232" y1={60 + i * 20} x2="292" y2={60 + i * 20} stroke="#d8d3c4" strokeWidth="0.7" />
      </g>)}
      <line x1="232" y1="120" x2="262" y2="90" stroke="#b5492e" strokeWidth="1.6" strokeLinecap="round" />
      <line x1="232" y1="120" x2="242" y2="100" stroke="#2b4c7e" strokeWidth="1.4" strokeLinecap="round" />
    </g>
    <FormulaTag text="Av = λv · ẋ = Ax" />
  </svg>;
}

/* ---------- 6. 优化器 · 四种地形赛跑（人工智能） ---------- */
function OptimizerRaceArt() {
  const pid = useId();
  // 等高线损失地形
  const rings = [
    { rx: 18, ry: 10 }, { rx: 34, ry: 19 }, { rx: 52, ry: 29 }, { rx: 72, ry: 40 }, { rx: 94, ry: 52 },
  ];
  return <svg {...artProps(pid)}>
    <PaperBase pid={pid} />
    <g transform="translate(196,128) rotate(-8)" fill="none" stroke="#c5c0b0" strokeWidth="1">
      {rings.map((r, i) => <ellipse key={i} cx="0" cy="0" rx={r.rx} ry={r.ry} opacity={1 - i * 0.13} />)}
    </g>
    {/* 最优点 */}
    <circle cx="196" cy="128" r="4.5" fill="none" stroke={CORAL} strokeWidth="1.6" />
    <circle cx="196" cy="128" r="1.4" fill={CORAL} />
    {/* SGD 锯齿轨迹（灰） */}
    <path d="M52,44 L76,58 L64,72 L96,82 L84,98 L118,104 L110,118 L140,122 L136,132"
      fill="none" stroke={FAINT} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    {/* Momentum 平滑过冲轨迹（青瓷） */}
    <path d="M60,38 C110,52 156,84 188,112 C204,126 208,136 196,134 C188,132 190,129 196,128"
      fill="none" stroke="#1e6f68" strokeWidth="1.6" strokeLinecap="round" />
    {/* Adam 直接收敛轨迹（靛紫粗） */}
    <path d="M48,60 C92,74 134,96 168,116 C182,124 190,127 195,128"
      fill="none" stroke="#55418c" strokeWidth="2.2" strokeLinecap="round" />
    {/* 起点 */}
    <circle cx="48" cy="48" r="3" fill={INK} />
    <text x="40" y="36" fontFamily="var(--font-family-mono, monospace)" fontSize="7" fill={INK}>θ₀</text>
    {/* 图例 */}
    <g fontFamily="var(--font-family-mono, monospace)" fontSize="6.8">
      <line x1="240" y1="52" x2="254" y2="52" stroke="#55418c" strokeWidth="2.2" /><text x="258" y="54.5" fill="#34372f">Adam</text>
      <line x1="240" y1="66" x2="254" y2="66" stroke="#1e6f68" strokeWidth="1.6" /><text x="258" y="68.5" fill="#34372f">Momentum</text>
      <line x1="240" y1="80" x2="254" y2="80" stroke={FAINT} strokeWidth="1.3" /><text x="258" y="82.5" fill="#34372f">SGD</text>
    </g>
    <FormulaTag text="θ ← θ − η∇L(θ)" />
  </svg>;
}

/* ---------- 7. 图算法沙盘（计算机 / 408） ---------- */
function GraphAlgoArt() {
  const pid = useId();
  const nodes: Record<string, [number, number]> = {
    A: [46, 100], B: [104, 56], C: [110, 140], D: [176, 84], E: [188, 154], F: [248, 104],
  };
  const edges: [string, string, number, boolean][] = [
    ['A', 'B', 4, true], ['A', 'C', 2, true], ['B', 'D', 3, true], ['C', 'D', 5, false],
    ['C', 'E', 6, false], ['D', 'F', 2, true], ['E', 'F', 3, false], ['B', 'C', 1, false],
  ];
  return <svg {...artProps(pid)}>
    <PaperBase pid={pid} />
    {/* 边 */}
    {edges.map(([u, v, w, onPath]) => {
      const [x1, y1] = nodes[u]!, [x2, y2] = nodes[v]!;
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      return <g key={u + v}>
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={onPath ? '#1e6f68' : FAINT} strokeWidth={onPath ? 2.4 : 1.1}
          strokeLinecap="round" opacity={onPath ? 1 : 0.65} />
        <rect x={mx - 6.5} y={my - 5.5} width="13" height="11" rx="5.5" fill="#fffdf8" opacity="0.9" />
        <text x={mx} y={my + 2.8} textAnchor="middle" fontFamily="var(--font-family-mono, monospace)" fontSize="6.8"
          fill={onPath ? '#1e6f68' : '#656a5e'}>{w}</text>
      </g>;
    })}
    {/* 节点 */}
    {Object.entries(nodes).map(([name, [x, y]]) => {
      const onPath = name !== 'E';
      return <g key={name}>
        <circle cx={x} cy={y} r="11" fill="#fffdf8" stroke={onPath ? '#1e6f68' : FAINT} strokeWidth={onPath ? 2 : 1.2} />
        <text x={x} y={y + 3.4} textAnchor="middle" fontFamily="var(--font-family-mono, monospace)" fontSize="9"
          fontWeight="600" fill={onPath ? '#1e6f68' : INK}>{name}</text>
      </g>;
    })}
    {/* 起点/终点标记 */}
    <text x="46" y="82" textAnchor="middle" fontFamily="var(--font-family-mono, monospace)" fontSize="6.4" fill={FAINT}>src</text>
    <text x="248" y="86" textAnchor="middle" fontFamily="var(--font-family-mono, monospace)" fontSize="6.4" fill={CORAL}>sink</text>
    {/* 访问队列微标 */}
    <g>
      <rect x="216" y="140" width="88" height="30" rx="5" fill="#fffdf8" opacity="0.9" stroke="#d8d3c4" strokeWidth="0.8" />
      <text x="224" y="152" fontFamily="var(--font-family-mono, monospace)" fontSize="6.2" fill="#656a5e">queue</text>
      {['A', 'C', 'B', 'D'].map((n, i) => <g key={n}>
        <rect x={224 + i * 18} y={156} width="14" height="10" rx="2" fill="none" stroke="#1e6f68" strokeWidth="0.8" />
        <text x={231 + i * 18} y="163.6" textAnchor="middle" fontFamily="var(--font-family-mono, monospace)" fontSize="6.4" fill="#1e6f68">{n}</text>
      </g>)}
    </g>
    <FormulaTag text="dist[v] ← min(dist[v], dist[u]+w)" />
  </svg>;
}

/* ---------- 8. 盈亏平衡沙盘（经管商科） ---------- */
function BreakevenArt() {
  const pid = useId();
  return <svg {...artProps(pid)}>
    <PaperBase pid={pid} />
    {/* 盈亏平衡阴影区域 */}
    <path d="M150,98 L262,30 L262,150 L150,98" fill="#9a6324" opacity="0.10" />
    <path d="M56,150 L150,98 L150,154 L56,154 Z" fill="#b42318" opacity="0.06" />
    {/* 坐标轴 */}
    <line x1="46" y1="154" x2="280" y2="154" stroke={INK} strokeWidth="1.1" />
    <line x1="46" y1="154" x2="46" y2="30" stroke={INK} strokeWidth="1.1" />
    <text x="272" y="166" fontFamily="var(--font-family-mono, monospace)" fontSize="7" fill="#656a5e">q</text>
    <text x="38" y="36" fontFamily="var(--font-family-mono, monospace)" fontSize="7" fill="#656a5e">¥</text>
    {/* 固定成本截距 */}
    <line x1="46" y1="126" x2="262" y2="62" stroke="#b5492e" strokeWidth="1.9" strokeLinecap="round" />
    <text x="216" y="88" fontFamily="var(--font-family-mono, monospace)" fontSize="7.4" fill="#b5492e">TC = F + c·q</text>
    {/* 收入线 */}
    <line x1="46" y1="154" x2="262" y2="34" stroke="#1e6f68" strokeWidth="2" strokeLinecap="round" />
    <text x="222" y="48" fontFamily="var(--font-family-mono, monospace)" fontSize="7.4" fill="#1e6f68">R = p·q</text>
    {/* 固定成本标注 */}
    <line x1="46" y1="126" x2="58" y2="126" stroke={INK} strokeWidth="0.8" strokeDasharray="2 2" />
    <text x="30" y="129" fontFamily="var(--font-family-mono, monospace)" fontSize="7" fill={INK}>F</text>
    {/* 盈亏平衡点 */}
    <circle cx="150" cy="98" r="3.4" fill={CORAL} />
    <circle cx="150" cy="98" r="7.5" fill="none" stroke={CORAL} strokeWidth="1.1" opacity="0.7" />
    <line x1="150" y1="98" x2="150" y2="154" stroke={CORAL} strokeWidth="0.9" strokeDasharray="3 2.6" />
    <line x1="150" y1="98" x2="46" y2="98" stroke={CORAL} strokeWidth="0.9" strokeDasharray="3 2.6" />
    <text x="146" y="166" textAnchor="middle" fontFamily="var(--font-family-mono, monospace)" fontSize="7" fill={CORAL}>q*</text>
    <text x="154" y="90" fontFamily="var(--font-family-mono, monospace)" fontSize="7" fill={CORAL}>盈亏平衡</text>
    {/* 盈利区标注 */}
    <text x="232" y="128" fontFamily="var(--font-family-mono, monospace)" fontSize="7" fill="#9a6324" opacity="0.95">利润区 π&gt;0</text>
    <FormulaTag text="π = (p−c)·q − F" />
  </svg>;
}

const OFFICIAL_ART: Record<string, () => JSX.Element> = {
  'projectile-drag': ProjectileDragArt,
  'charged-particle': ChargedParticleArt,
  'rc-circuit': RcCircuitArt,
  'fourier-gibbs': FourierGibbsArt,
  'la05-eigen-dynamics': EigenDynamicsArt,
  dlOptimizer: OptimizerRaceArt,
  graphAlgo: GraphAlgoArt,
  'biz-breakeven': BreakevenArt,
};

/* ---------- 层 2：用户画布的自动精排可视化拓扑封面 ---------- */

const KIND_THEME: Record<CoverTopology['nodes'][number]['kind'], { accent: string; soft: string; badge: string }> = {
  control: { accent: '#2b4c7e', soft: '#edf2fa', badge: '参数' },
  stage: { accent: '#1e6f68', soft: '#e9f5f3', badge: '计算' },
  plot: { accent: '#b5492e', soft: '#fdf0eb', badge: '视图' },
  note: { accent: '#8a7356', soft: '#f6f1e6', badge: '注记' },
};

/** 把后端旧记录里可能残留的截断英文节点类型名自动映射成优雅中文名。 */
const FRIENDLY_TYPE_PREFIXES: readonly [string, string][] = [
  ['functionpl', '函数图像'],
  ['functionsour', '函数源'],
  ['func2dsour', '二元函数'],
  ['vectorfield', '向量场源'],
  ['matrixsour', '矩阵源'],
  ['matrixheat', '矩阵热图'],
  ['transformv', '变换视图'],
  ['fieldview', '向量场'],
  ['trailview', '轨迹仪'],
  ['energymete', '能量表'],
  ['boundaryvi', '决策边界'],
  ['gradflowme', '梯度探针'],
  ['doubleinte', '二重积分'],
  ['gradientco', '梯度等高'],
  ['odeslopefi', '斜率场'],
  ['fourierlab', '傅里叶'],
  ['derivative', '导数计算'],
  ['integral', '定积分'],
  ['limitprobe', '极限探针'],
  ['taylor', '泰勒展开'],
  ['ftcview', '微积分基本'],
  ['projectile', '抛体实验'],
  ['springosc', '弹簧振子'],
  ['pendulum', '单摆实验'],
  ['inclinelab', '斜面力学'],
  ['collisionl', '碰撞守恒'],
  ['mlptrainer', 'MLP 训练'],
  ['dataset2ds', '二维点云'],
  ['pixelgrids', '像素画板'],
  ['tokenseqso', '词元序列'],
  ['conv2dop', '卷积算子'],
  ['attentiono', '注意力'],
  ['attentiona', '注意力对照'],
  ['activation', '激活函数'],
  ['optimizera', '优化器'],
  ['deeppanora', '深度沙盘'],
  ['deepstage', '深度学习'],
  ['physicssta', '物理实验'],
  ['calculusst', '高数沙盘'],
  ['lab408stag', '408 沙盘'],
  ['businessst', '决策沙盘'],
  ['universal', '交互舞台'],
  ['airulebloc', 'AI 规则'],
  ['slider', '参数滑杆'],
  ['ticker', '时间轴'],
  ['detgauge', '行列式'],
  ['eigread', '特征值'],
  ['squareview', '面积变换'],
  ['matmul', '矩阵乘法'],
  ['rotor', '旋转矩阵'],
  ['spark', '波形记录'],
  ['quiz', '预测闸门'],
  ['textnote', '探究便签'],
  ['latexnote', '公式卡片'],
  ['composite', '复合积木'],
];

function formatNodeLabel(rawLabel: string, kind: CoverTopology['nodes'][number]['kind']): { title: string; subtitle?: string } {
  const clean = rawLabel.trim();
  const lower = clean.toLowerCase();
  for (const [prefix, zh] of FRIENDLY_TYPE_PREFIXES) {
    if (lower.startsWith(prefix)) return { title: zh };
  }
  // 像 a*x^2+b*x+ 这类数学表达式：作为副标题优雅呈现，主标题给清晰角色名
  if (/[*^+=/]/.test(clean) && !/[\u4e00-\u9fa5]/.test(clean)) {
    const pretty = clean.replace(/\*/g, '·').replace(/\^2/g, '²').replace(/\^3/g, '³').replace(/[+\-·]$/, '');
    return {
      title: kind === 'control' ? '函数表达式' : '数学公式',
      subtitle: pretty.slice(0, 12),
    };
  }
  return { title: clean.slice(0, 8) || KIND_THEME[kind].badge };
}

/** 节点内部微型可视化预览：让用户画布封面像设计师手绘的精密仪表图。 */
function NodeMiniVisual({
  kind,
  x,
  y,
  w,
  h,
  accent,
  subtitle,
  seed,
}: {
  kind: CoverTopology['nodes'][number]['kind'];
  x: number;
  y: number;
  w: number;
  h: number;
  accent: string;
  subtitle?: string;
  seed: number;
}) {
  if (kind === 'control') {
    if (subtitle) {
      return <g>
        <rect x={x} y={y + 1} width={w} height={h - 2} rx="3.5" fill={accent} fillOpacity="0.08" />
        <text x={x + w / 2} y={y + h * 0.68} textAnchor="middle"
          fontFamily="var(--font-family-mono, ui-monospace, monospace)" fontSize="7.4" fontWeight="600" fill={accent}>
          {subtitle}
        </text>
      </g>;
    }
    const ratio = 0.35 + ((seed * 29) % 45) / 100;
    const midY = y + h / 2;
    const fillW = Math.max(8, w * ratio);
    return <g>
      <rect x={x} y={midY - 2} width={w} height="4" rx="2" fill="#e6e0d2" />
      <rect x={x} y={midY - 2} width={fillW} height="4" rx="2" fill={accent} opacity="0.82" />
      <circle cx={x + fillW} cy={midY} r="3.6" fill="#fffdf8" stroke={accent} strokeWidth="1.5" />
    </g>;
  }

  if (kind === 'plot') {
    const baseY = y + h - 3;
    const midX = x + w / 2;
    const curve = seed % 2 === 0
      ? `M${x + 4},${baseY - 3} Q${midX},${y + 1} ${x + w - 4},${baseY - 2}`
      : `M${x + 4},${y + h * 0.62} C${x + w * 0.32},${y + 1} ${x + w * 0.68},${baseY} ${x + w - 4},${y + h * 0.32}`;
    return <g>
      <rect x={x} y={y} width={w} height={h} rx="4" fill="#faf7ef" stroke="#e4dfd1" strokeWidth="0.6" />
      <line x1={x + 4} y1={baseY - 2} x2={x + w - 4} y2={baseY - 2} stroke="#cbc5b5" strokeWidth="0.6" />
      <line x1={midX} y1={y + 3} x2={midX} y2={baseY} stroke="#cbc5b5" strokeWidth="0.6" strokeDasharray="1.6 1.6" />
      <path d={`${curve} L${x + w - 4},${baseY - 2} L${x + 4},${baseY - 2} Z`} fill={accent} opacity="0.11" />
      <path d={curve} fill="none" stroke={accent} strokeWidth="1.6" strokeLinecap="round" />
      <circle cx={midX} cy={seed % 2 === 0 ? y + h * 0.34 : y + h * 0.48} r="2" fill={accent} />
    </g>;
  }

  if (kind === 'stage') {
    const bars = [0.46, 0.84, 0.64, 0.92, 0.56];
    const gap = 3.5;
    const bw = Math.max(4, (w - 8 - gap * (bars.length - 1)) / bars.length);
    return <g>
      <rect x={x} y={y} width={w} height={h} rx="4" fill="#faf7ef" stroke="#e4dfd1" strokeWidth="0.6" />
      {bars.map((r, idx) => {
        const bh = Math.max(4, (h - 7) * r);
        return <rect key={idx} x={x + 4 + idx * (bw + gap)} y={y + h - 3.5 - bh} width={bw} height={bh}
          rx="1.5" fill={accent} opacity={0.45 + idx * 0.11} />;
      })}
    </g>;
  }

  return <g>
    <line x1={x + 2} y1={y + h * 0.34} x2={x + w - 8} y2={y + h * 0.34} stroke="#cbc5b5" strokeWidth="1.4" strokeLinecap="round" />
    <line x1={x + 2} y1={y + h * 0.72} x2={x + w * 0.62} y2={y + h * 0.72} stroke="#dad4c5" strokeWidth="1.4" strokeLinecap="round" />
  </g>;
}

/**
 * 创作者画布自动精排封面：
 * - 统一 320×200（16:10）画幅，严格留出右上角计数胶囊与左下角学科胶囊的安全边距；
 * - 节点较少（≤ 6）时自动升级为精致微仪表卡片（含迷你滑杆、函数曲线、柱状指标）；
 * - 节点较多（7–18）时平滑切换为紧凑流线卡片，保证清晰不重叠。
 */
export function MiniTopologyCover({ topology, subject = 'general' }: { topology: CoverTopology; subject?: Subject }) {
  const pid = useId();
  const accent = SUBJECT_COLORS[subject] ?? SUBJECT_COLORS.general;
  const rawNodes = topology.nodes.slice(0, 18);
  const rich = rawNodes.length <= 6;

  // 安全区内重新归一化坐标：避开顶部 34px（右上计数胶囊）和底部 38px（左下学科胶囊）
  const xs = rawNodes.map((n) => n.x);
  const ys = rawNodes.map((n) => n.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const spanX = maxX - minX;
  const spanY = maxY - minY;

  const padLeft = rich ? 68 : 42;
  const padRight = rich ? 252 : 278;
  const padTop = rich ? 62 : 46;
  const padBottom = rich ? 140 : 152;

  const nodes = rawNodes.map((node, idx) => {
    const formatted = formatNodeLabel(node.label, node.kind);
    const w = rich
      ? (node.kind === 'plot' ? 100 : 88)
      : Math.min(72, Math.max(40, formatted.title.length * 7.8 + 18));
    const h = rich
      ? (node.kind === 'plot' ? 50 : 38)
      : 20;
    const sx = spanX < 1e-3
      ? 160
      : padLeft + ((node.x - minX) / spanX) * (padRight - padLeft);
    const sy = spanY < 1e-3
      ? 100
      : padTop + ((node.y - minY) / spanY) * (padBottom - padTop);
    return {
      ...node,
      ...formatted,
      idx,
      w,
      h,
      sx: Math.min(308 - w / 2, Math.max(12 + w / 2, sx)),
      sy: Math.min(162 - h / 2, Math.max(30 + h / 2, sy)),
    };
  });

  const wires = topology.wires.filter((wire) => nodes[wire.f] && nodes[wire.t]);

  return <svg viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id={`${pid}-bg`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#fdfbf4" />
        <stop offset="100%" stopColor="#f3ede0" />
      </linearGradient>
      <radialGradient id={`${pid}-glow`} cx="82%" cy="24%" r="58%">
        <stop offset="0%" stopColor={accent} stopOpacity="0.11" />
        <stop offset="100%" stopColor={accent} stopOpacity="0" />
      </radialGradient>
      <radialGradient id={`${pid}-glow2`} cx="18%" cy="84%" r="52%">
        <stop offset="0%" stopColor="#b5492e" stopOpacity="0.06" />
        <stop offset="100%" stopColor="#b5492e" stopOpacity="0" />
      </radialGradient>
      <pattern id={`${pid}-dots`} width="14" height="14" patternUnits="userSpaceOnUse">
        <circle cx="1.6" cy="1.6" r="0.7" fill="#1b1f1c" opacity="0.11" />
      </pattern>
      <filter id={`${pid}-shadow`} x="-25%" y="-25%" width="150%" height="165%">
        <feDropShadow dx="0" dy="2.5" stdDeviation="3" floodColor="#1c160a" floodOpacity="0.10" />
      </filter>
    </defs>

    {/* 暖纸基底 + 学科氛围光晕 + 点阵 + 淡背景波形 */}
    <rect width="320" height="200" fill={`url(#${pid}-bg)`} />
    <rect width="320" height="200" fill={`url(#${pid}-glow)`} />
    <rect width="320" height="200" fill={`url(#${pid}-glow2)`} />
    <rect width="320" height="200" fill={`url(#${pid}-dots)`} />
    <path d="M-10,152 Q76,118 164,142 T330,116" fill="none" stroke={accent} strokeWidth="1.2" opacity="0.09" />
    <path d="M-10,164 Q88,134 176,154 T330,132" fill="none" stroke={accent} strokeWidth="0.9" strokeDasharray="4 5" opacity="0.07" />

    {/* 柔和连线：底光晕 + 主曲线 + 流向微点 */}
    <g fill="none" strokeLinecap="round">
      {wires.map((wire, i) => {
        const a = nodes[wire.f]!, b = nodes[wire.t]!;
        const forward = b.sx >= a.sx;
        const x1 = forward ? a.sx + a.w / 2 : a.sx - a.w / 2;
        const y1 = a.sy;
        const x2 = forward ? b.sx - b.w / 2 : b.sx + b.w / 2;
        const y2 = b.sy;
        const dx = Math.max(24, Math.abs(x2 - x1) * 0.46) * (forward ? 1 : -1);
        const path = `M${x1.toFixed(1)},${y1.toFixed(1)} C${(x1 + dx).toFixed(1)},${y1.toFixed(1)} ${(x2 - dx).toFixed(1)},${y2.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`;
        const wireColor = (KIND_THEME[a.kind] ?? KIND_THEME.stage).accent;
        // 三次贝塞尔 t=0.5 中点坐标，用于放一颗流向微圆点
        const mx = 0.125 * x1 + 0.375 * (x1 + dx) + 0.375 * (x2 - dx) + 0.125 * x2;
        const my = 0.5 * y1 + 0.5 * y2;
        return <g key={i}>
          <path d={path} stroke={wireColor} strokeWidth="4.2" opacity="0.09" />
          <path className="topology-wire" d={path} stroke={wireColor} strokeWidth="1.55" opacity="0.58" />
          <circle cx={mx} cy={my} r="2.2" fill="#fffdf8" stroke={wireColor} strokeWidth="1.2" opacity="0.85" />
        </g>;
      })}
    </g>

    {/* 精致微仪表节点卡片 */}
    {nodes.map((node) => {
      const x = node.sx - node.w / 2;
      const y = node.sy - node.h / 2;
      const theme = KIND_THEME[node.kind] ?? KIND_THEME.stage;
      return <g key={node.idx} filter={`url(#${pid}-shadow)`}>
        <rect x={x} y={y} width={node.w} height={node.h} rx={rich ? 7.5 : 5} fill="#fffdf9" stroke="#ddd7c8" strokeWidth="0.9" />
        {/* 顶栏微色条 */}
        <path
          d={`M${x + (rich ? 7.5 : 5)},${y} L${x + node.w - (rich ? 7.5 : 5)},${y} Q${x + node.w},${y} ${x + node.w},${y + 3.2} L${x},${y + 3.2} Q${x},${y} ${x + (rich ? 7.5 : 5)},${y} Z`}
          fill={theme.accent}
          opacity="0.86"
        />
        {rich ? <>
          {/* 精致头部：色点 + 中文标题 */}
          <circle cx={x + 9.5} cy={y + 11.5} r="2.4" fill={theme.accent} />
          <text x={x + 15.5} y={y + 14} fontFamily="var(--font-family-sans, sans-serif)" fontSize="7.6" fontWeight="650" fill="#232925">
            {node.title}
          </text>
          {/* 内部微型可视化区 */}
          <NodeMiniVisual
            kind={node.kind}
            x={x + 7}
            y={y + 19}
            w={node.w - 14}
            h={node.h - 24}
            accent={theme.accent}
            subtitle={node.subtitle}
            seed={node.idx + 1}
          />
        </> : <>
          <circle cx={x + 7} cy={y + 11.6} r="1.9" fill={theme.accent} />
          <text x={x + 12} y={y + 14} fontFamily="var(--font-family-sans, sans-serif)" fontSize="6.6" fontWeight="600" fill="#232925">
            {node.title}
          </text>
        </>}
        {/* 左右端口圆点 */}
        <circle cx={x} cy={node.sy} r={rich ? 2.4 : 1.7} fill="#fffdf9" stroke={theme.accent} strokeWidth="1.2" />
        <circle cx={x + node.w} cy={node.sy} r={rich ? 2.4 : 1.7} fill="#fffdf9" stroke={theme.accent} strokeWidth="1.2" />
      </g>;
    })}
  </svg>;
}

/* ---------- 回退：精致点阵几何骨架图 ---------- */
function SkeletonArt({ subject }: { subject: Subject }) {
  const pid = useId();
  const color = SUBJECT_COLORS[subject] ?? SUBJECT_COLORS.general;
  return <svg {...artProps(pid)}>
    <PaperBase pid={pid} />
    <g fill="none" stroke={color} strokeLinecap="round" opacity="0.55">
      <circle cx="112" cy="102" r="46" strokeWidth="1.1" strokeDasharray="1.5 4" />
      <path d="M66,102 L158,102 M112,56 L112,148" strokeWidth="0.8" opacity="0.6" />
      <path d="M66,148 L112,56 L158,148 Z" strokeWidth="1.2" />
      <path d="M40,170 C80,150 130,186 170,164 C210,142 240,168 280,150" strokeWidth="1.3" />
    </g>
    <circle cx="112" cy="56" r="2.4" fill={color} opacity="0.8" />
    <circle cx="66" cy="148" r="2" fill={CORAL} opacity="0.75" />
    <circle cx="158" cy="148" r="2" fill={CORAL} opacity="0.75" />
    <g stroke={FAINT} strokeWidth="0.9" opacity="0.8">
      <line x1="212" y1="60" x2="280" y2="60" strokeDasharray="2.5 3.5" />
      <line x1="212" y1="88" x2="266" y2="88" strokeDasharray="2.5 3.5" />
      <line x1="212" y1="74" x2="292" y2="74" />
    </g>
  </svg>;
}

/**
 * 广场卡封面入口：官方模板插画 → 用户拓扑缩略图 → 骨架兜底。
 */
export function PlazaCoverArt({ item }: { item: PlazaItem }) {
  const template = item.cover.preview_template;
  if (template && OFFICIAL_ART[template]) {
    const Art = OFFICIAL_ART[template];
    return <Art />;
  }
  if (item.cover.topology?.nodes?.length) {
    return <MiniTopologyCover topology={item.cover.topology} subject={item.subject} />;
  }
  return <SkeletonArt subject={item.subject} />;
}
