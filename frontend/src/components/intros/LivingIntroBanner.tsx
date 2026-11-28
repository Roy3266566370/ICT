import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { fourierPartialSum } from '@/canvas/calculus';
import { useReducedMotion } from '@/hooks/useMotionPreference';
import styles from './PageIntros.module.css';

const STORAGE_KEY = 'wanxiang.intro.living.collapsed.v1';
const TURN_DURATION_MS = 880;

export type BookStep = 1 | 2 | 3;
export type TurnDirection = 'forward' | 'backward';
type WavePreset = 'square' | 'sawtooth' | 'triangle';

const STEP_META: Record<BookStep, { num: string; tag: string; label: string; header: string }> = {
  1: { num: 'p.01', tag: '原稿', label: '01 · 静态原稿', header: '原稿导入 · 傅里叶与信号' },
  2: { num: 'p.02', tag: '实时插件', label: '02 · 嵌入积木', header: '交互试读 · 傅里叶积木' },
  3: { num: 'p.03', tag: '离线演播', label: '03 · 离线带走', header: '单文件演播 · 教室断网可用' },
};

const WAVE_LABELS: Record<WavePreset, string> = {
  square: '方波',
  sawtooth: '锯齿波',
  triangle: '三角波',
};

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/** 计算波形采样点（支持方波 / 锯齿波 / 三角波） */
function sampleWave(preset: WavePreset, harmonics: number, phase: number): string {
  const pts: string[] = [];
  for (let i = 0; i <= 90; i += 1) {
    const x = 6 + (i / 90) * 208;
    const theta = (i / 90) * Math.PI * 2 + phase;
    let val = 0;
    if (preset === 'square') {
      val = fourierPartialSum('square', harmonics, theta);
    } else if (preset === 'sawtooth') {
      const count = Math.max(1, Math.ceil(harmonics / 2));
      for (let k = 1; k <= count; k += 1) {
        val += ((k % 2 === 1 ? 1 : -1) * Math.sin(k * theta)) / k;
      }
      val *= 0.68;
    } else {
      const count = Math.max(1, Math.ceil(harmonics / 2));
      for (let idx = 0; idx < count; idx += 1) {
        const n = 2 * idx + 1;
        val += ((idx % 2 === 0 ? 1 : -1) * Math.sin(n * theta)) / (n * n);
      }
      val *= 0.92;
    }
    const y = 38 - val * 22;
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return pts.join(' ');
}

/** 计算当前谐波对应的前 6 阶频谱幅度（用于第 2 页仪器谱柱） */
function harmonicBars(harmonics: number): number[] {
  const count = Math.max(1, Math.ceil(harmonics / 2));
  return Array.from({ length: 6 }, (_, idx) => {
    const order = idx * 2 + 1;
    if (idx >= count) return 0.08;
    return Math.max(0.14, 1 / order);
  });
}

interface PageFaceProps {
  step: BookStep;
  collapsed: boolean;
  live: boolean;
  harmonics: number;
  phase: number;
  preset: WavePreset;
  interactive: boolean;
  onToggleCollapsed?: () => void;
  onHarmonicsChange?: (value: number) => void;
  onTogglePower?: () => void;
  onPresetChange?: (preset: WavePreset) => void;
  onJumpStep?: (target: BookStep) => void;
}

/** 单面书页内容（完整包含书页天头、细线框与核心交互卡片，供底层页与 3D 翻动纸叶复用） */
function BookPageFace({
  step,
  collapsed,
  live,
  harmonics,
  phase,
  preset,
  interactive,
  onToggleCollapsed,
  onHarmonicsChange,
  onTogglePower,
  onPresetChange,
  onJumpStep,
}: PageFaceProps): JSX.Element {
  const meta = STEP_META[step];
  const isStaticStep = step === 1;
  const isOfflineStep = step === 3;
  const effectiveLive = !isStaticStep && live;
  const activePreset: WavePreset = isOfflineStep ? preset : 'square';

  const wavePoints = useMemo(
    () => sampleWave(activePreset, harmonics, effectiveLive ? phase : 0),
    [activePreset, harmonics, effectiveLive, phase],
  );
  const bars = useMemo(() => harmonicBars(harmonics), [harmonics]);

  return (
    <div className={styles.bookLeafContent} data-step={step}>
      <header className={styles.folioHeader}>
        <span className={styles.folioSection}>{meta.label}</span>
        <span className={styles.folioNumber}>{meta.num} / 03</span>
      </header>

      <section
        className={`${styles.atlasSheet} ${isStaticStep ? styles.atlasSheetDraft : ''} ${isOfflineStep ? styles.atlasSheetOffline : ''}`}
        aria-label={interactive ? '通文册功能演示导览' : undefined}
      >
        <div className={styles.atlasBar}>
          <span className={styles.atlasBarTitle}>
            {step === 2 && effectiveLive ? <i className={styles.liveBeacon} aria-hidden="true" /> : null}
            {step === 3 ? <i className={styles.offlineBeacon} aria-hidden="true" /> : null}
            {meta.header}
          </span>
          {interactive && onToggleCollapsed ? (
            <button type="button" className={styles.collapseBtn} onClick={onToggleCollapsed} aria-expanded={!collapsed}>
              {collapsed ? '展开试读' : '收起试读'}
            </button>
          ) : (
            <span className={styles.collapseStub}>{collapsed ? '展开试读' : '收起试读'}</span>
          )}
        </div>

        {!collapsed && (
          <>
            <div className={styles.atlasFigure}>
              <svg viewBox="0 0 220 76" role="img" aria-label="傅里叶波形">
                <path
                  d="M6 16H214M6 38H214M6 60H214M58 6V70M110 6V70M162 6V70"
                  fill="none"
                  stroke={isStaticStep ? '#121513' : '#e9e6da'}
                  strokeOpacity={isStaticStep ? '.11' : '.17'}
                  strokeWidth=".5"
                />
                {step === 2 ? (
                  <g opacity=".36">
                    {bars.map((amp, idx) => {
                      const h = amp * 26;
                      return (
                        <rect
                          key={idx}
                          x={168 + idx * 7}
                          y={70 - h}
                          width={4.5}
                          height={h}
                          rx={1}
                          fill={amp > 0.1 ? '#5eead4' : '#ffffff44'}
                        />
                      );
                    })}
                  </g>
                ) : null}
                <polyline
                  points={wavePoints}
                  fill="none"
                  stroke={isStaticStep ? '#bb3519' : isOfflineStep ? '#5eead4' : '#f3c86b'}
                  strokeWidth={isStaticStep ? '1.35' : '1.45'}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>

              <span className={styles.atlasEmbed}>
                {isStaticStep
                  ? '静态原稿 · 保留原排版'
                  : isOfflineStep
                    ? `单文件 .html · ${WAVE_LABELS[activePreset]}断网可演`
                    : effectiveLive
                      ? '来自定象坊 · 实时通电中'
                      : '来自定象坊 · 已暂停'}
              </span>
              {isOfflineStep ? <span className={styles.offlineBadge}>✓ 离线可用</span> : null}
            </div>

            {isOfflineStep ? (
              <div className={styles.wavePresetRow} role="group" aria-label="离线演播波形预设">
                {(['square', 'sawtooth', 'triangle'] as const).map((key) => (
                  <button
                    key={key}
                    type="button"
                    tabIndex={interactive ? 0 : -1}
                    className={`${styles.wavePresetBtn} ${activePreset === key ? styles.wavePresetBtnActive : ''}`}
                    onClick={interactive ? () => onPresetChange?.(key) : undefined}
                  >
                    {WAVE_LABELS[key]}
                  </button>
                ))}
              </div>
            ) : null}

            <label className={styles.atlasRange}>
              <span>谐波阶数</span>
              <input
                type="range"
                min={1}
                max={15}
                step={2}
                value={harmonics}
                disabled={!interactive}
                tabIndex={interactive ? 0 : -1}
                onChange={(event) => onHarmonicsChange?.(event.currentTarget.valueAsNumber)}
              />
              <output>{harmonics}</output>
            </label>

            <div className={styles.atlasBar}>
              {isStaticStep ? (
                <button
                  type="button"
                  className={styles.atlasControl}
                  tabIndex={interactive ? 0 : -1}
                  onClick={interactive ? () => onJumpStep?.(2) : undefined}
                >
                  ⚡ 给幻灯片通电
                </button>
              ) : (
                <button
                  type="button"
                  className={styles.atlasControl}
                  aria-pressed={effectiveLive}
                  tabIndex={interactive ? 0 : -1}
                  onClick={interactive ? onTogglePower : undefined}
                >
                  {effectiveLive ? '⏸ 暂停波形' : '▶ 继续通电'}
                </button>
              )}
              <span>
                {meta.tag} · {step} / 3
              </span>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

interface TurnSession {
  id: number;
  from: BookStep;
  to: BookStep;
  direction: TurnDirection;
}

export function LivingIntroBanner({
  onTurnChange,
}: {
  onTurnChange?: (direction: TurnDirection | null) => void;
}): JSX.Element {
  const [collapsed, setCollapsed] = useState<boolean>(readCollapsed);
  const [step, setStep] = useState<BookStep>(1);
  const [live, setLive] = useState<boolean>(true);
  const [harmonics, setHarmonics] = useState<number>(5);
  const [preset, setPreset] = useState<WavePreset>('square');
  const [phase, setPhase] = useState<number>(0);
  const [turn, setTurn] = useState<TurnSession | null>(null);
  const turnSeq = useRef(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();

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

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!turn || !stage) return;
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    const start = performance.now();
    let frame = 0;

    const draw = (now: number): void => {
      const elapsed = reducedMotion ? 1 : Math.min(1, Math.max(0, (now - start) / TURN_DURATION_MS));
      const eased = elapsed * elapsed * (3 - 2 * elapsed);
      const progress = turn.direction === 'forward' ? eased : 1 - eased;
      // The free corner leads the top edge. Reflect the lifted part across
      // their shared crease so the front and reverse meet throughout the turn.
      const bottom = width * (1 - progress);
      const slope = Math.min(0.48, width / height * 0.55) * (1 - progress);
      const top = bottom + slope * height;
      const norm = 1 + slope * slope;
      const style = stage.style;
      style.setProperty('--fold-top', `${top}px`);
      style.setProperty('--fold-bottom', `${bottom}px`);
      style.setProperty('--fold-angle', `${90 + Math.atan(slope) * 180 / Math.PI}deg`);
      style.setProperty('--fold-stop', `${top / Math.sqrt(norm)}px`);
      style.setProperty('--fold-depth', String(Math.sin(Math.PI * progress)));
      style.setProperty('--fold-reflection',
        `matrix(${1 - 2 / norm},${-2 * slope / norm},${-2 * slope / norm},${1 - 2 * slope * slope / norm},${2 * top / norm},${2 * top * slope / norm})`);
      if (elapsed < 1) {
        frame = requestAnimationFrame(draw);
      } else {
        setStep(turn.to);
        setTurn(null);
        onTurnChange?.(null);
      }
    };
    draw(start);
    return () => cancelAnimationFrame(frame);
  }, [turn, reducedMotion, onTurnChange]);

  useEffect(() => {
    const needAnimation = !collapsed && !reducedMotion && live && (step >= 2 || (turn !== null && turn.to >= 2));
    if (!needAnimation) return undefined;
    let frameId = 0;
    const tick = (): void => {
      setPhase((prev) => prev + 0.028);
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [live, collapsed, reducedMotion, step, turn]);

  const flipTo = (target: BookStep, explicitDir?: TurnDirection): void => {
    if (target === step || turn !== null) return;
    if (reducedMotion) {
      setStep(target);
      if (target >= 2) setLive(true);
      return;
    }
    const direction: TurnDirection = explicitDir ?? (target > step ? 'forward' : 'backward');
    const id = ++turnSeq.current;
    if (target >= 2) setLive(true);
    setTurn({ id, from: step, to: target, direction });
    onTurnChange?.(direction);
  };

  const nextStep: BookStep = step === 3 ? 1 : ((step + 1) as BookStep);
  const prevStep: BookStep = step === 1 ? 3 : ((step - 1) as BookStep);

  // 底层页逻辑：
  // - 正翻（右→左）：底层提前露出来的是「目标页 to」，上方纸叶正面是「离开页 from」
  // - 反翻（左→右）：底层保持「当前页 from」，上方纸叶从左掀回右，正面是「目标页 to」
  const underStep: BookStep = turn ? (turn.direction === 'forward' ? turn.to : turn.from) : step;
  const leafStep: BookStep | null = turn ? (turn.direction === 'forward' ? turn.from : turn.to) : null;
  const isTurning = turn !== null;

  return (
    <div ref={stageRef} className={styles.bookSpreadStage} data-turning={turn?.direction}>
      {/* 底层书页：翻页瞬间在下方自然显现 */}
      <div className={styles.underPage}>
        <BookPageFace
          step={underStep}
          collapsed={collapsed}
          live={live}
          harmonics={harmonics}
          phase={phase}
          preset={preset}
          interactive={!isTurning}
          onToggleCollapsed={toggleCollapsed}
          onHarmonicsChange={setHarmonics}
          onTogglePower={() => setLive((v) => !v)}
          onPresetChange={setPreset}
          onJumpStep={(target) => flipTo(target, target > step ? 'forward' : 'backward')}
        />
        {isTurning ? (
          <div className={styles.underPageShadow} aria-hidden="true" />
        ) : null}
      </div>

      {turn && leafStep !== null ? (
        <div
          key={`leaf-${turn.id}`}
          className={styles.turningLeaf}
          aria-hidden="true"
        >
          <div className={styles.leafFront}>
            <BookPageFace
              step={leafStep}
              collapsed={collapsed}
              live={live}
              harmonics={harmonics}
              phase={phase}
              preset={preset}
              interactive={false}
            />
            <div className={styles.leafFrontShade} />
          </div>
          <div className={styles.leafBack} />
        </div>
      ) : null}

      {/* 页脚轻巧页码导航（支持直接跳转与上一页/下一页双向翻页） */}
      {!collapsed ? (
        <nav className={styles.folioFooter} aria-label="试读书页导航">
          <button
            type="button"
            className={styles.folioNavBtn}
            disabled={isTurning}
            aria-label="翻回上一页"
            onClick={() => flipTo(prevStep, 'backward')}
          >
            ← 上一页
          </button>
          <div className={styles.folioDots} role="tablist" aria-label="选择演示页">
            {([1, 2, 3] as const).map((idx) => (
              <button
                key={idx}
                type="button"
                role="tab"
                aria-selected={step === idx}
                aria-label={STEP_META[idx].label}
                title={STEP_META[idx].label}
                disabled={isTurning}
                className={`${styles.folioDot} ${step === idx ? styles.folioDotActive : ''}`}
                onClick={() => flipTo(idx)}
              />
            ))}
          </div>
        </nav>
      ) : null}

      {/* 右下角贴合书页边缘的真实书角卷翘（Dog-ear Page Curl） */}
      {!collapsed ? (
        <button
          type="button"
          className={`${styles.pageCurlBtn} ${isTurning ? styles.pageCurlHidden : ''}`}
          disabled={isTurning}
          aria-label={`翻至下一页：${STEP_META[nextStep].tag}`}
          title={`点击翻页（${STEP_META[nextStep].label}）`}
          onClick={() => flipTo(nextStep, 'forward')}
        >
          <span className={styles.pageCurlHint}>翻页 ↻</span>
          <span className={styles.pageCurlFlap} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
