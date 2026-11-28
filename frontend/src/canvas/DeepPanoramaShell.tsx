import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import styles from './deepPanorama.module.css';
import type { DeepKpi, DeepPanoramaControl, DeepPanoramaRenderState, DeepScenarioPreset } from './deepPanoramaTypes';
import { clamp, finite, round } from './deepPanoramaEngine';

function ShellMark() {
  return (
    <span className={styles.mark} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="3" y="3" width="18" height="18" rx="3" />
        <path d="M7 15c3-7 7 3 10-6" />
        <path d="M7 8h.01M17 16h.01" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
    </span>
  );
}

export function PanoramaCanvas({ draw, label }: {
  draw: (ctx: CanvasRenderingContext2D, width: number, height: number) => void;
  label: string;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const ref = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState({ width: 640, height: 420 });
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return undefined;
    // 监听外层定位容器而非 canvas 自身，避免设置 canvas.height *= dpr 时触发布局增高循环
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const nextWidth = Math.max(240, Math.round(entry.contentRect.width));
      const nextHeight = Math.max(220, Math.round(entry.contentRect.height));
      setSize((prev) => (
        Math.abs(prev.width - nextWidth) < 1 && Math.abs(prev.height - nextHeight) < 1
          ? prev
          : { width: nextWidth, height: nextHeight }
      ));
    });
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(size.width * ratio);
    canvas.height = Math.round(size.height * ratio);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    draw(ctx, size.width, size.height);
  }, [draw, size.height, size.width]);
  return (
    <div ref={wrapRef} className={styles.canvasWrap}>
      <canvas ref={ref} className={styles.canvas} role="img" aria-label={label} />
    </div>
  );
}

