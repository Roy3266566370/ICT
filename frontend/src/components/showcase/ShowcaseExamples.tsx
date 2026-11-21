import { lazy, Suspense } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { SurfaceIntegralLab } from './SurfaceIntegralLab';
import { TransformerLab } from './TransformerLab';
import styles from './ShowcaseExamples.module.css';

export type ShowcaseLabId = 'math' | 'computer' | 'physics';

const LazyGyroLab = lazy(() => import('./GyroLab'));

interface ShowcaseEntry {
  id: ShowcaseLabId;
  index: string;
  name: string;
  subtitle: string;
  kicker: string;
  description: string;
  accent: 'indigo' | 'mint' | 'bronze';
  Component: () => JSX.Element;
}

function PhysicsLabShell(): JSX.Element {
  return (
    <Suspense
      fallback={
        <div className={styles.labLoading} role="status" aria-live="polite">
          <span className={styles.labLoadingDot} aria-hidden="true" />
          正在准备 3D 器材与动力学模型…
        </div>
      }
    >
      <LazyGyroLab />
    </Suspense>
  );
}

const SHOWCASE_LABS: readonly ShowcaseEntry[] = [
  {
    id: 'math',
    index: '01',
    name: '数学',
    subtitle: '曲面积分',
    kicker: '移动截面，看 dS 如何累加',
    description:
      '球面被水平截面切成环带：拖动截面，同时观察第一类与第二类曲面积分的公式、微元与累积曲线。',
    accent: 'indigo',
    Component: SurfaceIntegralLab,
  },
  {
    id: 'computer',
    index: '02',
    name: '计算机',
    subtitle: 'Transformer',
    kicker: '输入一句话，逐层看注意力',
    description:
      '从字符到下一个 token：分词、Q/K/V、因果注意力、残差归一化、FFN 与输出 softmax，每一步都有真实张量。',
    accent: 'mint',
    Component: TransformerLab,
  },
  {
    id: 'physics',
    index: '03',
    name: '物理',
    subtitle: '陀螺动力学',
    kicker: '自转、进动与章动，同一套动力学',
    description:
      '单支点重陀螺：改变转速、倾角、力臂与释放方式，看重力矩如何让轴进动，以及章动从哪里出现。',
    accent: 'bronze',
    Component: PhysicsLabShell,
  },
] as const;

function MathPreview(): JSX.Element {
  return (
    <svg viewBox="0 0 220 118" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id="lab-math-sphere" cx="38%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#6d8ad8" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#2b3f70" stopOpacity="0.25" />
        </radialGradient>
      </defs>
      <ellipse cx="110" cy="62" rx="54" ry="44" fill="url(#lab-math-sphere)" stroke="rgba(160,190,240,0.35)" />
      <ellipse cx="110" cy="62" rx="54" ry="12" fill="none" stroke="rgba(160,190,240,0.18)" />
      <ellipse cx="110" cy="40" rx="42" ry="8" fill="none" stroke="rgba(160,190,240,0.14)" />
      <ellipse cx="110" cy="84" rx="42" ry="8" fill="none" stroke="rgba(160,190,240,0.14)" />
      <path d="M22 74 C 62 58, 158 58, 198 74" fill="none" stroke="rgba(127,227,255,0.15)" strokeWidth="2" />
      <path d="M35 74 C 70 64, 150 64, 185 74" fill="none" stroke="#ff8f74" strokeWidth="7" strokeOpacity="0.48" strokeLinecap="round" />
      <ellipse cx="110" cy="74" rx="41" ry="10" fill="rgba(127,227,255,0.1)" stroke="#7fe3ff" strokeWidth="1.4" />
      <circle cx="146" cy="83" r="3.4" fill="#ff9d82" />
      <line x1="110" y1="74" x2="146" y2="83" stroke="rgba(255,157,130,0.6)" strokeDasharray="2 3" />
      <text x="151" y="94" fill="rgba(255,206,192,0.85)" fontSize="8" fontFamily="monospace">z = h</text>
      <text x="24" y="24" fill="rgba(190,214,243,0.6)" fontSize="8" fontFamily="monospace">∬Σ f dS</text>
    </svg>
  );
}

function ComputerPreview(): JSX.Element {
  const cells = [
    [0.9, 0, 0, 0],
    [0.5, 0.5, 0, 0],
    [0.3, 0.4, 0.3, 0],
    [0.2, 0.2, 0.4, 0.2],
  ];
  return (
    <svg viewBox="0 0 220 118" aria-hidden="true" focusable="false">
      {[38, 78].map((x) => (
        <g key={x}>
          <rect x={x} y="14" width="34" height="16" rx="4" fill="rgba(79,70,229,0.22)" stroke="rgba(160,180,255,0.35)" />
          <rect x={x} y="90" width="34" height="16" rx="4" fill="rgba(79,70,229,0.22)" stroke="rgba(160,180,255,0.35)" />
        </g>
      ))}
      <rect x="122" y="48" width="70" height="22" rx="6" fill="rgba(13,107,95,0.35)" stroke="rgba(125,227,199,0.5)" />
      <text x="157" y="62" textAnchor="middle" fill="#bdf5e2" fontSize="8" fontFamily="monospace">softmax</text>
      <path d="M55 30 L55 44 L122 59 M55 90 L55 74 L122 60" fill="none" stroke="rgba(180,205,240,0.35)" />
      <path d="M95 30 L95 44 L122 57 M95 90 L95 74 L122 63" fill="none" stroke="rgba(180,205,240,0.25)" />
      {cells.map((row, i) =>
        row.map((value, j) => (
          <rect
            key={`${i}-${j}`}
            x={132 + j * 14}
            y={12 + i * 14}
            width="11"
            height="11"
            rx="2"
            fill={`rgba(125,140,255,${0.08 + value * 0.8})`}
          />
        )),
      )}
      <text x="132" y="84" fill="rgba(190,214,243,0.55)" fontSize="8" fontFamily="monospace">attention</text>
    </svg>
  );
}

