/** 万象活页顶部动态引入区：「死 PPT 瞬间通电 · 透视演示窗」。 */

import { useEffect, useMemo, useState } from 'react';
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
    if (!live || collapsed) return undefined;
    let frameId = 0;
    const tick = (): void => {
      setPhase((prev) => prev + 0.025);
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [live, collapsed]);

  const wavePoints = useMemo(() => {
    const pts: string[] = [];
    for (let i = 0; i <= 90; i += 1) {
      const x = 6 + (i / 90) * 208;
      const theta = (i / 90) * Math.PI * 2 + (live ? phase : 0);
      let sum = 0;
      for (let k = 1; k <= harmonics; k += 2) {
        sum += (4 / (Math.PI * k)) * Math.sin(k * theta);
      }
      const y = 38 - sum * 22;
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
    <section
      className={`${styles.introShell} ${collapsed ? styles.isCollapsed : ''}`}
      aria-label="万象活页功能演示导览"
    >
      <div className={styles.introHead}>
        <div className={styles.introHeadLeft}>
          <span className={styles.eyebrowPill}>
            <span className={styles.dot} />
            PPT 活化透视
          </span>
          <span className={styles.introHeadTitle}>
            保留原版式，让最难讲的那几页当场“通电”
          </span>
          <span className={styles.introHeadSub}>支持 PPTX / PDF / 图片</span>
        </div>
        <button type="button" className={styles.collapseBtn} onClick={toggleCollapsed}>
          {collapsed ? '展开导览 ▾' : '收起导览 ▴'}
        </button>
      </div>

      {!collapsed ? (
        <div className={styles.introBody}>
          <div className={styles.livingLayout}>
            <div className={styles.livingSteps}>
              <button
                type="button"
                className={`${styles.livingStepBtn} ${step === 1 ? styles.livingStepActive : ''}`}
                onClick={() => selectStep(1)}
              >
                <span className={styles.stepNum}>1</span>
                <div className={styles.stepText}>
                  <strong>原稿高清保真导入</strong>
                  <span>熟悉排版完整保留，文字与原生图表/表格随时可改。</span>
                </div>
              </button>

              <button
                type="button"
                className={`${styles.livingStepBtn} ${step === 2 ? styles.livingStepActive : ''}`}
                onClick={() => selectStep(2)}
              >
                <span className={styles.stepNum}>2</span>
                <div className={styles.stepText}>
                  <strong>任意页嵌入工坊活仪器</strong>
                  <span>从「我的作品」或「公开画廊」挑一台仪器，直接贴进幻灯片。</span>
                </div>
              </button>

              <button
                type="button"
                className={`${styles.livingStepBtn} ${step === 3 ? styles.livingStepActive : ''}`}
                onClick={() => selectStep(3)}
              >
                <span className={styles.stepNum}>3</span>
                <div className={styles.stepText}>
                  <strong>单文件 HTML 断网演播</strong>
                  <span>拷进 U 盘双击即讲，教室断网也能实时拖参数、播动画。</span>
                </div>
              </button>

              <div className={styles.powerRow}>
                <button
                  type="button"
                  className={`${styles.powerToggle} ${live ? styles.powerToggleLive : ''}`}
                  onClick={togglePower}
                >
                  {live ? '✓ 已通电 · 点击还原静页' : '⚡ 点击给幻灯片通电'}
                </button>
                <span className={styles.powerHint}>
                  {live
                    ? step === 3
                      ? '已打包离线 HTML，断网照常拖动下方滑杆'
                      : '试着拖动幻灯片里的「谐波阶数」滑杆'
                    : '当前：静态原稿态'}
                </span>
              </div>
            </div>

            <div className={styles.slideStageWrap}>
              <div
                className={`${styles.slideDeckStack} ${live ? styles.slideDeckLive : ''} ${
                  step === 3 ? styles.showOffline : ''
                }`}
              >
                <div className={styles.scanBeam} aria-hidden="true" />
                <div className={styles.offlineStamp}>✓ 单文件 HTML · 断网可用</div>

                <div>
                  <div className={styles.slideTopBar}>
                    <span>SLIDE 06 / 18 · 课堂原稿</span>
                    <span>{live ? 'LIVE PLUGIN' : 'STATIC'}</span>
                  </div>
                  <div className={styles.slideTitleMock}>傅里叶级数：方波的谐波叠加</div>
                </div>

                <div className={styles.slideContentCols}>
                  <div className={styles.slideTextMock}>
                    <div className={styles.mockLine} />
                    <div className={`${styles.mockLine} ${styles.mockLineMid}`} />
                    <div className={`${styles.mockLine} ${styles.mockLineShort}`} />
                    <div className={styles.mockFormulaBox}>
                      N = {harmonics} 阶谐波 · {live ? '与右图实时联动' : '静态配图'}
                    </div>
                  </div>

                  <div className={styles.slideWidgetSlot}>
                    <div className={styles.widgetSlotHead}>
                      <span>{live ? '万象工坊 · 傅里叶活仪器' : '静态插图占位'}</span>
                      <span className={styles.widgetLivePill}>
                        {live ? '实时演化中' : '未通电'}
                      </span>
                    </div>

                    <svg className={styles.slideWidgetSvg} viewBox="0 0 220 76" aria-label="傅里叶波形">
                      <line
                        x1="6"
                        y1="38"
                        x2="214"
                        y2="38"
                        stroke="rgba(17,19,18,0.12)"
                        strokeDasharray="3 3"
                      />
                      <polyline
                        points={wavePoints}
                        fill="none"
                        stroke={live ? '#2234d4' : '#a4a6a0'}
                        strokeWidth={live ? 2.2 : 1.6}
                        strokeLinecap="round"
                      />
                    </svg>

                    <div className={styles.slideWidgetCtrl}>
                      <span>谐波阶数</span>
                      <input
                        className={styles.paperRange}
                        type="range"
                        aria-label="谐波阶数"
                        min={1}
                        max={15}
                        step={2}
                        value={harmonics}
                        onChange={(e) => {
                          const next = parseInt(e.currentTarget.value, 10);
                          setHarmonics(next);
                        }}
                      />
                      <output className={styles.slideWidgetOut}>{harmonics}</output>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
