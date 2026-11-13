import { lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SiteNav } from '@/components/home/SiteNav';
import { OfficeLab } from '@/components/showcase/OfficeLab';
import { SurfaceIntegralLab } from '@/components/showcase/SurfaceIntegralLab';
import { TransformerLab } from '@/components/showcase/TransformerLab';
import styles from './ExamplesPage.module.css';

type LabId = 'math' | 'computer' | 'office' | 'physics';

const LazyGyroLab = lazy(() => import('@/components/showcase/GyroLab'));

interface LabEntry {
  id: LabId;
  index: string;
  name: string;
  subtitle: string;
  kicker: string;
  description: string;
  accent: 'indigo' | 'mint' | 'amber' | 'bronze';
  Component: () => JSX.Element;
}

const LABS: readonly LabEntry[] = [
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
  {
    id: 'office',
    index: '04',
    name: '办公',
    subtitle: '经营推演',
    kicker: '一个价格，牵动整张利润表',
    description:
      '价格、弹性、成本与产能联动：利润曲线、瀑布图、敏感性排序、情景对比与建议同步更新。',
    accent: 'amber',
    Component: OfficeLab,
  },
] as const;

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

function MathPreview(): JSX.Element {
  return (
    <svg viewBox="0 0 220 118" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id="math-sphere" cx="38%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#6d8ad8" stopOpacity="0.7"/>
          <stop offset="100%" stopColor="#2b3f70" stopOpacity="0.25"/>
        </radialGradient>
      </defs>
      <ellipse cx="110" cy="62" rx="54" ry="44" fill="url(#math-sphere)" stroke="rgba(160,190,240,0.35)"/>
      <ellipse cx="110" cy="62" rx="54" ry="12" fill="none" stroke="rgba(160,190,240,0.18)"/>
      <ellipse cx="110" cy="40" rx="42" ry="8" fill="none" stroke="rgba(160,190,240,0.14)"/>
      <ellipse cx="110" cy="84" rx="42" ry="8" fill="none" stroke="rgba(160,190,240,0.14)"/>
      <path d="M22 74 C 62 58, 158 58, 198 74" fill="none" stroke="rgba(127,227,255,0.15)" strokeWidth="2"/>
      <path d="M35 74 C 70 64, 150 64, 185 74" fill="none" stroke="#ff8f74" strokeWidth="7" strokeOpacity="0.48" strokeLinecap="round"/>
      <ellipse cx="110" cy="74" rx="41" ry="10" fill="rgba(127,227,255,0.1)" stroke="#7fe3ff" strokeWidth="1.4"/>
      <circle cx="146" cy="83" r="3.4" fill="#ff9d82"/>
      <line x1="110" y1="74" x2="146" y2="83" stroke="rgba(255,157,130,0.6)" strokeDasharray="2 3"/>
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
          <rect x={x} y="14" width="34" height="16" rx="4" fill="rgba(79,70,229,0.22)" stroke="rgba(160,180,255,0.35)"/>
          <rect x={x} y="90" width="34" height="16" rx="4" fill="rgba(79,70,229,0.22)" stroke="rgba(160,180,255,0.35)"/>
        </g>
      ))}
      <rect x="122" y="48" width="70" height="22" rx="6" fill="rgba(13,107,95,0.35)" stroke="rgba(125,227,199,0.5)"/>
      <text x="157" y="62" textAnchor="middle" fill="#bdf5e2" fontSize="8" fontFamily="monospace">softmax</text>
      <path d="M55 30 L55 44 L122 59 M55 90 L55 74 L122 60" fill="none" stroke="rgba(180,205,240,0.35)"/>
      <path d="M95 30 L95 44 L122 57 M95 90 L95 74 L122 63" fill="none" stroke="rgba(180,205,240,0.25)"/>
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

function OfficePreview(): JSX.Element {
  const bars = [
    { x: 30, h: 54, tone: '#6c5ff0' },
    { x: 70, h: 22, tone: '#ff9d82' },
    { x: 110, h: 14, tone: '#ff9d82' },
    { x: 150, h: 30, tone: '#2aa07c' },
  ];
  return (
    <svg viewBox="0 0 220 118" aria-hidden="true" focusable="false">
      <line x1="22" y1="92" x2="198" y2="92" stroke="rgba(190,214,243,0.25)"/>
      {bars.map((bar, index) => (
        <g key={index}>
          <rect x={bar.x} y={92 - bar.h} width="28" height={bar.h} rx="3" fill={bar.tone} opacity="0.8"/>
          {index < bars.length - 1 ? (
            <line
              x1={bar.x + 28}
              y1={92 - bar.h}
              x2={bars[index + 1]!.x}
              y2={92 - bar.h}
              stroke="rgba(190,214,243,0.3)"
              strokeDasharray="2 2"
            />
          ) : null}
        </g>
      ))}
      <path d="M28 66 C 70 30, 130 38, 192 22" fill="none" stroke="#ff9d82" strokeWidth="1.6" opacity="0.8"/>
      <circle cx="176" cy="30" r="3.2" fill="#ff9d82"/>
      <text x="22" y="20" fill="rgba(190,214,243,0.6)" fontSize="8" fontFamily="monospace">profit ↑</text>
      <text x="22" y="108" fill="rgba(190,214,243,0.45)" fontSize="8" fontFamily="monospace">price →</text>
    </svg>
  );
}

