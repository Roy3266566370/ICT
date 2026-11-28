/**
 * HeroDynamicalStage.tsx —— 万象首页首屏舞台
 *
 * 左侧：「一式定象，万象皆通」建筑高对比 Slogan（统一品牌为定象坊 × 通文册）
 * 右侧：R1 3D 阻尼波动场 × R3 二阶系统相轨演化融合舞台，自动周期性平滑演化参数
 */
import markUrl from '@/assets/brand/wanxiang-mark.png';
import { useId, useLayoutEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useReducedMotion } from '@/hooks/useMotionPreference';
import styles from './HeroDynamicalStage.module.css';

interface DynamicalRegime {
  name: string;
  zeta: number;
  omega: number;
  amp: number;
}

const REGIMES: readonly DynamicalRegime[] = [
  { name: '轻阻尼谐振 · 涟漪螺旋', zeta: 0.14, omega: 2.55, amp: 1.0 },
  { name: '高频干涉态 · 紧致收束', zeta: 0.24, omega: 3.75, amp: 0.92 },
  { name: '临界阻尼态 · 无超调归稳', zeta: 0.66, omega: 2.05, amp: 0.72 },
  { name: '舒展长波态 · 慢速呼吸', zeta: 0.28, omega: 1.5, amp: 1.06 },
];

const HOLD_SEC = 3.2;
const MORPH_SEC = 1.6;
const PERIOD_SEC = HOLD_SEC + MORPH_SEC;

