/**
 * PageCanvas.tsx —— 以页为中心的画布（rebuild-spec §5）。
 *
 * 默认渲染**未擦除的原页**（与原文像素级一致，只叠加很克制的悬停热区提示）；
 * 点击 / 键盘 Enter 激活可交互区域后，切换到 erased 底图 + 动态层（250ms 交叉淡入，
 * `prefers-reduced-motion` 下直切）。
 *
 * 未注册组件 / static_only / unsupported 的区域**绝不擦除原页、绝不盖白块**：
 * 保持原图并给出"该图示暂不支持交互，可继续阅读原页"的说明。
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { LinkedTextRuntime, PageRegion } from '@/regions/types';
import { resolveRegionComponent } from '@/regions/registry';
import { bboxToPercent, erasedImageFor } from './regionData';
import { LinkedTextLayer } from './LinkedTextLayer';
import { PageZoom } from './PageZoom';
import styles from './PageCanvas.module.css';

export interface PageCanvasProps {
  page: number;
  /** 当前页整页渲染图 URL（优先服务端，其次 `/fixtures/pages/sNN.png`）。 */
  pageImage: string;
  regions: PageRegion[];
  activeRegion: PageRegion | null;
  paramsByRegion: Record<string, Record<string, unknown>>;
  stages: Record<string, 0 | 1 | 2>;
  runtimeTexts: Record<string, LinkedTextRuntime[]>;
  reducedMotion: boolean;
  /**
   * 是否渲染历史区域热点。**默认 false**（§8 归档后主链路只走 iSpec）：
   * regionData 仍可读取旧产物，但不再把热点/参数挂到原页上。
   */
  showHotspots?: boolean;
  onActivate: (regionId: string) => void;
  onDeactivate: () => void;
  onChangeParams: (regionId: string, patch: Record<string, unknown>) => void;
  onLinkedTexts: (regionId: string, texts: LinkedTextRuntime[]) => void;
}

function regionLabel(region: PageRegion): string {
  return region.notes !== undefined && region.notes.length > 0
    ? region.notes.slice(0, 40)
    : `第 ${region.page} 页图示`;
}

export function PageCanvas(props: PageCanvasProps): ReactElement {
  const {
    page,
    pageImage,
    regions,
    activeRegion,
    paramsByRegion,
    stages,
    runtimeTexts,
    reducedMotion,
    showHotspots = false,
    onActivate,
    onDeactivate,
    onChangeParams,
    onLinkedTexts,
  } = props;

  const frameRef = useRef<HTMLDivElement | null>(null);
  const [imageFailed, setImageFailed] = useState(false);

  const resolution =
    activeRegion === null ? null : resolveRegionComponent(activeRegion.script_id, activeRegion.status);
  const RegionView = resolution !== null && resolution.supported ? resolution.component : null;
  const live = activeRegion !== null && RegionView !== null;
  const stage = activeRegion === null ? 2 : (stages[activeRegion.region_id] ?? 2);
  const params =
    activeRegion === null
      ? {}
      : (paramsByRegion[activeRegion.region_id] ?? activeRegion.original_params);
  const erasedImage = activeRegion === null ? '' : erasedImageFor(activeRegion);
  const runtime = activeRegion === null ? [] : (runtimeTexts[activeRegion.region_id] ?? []);

  // 热区只在显式开启（历史材料兼容）且"未激活"时出现；默认不渲染。
  const hotspots =
    showHotspots && !live ? regions.filter((region) => region.status === 'confirmed') : [];

  useEffect(() => {
    setImageFailed(false);
  }, [pageImage]);

  // 激活后把焦点交给画布（原热区按钮可能已隐藏），键盘用户可继续操作播放条。
  useEffect(() => {
    if (live) frameRef.current?.focus({ preventScroll: true });
  }, [live]);

  return (
    <div className={styles.root}>
      <PageZoom
        page={page}
        reducedMotion={reducedMotion}
        renderPage={(contentWidth) => {
          const scale = contentWidth / 1200;
          return (
            <div
              ref={frameRef}
              className={styles.page}
              data-live={live ? 'true' : 'false'}
              data-reduced-motion={reducedMotion ? 'true' : 'false'}
              tabIndex={-1}
              aria-label={`第 ${page} 页${live ? '（已激活图示）' : ''}`}
              style={{ fontSize: `${12.5 * scale}px` }}
            >
              {!imageFailed ? (
                <img
                  className={styles.image}
                  src={pageImage}
                  alt={`PPT 第 ${page} 页原貌`}
                  draggable={false}
                  onError={() => setImageFailed(true)}
                />
              ) : (
                <div className={styles.imageFallback} role="status">
                  第 {page} 页渲染图暂不可用，可继续翻页阅读其它页面。
                </div>
              )}

              {erasedImage !== '' && (
                <img
                  className={styles.erased}
                  data-active={live ? 'true' : 'false'}
                  src={erasedImage}
                  alt=""
                  aria-hidden="true"
                  draggable={false}
                />
              )}

              {hotspots.map((region) => (
                <button
                  key={region.region_id}
                  type="button"
                  className={styles.hotspot}
                  style={bboxToPercent(region.bbox)}
                  aria-label={`激活此图示：${regionLabel(region)}`}
                  onClick={() => onActivate(region.region_id)}
                >
                  <span className={styles.badge} aria-hidden="true">
                    点击激活此图示
                  </span>
                </button>
              ))}

              {live && activeRegion !== null && RegionView !== null && (
                <>
                  <div
                    className={styles.dynamic}
                    style={bboxToPercent(activeRegion.bbox)}
                    data-active="true"
                  >
                    <RegionView
                      region={activeRegion}
                      params={params}
                      onChange={(patch) => onChangeParams(activeRegion.region_id, patch)}
                      stage={stage}
                      reducedMotion={reducedMotion}
                      onLinkedTexts={(texts) => onLinkedTexts(activeRegion.region_id, texts)}
                    />
                  </div>
                  <LinkedTextLayer
                    region={activeRegion}
                    params={params}
                    runtime={runtime}
                    scale={scale}
                  />
                </>
              )}

              {activeRegion !== null && resolution !== null && !resolution.supported && (
                <div className={styles.unsupported} role="status">
                  <p>{resolution.message}</p>
                  <p className={styles.unsupportedHint}>原页保持原样，数值表与计算步骤可在"详情"中查看。</p>
                  <button type="button" className={styles.unsupportedButton} onClick={onDeactivate}>
                    继续阅读原页
                  </button>
                </div>
              )}
            </div>
          );
        }}
      />

      {live ? (
        <p className={styles.modeTag} role="status">
          已激活：图示可拖动 / 调参，右侧文字同步
        </p>
      ) : null}
    </div>
  );
}