function PhysicsPreview(): JSX.Element {
  return (
    <svg viewBox="0 0 220 118" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id="lab-physics-rotor" cx="38%" cy="30%" r="72%">
          <stop offset="0%" stopColor="#e6c17b" stopOpacity="0.95" />
          <stop offset="48%" stopColor="#b07c3d" stopOpacity="0.92" />
          <stop offset="100%" stopColor="#5e3d1d" stopOpacity="0.72" />
        </radialGradient>
        <radialGradient id="lab-physics-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffbd8f" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#ffbd8f" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="112" cy="63" rx="74" ry="40" fill="url(#lab-physics-glow)" />
      <ellipse cx="110" cy="80" rx="58" ry="15" fill="none" stroke="rgba(143,227,208,0.28)" strokeDasharray="3 4" />
      <path d="M52 95h116M62 95l-8 12M158 95l8 12" stroke="rgba(190,205,215,0.3)" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M58 95v-22h18" fill="none" stroke="rgba(190,205,215,0.48)" strokeWidth="2" />
      <ellipse cx="76" cy="73" rx="9" ry="3" fill="#4b555d" />
      <path d="M76 73 137 36" stroke="rgba(212,225,234,0.75)" strokeWidth="2.2" strokeLinecap="round" />
      <ellipse cx="114" cy="49" rx="30" ry="13" transform="rotate(-32 114 49)" fill="url(#lab-physics-rotor)" stroke="rgba(255,225,168,0.38)" />
      <ellipse cx="114" cy="49" rx="18" ry="7" transform="rotate(-32 114 49)" fill="none" stroke="rgba(84,55,26,0.48)" />
      <circle cx="98" cy="58" r="3" fill="#ff9d82" />
      <path d="M76 73a26 26 0 0 1 38-18" fill="none" stroke="rgba(255,160,125,0.6)" strokeWidth="1.2" strokeDasharray="3 3" />
      <path d="M135 31c12-6 23-5 30 2" fill="none" stroke="rgba(143,227,208,0.55)" strokeWidth="1.2" />
      <text x="28" y="24" fill="rgba(190,214,243,0.56)" fontSize="8" fontFamily="monospace">ω_s</text>
      <text x="145" y="25" fill="rgba(143,227,208,0.8)" fontSize="8" fontFamily="monospace">Ω_p</text>
      <text x="26" y="108" fill="rgba(190,214,243,0.42)" fontSize="8" fontFamily="monospace">O → C</text>
    </svg>
  );
}

const PREVIEWS: Record<ShowcaseLabId, () => JSX.Element> = {
  math: MathPreview,
  computer: ComputerPreview,
  physics: PhysicsPreview,
};

/** 数学（曲面积分）、计算机（Transformer）与物理（陀螺动力学）交互示例（已移除办公示例）。 */
export function ShowcaseExamples(): JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get('example') ?? searchParams.get('lab');
  const active = SHOWCASE_LABS.find((lab) => lab.id === raw) ?? null;

  const openLab = (labId: ShowcaseLabId): void => {
    const next = new URLSearchParams(searchParams);
    next.set('example', labId);
    next.delete('lab');
    setSearchParams(next, { replace: false });
  };

  const closeLab = (): void => {
    const next = new URLSearchParams(searchParams);
    next.delete('example');
    next.delete('lab');
    setSearchParams(next, { replace: false });
  };

  return (
    <div className={styles.showcaseWrap}>
      {active === null ? (
        <div className={styles.labTabs} data-labs-view="entry">
          {SHOWCASE_LABS.map((lab) => {
            const Preview = PREVIEWS[lab.id];
            return (
              <button
                key={lab.id}
                type="button"
                className={styles.labTab}
                data-accent={lab.accent}
                data-lab-id={lab.id}
                onClick={() => openLab(lab.id)}
              >
                <span className={styles.tabPreview} aria-hidden="true">
                  <Preview />
                </span>
                <span className={styles.tabBody}>
                  <span className={styles.tabMeta}>
                    <span className={styles.tabIndex}>{lab.index}</span>
                    <span className={styles.tabSubtitle}>{lab.subtitle}</span>
                  </span>
                  <strong className={styles.tabName}>{lab.name}</strong>
                  <span className={styles.tabKicker}>{lab.kicker}</span>
                  <span className={styles.tabDescription}>{lab.description}</span>
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <section className={styles.labPanel} data-labs-view="detail" data-active-lab={active.id}>
          <div className={styles.labPanelBar}>
            <button
              type="button"
              className={styles.backButton}
              data-labs-back
              aria-label="返回交互示例列表"
              onClick={closeLab}
            >
              ← 返回示例分类
            </button>
            <div className={styles.switchPills} role="group" aria-label="切换交互示例">
              {SHOWCASE_LABS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={styles.switchPill}
                  aria-pressed={item.id === active.id}
                  onClick={() => openLab(item.id)}
                >
                  {item.name} · {item.subtitle}
                </button>
              ))}
            </div>
            {active.id === 'computer' ? <Link className={styles.workshopJump} to="/workshop?subject=deep&q=Attention#deep-dl03">
              去万象工坊拆解注意力与 KV Cache →
            </Link> : null}
          </div>
          <active.Component key={active.id} />
        </section>
      )}
    </div>
  );
}

export default ShowcaseExamples;
