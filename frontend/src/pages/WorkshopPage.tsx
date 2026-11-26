/**
 * WorkshopPage.tsx —— 定象坊（/workshop）
 *
 * 定象坊门面：模板目录 + 我的作品（仅在用户从画布显式保存后展示）+ 公开画廊（已发布作品，可 fork）。
 * 内置模板通过 /canvas?template=<kind> 直接在客户端打开即玩，不再自动向「我的作品」建档。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useNavigationType, useSearchParams } from 'react-router-dom';
import { MainSiteNav } from '@/components/home/MainSiteNav';
import { WorkshopIntroBanner } from '@/components/intros/WorkshopIntroBanner';
import { worksApi, type ShareSummary, type WorkSummary } from '@/api/works';
import {
  CALCULUS_TOPICS,
  VISIBLE_CALCULUS_TEMPLATES,
  type CalculusTemplate,
} from '@/canvas/calculusTemplates';
import {
  PHYSICS_TEMPLATES,
  PHYSICS_TOPICS,
  VISIBLE_PHYSICS_TEMPLATES,
  type PhysicsTemplate,
} from '@/canvas/physicsTemplates';
import {
  LAB408_TOPICS,
  VISIBLE_LAB408_TEMPLATES,
  type Lab408Preview as Lab408PreviewKind,
} from '@/canvas/lab408Templates';
import {
  DEEP_TEMPLATES,
  DEEP_TOPICS,
  type DeepTemplate,
} from '@/canvas/deepTemplates';
import { workshopFormula } from '@/canvas/templateCatalog';
import { VISIBLE_BUSINESS_TEMPLATES, BUSINESS_TOPICS } from '@/canvas/businessTemplates';
import type { BusinessPreview as BusinessPreviewKind } from '@/canvas/businessTemplates';
import { LINALG_TOPICS, VISIBLE_LINALG_TEMPLATES, type LinalgTemplateKind } from '@/canvas/linalgTemplates';
import {
  readTopicAliases, topicDisplayName, writeTopicAlias, type TopicAliases,
} from './workshopTopics';
import styles from './WorkshopPage.module.css';

type TemplateKind = string;
type TemplateCategory = 'calculus' | 'linalg' | 'mechanics' | 'lab408' | 'deep' | 'business' | 'all';

/* ---------- 统一专题目录：数据形状（C-TOPIC-CATALOG@1） ---------- */

export interface WorkshopTopic {
  id: string;
  name: string;
  lead: string;
}

export interface CatalogItem {
  key: string;
  topic: string;
  name: string;
  desc: string;
  tag: string;
  formula?: string;
  panorama?: true;
  preview: JSX.Element;
}

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

function PhysicsDiagram({ caption, children }: { caption: string; children: ReactNode }): JSX.Element {
  return <svg viewBox="0 0 260 140" aria-hidden="true" focusable="false">
    {children}
    <text x="24" y="132" fontSize="7.5" fill="var(--ink-300)" fontFamily="var(--font-family-mono)">{caption}</text>
  </svg>;
}

function ChargedParticlePreview(): JSX.Element {
  return <PhysicsDiagram caption="速度选择 · qvB = mv²/r">
    <line x1="28" y1="45" x2="88" y2="45" stroke="var(--ink-500)" strokeWidth="2" />
    <line x1="28" y1="91" x2="88" y2="91" stroke="var(--ink-500)" strokeWidth="2" />
    <path d="M58 52V82M52 76 58 84 64 76" fill="none" stroke="var(--color-indigo)" strokeWidth="1.4" />
    <path d="M24 68H116Q148 68 148 98T188 98" fill="none" stroke="var(--color-coral)" strokeWidth="1.8" />
    <path d="M43 64 51 68 43 72Z" fill="var(--color-coral)" />
    <circle cx="148" cy="98" r="24" fill="none" stroke="var(--hairline-strong)" strokeDasharray="3 3" />
    <line x1="148" y1="98" x2="166" y2="81" stroke="var(--color-indigo)" strokeWidth="1.4" />
    <text x="98" y="38" fontSize="8" fill="var(--ink-400)" fontFamily="var(--font-family-mono)">E · v · B</text>
    <text x="170" y="78" fontSize="8" fill="var(--color-coral-ink)" fontFamily="var(--font-family-mono)">r</text>
  </PhysicsDiagram>;
}

function RcCircuitPreview(): JSX.Element {
  return <PhysicsDiagram caption="RC 充放电 · U / I / 能量同步">
    <path d="M34 82V38H96M118 38H176V82H34" fill="none" stroke="var(--ink-500)" strokeWidth="1.5" />
    <path d="M96 32V44M100 32V44M104 32V44M108 32V44M112 32V44M116 32V44" stroke="var(--color-coral)" strokeWidth="1.4" />
    <line x1="34" y1="54" x2="34" y2="66" stroke="var(--ink-700)" strokeWidth="2" />
    <line x1="25" y1="60" x2="43" y2="60" stroke="var(--ink-700)" strokeWidth="1.6" />
    <line x1="176" y1="38" x2="176" y2="20" stroke="var(--color-coral)" strokeWidth="1.5" />
    <path d="M198 94V28M198 94H244" fill="none" stroke="var(--hairline-strong)" />
    <path d="M201 91Q212 40 241 34" fill="none" stroke="var(--color-coral)" strokeWidth="1.8" />
    <path d="M201 35Q218 72 241 86" fill="none" stroke="var(--color-indigo)" strokeWidth="1.4" strokeDasharray="3 3" />
    <text x="132" y="30" fontSize="8" fill="var(--ink-400)" fontFamily="var(--font-family-mono)">R · C</text>
  </PhysicsDiagram>;
}

function MotionalEmfPreview(): JSX.Element {
  return <PhysicsDiagram caption="ε = BLv · 安培阻力与焦耳热">
    {[54, 90, 126, 162, 198].map((x) => <g key={x}>
      <circle cx={x} cy="48" r="6" fill="none" stroke="var(--hairline-strong)" />
      <path d={`M${x - 3} 45l6 6m0-6-6 6`} stroke="var(--ink-400)" strokeWidth="1" />
    </g>)}
    <line x1="34" y1="76" x2="224" y2="76" stroke="var(--ink-500)" strokeWidth="1.6" />
    <line x1="34" y1="106" x2="224" y2="106" stroke="var(--ink-500)" strokeWidth="1.6" />
    <line x1="126" y1="70" x2="126" y2="112" stroke="var(--color-coral)" strokeWidth="3" />
    <path d="M126 62H174M166 56 176 62 166 68" fill="none" stroke="var(--color-coral)" strokeWidth="1.6" />
    <path d="M96 76V58H52V76" fill="none" stroke="var(--color-indigo)" strokeWidth="1.3" />
    <text x="184" y="59" fontSize="8" fill="var(--color-coral-ink)" fontFamily="var(--font-family-mono)">v</text>
  </PhysicsDiagram>;
}

function DoubleSlitPreview(): JSX.Element {
  return <PhysicsDiagram caption="双缝 / 光栅 · 波长决定真实颜色条纹">
    <circle cx="30" cy="70" r="4" fill="var(--color-coral)" />
    <path d="M40 52Q60 70 40 88M48 44Q78 70 48 96" fill="none" stroke="var(--color-indigo)" strokeWidth="1.2" />
    <path d="M92 30V58M92 66V74M92 82V110" stroke="var(--ink-500)" strokeWidth="3" />
    <path d="M94 62Q138 34 184 48M94 78Q138 106 184 92" fill="none" stroke="var(--color-coral)" strokeWidth="1.4" />
    <line x1="188" y1="26" x2="188" y2="112" stroke="var(--ink-500)" strokeWidth="2" />
    {[34, 48, 62, 76, 90, 104].map((y, index) => <rect key={y} x="202" y={y} width="34" height="5" rx="2" fill={index % 2 ? 'var(--color-indigo)' : 'var(--color-coral)'} opacity={0.25 + (index % 3) * 0.25} />)}
  </PhysicsDiagram>;
}

function RefractionFiberPreview(): JSX.Element {
  return <PhysicsDiagram caption="Snell 定律 · 临界角与全反射">
    <line x1="26" y1="70" x2="142" y2="70" stroke="var(--hairline-strong)" />
    <line x1="88" y1="24" x2="88" y2="116" stroke="var(--hairline)" strokeDasharray="3 3" />
    <path d="M42 28 88 70 116 112" fill="none" stroke="var(--color-coral)" strokeWidth="1.8" />
    <path d="M88 70 132 48" stroke="var(--color-indigo)" strokeWidth="1.4" strokeDasharray="4 3" />
    <path d="M154 48H236V92H154Z" fill="var(--color-indigo)" fillOpacity=".08" stroke="var(--hairline-strong)" />
    <path d="M154 70 172 52 194 88 216 52 236 70" fill="none" stroke="var(--color-coral)" strokeWidth="1.7" />
    <text x="104" y="102" fontSize="8" fill="var(--ink-400)" fontFamily="var(--font-family-mono)">n₁sinθ₁ = n₂sinθ₂</text>
  </PhysicsDiagram>;
}

function ThinLensPreview(): JSX.Element {
  return <PhysicsDiagram caption="三光线成像 · 1/f = 1/u + 1/v">
    <line x1="24" y1="82" x2="238" y2="82" stroke="var(--hairline-strong)" />
    <ellipse cx="132" cy="76" rx="9" ry="48" fill="var(--color-indigo)" fillOpacity=".1" stroke="var(--color-indigo)" />
    <path d="M54 82V38M46 46 54 36 62 46" fill="none" stroke="var(--ink-600)" strokeWidth="1.8" />
    <path d="M54 38 132 38 204 98M54 38 132 82 204 98M54 38 132 62 204 98" fill="none" stroke="var(--color-coral)" strokeWidth="1.3" />
    <path d="M204 82V102M196 94 204 104 212 94" fill="none" stroke="var(--color-indigo)" strokeWidth="1.6" />
    <text x="124" y="20" fontSize="8" fill="var(--ink-400)" fontFamily="var(--font-family-mono)">F · 2F</text>
  </PhysicsDiagram>;
}

function CarnotCyclePreview(): JSX.Element {
  return <PhysicsDiagram caption="P–V 循环 · 等温与绝热 · η = W/Qh">
    <path d="M42 112V24M42 112H232" fill="none" stroke="var(--hairline-strong)" />
    <path d="M78 42C118 34 166 48 190 72C174 102 126 108 88 88C70 76 66 56 78 42Z" fill="var(--color-coral)" fillOpacity=".08" stroke="var(--color-coral)" strokeWidth="1.7" />
    <path d="M113 39 124 40 118 32M158 96 148 98 154 106" fill="none" stroke="var(--color-indigo)" strokeWidth="1.4" />
    <text x="24" y="28" fontSize="8" fill="var(--ink-400)" fontFamily="var(--font-family-mono)">P</text>
    <text x="226" y="124" fontSize="8" fill="var(--ink-400)" fontFamily="var(--font-family-mono)">V</text>
    <text x="118" y="72" fontSize="8" fill="var(--color-coral-ink)" fontFamily="var(--font-family-mono)">W = ∮P dV</text>
  </PhysicsDiagram>;
}

