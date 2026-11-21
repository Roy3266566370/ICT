/**
 * WorkshopPage.tsx —— 万象工坊（/workshop）
 *
 * 工坊门面：我的作品（已存画布）+ 公开画廊（已发布作品，可 fork）。
 * "从模板新建"提供七个高数实验及三个力学场景——
 * 模板在客户端组装 CanvasDoc 后经 worksApi 建档，打开即玩即改。
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { SiteNav } from '@/components/home/SiteNav';
import { worksApi, type ShareSummary, type WorkSummary } from '@/api/works';
import { nextId } from '@/canvas/math.ts';
import type { CanvasDoc } from '@/canvas/types.ts';
import { CALCULUS_TEMPLATES, calculusTemplateDoc, type CalculusTemplateKind } from '@/canvas/calculusTemplates';
import {
  LAB408_TEMPLATES,
  LAB408_WORKBENCH_TEMPLATES,
  isLab408Kind,
  isLab408WorkbenchKind,
  lab408TemplateDoc,
  type Lab408TemplateKind,
} from '@/canvas/lab408Templates';
import {
  DEEP_TEMPLATES,
  DEEP_TOPICS,
  deepTemplateDoc,
  isDeepTemplateKind,
  type DeepTemplate,
  type DeepTemplateKind,
} from '@/canvas/deepTemplates';
import styles from './WorkshopPage.module.css';

/* ---------- 模板：客户端组装 CanvasDoc ---------- */

function makeNode(type: string, x: number, y: number, params: Record<string, number> = {}, text?: string) {
  return { id: nextId('n'), type, x, y, params, ...(text !== undefined ? { text } : {}) } as CanvasDoc['nodes'][number];
}

function templateDoc(kind: TemplateKind): CanvasDoc {
  if (isDeepTemplateKind(kind)) return deepTemplateDoc(kind);
  if (isLab408Kind(kind) || isLab408WorkbenchKind(kind)) return lab408TemplateDoc(kind);
  if (kind !== 'projectile' && kind !== 'spring' && kind !== 'pendulum') return calculusTemplateDoc(kind);
  if (kind === 'projectile') {
    const P = nextId('n');
    const trail = nextId('n');
    const energy = nextId('n');
    const spark = nextId('n');
    return {
      version: 1, title: '抛体实验', zoom: 1, strokes: [],
      nodes: [
        makeNode('textNote', 60, 30, {}, '探究：固定 v0，只调角度——什么角度射得最远？\n（提示：看轨迹仪的形状，再想想 sin2θ）'),
        { ...makeNode('projectile', 60, 220, { v0: 10, angle: 45, g: 9.8, m: 1, running: 1 }), id: P },
        { ...makeNode('trailView', 360, 200), id: trail },
        { ...makeNode('energyMeter', 620, 200), id: energy },
        { ...makeNode('spark', 620, 400), id: spark },
      ],
      wires: [
        { id: nextId('w'), from: P, to: trail },
        { id: nextId('w'), from: P, to: energy },
        { id: nextId('w'), from: P, to: spark },
      ],
    };
  }
  const srcType = kind === 'spring' ? 'springOsc' : 'pendulum';
  const src = nextId('n');
  const trail = nextId('n');
  const energy = nextId('n');
  const spark = nextId('n');
  const title = kind === 'spring' ? '弹簧·能量守恒' : '单摆·周期的秘密';
  const note = kind === 'spring'
    ? '探究：k 或 m 改变时，周期怎么变？\n能量表上总能量那条杠为什么不动？'
    : '探究：只调摆长 L，周期变多少？\nθ0 从 5° 调到 60°，周期真的不变吗（小角近似）？';
  return {
    version: 1, title, zoom: 1, strokes: [],
    nodes: [
      makeNode('textNote', 60, 30, {}, note),
      { ...makeNode(srcType, 60, 220, kind === 'spring' ? { k: 6, m: 1, x0: 1, running: 1 } : { L: 1.5, theta0: 25, g: 9.8, m: 1, running: 1 }), id: src },
      { ...makeNode('trailView', 360, 200), id: trail },
      { ...makeNode('energyMeter', 620, 200), id: energy },
      { ...makeNode('spark', 620, 400), id: spark },
    ],
    wires: [
      { id: nextId('w'), from: src, to: trail },
      { id: nextId('w'), from: src, to: energy },
      { id: nextId('w'), from: src, to: spark },
    ],
  };
}

type MechanicsKind = 'projectile' | 'spring' | 'pendulum';
type TemplateKind = MechanicsKind | CalculusTemplateKind | Lab408TemplateKind | DeepTemplateKind;
type TemplateCategory = 'calculus' | 'mechanics' | 'lab408' | 'deep' | 'all';

const TEMPLATES: readonly { kind: MechanicsKind; name: string; desc: string; tag: string }[] = [
  { kind: 'projectile', name: '抛体实验', desc: 'v0 / 角度 / g → 轨迹、能量、速率曲线', tag: '力学 · 抛体' },
  { kind: 'spring', name: '弹簧·能量守恒', desc: 'k / m / 振幅 → 动能⇌势能实时交换', tag: '力学 · 振动' },
  { kind: 'pendulum', name: '单摆·周期', desc: '摆长 / 摆角 / g → T=2π√(L/g) 验证', tag: '力学 · 单摆' },
];

