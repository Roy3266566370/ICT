/** 万象工坊顶部动态引入区：真实纯前端计算驱动的「活体电路标本」。 */

import { useEffect, useMemo, useRef, useState } from 'react';
import styles from './PageIntros.module.css';

type PresetKey = 'scan' | 'damping' | 'gd';

interface ControlDef {
  label: string;
  min: number;
  max: number;
  step: number;
  defaultVal: number;
  format?: (value: number) => string;
}

interface PresetSpec {
  key: PresetKey;
  label: string;
  prompt: string;
  stageTag: string;
  perfBadge: string;
  c1: ControlDef;
  c2: ControlDef;
}

const STORAGE_KEY = 'wanxiang.intro.workshop.collapsed.v1';

const PRESETS: Record<PresetKey, PresetSpec> = {
  scan: {
    key: 'scan',
    label: '磁盘调度 SCAN',
    prompt: '“演示电梯磁盘调度 SCAN 的磁头轨迹，并对比 FCFS 总寻道长度”',
    stageTag: '磁头轨迹 · SCAN',
    perfBadge: '✓ 18 帧 · 0.9ms',
    c1: { label: '初始磁头位置', min: 10, max: 180, step: 1, defaultVal: 53 },
    c2: {
      label: '扫描方向',
      min: 0,
      max: 1,
      step: 1,
      defaultVal: 1,
      format: (v) => (v >= 0.5 ? '向高磁道 (+)' : '向低磁道 (-)'),
    },
  },
  damping: {
    key: 'damping',
    label: '二阶欠阻尼',
    prompt: '“展示二阶阻尼振子 y\'\' + 2ζωy\' + ω²y = 0 在不同阻尼比下的响应”',
    stageTag: '实时 ODE 数值积分',
    perfBadge: '✓ 60 帧 · 1.2ms',
    c1: {
      label: '阻尼比 ζ',
      min: 0.05,
      max: 1.4,
      step: 0.05,
      defaultVal: 0.25,
      format: (v) => v.toFixed(2),
    },
    c2: {
      label: '固有频率 ω',
      min: 1.5,
      max: 6.0,
      step: 0.25,
      defaultVal: 3.5,
      format: (v) => `${v.toFixed(2)} rad/s`,
    },
  },
  gd: {
    key: 'gd',
    label: '梯度下降',
    prompt: '“对比不同学习率 η 下梯度下降在二次凸面上的收敛与震荡行为”',
    stageTag: '优化步进轨迹',
    perfBadge: '✓ 14 步 · 0.6ms',
    c1: {
      label: '学习率 η',
      min: 0.08,
      max: 0.98,
      step: 0.02,
      defaultVal: 0.36,
      format: (v) => v.toFixed(2),
    },
    c2: {
      label: '初始起点 x₀',
      min: -2.6,
      max: 2.6,
      step: 0.2,
      defaultVal: -2.2,
      format: (v) => v.toFixed(1),
    },
  },
};

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function WorkshopIntroBanner(): JSX.Element {
  const [collapsed, setCollapsed] = useState<boolean>(readCollapsed);
  const [presetKey, setPresetKey] = useState<PresetKey>('scan');
  const preset = PRESETS[presetKey];
  const [v1, setV1] = useState<number>(preset.c1.defaultVal);
  const [v2, setV2] = useState<number>(preset.c2.defaultVal);
  const [progress, setProgress] = useState<number>(1);
  const [typedPrompt, setTypedPrompt] = useState<string>(preset.prompt);
  const rafRef = useRef<number | null>(null);

  const toggleCollapsed = (): void => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      } catch {
        /* 隐私模式静默忽略 */
      }
      return next;
    });
  };

  const triggerReplay = (): void => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    const start = performance.now();
    const duration = 720;
    const tick = (now: number): void => {
      const ratio = Math.min(1, (now - start) / duration);
      setProgress(ratio);
      if (ratio < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  useEffect(() => {
    const full = preset.prompt;
    let index = 0;
    setTypedPrompt('');
    const timer = window.setInterval(() => {
      index += 2;
      setTypedPrompt(full.slice(0, index));
      if (index >= full.length) window.clearInterval(timer);
    }, 24);
    triggerReplay();
    return () => {
      window.clearInterval(timer);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [preset]);

  const selectPreset = (key: PresetKey): void => {
    const target = PRESETS[key];
    setPresetKey(key);
    setV1(target.c1.defaultVal);
    setV2(target.c2.defaultVal);
  };

  const stageModel = useMemo(() => {
    if (presetKey === 'scan') {
      const reqs = [98, 183, 37, 122, 14, 124, 65, 67];
      const left = reqs.filter((r) => r < v1).sort((a, b) => b - a);
      const right = reqs.filter((r) => r >= v1).sort((a, b) => a - b);
      const seq = v2 >= 0.5 ? [v1, ...right, 199, ...left] : [v1, ...left, 0, ...right];
      let total = 0;
      for (let i = 1; i < seq.length; i += 1) {
        total += Math.abs((seq[i] ?? 0) - (seq[i - 1] ?? 0));
      }
      const pts: [number, number][] = seq.map((cyl, i) => [
        14 + (cyl / 200) * 252,
        14 + (i / (seq.length - 1)) * 90,
      ]);
      const vis = pts.slice(0, Math.max(2, Math.round(pts.length * progress)));
      return {
        metric: `SCAN 总寻道：${total} 磁道`,
        kind: 'scan' as const,
        points: vis,
      };
    }
    if (presetKey === 'damping') {
      const zeta = v1;
      const omega = v2;
      const N = 80;
      const maxI = Math.max(4, Math.round(N * progress));
      const curve: string[] = [];
      const envTop: string[] = [];
      const envBot: string[] = [];
      for (let i = 0; i <= maxI; i += 1) {
        const t = (i / N) * 6;
        const x = 14 + (i / N) * 252;
        const yVal =
          zeta < 1
            ? Math.exp(-zeta * omega * t) * Math.cos(omega * Math.sqrt(1 - zeta * zeta) * t)
            : Math.exp(-omega * t) * (1 + omega * t);
        curve.push(`${x.toFixed(1)},${(59 - yVal * 42).toFixed(1)}`);
        const env = Math.exp(-zeta * omega * t) * 42;
        envTop.push(`${x.toFixed(1)},${(59 - env).toFixed(1)}`);
        envBot.push(`${x.toFixed(1)},${(59 + env).toFixed(1)}`);
      }
      const regime = zeta < 0.98 ? '欠阻尼振荡' : zeta > 1.05 ? '过阻尼衰减' : '临界阻尼';
      return {
        metric: `当前模态：${regime}`,
        kind: 'damping' as const,
        curve: curve.join(' '),
        envTop: envTop.join(' '),
        envBot: envBot.join(' '),
        underdamped: zeta < 1,
      };
    }
    const lr = v1;
    const curve: string[] = [];
    for (let i = 0; i <= 60; i += 1) {
      const x = -3 + (i / 60) * 6;
      const px = 14 + ((x + 3) / 6) * 252;
      const py = 104 - ((x * x) / 9) * 86;
      curve.push(`${px.toFixed(1)},${py.toFixed(1)}`);
    }
    const steps: [number, number][] = [];
    let cur = v2;
    for (let k = 0; k < 12; k += 1) {
      const px = 14 + ((Math.max(-3, Math.min(3, cur)) + 3) / 6) * 252;
      const py = 104 - (Math.min(9, cur * cur) / 9) * 86;
      steps.push([px, py]);
      cur = cur - lr * 2 * cur;
    }
    const vis = steps.slice(0, Math.max(2, Math.round(steps.length * progress)));
    const state = lr < 0.2 ? '收敛偏慢' : lr > 0.85 ? '剧烈震荡' : '稳健收敛';
    return {
      metric: `η=${lr.toFixed(2)} · ${state}`,
      kind: 'gd' as const,
      curve: curve.join(' '),
      steps: vis,
      oscillating: lr > 0.85,
    };
  }, [presetKey, v1, v2, progress]);

  return (
    <section
      className={`${styles.introShell} ${collapsed ? styles.isCollapsed : ''}`}
      aria-label="万象工坊功能演示导览"
    >
      <div className={styles.introHead}>
        <div className={styles.introHeadLeft}>
          <span className={styles.eyebrowPill}>
            <span className={`${styles.dot} ${styles.dotCobalt}`} />
            活体电路标本
          </span>
          <span className={styles.introHeadTitle}>
            拖积木连线，或用一句话让 AI 造出真计算实验
          </span>
          <span className={styles.introHeadSub}>沙箱实时计算 · 拖动滑杆立即响应</span>
        </div>
        <button type="button" className={styles.collapseBtn} onClick={toggleCollapsed}>
          {collapsed ? '展开导览 ▾' : '收起导览 ▴'}
        </button>
      </div>

      {!collapsed ? (
        <div className={styles.introBody}>
          <div className={styles.circuitGrid}>
            <div className={styles.cNode}>
              <div className={styles.cNodeHead}>
                <span className={styles.cStep}>01 灵感输入</span>
                <span className={styles.cHint}>点选切换</span>
              </div>
              <div className={styles.cTitle}>自然语言 / 学科预设</div>
              <div className={styles.presetPills}>
                {(['scan', 'damping', 'gd'] as PresetKey[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={`${styles.presetPill} ${presetKey === key ? styles.presetPillActive : ''}`}
                    onClick={() => selectPreset(key)}
                  >
                    {PRESETS[key].label}
                  </button>
                ))}
              </div>
              <div className={styles.promptPreview}>
                <span>
                  {typedPrompt}
                  <span className={styles.cursorBlink} aria-hidden="true" />
                </span>
              </div>
            </div>

            <div className={styles.wireSlot} aria-hidden="true">
              <svg className={styles.wireSvg} viewBox="0 0 48 26">
                <path className={styles.wireBase} d="M 0 13 C 16 13, 32 13, 48 13" />
                <path className={styles.wireFlow} d="M 0 13 C 16 13, 32 13, 48 13" />
              </svg>
            </div>

            <div className={styles.cNode}>
              <div className={styles.cNodeHead}>
                <span className={`${styles.cStep} ${styles.cStepVermilion}`}>02 AI 计算方块</span>
                <span className={styles.cBadge}>{preset.perfBadge}</span>
              </div>
              <div className={styles.cTitle}>实时调参 · 安全沙箱</div>
              <div className={styles.miniControl}>
                <div className={styles.miniControlTop}>
                  <span>{preset.c1.label}</span>
                  <output>{preset.c1.format ? preset.c1.format(v1) : v1}</output>
                </div>
                <input
                  className={styles.paperRange}
                  type="range"
                  aria-label={preset.c1.label}
                  min={preset.c1.min}
                  max={preset.c1.max}
                  step={preset.c1.step}
                  value={v1}
                  onChange={(e) => {
                    const next = parseFloat(e.currentTarget.value);
                    setProgress(1);
                    setV1(next);
                  }}
                />
              </div>
              <div className={styles.miniControl}>
                <div className={styles.miniControlTop}>
                  <span>{preset.c2.label}</span>
                  <output>{preset.c2.format ? preset.c2.format(v2) : v2}</output>
                </div>
                <input
                  className={styles.paperRange}
                  type="range"
                  aria-label={preset.c2.label}
                  min={preset.c2.min}
                  max={preset.c2.max}
                  step={preset.c2.step}
                  value={v2}
                  onChange={(e) => {
                    const next = parseFloat(e.currentTarget.value);
                    setProgress(1);
                    setV2(next);
                  }}
                />
              </div>
              <div className={styles.codePillHint}>
                <span>可展开手改纯函数</span>
                <code>{'run({ params })'}</code>
              </div>
            </div>

            <div className={styles.wireSlot} aria-hidden="true">
              <svg className={styles.wireSvg} viewBox="0 0 48 26">
                <path className={styles.wireBase} d="M 0 13 C 16 13, 32 13, 48 13" />
                <path
                  className={`${styles.wireFlow} ${styles.wireFlowTeal}`}
                  d="M 0 13 C 16 13, 32 13, 48 13"
                />
              </svg>
            </div>

            <div className={styles.cNode}>
              <div className={styles.cNodeHead}>
                <span className={`${styles.cStep} ${styles.cStepTeal}`}>03 通用舞台</span>
                <span className={styles.cHint}>{preset.stageTag}</span>
              </div>
              <div className={styles.stageCanvasBox}>
                <svg className={styles.stageSvg} viewBox="0 0 280 118" aria-label={preset.stageTag}>
                  {stageModel.kind === 'scan' ? (
                    <>
                      <line
                        x1="14"
                        y1="14"
                        x2="266"
                        y2="14"
                        stroke="rgba(17,19,18,0.14)"
                        strokeDasharray="3 3"
                      />
                      <line
                        x1="14"
                        y1="104"
                        x2="266"
                        y2="104"
                        stroke="rgba(17,19,18,0.14)"
                        strokeDasharray="3 3"
                      />
                      <polyline
                        points={stageModel.points.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')}
                        fill="none"
                        stroke="#2234d4"
                        strokeWidth="2.2"
                        strokeLinejoin="round"
                        strokeLinecap="round"
                      />
                      {stageModel.points.map((p, i) => (
                        <circle
                          key={`${p[0]}-${p[1]}-${i}`}
                          cx={p[0]}
                          cy={p[1]}
                          r={i === stageModel.points.length - 1 ? 4.2 : 2.8}
                          fill={i === 0 ? '#de421f' : '#2234d4'}
                        />
                      ))}
                      <text x="14" y="115" fontSize="9" fill="#83867f" fontFamily="monospace">
                        0
                      </text>
                      <text x="248" y="115" fontSize="9" fill="#83867f" fontFamily="monospace">
                        199
                      </text>
                    </>
                  ) : null}

                  {stageModel.kind === 'damping' ? (
                    <>
                      <line x1="14" y1="59" x2="266" y2="59" stroke="rgba(17,19,18,0.16)" />
                      {stageModel.underdamped ? (
                        <>
                          <polyline
                            points={stageModel.envTop}
                            fill="none"
                            stroke="rgba(222,66,31,0.35)"
                            strokeDasharray="3 3"
                            strokeWidth="1.2"
                          />
                          <polyline
                            points={stageModel.envBot}
                            fill="none"
                            stroke="rgba(222,66,31,0.35)"
                            strokeDasharray="3 3"
                            strokeWidth="1.2"
                          />
                        </>
                      ) : null}
                      <polyline
                        points={stageModel.curve}
                        fill="none"
                        stroke="#0f766e"
                        strokeWidth="2.3"
                        strokeLinecap="round"
                      />
                    </>
                  ) : null}

                  {stageModel.kind === 'gd' ? (
                    <>
                      <polyline
                        points={stageModel.curve}
                        fill="none"
                        stroke="rgba(17,19,18,0.22)"
                        strokeWidth="1.8"
                      />
                      <polyline
                        points={stageModel.steps.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')}
                        fill="none"
                        stroke={stageModel.oscillating ? '#de421f' : '#2234d4'}
                        strokeWidth="2"
                        strokeDasharray="4 3"
                      />
                      {stageModel.steps.map((p, i) => (
                        <circle
                          key={`${p[0]}-${i}`}
                          cx={p[0]}
                          cy={p[1]}
                          r={i === stageModel.steps.length - 1 ? 4.2 : 2.6}
                          fill={stageModel.oscillating ? '#de421f' : '#2234d4'}
                        />
                      ))}
                    </>
                  ) : null}
                </svg>
              </div>
              <div className={styles.stageFoot}>
                <span className={styles.stageMetric}>{stageModel.metric}</span>
                <button type="button" className={styles.miniAction} onClick={triggerReplay}>
                  重播演化 ↻
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