function PhotoelectricPreview(): JSX.Element {
  return <PhysicsDiagram caption="hν = W₀ + Ek · I–U 与遏止电压">
    <path d="M32 100H128L116 112H20Z" fill="var(--ink-300)" fillOpacity=".35" stroke="var(--hairline-strong)" />
    {[46, 70, 94].map((x) => <g key={x}>
      <line x1={x - 18} y1="30" x2={x} y2="88" stroke="var(--color-coral)" strokeWidth="1.4" />
      <circle cx={x} cy="88" r="2.5" fill="var(--color-coral)" />
      <path d={`M${x + 4} 84Q${x + 24} 56 ${x + 42} 62`} fill="none" stroke="var(--color-indigo)" strokeWidth="1.3" />
      <circle cx={x + 42} cy="62" r="2.8" fill="var(--color-indigo)" />
    </g>)}
    <path d="M174 102V28M174 102H242" fill="none" stroke="var(--hairline-strong)" />
    <path d="M178 96Q190 42 202 38H240" fill="none" stroke="var(--color-coral)" strokeWidth="1.7" />
    <line x1="190" y1="88" x2="190" y2="106" stroke="var(--color-indigo)" strokeDasharray="2 2" />
    <text x="180" y="120" fontSize="7" fill="var(--ink-400)" fontFamily="var(--font-family-mono)">−Us</text>
  </PhysicsDiagram>;
}

function InclinePreview(): JSX.Element {
  return (
    <svg viewBox="0 0 260 140" aria-hidden="true" focusable="false">
      <path d="M40 118 214 118 40 40Z" fill="var(--paper-2)" fillOpacity=".6" stroke="var(--hairline-strong)" />
      <path d="M40 44 208 112" stroke="var(--ink-500)" strokeWidth="1.4" />
      <rect x="106" y="66" width="30" height="17" rx="2" fill="var(--color-coral)" opacity=".82" transform="rotate(24 121 74)" />
      <path d="M88 40 74 56M88 40 102 48" stroke="var(--ink-700)" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M60 118 60 88" stroke="var(--hairline-strong)" strokeDasharray="3 3" />
      <text x="64" y="106" fontSize="7" fill="var(--ink-300)" fontFamily="var(--font-family-mono)">α</text>
      <text x="24" y="128" fontSize="7.5" fill="var(--ink-300)" fontFamily="var(--font-family-mono)">tanα ≟ μ</text>
      <text x="24" y="34" fontSize="7" fill="var(--ink-400)" fontFamily="var(--font-family-mono)">m, g, μ</text>
      <MiniMeter x={196} y={40} />
    </svg>
  );
}

function CollisionPreview(): JSX.Element {
  return (
    <svg viewBox="0 0 260 140" aria-hidden="true" focusable="false">
      <line x1="28" y1="104" x2="232" y2="104" stroke="var(--hairline-strong)" strokeWidth="1.4" />
      {[46, 78, 110, 142, 174, 206].map((x) => <line key={x} x1={x} y1="104" x2={x} y2="110" stroke="var(--hairline)" />)}
      <circle cx="62" cy="94" r="10" fill="var(--color-indigo)" opacity=".8" />
      <circle cx="122" cy="94" r="10" fill="var(--paper-0)" stroke="var(--ink-500)" strokeWidth="1.4" />
      <line x1="64" y1="78" x2="94" y2="78" stroke="var(--color-coral)" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M94 78 88 74 88 82Z" fill="var(--color-coral)" />
      <text x="60" y="64" fontSize="7" fill="var(--ink-400)" fontFamily="var(--font-family-mono)">m₁ v₁</text>
      <text x="112" y="64" fontSize="7" fill="var(--ink-400)" fontFamily="var(--font-family-mono)">m₂ v₂</text>
      <text x="28" y="130" fontSize="7.5" fill="var(--ink-300)" fontFamily="var(--font-family-mono)">p = m₁v₁ + m₂v₂ 守恒</text>
    </svg>
  );
}


function WavePreview(): JSX.Element {
  return (
    <svg viewBox="0 0 260 140" aria-hidden="true" focusable="false">
      <line x1="24" y1="60" x2="236" y2="60" stroke="var(--hairline-strong)" />
      <path d="M24 60Q53 18 82 60T140 60T198 60T236 60" fill="none" stroke="var(--color-coral)" strokeWidth="1.8" strokeDasharray="4 3" />
      <path d="M24 60Q44 34 64 60T104 60T144 60T184 60T224 60" fill="none" stroke="var(--color-indigo)" strokeWidth="1.4" opacity=".75" />
      <path d="M24 60Q53 102 82 60T140 60T198 60T236 60" fill="none" stroke="var(--color-coral)" strokeWidth="1.8" strokeDasharray="4 3" opacity=".45" />
      {[64, 104, 144, 184, 224].map((x) => <circle key={x} cx={x} cy="60" r="2.6" fill="var(--ink-500)" />)}
      <text x="24" y="130" fontSize="7.5" fill="var(--ink-300)" fontFamily="var(--font-family-mono)">行波 → 传播 · 驻波 · 波节不动</text>
    </svg>
  );
}

function RotationPreview(): JSX.Element {
  return (
    <svg viewBox="0 0 260 140" aria-hidden="true" focusable="false">
      <line x1="24" y1="56" x2="236" y2="124" stroke="var(--hairline-strong)" />
      <circle cx="92" cy="72" r="18" fill="none" stroke="var(--color-indigo)" strokeWidth="1.8" />
      <line x1="92" y1="72" x2="92" y2="54" stroke="var(--color-indigo)" strokeWidth="1.6" />
      <circle cx="152" cy="94" r="18" fill="none" stroke="var(--color-coral)" strokeWidth="1.8" strokeDasharray="4 3" />
      <circle cx="198" cy="112" r="18" fill="none" stroke="var(--ink-400)" strokeWidth="1.8" />
      <path d="M36 40a52 52 0 0 1 30 -14" fill="none" stroke="var(--color-coral)" strokeWidth="1.6" />
      <path d="M70 24l8 4-8 4z" fill="var(--color-coral)" />
      <text x="24" y="136" fontSize="7.5" fill="var(--ink-300)" fontFamily="var(--font-family-mono)">I 小者胜 · ω=ω₀(r₀/r)² · L 守恒</text>
    </svg>
  );
}

function OscPreview(): JSX.Element {
  return (
    <svg viewBox="0 0 260 140" aria-hidden="true" focusable="false">
      <line x1="30" y1="22" x2="30" y2="118" stroke="var(--hairline-strong)" />
      <path d="M30 40h20M30 52h20M30 64h20M30 76h20" stroke="var(--color-indigo)" strokeWidth="1.4" />
      <rect x="42" y="88" width="22" height="22" rx="3" fill="var(--color-indigo)" fillOpacity=".18" stroke="var(--color-indigo)" />
      <path d="M96 80Q130 30 164 80T232 80" fill="none" stroke="var(--color-coral)" strokeWidth="1.8" />
      <path d="M96 80Q130 56 164 80T232 80" fill="none" stroke="var(--color-coral)" strokeWidth="1.4" strokeDasharray="4 3" opacity=".6" />
      <text x="96" y="130" fontSize="7.5" fill="var(--ink-300)" fontFamily="var(--font-family-mono)">Ek⇌Ep 守恒 · c 压平共振峰</text>
    </svg>
  );
}

function PhysicsPreview({ template }: { template: PhysicsTemplate }): JSX.Element {
  switch (template.kind) {
    case 'projectile-drag': case 'phy01-mechanics': return <ProjectilePreview />;
    case 'incline-friction': return <InclinePreview />;
    case 'collision-momentum': return <CollisionPreview />;
    case 'oscillation-wave': return <WavePreview />;
    case 'phy02-rigid-rotation': return <RotationPreview />;
    case 'phy03-oscillations': return <OscPreview />;
    case 'phy04-waves': return <WavePreview />;
    case 'charged-particle': case 'phy05-em-fields': return <ChargedParticlePreview />;
    case 'rc-circuit': return <RcCircuitPreview />;
    case 'motional-emf': case 'phy06-induction-circuits': return <MotionalEmfPreview />;
    case 'double-slit': case 'phy08-wave-optics': return <DoubleSlitPreview />;
    case 'refraction-fiber': case 'phy07-geometric-optics': return <RefractionFiberPreview />;
    case 'thin-lens': return <ThinLensPreview />;
    case 'carnot-cycle': case 'phy09-thermodynamics': return <CarnotCyclePreview />;
    case 'photoelectric': case 'phy10-modern-physics': return <PhotoelectricPreview />;
  }
}

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

function CalcAxes({ grid = false }: { grid?: boolean }): JSX.Element {
  return <g>
    <path d="M25 108H238M124 18V120" fill="none" stroke="var(--hairline-strong)" />
    {grid && [50, 75, 100, 150, 175, 200, 225].map((x) => <line key={x} x1={x} x2={x} y1="26" y2="108" stroke="var(--hairline)" opacity=".5" />)}
  </g>;
}

