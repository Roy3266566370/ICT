/**
 * 准备页中部：按页列出识别出的交互区域，支持确认 / 纠正 / 标为仅阅读。
 *
 * 布局依据 spec §2 第 5 条"转换结果可确认与纠正"：
 *  - 先给出**证据**（页缩略图 + 区域在页内的位置 + 来源页 + provenance）；
 *  - 再给出**动作**（改数值/单位/映射、确认、标为仅阅读）；
 *  - 不支持的区域保持原页静态阅读，界面必须明确说清楚。
 */
import { useMemo, useState, type CSSProperties, type ReactElement } from 'react';
import type { PageRegion, RegionStatus } from '@/regions/types';
import RegionCard from './RegionCard';
import {
  applyParamEdit,
  applyTemplateEdit,
  buildMappingRows,
  buildParamRows,
  isDraftEdited,
  readRegionProvenance,
  resetParam,
  resetTemplate,
  type RegionDraft,
} from './regionDrafts';
import { provenanceText } from './RegionParamTable';
import styles from './RegionConfirmationPanel.module.css';

/** 16:9 页面尺寸（英寸）：与渲染产物 1920×1080 对应。 */
const PAGE_WIDTH_INCHES = 13.3333;
const PAGE_HEIGHT_INCHES = 7.5;

export interface RegionConfirmationPanelProps {
  materialId: string | null;
  regions: PageRegion[];
  loading: boolean;
  /** 区域数据来源说明（fixtures / 演示 / 未提供） */
  sourceNote: string;
  disabled: boolean;
  /** 页码 → 整页图 URL */
  pageImageFor: (page: number) => string;
  onOpenPage: (page: number) => void;
  drafts: Record<string, RegionDraft>;
  onDraftChange: (regionId: string, draft: RegionDraft) => void;
  /** 深链：进入页面时自动展开的区域（如 `?expand=rgn_s18_det_area`）。 */
  initialExpandedId?: string | null;
}

interface PageGroup {
  page: number;
  regions: PageRegion[];
}

function groupByPage(regions: PageRegion[]): PageGroup[] {
  const map = new Map<number, PageRegion[]>();
  regions.forEach((region) => {
    const list = map.get(region.page);
    if (list === undefined) map.set(region.page, [region]);
    else list.push(region);
  });
  return [...map.entries()]
    .sort(([left], [right]) => left - right)
    .map(([page, list]) => ({ page, regions: list }));
}