const LAB408_TEMPLATE_COUNT = LAB408_TEMPLATES.length + LAB408_WORKBENCH_TEMPLATES.length;

/* ---------- 模板缩略图：用与画布一致的纸张与节点语言 ---------- */

function MiniMeter({ x, y }: { x: number; y: number }): JSX.Element {
  return (
    <g>
      <rect x={x} y={y} width={44} height={62} rx={5} fill="var(--paper-0)" stroke="var(--hairline)" />
      <text x={x + 22} y={y + 14} textAnchor="middle" fontSize="7" fill="var(--ink-400)">能量</text>
      <rect x={x + 9} y={y + 21} width={8} height={29} rx={2} fill="var(--color-coral)" opacity=".72" />
      <rect x={x + 21} y={y + 35} width={8} height={15} rx={2} fill="var(--ink-300)" opacity=".5" />
      <text x={x + 22} y={y + 57} textAnchor="middle" fontSize="6" fill="var(--ink-300)">KE·PE</text>
    </g>
  );
}

function ProjectilePreview(): JSX.Element {
  return (
    <svg viewBox="0 0 260 140" aria-hidden="true" focusable="false">
      <line x1="20" y1="116" x2="240" y2="116" stroke="var(--hairline-strong)" />
      <path d="M36 112 Q90 18 190 112" fill="none" stroke="var(--color-coral)" strokeWidth="1.6" strokeDasharray="3 4" strokeLinecap="round" />
      <path d="M26 112 40 94" stroke="var(--ink-700)" strokeWidth="2" strokeLinecap="round" />
      <path d="M40 94 44 102 36 99Z" fill="var(--ink-700)" />
      <circle cx="26" cy="112" r="2.4" fill="var(--ink-700)" />
      <circle cx="101.5" cy="66" r="3.4" fill="var(--color-coral)" />
      <line x1="26" y1="112" x2="54" y2="78" stroke="var(--hairline-strong)" strokeDasharray="2 3" />
      <MiniMeter x={196} y={50} />
      <text x="58" y="74" fontSize="7" fill="var(--ink-300)" fontFamily="var(--font-family-mono)">θ · v₀</text>
    </svg>
  );
}

function SpringPreview(): JSX.Element {
  return (
    <svg viewBox="0 0 260 140" aria-hidden="true" focusable="false">
      <line x1="52" y1="26" x2="188" y2="26" stroke="var(--ink-400)" strokeWidth="1.4" />
      {[64, 84, 104, 124, 144, 164].map((x) => (
        <line key={x} x1={x} y1="20" x2={x - 5} y2="32" stroke="var(--hairline-strong)" />
      ))}
      <path d="M112 27 124 32 100 40 124 48 100 56 124 64 112 69" fill="none" stroke="var(--ink-500)" strokeWidth="1.6" strokeLinejoin="round" />
      <rect x="92" y="69" width="40" height="18" rx="3" fill="var(--paper-0)" stroke="var(--hairline-strong)" />
      <text x="112" y="81" textAnchor="middle" fontSize="7.5" fill="var(--ink-500)">m</text>
      <line x1="58" y1="98" x2="178" y2="98" stroke="var(--hairline-strong)" strokeDasharray="3 4" />
      <line x1="112" y1="87" x2="112" y2="98" stroke="var(--ink-400)" strokeDasharray="2 2" />
      <text x="66" y="108" fontSize="7" fill="var(--ink-300)" fontFamily="var(--font-family-mono)">x = 0</text>
      <text x="136" y="44" fontSize="7" fill="var(--ink-300)" fontFamily="var(--font-family-mono)">k</text>
      <MiniMeter x={196} y={50} />
    </svg>
  );
}

function PendulumPreview(): JSX.Element {
  return (
    <svg viewBox="0 0 260 140" aria-hidden="true" focusable="false">
      <line x1="66" y1="24" x2="174" y2="24" stroke="var(--ink-400)" strokeWidth="1.4" />
      {[82, 102, 122, 142, 162].map((x) => (
        <line key={x} x1={x} y1="18" x2={x - 5} y2="30" stroke="var(--hairline-strong)" />
      ))}
      <circle cx="120" cy="24" r="2.6" fill="var(--ink-700)" />
      <path d="M54 70 Q120 126 186 70" fill="none" stroke="var(--hairline-strong)" strokeDasharray="3 4" />
      <line x1="120" y1="24" x2="120" y2="104" stroke="var(--hairline-strong)" strokeDasharray="2 3" />
      <line x1="120" y1="24" x2="78" y2="86" stroke="var(--ink-700)" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="78" cy="86" r="7" fill="var(--color-coral)" opacity=".82" stroke="var(--paper-0)" strokeWidth="1.5" />
      <path d="M120 48 A24 24 0 0 0 101 42" fill="none" stroke="var(--color-coral)" strokeWidth="1.2" />
      <text x="106" y="58" fontSize="7" fill="var(--color-coral-ink)" fontFamily="var(--font-family-mono)">θ0</text>
      <text x="150" y="120" fontSize="7.5" fill="var(--ink-300)" fontFamily="var(--font-family-mono)">T = 2π√(L/g)</text>
    </svg>
  );
}

