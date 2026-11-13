/**
 * 登录页右侧三维场景容器（契约 `C-SURFACESCENE@1`）。
 *
 * 分工：
 * - 本组件只负责 DOM、`IntersectionObserver` / `ResizeObserver` / `visibilitychange`、
 *   懒加载与播放门控；**不自起帧循环**，`requestAnimationFrame` 与 `WebGLRenderer`
 *   只存在于 `loginSurfaceScene.ts`。
 * - 播放判定全部来自 `motionPolicy.ts`（`canAnimate` / `shouldLoad3D` /
 *   `nextQualityOnStutter` / `normalizePointer` / `shouldDecayPointer`），
 *   组件内不另写条件，避免两套真源。
 *
 * 隐私：props 只有布尔状态，邮箱、密码、会话 Cookie 一律不进入本组件与三维模块。
 * 降级：WebGL2 缺失、动态 import 失败、上下文丢失都只回退到静态海报，
 *       不向用户暴露 shader / 堆栈等错误细节。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

import {
  FORM_FOCUS_RESUME_DELAY_MS,
  STUTTER_WINDOW_SECONDS,
  canAnimate,
  nextQualityOnStutter,
  normalizePointer,
  shouldDecayPointer,
  shouldLoad3D,
  type MotionGateState,
  type QualityTier,
} from './motionPolicy';
import type { SurfaceSceneController } from './loginSurfaceScene';
import posterUrl from '../../assets/login/login-surface-poster.svg';
import styles from './LoginSurface.module.css';

type SurfaceSceneModule = typeof import('./loginSurfaceScene');
type LoadState = 'idle' | 'loading' | 'loaded' | 'failed';

/** 帧间隔环形缓冲上限（契约：容量 ≤ 300 帧）。 */
const FRAME_SAMPLE_CAPACITY = 300;
/** 桌面布局断点：低于该宽度默认静态海报（设计 §10.1）。 */
const WIDE_VIEWPORT_QUERY = '(min-width: 1024px)';

export interface LoginSurfaceProps {
  /** 页面检测：任一表单控件获得焦点 */
  formFocused: boolean;
  /** 页面检测：登录请求进行中 */
  submitting: boolean;
  /** 系统「减少动效」偏好（来自 useReducedMotion()） */
  reducedMotion: boolean;
}

/** WebGL2 能力探测；不可用或异常时返回 false（只影响是否加载三维模块）。 */
function detectWebGL2(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  if (typeof WebGL2RenderingContext === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2');
    if (context === null) return false;
    const loseContext = context.getExtension('WEBGL_lose_context') as {
      loseContext: () => void;
    } | null;
    loseContext?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/** 是否处于桌面双栏布局（≥1024px）。 */
function readWideViewport(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(WIDE_VIEWPORT_QUERY).matches;
}

/** P95：空样本返回 0；`noUncheckedIndexedAccess` 下用 `?? 0` 收窄。 */
function percentile95(samples: readonly number[]): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((left, right) => left - right);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1));
  return sorted[index] ?? 0;
}

