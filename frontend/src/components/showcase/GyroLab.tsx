import { useCallback, useEffect, useRef, useState } from 'react';

import { useReducedMotion } from '@/hooks/useMotionPreference';

import Formula from './Formula';
import GyroCanvas, {
  type GyroSceneApi,
  type GyroStepVectors,
  type GyroView,
  type GyroVisibility,
} from './GyroCanvas';
import GyroChart, { type GyroChartApi } from './GyroChart';
import { LabSlider, Segmented, Stat } from './controls';
import {
  DEFAULT_PHYSICAL,
  DEFAULT_SETUP,
  GRAVITY,
  type GyroConstants,
  type GyroSetup,
  type GyroState,
  type SimulationSample,
  angularMomentumOf,
  createRun,
  degToRad,
  energyOf,
  measurePrecession,
  precessionApproximation,
  precessionOf,
  radToDeg,
  stepGyro,
  stepHalvingDeviation,
  thetaRange,
} from './gyroMath';
import styles from './gyroscope.module.css';

type ObserveMode = 'none' | 'precession' | 'nutation';
type PredictionChoice = 'faster' | 'slower' | 'same';
type ExplainStep = 1 | 2 | 3;

interface Baseline {
  samples: SimulationSample[];
  setup: GyroSetup;
  precession: number;
  label: string;
}

interface Readout {
  thetaDeg: number;
  phiDeg: number;
  spin: number;
  precession: number;
  period: number;
  nutationDeg: number;
  time: number;
  contact: boolean;
  energyDrift: number;
  pzDrift: number;
  stepDeviation: number;
}

interface ActiveMeta {
  I1: number;
  I3: number;
  mgL: number;
  steadyPossible: boolean;
  initialPrecession: number;
}

interface PredictionCheck {
  answer: PredictionChoice;
  baseline: Baseline;
  spinBefore: number;
  spinAfter: number;
  targetTime: number;
}

interface PredictionResult {
  answer: PredictionChoice;
  actual: PredictionChoice;
  correct: boolean;
  baselineRate: number;
  currentRate: number;
  spinBefore: number;
  spinAfter: number;
}

const PHYSICS_STEP = 1 / 480;
const RECORD_INTERVAL = 1 / 60;
const STEP_SECONDS = 0.05;
const SPIN_MAX = 80;
const TIME_SCALES = [0.1, 0.25, 0.5, 1] as const;

const PRESETS = [
  {id: 1, index: '01', title: '自由倾倒', hint: '不自转，释放后看它倒下', tag: '建立直觉'},
  {id: 2, index: '02', title: '稳定进动', hint: '快速自转，轴绕竖直方向转', tag: '默认'},
  {id: 3, index: '03', title: '转速对比', hint: '先预测，再验证进动快慢', tag: '预测'},
  {id: 4, index: '04', title: '章动', hint: '倾斜释放，或施加一次扰动', tag: '初始条件'},
] as const;

const OBSERVE_OPTIONS: readonly {value: ObserveMode; label: string}[] = [
  {value: 'none', label: '不突出'},
  {value: 'precession', label: '进动'},
  {value: 'nutation', label: '章动'},
];

const RELEASE_OPTIONS: readonly {value: 'steady' | 'tilt'; label: string}[] = [
  {value: 'steady', label: '平稳进动'},
  {value: 'tilt', label: '倾斜释放'},
];

const PREDICTION_OPTIONS: readonly {value: PredictionChoice; label: string}[] = [
  {value: 'faster', label: '更快'},
  {value: 'slower', label: '更慢'},
  {value: 'same', label: '基本不变'},
];

function snapshot(state: GyroState): SimulationSample {
  return {
    time: state.time,
    theta: state.theta,
    thetaDot: state.thetaDot,
    phi: state.phi,
    psi: state.psi,
    contact: state.contact,
  };
}

function metaOf(run: ReturnType<typeof createRun>): ActiveMeta {
  return {
    I1: run.constants.I1,
    I3: run.constants.I3,
    mgL: run.constants.mgL,
    steadyPossible: run.steadyPossible,
    initialPrecession: run.initialPrecession,
  };
}

function readoutOf(
  setup: GyroSetup,
  constants: GyroConstants,
  state: GyroState,
  history: readonly SimulationSample[],
  energy0: number,
  stepDeviation: number,
): Readout {
  const precession = precessionOf(state, constants);
  const period = Math.abs(precession) > 1e-5 ? (2 * Math.PI) / Math.abs(precession) : Number.POSITIVE_INFINITY;
  const recent = history.length > 150 ? history.slice(-150) : history;
  const range = thetaRange(recent);
  const energy = energyOf(state, constants);
  return {
    thetaDeg: radToDeg(state.theta),
    phiDeg: ((radToDeg(state.phi) % 360) + 360) % 360,
    spin: setup.spin,
    precession,
    period,
    nutationDeg: Math.max(0, radToDeg(range.max - range.min)),
    time: state.time,
    contact: state.contact,
    energyDrift: Math.abs(energy0) > 1e-12 ? (energy - energy0) / Math.abs(energy0) : 0,
    pzDrift: angularMomentumOf(state, constants).z - constants.pPhi,
    stepDeviation,
  };
}

function makeBaseline(
  samples: readonly SimulationSample[],
  setup: GyroSetup,
): Baseline | null {
  const last = samples[samples.length - 1];
  if (last === undefined || samples.length < 40 || last.time < 0.7) return null;
  return {
    samples: samples.slice(),
    setup: {...setup},
    precession: measurePrecession(samples, Math.max(0, last.time - 2)),
    label: `${setup.spin.toFixed(0)} rad/s · ${radToDeg(setup.tilt).toFixed(0)}° · ${setup.release === 'steady' ? '平稳' : '倾斜'}`,
  };
}

function formatNumber(value: number, digits = 2): string {
  return Number.isFinite(value) ? value.toFixed(digits) : '—';
}

function formatScientific(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (Math.abs(value) < 1e-12) return '≈ 0';
  return value.toExponential(2);
}

function formatEnergyDrift(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (Math.abs(value) < 1e-12) return '≈ 0 %';
  return `${(value * 100).toExponential(2)} %`;
}

function experimentTitle(preset: number | null): string {
  if (preset === 1) return '实验 01 · 自由倾倒';
  if (preset === 2) return '实验 02 · 稳定进动';
  if (preset === 3) return '实验 03 · 转速对比';
  if (preset === 4) return '实验 04 · 章动从哪里来';
  return '自定义初始条件';
}

function predictionLabel(choice: PredictionChoice): string {
  if (choice === 'faster') return '进动更快';
  if (choice === 'slower') return '进动更慢';
  return '基本不变';
}