function BlankPreview(): JSX.Element {
  return (
    <svg viewBox="0 0 260 140" aria-hidden="true" focusable="false">
      <rect x="78" y="28" width="104" height="64" rx="9" fill="rgba(255,255,255,.6)" stroke="var(--hairline-strong)" strokeDasharray="5 5" />
      <path d="M130 50v20M120 60h20" stroke="var(--ink-300)" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="102" cy="116" r="5" fill="var(--color-coral)" opacity=".8" />
      <rect x="118" y="111" width="10" height="10" rx="2" fill="var(--ink-400)" />
      <circle cx="142" cy="116" r="5" fill="none" stroke="var(--hairline-strong)" strokeWidth="1.6" />
      <line x1="158" y1="116" x2="168" y2="116" stroke="var(--hairline-strong)" strokeDasharray="2 3" />
      <circle cx="172" cy="116" r="2" fill="var(--color-coral)" />
    </svg>
  );
}

const PREVIEWS: Record<MechanicsKind, () => JSX.Element> = {
  projectile: ProjectilePreview,
  spring: SpringPreview,
  pendulum: PendulumPreview,
};

function DeepPreview({ template }: { template: DeepTemplate }): JSX.Element {
  if (template.preview === 'attention') {
    return <svg viewBox="0 0 260 140" aria-hidden="true" focusable="false">
      {[0, 1, 2, 3].map(i => <g key={i}>{[0, 1, 2, 3].map(j => <rect key={j} x={48 + j * 38} y={24 + i * 24} width="34" height="20" rx="3" fill="var(--color-indigo)" fillOpacity={0.08 + ((i + j) % 4) * 0.12} stroke="var(--hairline)" />)}</g>)}
      <path d="M65 125Q130 96 195 125" fill="none" stroke="var(--color-coral)" strokeWidth="1.6" />
      <text x="130" y="138" textAnchor="middle" fontSize="8" fill="var(--ink-300)" fontFamily="var(--font-family-mono)">QKᵀ / √dₖ · softmax</text>
    </svg>;
  }
  if (template.preview === 'generative') {
    return <svg viewBox="0 0 260 140" aria-hidden="true" focusable="false">
      {Array.from({ length: 26 }, (_, i) => <circle key={i} cx={54 + (i * 53) % 158} cy={40 + (i * 37) % 66} r={2 + (i % 3) * 0.8} fill={i % 4 === 0 ? 'var(--color-coral)' : 'var(--color-indigo)'} opacity=".58" />)}
      {[0, 1, 2, 3].map(i => <path key={i} d={`M${70 + i * 34} 105q12 -26 ${26 + i * 4} -34`} fill="none" stroke="var(--color-coral)" strokeWidth="1.1" opacity=".55" />)}
      <text x="130" y="132" textAnchor="middle" fontSize="8" fill="var(--ink-300)" fontFamily="var(--font-family-mono)">潜空间 / score / return</text>
    </svg>;
  }
  if (template.preview === 'architecture') {
    return <svg viewBox="0 0 260 140" aria-hidden="true" focusable="false">
      {[0, 1, 2].map(layer => <g key={layer}>{[0, 1, 2, 3].map(i => <circle key={i} cx={58 + layer * 72} cy={38 + i * 22} r="6" fill={layer === 1 ? 'var(--color-coral)' : 'var(--paper-0)'} fillOpacity={layer === 1 ? .18 : 1} stroke={layer === 1 ? 'var(--color-coral)' : 'var(--hairline-strong)'} />)}{layer < 2 && [0, 1, 2, 3].flatMap(a => [0, 1, 2, 3].map(b => <line key={`${a}-${b}`} x1={64 + layer * 72} y1={38 + a * 22} x2={124 + layer * 72} y2={38 + b * 22} stroke="var(--hairline)" opacity=".45" />))}</g>)}
      <path d="M58 104h144" stroke="var(--color-coral)" strokeDasharray="3 3" />
      <text x="130" y="126" textAnchor="middle" fontSize="8" fill="var(--ink-300)" fontFamily="var(--font-family-mono)">Wx+b → σ → 下一层</text>
    </svg>;
  }
  return <svg viewBox="0 0 260 140" aria-hidden="true" focusable="false">
    <path d="M34 106Q130 18 228 106" fill="none" stroke="var(--color-indigo)" strokeWidth="1.8" />
    <path d="M34 112Q130 64 228 32" fill="none" stroke="var(--color-coral)" strokeWidth="1.6" strokeDasharray="4 3" />
    {Array.from({ length: 8 }, (_, i) => <circle key={i} cx={54 + i * 22} cy={84 - (i % 4) * 13} r="3" fill={i % 2 ? 'var(--color-indigo)' : 'var(--color-coral)'} opacity=".68" />)}
    <text x="130" y="132" textAnchor="middle" fontSize="8" fill="var(--ink-300)" fontFamily="var(--font-family-mono)">参数 → 轨迹 → 观测</text>
  </svg>;
}

