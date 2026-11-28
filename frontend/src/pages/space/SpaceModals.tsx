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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [coverMode, setCoverMode] = useState<'banner' | 'full'>('full');
  const [focusY, setFocusY] = useState(50);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');

  const updateCover = async (file: File | null) => {
    setUploading(true);
    setError('');
    try {
      onCoverChange(file ? await prepareCover(file) : null);
      if (file) setFocusY(50);
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
      const fullBg = Boolean(cover && coverMode === 'full');
      const bannerBg = Boolean(cover && coverMode === 'banner');
      const dark = fullBg || coverTheme === 'indigo-star' || coverTheme === 'chalk-board';
      const bgMap: Record<SpaceCoverTheme, [string, string]> = {
        'ivory-gold': ['#faf6ea', '#efe5cf'],
        'indigo-star': ['#171f3b', '#223663'],
        'chalk-board': ['#16332c', '#204a3f'],
        'oat-editorial': ['#f2e6d5', '#e4d3bc'],
      };
      const [c1, c2] = bgMap[coverTheme];

      // 1. 底色与氛围底纹
      const grad = ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, c1);
      grad.addColorStop(1, c2);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      const drawCovered = (
        image: HTMLImageElement,
        x: number,
        y: number,
        boxW: number,
        boxH: number,
        posYRatio: number,
      ) => {
        const scale = Math.max(boxW / image.width, boxH / image.height);
        const drawW = image.width * scale;
        const drawH = image.height * scale;
        const drawX = x + (boxW - drawW) / 2;
        const drawY = y + (boxH - drawH) * posYRatio;
        ctx.drawImage(image, drawX, drawY, drawW, drawH);
      };

      const posY = Math.max(0, Math.min(1, focusY / 100));

      if (fullBg && cover) {
        // 全卡氛围背景：铺满整张名片 + 多层柔和渐暗遮罩，保证文字通透清晰
        ctx.save();
        drawCovered(cover, 0, 0, w, h, posY);
        const scrim = ctx.createLinearGradient(0, 0, w * 0.9, h);
        scrim.addColorStop(0, 'rgba(15, 20, 26, 0.72)');
        scrim.addColorStop(0.55, 'rgba(15, 20, 26, 0.50)');
        scrim.addColorStop(1, 'rgba(15, 20, 26, 0.76)');
        ctx.fillStyle = scrim;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
      } else {
        // 纸墨波形装饰线
        ctx.strokeStyle = dark ? 'rgba(255,255,255,0.12)' : 'rgba(184,68,35,0.13)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let x = 0; x <= w; x += 8) {
          const y = h * 0.74 + Math.sin(x / 110) * 32 + Math.cos(x / 48) * 12;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();

        if (bannerBg && cover) {
          // 顶部杂志横幅：自然覆盖上方 166px，底部柔焦羽化融入底色
          const band = 166;
          ctx.save();
          ctx.beginPath();
          ctx.rect(0, 0, w, band);
          ctx.clip();
          drawCovered(cover, 0, 0, w, band, posY);
          const topShade = ctx.createLinearGradient(0, 0, 0, band);
          topShade.addColorStop(0, 'rgba(14, 18, 22, 0.48)');
          topShade.addColorStop(0.65, 'rgba(14, 18, 22, 0.24)');
          topShade.addColorStop(1, 'rgba(14, 18, 22, 0.06)');
          ctx.fillStyle = topShade;
          ctx.fillRect(0, 0, w, band);
          ctx.restore();

          // 底部柔和过渡条，消除硬边割裂
          const fade = ctx.createLinearGradient(0, band - 42, 0, band + 6);
          fade.addColorStop(0, 'rgba(0,0,0,0)');
          fade.addColorStop(1, c1);
          ctx.fillStyle = fade;
          ctx.fillRect(0, band - 42, w, 48);
        }
      }

      // 2. 顶部品牌眉标
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = (fullBg || bannerBg) ? 'rgba(255, 253, 248, 0.92)' : dark ? '#ffd38e' : '#b84423';
      ctx.font = '600 18px ui-monospace, monospace';
      ctx.fillText('WANXIANG  ·  万象创作者名片', 64, 64);

      // 3. 头像（带精致外环描边与柔和阴影）
      const name = draft.displayName.trim() || username;
      const avatarCx = 118;
      const avatarCy = bannerBg ? 174 : 180;
      const avatarR = 54;

      ctx.save();
      ctx.shadowColor = 'rgba(14, 18, 22, 0.22)';
      ctx.shadowBlur = 18;
      ctx.shadowOffsetY = 6;
      ctx.beginPath();
      ctx.arc(avatarCx, avatarCy, avatarR + 4, 0, Math.PI * 2);
      ctx.fillStyle = fullBg ? 'rgba(255, 253, 248, 0.92)' : (dark ? '#233252' : '#fffdf8');
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.beginPath();
      ctx.arc(avatarCx, avatarCy, avatarR, 0, Math.PI * 2);
      ctx.clip();
      if (img) {
        drawCovered(img, avatarCx - avatarR, avatarCy - avatarR, avatarR * 2, avatarR * 2, 0.5);
      } else {
        ctx.fillStyle = dark ? '#3c5aa0' : '#2e457a';
        ctx.fillRect(avatarCx - avatarR, avatarCy - avatarR, avatarR * 2, avatarR * 2);
        ctx.fillStyle = '#fffdf8';
        ctx.font = '700 42px Georgia, serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(Array.from(name)[0] ?? '象', avatarCx, avatarCy + 2);
      }
      ctx.restore();

      // 4. 昵称与身份信息
      const nameY = bannerBg ? 218 : 176;
      const metaY = bannerBg ? 254 : 216;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = dark ? '#ffffff' : '#141816';
      ctx.font = '700 46px "Songti SC", Georgia, serif';
      ctx.fillText(name.slice(0, 18), 198, nameY);

      ctx.fillStyle = dark ? 'rgba(255,255,255,0.78)' : '#5a635e';
      ctx.font = '500 22px sans-serif';
      const meta = [draft.occupation.trim(), draft.school.trim(), `@${username}`].filter(Boolean).join(' · ');
      ctx.fillText(meta.slice(0, 44), 198, metaY);

      // 5. 个人简介
      const bioY = bannerBg ? 316 : 302;
      ctx.fillStyle = dark ? 'rgba(255,255,255,0.92)' : '#323a35';
      ctx.font = '400 24px sans-serif';
      const bioLine = (draft.bio.trim() || '在万象探索动态教学与可视化创作').slice(0, 38);
      ctx.fillText(bioLine, 64, bioY);

      // 6. 兴趣标签胶囊
      let tx = 64;
      const tagY = bannerBg ? 356 : 346;
      ctx.font = '500 19px sans-serif';
      for (const tag of draft.interests.slice(0, 5)) {
        const text = `# ${tag}`;
        const tw = ctx.measureText(text).width + 28;
        if (tx + tw > w - 64) break;
        ctx.fillStyle = fullBg
          ? 'rgba(255,255,255,0.16)'
          : dark
            ? 'rgba(255,255,255,0.12)'
            : 'rgba(20,24,22,0.07)';
        ctx.beginPath();
        ctx.roundRect(tx, tagY, tw, 38, 19);
        ctx.fill();
        ctx.fillStyle = dark ? '#f4f7ff' : '#2c3430';
        ctx.fillText(text, tx + 14, tagY + 26);
        tx += tw + 12;
      }

      // 7. 底部分割线与创作数据
      ctx.strokeStyle = dark ? 'rgba(255,255,255,0.18)' : 'rgba(20,24,22,0.12)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(64, 456);
      ctx.lineTo(w - 64, 456);
      ctx.stroke();

      ctx.fillStyle = dark ? '#ffffff' : '#141816';
      ctx.font = '700 26px Georgia, serif';
      ctx.fillText(`${totalSlides} 页动态幻灯片   ·   ${workCount} 个交互沙盘   ·   ${blockCount} 块自研积木`, 64, 514);

      // 8. 精致内边框
      ctx.strokeStyle = dark ? 'rgba(255,255,255,0.14)' : 'rgba(20,24,22,0.08)';
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, w - 2, h - 2);
    };

    let active = true;
    void Promise.all([loadPosterImage(avatarUrl), loadPosterImage(coverImage)]).then(([avatar, cover]) => {
      if (!active) return;
      renderPoster(avatar, cover);
      setReady(true);
    });
    return () => { active = false; };
  }, [draft, username, avatarUrl, coverTheme, coverImage, coverMode, focusY, totalSlides, workCount, blockCount]);

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
          <div>
            <h3>创作者名片预览</h3>
            <p className={styles.posterSub}>可上传自定义图片作为名片背景，或直接拖拽图片到下方预览区</p>
          </div>
          <button type="button" className={`${styles.btn} ${styles.btnSm} ${styles.btnGhost}`} onClick={onClose}>
            关闭
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          disabled={uploading}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (file) void updateCover(file);
          }}
        />

        <div className={styles.posterToolbar}>
          <div className={styles.inlineRow}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnSm} ${styles.btnSoft}`}
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? '正在处理图片…' : coverImage ? '更换自定义图片' : '↑ 上传自定义图片'}
            </button>
            {coverImage ? (
              <button
                type="button"
                className={`${styles.btn} ${styles.btnSm} ${styles.btnGhost}`}
                disabled={uploading}
                onClick={() => void updateCover(null)}
              >
                恢复默认主题
              </button>
            ) : null}
          </div>

          {coverImage ? (
            <div className={styles.posterAdjust}>
              <div className={styles.posterModeGroup} role="group" aria-label="背景铺设方式">
                <button
                  type="button"
                  aria-pressed={coverMode === 'full'}
                  onClick={() => setCoverMode('full')}
                >
                  全卡背景
                </button>
                <button
                  type="button"
                  aria-pressed={coverMode === 'banner'}
                  onClick={() => setCoverMode('banner')}
                >
                  顶部横幅
                </button>
              </div>
              <label className={styles.posterRange}>
                <span>构图</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={focusY}
                  aria-label="调整封面纵向构图位置"
                  onChange={(e) => setFocusY(Number(e.target.value))}
                />
              </label>
            </div>
          ) : (
            <span className={styles.posterFormatHint}>支持 JPG / PNG / WebP（10 MB 以内）</span>
          )}
        </div>

        {error ? <p className={styles.fieldError} role="alert" style={{ marginBottom: 10 }}>{error}</p> : null}

        <div
          className={styles.posterStage}
          data-dragging={dragging ? 'true' : undefined}
          onDragOver={(e) => {
            e.preventDefault();
            if (!dragging) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files?.[0];
            if (file) void updateCover(file);
          }}
        >
          <canvas ref={canvasRef} width={1040} height={580} className={styles.posterCanvas} />
          {dragging ? (
            <div className={styles.posterDropMask} aria-hidden="true">
              松开即可设为名片封面图
            </div>
          ) : null}
        </div>

        <div className={styles.modalFoot}>
          <span className={styles.modalCount}>自动同步当前头像、简介、学科标签与真实创作数据</span>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnSm} ${styles.btnPrimary}`}
            onClick={download}
            disabled={!ready || uploading}
          >
            下载高清 PNG 名片
          </button>
        </div>
      </div>
    </div>
  );
}