export function GyroLab(): JSX.Element {
  const reducedMotion = useReducedMotion();
  const [startupRun] = useState(() => createRun(DEFAULT_SETUP));
  const stateRef = useRef<GyroState>(startupRun.state);
  const constantsRef = useRef<GyroConstants>(startupRun.constants);
  const activeSetupRef = useRef<GyroSetup>(startupRun.setup);
  const stepDeviationRef = useRef<number | null>(null);
  if (stepDeviationRef.current === null) {
    stepDeviationRef.current = stepHalvingDeviation(startupRun, 1.5);
  }
  const energy0Ref = useRef(energyOf(startupRun.state, startupRun.constants));
  const historyRef = useRef<SimulationSample[]>([snapshot(startupRun.state)]);
  const baselineRef = useRef<Baseline | null>(null);
  const accumulatorRef = useRef(0);
  const lastRecordRef = useRef(0);
  const traceKeyRef = useRef(0);
  const predictionCheckRef = useRef<PredictionCheck | null>(null);
  const perturbationTimeRef = useRef<number | null>(null);
  const scrubRef = useRef(false);
  const canvasApi = useRef<GyroSceneApi | null>(null);
  const chartApi = useRef<GyroChartApi | null>(null);
  const timelineRef = useRef<HTMLInputElement | null>(null);
  const timeReadoutRef = useRef<HTMLOutputElement | null>(null);
  const derivationRef = useRef<HTMLElement | null>(null);

  const [draft, setDraft] = useState<GyroSetup>(DEFAULT_SETUP);
  const [activeSetup, setActiveSetup] = useState<GyroSetup>(DEFAULT_SETUP);
  const [activeMeta, setActiveMeta] = useState<ActiveMeta>(() => metaOf(startupRun));
  const [readout, setReadout] = useState<Readout>(() =>
    readoutOf(
      startupRun.setup,
      startupRun.constants,
      startupRun.state,
      historyRef.current,
      energy0Ref.current,
      stepDeviationRef.current ?? 0,
    ),
  );
  const [baseline, setBaseline] = useState<Baseline | null>(null);
  const [playing, setPlaying] = useState(() => !reducedMotion);
  const [timeScale, setTimeScale] = useState(0.5);
  const [view, setView] = useState<GyroView>('free');
  const [observe, setObserve] = useState<ObserveMode>('none');
  const [vectors, setVectors] = useState(false);
  const [explainStep, setExplainStep] = useState<ExplainStep>(1);
  const [highlight, setHighlight] = useState<'r' | 'mg' | null>(null);
  const [preset, setPreset] = useState<number | null>(2);
  const [predictionOpen, setPredictionOpen] = useState(false);
  const [prediction, setPrediction] = useState<PredictionChoice | null>(null);
  const [baselineReady, setBaselineReady] = useState(false);
  const [predictionResult, setPredictionResult] = useState<PredictionResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [stepVectors, setStepVectors] = useState<GyroStepVectors | null>(null);
  const [perturbationTime, setPerturbationTime] = useState<number | null>(null);

  const playingRef = useRef(playing);
  const timeScaleRef = useRef(timeScale);
  const observeRef = useRef(observe);
  const vectorsRef = useRef(vectors);
  const explainStepRef = useRef(explainStep);
  const highlightRef = useRef(highlight);
  const stepRef = useRef(stepVectors);
  playingRef.current = playing;
  timeScaleRef.current = timeScale;
  observeRef.current = observe;
  vectorsRef.current = vectors;
  explainStepRef.current = explainStep;
  highlightRef.current = highlight;
  stepRef.current = stepVectors;

  useEffect(() => {
    if (reducedMotion) {
      setPlaying(false);
      playingRef.current = false;
    }
  }, [reducedMotion]);

  useEffect(() => {
    if (notice === null) return undefined;
    const timer = window.setTimeout(() => setNotice(null), 6500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const startRun = useCallback(
    (
      setup: GyroSetup,
      options: {
        preset?: number | null;
        keepBaseline?: boolean;
        timeScale?: number;
        observe?: ObserveMode;
        vectors?: boolean;
        explainStep?: ExplainStep;
        autoPlay?: boolean;
      } = {},
    ): void => {
      const {
        preset: nextPreset = null,
        keepBaseline = true,
        timeScale: nextScale,
        observe: nextObserve = 'none',
        vectors: nextVectors = false,
        explainStep: nextStep = 1,
        autoPlay = true,
      } = options;
      if (keepBaseline) {
        const captured = makeBaseline(historyRef.current, activeSetupRef.current);
        if (captured !== null) {
          baselineRef.current = captured;
          setBaseline(captured);
        }
      }
      const run = createRun(setup, DEFAULT_PHYSICAL);
      stateRef.current = run.state;
      constantsRef.current = run.constants;
      activeSetupRef.current = run.setup;
      energy0Ref.current = energyOf(run.state, run.constants);
      stepDeviationRef.current = stepHalvingDeviation(run, 1.5);
      historyRef.current = [snapshot(run.state)];
      accumulatorRef.current = 0;
      lastRecordRef.current = 0;
      traceKeyRef.current += 1;
      predictionCheckRef.current = null;
      perturbationTimeRef.current = null;
      stepRef.current = null;
      setStepVectors(null);
      setPerturbationTime(null);
      setPredictionResult(null);
      setPredictionOpen(false);
      setPrediction(null);
      setHighlight(null);
      setActiveSetup(run.setup);
      setActiveMeta(metaOf(run));
      setDraft(run.setup);
      setPreset(nextPreset);
      setDirty(false);
      setObserve(nextObserve);
      setVectors(nextVectors);
      setExplainStep(nextStep);
      if (nextScale !== undefined) setTimeScale(nextScale);
      setReadout(
        readoutOf(
          run.setup,
          run.constants,
          run.state,
          historyRef.current,
          energy0Ref.current,
          stepDeviationRef.current ?? 0,
        ),
      );
      setNotice(null);
      setPlaying(autoPlay);
      playingRef.current = autoPlay;
    },
    [],
  );

  const updateDraft = (patch: Partial<GyroSetup>): void => {
    setDraft((current) => ({...current, ...patch}));
    setDirty(true);
    setPreset(null);
    setPredictionOpen(false);
    setPrediction(null);
    setPredictionResult(null);
    setBaselineReady(false);
  };

  const openCompare = (): void => {
    setPreset(3);
    setPredictionOpen(true);
    setPrediction(null);
    setPredictionResult(null);
    setPlaying(false);
    playingRef.current = false;
    setObserve('none');
    observeRef.current = 'none';
    setNotice(null);
    const active = activeSetupRef.current;
    const last = historyRef.current[historyRef.current.length - 1];
    setBaselineReady(active.release === 'steady' && active.spin > 1 && (last?.time ?? 0) >= 1.2);
  };

  const handlePreset = (id: number): void => {
    if (id === 3) {
      openCompare();
      return;
    }
    if (id === 1) {
      startRun(
        {spin: 0, tilt: degToRad(32), comDistance: DEFAULT_SETUP.comDistance, release: 'tilt'},
        {preset: 1, timeScale: 0.1, observe: 'none', vectors: true, explainStep: 1},
      );
      setNotice('没有自转：重力矩直接让轴倒下。先看 r 与 mg，再看它接触支架。');
      return;
    }
    if (id === 4) {
      const active = activeSetupRef.current;
      const spin = active.spin > 0 ? active.spin : DEFAULT_SETUP.spin;
      startRun(
        {
          spin,
          tilt: degToRad(32),
          comDistance: active.comDistance,
          release: 'tilt',
        },
        {preset: 4, timeScale: 0.25, observe: 'nutation', vectors: false, explainStep: 1},
      );
      setNotice('同样自转、同一器材：这次不按平稳进动条件启动，释放后出现章动。');
      return;
    }
    startRun(DEFAULT_SETUP, {
      preset: 2,
      timeScale: 0.5,
      observe: 'none',
      vectors: false,
      explainStep: 1,
    });
    setNotice('快速自转、平稳进动：倾角几乎不变，轴绕着竖直方向打转。');
  };

  const verifyPrediction = (): void => {
    if (prediction === null) return;
    if (!baselineReady) {
      setNotice('先让一段稳定进动运行 1 秒以上，形成基准。');
      return;
    }
    const captured = makeBaseline(historyRef.current, activeSetupRef.current);
    if (
      captured === null ||
      captured.setup.release !== 'steady' ||
      captured.setup.spin <= 0
    ) {
      setNotice('当前这段运动不是稳定进动，无法作为比较基准。');
      return;
    }
    const spinBefore = captured.setup.spin;
    const spinAfter = Math.min(SPIN_MAX, Math.round(spinBefore * 1.5));
    if (!(spinAfter > spinBefore + 0.5)) {
      setNotice('转速已接近上限，无法再提高；先把转速调低一些。');
      return;
    }
    baselineRef.current = captured;
    setBaseline(captured);
    startRun(
      {...captured.setup, spin: spinAfter, release: 'steady'},
      {preset: 3, keepBaseline: false, timeScale: 0.5, observe: 'none', explainStep: 1},
    );
    predictionCheckRef.current = {
      answer: prediction,
      baseline: captured,
      spinBefore,
      spinAfter,
      targetTime: 2.4,
    };
    setPredictionOpen(false);
    setPrediction(null);
    setPredictionResult(null);
  };

  const applyDraft = (): void => {
    startRun(draft, {
      preset: null,
      keepBaseline: true,
      timeScale,
      observe,
      vectors,
      explainStep,
    });
    setNotice('已按新的初始条件重新开始；上一组结果保留为虚线基准。');
  };

  const togglePlay = (): void => {
    if (stateRef.current.contact) {
      setNotice('轴已经接触支架；请重置或用新的初始条件再开始。');
      return;
    }
    const next = !playingRef.current;
    if (next) {
      stepRef.current = null;
      setStepVectors(null);
    }
    setPlaying(next);
    playingRef.current = next;
  };

  const handleStep = (): void => {
    if (stateRef.current.contact) return;
    setPlaying(false);
    playingRef.current = false;
    const constants = constantsRef.current;
    const beforeState = stateRef.current;
    const before = angularMomentumOf(beforeState, constants);
    let next = beforeState;
    const count = Math.max(1, Math.round(STEP_SECONDS / PHYSICS_STEP));
    for (let index = 0; index < count; index += 1) {
      next = stepGyro(next, constants, PHYSICS_STEP);
      if (next.contact) break;
    }
    stateRef.current = next;
    const last = historyRef.current[historyRef.current.length - 1];
    if (last === undefined || next.time > last.time + 1e-9) {
      historyRef.current.push(snapshot(next));
      lastRecordRef.current = next.time;
    }
    const after = angularMomentumOf(next, constants);
    const step = {before, after};
    stepRef.current = step;
    setStepVectors(step);
    setExplainStep(2);
    explainStepRef.current = 2;
    setVectors(true);
    vectorsRef.current = true;
    setObserve('none');
    observeRef.current = 'none';
    setHighlight(null);
    setReadout(
      readoutOf(
        activeSetupRef.current,
        constants,
        next,
        historyRef.current,
        energy0Ref.current,
        stepDeviationRef.current ?? 0,
      ),
    );
    if (next.contact) setNotice('单步过程中转子碰到了支架，实验结束。');
  };

  const seekTo = (time: number): void => {
    const samples = historyRef.current;
    if (samples.length === 0) return;
    let index = 0;
    let distance = Number.POSITIVE_INFINITY;
    for (let cursor = 0; cursor < samples.length; cursor += 1) {
      const sample = samples[cursor];
      if (sample === undefined) continue;
      const next = Math.abs(sample.time - time);
      if (next < distance) {
        distance = next;
        index = cursor;
      }
    }
    const target = samples[index];
    if (target === undefined) return;
    stateRef.current = {
      theta: target.theta,
      thetaDot: target.thetaDot,
      phi: target.phi,
      psi: target.psi,
      time: target.time,
      contact: target.contact,
    };
    historyRef.current = samples.slice(0, index + 1);
    lastRecordRef.current = target.time;
    accumulatorRef.current = 0;
    setPlaying(false);
    playingRef.current = false;
    stepRef.current = null;
    setStepVectors(null);
    setHighlight(null);
    traceKeyRef.current += 1;
    setReadout(
      readoutOf(
        activeSetupRef.current,
        constantsRef.current,
        stateRef.current,
        historyRef.current,
        energy0Ref.current,
        stepDeviationRef.current ?? 0,
      ),
    );
  };

  const resetRun = (): void => {
    startRun(activeSetupRef.current, {
      preset,
      keepBaseline: true,
      timeScale,
      observe,
      vectors,
      explainStep,
    });
    setNotice('已重新开始当前实验；上一组倾角曲线保留为虚线基准。');
  };

  const togglePerturbation = (): void => {
    if (stateRef.current.contact) return;
    const next = {
      ...stateRef.current,
      thetaDot: stateRef.current.thetaDot + 1.4,
    };
    stateRef.current = next;
    historyRef.current.push(snapshot(next));
    lastRecordRef.current = next.time;
    perturbationTimeRef.current = next.time;
    setPerturbationTime(next.time);
    setObserve('nutation');
    observeRef.current = 'nutation';
    setPlaying(true);
    playingRef.current = true;
    traceKeyRef.current += 1;
    setNotice('已施加一次小扰动：平稳进动被打破，倾角开始上下摆动。');
  };

  const explainWhy = (): void => {
    setVectors(true);
    vectorsRef.current = true;
    setExplainStep(1);
    explainStepRef.current = 1;
    setObserve('precession');
    observeRef.current = 'precession';
    traceKeyRef.current += 1;
    window.requestAnimationFrame(() => {
      derivationRef.current?.scrollIntoView({
        behavior: reducedMotion ? 'auto' : 'smooth',
        block: 'start',
      });
    });
  };

  const selectLayer = (step: ExplainStep): void => {
    setExplainStep(step);
    explainStepRef.current = step;
    setVectors(true);
    vectorsRef.current = true;
    setHighlight(null);
    if (step === 3) {
      setObserve('precession');
      observeRef.current = 'precession';
    } else {
      setObserve('none');
      observeRef.current = 'none';
    }
  };

  const handleObserve = (mode: ObserveMode): void => {
    setObserve(mode);
    observeRef.current = mode;
    if (mode !== 'none') traceKeyRef.current += 1;
  };

  const handleView = (next: GyroView): void => {
    setView(next);
    canvasApi.current?.setView(next);
  };

  const handleOrbitStart = useCallback((): void => {
    setView('free');
  }, []);

  const toggleHighlight = (kind: 'r' | 'mg'): void => {
    setVectors(true);
    vectorsRef.current = true;
    if (explainStep !== 1) {
      setExplainStep(1);
      explainStepRef.current = 1;
    }
    setHighlight((current) => (current === kind ? null : kind));
  };

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let lastChart = 0;
    let lastReadout = 0;

    const loop = (now: number): void => {
      const dtReal = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;

      if (playingRef.current && !stateRef.current.contact) {
        accumulatorRef.current += dtReal * timeScaleRef.current;
        let steps = 0;
        while (accumulatorRef.current >= PHYSICS_STEP && steps < 48) {
          const next = stepGyro(stateRef.current, constantsRef.current, PHYSICS_STEP);
          stateRef.current = next;
          accumulatorRef.current -= PHYSICS_STEP;
          steps += 1;
          if (next.time - lastRecordRef.current >= RECORD_INTERVAL) {
            historyRef.current.push(snapshot(next));
            lastRecordRef.current = next.time;
          }
          if (next.contact) {
            playingRef.current = false;
            setPlaying(false);
            setNotice('转子碰到支架，实验结束。可以重置或换一组初始条件继续比较。');
            break;
          }
        }
        if (steps >= 48) accumulatorRef.current = 0;
      }

      const state = stateRef.current;
      const setup = activeSetupRef.current;
      const step = stepRef.current;
      const visibility: GyroVisibility = {
        labels: true,
        vectors: vectorsRef.current,
        r: explainStepRef.current === 1,
        mg: explainStepRef.current === 1,
        torque: explainStepRef.current <= 2,
        angularMomentum: explainStepRef.current >= 2,
        step: explainStepRef.current === 2 && step !== null,
        precession:
          observeRef.current === 'precession' ||
          (explainStepRef.current === 3 && observeRef.current !== 'nutation'),
        nutation: observeRef.current === 'nutation',
      };
      canvasApi.current?.update({
        state,
        constants: constantsRef.current,
        comDistance: setup.comDistance,
        visibility,
        highlight: highlightRef.current,
        step,
        playing: playingRef.current,
        traceKey: traceKeyRef.current,
      });

      if (now - lastChart > 33) {
        chartApi.current?.draw(
          historyRef.current,
          baselineRef.current?.samples ?? null,
          state.time,
          perturbationTimeRef.current,
          setup,
        );
        lastChart = now;
      }

      const timeline = timelineRef.current;
      if (timeline !== null) {
        timeline.max = String(Math.max(0.1, state.time));
        if (!scrubRef.current) timeline.value = String(state.time);
      }
      if (timeReadoutRef.current !== null) {
        timeReadoutRef.current.textContent = `${state.time.toFixed(2)} s`;
      }

      if (now - lastReadout > 120) {
        lastReadout = now;
        setReadout(
          readoutOf(
            setup,
            constantsRef.current,
            state,
            historyRef.current,
            energy0Ref.current,
            stepDeviationRef.current ?? 0,
          ),
        );
      }

      const check = predictionCheckRef.current;
      if (check !== null && state.time >= check.targetTime) {
        const currentRate = measurePrecession(historyRef.current, Math.max(0.2, state.time - 1.6));
        const baselineRate = check.baseline.precession;
        const ratio = baselineRate > 1e-6 ? currentRate / baselineRate : 1;
        const actual: PredictionChoice = ratio < 0.95 ? 'slower' : ratio > 1.05 ? 'faster' : 'same';
        setPredictionResult({
          answer: check.answer,
          actual,
          correct: check.answer === actual,
          baselineRate,
          currentRate,
          spinBefore: check.spinBefore,
          spinAfter: check.spinAfter,
        });
        predictionCheckRef.current = null;
      }

      raf = window.requestAnimationFrame(loop);
    };

    raf = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(raf);
  }, []);

  const canPerturb = !readout.contact && activeSetup.spin > 0.5;
  const approximation = precessionApproximation(
    activeMeta.mgL,
    activeMeta.I3,
    activeSetup.spin,
  );
  const approximationVsMeasured =
    Number.isFinite(approximation) && Math.abs(readout.precession) > 1e-5
      ? Math.abs(readout.precession - approximation) / Math.abs(readout.precession)
      : null;
  const proposedCompareSpin =
    activeSetup.spin > 0
      ? Math.min(SPIN_MAX, Math.round(activeSetup.spin * 1.5))
      : DEFAULT_SETUP.spin;
  const proposedCompareFactor =
    activeSetup.spin > 0 ? proposedCompareSpin / activeSetup.spin : 1.5;
  const currentStatus = readout.contact
    ? '已接触支架'
    : activeSetup.spin <= 0.5
      ? '自由倾倒'
      : activeSetup.release === 'tilt'
        ? '章动进行中'
        : '平稳进动';
  const insightText = (() => {
    if (predictionResult !== null) {
      const verdict = predictionResult.correct ? '预测正确' : '和预测不同';
      return `${verdict}：自转从 ${predictionResult.spinBefore.toFixed(0)} 提到 ${predictionResult.spinAfter.toFixed(0)} rad/s，实测进动从 ${predictionResult.baselineRate.toFixed(2)} 变为 ${predictionResult.currentRate.toFixed(2)} rad/s。快速自转近似下，Ω_p 与 ω_s 近似成反比。`;
    }
    if (readout.contact) {
      return '轴已经碰到支架，本次实验结束。重力矩在自转为零时直接改变倾角；重新开始或调整初始条件即可对比。';
    }
    if (activeSetup.spin <= 0.5) {
      return '没有自转时，重力矩没有可维持方向的角动量，轴在重力作用下直接倒下。r 与 mg 的箭头显示了这个力矩的来源。';
    }
    if (perturbationTime !== null) {
      return '一次小扰动把系统推离平稳进动。无摩擦模型不会自动把章动抹掉，倾角在平衡值附近来回摆动；拖动时间轴可以逐帧核对三维姿态与 θ(t)。';
    }
    if (activeSetup.release === 'tilt') {
      return '倾斜后直接释放：初始 φ̇=0，不满足平稳进动条件。重力矩让轴开始进动的同时候，倾角在平衡值附近来回变化——这就是章动。';
    }
    return '快速自转、平稳进动：倾角几乎不变，轴绕竖直方向转动。重力矩改变的是角动量的方向，而不是让陀螺立刻倒下。点「为什么会这样？」逐层看 r、mg、τ 与 L。';
  })();

  return (
    <article className={styles.lab} aria-labelledby="gyro-lab-title">
      <header className={styles.labHeader}>
        <div className={styles.headerText}>
          <p className={styles.kicker}>物理 · 刚体动力学</p>
          <h2 id="gyro-lab-title">旋转的陀螺，为什么不会倒？</h2>
          <p className={styles.lead}>
            单支点重陀螺：金属转子、转轴、支承机构、立柱与底座。支点 O 与重心 C 不重合，
            重力作用在 C 上，相对于 O 产生力矩。改变自转、倾角、力臂或释放方式，
            观察同一套动力学如何给出进动与章动。
          </p>
        </div>
        <div className={styles.headerBadge}>
          <span>无摩擦 · RK4</span>
          <strong>τ = r × mg</strong>
        </div>
      </header>

      <div className={styles.grid}>
        <div className={styles.stageColumn}>
          <div className={styles.canvasShell}>
            <GyroCanvas ref={canvasApi} onOrbitStart={handleOrbitStart} />
            <div className={styles.stageTop}>
              <div className={styles.stageTag}>
                <span className={styles.stageDot} aria-hidden="true" />
                RIGID BODY / SINGLE-PIVOT TOP
              </div>
              <div className={styles.viewSwitch} role="group" aria-label="观察视角">
                {(['free', 'top', 'side'] as const).map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={styles.viewButton}
                    aria-pressed={view === item}
                    onClick={() => handleView(item)}
                  >
                    {item === 'free' ? '自由' : item === 'top' ? '俯视' : '侧视'}
                  </button>
                ))}
              </div>
            </div>
            <div className={styles.stageStatus} data-contact={readout.contact || undefined}>
              <span>{currentStatus}</span>
              <em>{activeSetup.spin.toFixed(0)} rad/s · θ {readout.thetaDeg.toFixed(1)}°</em>
            </div>
            <p className={styles.stageHint}>拖动旋转 · 滚轮缩放 · 单击观察</p>
            <button type="button" className={styles.whyButton} onClick={explainWhy}>
              为什么会这样？
            </button>
          </div>

          <div className={styles.transport} aria-label="实验播放控制">
            <div className={styles.transportButtons}>
              <button
                type="button"
                className={styles.transportPrimary}
                aria-label={playing ? '暂停实验' : readout.contact ? '重新开始实验' : '播放实验'}
                aria-pressed={playing}
                onClick={() => {
                  if (readout.contact) {
                    resetRun();
                  } else {
                    togglePlay();
                  }
                }}
              >
                {playing ? '暂停' : readout.contact ? '重新开始' : '播放'}
              </button>
              <button
                type="button"
                className={styles.transportButton}
                disabled={readout.contact}
                onClick={handleStep}
              >
                单步
              </button>
              <button type="button" className={styles.transportButton} onClick={resetRun}>
                重置
              </button>
            </div>
            <div className={styles.timelineWrap}>
              <input
                ref={timelineRef}
                className={styles.timeline}
                type="range"
                min="0"
                max="0.1"
                step="0.01"
                defaultValue="0"
                aria-label="实验时间轴，拖动可逐帧回看"
                onPointerDown={() => {
                  scrubRef.current = true;
                  setPlaying(false);
                  playingRef.current = false;
                }}
                onPointerUp={() => {
                  scrubRef.current = false;
                }}
                onPointerLeave={() => {
                  scrubRef.current = false;
                }}
                onChange={(event) => seekTo(Number(event.target.value))}
              />
              <output ref={timeReadoutRef} className={styles.timeReadout}>
                0.00 s
              </output>
            </div>
            <div className={styles.speedGroup} role="group" aria-label="慢放倍率">
              {TIME_SCALES.map((scale) => (
                <button
                  key={scale}
                  type="button"
                  className={styles.speedButton}
                  aria-pressed={timeScale === scale}
                  onClick={() => {
                    setTimeScale(scale);
                    timeScaleRef.current = scale;
                  }}
                >
                  {scale}×
                </button>
              ))}
            </div>
          </div>
        </div>

        <aside className={styles.rail} aria-label="陀螺实验控制">
          <section className={styles.railSection}>
            <div className={styles.railHead}>
              <p className={styles.railKicker}>EXPERIMENTS</p>
              <span className={styles.railCount}>{preset === null ? 'CUSTOM' : `0${preset} / 04`}</span>
            </div>
            <div className={styles.presetGrid}>
              {PRESETS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={styles.presetCard}
                  aria-pressed={preset === item.id}
                  onClick={() => handlePreset(item.id)}
                >
                  <span className={styles.presetIndex}>{item.index}</span>
                  <strong>{item.title}</strong>
                  <small>{item.hint}</small>
                  <em>{item.tag}</em>
                </button>
              ))}
            </div>
          </section>

          <div className={styles.statsGrid}>
            <Stat
              label="自转 ω_s"
              value={`${readout.spin.toFixed(0)}`}
              note={`rad/s · ${(readout.spin / (2 * Math.PI)).toFixed(1)} rev/s`}
            />
            <Stat
              label="倾角 θ"
              value={`${readout.thetaDeg.toFixed(1)}°`}
              note={`初始 ${radToDeg(activeSetup.tilt).toFixed(1)}°`}
            />
            <Stat
              label="进动 φ̇"
              value={readout.precession === 0 ? '0' : readout.precession.toFixed(2)}
              note={
                Number.isFinite(readout.period)
                  ? `rad/s · φ ${readout.phiDeg.toFixed(0)}° · ${readout.period.toFixed(2)} s/圈`
                  : `rad/s · φ ${readout.phiDeg.toFixed(0)}° · 无平稳进动`
              }
              tone="accent"
            />
            <Stat
              label="倾角变化"
              value={`${readout.nutationDeg.toFixed(1)}°`}
              note="最近 2.5 s 范围"
            />
          </div>

          {predictionOpen ? (
            <section className={styles.compareBox} aria-labelledby="gyro-predict-title">
              <p className={styles.railKicker}>EXPERIMENT 03 · 先预测</p>
              <h3 id="gyro-predict-title">
                转速提到 {proposedCompareSpin} rad/s（约 {proposedCompareFactor.toFixed(1)}×），进动会怎样？
              </h3>
              <p className={styles.compareHint}>
                {baselineReady
                  ? `基准：${activeSetup.spin.toFixed(0)} rad/s · 当前 φ̇ ≈ ${readout.precession.toFixed(2)} rad/s`
                  : '当前还没有稳定进动基准；先选择 02 运行一会儿，再回来比较。'}
              </p>
              <div className={styles.predictionOptions} role="group" aria-label="预测进动快慢">
                {PREDICTION_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={styles.predictionOption}
                    aria-pressed={prediction === option.value}
                    onClick={() => setPrediction(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className={styles.compareVerify}
                disabled={prediction === null || !baselineReady}
                onClick={verifyPrediction}
              >
                用更高转速验证
              </button>
              <button
                type="button"
                className={styles.linkButton}
                onClick={() => {
                  setPredictionOpen(false);
                  setPreset(2);
                  setPlaying(true);
                  playingRef.current = true;
                }}
              >
                取消
              </button>
            </section>
          ) : null}

          <section className={styles.railSection}>
            <p className={styles.railKicker}>OBSERVE</p>
            <Segmented
              label="观察重点"
              value={observe}
              options={OBSERVE_OPTIONS}
              onChange={handleObserve}
            />
            <button
              type="button"
              className={styles.vectorToggle}
              aria-pressed={vectors}
              onClick={() => {
                setVectors((current) => {
                  vectorsRef.current = !current;
                  return !current;
                });
              }}
            >
              {vectors ? '隐藏向量' : '显示向量'}
            </button>
            <p className={styles.railHint}>箭头长度为示意；力矩、角动量的数值在下方逐层展开。</p>
          </section>

          <section className={styles.railSection}>
            <p className={styles.railKicker}>INITIAL CONDITIONS</p>
            <div className={styles.sliderStack}>
              <LabSlider
                label="初始自转转速"
                value={draft.spin}
                min={0}
                max={SPIN_MAX}
                step={1}
                onChange={(value) => updateDraft({spin: value})}
                format={(value) => `${value.toFixed(0)} rad/s`}
                hint="重力矩不沿轴，所以自转本身不会被重力直接减速。"
              />
              <LabSlider
                label="初始倾角"
                value={radToDeg(draft.tilt)}
                min={10}
                max={68}
                step={0.5}
                onChange={(value) => updateDraft({tilt: degToRad(value)})}
                format={(value) => `${value.toFixed(1)}°`}
                hint="倾角越大，重力矩的力臂越长，平稳进动所需的转速也越高。"
              />
              <LabSlider
                label="支点到重心 ℓ"
                value={draft.comDistance}
                min={0.04}
                max={0.105}
                step={0.0025}
                onChange={(value) => updateDraft({comDistance: value})}
                format={(value) => `${(value * 100).toFixed(1)} cm`}
                hint="ℓ 同时影响重力矩和绕支点的横向转动惯量。"
              />
            </div>
            <div className={styles.releaseRow}>
              <span className={styles.releaseLabel}>释放方式</span>
              <Segmented
                label="释放方式"
                value={draft.release}
                options={RELEASE_OPTIONS}
                onChange={(value) => updateDraft({release: value})}
              />
            </div>
            {dirty ? (
              <div className={styles.dirtyNote}>
                <span>初始条件已修改</span>
                <button type="button" onClick={applyDraft}>
                  应用并重开
                </button>
              </div>
            ) : (
              <p className={styles.railHint}>参数只在下一次开始实验时生效；当前运行保持原条件。</p>
            )}
          </section>

          <section className={styles.railSection}>
            <p className={styles.railKicker}>INITIAL CONDITIONS</p>
            <div className={styles.sliderStack}>
              <LabSlider
                label="初始自转转速"
                value={draft.spin}
                min={0}
                max={SPIN_MAX}
                step={1}
                onChange={(value) => updateDraft({spin: value})}
                format={(value) => `${value.toFixed(0)} rad/s`}
                hint="重力矩不沿轴，所以自转本身不会被重力直接减速。"
              />
              <LabSlider
                label="初始倾角"
                value={radToDeg(draft.tilt)}
                min={10}
                max={68}
                step={0.5}
                onChange={(value) => updateDraft({tilt: degToRad(value)})}
                format={(value) => `${value.toFixed(1)}°`}
                hint="倾角越大，重力矩的力臂越长，平稳进动所需的转速也越高。"
              />
              <LabSlider
                label="支点到重心 ℓ"
                value={draft.comDistance}
                min={0.04}
                max={0.105}
                step={0.0025}
                onChange={(value) => updateDraft({comDistance: value})}
                format={(value) => `${(value * 100).toFixed(1)} cm`}
                hint="ℓ 同时影响重力矩和绕支点的横向转动惯量。"
              />
            </div>
            <div className={styles.releaseRow}>
              <span className={styles.releaseLabel}>释放方式</span>
              <Segmented
                label="释放方式"
                value={draft.release}
                options={RELEASE_OPTIONS}
                onChange={(value) => updateDraft({release: value})}
              />
            </div>
            {dirty ? (
              <div className={styles.dirtyNote}>
                <span>初始条件已修改</span>
                <button type="button" onClick={applyDraft}>
                  应用并重开
                </button>
              </div>
            ) : (
              <p className={styles.railHint}>参数只在下一次开始实验时生效；当前运行保持原条件。</p>
            )}
          </section>

          <section className={styles.railSection}>
            <button
              type="button"
              className={styles.perturbButton}
              disabled={!canPerturb}
              onClick={togglePerturbation}
            >
              施加一次小扰动
            </button>
            <p className={styles.railHint}>
              运行中给轴端一个很小的倾角速度冲量；无摩擦模型会保留由此产生的章动。
            </p>
          </section>

          {!activeMeta.steadyPossible && activeSetup.spin > 0.5 ? (
            <p className={styles.warning}>
              当前参数不存在平稳进动解。提高自转转速，或缩短支点到重心的距离 ℓ 再试。
            </p>
          ) : null}
          {notice !== null ? (
            <p className={styles.notice} role="status">
              {notice}
            </p>
          ) : null}
        </aside>
      </div>

      <div className={styles.analysisGrid}>
        <section className={styles.chartCard} aria-labelledby="gyro-chart-title">
          <header className={styles.chartHead}>
            <div>
              <p className={styles.railKicker}>θ(t) / LIVE TRACE</p>
              <h3 id="gyro-chart-title">倾角随时间</h3>
              <p>平稳进动接近水平线；章动出现周期性起伏。拖动时间轴可逐帧核对。</p>
            </div>
            <div className={styles.legend} aria-label="曲线图例">
              <span data-kind="current"><i />当前</span>
              {baseline !== null ? <span data-kind="baseline"><i />基准</span> : null}
            </div>
          </header>
          {baseline !== null ? (
            <div className={styles.baselineRow}>
              <span>基准：{baseline.label} · φ̇ {baseline.precession.toFixed(2)} rad/s</span>
              <button
                type="button"
                onClick={() => {
                  baselineRef.current = null;
                  setBaseline(null);
                }}
              >
                清除基准
              </button>
            </div>
          ) : null}
          <GyroChart ref={chartApi} />
          <footer className={styles.chartFoot}>
            <span>当前 t = {readout.time.toFixed(2)} s</span>
            <span>自转 {readout.spin.toFixed(0)} rad/s</span>
            <span>倾角 {readout.thetaDeg.toFixed(1)}°</span>
            <span>时间倍率 ×{timeScale}</span>
          </footer>
        </section>

        <section className={styles.insightCard} aria-labelledby="gyro-insight-title">
          <p className={styles.railKicker}>{preset === null ? 'CUSTOM RUN' : `EXPERIMENT 0${preset}`}</p>
          <h3 id="gyro-insight-title">{experimentTitle(preset)}</h3>
          <p className={styles.insightText}>{insightText}</p>
          {predictionResult !== null ? (
            <div
              className={
                predictionResult.correct ? styles.resultGood : styles.resultBad
              }
              role="status"
            >
              <strong>{predictionResult.correct ? '预测正确' : '再想一想'}</strong>
              <span>
                你预测{predictionLabel(predictionResult.answer)}；实测
                {predictionResult.currentRate < predictionResult.baselineRate
                  ? '进动变慢'
                  : predictionResult.currentRate > predictionResult.baselineRate
                    ? '进动变快'
                    : '基本不变'}
                （{predictionResult.baselineRate.toFixed(2)} →{' '}
                {predictionResult.currentRate.toFixed(2)} rad/s）。
              </span>
            </div>
          ) : null}
          <div className={styles.insightActions}>
            <button type="button" className={styles.whyInline} onClick={explainWhy}>
              为什么会这样？
            </button>
            <span className={styles.conditionChip}>
              {activeMeta.steadyPossible ? '存在平稳进动解' : '无平稳进动解'}
            </span>
          </div>
        </section>
      </div>

      <section className={styles.derivation} ref={derivationRef} aria-labelledby="gyro-derivation-title">
        <header className={styles.derivationHead}>
          <div>
            <p className={styles.railKicker}>EXPLANATION / THREE LAYERS</p>
            <h3 id="gyro-derivation-title">从重力矩到进动</h3>
            <p>逐层展开，每一层都对应画布上的向量。先看方向，再看数值。</p>
          </div>
          <div className={styles.layerTabs} role="tablist" aria-label="选择解释层">
            {[
              {step: 1 as const, label: '01 力矩来源'},
              {step: 2 as const, label: '02 角动量变化'},
              {step: 3 as const, label: '03 进动近似'},
            ].map((item) => (
              <button
                key={item.step}
                type="button"
                role="tab"
                id={`gyro-layer-tab-${item.step}`}
                aria-selected={explainStep === item.step}
                aria-controls="gyro-layer-panel"
                className={styles.layerTab}
                onClick={() => selectLayer(item.step)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </header>

        <div
          className={styles.layerBody}
          id="gyro-layer-panel"
          role="tabpanel"
          aria-labelledby={`gyro-layer-tab-${explainStep}`}
        >
          {explainStep === 1 ? (
            <>
              <div className={styles.formulaRow}>
                <Formula tex={String.raw`\boldsymbol{\tau}`} label="力矩" />
                <span className={styles.formulaOperator}>=</span>
                <button
                  type="button"
                  className={styles.formulaToken}
                  data-active={highlight === 'r' || undefined}
                  aria-pressed={highlight === 'r'}
                  aria-label="高亮支点到重心的连线 r"
                  onClick={() => toggleHighlight('r')}
                >
                  <Formula tex={String.raw`\mathbf r`} />
                </button>
                <span className={styles.formulaOperator}>×</span>
                <button
                  type="button"
                  className={styles.formulaToken}
                  data-active={highlight === 'mg' || undefined}
                  aria-pressed={highlight === 'mg'}
                  aria-label="高亮重力箭头 mg"
                  onClick={() => toggleHighlight('mg')}
                >
                  <Formula tex={String.raw`m\mathbf g`} />
                </button>
              </div>
              <p className={styles.formulaNote}>
                支点 O 与重心 C 不重合。重力作用在 C，相对于 O 的力臂是
                <Formula tex={String.raw`\mathbf r`} />。点击公式里的 r 或 mg，
                画布会高亮对应的箭头。力矩方向垂直于 r 与 mg 构成的竖直平面，
                因此它把轴推向进动方向，而不是直接把它压下去。
              </p>
              <div className={styles.valueGrid}>
                <div>
                  <span>|r| = ℓ</span>
                  <strong>{formatNumber(activeSetup.comDistance, 3)} m</strong>
                </div>
                <div>
                  <span>mg</span>
                  <strong>{formatNumber(DEFAULT_PHYSICAL.mass * GRAVITY, 2)} N</strong>
                </div>
                <div>
                  <span>|τ| = mgℓ sinθ</span>
                  <strong>
                    {formatNumber(
                      activeMeta.mgL * Math.sin(degToRad(readout.thetaDeg)),
                      4,
                    )}{' '}
                    N·m
                  </strong>
                </div>
              </div>
            </>
          ) : null}

          {explainStep === 2 ? (
            <>
              <Formula block tex={String.raw`\frac{d\mathbf L}{dt}=\boldsymbol{\tau}`} />
              <p className={styles.formulaNote}>
                力矩不直接改变倾角的大小，而是让角动量矢量在空间中转向。
                暂停后单步 50 ms：L 的变化量 ΔL 与 τ 同向；新的 L 沿着新的转轴方向。
                为了看清方向，ΔL 箭头按比例放大显示。
              </p>
              <div className={styles.stepRow}>
                <button
                  type="button"
                  className={styles.stepButton}
                  disabled={readout.contact}
                  onClick={handleStep}
                >
                  暂停并单步 +50 ms
                </button>
                <span className={styles.stepHint}>
                  {stepVectors === null
                    ? '单步后，画布会同时显示 L、ΔL 与新的 L。'
                    : '已显示本步的 L → L + ΔL。'}
                </span>
              </div>
              {stepVectors !== null ? (
                <div className={styles.valueGrid}>
                  <div>
                    <span>|L| 原</span>
                    <strong>
                      {formatScientific(
                        Math.hypot(
                          stepVectors.before.x,
                          stepVectors.before.y,
                          stepVectors.before.z,
                        ),
                      )}
                    </strong>
                  </div>
                  <div>
                    <span>|ΔL|</span>
                    <strong>
                      {formatScientific(
                        Math.hypot(
                          stepVectors.after.x - stepVectors.before.x,
                          stepVectors.after.y - stepVectors.before.y,
                          stepVectors.after.z - stepVectors.before.z,
                        ),
                      )}
                    </strong>
                  </div>
                  <div>
                    <span>|τ|</span>
                    <strong>
                      {formatNumber(
                        activeMeta.mgL * Math.sin(degToRad(readout.thetaDeg)),
                        4,
                      )}{' '}
                      N·m
                    </strong>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}

          {explainStep === 3 ? (
            <>
              <Formula block tex={String.raw`\Omega_p\approx\frac{m g \ell}{I_3\omega_s}`} />
              <Formula
                block
                tex={String.raw`\Omega_p\approx\frac{${DEFAULT_PHYSICAL.mass.toFixed(2)}\times9.81\times${activeSetup.comDistance.toFixed(3)}}{${activeMeta.I3.toFixed(4)}\times${activeSetup.spin.toFixed(1)}}\approx${Number.isFinite(approximation) ? approximation.toFixed(2) : '\\infty'}\ \mathrm{rad/s}`}
              />
              <p className={styles.formulaNote}>
                在快速自转、慢进动的近似下，角动量大致沿转轴，重力矩只负责把 L
                的方向转向进动方向。当前完整仿真的 φ̇ ≈ {readout.precession.toFixed(2)} rad/s，
                与近似式的相对差
                {approximationVsMeasured === null
                  ? '无法比较'
                  : `约 ${(approximationVsMeasured * 100).toFixed(1)}%`}
                。差值来自进动本身的横向角动量，完整仿真保留了这部分贡献与章动。
              </p>
              <div className={styles.conditionRow}>
                <span className={styles.conditionBadge}>适用条件</span>
                <span>ω_s 远大于 Ω_p，且初始状态接近平稳进动。</span>
              </div>
              <p className={styles.sourceNote}>参考：OpenStax《University Physics》刚体转动章节的进动近似。</p>
              {!activeMeta.steadyPossible ? (
                <p className={styles.warning}>
                  当前参数没有平稳进动解，近似式不适用。提高转速或减小 ℓ 再试。
                </p>
              ) : null}
            </>
          ) : null}
        </div>

        <details className={styles.fullDerivation}>
          <summary>展开完整推导与数值校验</summary>
          <div className={styles.fullBody}>
            <p>
              以支点 O 为原点，I₁ 与 I₃ 是绕 O 的横向与轴向转动惯量。无摩擦刚体的拉格朗日量为
            </p>
            <Formula
              block
              tex={String.raw`T=\frac12 I_1\left(\dot\theta^2+\dot\phi^2\sin^2\theta\right)+\frac12 I_3\left(\dot\psi+\dot\phi\cos\theta\right)^2,\qquad V=mg\ell\cos\theta`}
            />
            <p>
              重力矩绕竖直方向的分量为零，所以竖直方向角动量与自转角速度守恒：
            </p>
            <Formula
              block
              tex={String.raw`p_\phi=I_1\dot\phi\sin^2\theta+I_3\omega_3\cos\theta,\qquad p_\psi=I_3\omega_3`}
            />
            <p>代入欧拉—拉格朗日方程得到本页使用的 θ 方程：</p>
            <Formula
              block
              tex={String.raw`I_1\ddot\theta=I_1\dot\phi^2\sin\theta\cos\theta-I_3\dot\phi\omega_3\sin\theta+mg\ell\sin\theta`}
            />
            <p>
              平稳进动要求 θ̈=0、θ̇=0，代入后得到关于 φ̇ 的二次方程：
            </p>
            <Formula
              block
              tex={String.raw`I_1\cos\theta\,\dot\phi^2-I_3\omega_3\dot\phi+mg\ell=0`}
            />
            <p>
              判别式非负时才存在平稳进动解；慢根就是快速自转陀螺通常表现出的进动。
              释放方式（初始 φ̇、θ̇）不同，θ 可以围绕平衡值振荡，这就是章动。
            </p>
            <div className={styles.numericGrid}>
              <div>
                <span>能量相对漂移</span>
                <strong>{formatEnergyDrift(readout.energyDrift)}</strong>
              </div>
              <div>
                <span>L_z − p_φ</span>
                <strong>{formatScientific(readout.pzDrift)}</strong>
              </div>
              <div>
                <span>步长减半 Δθ</span>
                <strong>{formatScientific(readout.stepDeviation)} rad</strong>
              </div>
              <div>
                <span>物理时间步</span>
                <strong>1/480 s</strong>
              </div>
            </div>
            <p className={styles.numericNote}>
              数值校验：RK4 固定步长；能量与竖直方向角动量只应出现舍入误差；
              “步长减半”比较 1/480 s 与 1/960 s 在同一物理时刻的 θ。施加扰动会人为注入能量，
              此时能量读数不再作为守恒量比较。理论背景可参考 OpenStax《University Physics》
              刚体转动章节，以及剑桥大学刚体动力学讲义中关于重对称陀螺与章动的讨论。
            </p>
          </div>
        </details>
      </section>
    </article>
  );
}

export default GyroLab;