function DeepCard({ template, index, creating, onCreate }: { template: DeepTemplate; index: number; creating: boolean; onCreate: () => void }): JSX.Element {
  return <button type="button" className={styles.tplCard} disabled={creating} onClick={onCreate}>
    <span className={styles.tplPreview} aria-hidden="true"><DeepPreview template={template} /></span>
    <span className={styles.tplBody}>
      <span className={styles.tplMeta}>{String(index + 1).padStart(2, '0')} · {template.tag}</span>
      <span className={styles.tplName}>{template.name}</span>
      <span className={styles.tplDesc}>{template.desc}</span>
      <span className={styles.templateRecipe}>探究：{template.question}</span>
      <span className={styles.templateRecipe}>已预设仪器面板 · 可嵌入活页</span>
      <span className={styles.tplGo}>打开实验 →</span>
    </span>
  </button>;
}

function CanvasGlyph(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      <rect x="3.2" y="4" width="17.6" height="16" rx="3" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="8.2" cy="9.2" r="1.7" fill="currentColor" />
      <circle cx="16" cy="15" r="1.7" fill="currentColor" />
      <path d="M8.2 9.2 16 15M8.6 15h4.2" fill="none" stroke="currentColor" strokeWidth="1.1" strokeDasharray="2 2.2" />
    </svg>
  );
}

function CalculusPreview({ kind }: { kind: CalculusTemplateKind }): JSX.Element {
  const integral = kind.includes('integral') || kind === 'riemann-integral';
  const limit = kind.includes('limit');
  const taylor = kind === 'taylor-expansion';
  return <svg viewBox="0 0 260 140" aria-hidden="true" focusable="false">
    <path d="M25 108H238M124 18V120" fill="none" stroke="var(--hairline-strong)" />
    {[50, 75, 100, 150, 175, 200, 225].map((x) => <line key={x} x1={x} x2={x} y1="26" y2="108" stroke="var(--hairline)" opacity=".5" />)}
    {integral && Array.from({ length: 8 }, (_, i) => <rect key={i} x={44 + i * 19} y={105 - (i + 1) ** 2 * 1.1} width="19" height={(i + 1) ** 2 * 1.1} fill="var(--color-coral)" fillOpacity=".13" stroke="var(--color-coral)" strokeOpacity=".3" />)}
    <path d={limit ? 'M30 84Q124 32 230 84' : taylor ? 'M35 104C110 103 159 90 224 26' : 'M32 30Q124 182 229 30'} fill="none" stroke="var(--color-coral)" strokeWidth="2" />
    {kind === 'derivative-definition' && <path d="M63 101 218 61" stroke="var(--ink-500)" strokeDasharray="4 4" />}
    {taylor && <path d="M35 101Q136 117 224 40" fill="none" stroke="var(--ink-400)" strokeWidth="1.5" strokeDasharray="4 3" />}
    <circle cx="124" cy={limit ? 58 : taylor ? 91 : 106} r="3.5" fill={limit ? 'var(--paper-0)' : 'var(--color-coral)'} stroke="var(--color-coral)" strokeWidth="1.5" />
    <text x="137" y="21" fontSize="9" fill="var(--ink-400)" fontFamily="var(--font-family-mono)">{limit ? 'x → x₀' : integral ? 'Σ f(ξ) Δx' : taylor ? 'f(x) ≈ Pₙ(x)' : 'f(x) · f′(x)'}</text>
  </svg>;
}

