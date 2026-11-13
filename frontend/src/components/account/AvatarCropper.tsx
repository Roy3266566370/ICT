/**
 * 头像裁剪对话框：拖动定位 + 缩放，输出 512×512 JPEG。
 *
 * 只做前端预览与裁剪；服务端仍会重新校验格式、尺寸并重编码，二者不互相替代。
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import styles from './AvatarCropper.module.css';

/** 预览视口边长（CSS 像素）；输出固定 512。 */
const VIEWPORT = 288;
const OUTPUT_SIZE = 512;
const MAX_SCALE = 3;

interface Offset {
  x: number;
  y: number;
}

export interface AvatarCropperProps {
  file: File;
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (blob: Blob) => void;
}

function coverScaleOf(image: HTMLImageElement): number {
  return VIEWPORT / Math.min(image.naturalWidth, image.naturalHeight);
}

function clampOffset(image: HTMLImageElement, scale: number, offset: Offset): Offset {
  const base = coverScaleOf(image);
  const maxX = Math.max(0, (image.naturalWidth * base * scale - VIEWPORT) / 2);
  const maxY = Math.max(0, (image.naturalHeight * base * scale - VIEWPORT) / 2);
  return {
    x: Math.min(maxX, Math.max(-maxX, offset.x)),
    y: Math.min(maxY, Math.max(-maxY, offset.y)),
  };
}

export function AvatarCropper({
  file,
  saving,
  error,
  onCancel,
  onConfirm,
}: AvatarCropperProps): JSX.Element {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 });
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; origin: Offset } | null>(
    null,
  );
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const element = new Image();
    element.onload = () => setImage(element);
    element.onerror = () => setLoadError('图片无法读取，请换一张 JPG / PNG / WebP');
    element.src = url;
    return () => {
      element.onload = null;
      element.onerror = null;
      URL.revokeObjectURL(url);
    };
  }, [file]);

  useEffect(() => {
    confirmRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !saving) onCancel();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel, saving]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (image === null || saving) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: offset,
    };
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (drag === null || image === null || drag.pointerId !== event.pointerId) return;
    setOffset(
      clampOffset(image, scale, {
        x: drag.origin.x + (event.clientX - drag.startX),
        y: drag.origin.y + (event.clientY - drag.startY),
      }),
    );
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  };

  const handleScale = (next: number): void => {
    setScale(next);
    if (image !== null) setOffset((current) => clampOffset(image, next, current));
  };

  const crop = useCallback((): void => {
    if (image === null) return;
    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;
    const context = canvas.getContext('2d');
    if (context === null) return;

    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);

    const factor = OUTPUT_SIZE / VIEWPORT;
    const base = coverScaleOf(image);
    const drawWidth = image.naturalWidth * base * scale * factor;
    const drawHeight = image.naturalHeight * base * scale * factor;
    context.translate(
      OUTPUT_SIZE / 2 + offset.x * factor,
      OUTPUT_SIZE / 2 + offset.y * factor,
    );
    context.drawImage(image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);

    canvas.toBlob(
      (blob) => {
        if (blob !== null) onConfirm(blob);
      },
      'image/jpeg',
      0.9,
    );
  }, [image, offset, onConfirm, scale]);

  const message = loadError ?? error;

  return (
    <div
      className={styles.backdrop}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onCancel();
      }}
    >
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="avatar-crop-title"
      >
        <header className={styles.head}>
          <h2 className={styles.title} id="avatar-crop-title">
            裁剪头像
          </h2>
          <p className={styles.lead}>拖动图片调整位置，滑动缩放。保存后显示为圆形。</p>
        </header>

        <div
          className={styles.viewport}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          {image === null ? (
            <span className={styles.placeholder}>{loadError === null ? '正在读取图片…' : '无法预览'}</span>
          ) : (
            <img
              className={styles.image}
              src={image.src}
              alt=""
              draggable={false}
              style={{
                width: `${image.naturalWidth * coverScaleOf(image) * scale}px`,
                height: `${image.naturalHeight * coverScaleOf(image) * scale}px`,
                transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px)`,
              }}
            />
          )}
          <span className={styles.circleMask} aria-hidden="true" />
          <span className={styles.circleGuide} aria-hidden="true" />
        </div>

        <label className={styles.zoomRow}>
          <span className={styles.zoomLabel}>缩放</span>
          <input
            className={styles.zoomRange}
            type="range"
            min={1}
            max={MAX_SCALE}
            step={0.01}
            value={scale}
            onChange={(event) => handleScale(Number(event.target.value))}
            disabled={image === null || saving}
            aria-label="缩放头像"
          />
        </label>

        {message === null ? null : (
          <p className={styles.error} role="alert">
            {message}
          </p>
        )}

        <div className={styles.actions}>
          <button type="button" className={styles.cancel} onClick={onCancel} disabled={saving}>
            取消
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={styles.confirm}
            onClick={crop}
            disabled={image === null || saving}
          >
            {saving ? '正在保存…' : '保存头像'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default AvatarCropper;