function easeInOutCubic(x: number): number {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

function sampleAutoParams(t: number) {
  const totalIdx = Math.floor(t / PERIOD_SEC);
  const idx = totalIdx % REGIMES.length;
  const nextIdx = (idx + 1) % REGIMES.length;
  const local = t - totalIdx * PERIOD_SEC;
  const a = REGIMES[idx]!;
  const b = REGIMES[nextIdx]!;
  const blend = local > HOLD_SEC ? easeInOutCubic((local - HOLD_SEC) / MORPH_SEC) : 0;

  return {
    zeta: a.zeta + (b.zeta - a.zeta) * blend,
    omega: a.omega + (b.omega - a.omega) * blend,
    amp: a.amp + (b.amp - a.amp) * blend,
    label: blend > 0.55 ? b.name : a.name,
    progress: local / PERIOD_SEC,
  };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawGlassSlice(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  tag: string,
  dotColor: string,
  drawContent: () => void,
): void {
  ctx.save();
  // 用轻量双层半透明外框替代昂贵的 shadowBlur，首帧与 60fps 绘制更快
  ctx.fillStyle = 'rgba(20, 24, 33, 0.045)';
  roundRect(ctx, x + 2, y + 8, w, h, 12);
  ctx.fill();
  ctx.fillStyle = 'rgba(20, 24, 33, 0.03)';
  roundRect(ctx, x - 1, y + 4, w + 2, h + 2, 13);
  ctx.fill();

  ctx.fillStyle = 'rgba(255, 253, 248, 0.88)';
  ctx.strokeStyle = 'rgba(20, 24, 33, 0.1)';
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, w, h, 11);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = dotColor;
  ctx.beginPath();
  ctx.arc(x + 14, y + 16, 3, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#5e6678';
  ctx.font = '600 10.5px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText(tag, x + 22, y + 19.5);

  drawContent();
  ctx.restore();
}

function buildWavePath(t: number, zeta: number, omega: number): string {
  let d = '';
  const freq = 0.8 + omega * 0.55;
  const amp = 3.4 - zeta * 1.4;
  for (let i = 0; i <= 36; i++) {
    const u = i / 36;
    const x = u * 180;
    const env = Math.sin(u * Math.PI);
    const y = 7 + Math.sin(u * Math.PI * 2 * freq - t * 2.2) * amp * env;
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(2)} `;
  }
  return d;
}

export function HeroDynamicalStage(): JSX.Element {
  const reducedMotion = useReducedMotion();
  const gradId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wavePathRef = useRef<SVGPathElement>(null);
  const stateNameRef = useRef<HTMLSpanElement>(null);
  const zetaRef = useRef<HTMLElement>(null);
  const omegaRef = useRef<HTMLElement>(null);
  const cycleFillRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = 1200;
    let height = 680;
    let lastT = 0;
    let inView = true;
    const mouse = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5 };

    const syncCanvasSize = (): boolean => {
      const rect = container.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const nextWidth = Math.max(360, Math.floor(rect.width));
      const nextHeight = Math.max(500, Math.floor(rect.height));
      const pixelW = Math.floor(nextWidth * dpr);
      const pixelH = Math.floor(nextHeight * dpr);
      if (canvas.width === pixelW && canvas.height === pixelH && width === nextWidth && height === nextHeight) {
        return false;
      }
      width = nextWidth;
      height = nextHeight;
      canvas.width = pixelW;
      canvas.height = pixelH;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return true;
    };

    const onPointerMove = (e: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      mouse.tx = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
      mouse.ty = Math.max(0, Math.min(1, (e.clientY - rect.top) / Math.max(1, rect.height)));
    };
    if (!reducedMotion) window.addEventListener('pointermove', onPointerMove, { passive: true });

    const drawFrame = (t: number) => {
      lastT = t;
      mouse.x += (mouse.tx - mouse.x) * 0.055;
      mouse.y += (mouse.ty - mouse.y) * 0.055;

      const { zeta, omega, amp, label, progress } = sampleAutoParams(t);
      wavePathRef.current?.setAttribute('d', buildWavePath(t, zeta, omega));
      if (stateNameRef.current && stateNameRef.current.textContent !== label) {
        stateNameRef.current.textContent = label;
      }
      if (zetaRef.current) zetaRef.current.textContent = zeta.toFixed(2);
      if (omegaRef.current) omegaRef.current.textContent = omega.toFixed(2);
      if (cycleFillRef.current) cycleFillRef.current.style.width = `${(progress * 100).toFixed(1)}%`;

      ctx.clearRect(0, 0, width, height);

      const isNarrow = width <= 1020;
      const px = reducedMotion ? 0 : (mouse.x - 0.5) * 18;
      const py = reducedMotion ? 0 : (mouse.y - 0.5) * 12;

      const cx = isNarrow ? width * 0.5 : width * 0.695 + px * 0.35;
      const cy = isNarrow ? height * 0.72 : height * 0.52 + py * 0.3;
      const span = isNarrow ? Math.min(width * 0.38, 210) : Math.min(width * 0.255, height * 0.39);

      // 1. 中心辐射光晕
      const glow = ctx.createRadialGradient(cx, cy, 8, cx, cy, span * 1.65);
      glow.addColorStop(0, 'rgba(27, 42, 107, 0.07)');
      glow.addColorStop(0.55, 'rgba(15, 139, 141, 0.032)');
      glow.addColorStop(1, 'rgba(243, 240, 231, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);

      // 2. R1 核心：3D 实时阻尼波动曲面场
      ctx.save();
      const N = 20;
      const isoX = (u: number, v: number) => cx + (u - v) * span * 0.96;
      const isoY = (u: number, v: number, z: number) => cy + (u + v) * span * 0.44 - z * span * 0.34;
      const evalWave = (u: number, v: number) => {
        const r = Math.hypot(u, v);
        return Math.sin(r * omega * 3.0 - t * 2.1) * Math.exp(-r * (0.65 + zeta * 1.65)) * amp * 0.92;
      };

      for (let i = 0; i <= N; i++) {
        const u = (i / N) * 2 - 1;
        ctx.beginPath();
        let peak = -9;
        for (let j = 0; j <= N; j++) {
          const v = (j / N) * 2 - 1;
          const z = evalWave(u, v);
          if (z > peak) peak = z;
          const sx = isoX(u, v);
          const sy = isoY(u, v, z);
          if (j === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        }
        const mix = Math.max(0, Math.min(1, (peak + 0.35) / 1.05));
        ctx.strokeStyle = mix > 0.72
          ? `rgba(214, 69, 49, ${(0.18 + mix * 0.28).toFixed(2)})`
          : `rgba(27, 42, 107, ${(0.09 + mix * 0.22).toFixed(2)})`;
        ctx.lineWidth = i % 4 === 0 ? 1.25 : 0.75;
        ctx.stroke();
      }

      for (let j = 0; j <= N; j += 2) {
        const v = (j / N) * 2 - 1;
        ctx.beginPath();
        for (let i = 0; i <= N; i++) {
          const u = (i / N) * 2 - 1;
          const z = evalWave(u, v);
          const sx = isoX(u, v);
          const sy = isoY(u, v, z);
          if (i === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        }
        ctx.strokeStyle = 'rgba(15, 139, 141, 0.17)';
        ctx.lineWidth = 0.75;
        ctx.stroke();
      }
      ctx.restore();

      // 3. R3 核心：二阶阻尼系统相轨演化族
      ctx.save();
      const phaseCx = cx + px * 0.25;
      const phaseCy = cy - span * 0.08 + py * 0.2;
      const phaseScale = span * 0.94;
      const tracks = 14;
      const omegaNorm = 0.72 + (omega / 3.8) * 0.65;

      ctx.strokeStyle = 'rgba(20, 24, 33, 0.11)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.moveTo(phaseCx - phaseScale * 1.08, phaseCy);
      ctx.lineTo(phaseCx + phaseScale * 1.08, phaseCy);
      ctx.moveTo(phaseCx, phaseCy - phaseScale * 0.72);
      ctx.lineTo(phaseCx, phaseCy + phaseScale * 0.72);
      ctx.stroke();
      ctx.setLineDash([]);

      for (let s = 0; s < tracks; s++) {
        const ang = (s / tracks) * Math.PI * 2 + t * 0.14;
        let x = Math.cos(ang);
        let v = Math.sin(ang);
        const dt = 0.055;
        const steps = 90;
        const highlight = s % 4 === 0;
        const particleStep = Math.floor((t * 22 + s * 11) % steps);
        let pX = phaseCx;
        let pY = phaseCy;

        ctx.beginPath();
        for (let k = 0; k < steps; k++) {
          const sx = phaseCx + x * phaseScale * 1.04;
          const sy = phaseCy - v * phaseScale * 0.68;
          if (k === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
          if (k === particleStep) {
            pX = sx;
            pY = sy;
          }
          const acc = -2 * zeta * omegaNorm * v - omegaNorm * omegaNorm * x;
          v += acc * dt;
          x += v * dt;
        }
        ctx.strokeStyle = highlight
          ? 'rgba(214, 69, 49, 0.56)'
          : s % 2 === 0
            ? 'rgba(27, 42, 107, 0.34)'
            : 'rgba(15, 139, 141, 0.38)';
        ctx.lineWidth = highlight ? 1.85 : 1.05;
        ctx.stroke();

        if (highlight) {
          ctx.fillStyle = '#d64531';
          ctx.beginPath();
          ctx.arc(pX, pY, 3.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = 'rgba(214, 69, 49, 0.18)';
          ctx.beginPath();
          ctx.arc(pX, pY, 7.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      ctx.fillStyle = 'rgba(27, 42, 107, 0.14)';
      ctx.beginPath();
      ctx.arc(phaseCx, phaseCy, 13, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1b2a6b';
      ctx.beginPath();
      ctx.arc(phaseCx, phaseCy, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // 4. 定象坊 × 通文册极轻通透浮片与贯通光流
      if (!isNarrow) {
        const fx = cx - span * 1.18 + px * 0.65;
        const fy = cy - span * 0.96 + py * 0.55;
        const tx = cx + span * 0.34 + px * 0.85;
        const ty = cy + span * 0.58 + py * 0.72;

        ctx.save();
        ctx.setLineDash([4, 5]);
        ctx.lineDashOffset = -t * 24;
        ctx.strokeStyle = 'rgba(27, 42, 107, 0.42)';
        ctx.lineWidth = 1.25;
        ctx.beginPath();
        ctx.moveTo(fx + 162, fy + 40);
        ctx.bezierCurveTo(fx + 215, fy + 40, phaseCx - 42, phaseCy - 48, phaseCx, phaseCy);
        ctx.stroke();

        ctx.strokeStyle = 'rgba(214, 69, 49, 0.48)';
        ctx.beginPath();
        ctx.moveTo(phaseCx, phaseCy);
        ctx.bezierCurveTo(phaseCx + 58, phaseCy + 34, tx - 22, ty + 18, tx, ty + 44);
        ctx.stroke();
        ctx.setLineDash([]);

        const p = (t * 0.42) % 1;
        ctx.fillStyle = '#0f8b8d';
        ctx.beginPath();
        ctx.arc(fx + 162 + (phaseCx - (fx + 162)) * p, fy + 40 + (phaseCy - (fy + 40)) * p, 3.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        drawGlassSlice(ctx, fx, fy, 162, 78, '定象坊 · 微分算子', '#1b2a6b', () => {
          ctx.font = '600 11.5px Consolas, monospace';
          ctx.fillStyle = '#141821';
          ctx.fillText(`ζ = ${zeta.toFixed(2)}`, fx + 14, fy + 42);
          ctx.fillStyle = '#0f8b8d';
          ctx.fillText(`ω = ${omega.toFixed(2)}`, fx + 86, fy + 42);

          ctx.fillStyle = 'rgba(27,42,107,0.1)';
          ctx.fillRect(fx + 14, fy + 51, 134, 4);
          ctx.fillStyle = '#1b2a6b';
          ctx.fillRect(fx + 14, fy + 51, 134 * Math.min(1, zeta / 0.8), 4);

          ctx.fillStyle = 'rgba(15,139,141,0.12)';
          ctx.fillRect(fx + 14, fy + 60, 134, 4);
          ctx.fillStyle = '#0f8b8d';
          ctx.fillRect(fx + 14, fy + 60, 134 * Math.min(1, (omega - 1) / 3.2), 4);
        });

        const sw = 204;
        const sh = 114;
        drawGlassSlice(ctx, tx, ty, sw, sh, '通文册 · 课件同步', '#d64531', () => {
          ctx.fillStyle = 'rgba(20, 24, 33, 0.14)';
          ctx.fillRect(tx + 14, ty + 30, 72, 4);
          ctx.fillStyle = 'rgba(20, 24, 33, 0.08)';
          ctx.fillRect(tx + 14, ty + 38, 44, 3.5);

          const gx = tx + 14;
          const gy = ty + 48;
          const gw = sw - 28;
          const gh = 52;
          ctx.fillStyle = 'rgba(27, 42, 107, 0.032)';
          ctx.strokeStyle = 'rgba(27, 42, 107, 0.14)';
          roundRect(ctx, gx, gy, gw, gh, 6);
          ctx.fill();
          ctx.stroke();

          ctx.beginPath();
          for (let i = 0; i <= 60; i++) {
            const u = i / 60;
            const tau = u * 5.2;
            const wd = omega * Math.sqrt(Math.max(0.05, 1 - zeta * zeta));
            const val = Math.exp(-zeta * omega * tau * 0.45) * Math.cos(wd * tau - t * 1.8);
            const sx = gx + 6 + u * (gw - 12);
            const sy = gy + gh * 0.5 - val * (gh * 0.38);
            if (i === 0) ctx.moveTo(sx, sy);
            else ctx.lineTo(sx, sy);
          }
          ctx.strokeStyle = '#d64531';
          ctx.lineWidth = 1.9;
          ctx.stroke();

          const obsU = (t * 0.25) % 1;
          const obsTau = obsU * 5.2;
          const obsWd = omega * Math.sqrt(Math.max(0.05, 1 - zeta * zeta));
          const obsVal = Math.exp(-zeta * omega * obsTau * 0.45) * Math.cos(obsWd * obsTau - t * 1.8);
          ctx.fillStyle = '#0f8b8d';
          ctx.beginPath();
          ctx.arc(gx + 6 + obsU * (gw - 12), gy + gh * 0.5 - obsVal * (gh * 0.38), 3.6, 0, Math.PI * 2);
          ctx.fill();
        });
      }

      // 左侧文字防遮挡轻羽化
      if (!isNarrow) {
        const mask = ctx.createLinearGradient(0, 0, width * 0.46, 0);
        mask.addColorStop(0, 'rgba(243, 240, 231, 0.94)');
        mask.addColorStop(0.75, 'rgba(243, 240, 231, 0.65)');
        mask.addColorStop(1, 'rgba(243, 240, 231, 0)');
        ctx.fillStyle = mask;
        ctx.fillRect(0, 0, width * 0.46, height);
      }
    };

    // 首次布局阶段同步完成尺寸初始化并立刻绘制首帧，避免右侧晚一拍才出现
    syncCanvasSize();
    drawFrame(reducedMotion ? 0.8 : 0);

    const observer = new ResizeObserver(() => {
      if (syncCanvasSize()) drawFrame(lastT);
    });
    observer.observe(container);

    if (reducedMotion) {
      return () => observer.disconnect();
    }

    let raf = 0;
    let start = performance.now();
    let pausedAt: number | null = null;

    const tick = (now: number) => {
      drawFrame(Math.max(0, now - start) / 1000);
      raf = window.requestAnimationFrame(tick);
    };

    const syncRunning = () => {
      const shouldRun = !document.hidden && inView;
      if (!shouldRun && raf) {
        pausedAt = performance.now();
        window.cancelAnimationFrame(raf);
        raf = 0;
      } else if (shouldRun && !raf) {
        if (pausedAt !== null) {
          start += performance.now() - pausedAt;
          pausedAt = null;
        }
        raf = window.requestAnimationFrame(tick);
      }
    };

    const io = typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver((entries) => {
          inView = entries[0]?.isIntersecting ?? true;
          syncRunning();
        }, { threshold: 0.05 })
      : null;
    io?.observe(container);

    raf = window.requestAnimationFrame(tick);
    document.addEventListener('visibilitychange', syncRunning);

    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      observer.disconnect();
      io?.disconnect();
      window.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('visibilitychange', syncRunning);
    };
  }, [reducedMotion]);

  return (
    <section className={styles.hero} aria-labelledby="home-hero-slogan">
      <div className={styles.bgGrid} aria-hidden="true" />
      <div className={styles.container} ref={containerRef}>
        <canvas className={styles.canvas} ref={canvasRef} aria-hidden="true" />

        <div className={styles.left}>
          <div className={styles.brandMark}>
            <img className={styles.brandLogo} src={markUrl} width={30} height={30} alt="万象" />
            <span className={styles.brandNames}>
              <strong>定象坊</strong>
              <span className={styles.brandCross}>×</span>
              <strong>通文册</strong>
            </span>
          </div>

          <div className={styles.sloganBlock}>
            <h1 id="home-hero-slogan" className={styles.slogan}>
              <span className={`${styles.sloganLine} ${styles.line1}`}>
                <span className={styles.glyphFormula}>一式</span>
                <span className={styles.glyphDingxiang}>
                  定象
                  <i className={`${styles.corner} ${styles.cornerTl}`} aria-hidden="true" />
                  <i className={`${styles.corner} ${styles.cornerBr}`} aria-hidden="true" />
                </span>
                <span className={styles.punct}>，</span>
              </span>
              <span className={`${styles.sloganLine} ${styles.line2}`}>
                万象
                <span className={styles.glyphJietong}>
                  皆通
                  <svg
                    className={styles.waveUnderline}
                    viewBox="0 0 180 14"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                  >
                    <defs>
                      <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="#1b2a6b" />
                        <stop offset="65%" stopColor="#0f8b8d" />
                        <stop offset="100%" stopColor="#d64531" stopOpacity="0.85" />
                      </linearGradient>
                    </defs>
                    <path
                      ref={wavePathRef}
                      d="M0 7 L180 7"
                      fill="none"
                      stroke={`url(#${gradId})`}
                      strokeWidth="2.4"
                      strokeLinecap="round"
                    />
                  </svg>
                </span>
                <span className={styles.punct}>。</span>
              </span>
            </h1>
            <div className={styles.sloganEn}>
              <i aria-hidden="true" />
              <span>ONE FORMULA · EVERY PHENOMENON</span>
            </div>
          </div>

          <p className={styles.desc}>
            <strong className="keep-together">定象坊</strong>将公式和算法变成可调参的实验。
            <strong className="keep-together">通文册</strong>让静态课件也能交互演示。
          </p>

          <div className={styles.actions}>
            <Link className="btn btn--primary" to="/workshop">
              进入定象坊 <span aria-hidden="true">↗</span>
            </Link>
            <Link className="btn" to="/living">
              打开通文册 <span aria-hidden="true">↗</span>
            </Link>
          </div>

          <div className={styles.pillars}>
            <div className={styles.pillar}>
              <span className={styles.pillarIdx}>01 / KERNEL</span>
              <strong>真计算内核</strong>
            </div>
            <div className={styles.pillar}>
              <span className={styles.pillarIdx}>02 / BRIDGE</span>
              <strong>坊册实时贯通</strong>
            </div>
            <div className={styles.pillar}>
              <span className={styles.pillarIdx}>03 / OFFLINE</span>
              <strong>单文件离线可演</strong>
            </div>
          </div>
        </div>

        <div className={styles.right} aria-hidden="true">
          <div className={styles.telemetry}>
            <span className={styles.liveBadge}>LIVE DYNAMICAL FIELD</span>
            <span className={styles.stateName} ref={stateNameRef}>轻阻尼谐振 · 涟漪螺旋</span>
            <span className={styles.stateParams}>
              ζ = <b ref={zetaRef}>0.14</b> · ω = <b ref={omegaRef}>2.55</b> rad/s
            </span>
            <div className={styles.cycleBar}><i ref={cycleFillRef} /></div>
          </div>
        </div>
      </div>
    </section>
  );
}