function PhysicsPreview(): JSX.Element {
  return (
    <svg viewBox="0 0 220 118" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id="physics-rotor" cx="38%" cy="30%" r="72%">
          <stop offset="0%" stopColor="#e6c17b" stopOpacity="0.95"/>
          <stop offset="48%" stopColor="#b07c3d" stopOpacity="0.92"/>
          <stop offset="100%" stopColor="#5e3d1d" stopOpacity="0.72"/>
        </radialGradient>
        <radialGradient id="physics-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffbd8f" stopOpacity="0.28"/>
          <stop offset="100%" stopColor="#ffbd8f" stopOpacity="0"/>
        </radialGradient>
      </defs>
      <ellipse cx="112" cy="63" rx="74" ry="40" fill="url(#physics-glow)" />
      <ellipse cx="110" cy="80" rx="58" ry="15" fill="none" stroke="rgba(143,227,208,0.28)" strokeDasharray="3 4" />
      <path d="M52 95h116M62 95l-8 12M158 95l8 12" stroke="rgba(190,205,215,0.3)" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M58 95v-22h18" fill="none" stroke="rgba(190,205,215,0.48)" strokeWidth="2" />
      <ellipse cx="76" cy="73" rx="9" ry="3" fill="#4b555d" />
      <path d="M76 73 137 36" stroke="rgba(212,225,234,0.75)" strokeWidth="2.2" strokeLinecap="round" />
      <ellipse cx="114" cy="49" rx="30" ry="13" transform="rotate(-32 114 49)" fill="url(#physics-rotor)" stroke="rgba(255,225,168,0.38)"/>
      <ellipse cx="114" cy="49" rx="18" ry="7" transform="rotate(-32 114 49)" fill="none" stroke="rgba(84,55,26,0.48)"/>
      <circle cx="98" cy="58" r="3" fill="#ff9d82" />
      <path d="M76 73a26 26 0 0 1 38-18" fill="none" stroke="rgba(255,160,125,0.6)" strokeWidth="1.2" strokeDasharray="3 3" />
      <path d="M135 31c12-6 23-5 30 2" fill="none" stroke="rgba(143,227,208,0.55)" strokeWidth="1.2" />
      <text x="28" y="24" fill="rgba(190,214,243,0.56)" fontSize="8" fontFamily="monospace">ω_s</text>
      <text x="145" y="25" fill="rgba(143,227,208,0.8)" fontSize="8" fontFamily="monospace">Ω_p</text>
      <text x="26" y="108" fill="rgba(190,214,243,0.42)" fontSize="8" fontFamily="monospace">O → C</text>
    </svg>
  );
}

const PREVIEWS: Record<LabId, () => JSX.Element> = {
  math: MathPreview,
  computer: ComputerPreview,
  office: OfficePreview,
  physics: PhysicsPreview,
};

export function ExamplesPage(): JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get('lab');
  const active: LabEntry | null = LABS.find((lab) => lab.id === raw) ?? null;

  const openLab = (labId: LabId): void => {
    const next = new URLSearchParams(searchParams);
    next.set('lab', labId);
    setSearchParams(next);
  };

  const backToEntry = (): void => {
    const next = new URLSearchParams(searchParams);
    next.delete('lab');
    setSearchParams(next);
  };

  const renderDetail = (active: LabEntry): JSX.Element => {
    const ActiveLab = active.Component;
    return (
      <section className={styles.labPanel} data-labs-view="detail" data-active-lab={active.id}>
        <button
          type="button"
          className={styles.backButton}
          data-labs-back
          aria-label="返回示例分类"
          onClick={backToEntry}
        >
          ← 返回
        </button>
        <ActiveLab key={active.id} />
      </section>
    );
  };

  return (
    <div className={`${styles.page} studio-scope`}>
      <SiteNav current="examples" appearance="studio" />

      <main id="main" className={styles.main}>
        <header className={styles.pageHead}>
          <div className={styles.headText}>
            <p className={styles.eyebrow}>交互示例 · INTERACTIVE LABS</p>
            <h1 className={styles.title}>四块画布，四种推演</h1>
            <p className={styles.lead}>
              数学看曲面如何被切开再累加，计算机看一句话如何穿过 Transformer，办公看一次定价如何改变利润，
              物理看一只陀螺如何在自转中保持方向。每个实验都由同一组参数驱动图形、公式与结论，可以亲手把结果推出来。
            </p>
          </div>
          <aside className={styles.headNote}>
            <span>手工构建的教学模型</span>
            <p>不冒充 PPT 解析结果；所有数值在浏览器内确定性计算，物理实验使用无摩擦刚体动力学与 RK4 数值积分。</p>
          </aside>
        </header>

        {active === null ? (
          <div className={styles.labTabs} data-labs-view="entry">
            {LABS.map((lab) => {
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
          renderDetail(active)
        )}

        <section className={styles.footNote} aria-labelledby="examples-note-title">
          <div>
            <h2 id="examples-note-title">这些示例与你的材料有什么不同</h2>
            <p>
              四个实验都是手工构建的教学模型，用来展示“参数如何驱动视图”和“确定性内核如何复算”；
              它们不对应任何一份 PPT 的自动解析结果，物理实验使用无摩擦刚体动力学。
            </p>
          </div>
          <ul>
            <li><strong>可复算</strong>：公式、图形、指标读取同一组参数；修改一处，其他位置同步更新。</li>
            <li><strong>不伪造</strong>：没有原文页码与元素坐标，就不标注“来自第几页”。</li>
            <li><strong>可迁移</strong>：把同样的结构放到你的课件上，就是可调参、可追溯的学习对象。</li>
          </ul>
        </section>
      </main>
    </div>
  );
}

export default ExamplesPage;
