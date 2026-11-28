import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { SpaceCover } from './SpaceCard';
import { relativeAssetTime, SPACE_KIND_LABEL, spaceItemHref, type SpaceItem } from './spaceItems';
import styles from '../SpacePage.module.css';

interface Props {
  heroItem: SpaceItem | null;
  totalItems: number;
  now: number;
  reducedMotion: boolean;
  onManagePins: () => void;
  onCreateDeck: () => void;
  onCreateCanvas: () => void;
}

function itemSubtitle(item: SpaceItem, now: number): string {
  const rel = relativeAssetTime(item.time, now);
  if (item.kind === 'material') {
    return [`通文册 · ${item.record.page_count} 页动态幻灯片`, rel].filter(Boolean).join(' · ');
  }
  if (item.kind === 'work') {
    return [`定象坊 · ${item.record.node_count} 个交互积木`, rel].filter(Boolean).join(' · ');
  }
  return ['本机积木', rel ? `创建于 ${rel}` : ''].filter(Boolean).join(' · ');
}

function LiveFourierMini({ reducedMotion }: { reducedMotion: boolean }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [harmonics, setHarmonics] = useState(5);
  const [playing, setPlaying] = useState(!reducedMotion);
  const phaseRef = useRef(0);

  useEffect(() => {
    if (reducedMotion) setPlaying(false);
  }, [reducedMotion]);

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const canvas = canvasRef.current;
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        if (rect.width > 0) {
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          const w = Math.round(rect.width * dpr);
          const h = Math.round(rect.height * dpr);
          if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
          }
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.clearRect(0, 0, w, h);
            ctx.strokeStyle = 'rgba(255,255,255,0.09)';
            ctx.lineWidth = dpr;
            ctx.beginPath();
            ctx.moveTo(0, h / 2);
            ctx.lineTo(w, h / 2);
            ctx.stroke();

            ctx.strokeStyle = 'rgba(131, 232, 234, 0.24)';
            ctx.setLineDash([5 * dpr, 5 * dpr]);
            ctx.beginPath();
            for (let px = 0; px <= w; px += 4) {
              const theta = (px / w) * Math.PI * 4 + phaseRef.current;
              const py = h / 2 - (Math.sin(theta) >= 0 ? 1 : -1) * h * 0.3;
              if (px === 0) ctx.moveTo(px, py);
              else ctx.lineTo(px, py);
            }
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.strokeStyle = '#f3b75c';
            ctx.lineWidth = 2.4 * dpr;
            ctx.beginPath();
            for (let px = 0; px <= w; px += 2) {
              const theta = (px / w) * Math.PI * 4 + phaseRef.current;
              let sum = 0;
              for (let n = 1; n <= harmonics; n += 2) {
                sum += (4 / (Math.PI * n)) * Math.sin(n * theta);
              }
              const py = h / 2 - sum * h * 0.3;
              if (px === 0) ctx.moveTo(px, py);
              else ctx.lineTo(px, py);
            }
            ctx.stroke();
          }
        }
      }
      if (playing && !reducedMotion) {
        phaseRef.current += 0.024;
        raf = window.requestAnimationFrame(draw);
      }
    };
    draw();
    return () => window.cancelAnimationFrame(raf);
  }, [harmonics, playing, reducedMotion]);

  return (
    <div className={styles.liveStage}>
      <div className={styles.liveStageTop}>
        <span className={styles.livePill}><i aria-hidden="true" />LIVE · 万象交互展台</span>
        <span className={styles.liveFormula}>f(x) = Σ (4/πn)·sin(nx)</span>
      </div>
      <canvas ref={canvasRef} className={styles.fourierCanvas} aria-label="傅里叶级数方波合成实时演示" />
      <div className={styles.liveControls}>
        <label>
          <span>谐波阶数 N</span>
          <input
            type="range"
            min={1}
            max={15}
            step={2}
            value={harmonics}
            onChange={(e) => setHarmonics(Number(e.target.value))}
          />
          <strong>{harmonics}</strong>
        </label>
        <button
          type="button"
          className={styles.liveToggleBtn}
          onClick={() => setPlaying((v) => !v)}
        >
          {playing ? '⏸ 暂停波形' : '▶ 播放波形'}
        </button>
      </div>
    </div>
  );
}