/** 页图缩略图：加载失败时就地降级，不阻塞确认流程。 */
function PageThumb(props: { src: string; page: number; className?: string }): ReactElement {
  const { src, page, className } = props;
  const [failed, setFailed] = useState(false);
  if (src.length === 0 || failed) {
    return (
      <div className={[styles.thumbFallback, className ?? ''].join(' ')} role="img" aria-label={`第 ${page} 页无预览图`}>
        <span>第 {page} 页</span>
        <span className={styles.thumbFallbackNote}>页图未就绪</span>
      </div>
    );
  }
  return (
    <img
      className={className}
      src={src}
      alt={`第 ${page} 页整页图`}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

function statusSummary(regions: PageRegion[], drafts: Record<string, RegionDraft>): string {
  const counts: Record<RegionStatus, number> = { pending: 0, confirmed: 0, static_only: 0, unsupported: 0 };
  regions.forEach((region) => {
    const draft = drafts[region.region_id];
    counts[draft?.status ?? region.status] += 1;
  });
  const parts: string[] = [];
  if (counts.confirmed > 0) parts.push(`${counts.confirmed} 个可交互`);
  if (counts.pending > 0) parts.push(`${counts.pending} 个待确认`);
  if (counts.static_only > 0) parts.push(`${counts.static_only} 个仅阅读`);
  if (counts.unsupported > 0) parts.push(`${counts.unsupported} 个不支持`);
  return parts.join(' · ');
}

export function RegionConfirmationPanel(props: RegionConfirmationPanelProps): ReactElement {
  const {
    regions,
    loading,
    sourceNote,
    disabled,
    pageImageFor,
    onOpenPage,
    drafts,
    onDraftChange,
    initialExpandedId,
  } = props;
  const [expandedId, setExpandedId] = useState<string | null>(initialExpandedId ?? null);
  const groups = useMemo(() => groupByPage(regions), [regions]);

  if (loading && regions.length === 0) {
    return (
      <section className={styles.panel} aria-busy="true">
        <p className={styles.stateBox} role="status">
          正在读取识别区域…
        </p>
      </section>
    );
  }

  if (regions.length === 0) {
    return (
      <section className={styles.panel}>
        <div className={styles.emptyState} role="status">
          <h2 className={styles.emptyTitle}>没有识别到可交互区域</h2>
          <p className={styles.emptyText}>
            这不影响阅读：材料仍会以原版式打开，可以翻页与缩放。{sourceNote}
          </p>
          <p className={styles.emptyHint}>
            可能原因：本页图示由多形状拼成、与原页背景不可分离，或不属于首版支持的图示类型。
            不做"盖白块换通用图"，这类区域会保持原页静态阅读。
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.panel} aria-label="识别出的交互区域">
      <header className={styles.panelHead}>
        <h2 className={styles.panelTitle}>识别出的交互区域（按页）</h2>
        <p className={styles.panelNote}>{sourceNote}</p>
        <ul className={styles.statusLine} aria-label="区域状态统计">
          {groups.map((group) => (
            <li key={group.page}>
              第 {group.page} 页：{statusSummary(group.regions, drafts)}
            </li>
          ))}
        </ul>
      </header>

      {groups.map((group) => {
        const pageImage = pageImageFor(group.page);
        return (
          <div key={group.page} className={styles.pageGroup} data-page={group.page}>
            <div className={styles.pageHead}>
              <PageThumb src={pageImage} page={group.page} className={styles.pageImage} />
              <div className={styles.pageHeadMain}>
                <h3 className={styles.pageTitle}>第 {group.page} 页</h3>
                <p className={styles.pageMeta}>
                  共 {group.regions.length} 个识别区域 · {statusSummary(group.regions, drafts)}
                </p>
                <button type="button" className={styles.pageLink} onClick={() => onOpenPage(group.page)}>
                  在工作台打开第 {group.page} 页
                </button>
              </div>
            </div>

            <div className={styles.cards}>
              {group.regions.map((region) => {
                const draft = drafts[region.region_id];
                if (draft === undefined) return null;
                const expanded = expandedId === region.region_id;
                return (
                  <RegionCard
                    key={region.region_id}
                    region={region}
                    status={draft.status}
                    recognitionNote={recognitionNote(region, draft)}
                    thumbnail={
                      <>
                        <PageThumb src={pageImage} page={region.page} className={styles.regionImage} />
                        <span
                          className={styles.bboxBox}
                          style={bboxStyle(region)}
                          aria-hidden="true"
                          title="该区域在原页中的位置"
                        />
                      </>
                    }
                    expanded={expanded}
                    disabled={disabled}
                    paramRows={buildParamRows(region, draft)}
                    mappingRows={buildMappingRows(region, draft)}
                    actions={{
                      onToggle: () => setExpandedId(expanded ? null : region.region_id),
                      onEditValue: (key, text) => onDraftChange(region.region_id, applyParamEdit(region, draft, key, text)),
                      onEditUnit: (key, unit) => {
                        onDraftChange(region.region_id, {
                          ...draft,
                          units: { ...draft.units, [key]: unit },
                        });
                      },
                      onResetParam: (key) => onDraftChange(region.region_id, resetParam(region, draft, key)),
                      onEditTemplate: (elementId, template) =>
                        onDraftChange(region.region_id, applyTemplateEdit(draft, elementId, template)),
                      onResetTemplate: (elementId) =>
                        onDraftChange(region.region_id, resetTemplate(region, draft, elementId)),
                      onConfirm: () => onDraftChange(region.region_id, { ...draft, status: 'confirmed' }),
                      onStaticOnly: () => onDraftChange(region.region_id, { ...draft, status: 'static_only' }),
                      onOpenPage: () => onOpenPage(region.page),
                    }}
                  />
                );
              })}
            </div>
            {group.page === 18 && (
              <p className={styles.pageHint}>
                第 18 页是"行列式与面积"：四格分别对应 单位 / 拉伸 / 剪切 / 压缩，确认后可在工作台逐格调参并播放变化过程。
              </p>
            )}
            {sourceNote.includes('演示') && (
              <p className={styles.pageHint}>
                本页区域为演示数据（后端区域产物未就绪），仅用于走通"确认 / 纠正"流程；正式产物到达后自动替换。
              </p>
            )}
          </div>
        );
      })}
    </section>
  );
}

/** 区域框在页图上的百分比位置（只改容器尺寸，不改内部坐标）。 */
function bboxStyle(region: PageRegion): CSSProperties {
  return {
    left: `${((region.bbox.x / PAGE_WIDTH_INCHES) * 100).toFixed(3)}%`,
    top: `${((region.bbox.y / PAGE_HEIGHT_INCHES) * 100).toFixed(3)}%`,
    width: `${((region.bbox.w / PAGE_WIDTH_INCHES) * 100).toFixed(3)}%`,
    height: `${((region.bbox.h / PAGE_HEIGHT_INCHES) * 100).toFixed(3)}%`,
  };
}

/** 识别说明：后端备注 + 来源状态 + 区域在页面上的位置。 */
function recognitionNote(region: PageRegion, draft: RegionDraft): string {
  const provenance = readRegionProvenance(region);
  const parts: string[] = [];
  parts.push(
    `位于页面 ${region.bbox.x.toFixed(2)}, ${region.bbox.y.toFixed(2)} 英寸处，占 ${region.bbox.w.toFixed(2)} × ${region.bbox.h.toFixed(2)} 英寸。`,
  );
  parts.push(`参数来源：${provenanceText(provenance)}。`);
  if (isDraftEdited(draft)) parts.push('你已修正过这里的参数或映射。');
  if (region.notes !== undefined && region.notes.length > 0) parts.push(region.notes);
  return parts.join(' ');
}

export default RegionConfirmationPanel;