function Lab408Preview({ kind }: { kind: Lab408TemplateKind }): JSX.Element {
  if (kind === 'dsWorkbench' || kind === 'coWorkbench' || kind === 'osWorkbench' || kind === 'netWorkbench') {
    return <svg viewBox="0 0 260 140" aria-hidden="true" focusable="false">
      <rect x="28" y="22" width="204" height="92" rx="8" fill="var(--paper-0)" stroke="var(--hairline-strong)" />
      <rect x="42" y="36" width="88" height="14" rx="4" fill="var(--paper-2)" stroke="var(--hairline)" />
      <rect x="136" y="36" width="82" height="14" rx="4" fill="var(--paper-2)" stroke="var(--hairline)" />
      {[0, 1, 2].map(index => <rect key={index} x={42 + index * 64} y={62} width="54" height="24" rx="4"
        fill={index === 1 ? 'var(--color-coral)' : 'var(--paper-2)'} fillOpacity={index === 1 ? .14 : 1}
        stroke={index === 1 ? 'var(--color-coral)' : 'var(--hairline)'} />)}
      <text x="130" y="128" textAnchor="middle" fontSize="8" fill="var(--ink-300)" fontFamily="var(--font-family-mono)">
        {kind === 'dsWorkbench' ? '数据结构 · 18 题型' : kind === 'coWorkbench' ? '组成原理 · 12 题型' : kind === 'osWorkbench' ? '操作系统 · 13 题型' : '计算机网络 · 17 题型'}
      </text>
    </svg>;
  }
  if (kind === 'dsTraversal') {
    return <svg viewBox="0 0 260 140" aria-hidden="true" focusable="false">
      <line x1="130" y1="36" x2="92" y2="76" stroke="var(--hairline-strong)" strokeWidth="1.4" />
      <line x1="130" y1="36" x2="168" y2="76" stroke="var(--hairline-strong)" strokeWidth="1.4" />
      <line x1="92" y1="76" x2="66" y2="112" stroke="var(--hairline-strong)" strokeWidth="1.4" />
      <line x1="92" y1="76" x2="118" y2="112" stroke="var(--hairline-strong)" strokeWidth="1.4" />
      {[['130', 36, 'A'], ['92', 76, 'B'], ['168', 76, 'C'], ['66', 112, 'D'], ['118', 112, 'E']].map(([x, y, label]) => <g key={label}>
        <circle cx={Number(x)} cy={Number(y)} r="13" fill="var(--paper-0)" stroke={label === 'A' ? 'var(--color-coral)' : 'var(--hairline-strong)'} strokeWidth="1.4" />
        <text x={Number(x)} y={Number(y) + 3} textAnchor="middle" fontSize="9" fill="var(--ink-700)">{label}</text>
      </g>)}
      <text x="148" y="126" fontSize="8" fill="var(--ink-300)" fontFamily="var(--font-family-mono)">先序 / 中序 / 后序 / 层序</text>
    </svg>;
  }
  if (kind === 'cacheSplit') {
    return <svg viewBox="0 0 260 140" aria-hidden="true" focusable="false">
      <text x="28" y="48" fontSize="9" fill="var(--ink-400)" fontFamily="var(--font-family-mono)">32 位主存地址</text>
      <rect x="28" y="60" width="118" height="24" fill="var(--color-indigo)" opacity=".82" />
      <rect x="146" y="60" width="58" height="24" fill="var(--color-coral)" opacity=".82" />
      <rect x="204" y="60" width="30" height="24" fill="var(--ink-300)" opacity=".8" />
      <text x="87" y="76" textAnchor="middle" fontSize="8" fill="#fff">tag 18</text>
      <text x="175" y="76" textAnchor="middle" fontSize="8" fill="#fff">index 8</text>
      <text x="219" y="76" textAnchor="middle" fontSize="8" fill="#fff">off 6</text>
      <line x1="28" y1="102" x2="234" y2="102" stroke="var(--hairline-strong)" />
      <text x="28" y="120" fontSize="8" fill="var(--ink-300)" fontFamily="var(--font-family-mono)">64 KB · 64 B · 4 路</text>
    </svg>;
  }
  if (kind === 'pageReplace') {
    const rows = [0, 1, 2];
    return <svg viewBox="0 0 260 140" aria-hidden="true" focusable="false">
      {rows.map(row => <g key={row}>
        {[0, 1, 2, 3].map(col => <rect key={col} x={38 + col * 46} y={30 + row * 30} width="38" height="22" rx="3"
          fill={row === 1 && col === 2 ? 'var(--color-coral)' : 'var(--paper-0)'}
          fillOpacity={row === 1 && col === 2 ? .16 : 1}
          stroke={row === 1 && col === 2 ? 'var(--color-coral)' : 'var(--hairline-strong)'} />)}
      </g>)}
      <text x="38" y="128" fontSize="8" fill="var(--ink-300)" fontFamily="var(--font-family-mono)">缺页 9 / 12 · FIFO</text>
      <text x="188" y="128" fontSize="8" fill="var(--ink-300)" fontFamily="var(--font-family-mono)">LRU · OPT</text>
    </svg>;
  }
  return <svg viewBox="0 0 260 140" aria-hidden="true" focusable="false">
    <text x="30" y="34" fontSize="9" fill="var(--ink-400)" fontFamily="var(--font-family-mono)">192.168.1.0/24</text>
    {[0, 1, 2, 3].map(index => <g key={index}>
      <rect x={30 + index * 50} y={50} width="42" height="34" rx="4" fill={index === 2 ? 'var(--color-coral)' : 'var(--paper-0)'} fillOpacity={index === 2 ? .14 : 1} stroke={index === 2 ? 'var(--color-coral)' : 'var(--hairline-strong)'} />
      <text x={51 + index * 50} y={70} textAnchor="middle" fontSize="7.5" fill="var(--ink-500)" fontFamily="var(--font-family-mono)">/26</text>
      <text x={51 + index * 50} y={80} textAnchor="middle" fontSize="6.5" fill="var(--ink-300)" fontFamily="var(--font-family-mono)">.{(index * 64).toString().padStart(3, '0')}</text>
    </g>)}
    <text x="30" y="114" fontSize="8" fill="var(--ink-300)" fontFamily="var(--font-family-mono)">网络地址 · 广播地址 · 可用范围</text>
  </svg>;
}

function EmptyBoard({ title, lead }: { title: string; lead: string }): JSX.Element {
  return (
    <div className={styles.empty}>
      <span className={styles.emptyIcon} aria-hidden="true"><CanvasGlyph /></span>
      <p className={styles.emptyTitle}>{title}</p>
      <p className={styles.emptyLead}>{lead}</p>
    </div>
  );
}

