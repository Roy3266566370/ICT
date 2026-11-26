import { useEffect, useMemo, useState } from 'react';
import { fourierPartialSum } from '@/canvas/calculus';
import { useReducedMotion } from '@/hooks/useMotionPreference';
import styles from './PageIntros.module.css';

const STORAGE_KEY = 'wanxiang.intro.living.collapsed.v1';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function LivingIntroBanner(): JSX.Element {
  const [collapsed, setCollapsed] = useState<boolean>(readCollapsed);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [live, setLive] = useState<boolean>(false);
  const [harmonics, setHarmonics] = useState<number>(5);
  const [phase, setPhase] = useState<number>(0);
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

  useEffect(() => {
    if (!live || collapsed || reducedMotion) return undefined;
    let frameId = 0;
    const tick = (): void => {
      setPhase((prev) => prev + 0.025);
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [live, collapsed, reducedMotion]);

  const wavePoints = useMemo(() => {
    const pts: string[] = [];
    for (let i = 0; i <= 90; i += 1) {
      const x = 6 + (i / 90) * 208;
      const theta = (i / 90) * Math.PI * 2 + (live ? phase : 0);
      const y = 38 - fourierPartialSum('square', harmonics, theta) * 22;
      pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }
    return pts.join(' ');
  }, [harmonics, live, phase]);

  const selectStep = (nextStep: 1 | 2 | 3): void => {
    setStep(nextStep);
    setLive(nextStep >= 2);
  };

  const togglePower = (): void => {
    setLive((prev) => {
      const next = !prev;
      if (next && step === 1) setStep(2);
      if (!next) setStep(1);
      return next;
    });
  };

  return (
    <section className={styles.atlasSheet} aria-label="通文册功能演示导览">
      <div className={styles.atlasBar}>
        <span>交互试读 · 傅里叶与信号</span>
        <button type="button" className={styles.collapseBtn} onClick={toggleCollapsed} aria-expanded={!collapsed}>
          {collapsed ? '展开试读' : '收起试读'}
        </button>
      </div>
      {!collapsed && <>
        <div key={step} className={styles.atlasFigure}>
          <svg viewBox="0 0 220 76" role="img" aria-label="傅里叶波形">
            <path d="M6 16H214M6 38H214M6 60H214M58 6V70M110 6V70M162 6V70"
              fill="none" stroke="#e9e6da" strokeOpacity=".17" strokeWidth=".5" />
            <polyline points={wavePoints} fill="none" stroke="#f3c86b"
              strokeWidth="1.25" strokeLinecap="round" />
          </svg>
          <span className={styles.atlasEmbed}>{live ? '来自定象坊 · 傅里叶象砖' : '静态原稿 · 傅里叶级数'}</span>
        </div>
        <label className={styles.atlasRange}>
          谐波阶数
          <input type="range" min={1} max={15} step={2} value={harmonics}
            onChange={event => setHarmonics(event.currentTarget.valueAsNumber)} />
          <output>{harmonics}</output>
        </label>
        <div className={styles.atlasBar}>
          <button type="button" className={styles.atlasControl} aria-pressed={live} onClick={togglePower}>
            {live ? '暂停通电' : '给幻灯片通电'}
          </button>
          <span>{['原稿', '实时插件', '离线演播'][step - 1]} · {step} / 3</span>
        </div>
        <button className={styles.flipCorner} type="button" onClick={() => selectStep(step === 3 ? 1 : step === 1 ? 2 : 3)}>
          翻页 ↻
        </button>
      </>}
    </section>
  );
}