function CalculusPreview({ template }: { template: CalculusTemplate }): JSX.Element {
  const svg = (children: JSX.Element, label: string): JSX.Element => (
    <svg viewBox="0 0 260 140" aria-hidden="true" focusable="false">
      {children}
      <text x="30" y="132" fontSize="8" fill="var(--ink-300)" fontFamily="var(--font-family-mono)">{label}</text>
    </svg>
  );
  switch (template.kind) {
    case 'ch01-limits':
      return svg(<g>
        <CalcAxes grid />
        <rect x="108" y="24" width="42" height="85" fill="var(--color-indigo)" fillOpacity=".13" />
        <rect x="30" y="55" width="200" height="24" fill="var(--color-coral)" fillOpacity=".16" />
        <path d="M33 106L124 69M134 64L228 26" fill="none" stroke="var(--color-indigo)" strokeWidth="2" />
        <circle cx="129" cy="67" r="4" fill="var(--paper-0)" stroke="var(--color-indigo)" strokeWidth="1.6" />
      </g>, 'ε–δ 邻域 · 间断点 · 二分夹逼');
    case 'ch02-derivatives':
      return svg(<g>
        <CalcAxes grid />
        <path d="M32 100Q133 111 225 28" fill="none" stroke="var(--color-indigo)" strokeWidth="2" />
        <path d="M67 120L207 65M69 117L192 59" fill="none" stroke="var(--color-coral)" strokeWidth="1.5" strokeDasharray="4 2" />
        <line x1="192" y1="59" x2="192" y2="72" stroke="var(--color-indigo)" strokeWidth="2" />
      </g>, '割线趋近 · 链式倍率 · 微分余差');
    case 'ch04-integrals':
      return svg(<g>
        <CalcAxes grid />
        <path d="M52 102V92H81V86H110V76H139V65H168V51H197V35H221V102Z" fill="var(--color-indigo)" fillOpacity=".16" stroke="var(--color-indigo)" />
        <path d="M36 96Q141 85 226 25" fill="none" stroke="var(--color-coral)" strokeWidth="2" />
      </g>, '黎曼和 · 原函数族 · 收敛临界');
    case 'ch06-integral-apps':
      return svg(<g>
        <CalcAxes />
        <path d="M34 72H143" stroke="var(--hairline-strong)" strokeDasharray="3 3" />
        {[0, 1, 2, 3, 4].map((i) => <rect key={i} x={39 + i * 19} y={62 - i * 5} width="19" height={20 + i * 10}
          fill="var(--color-indigo)" fillOpacity=".20" stroke="var(--color-indigo)" />)}
        <path d="M160 42H228M169 42V108H226Z" fill="var(--color-coral)" fillOpacity=".14" stroke="var(--color-coral)" />
        <path d="M169 62H185M169 78H199M169 94H213" stroke="var(--color-coral)" />
      </g>, '旋转体体积 · 水坝合力 · 抽水做功');
    case 'ch08-space-geometry':
      return svg(<g>
        <CalcAxes grid />
        <path d="M44 26Q118 67 44 108M218 26Q144 67 218 108" fill="none" stroke="var(--color-indigo)" strokeWidth="2" />
        <path d="M72 24L198 110M72 110L198 24" fill="none" stroke="var(--color-coral)" strokeDasharray="4 3" />
        <circle cx="135" cy="67" r="4" fill="var(--color-coral)" />
      </g>, '截痕翻转 · 高度场 · 点积与叉积');
    case 'ch10-multiple-int':
      return svg(<g>
        <circle cx="119" cy="68" r="47" fill="var(--color-indigo)" fillOpacity=".12" stroke="var(--color-indigo)" />
        <circle cx="119" cy="68" r="31" fill="none" stroke="var(--color-indigo)" strokeDasharray="4 3" />
        <path d="M119 68L159 44M119 68L164 82M73 68H177M119 21V115" stroke="var(--hairline-strong)" />
        <path d="M119 68H142M134 60V76" stroke="var(--color-coral)" strokeWidth="1.8" />
        <circle cx="134" cy="68" r="3.5" fill="var(--color-coral)" />
      </g>, '极坐标微元 · 圆盘密度 · 质心');
    case 'ch11-vector-calc':
      return svg(<g>
        <CalcAxes grid />
        <circle cx="130" cy="68" r="44" fill="var(--color-indigo)" fillOpacity=".10" stroke="var(--color-indigo)" strokeWidth="1.5" />
        <path d="M93 45Q127 9 161 39L151 38M165 88Q126 124 97 96L109 97" fill="none" stroke="var(--color-coral)" strokeWidth="2" />
        <path d="M114 66v-15l-4 6M148 56v15l4-6M119 84h19l-5-4" fill="none" stroke="var(--color-indigo)" strokeWidth="1.3" />
      </g>, '闭合环量 · 外向通量 · 格林公式');
    case 'ch03-derivatives-app':
      return svg(<g>
        <CalcAxes grid />
        <path d="M32 99C71 133 90 25 133 45S170 119 229 66" fill="none" stroke="var(--color-indigo)" strokeWidth="2" />
        <circle cx="138" cy="74" r="29" fill="none" stroke="var(--color-coral)" strokeWidth="1.5" />
        <circle cx="133" cy="45" r="4" fill="var(--color-coral)" />
      </g>, '曲率圆 · 中值切线 · 泰勒误差');
    case 'ch07-ode-dynamics':
      return svg(<g>
        <CalcAxes />
        <path d="M34 68L53 68 62 56 72 80 82 56 92 80 102 56 112 68H124" fill="none" stroke="var(--color-indigo)" strokeWidth="2" />
        <rect x="124" y="54" width="27" height="28" rx="3" fill="var(--color-coral)" />
        <path d="M200 38C240 44 238 96 202 98S169 55 197 54 225 82 206 88 187 74 200 70" fill="none" stroke="var(--color-indigo)" strokeWidth="2" />
      </g>, '受迫振子 · 相轨 · 步长稳定性');
    case 'ch09-multivar-opt':
      return svg(<g>
        <CalcAxes grid />
        {[12, 22, 33].map((size) => <g key={size} fill="none" stroke="var(--color-indigo)">
          <ellipse cx="85" cy="65" rx={size} ry={size * 0.65} /><ellipse cx="165" cy="65" rx={size} ry={size * 0.65} />
        </g>)}
        <path d="M221 31L200 45 193 55 170 64" fill="none" stroke="var(--color-coral)" strokeWidth="2" />
        <circle cx="170" cy="64" r="4" fill="var(--color-coral)" />
      </g>, '双谷地形 · 约束圆 · 寻谷轨迹');
    case 'ch12-series-fourier':
      return svg(<g>
        <CalcAxes />
        <path d="M33 80L42 69 50 88 58 58 65 70 73 40 81 53 91 32 99 56 108 40 118 80 128 68 136 105 144 82 151 103 160 81 169 94 179 53 187 72 198 41 207 59 230 39" fill="none" stroke="var(--hairline-strong)" strokeWidth="1.5" />
        <path d="M33 82C70 83 62 40 101 44S126 97 152 91 181 43 230 47" fill="none" stroke="var(--color-indigo)" strokeWidth="2" />
      </g>, '频谱截断 · 波形重建 · 信噪比');
    case 'limit-epsilon':
      return svg(<g>
        <CalcAxes />
        <path d="M30 84Q124 32 230 84" fill="none" stroke="var(--color-coral)" strokeWidth="2" />
        <circle cx="124" cy="58" r="3.5" fill="var(--paper-0)" stroke="var(--color-coral)" strokeWidth="1.5" />
        <line x1="108" y1="58" x2="140" y2="58" stroke="var(--hairline-strong)" strokeDasharray="2 3" />
        <text x="137" y="21" fontSize="9" fill="var(--ink-400)" fontFamily="var(--font-family-mono)">0 &lt; |x−a| &lt; δ</text>
      </g>, 'ε–δ 窗口 · 左右样本逼近');
    case 'derivative-triptych':
    case 'mean-value':
      return svg(<g>
        <CalcAxes grid />
        <path d="M32 30Q124 182 229 30" fill="none" stroke="var(--color-coral)" strokeWidth="2" />
        <path d="M63 101 218 61" stroke="var(--ink-500)" strokeDasharray="4 4" />
        <circle cx="124" cy="106" r="3.5" fill="var(--color-coral)" />
        <text x="137" y="21" fontSize="9" fill="var(--ink-400)" fontFamily="var(--font-family-mono)">割线 → 切线</text>
      </g>, template.kind === 'mean-value' ? 'f(b)−f(a) = f′(ξ)(b−a)' : '函数 · 差商 · 自动微分三联');
    case 'integration-race':
      return svg(<g>
        <CalcAxes grid />
        {Array.from({ length: 8 }, (_, i) => <rect key={i} x={44 + i * 19} y={105 - (i + 1) ** 2 * 1.1} width="19" height={(i + 1) ** 2 * 1.1} fill="var(--color-coral)" fillOpacity=".13" stroke="var(--color-coral)" strokeOpacity=".3" />)}
        <path d="M32 30Q124 182 229 30" fill="none" stroke="var(--color-coral)" strokeWidth="2" />
        <text x="137" y="21" fontSize="9" fill="var(--ink-400)" fontFamily="var(--font-family-mono)">Σ f(ξ) Δx</text>
      </g>, '矩形 / 梯形 / Simpson · 误差竞赛');
    case 'taylor-error':
      return svg(<g>
        <CalcAxes />
        <path d="M35 104C110 103 159 90 224 26" fill="none" stroke="var(--color-coral)" strokeWidth="2" />
        <path d="M35 101Q136 117 224 40" fill="none" stroke="var(--ink-400)" strokeWidth="1.5" strokeDasharray="4 3" />
        <circle cx="124" cy="91" r="3.5" fill="var(--color-coral)" />
        <text x="137" y="21" fontSize="9" fill="var(--ink-400)" fontFamily="var(--font-family-mono)">f(x) ≈ Pₙ(x)</text>
      </g>, '阶数 N · 截断误差与真实误差');
    case 'ftc-sweep':
      return svg(<g>
        <CalcAxes grid />
        <path d="M60 92 60 108 190 108 190 44 150 42 100 52 60 92Z" fill="var(--color-coral)" fillOpacity=".14" stroke="var(--color-coral-ink)" strokeOpacity=".3" />
        <line x1="60" y1="92" x2="60" y2="108" stroke="var(--ink-400)" strokeDasharray="2 3" />
        <line x1="190" y1="44" x2="190" y2="108" stroke="var(--color-coral)" strokeDasharray="2 3" />
        <path d="M60 92C96 56 150 44 224 26" fill="none" stroke="var(--color-coral)" strokeWidth="2" />
        <text x="46" y="120" fontSize="7.5" fill="var(--ink-400)" fontFamily="var(--font-family-mono)">a</text>
        <text x="184" y="120" fontSize="7.5" fill="var(--color-coral-ink)" fontFamily="var(--font-family-mono)">x</text>
        <text x="137" y="21" fontSize="9" fill="var(--ink-400)" fontFamily="var(--font-family-mono)">F(x) = ∫ₐˣ f</text>
      </g>, '上限扫描 · F′(x) = f(x)');
    case 'fourier-gibbs':
      return svg(<g>
        <line x1="24" y1="70" x2="236" y2="70" stroke="var(--hairline-strong)" />
        <path d="M30 40H70V96H110V40H150V96H190V40H230" fill="none" stroke="var(--ink-300)" strokeWidth="1.4" strokeDasharray="3 3" />
        <path d="M30 70C46 44 60 42 70 52S90 88 110 88 130 52 150 52 170 88 190 88 210 52 230 46" fill="none" stroke="var(--color-coral)" strokeWidth="1.8" />
        <text x="137" y="21" fontSize="9" fill="var(--ink-400)" fontFamily="var(--font-family-mono)">S_N(x) → 方波</text>
      </g>, '谐波频谱 · Gibbs 过冲');
    case 'ode-methods':
      return svg(<g>
        <CalcAxes grid />
        {[0, 1, 2, 3, 4, 5, 6, 7].flatMap((i) => [0, 1, 2, 3].map((j) => {
          const x = 46 + i * 24, y = 32 + j * 22, slope = -0.55 * (1 - j * 0.2);
          return <line key={`${i}-${j}`} x1={x - 7} y1={y - slope * 7} x2={x + 7} y2={y + slope * 7} stroke="var(--ink-300)" strokeWidth="1.1" opacity=".7" />;
        }))}
        <path d="M40 36C90 40 150 58 228 100" fill="none" stroke="var(--color-coral)" strokeWidth="1.8" />
        <text x="137" y="21" fontSize="9" fill="var(--ink-400)" fontFamily="var(--font-family-mono)">y′ = −y</text>
      </g>, 'Euler / RK2 / RK4 · 步长对照');
    case 'gradient-direction':
    case 'lagrange-multiplier':
      return svg(<g>
        {[0, 1, 2].map((k) => <ellipse key={k} cx="118" cy="74" rx={30 + k * 26} ry={18 + k * 15} fill="none" stroke="var(--hairline-strong)" />)}
        <line x1="118" y1="74" x2="118" y2="26" stroke="var(--color-coral)" strokeWidth="2" />
        <path d="M118 26 113 38 123 38Z" fill="var(--color-coral)" />
        <line x1="92" y1="36" x2="158" y2="72" stroke="var(--ink-400)" strokeDasharray="3 3" />
        <text x="126" y="30" fontSize="8" fill="var(--color-coral-ink)" fontFamily="var(--font-family-mono)">∇f</text>
        <text x="137" y="21" fontSize="9" fill="var(--ink-400)" fontFamily="var(--font-family-mono)">{template.kind === 'lagrange-multiplier' ? '∇f = λ∇g' : 'D_θ f = ∇f · u'}</text>
      </g>, template.kind === 'lagrange-multiplier' ? '约束曲线 · 梯度平行条件' : '方向导数 · 梯度与等高线');
    case 'double-green':
      return svg(<g>
        <line x1="34" y1="112" x2="226" y2="112" stroke="var(--hairline-strong)" />
        <line x1="34" y1="112" x2="34" y2="22" stroke="var(--hairline-strong)" />
        {[0, 1, 2, 3, 4].flatMap((row) => [0, 1, 2, 3, 4].map((col) => {
          const inside = row + col < 5;
          return <rect key={`${row}-${col}`} x={40 + col * 26} y={100 - row * 18} width="24" height="16" rx="2"
            fill={inside ? 'var(--color-coral)' : 'var(--paper-0)'} fillOpacity={inside ? .22 : 1}
            stroke={inside ? 'var(--color-coral)' : 'var(--hairline)'} />;
        }))}
        <text x="148" y="36" fontSize="8" fill="var(--ink-400)" fontFamily="var(--font-family-mono)">r dr dθ</text>
        <text x="137" y="21" fontSize="9" fill="var(--ink-400)" fontFamily="var(--font-family-mono)">∮ Pdx + Qdy</text>
      </g>, '极坐标 Jacobian · 环量与旋度');
    case 'basis-change':
    case 'eigen-transform':
    case 'svd-steps': {
      const label = template.kind === 'basis-change' ? '[v]β = P[v]α · 双坐标系'
        : template.kind === 'eigen-transform' ? 'Av = λv · 特征方向'
          : 'A = UΣVᵀ · 三步分解与低秩重构';
      return svg(<g>
        <path d="M60 100 96 100 96 64 60 64Z" fill="none" stroke="var(--ink-300)" strokeDasharray="3 3" />
        <path d="M60 100 128 82 146 26 78 44Z" fill="var(--color-coral)" fillOpacity=".14" stroke="var(--color-coral)" strokeWidth="1.6" />
        {[0.25, 0.5, 0.75].map((t) => <g key={t}>
          <line x1={60 + 68 * t} y1={100 - 18 * t} x2={78 + 68 * t} y2={44 - 18 * t} stroke="var(--ink-300)" opacity=".35" />
          <line x1={60 + 18 * t} y1={100 - 56 * t} x2={128 + 18 * t} y2={82 - 56 * t} stroke="var(--ink-300)" opacity=".35" />
        </g>)}
        <line x1="60" y1="100" x2="130" y2="84" stroke="var(--ink-700)" strokeWidth="1.6" />
        <path d="M134 82 126 79 129 88Z" fill="var(--ink-700)" />
        <text x="152" y="34" fontSize="8" fill="var(--color-coral-ink)" fontFamily="var(--font-family-mono)">A · v</text>
      </g>, label);
    }
    default:
      return svg(<g>
        {['输入', '模型', '分析', '对照'].map((label, index) => <g key={label}>
          <rect x={22 + index * 58} y="48" width="46" height="32" rx="5" fill={index === 1 ? 'var(--color-coral)' : 'var(--paper-0)'} fillOpacity={index === 1 ? .14 : 1} stroke="var(--hairline-strong)" />
          <text x={45 + index * 58} y="68" textAnchor="middle" fontSize="8" fill="var(--ink-500)">{label}</text>
          {index < 3 ? <line x1={68 + index * 58} y1="64" x2={80 + index * 58} y2="64" stroke="var(--color-coral)" /> : null}
        </g>)}
      </g>, '已连线 · 可复算的数学管线');
  }
}