export function DeepPanoramaShell(props: {
  title: string;
  subtitle: string;
  stages: readonly string[];
  presets: readonly DeepScenarioPreset[];
  params: Record<string, number>;
  totalSteps: number | ((params: Record<string, number>) => number);
  controls: readonly DeepPanoramaControl[];
  onParams?: (patch: Record<string, number>) => void;
  stageForFrame: (frame: number, params: Record<string, number>) => number;
  renderFormula: (state: DeepPanoramaRenderState) => ReactNode;
  renderKpis: (state: DeepPanoramaRenderState) => DeepKpi[];
  caption?: (state: DeepPanoramaRenderState) => ReactNode;
  resetPatch?: Record<string, number>;
  children: (state: DeepPanoramaRenderState) => ReactNode;
}) {
  const total = Math.max(1, typeof props.totalSteps === 'function' ? props.totalSteps(props.params) : props.totalSteps);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [lockedStage, setLockedStage] = useState<number | null>(null);
  const params = props.params;
  const applyParams = useCallback((patch: Record<string, number>) => {
    const clean = Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, finite(value, props.params[key] ?? 0)]));
    props.onParams?.(clean);
  }, [props]);
  const setParam = useCallback((key: string, value: number) => applyParams({ [key]: value }), [applyParams]);
  useEffect(() => {
    if (!playing) return undefined;
    const timer = window.setInterval(() => {
      setFrame((current) => (current + speed * 0.72) % total);
    }, 72);
    return () => window.clearInterval(timer);
  }, [playing, speed, total]);
  useEffect(() => {
    setFrame((current) => clamp(current, 0, total - 0.01));
  }, [total]);
  const autoStage = clamp(props.stageForFrame(frame, params), 0, props.stages.length - 1);
  const stage = lockedStage ?? autoStage;
  const state: DeepPanoramaRenderState = {
    frame,
    stage,
    params,
    setParam,
    applyParams,
  };
  const activePreset = (preset: DeepScenarioPreset) => Object.entries(preset.patch).every(([key, value]) => Math.abs((params[key] ?? 0) - value) < 1e-7);
  const choosePreset = (preset: DeepScenarioPreset) => {
    setFrame(0);
    setLockedStage(null);
    applyParams(preset.patch);
  };
  const reset = () => {
    setFrame(0);
    setPlaying(false);
    if (props.resetPatch) applyParams(props.resetPatch);
  };
  return (
    <section className={styles.shell} aria-label={props.title}>
      <header className={styles.topbar}>
        <div className={styles.identity}>
          <ShellMark />
          <div>
            <p className={styles.eyebrow}>Deep Learning Panorama</p>
            <h2 className={styles.title}>{props.title}</h2>
            <p className={styles.subtitle}>{props.subtitle}</p>
          </div>
        </div>
        <div className={styles.presets} aria-label="情境预设">
          {props.presets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`${styles.preset} ${activePreset(preset) ? styles.active : ''}`}
              title={preset.note}
              onClick={() => choosePreset(preset)}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className={styles.transport}>
          <button type="button" className={`${styles.transportButton} ${styles.primary}`} aria-label={playing ? '暂停' : '播放'} onClick={() => setPlaying((value) => !value)}>
            {playing ? 'Ⅱ' : '▶'}
          </button>
          <button type="button" className={styles.transportButton} aria-label="单步" onClick={() => { setPlaying(false); setFrame((value) => Math.min(total - 0.01, value + 1)); }}>
            ⇥
          </button>
          <div className={styles.progressWrap}>
            <div className={styles.progressMeta}><span>过程</span><span>{round(frame, 1)} / {total}</span></div>
            <input className={styles.progress} type="range" min={0} max={total - 0.01} step={0.1} value={frame} aria-label="过程进度" onChange={(event) => { setPlaying(false); setFrame(Number(event.target.value)); }} />
          </div>
          <div className={styles.speed} aria-label="速度">
            {[0.5, 1, 2].map((value) => (
              <button key={value} type="button" className={speed === value ? styles.active : ''} onClick={() => setSpeed(value)}>{value}×</button>
            ))}
          </div>
          <button type="button" className={styles.transportButton} aria-label="重置" onClick={reset}>↺</button>
        </div>
      </header>
      <nav className={styles.stepper} style={{ '--stage-count': props.stages.length } as React.CSSProperties} aria-label="舞台流水线">
        {props.stages.map((label, index) => (
          <button
            key={label}
            type="button"
            className={`${styles.stageStep} ${stage === index ? styles.active : ''} ${lockedStage === index ? styles.locked : ''}`}
            title={lockedStage === index ? '已锁定，点击解锁并回到联动' : '点击锁定此阶段细看'}
            onClick={() => setLockedStage((current) => current === index ? null : index)}
          >
            <span className={styles.stageIndex}>{index + 1}</span>
            <span className={styles.stageText}>{label}</span>
          </button>
        ))}
      </nav>
      <div className={styles.workspace}>
        <div className={styles.mainStage}>
          {props.children(state)}
          {props.caption ? <div className={styles.stageCaption}>{props.caption(state)}</div> : null}
        </div>
        <aside className={styles.sideCabin}>
          <div className={styles.cabinHeader}>
            <h3>参数舱</h3>
            <p>改动会立即回写舞台并参与分享复刻</p>
          </div>
          <div className={styles.controls}>
            {props.controls.map((control) => {
              const value = finite(params[control.key], control.min ?? 0);
              return (
                <label key={control.key} className={styles.control}>
                  <span className={styles.controlHead}>
                    <span>{control.label}</span>
                    <output>{control.format ? control.format(value) : round(value, 3)}</output>
                  </span>
                  {control.options ? (
                    <span className={styles.optionChips}>
                      {control.options.map((option) => (
                        <button key={option.value} type="button" className={Math.round(value) === option.value ? styles.active : ''} onClick={() => setParam(control.key, option.value)}>
                          {option.label}
                        </button>
                      ))}
                    </span>
                  ) : (
                    <input type="range" min={control.min ?? 0} max={control.max ?? 1} step={control.step ?? 0.01} value={value} onChange={(event) => setParam(control.key, Number(event.target.value))} />
                  )}
                </label>
              );
            })}
          </div>
          <p className={styles.cabinNote}>提示：流水线阶段可点击锁定；再次点击即恢复与时间轴联动。播放/单步只改变观察过程，不修改画布结构。</p>
        </aside>
      </div>
      <footer className={styles.insightBar}>
        <div className={styles.formula}>{props.renderFormula(state)}</div>
        <div className={styles.kpis}>
          {props.renderKpis(state).map((kpi) => (
            <div key={kpi.label} className={styles.kpi} data-tone={kpi.tone ?? 'ink'}>
              <span>{kpi.label}</span>
              <strong>{kpi.value}</strong>
            </div>
          ))}
        </div>
      </footer>
    </section>
  );
}