function SkeletonRows(): JSX.Element {
  return (
    <div aria-hidden="true">
      <div className={styles.skeletonGrid}>
        {Array.from({ length: 3 }, (_, i) => <span key={i} className={styles.skeletonRow} />)}
      </div>
      <span className="visually-hidden" role="status">载入中…</span>
    </div>
  );
}

export function WorkshopPage(): JSX.Element {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [works, setWorks] = useState<WorkSummary[] | null>(null);
  const [gallery, setGallery] = useState<ShareSummary[] | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const [category, setCategory] = useState<TemplateCategory>(() => searchParams.get('subject') === 'deep' ? 'deep' : 'calculus');
  const [query, setQuery] = useState(() => searchParams.get('q') ?? '');

  const [loadError, setLoadError] = useState('');
  const loadWorks = (): void => {
    setLoadError('');
    worksApi.list().then((r) => setWorks(r.works)).catch(() => setLoadError('作品列表加载失败，请重试。'));
    worksApi.gallery().then((r) => setGallery(r.items)).catch(() => setLoadError('公开作品加载失败，请重试。'));
  };
  useEffect(loadWorks, []);

  const fromTemplate = useCallback(async (kind: TemplateKind, name: string) => {
    setCreating(kind);
    try {
      const res = await worksApi.create(templateDoc(kind), name);
      navigate(`/canvas?work=${encodeURIComponent(res.work_id)}`);
    } catch {
      window.alert('创建模板失败：请确认后端已启动。');
      setCreating(null);
    }
  }, [navigate]);

  const normalizedQuery = query.trim().toLowerCase();
  const hit = (...texts: string[]): boolean => !normalizedQuery || texts.some((text) => text.toLowerCase().includes(normalizedQuery));
  const calculusShown = CALCULUS_TEMPLATES.filter((t) => hit(t.name, t.desc, t.tag));
  const mechanicsShown = TEMPLATES.filter((t) => hit(t.name, t.desc, t.tag));
  const lab408Shown = [...LAB408_TEMPLATES, ...LAB408_WORKBENCH_TEMPLATES].filter((t) => hit(t.name, t.desc, t.tag));
  const deepShown = DEEP_TEMPLATES.filter((t) => hit(t.name, t.desc, t.tag, t.question, t.observation, ...t.keywords));
  const shownCount = (category === 'calculus' ? calculusShown.length : category === 'mechanics' ? mechanicsShown.length
    : category === 'lab408' ? lab408Shown.length : category === 'deep' ? deepShown.length
      : calculusShown.length + mechanicsShown.length + lab408Shown.length + deepShown.length);
  const totalTemplates = CALCULUS_TEMPLATES.length + TEMPLATES.length + LAB408_TEMPLATE_COUNT + DEEP_TEMPLATES.length;

  const openWork = useCallback((wid: string) => {
    navigate(`/canvas?work=${encodeURIComponent(wid)}`);
  }, [navigate]);

  const blank = useCallback(() => {
    navigate('/canvas');
  }, [navigate]);

  const remove = useCallback(async (wid: string) => {
    if (!window.confirm('删除这个作品？已发布的分享链接会一并失效。')) return;
    try {
      await worksApi.remove(wid);
      setWorks((w) => (w ?? []).filter((x) => x.work_id !== wid));
    } catch {
      window.alert('删除失败。');
    }
  }, []);

  return (
    <div className={`${styles.page} studio-scope`}>
      <SiteNav current="canvas" appearance="studio" />

      <main className={styles.main}>
        {loadError ? <p role="alert">{loadError} <button onClick={loadWorks}>重试</button></p> : null}
        <header className={styles.pageHead}>
          <div className={styles.headText}>
            <p className={styles.eyebrow}>万象工坊 · Workshop</p>
            <h1 className={styles.title}>把实验摆上画布</h1>
            <p className={styles.lead}>
              理科实验台 × 数学 Scratch：摆下活对象、连线出行为、发布成作品。
              从一条函数出发，搭出极限、导数、积分与泰勒近似；也可以继续探索抛体、弹簧、单摆、覆盖 60 个题型的 408 工作台，以及按四个专题组织的深度学习原理实验。
            </p>
            <p className={styles.headMeta}>
              <span><b>{CALCULUS_TEMPLATES.length}</b> 个高数实验</span>
              <span><b>{TEMPLATES.length}</b> 个力学实验</span>
              <span><b>{LAB408_TEMPLATE_COUNT}</b> 个 408 实验</span>
              <span><b>{DEEP_TEMPLATES.length}</b> 个深度学习实验</span>
              <span><b>{totalTemplates}</b> 个模板</span>
              <span><b>{works === null ? '—' : works.length}</b> 件我的作品</span>
              <span><b>{gallery === null ? '—' : gallery.length}</b> 件公开作品</span>
            </p>
          </div>
          <aside className={styles.headNote}>
            <span>打开即玩，随时能改</span>
            <p>每个模板都附带探究问题、搭建步骤和观察记录。深度学习实验默认带仪器面板，可直接嵌入活页；四个专题从优化动力学一路到生成模型与强化学习。</p>
          </aside>
        </header>

        <section className={styles.section} aria-labelledby="workshop-templates">
          <div className={styles.sectionHead}>
            <div>
              <p className={styles.sectionEyebrow}>01 · Templates</p>
              <h2 id="workshop-templates" className={styles.sectionTitle}>从模板新建</h2>
            </div>
            <p className={styles.sectionNote}>已连好线 · 打开即运行{normalizedQuery ? ` · ${shownCount} 个匹配` : ''}</p>
          </div>
          <div className={styles.templateFilters} role="group" aria-label="模板分类">
            {([
              ['calculus', `高等数学 · ${CALCULUS_TEMPLATES.length}`],
              ['mechanics', `力学实验 · ${TEMPLATES.length}`],
              ['lab408', `408 专题 · ${LAB408_TEMPLATE_COUNT}`],
              ['deep', `深度学习 · ${DEEP_TEMPLATES.length}`],
              ['all', `全部模板 · ${totalTemplates}`],
            ] as const).map(([key, label]) => <button type="button" key={key} aria-pressed={category === key} onClick={() => setCategory(key)}>{label}</button>)}
            <label className={styles.templateSearch}>
              <span>搜索模板</span>
              <input type="search" value={query} placeholder="Adam、CNN、Attention、Diffusion…" aria-label="按算法或关键词搜索模板" onChange={(e) => setQuery(e.target.value)} />
            </label>
            <a href="#workshop-guide">第一次搭建？看三步指南 ↓</a>
          </div>
          {category === 'deep' ? (
            <div className={styles.deepTopics}>
              {DEEP_TOPICS.map((topic) => {
                const items = deepShown.filter((template) => template.topic === topic.id);
                if (!items.length) return null;
                return <section key={topic.id} className={styles.deepTopic} aria-labelledby={`deep-${topic.id}`}>
                  <header className={styles.deepTopicHead}>
                    <div><h3 id={`deep-${topic.id}`}>{topic.name}</h3><p>{topic.lead}</p></div>
                    <span className={styles.countPill}>{items.length} 个实验</span>
                  </header>
                  <div className={styles.tplGrid}>
                    {items.map((template) => <DeepCard key={template.kind} template={template} index={DEEP_TEMPLATES.indexOf(template)}
                      creating={creating !== null} onCreate={() => void fromTemplate(template.kind, template.name)} />)}
                  </div>
                </section>;
              })}
              {!deepShown.length ? <p className={styles.emptyLead} role="status">没有匹配“{query.trim()}”的深度学习模板；试试 Adam、CNN、Attention 或 Diffusion。</p> : null}
            </div>
          ) : (
            <div className={styles.tplGrid}>
              {category !== 'mechanics' && category !== 'lab408' && calculusShown.map((t) => <button key={t.kind} type="button" className={styles.tplCard} disabled={creating !== null} onClick={() => void fromTemplate(t.kind, t.name)}>
                <span className={styles.tplPreview}><CalculusPreview kind={t.kind} /></span>
                <span className={styles.tplBody}>
                  <span className={styles.tplMeta}>{t.tag} · {t.level} / {t.minutes} 分钟</span>
                  <span className={styles.tplName}>{t.name}</span>
                  <span className={styles.tplDesc}>{t.desc}</span>
                  <span className={styles.templateFormula}>{t.formula}</span>
                  <span className={styles.templateRecipe}>{t.recipe}</span>
                  <span className={styles.tplGo}>{creating === t.kind ? '创建中…' : '搭建这个实验 →'}</span>
                </span>
              </button>)}
              {category !== 'calculus' && category !== 'lab408' && mechanicsShown.map((t) => {
                const Preview = PREVIEWS[t.kind];
                return (
                  <button key={t.kind} type="button" className={styles.tplCard} disabled={creating !== null} onClick={() => void fromTemplate(t.kind, t.name)}>
                    <span className={styles.tplPreview} aria-hidden="true"><Preview /></span>
                    <span className={styles.tplBody}>
                      <span className={styles.tplMeta}>{t.tag}</span>
                      <span className={styles.tplName}>{t.name}</span>
                      <span className={styles.tplDesc}>{t.desc}</span>
                      <span className={styles.tplGo}>{creating === t.kind ? '创建中…' : '打开实验 →'}</span>
                    </span>
                  </button>
                );
              })}
              {category !== 'calculus' && category !== 'mechanics' && lab408Shown.map((t) => (
                <button key={t.kind} type="button" className={styles.tplCard} disabled={creating !== null} onClick={() => void fromTemplate(t.kind, t.name)}>
                  <span className={styles.tplPreview} aria-hidden="true"><Lab408Preview kind={t.kind} /></span>
                  <span className={styles.tplBody}>
                    <span className={styles.tplMeta}>{t.tag}</span>
                    <span className={styles.tplName}>{t.name}</span>
                    <span className={styles.tplDesc}>{t.desc}</span>
                    <span className={styles.tplGo}>{creating === t.kind ? '创建中…' : '打开实验 →'}</span>
                  </span>
                </button>
              ))}
              {category === 'all' ? deepShown.map((template) => <DeepCard key={template.kind} template={template} index={DEEP_TEMPLATES.indexOf(template)}
                creating={creating !== null} onCreate={() => void fromTemplate(template.kind, template.name)} />) : null}
              {!normalizedQuery ? <button type="button" className={`${styles.tplCard} ${styles.tplBlank}`} disabled={creating !== null} onClick={blank}>
                <span className={styles.tplPreview} aria-hidden="true"><BlankPreview /></span>
                <span className={styles.tplBody}>
                  <span className={styles.tplMeta}>自由搭建 · Blank Canvas</span>
                  <span className={styles.tplName}>空白画布</span>
                  <span className={styles.tplDesc}>从调色板自己搭：对象、连线、笔记，全由你摆。</span>
                  <span className={styles.tplGo}>新建 →</span>
                </span>
              </button> : null}
              {!shownCount ? <p className={styles.emptyLead} role="status">没有匹配“{query.trim()}”的模板；清空搜索或切换分类。</p> : null}
            </div>
          )}
        </section>

        <section id="workshop-guide" className={styles.section} aria-labelledby="workshop-guide-title">
          <div className={styles.sectionHead}><div><p className={styles.sectionEyebrow}>Build · Learn · Explore</p><h2 id="workshop-guide-title" className={styles.sectionTitle}>从函数到实验，只要三步</h2></div></div>
          <div className={styles.guideGrid}>
            <article><span>01 / 定义</span><h3>放下一个函数源</h3><p>输入 x²、sin(x)、exp(x) 等函数，或用 a、b、c 参数探索函数族。先写下你想验证的问题。</p></article>
            <article><span>02 / 连线</span><h3>把问题连成一条链</h3><p>红点接 f(x) 蓝圈，让同一个函数驱动图像、极限、导数与积分。滑杆接 x₀ 可同时改变多个对象的观察点。</p></article>
            <article><span>03 / 验证</span><h3>先预测，再调参和记录</h3><p>比较左右、粗细分割与近似误差；用便签记录发现。保存后可继续编辑，发布后别人可以复制改造。</p></article>
          </div>
          <details className={styles.mathBoundary}><summary>这些实验如何计算？</summary><p>支持一元实函数探索。极限表仅提供样本证据；导数与最高五阶泰勒系数由表达式自动微分，并检查左右分支一致性；积分参考使用有限区间 Simpson 数值求积。计算保留浮点误差，无定义、不可导或不稳定时停止输出；图像和采样不替代解析推导与证明。</p></details>
        </section>

        <section className={styles.section} aria-labelledby="workshop-mine">
          <div className={styles.sectionHead}>
            <div>
              <p className={styles.sectionEyebrow}>02 · My Works</p>
              <h2 id="workshop-mine" className={styles.sectionTitle}>我的作品</h2>
            </div>
            <span className={styles.countPill}>{works === null ? '载入中' : `${works.length} 件`}</span>
          </div>
          {works === null ? (
            <SkeletonRows />
          ) : works.length === 0 ? (
            <EmptyBoard
              title="还没有存到工坊的作品"
              lead="在画布里点「存到工坊」或「发布画布」，作品就会出现在这里。"
            />
          ) : (
            <ul className={styles.workList}>
              {works.map((w) => (
                <li key={w.work_id} className={styles.workCard}>
                  <button type="button" className={styles.workMain} onClick={() => openWork(w.work_id)}>
                    <span className={styles.workGlyph} aria-hidden="true"><CanvasGlyph /></span>
                    <span className={styles.workBody}>
                      <b>{w.title || '未命名作品'}</b>
                      <span className={styles.workMeta}>
                        {w.node_count} 个对象 · v{w.revision}
                        {w.forked_from_share ? ' · 改造自画廊' : ''}
                      </span>
                    </span>
                    <span className={styles.workArrow} aria-hidden="true">→</span>
                  </button>
                  <button
                    type="button"
                    className={styles.workDel}
                    aria-label={`删除 ${w.title || '未命名作品'}`}
                    onClick={() => void remove(w.work_id)}
                  >
                    删除
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={styles.section} aria-labelledby="workshop-gallery">
          <div className={styles.sectionHead}>
            <div>
              <p className={styles.sectionEyebrow}>03 · Gallery</p>
              <h2 id="workshop-gallery" className={styles.sectionTitle}>作品墙（公开画廊）</h2>
            </div>
            <span className={styles.countPill}>{gallery === null ? '载入中' : `${gallery.length} 件`}</span>
          </div>
          {gallery === null ? (
            <SkeletonRows />
          ) : gallery.length === 0 ? (
            <EmptyBoard
              title="画廊还空着"
              lead="还没有公开发布的作品——第一个发布的可以是你的画布。"
            />
          ) : (
            <ul className={styles.workList}>
              {gallery.map((s) => (
                <li key={s.share_id} className={styles.workCard}>
                  <Link to={`/work-shares/${encodeURIComponent(s.share_id)}`} className={styles.workMain}>
                    <span className={styles.workGlyph} aria-hidden="true"><CanvasGlyph /></span>
                    <span className={styles.workBody}>
                      <b>{s.title || '未命名作品'}</b>
                      <span className={styles.workMeta}>
                        {s.node_count} 个对象{s.forks > 0 ? ` · 被改造 ${s.forks} 次` : ''}
                      </span>
                    </span>
                    <span className={styles.workOpen}>打开 →</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}

export default WorkshopPage;