function Lab408Preview({ kind }: { kind: Lab408PreviewKind }): JSX.Element {
  if (kind === 'tree') {
    return <svg viewBox="0 0 260 140" aria-hidden="true" focusable="false">
      <line x1="130" y1="36" x2="92" y2="76" stroke="var(--hairline-strong)" strokeWidth="1.4" />
      <line x1="130" y1="36" x2="168" y2="76" stroke="var(--hairline-strong)" strokeWidth="1.4" />
      <line x1="92" y1="76" x2="66" y2="112" stroke="var(--hairline-strong)" strokeWidth="1.4" />
      <line x1="92" y1="76" x2="118" y2="112" stroke="var(--hairline-strong)" strokeWidth="1.4" />
      {[['130', 36, 'A'], ['92', 76, 'B'], ['168', 76, 'C'], ['66', 112, 'D'], ['118', 112, 'E']].map(([x, y, label]) => <g key={label}>
        <circle cx={Number(x)} cy={Number(y)} r="13" fill="var(--paper-0)" stroke={label === 'A' ? 'var(--color-coral)' : 'var(--hairline-strong)'} strokeWidth="1.4" />
        <text x={Number(x)} y={Number(y) + 3} textAnchor="middle" fontSize="9" fill="var(--ink-700)">{label}</text>
      </g>)}
      <text x="144" y="130" fontSize="8" fill="var(--ink-300)" fontFamily="var(--font-family-mono)">先序 / 中序 / 后序 / 层序</text>
    </svg>;
  }
  if (kind === 'kmp') {
    return <svg viewBox="0 0 260 140" aria-hidden="true" focusable="false">
      {['A', 'B', 'A', 'B', 'A', 'B', 'C'].map((char, index) => <g key={index}>
        <rect x={30 + index * 18} y="44" width="16" height="20" rx="3" fill={index < 5 ? 'var(--color-coral)' : 'var(--paper-0)'} fillOpacity={index < 5 ? .18 : 1} stroke="var(--hairline-strong)" />
        <text x={38 + index * 18} y="58" textAnchor="middle" fontSize="8" fill="var(--ink-700)">{char}</text>
      </g>)}
      {[-1, 0, 0, 1, 2, 3, 1].map((value, index) => <text key={index} x={38 + index * 18} y="86" textAnchor="middle" fontSize="7.5" fill="var(--ink-400)" fontFamily="var(--font-family-mono)">{value}</text>)}
      <text x="30" y="110" fontSize="8" fill="var(--ink-300)" fontFamily="var(--font-family-mono)">next[j] · 失配只回退模式指针</text>
    </svg>;
  }
  if (kind === 'sort') {
    const bars = [5, 2, 9, 1, 5, 6];
    return <svg viewBox="0 0 260 140" aria-hidden="true" focusable="false">
      <line x1="30" y1="112" x2="230" y2="112" stroke="var(--hairline-strong)" />
      {bars.map((value, index) => <rect key={index} x={38 + index * 32} y={112 - value * 8} width="22" height={value * 8} rx="3"
        fill={index === 2 ? 'var(--color-coral)' : 'var(--ink-300)'} fillOpacity={index === 2 ? .8 : .35} />)}
      <text x="30" y="130" fontSize="8" fill="var(--ink-300)" fontFamily="var(--font-family-mono)">比较 · 交换 · 枢轴归位</text>
    </svg>;
  }
  if (kind === 'graph') {
    const nodes: [number, number, string][] = [[40, 62, 'A'], [110, 32, 'B'], [110, 96, 'C'], [200, 66, 'D']];
    return <svg viewBox="0 0 260 140" aria-hidden="true" focusable="false">
      {nodes.map(([x, y, label], index) => <g key={label}>
        {nodes.slice(index + 1).map(([tx, ty, target]) => <line key={target} x1={x} y1={y} x2={tx} y2={ty} stroke="var(--hairline-strong)" strokeWidth="1.2" />)}
        <circle cx={x} cy={y} r="12" fill="var(--paper-0)" stroke={index === 0 ? 'var(--color-coral)' : 'var(--hairline-strong)'} strokeWidth="1.4" />
        <text x={x} y={y + 3} textAnchor="middle" fontSize="8.5" fill="var(--ink-700)">{label}</text>
      </g>)}
      <text x="74" y="54" fontSize="7" fill="var(--ink-300)" fontFamily="var(--font-family-mono)">4</text>
      <text x="74" y="92" fontSize="7" fill="var(--ink-300)" fontFamily="var(--font-family-mono)">2</text>
      <text x="152" y="44" fontSize="7" fill="var(--ink-300)" fontFamily="var(--font-family-mono)">7</text>
      <text x="160" y="94" fontSize="7" fill="var(--ink-300)" fontFamily="var(--font-family-mono)">1</text>
      <text x="30" y="132" fontSize="8" fill="var(--ink-300)" fontFamily="var(--font-family-mono)">dist 更新 · 松弛</text>
    </svg>;
  }
  if (kind === 'cache') {
    return <svg viewBox="0 0 260 140" aria-hidden="true" focusable="false">
      {[0, 1, 2].map((set) => <g key={set}>
        {[0, 1, 2, 3].map((way) => <rect key={way} x={34 + way * 48} y={28 + set * 26} width="42" height="20" rx="3"
          fill={set === 1 && way === 2 ? 'var(--color-coral)' : 'var(--paper-0)'}
          fillOpacity={set === 1 && way === 2 ? .18 : 1}
          stroke={set === 1 && way === 2 ? 'var(--color-coral)' : 'var(--hairline)'} />)}
      </g>)}
      <text x="34" y="122" fontSize="8" fill="var(--ink-300)" fontFamily="var(--font-family-mono)">命中 3 · 缺失 5 · 4 路</text>
      <text x="182" y="122" fontSize="8" fill="var(--ink-300)" fontFamily="var(--font-family-mono)">LRU 淘汰</text>
    </svg>;
  }
  if (kind === 'pipeline') {
    return <svg viewBox="0 0 260 140" aria-hidden="true" focusable="false">
      {['IF', 'ID', 'EX', 'MEM', 'WB'].map((stage, index) => <g key={stage}>
        <text x="30" y={44 + index * 18} fontSize="7.5" fill="var(--ink-400)" fontFamily="var(--font-family-mono)">{stage}</text>
        {[0, 1, 2, 3].map((cycle) => <rect key={cycle} x={56 + (cycle + 4 - index) * 22} y={34 + index * 18} width="20" height="13" rx="2"
          fill={index === 2 && cycle === 0 ? 'var(--color-coral)' : 'var(--ink-300)'}
          fillOpacity={index === 2 && cycle === 0 ? .8 : .3} />)}
      </g>)}
      <text x="56" y="132" fontSize="8" fill="var(--ink-300)" fontFamily="var(--font-family-mono)">IF · ID · EX · MEM · WB</text>
    </svg>;
  }
  if (kind === 'ieee') {
    return <svg viewBox="0 0 260 140" aria-hidden="true" focusable="false">
      <rect x="30" y="46" width="22" height="26" fill="var(--ink-300)" opacity=".8" />
      <rect x="52" y="46" width="70" height="26" fill="var(--color-coral)" opacity=".82" />
      <rect x="122" y="46" width="112" height="26" fill="var(--color-indigo)" opacity=".82" />
      <text x="41" y="64" textAnchor="middle" fontSize="8" fill="#fff">S</text>
      <text x="87" y="64" textAnchor="middle" fontSize="8" fill="#fff">阶码 8</text>
      <text x="178" y="64" textAnchor="middle" fontSize="8" fill="#fff">尾数 23</text>
      <text x="30" y="92" fontSize="8" fill="var(--ink-300)" fontFamily="var(--font-family-mono)">0x3fc00000 → 1.5</text>
      <text x="30" y="112" fontSize="8" fill="var(--ink-300)" fontFamily="var(--font-family-mono)">(−1)^s × 1.M × 2^(E−127)</text>
    </svg>;
  }
  if (kind === 'split') {
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
  if (kind === 'cpu') {
    const rows: [string, number, number][] = [['P1', 0, 3], ['P2', 3, 2], ['P3', 5, 1]];
    return <svg viewBox="0 0 260 140" aria-hidden="true" focusable="false">
      {rows.map(([label, start, width], index) => <g key={label}>
        <text x="30" y={44 + index * 26} fontSize="8" fill="var(--ink-400)" fontFamily="var(--font-family-mono)">{label}</text>
        <rect x={54 + start * 28} y={32 + index * 26} width={width * 28} height="16" rx="3"
          fill={index === 0 ? 'var(--color-coral)' : 'var(--paper-0)'}
          fillOpacity={index === 0 ? .18 : 1}
          stroke={index === 0 ? 'var(--color-coral)' : 'var(--hairline-strong)'} />
      </g>)}
      <text x="30" y="126" fontSize="8" fill="var(--ink-300)" fontFamily="var(--font-family-mono)">FCFS / SJF / SRTF / RR · 周转时间</text>
    </svg>;
  }
  if (kind === 'banker') {
    return <svg viewBox="0 0 260 140" aria-hidden="true" focusable="false">
      {[0, 1, 2, 3].map((row) => <g key={row}>
        {[0, 1, 2].map((col) => <rect key={col} x={40 + col * 44} y={28 + row * 22} width="40" height="18" rx="3"
          fill={row === 1 ? 'var(--color-coral)' : 'var(--paper-0)'}
          fillOpacity={row === 1 ? .14 : 1}
          stroke={row === 1 ? 'var(--color-coral)' : 'var(--hairline)'} />)}
      </g>)}
      <text x="40" y="126" fontSize="8" fill="var(--ink-300)" fontFamily="var(--font-family-mono)">Need ≤ Work 才可推进</text>
      <text x="196" y="126" fontSize="8" fill="var(--ink-300)" fontFamily="var(--font-family-mono)">安全序列</text>
    </svg>;
  }
  if (kind === 'page') {
    return <svg viewBox="0 0 260 140" aria-hidden="true" focusable="false">
      {[0, 1, 2].map((row) => <g key={row}>
        {[0, 1, 2, 3].map((col) => <rect key={col} x={38 + col * 46} y={30 + row * 30} width="38" height="22" rx="3"
          fill={row === 1 && col === 2 ? 'var(--color-coral)' : 'var(--paper-0)'}
          fillOpacity={row === 1 && col === 2 ? .16 : 1}
          stroke={row === 1 && col === 2 ? 'var(--color-coral)' : 'var(--hairline-strong)'} />)}
      </g>)}
      <text x="38" y="128" fontSize="8" fill="var(--ink-300)" fontFamily="var(--font-family-mono)">缺页 9 / 12 · FIFO</text>
      <text x="184" y="128" fontSize="8" fill="var(--ink-300)" fontFamily="var(--font-family-mono)">LRU · OPT</text>
    </svg>;
  }
  if (kind === 'tcp') {
    return <svg viewBox="0 0 260 140" aria-hidden="true" focusable="false">
      <path d="M30 106V24M30 106H238" fill="none" stroke="var(--hairline-strong)" />
      <path d="M32 100 58 82 84 52 104 40 132 58 160 50 196 56 232 76" fill="none" stroke="var(--color-coral)" strokeWidth="1.8" strokeLinejoin="round" />
      <line x1="30" y1="46" x2="238" y2="46" stroke="var(--hairline-strong)" strokeDasharray="3 4" />
      <text x="192" y="40" fontSize="7" fill="var(--ink-300)" fontFamily="var(--font-family-mono)">ssthresh</text>
      <circle cx="104" cy="40" r="3" fill="var(--color-coral)" />
      <text x="108" y="32" fontSize="7" fill="var(--color-coral-ink)" fontFamily="var(--font-family-mono)">3ack</text>
      <circle cx="232" cy="76" r="3" fill="var(--color-indigo)" />
      <text x="196" y="90" fontSize="7" fill="var(--ink-300)" fontFamily="var(--font-family-mono)">timeout</text>
    </svg>;
  }
  if (kind === 'window') {
    return <svg viewBox="0 0 260 140" aria-hidden="true" focusable="false">
      {[0, 1, 2, 3, 4, 5, 6].map((index) => <g key={index}>
        <rect x={34 + index * 28} y="50" width="24" height="22" rx="3"
          fill={index >= 1 && index <= 4 ? 'var(--color-coral)' : 'var(--paper-0)'}
          fillOpacity={index >= 1 && index <= 4 ? .18 : 1}
          stroke={index >= 1 && index <= 4 ? 'var(--color-coral)' : 'var(--hairline-strong)'} />
        <text x={46 + index * 28} y="65" textAnchor="middle" fontSize="8" fill="var(--ink-700)">{index}</text>
      </g>)}
      <path d="M62 44h100" stroke="var(--color-coral)" strokeDasharray="3 3" />
      <text x="34" y="34" fontSize="7.5" fill="var(--color-coral-ink)" fontFamily="var(--font-family-mono)">发送窗口</text>
      <text x="34" y="100" fontSize="8" fill="var(--ink-300)" fontFamily="var(--font-family-mono)">GBN 重传整窗 · SR 只补丢帧</text>
      <path d="M150 104q16 12 30 0" fill="none" stroke="var(--ink-400)" strokeWidth="1.2" />
    </svg>;
  }
  if (kind === 'btree') {
    return <svg viewBox="0 0 260 140" aria-hidden="true" focusable="false">
      <path d="M130 24V62M130 62 82 96M130 62 178 96" fill="none" stroke="var(--hairline-strong)" strokeWidth="1.4" />
      <rect x="92" y="10" width="76" height="28" rx="5" fill="var(--color-coral)" fillOpacity=".12" stroke="var(--color-coral)" />
      <text x="130" y="29" textAnchor="middle" fontSize="8" fill="var(--color-coral-ink)" fontFamily="var(--font-family-mono)">[17]</text>
      {[82, 178].map((x) => <g key={x}>
        <rect x={x - 32} y="90" width="64" height="26" rx="5" fill="var(--paper-0)" stroke="var(--hairline-strong)" />
        <text x={x} y="108" textAnchor="middle" fontSize="7.5" fill="var(--ink-500)" fontFamily="var(--font-family-mono)">[5|7]</text>
      </g>)}
      <text x="30" y="132" fontSize="7.5" fill="var(--ink-300)" fontFamily="var(--font-family-mono)">分裂 · 中间键上移 · B / B+ 对照</text>
    </svg>;
  }
  if (kind === 'hash') {
    return <svg viewBox="0 0 260 140" aria-hidden="true" focusable="false">
      {[0, 1, 2, 3, 4].map((index) => <g key={index}>
        <rect x="30" y={22 + index * 19} width="34" height="15" rx="3" fill={index === 2 ? 'var(--color-coral)' : 'var(--paper-0)'} fillOpacity={index === 2 ? .18 : 1} stroke={index === 2 ? 'var(--color-coral)' : 'var(--hairline-strong)'} />
        <text x="47" y={33 + index * 19} textAnchor="middle" fontSize="7" fill="var(--ink-500)" fontFamily="var(--font-family-mono)">{index}</text>
      </g>)}
      <path d="M64 60h28M92 60h28" stroke="var(--hairline-strong)" strokeDasharray="3 3" />
      {[19, 27].map((value, index) => <g key={value}>
        <rect x={94 + index * 34} y="52" width="28" height="16" rx="3" fill="var(--color-indigo)" fillOpacity=".16" stroke="var(--color-indigo)" />
        <text x={108 + index * 34} y="63" textAnchor="middle" fontSize="7" fill="var(--ink-500)" fontFamily="var(--font-family-mono)">{value}</text>
      </g>)}
      <text x="30" y="126" fontSize="7.5" fill="var(--ink-300)" fontFamily="var(--font-family-mono)">探测 / 链地址 · ASL 对比</text>
    </svg>;
  }
  if (kind === 'datapath') {
    return <svg viewBox="0 0 260 140" aria-hidden="true" focusable="false">
      {[['PC', 34, 42], ['IMEM', 88, 24], ['Reg', 88, 82], ['ALU', 158, 54], ['DMEM', 216, 24], ['WB', 216, 94]].map(([label, x, y]) => <g key={String(label)}>
        <rect x={Number(x) - 22} y={Number(y) - 12} width="44" height="24" rx="4" fill={label === 'ALU' ? 'var(--color-coral)' : 'var(--paper-0)'} fillOpacity={label === 'ALU' ? .16 : 1} stroke={label === 'ALU' ? 'var(--color-coral)' : 'var(--hairline-strong)'} />
        <text x={Number(x)} y={Number(y) + 3} textAnchor="middle" fontSize="7" fill="var(--ink-500)" fontFamily="var(--font-family-mono)">{label}</text>
      </g>)}
      <path d="M56 42h10M110 24h30M110 82h26M180 54h14M158 66v18h36M216 36v46" fill="none" stroke="var(--color-indigo)" strokeWidth="1.3" strokeDasharray="3 3" />
      <text x="26" y="128" fontSize="7.5" fill="var(--ink-300)" fontFamily="var(--font-family-mono)">IF · ID · EX · MEM · WB</text>
    </svg>;
  }
  if (kind === 'booth') {
    return <svg viewBox="0 0 260 140" aria-hidden="true" focusable="false">
      {['A', 'Q', 'Q₋₁'].map((label, index) => <g key={label}>
        <rect x={34 + index * 62} y="30" width="52" height="30" rx="4" fill={index === 1 ? 'var(--color-coral)' : 'var(--paper-0)'} fillOpacity={index === 1 ? .16 : 1} stroke={index === 1 ? 'var(--color-coral)' : 'var(--hairline-strong)'} />
        <text x={60 + index * 62} y="49" textAnchor="middle" fontSize="7.5" fill="var(--ink-500)" fontFamily="var(--font-family-mono)">{label}</text>
      </g>)}
      <path d="M34 76h196M34 76v-8M230 76v-8" stroke="var(--hairline-strong)" />
      <text x="42" y="94" fontSize="7.5" fill="var(--ink-300)" fontFamily="var(--font-family-mono)">01 → +X · 10 → −X · 00/11 → 右移</text>
      <text x="34" y="120" fontSize="7.5" fill="var(--ink-300)" fontFamily="var(--font-family-mono)">双符号位 01 / 10 判溢出</text>
    </svg>;
  }
  if (kind === 'disk') {
    return <svg viewBox="0 0 260 140" aria-hidden="true" focusable="false">
      <line x1="24" y1="92" x2="236" y2="92" stroke="var(--hairline-strong)" />
      {[53, 65, 67, 98, 122, 124, 183].map((track, index) => <g key={track}>
        <line x1={24 + track} y1="86" x2={24 + track} y2="98" stroke="var(--hairline-strong)" />
        <circle cx={24 + track} cy={index === 0 ? 72 : 50 - index * 3} r="3" fill={index === 0 ? 'var(--color-coral)' : 'var(--color-indigo)'} />
      </g>)}
      <path d="M77 72 89 50 91 47 122 41 146 29 148 26 207 14" fill="none" stroke="var(--color-coral)" strokeWidth="1.8" />
      <text x="26" y="126" fontSize="7.5" fill="var(--ink-300)" fontFamily="var(--font-family-mono)">FCFS · SSTF · SCAN · C-SCAN</text>
    </svg>;
  }
  if (kind === 'pv') {
    return <svg viewBox="0 0 260 140" aria-hidden="true" focusable="false">
      {[0, 1, 2].map((index) => <rect key={index} x={68 + index * 42} y="44" width="36" height="30" rx="4"
        fill={index < 2 ? 'var(--color-coral)' : 'var(--paper-0)'} fillOpacity={index < 2 ? .16 : 1}
        stroke={index < 2 ? 'var(--color-coral)' : 'var(--hairline-strong)'} />)}
      <text x="130" y="30" textAnchor="middle" fontSize="8" fill="var(--ink-400)" fontFamily="var(--font-family-mono)">缓冲区</text>
      <text x="30" y="96" fontSize="7.5" fill="var(--ink-400)" fontFamily="var(--font-family-mono)">P(empty) · P(mutex)</text>
      <text x="30" y="112" fontSize="7.5" fill="var(--ink-400)" fontFamily="var(--font-family-mono)">顺序写反 → 持锁等待死锁</text>
      <path d="M44 72h18M198 72h18" stroke="var(--color-indigo)" strokeWidth="1.4" />
    </svg>;
  }
  if (kind === 'csma') {
    return <svg viewBox="0 0 260 140" aria-hidden="true" focusable="false">
      <line x1="26" y1="76" x2="234" y2="76" stroke="var(--ink-500)" strokeWidth="1.8" />
      <circle cx="34" cy="76" r="5" fill="var(--color-coral)" /><text x="34" y="62" textAnchor="middle" fontSize="7" fill="var(--ink-400)" fontFamily="var(--font-family-mono)">A</text>
      <circle cx="226" cy="76" r="5" fill="var(--color-indigo)" /><text x="226" y="62" textAnchor="middle" fontSize="7" fill="var(--ink-400)" fontFamily="var(--font-family-mono)">B</text>
      <path d="M42 68 112 70M218 68 132 70" stroke="var(--color-coral)" strokeWidth="2" />
      <path d="M122 56 132 70 122 84" fill="none" stroke="var(--color-coral)" strokeWidth="2" />
      <text x="112" y="44" fontSize="7" fill="var(--color-coral-ink)" fontFamily="var(--font-family-mono)">碰撞点</text>
      <text x="26" y="110" fontSize="7.5" fill="var(--ink-300)" fontFamily="var(--font-family-mono)">Ttrans ≥ 2τ 才能可靠检测</text>
    </svg>;
  }
  if (kind === 'routing') {
    return <svg viewBox="0 0 260 140" aria-hidden="true" focusable="false">
      {['R1', 'R2', 'R3', 'R4', 'R5'].map((label, index) => <g key={label}>
        <circle cx={36 + index * 47} cy="72" r="15" fill={index === 0 ? 'var(--color-coral)' : 'var(--paper-0)'} fillOpacity={index === 0 ? .18 : 1} stroke={index === 0 ? 'var(--color-coral)' : 'var(--hairline-strong)'} strokeWidth="1.4" />
        <text x={36 + index * 47} y="76" textAnchor="middle" fontSize="7" fill="var(--ink-600)" fontFamily="var(--font-family-mono)">{label}</text>
      </g>)}
      <line x1="54" y1="72" x2="64" y2="72" stroke="var(--color-coral)" strokeWidth="2" strokeDasharray="4 3" />
      <path d="M58 62 68 82M68 62 58 82" stroke="var(--color-coral)" strokeWidth="1.5" />
      <text x="30" y="116" fontSize="7.5" fill="var(--ink-300)" fontFamily="var(--font-family-mono)">RIP 计数到 16 · OSPF 重算</text>
    </svg>;
  }
  if (kind === 'dnsStack') {
    const layers: [string, string][] = [['HTTP', '#dbe7ff'], ['TCP', '#d6f0d9'], ['IP', '#ffe3d6'], ['MAC', '#f3e8ff']];
    return <svg viewBox="0 0 260 140" aria-hidden="true" focusable="false">
      {layers.map(([name, fill], index) => <g key={name}>
        <rect x={34 + index * 20} y={34 + index * 20} width={156 - index * 20} height="18" rx="4" fill={fill} stroke="var(--hairline-strong)" />
        <text x={42 + index * 20} y={47 + index * 20} fontSize="7.5" fill="var(--ink-600)" fontFamily="var(--font-family-mono)">{name}</text>
      </g>)}
      <text x="30" y="128" fontSize="7.5" fill="var(--ink-300)" fontFamily="var(--font-family-mono)">DNS → HTTP · 逐层封装 · RTT 对账</text>
    </svg>;
  }
  return <svg viewBox="0 0 260 140" aria-hidden="true" focusable="false">
    <text x="30" y="34" fontSize="9" fill="var(--ink-400)" fontFamily="var(--font-family-mono)">192.168.1.0/24</text>
    {[0, 1, 2, 3].map((index) => <g key={index}>
      <rect x={30 + index * 50} y={50} width="42" height="34" rx="4" fill={index === 2 ? 'var(--color-coral)' : 'var(--paper-0)'} fillOpacity={index === 2 ? .14 : 1} stroke={index === 2 ? 'var(--color-coral)' : 'var(--hairline-strong)'} />
      <text x={51 + index * 50} y={70} textAnchor="middle" fontSize="7.5" fill="var(--ink-500)" fontFamily="var(--font-family-mono)">/26</text>
      <text x={51 + index * 50} y={80} textAnchor="middle" fontSize="6.5" fill="var(--ink-300)" fontFamily="var(--font-family-mono)">.{(index * 64).toString().padStart(3, '0')}</text>
    </g>)}
    <text x="30" y="114" fontSize="8" fill="var(--ink-300)" fontFamily="var(--font-family-mono)">网络地址 · 广播地址 · 可用范围</text>
  </svg>;
}

/* ---------- 专题目录：各分类的专题与条目 ---------- */

export { CALCULUS_TOPICS, LAB408_TOPICS };

const CALCULUS_ITEMS: readonly CatalogItem[] = VISIBLE_CALCULUS_TEMPLATES.map((t) => ({
  key: t.kind,
  topic: t.topic,
  name: t.name,
  desc: t.desc,
  tag: t.tag,
  formula: t.formula,
  panorama: t.panorama,
  preview: <CalculusPreview template={t} />,
}));

const PHYSICS_ITEMS: readonly CatalogItem[] = VISIBLE_PHYSICS_TEMPLATES.map((t) => ({
  key: t.kind,
  topic: t.topic,
  name: t.name,
  desc: t.desc,
  tag: t.tag,
  formula: t.formula ?? workshopFormula(t.kind),
  panorama: t.panorama,
  preview: <PhysicsPreview template={t} />,
}));

const LAB408_ITEMS: readonly CatalogItem[] = VISIBLE_LAB408_TEMPLATES.map((t) => ({
  key: t.kind,
  topic: t.topic,
  name: t.name,
  desc: t.desc,
  tag: t.tag,
  formula: t.formula ?? workshopFormula(t.kind),
  panorama: t.panorama,
  preview: <Lab408Preview kind={t.preview} />,
}));

const DEEP_ITEMS: readonly CatalogItem[] = DEEP_TEMPLATES.map((t) => ({
  key: t.kind,
  topic: t.topic,
  name: t.name,
  desc: t.desc,
  tag: t.tag,
  preview: <DeepPreview template={t} />,
}));

function BusinessPreview({ kind }: { kind: BusinessPreviewKind }): JSX.Element {
  const axes = <path d="M16 78H160M16 12V78" stroke="var(--hairline)" />;
  switch (kind) {
    case 'sensGrid': return <svg viewBox="0 0 176 88" fill="none">{axes}
      {[0, 1, 2].map((r) => [0, 1, 2, 3].map((c) =>
        <rect key={`${r}-${c}`} x={36 + c * 30} y={18 + r * 18} width={26} height={14} rx={2}
          fill={(r + c) % 3 === 0 ? '#b15236' : '#13746d'} opacity={0.25 + 0.15 * ((r * 4 + c) % 4)} />))}
      <rect x={66} y={36} width={26} height={14} rx={2} fill="none" stroke="#344153" strokeWidth={1.6} /></svg>;
    case 'npv': return <svg viewBox="0 0 176 88" fill="none">{axes}
      <path d="M24 70C60 70 70 34 100 34S140 22 152 20" stroke="#13746d" strokeWidth={2.5} strokeLinecap="round" />
      <path d="M24 74C60 74 72 52 104 50S142 40 152 38" stroke="#b15236" strokeWidth={2.5} strokeDasharray="5 4" strokeLinecap="round" />
      <path d="M16 54H160" stroke="#9aa7b5" strokeDasharray="3 4" /></svg>;
    case 'cohort': return <svg viewBox="0 0 176 88" fill="none">{axes}
      {[0, 1, 2, 3].map((r) => [0, 1, 2, 3].map((c) => c <= 3 - r ?
        <rect key={`${r}-${c}`} x={30 + c * 30} y={16 + r * 16} width={24} height={12} rx={2}
          fill="#13746d" opacity={Math.max(0.15, 0.85 - c * 0.22)} /> : null))}</svg>;
    case 'abCurve': return <svg viewBox="0 0 176 88" fill="none">{axes}
      <path d="M24 74C48 74 44 30 68 30S92 74 112 74" stroke="#13746d" strokeWidth={2.5} strokeLinecap="round" />
      <path d="M64 74C88 74 84 24 108 24S132 74 152 74" stroke="#b15236" strokeWidth={2.5} strokeLinecap="round" /></svg>;
    case 'gantt': return <svg viewBox="0 0 176 88" fill="none">{axes}
      <rect x={30} y={20} width={36} height={12} rx={3} fill="#13746d" />
      <rect x={66} y={38} width={52} height={12} rx={3} fill="#b15236" />
      <rect x={118} y={56} width={28} height={12} rx={3} fill="#c08814" />
      <rect x={66} y={56} width={30} height={12} rx={3} fill="#13746d" opacity={0.45} /></svg>;
    case 'eoqQueue': return <svg viewBox="0 0 176 88" fill="none">{axes}
      <path d="M30 22C60 60 80 74 96 66S140 30 152 20" stroke="#13746d" strokeWidth={2.5} strokeLinecap="round" />
      <path d="M24 66C70 66 120 66 140 40S152 30 156 26" stroke="#b15236" strokeWidth={2.5} strokeLinecap="round" />
      <circle cx={96} cy={66} r={4} fill="#c08814" /></svg>;
    case 'decMatrix': return <svg viewBox="0 0 176 88" fill="none">{axes}
      {[58, 40, 68, 30].map((h, i) => <rect key={i} x={34 + i * 32} y={78 - h} width={22} height={h} rx={3}
        fill={i === 2 ? '#b15236' : '#13746d'} opacity={i === 2 ? 0.9 : 0.55} />)}</svg>;
    case 'pareto': return <svg viewBox="0 0 176 88" fill="none">{axes}
      <path d="M30 72C70 60 110 40 152 26" stroke="#9aa7b5" strokeWidth={2} strokeDasharray="4 4" />
      {[0.95, 0.75, 0.55, 0.35, 0.15].map((t, i) =>
        <circle key={i} cx={30 + t * 122} cy={72 - t * 46} r={4} fill={i === 2 ? '#c08814' : '#4f46e5'} />)}</svg>;
    default: return <svg viewBox="0 0 176 88" fill="none">{axes}
      <path d="M29 74L150 16" stroke="#13746d" strokeWidth={2.5} strokeLinecap="round" />
      <path d="M29 57L150 35" stroke="#b15236" strokeWidth={2.5} strokeLinecap="round" /></svg>;
  }
}

const BUSINESS_ITEMS: readonly CatalogItem[] = VISIBLE_BUSINESS_TEMPLATES.map((t) => ({
  key: t.kind, topic: t.topic, name: t.name, desc: t.desc, tag: t.tag, formula: t.formula,
  panorama: t.panorama,
  preview: <BusinessPreview kind={t.preview} />,
}));

function LinalgPreview({ kind }: { kind: LinalgTemplateKind }): JSX.Element {
  const blue = '#2234d4', red = '#b64028', green = '#0f766e', muted = '#a4a6a0';
  const diagrams: Record<LinalgTemplateKind, ReactNode> = {
    'la01-matrix-det-basis': <>
      <path d="M34 25h78v54H34z M60 25v54 M86 25v54 M34 43h78 M34 61h78" stroke={muted} />
      <path d="M55 79h78l27-54H82z M81 79l27-54 M107 79l27-54 M64 61h78 M73 43h78" stroke={blue} />
      <path d="M55 79h26l9-18H64z" fill="#d4d9fb" stroke={blue} />
    </>,
    'la02-gauss-lu-rank': <>
      <path d="M42 25H32v57h10m96-57h10v57h-10M119 27v52" stroke={muted} />
      <path d="M51 36h11m13 0h11m13 0h10m17 0h10M75 53h11m13 0h10m17 0h10M99 70h10m17 0h10" stroke={blue} strokeWidth="4" strokeLinecap="round" />
      <path d="M52 45h16v15h24v17h20" stroke={red} strokeWidth="2" />
    </>,
    'la03-four-subspaces': <>
      <path d="M30 68h42V35 M108 68h42V35" stroke={muted} strokeDasharray="3 3" />
      <path d="M30 42h42 M30 61h42 M108 42h42 M108 61h42" stroke={blue} strokeWidth="5" strokeLinecap="round" />
      <path d="M79 43h21l-6-4m6 4l-6 4M79 61h16" stroke={green} strokeWidth="2" />
      <circle cx="98" cy="61" r="4" fill={red} />
    </>,
    'la04-ortho-qr-ls': <>
      <path d="M29 77 153 33" stroke={blue} strokeWidth="2.5" />
      <path d="M55 26 69 63 M98 79 89 56 M126 23 134 40" stroke={red} strokeWidth="1.5" strokeDasharray="3 3" />
      <path d="m69 63 7-2 2 6" stroke={green} />
      <g fill={red}><circle cx="55" cy="26" r="4" /><circle cx="98" cy="79" r="4" /><circle cx="126" cy="23" r="4" /></g>
    </>,
    'la05-eigen-dynamics': <>
      <path d="M26 53h128M90 20v65" stroke={muted} />
      <path d="M43 80 137 26m-10 2 10-2-5 8M41 31l96 43m-6-8 6 8-10-2" stroke={blue} strokeWidth="2" />
      <path d="M148 63c-25 30-65 16-54-4 6-10 19-7 12 2" stroke={red} strokeWidth="2" />
    </>,
    'la06-quadform-svd-pca': <>
      <circle cx="55" cy="52" r="23" stroke={muted} strokeDasharray="3 3" />
      <path d="M82 53h20l-5-4m5 4-5 4" stroke={green} strokeWidth="1.5" />
      <ellipse cx="127" cy="53" rx="33" ry="14" transform="rotate(-33 127 53)" fill="#d4d9fb" stroke={blue} strokeWidth="2" />
      <path d="m102 69 50-32m-33 5 16 22" stroke={red} strokeWidth="1.5" />
    </>,
  };
  return <svg viewBox="0 0 180 104" fill="none" aria-hidden="true" focusable="false">{diagrams[kind]}</svg>;
}

const LINALG_ITEMS: readonly CatalogItem[] = VISIBLE_LINALG_TEMPLATES.map(t => ({
  key: t.kind, topic: t.topic, name: t.name, desc: t.desc, tag: t.tag, formula: t.formula,
  panorama: t.panorama, preview: <LinalgPreview kind={t.preview} />,
}));

const ALL_TOPICS: readonly WorkshopTopic[] = [...CALCULUS_TOPICS, ...LINALG_TOPICS, ...PHYSICS_TOPICS, ...LAB408_TOPICS, ...DEEP_TOPICS, ...BUSINESS_TOPICS];
const ALL_ITEMS: readonly CatalogItem[] = [...CALCULUS_ITEMS, ...LINALG_ITEMS, ...PHYSICS_ITEMS, ...LAB408_ITEMS, ...DEEP_ITEMS, ...BUSINESS_ITEMS];

const EXTRA_SEARCH: ReadonlyMap<string, string> = new Map([
  ...VISIBLE_CALCULUS_TEMPLATES.map((t) => [t.kind, `${t.question} ${t.observation} ${t.keywords.join(' ')}`] as const),
  ...VISIBLE_LINALG_TEMPLATES.map((t) => [t.kind, `${t.question} ${t.observation} ${t.keywords.join(' ')}`] as const),
  ...DEEP_TEMPLATES.map((t) => [t.kind, `${t.question} ${t.observation} ${t.keywords.join(' ')}`] as const),
  ...PHYSICS_TEMPLATES.map((t) => [t.kind, `${t.question} ${t.observation} ${t.keywords.join(' ')}`] as const),
  ...VISIBLE_LAB408_TEMPLATES.map((t) => [t.kind, `${t.question} ${t.observation} ${t.keywords.join(' ')}`] as const),
  ...VISIBLE_BUSINESS_TEMPLATES.map((t) => [t.kind, `${t.question} ${t.observation} ${t.keywords.join(' ')}`] as const),
]);

function matchesQuery(item: CatalogItem, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true;
  return [item.name, item.desc, item.tag, EXTRA_SEARCH.get(item.key) ?? '']
    .some((text) => text.toLowerCase().includes(normalizedQuery));
}

/* ---------- 专题目录：统一渲染 ---------- */

export interface CatalogCardProps {
  item: CatalogItem;
  disabled: boolean;
  creating: boolean;
  actionLabel: string;
  onCreate: () => void;
}

export function CatalogCard({ item, disabled, creating, actionLabel, onCreate }: CatalogCardProps): JSX.Element {
  const subject = item.tag.split(' · ')[0] ?? '';
  const tone = item.topic.startsWith('dl') ? 'deep' : item.topic.startsWith('p') ? 'physics'
    : item.topic.startsWith('biz-') ? 'business' : item.topic.startsWith('la-') || subject === '高数' || subject === '线代' ? 'math' : 'pipeline';
  const formula = item.formula ?? workshopFormula(item.key);
  return <button type="button" className={styles.tplCard} data-subject={tone} disabled={disabled} onClick={onCreate}>
    <span className={styles.tplPreview}><span className={styles.tplArt} aria-hidden="true">{item.preview}</span>
      <span className={styles.tplMeta}>{item.panorama ? '全景沙盘' : subject}</span>
    </span>
    <span className={styles.tplBody}>
      <span className={styles.tplName}>{item.name}</span>
      <span className={styles.tplDesc}>{item.desc}</span>
      <span className={styles.tplFoot}>
        <span className={styles.templateFormula} title={formula}>{formula}</span>
        <span className={styles.tplGo}>{creating ? '创建中…' : actionLabel}</span>
      </span>
    </span>
  </button>;
}

export interface TopicCatalogProps {
  topics: readonly WorkshopTopic[];
  items: readonly CatalogItem[];
  disabled?: boolean;
  creatingKey?: string | null;
  actionLabel?: string;
  highlightPanoramas?: boolean;
  panoramaTitle?: string;
  onCreate?: (item: CatalogItem) => void;
}

export function TopicCatalog({
  topics,
  items,
  disabled = false,
  creatingKey = null,
  actionLabel = '打开实验 →',
  highlightPanoramas = false,
  panoramaTitle = '高数全景沙盘',
  onCreate,
}: TopicCatalogProps): JSX.Element {
  const knownTopicIds = new Set(topics.map((topic) => topic.id));
  const validItems = items.filter((item) => knownTopicIds.has(item.topic));
  const panoramas = highlightPanoramas ? validItems.filter((item) => item.panorama) : [];
  const cards = (group: readonly CatalogItem[]) => <div className={styles.tplGrid}>
    {group.map((item) => <CatalogCard key={item.key} item={item} disabled={disabled}
      creating={creatingKey === item.key} actionLabel={actionLabel}
      onCreate={() => onCreate?.(item)} />)}
  </div>;
  return <div className={styles.topicCatalog}>
    {panoramas.length > 0 && <section className={styles.topicGroup} aria-labelledby="subject-panoramas">
      <header className={styles.topicHead}><h3 id="subject-panoramas">{panoramaTitle}</h3></header>
      {cards(panoramas)}
    </section>}
    {topics.map((topic) => {
      const grouped = validItems.filter((item) => item.topic === topic.id && (!highlightPanoramas || !item.panorama));
      if (!grouped.length) return null;
      return <section key={topic.id} className={styles.topicGroup} aria-labelledby={`topic-${topic.id}`}>
        <header className={styles.topicHead}>
          <h3 id={`topic-${topic.id}`}>{topic.name}</h3>
          <span className={styles.countPill}>{grouped.length} 个实验</span>
        </header>
        {cards(grouped)}
      </section>;
    })}
  </div>;
}

/* ---------- 页面 ---------- */

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

const WORKSHOP_RETURN_KEY = 'xiangsheng.workshop.returnState';

interface WorkshopReturnState {
  subject: TemplateCategory;
  topic: string;
  q: string;
  scrollY: number;
}

function readWorkshopReturnState(): WorkshopReturnState | null {
  try {
    const raw = window.sessionStorage.getItem(WORKSHOP_RETURN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WorkshopReturnState>;
    const subject = parsed.subject;
    const validSubject: TemplateCategory =
      subject === 'calculus' || subject === 'linalg' || subject === 'mechanics' || subject === 'lab408'
      || subject === 'deep' || subject === 'business' || subject === 'all'
        ? subject : 'calculus';
    return {
      subject: validSubject,
      topic: typeof parsed.topic === 'string' ? parsed.topic : '',
      q: typeof parsed.q === 'string' ? parsed.q : '',
      scrollY: typeof parsed.scrollY === 'number' && Number.isFinite(parsed.scrollY) ? Math.max(0, parsed.scrollY) : 0,
    };
  } catch {
    return null;
  }
}

function writeWorkshopReturnState(state: WorkshopReturnState): void {
  try {
    window.sessionStorage.setItem(WORKSHOP_RETURN_KEY, JSON.stringify(state));
  } catch {
    /* ignore storage failures */
  }
}

export function WorkshopPage(): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const navigationType = useNavigationType();
  const [searchParams, setSearchParams] = useSearchParams();
  const savedReturn = useRef<WorkshopReturnState | null>(readWorkshopReturnState());
  const hasExplicitParams = searchParams.has('subject') || searchParams.has('topic') || searchParams.has('q');
  const [works, setWorks] = useState<WorkSummary[] | null>(null);
  const [gallery, setGallery] = useState<ShareSummary[] | null>(null);
  const [category, setCategory] = useState<TemplateCategory>(() => {
    const subject = searchParams.get('subject');
    if (subject === 'calculus' || subject === 'linalg' || subject === 'mechanics' || subject === 'lab408' || subject === 'deep' || subject === 'business' || subject === 'all') {
      return subject;
    }
    return !hasExplicitParams && savedReturn.current ? savedReturn.current.subject : 'calculus';
  });
  const [query, setQuery] = useState(() => {
    const q = searchParams.get('q');
    if (q !== null) return q;
    return !hasExplicitParams && savedReturn.current ? savedReturn.current.q : '';
  });
  const [topicFilter, setTopicFilter] = useState(() => {
    const topic = searchParams.get('topic');
    if (topic !== null) return topic;
    return !hasExplicitParams && savedReturn.current ? savedReturn.current.topic : '';
  });
  const [topicAliases, setTopicAliases] = useState<TopicAliases>(() => readTopicAliases());

  const [loadError, setLoadError] = useState('');
  const loadWorks = (): void => {
    setLoadError('');
    worksApi.list().then((r) => setWorks(r.works)).catch(() => setLoadError('作品列表加载失败，请重试。'));
    worksApi.gallery().then((r) => setGallery(r.items)).catch(() => setLoadError('公开作品加载失败，请重试。'));
  };
  useEffect(loadWorks, []);

  // 恢复上次在定象坊目录的滚动位置
  const restoreScroll = useRef(navigationType === 'POP' || location.state?.restoreScroll === true);
  useEffect(() => {
    const saved = savedReturn.current;
    if (!restoreScroll.current || !saved || saved.scrollY <= 0) return;
    const raf = window.requestAnimationFrame(() => {
      window.scrollTo({ top: saved.scrollY, left: 0, behavior: 'auto' });
    });
    return () => window.cancelAnimationFrame(raf);
  }, []);

  // 离开页面前自动记忆当前筛选与滚动位置
  const stateRef = useRef({ category, topicFilter, query });
  stateRef.current = { category, topicFilter, query };
  const saveReturnSnapshot = useCallback((): string => {
    const { category: curSubject, topicFilter: curTopic, query: curQuery } = stateRef.current;
    writeWorkshopReturnState({
      subject: curSubject,
      topic: curTopic,
      q: curQuery,
      scrollY: window.scrollY,
    });
    const next = new URLSearchParams();
    next.set('subject', curSubject);
    if (curTopic) next.set('topic', curTopic);
    if (curQuery.trim()) next.set('q', curQuery);
    const qs = next.toString();
    return qs ? `/workshop?${qs}` : location.pathname + location.search;
  }, [location.pathname, location.search]);

  useLayoutEffect(() => () => {
    const { category: curSubject, topicFilter: curTopic, query: curQuery } = stateRef.current;
    writeWorkshopReturnState({
      subject: curSubject,
      topic: curTopic,
      q: curQuery,
      scrollY: window.scrollY,
    });
  }, []);

  const fromTemplate = useCallback((kind: TemplateKind) => {
    const from = saveReturnSnapshot();
    navigate(`/canvas?template=${encodeURIComponent(kind)}`, {
      flushSync: true,
      state: { from, fromLabel: '← 定象坊目录', restoreScroll: true },
    });
  }, [navigate, saveReturnSnapshot]);

  const selectCategory = useCallback((key: TemplateCategory) => {
    setCategory(key);
    setTopicFilter('');
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('subject', key);
      next.delete('topic');
      if (query.trim()) next.set('q', query); else next.delete('q');
      return next;
    }, { replace: true, preventScrollReset: true });
  }, [query, setSearchParams]);

  const selectTopic = useCallback((id: string) => {
    setTopicFilter(id);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('topic', id);
      if (query.trim()) next.set('q', query); else next.delete('q');
      return next;
    }, { replace: true, preventScrollReset: true });
  }, [query, setSearchParams]);

  const normalizedQuery = query.trim().toLowerCase();
  const view = category === 'calculus' ? { topics: CALCULUS_TOPICS, items: CALCULUS_ITEMS }
    : category === 'linalg' ? { topics: LINALG_TOPICS, items: LINALG_ITEMS }
    : category === 'mechanics' ? { topics: PHYSICS_TOPICS, items: PHYSICS_ITEMS }
      : category === 'lab408' ? { topics: LAB408_TOPICS, items: LAB408_ITEMS }
        : category === 'deep' ? { topics: DEEP_TOPICS, items: DEEP_ITEMS }
          : category === 'business' ? { topics: BUSINESS_TOPICS, items: BUSINESS_ITEMS }
            : { topics: ALL_TOPICS, items: ALL_ITEMS };
  const knownTopicIds = new Set(view.topics.map((topic) => topic.id));
  const searchedItems = view.items.filter((item) => knownTopicIds.has(item.topic) && matchesQuery(item, normalizedQuery));
  const selectedTopicId = topicFilter && view.topics.some((topic) => topic.id === topicFilter) ? topicFilter : 'all';
  const activeTopicId = normalizedQuery ? 'all' : selectedTopicId;
  const shownItems = activeTopicId === 'all'
    ? searchedItems : searchedItems.filter((item) => item.topic === activeTopicId);
  const shownTopics = (activeTopicId === 'all'
    ? view.topics : view.topics.filter((topic) => topic.id === activeTopicId))
    .map((topic) => ({ ...topic, name: topicDisplayName(topic, topicAliases) }));
  const selectedTopic = selectedTopicId === 'all'
    ? null : view.topics.find((topic) => topic.id === selectedTopicId) ?? null;
  const topicMatches = (topicId: string): number =>
    view.items.filter((item) => item.topic === topicId && matchesQuery(item, normalizedQuery)).length;
  const shownCount = shownItems.length;
  const totalTemplates = ALL_ITEMS.length;

  const renameTopic = useCallback(() => {
    if (!selectedTopic || normalizedQuery) return;
    const current = topicDisplayName(selectedTopic, topicAliases);
    const next = window.prompt('自定义专题名字（留空恢复原名）', current);
    if (next === null) return;
    setTopicAliases(writeTopicAlias(selectedTopic.id, next, topicAliases));
  }, [normalizedQuery, selectedTopic, topicAliases]);

  const openWork = useCallback((wid: string) => {
    const from = saveReturnSnapshot();
    navigate(`/canvas?work=${encodeURIComponent(wid)}`, { state: { from, fromLabel: '← 定象坊目录', restoreScroll: true } });
  }, [navigate, saveReturnSnapshot]);

  const blank = useCallback(() => {
    saveReturnSnapshot();
    navigate('/canvas', { state: { blank: true, from: '/workshop', fromLabel: '← 定象坊目录', restoreScroll: true } });
  }, [navigate, saveReturnSnapshot]);

  const remove = useCallback(async (wid: string) => {
    if (!window.confirm('删除这个作品？已发布的分享链接会一并失效。')) return;
    try {
      await worksApi.remove(wid);
      setWorks((w) => (w ?? []).filter((x) => x.work_id !== wid));
    } catch {
      window.alert('删除失败。');
    }
  }, []);

  return <>
    <MainSiteNav current="canvas" />
    <div className={`${styles.catalogPage} studio-scope atelier-paper`}>

      <main className={styles.main}>
        <header className={styles.pageHead}>
          <div className={styles.headCopy}>
            <div className={styles.headBadge}>
              <i aria-hidden="true" /> DINGXIANG ATELIER · 定象坊
            </div>
            <h1 className={styles.title}>
              搭一块砖，<br /><span className={styles.titleHighlight}>定一种象。</span>
            </h1>
            <p className={styles.lead}>
              公式、算法与物理场，都是可拆、可连、可运行的<strong>象砖</strong>。排起来就是一件作品，也能嵌入通文册，让读者动手探索。
            </p>
            <div className={styles.headActions}>
              <button type="button" className={styles.blankButton} onClick={blank}>＋ 新建空白画布</button>
              <a href="#workshop-catalog-title" className={styles.secondaryButton}>先逛逛标本柜</a>
            </div>
            <div className={styles.headMetrics}>
              <div className={styles.headMetric}>
                <strong>{totalTemplates}</strong>
                <span>学科真内核模板</span>
              </div>
              <div className={styles.headMetric}>
                <strong>6 大领域</strong>
                <span>高数 / 线代 / 物理 / 408 / DL / 决策</span>
              </div>
              <div className={styles.headMetric}>
                <strong>{works === null ? '—' : works.length}</strong>
                <span>我的已存作品</span>
              </div>
              <div className={styles.headMetric}>
                <strong>0</strong>
                <span>额外插件安装</span>
              </div>
            </div>
          </div>

          <WorkshopIntroBanner />
        </header>

        <section className={styles.typeCase} aria-label="象砖字架">
          <div><span>TYPE CASE / 字架</span><h2>取一枚，排上去</h2></div>
          <div className={styles.typeCaseBricks}>
            {([
              ['calculus', 'ƒ', '函数砖', '高等数学'],
              ['mechanics', '→', '场砖', '大学物理'],
              ['lab408', '⌗', '算法砖', '408 专题'],
              ['deep', '∇', '学习砖', '深度学习'],
              ['business', '▥', '数据砖', '办公决策'],
            ] as const).map(([subject, glyph, label, detail]) => (
              <a key={subject} href="#workshop-catalog-title" onClick={() => selectCategory(subject)}>
                <span aria-hidden="true">{glyph}</span><div><strong>{label}</strong><small>{detail}</small></div>
              </a>
            ))}
          </div>
        </section>

        <section className={styles.section} aria-labelledby="workshop-maker">
          <div className={styles.sectionHead}>
            <div><p className={styles.sectionEyebrow}>象砖工造</p>
              <h2 id="workshop-maker" className={styles.sectionTitle}>从一块砖，到一件能跑的作品</h2></div>
          </div>
          <div className={styles.makerSteps}>
            <a href="#workshop-catalog-title"><span>01 · 选砖</span><h3>取一块真内核象砖</h3><p>从学科标本柜打开一个可运行的实验。</p></a>
            <button type="button" onClick={blank}><span>02 · 排字</span><h3>把数据口连起来</h3><p>在画布上接线，让参数流进下游积木。</p></button>
            <Link to="/living"><span>03 · 装订</span><h3>定象，然后装订成册</h3><p>把保存的仪器嵌进通文册任意一页。</p></Link>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="workshop-catalog-title">
          <div className={styles.sectionHead}>
            <div>
              <p className={styles.sectionEyebrow}>SPECIMEN CABINET / 学科实验模板库</p>
              <h2 id="workshop-catalog-title" className={styles.sectionTitle}>{category === 'linalg' ? '线性代数全景沙盘' : '标本柜'}</h2>
            </div>
            <span className={styles.countPill}>当前显示 {shownCount} / {totalTemplates} 个</span>
          </div>

          <div className={styles.templateFilters} role="group" aria-label="模板筛选">
            <div className={styles.filterTop}>
              <div className={styles.filterPills} role="group" aria-label="学科分类">
                {([
                  ['calculus', `高等数学 · ${CALCULUS_ITEMS.length}`],
                  ['linalg', `线性代数 · ${LINALG_ITEMS.length}`],
                  ['mechanics', `大学物理 · ${PHYSICS_ITEMS.length}`],
                  ['lab408', `408 专题 · ${LAB408_ITEMS.length}`],
                  ['deep', `深度学习 · ${DEEP_ITEMS.length}`],
                  ['business', `办公决策 · ${BUSINESS_ITEMS.length}`],
                  ['all', `全部模板 · ${totalTemplates}`],
                ] as const).map(([key, label]) => (
                  <button type="button" key={key} aria-pressed={category === key} onClick={() => selectCategory(key)}>
                    {label}
                  </button>
                ))}
              </div>
              <label className={styles.templateSearch}>
                <span>搜索</span>
                <input
                  type="search"
                  value={query}
                  placeholder="双缝、Taylor、Cache、盈亏、甘特图…"
                  aria-label="按学科、算法或关键词搜索模板"
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
            </div>
            <div className={styles.topicFilters}>
              <span className={styles.filterLabel}>专题</span>
              <div className={styles.topicPills} role="group" aria-label="专题筛选">
                <button type="button" aria-pressed={normalizedQuery ? true : selectedTopicId === 'all'}
                  onClick={() => selectTopic('all')}>
                  全部专题 <small>{searchedItems.length}</small>
                </button>
                {view.topics.map((topic) => (
                  <button type="button" key={topic.id}
                    aria-pressed={!normalizedQuery && selectedTopicId === topic.id}
                    onClick={() => selectTopic(topic.id)}>
                    {topicDisplayName(topic, topicAliases)} <small>{topicMatches(topic.id)}</small>
                  </button>
                ))}
              </div>
              <button type="button" className={styles.topicRename}
                disabled={!selectedTopic || Boolean(normalizedQuery)}
                title={selectedTopic ? '给当前专题起一个本地显示名' : '请先选择一个具体专题'}
                onClick={renameTopic}>✎ 自定义专题名</button>
            </div>
          </div>

          <TopicCatalog
            topics={shownTopics}
            items={shownItems}
            highlightPanoramas={activeTopicId === 'all' && category !== 'linalg'}
            panoramaTitle={category === 'mechanics' ? '大学物理全景沙盘'
              : category === 'business' ? '办公决策全景沙盘'
              : category === 'calculus' ? '高数全景沙盘' : '全景沙盘'}
            disabled={false}
            creatingKey={null}
            actionLabel="打开实验 →"
            onCreate={(item) => fromTemplate(item.key)}
          />
          {!shownCount ? <p className={styles.emptyLead} role="status">
            {normalizedQuery ? `没有匹配“${query.trim()}”的模板；清空搜索或切换专题。` : '这个专题暂时没有可打开的模板。'}
          </p> : null}
        </section>

        {loadError ? <p className={styles.loadError} role="status">{loadError} <button type="button" onClick={loadWorks}>重试</button></p> : null}

        {works && works.length > 0 ? (
          <section className={styles.section} aria-labelledby="workshop-mine">
            <div className={styles.sectionHead}>
              <div>
                <p className={styles.sectionEyebrow}><span className={styles.secNo}>§ 02</span> MY WORKS / 个人沉淀</p>
                <h2 id="workshop-mine" className={styles.sectionTitle}>我的作品</h2>
              </div>
              <span className={styles.countPill}>{`${works.length} 件`}</span>
            </div>
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
          </section>
        ) : null}

        <section className={styles.section} aria-labelledby="workshop-gallery">
          <div className={styles.sectionHead}>
            <div>
              <p className={styles.sectionEyebrow}><span className={styles.secNo}>{works && works.length > 0 ? '§ 03' : '§ 02'}</span> COMMUNITY GALLERY / 公开画廊</p>
              <h2 id="workshop-gallery" className={styles.sectionTitle}>公开作品</h2>
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
  </>;
}

export default WorkshopPage;