export function SpaceShowcaseHero({
  heroItem,
  totalItems,
  now,
  reducedMotion,
  onManagePins,
  onCreateDeck,
  onCreateCanvas,
}: Props): JSX.Element {
  const [tryInstrument, setTryInstrument] = useState(false);

  if (!heroItem) {
    return (
      <section className={`${styles.card} ${styles.bentoHeroPin}`} aria-label="置顶代表作展柜">
        <div className={styles.cardPad}>
          <div className={styles.cardHead}>
            <div>
              <p className={styles.kicker}>★ FEATURED SHOWCASE · 主页展柜</p>
              <h2 className={styles.cardTitle}>把最得意的交互作品挂在主页</h2>
            </div>
          </div>
          <LiveFourierMini reducedMotion={reducedMotion} />
          <div className={styles.stageCaption}>
            <div>
              <strong>还没有创作内容</strong>
              <p>新建一份原生演示文稿，或在定象坊拼装一个可调参沙盘，这里将自动成为你的代表作展位。</p>
            </div>
            <div className={styles.inlineRow}>
              <button type="button" className={`${styles.btn} ${styles.btnSm} ${styles.btnPrimary}`} onClick={onCreateDeck}>
                ＋ 新建课件
              </button>
              <button type="button" className={`${styles.btn} ${styles.btnSm} ${styles.btnGhost}`} onClick={onCreateCanvas}>
                ＋ 新建沙盘画布
              </button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  const openLabel = heroItem.kind === 'material' ? '打开通文册 ↗' : heroItem.kind === 'work' ? '打开沙盘 ↗' : '去画布使用 ↗';

  return (
    <section className={`${styles.card} ${styles.bentoHeroPin}`} aria-label="置顶代表作">
      <div className={styles.cardPad}>
        <div className={styles.cardHead}>
          <div style={{ minWidth: 0 }}>
            <p className={styles.kicker}>★ FEATURED SHOWCASE · 置顶代表作</p>
            <h2 className={styles.cardTitle} title={heroItem.title}>{heroItem.title}</h2>
          </div>
          <div className={styles.inlineRow}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnSm} ${styles.btnSoft}`}
              onClick={() => setTryInstrument((v) => !v)}
            >
              {tryInstrument ? '查看作品封面' : '试玩互动波形'}
            </button>
            {totalItems > 1 ? (
              <button type="button" className={`${styles.btn} ${styles.btnSm} ${styles.btnSoft}`} onClick={onManagePins}>
                管理置顶
              </button>
            ) : null}
          </div>
        </div>

        {tryInstrument ? (
          <LiveFourierMini reducedMotion={reducedMotion} />
        ) : (
          <Link className={styles.heroStageLink} to={spaceItemHref(heroItem)}>
            <div className={styles.heroStageFrame}>
              <SpaceCover key={`${heroItem.kind}:${heroItem.id}`} item={heroItem} eager />
            </div>
          </Link>
        )}

        <div className={styles.stageCaption}>
          <div style={{ minWidth: 0 }}>
            <strong className={styles.stageMeta}>{SPACE_KIND_LABEL[heroItem.kind]} · {itemSubtitle(heroItem, now)}</strong>
            <p>全部课件与作品可在对应工坊完整管理；此处专注展示你置顶的代表作。</p>
          </div>
          <Link className={`${styles.btn} ${styles.btnSm} ${styles.btnPrimary}`} to={spaceItemHref(heroItem)}>
            {openLabel}
          </Link>
        </div>
      </div>
    </section>
  );
}