export function LoginSurface({
  formFocused,
  submitting,
  reducedMotion,
}: LoginSurfaceProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<SurfaceSceneController | null>(null);
  const moduleRef = useRef<SurfaceSceneModule | null>(null);
  const loadStateRef = useRef<LoadState>('idle');
  const disposedRef = useRef(false);
  const sizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });
  const qualityRef = useRef<QualityTier>('standard');
  const playingRef = useRef(false);
  const frameSamplesRef = useRef<number[]>([]);
  const frameWindowStartRef = useRef(0);

  const [webgl2Available] = useState<boolean>(detectWebGL2);
  const [wideViewport, setWideViewport] = useState<boolean>(readWideViewport);
  const [pageVisible, setPageVisible] = useState<boolean>(() =>
    typeof document === 'undefined' ? true : !document.hidden,
  );
  const [inView, setInView] = useState<boolean>(() => typeof IntersectionObserver === 'undefined');
  const [ready, setReady] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const [contextLost, setContextLost] = useState(false);
  const [showPoster, setShowPoster] = useState(true);
  const [focusResumePending, setFocusResumePending] = useState(false);

  /** 同步 ref，避免帧回调读到旧档位（质量不参与渲染，无需 state）。 */
  const applyQuality = useCallback((next: QualityTier): void => {
    qualityRef.current = next;
  }, []);

  /** 帧间隔采样 → 每 ≥5 秒求一次 P95 → 交 `nextQualityOnStutter` 判定。 */
  const handleFrameSample = useCallback(
    (intervalMs: number): void => {
      if (!Number.isFinite(intervalMs) || intervalMs <= 0) return;
      const samples = frameSamplesRef.current;
      samples.push(intervalMs);
      if (samples.length > FRAME_SAMPLE_CAPACITY) {
        samples.splice(0, samples.length - FRAME_SAMPLE_CAPACITY);
      }
      const now = performance.now();
      if (frameWindowStartRef.current === 0) {
        frameWindowStartRef.current = now;
        return;
      }
      const windowSeconds = (now - frameWindowStartRef.current) / 1000;
      if (windowSeconds < STUTTER_WINDOW_SECONDS) return;

      const p95 = percentile95(samples);
      frameWindowStartRef.current = now;
      samples.length = 0;

      const next = nextQualityOnStutter(qualityRef.current, p95, windowSeconds);
      if (next === null) return;
      if (next === 'low') {
        applyQuality('low');
        controllerRef.current?.setQuality('low');
        return;
      }
      // 'static'：一次性降到静态（单向、不可回升），释放场景并回海报。
      applyQuality('static');
      const controller = controllerRef.current;
      controllerRef.current = null;
      controller?.dispose();
      setReady(false);
      setShowPoster(true);
    },
    [applyQuality],
  );

  /** 按当前尺寸实例化场景；尺寸为 0 时留给 `ResizeObserver` 首次回调重试。 */
  const instantiateScene = useCallback(
    (module: SurfaceSceneModule): void => {
      if (disposedRef.current) return;
      const container = containerRef.current;
      if (container === null || controllerRef.current !== null) return;
      if (qualityRef.current === 'static') return;
      const size = sizeRef.current;
      if (!(size.width > 0) || !(size.height > 0)) return;

      let active: SurfaceSceneController | null = null;
      active = module.createSurfaceScene(container, {
        quality: qualityRef.current === 'low' ? 'low' : 'standard',
        onFirstFrame: () => setShowPoster(false),
        onContextLost: () => {
          if (active !== null) active.dispose();
          if (controllerRef.current === active) controllerRef.current = null;
          applyQuality('static');
          setReady(false);
          setContextLost(true);
          setShowPoster(true);
        },
        onContextRestored: () => {
          setContextLost(false);
          setReady(true);
        },
        onFrameSample: handleFrameSample,
      });

      if (active === null) {
        // WebGL2 不可用或创建失败：只显示海报，不向用户暴露细节。
        applyQuality('static');
        setContextLost(true);
        setShowPoster(true);
        return;
      }
      active.resize(size.width, size.height);
      controllerRef.current = active;
      setReady(true);
    },
    [applyQuality, handleFrameSample],
  );

  // ---------------- 观察器与生命周期（mount/unmount 一次） ----------------
  useEffect(() => {
    disposedRef.current = false;
    const container = containerRef.current;
    if (container === null) return undefined;

    const initialBounds = container.getBoundingClientRect();
    sizeRef.current = { width: initialBounds.width, height: initialBounds.height };

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry === undefined) return;
      const { width, height } = entry.contentRect;
      sizeRef.current = { width, height };
      const controller = controllerRef.current;
      if (controller !== null) {
        if (width > 0 && height > 0) controller.resize(width, height);
        return;
      }
      if (loadStateRef.current === 'loaded') {
        const module = moduleRef.current;
        if (module !== null) instantiateScene(module);
      }
    });
    resizeObserver.observe(container);

    const intersectionObserver =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver(
            (entries) => {
              const entry = entries[0];
              if (entry === undefined) return;
              setInView(entry.isIntersecting);
            },
            { threshold: 0.15 },
          );
    intersectionObserver?.observe(container);

    const handleVisibilityChange = (): void => setPageVisible(!document.hidden);
    setPageVisible(!document.hidden);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      disposedRef.current = true;
      resizeObserver.disconnect();
      intersectionObserver?.disconnect();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      const controller = controllerRef.current;
      controllerRef.current = null;
      controller?.dispose();
      moduleRef.current = null;
      loadStateRef.current = 'idle';
      frameSamplesRef.current.length = 0;
      frameWindowStartRef.current = 0;
      setShowPoster(true);
      setReady(false);
    };
  }, [instantiateScene]);

  // ---------------- 桌面视口监听（<1024px 默认静态海报） ----------------
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia(WIDE_VIEWPORT_QUERY);
    setWideViewport(media.matches);
    const handleChange = (event: MediaQueryListEvent): void => setWideViewport(event.matches);
    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, []);

  // ---------------- 焦点恢复等待 700ms ----------------
  useEffect(() => {
    if (formFocused) {
      setFocusResumePending(true);
      return undefined;
    }
    if (!focusResumePending) return undefined;
    const timer = window.setTimeout(() => setFocusResumePending(false), FORM_FOCUS_RESUME_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [formFocused, focusResumePending]);

  const dynamicAllowed = webgl2Available && wideViewport;
  const effectiveFormFocused = formFocused || focusResumePending;

  const gate = useMemo<MotionGateState>(
    () => ({
      ready,
      pageVisible,
      inView,
      dynamicAllowed,
      reducedMotion,
      userPaused,
      formFocused: effectiveFormFocused,
      submitting,
      contextLost,
    }),
    [
      ready,
      pageVisible,
      inView,
      dynamicAllowed,
      reducedMotion,
      userPaused,
      effectiveFormFocused,
      submitting,
      contextLost,
    ],
  );

  const shouldLoad = shouldLoad3D(gate);
  const playing = canAnimate(gate);

  // ---------------- 懒加载：只在 shouldLoad3D 为真时执行一次 ----------------
  useEffect(() => {
    if (!shouldLoad) return undefined;
    if (qualityRef.current === 'static') return undefined;
    if (loadStateRef.current === 'loaded') {
      const module = moduleRef.current;
      if (module !== null) instantiateScene(module);
      return undefined;
    }
    if (loadStateRef.current !== 'idle') return undefined;

    loadStateRef.current = 'loading';
    void import('./loginSurfaceScene')
      .then((module) => {
        if (disposedRef.current) return;
        loadStateRef.current = 'loaded';
        moduleRef.current = module;
        instantiateScene(module);
      })
      .catch(() => {
        if (disposedRef.current) return;
        loadStateRef.current = 'failed';
        applyQuality('static');
        setContextLost(true);
        setShowPoster(true);
      });
    return undefined;
  }, [shouldLoad, instantiateScene, applyQuality]);

  // ---------------- 播放门控：唯一入口是 canAnimate ----------------
  useEffect(() => {
    playingRef.current = playing;
    controllerRef.current?.setPlaying(playing);
  }, [playing]);

  // ---------------- 运行时切换「减少动效」：立即停帧并回海报 ----------------
  useEffect(() => {
    if (!reducedMotion) return;
    const controller = controllerRef.current;
    if (controller === null) return;
    controllerRef.current = null;
    controller.dispose();
    setReady(false);
    setShowPoster(true);
  }, [reducedMotion]);

  // ---------------- 指针视差（只更新目标值，阻尼在场景帧循环内） ----------------
  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!playingRef.current) return;
    if (!shouldDecayPointer(event.pointerType)) return;
    const controller = controllerRef.current;
    const container = containerRef.current;
    if (controller === null || container === null) return;
    const bounds = container.getBoundingClientRect();
    const point = normalizePointer(
      event.clientX - bounds.left,
      event.clientY - bounds.top,
      bounds.width,
      bounds.height,
    );
    controller.setPointer(point);
  }, []);

  const handlePointerLeave = useCallback((): void => {
    controllerRef.current?.setPointer(null);
  }, []);

  const handleTogglePause = useCallback((): void => {
    setUserPaused((previous) => !previous);
  }, []);

  return (
    <div
      className={styles.surface}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      <img
        className={styles.poster}
        src={posterUrl}
        alt=""
        aria-hidden="true"
        data-visible={showPoster ? 'true' : 'false'}
      />
      <div className={styles.canvasHost} ref={containerRef} aria-hidden="true" />
      {reducedMotion ? (
        <span className={styles.staticNote}>静态展示</span>
      ) : (
        <button
          type="button"
          className={styles.pauseButton}
          aria-pressed={userPaused}
          onClick={handleTogglePause}
        >
          {userPaused ? '播放动效' : '暂停动效'}
        </button>
      )}
    </div>
  );
}

export default LoginSurface;