import { useEffect, useRef, useState } from 'react';
import type { SpaceCoverTheme } from '@/state/spacePreferences';
import { relativeAssetTime, SPACE_KIND_LABEL, type SpaceItem } from './spaceItems';
import type { ProfileDraftView } from './SpaceCreatorCard';
import styles from '../SpacePage.module.css';

export function spaceItemKey(item: Pick<SpaceItem, 'kind' | 'id'>): string {
  return `${item.kind}:${item.id}`;
}

export function PinShowcaseModal({
  items,
  pinnedKeys,
  now,
  onClose,
  onSave,
}: {
  items: readonly SpaceItem[];
  pinnedKeys: readonly string[];
  now: number;
  onClose: () => void;
  onSave: (keys: string[]) => void;
}): JSX.Element {
  const [selected, setSelected] = useState<string[]>(() => [...pinnedKeys]);
  const [hint, setHint] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const toggle = (key: string) => {
    setHint('');
    setSelected((prev) => {
      if (prev.includes(key)) return prev.filter((item) => item !== key);
      if (prev.length >= 3) {
        setHint('主页展柜最多置顶 3 项代表作，请先取消一项后再勾选。');
        return prev;
      }
      return [...prev, key];
    });
  };

  return (
    <div className={styles.modalBackdrop} role="dialog" aria-modal="true" aria-label="管理主页置顶代表作" onClick={onClose}>
      <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHead}>
          <h3>管理主页置顶代表作</h3>
          <button type="button" className={`${styles.btn} ${styles.btnSm} ${styles.btnGhost}`} onClick={onClose}>
            关闭
          </button>
        </div>
        <p className={styles.modalDesc}>
          选择最多 3 项最满意的沙盘、活页或积木陈列在个人主页（全部文件仍在定象坊与通文册中管理）。
        </p>
        <div className={styles.pinOptionsList}>
          {items.map((item) => {
            const key = spaceItemKey(item);
            const checked = selected.includes(key);
            return (
              <label key={key} className={styles.pinOption} data-checked={checked || undefined}>
                <div style={{ minWidth: 0 }}>
                  <strong>{item.title}</strong>
                  <small>
                    {SPACE_KIND_LABEL[item.kind]} · {relativeAssetTime(item.time, now) || '最近'}
                  </small>
                </div>
                <input type="checkbox" checked={checked} onChange={() => toggle(key)} />
              </label>
            );
          })}
        </div>
        {hint ? <p className={styles.fieldError} role="alert">{hint}</p> : null}
        <div className={styles.modalFoot}>
          <span className={styles.modalCount}>已选 {selected.length} / 3 项</span>
          <div className={styles.inlineRow}>
            <button type="button" className={`${styles.btn} ${styles.btnSm} ${styles.btnGhost}`} onClick={() => setSelected([])}>
              恢复自动推荐
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnSm} ${styles.btnPrimary}`}
              onClick={() => onSave(selected)}
            >
              保存置顶
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

async function prepareCover(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) {
    throw new Error('请选择 10 MB 以内的 JPG、PNG 或 WebP 图片。');
  }
  const image = await createImageBitmap(file);
  try {
    const ratio = Math.min(1, 1440 / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * ratio));
    canvas.height = Math.max(1, Math.round(image.height * ratio));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('当前浏览器无法处理这张图片。');
    context.fillStyle = '#fffdf8';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', .83);
  } finally { image.close(); }
}

function loadPosterImage(url: string | null): Promise<HTMLImageElement | undefined> {
  if (!url) return Promise.resolve(undefined);
  return new Promise(resolve => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => resolve(undefined);
    image.src = url;
  });
}

export function CreatorPosterModal({
  draft,
  username,
  avatarUrl,
  coverTheme,
  coverImage,
  onCoverChange,
  totalSlides,
  workCount,
  blockCount,
  onClose,
  onDownloaded,
}: {
  draft: ProfileDraftView;
  username: string;
  avatarUrl: string | null;
  coverTheme: SpaceCoverTheme;
  coverImage: string | null;
  onCoverChange: (image: string | null) => void;
  totalSlides: number;
  workCount: number;
  blockCount: number;
  onClose: () => void;
  onDownloaded: () => void;
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [uploading, setUploading] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const updateCover = async (file: File | null) => {
    setUploading(true);
    setError('');
    try {
      onCoverChange(file ? await prepareCover(file) : null);
    } catch (cause) {
      setError(cause instanceof DOMException && cause.name === 'QuotaExceededError'
        ? '浏览器存储空间不足，封面未保存。'
        : cause instanceof Error ? cause.message : '图片处理失败。');
    } finally { setUploading(false); }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    setReady(false);
    const renderPoster = (img?: HTMLImageElement, cover?: HTMLImageElement) => {
      const w = canvas.width;
      const h = canvas.height;
      const dark = coverTheme === 'indigo-star' || coverTheme === 'chalk-board';
      const bgMap: Record<SpaceCoverTheme, [string, string]> = {
        'ivory-gold': ['#faf6ea', '#efe5cf'],
        'indigo-star': ['#171f3b', '#223663'],
        'chalk-board': ['#16332c', '#204a3f'],
        'oat-editorial': ['#f2e6d5', '#e4d3bc'],
      };
      const [c1, c2] = bgMap[coverTheme];
      const grad = ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, c1);
      grad.addColorStop(1, c2);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = dark ? 'rgba(255,255,255,0.12)' : 'rgba(184,68,35,0.14)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let x = 0; x <= w; x += 8) {
        const y = h * 0.72 + Math.sin(x / 110) * 34 + Math.cos(x / 48) * 14;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      if (cover) {
        const band = 116;
        const scale = Math.max(w / cover.width, band / cover.height);
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, w, band);
        ctx.clip();
        ctx.drawImage(cover, (w - cover.width * scale) / 2, (band - cover.height * scale) / 2,
          cover.width * scale, cover.height * scale);
        ctx.fillStyle = '#0006';
        ctx.fillRect(0, 0, w, band);
        ctx.restore();
      }
      ctx.fillStyle = cover ? '#fffdf8' : dark ? '#ffd38e' : '#b84423';
      ctx.font = '600 18px ui-monospace, monospace';
      ctx.fillText('WANXIANG · 万象创作者名片', 64, 72);

      const name = draft.displayName.trim() || username;
      ctx.save();
      ctx.beginPath();
      ctx.arc(118, 178, 52, 0, Math.PI * 2);
      ctx.clip();
      if (img) {
        ctx.drawImage(img, 66, 126, 104, 104);
      } else {
        ctx.fillStyle = dark ? '#3c5aa0' : '#2e457a';
        ctx.fillRect(66, 126, 104, 104);
        ctx.fillStyle = '#fffdf8';
        ctx.font = '700 42px Georgia, serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(Array.from(name)[0] ?? '象', 118, 180);
      }
      ctx.restore();

      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = dark ? '#ffffff' : '#141816';
      ctx.font = '700 46px "Songti SC", Georgia, serif';
      ctx.fillText(name.slice(0, 18), 198, 174);

      ctx.fillStyle = dark ? 'rgba(255,255,255,0.72)' : '#5a635e';
      ctx.font = '500 22px sans-serif';
      const meta = [draft.occupation.trim(), draft.school.trim(), `@${username}`].filter(Boolean).join(' · ');
      ctx.fillText(meta.slice(0, 44), 198, 214);

      ctx.fillStyle = dark ? 'rgba(255,255,255,0.88)' : '#323a35';
      ctx.font = '400 24px sans-serif';
      const bioLine = (draft.bio.trim() || '在万象探索动态教学与可视化创作').slice(0, 38);
      ctx.fillText(bioLine, 64, 300);

      let tx = 64;
      ctx.font = '500 19px sans-serif';
      for (const tag of draft.interests.slice(0, 5)) {
        const text = `# ${tag}`;
        const tw = ctx.measureText(text).width + 28;
        if (tx + tw > w - 64) break;
        ctx.fillStyle = dark ? 'rgba(255,255,255,0.12)' : 'rgba(20,24,22,0.07)';
        ctx.beginPath();
        ctx.roundRect(tx, 344, tw, 38, 19);
        ctx.fill();
        ctx.fillStyle = dark ? '#eef4ff' : '#2c3430';
        ctx.fillText(text, tx + 14, 370);
        tx += tw + 12;
      }

      ctx.strokeStyle = dark ? 'rgba(255,255,255,0.14)' : 'rgba(20,24,22,0.12)';
      ctx.beginPath();
      ctx.moveTo(64, 456);
      ctx.lineTo(w - 64, 456);
      ctx.stroke();

      ctx.fillStyle = dark ? '#ffffff' : '#141816';
      ctx.font = '700 26px Georgia, serif';
      ctx.fillText(`${totalSlides} 页动态幻灯片   ·   ${workCount} 个交互沙盘   ·   ${blockCount} 块自研积木`, 64, 514);
    };

    let active = true;
    void Promise.all([loadPosterImage(avatarUrl), loadPosterImage(coverImage)]).then(([avatar, cover]) => {
      if (!active) return;
      renderPoster(avatar, cover);
      setReady(true);
    });
    return () => { active = false; };
  }, [draft, username, avatarUrl, coverTheme, coverImage, totalSlides, workCount, blockCount]);

  const download = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const url = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.href = url;
      link.download = `${(draft.displayName.trim() || username || 'wanxiang').replace(/[\\/:*?"<>|]/g, '_')}-创作者名片.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      onDownloaded();
    } catch {
      onDownloaded();
    }
  };

  return (
    <div className={styles.modalBackdrop} role="dialog" aria-modal="true" aria-label="创作者名片预览" onClick={onClose}>
      <div className={`${styles.modalCard} ${styles.posterModalCard}`} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHead}>
          <h3>创作者名片预览</h3>
          <button type="button" className={`${styles.btn} ${styles.btnSm} ${styles.btnGhost}`} onClick={onClose}>
            关闭
          </button>
        </div>
        <div className={styles.inlineRow}>
          <label>上传封面图片{' '}
            <input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading}
              onChange={event => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                if (file) void updateCover(file);
              }} />
          </label>
          {coverImage && <button type="button" className={`${styles.btn} ${styles.btnSm} ${styles.btnGhost}`}
            disabled={uploading} onClick={() => void updateCover(null)}>恢复默认封面</button>}
        </div>
        {error && <p role="alert">{error}</p>}
        <canvas ref={canvasRef} width={1040} height={580} className={styles.posterCanvas} />
        <div className={styles.modalFoot}>
          <span className={styles.modalCount}>自动同步当前头像、简介、学科标签与真实创作数据</span>
          <button type="button" className={`${styles.btn} ${styles.btnSm} ${styles.btnPrimary}`} onClick={download} disabled={!ready || uploading}>
            下载高清 PNG 名片
          </button>
        </div>
      </div>
    </div>
  );
}
