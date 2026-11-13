/**
 * 单个识别区域的确认/纠正卡片（准备页中部列表的基本单元）。
 *
 * 一张卡回答四件事：这是哪一页的哪块地方、现在是什么状态、识别到的参数是什么、我能改什么。
 */
import type { ReactElement, ReactNode } from 'react';
import type { PageRegion, RegionStatus } from '@/regions/types';
import RegionParamTable, { type RegionParamRow } from './RegionParamTable';
import RegionMappingList, { type RegionMappingRow } from './RegionMappingList';
import RegionStatusBadge from './RegionStatusBadge';
import styles from './RegionCard.module.css';

export interface RegionCardActions {
  onToggle: () => void;
  onEditValue: (key: string, text: string) => void;
  onEditUnit: (key: string, unit: string) => void;
  onResetParam: (key: string) => void;
  onEditTemplate: (elementId: string, template: string) => void;
  onResetTemplate: (elementId: string) => void;
  onConfirm: () => void;
  onStaticOnly: () => void;
  /** 在工作台打开该页（仅阅读） */
  onOpenPage: () => void;
}

export interface RegionCardProps {
  region: PageRegion;
  /** 当前（可能被用户改过的）状态 */
  status: RegionStatus;
  /** 识别说明：来自 region.notes + 前端补充的坐标系/来源提示 */
  recognitionNote: string;
  /** 页面缩略图（由页面注入，组件不直接依赖资源解析规则） */
  thumbnail: ReactNode;
  expanded: boolean;
  disabled: boolean;
  paramRows: RegionParamRow[];
  mappingRows: RegionMappingRow[];
  actions: RegionCardActions;
}

/** 区域组件的可读名称（识别说明的一部分，避免用户看到裸 script_id）。 */
const SCRIPT_LABELS: Record<string, string> = {
  det_area_2d: '行列式与面积（四格联动）',
  matrix_eigen_2d: '矩阵作用在向量上',
  matrix_columns_2d: '矩阵的列与基向量',
  matrix_order_2d: '乘法顺序对比',
  svd_steps_2d: 'SVD 三步分解',
};

export function scriptLabel(scriptId: string): string {
  return SCRIPT_LABELS[scriptId] ?? `未知组件（${scriptId}）`;
}

export function RegionCard(props: RegionCardProps): ReactElement {
  const { region, status, recognitionNote, thumbnail, expanded, disabled, paramRows, mappingRows, actions } =
    props;
  const statusEdited = status !== region.status;
  const unsupported = status === 'unsupported' || region.script_id === '' || !(region.script_id in SCRIPT_LABELS);

  return (
    <article className={styles.card} data-status={status} data-expanded={expanded ? 'true' : undefined}>
      <div className={styles.head}>
        <div className={styles.thumb} aria-hidden={thumbnail === null ? 'true' : undefined}>
          {thumbnail}
          <span className={styles.thumbPage}>第 {region.page} 页</span>
        </div>
        <div className={styles.headMain}>
          <h3 className={styles.title}>
            <span className={styles.titleText}>{scriptLabel(region.script_id)}</span>
            <span className={styles.regionId}>{region.region_id}</span>
          </h3>
          <div className={styles.badges}>
            <RegionStatusBadge status={status} />
            {statusEdited && <span className={styles.editedHint}>你已调整</span>}
            <span className={styles.pageTag}>属于第 {region.page} 页</span>
          </div>
          <p className={styles.note}>{recognitionNote}</p>
        </div>
        <button
          type="button"
          className={styles.expandButton}
          aria-expanded={expanded}
          onClick={actions.onToggle}
        >
          {expanded ? '收起参数' : '展开参数与纠正'}
        </button>
      </div>

      {expanded && (
        <div className={styles.body}>
          <section className={styles.section} aria-label="识别详情">
            <h4 className={styles.sectionTitle}>识别说明</h4>
            <dl className={styles.metaList}>
              <div>
                <dt>渲染组件</dt>
                <dd>
                  <code>{region.script_id}</code> · {scriptLabel(region.script_id)}
                </dd>
              </div>
              <div>
                <dt>区域位置</dt>
                <dd className={styles.mono}>
                  x {region.bbox.x.toFixed(2)} / y {region.bbox.y.toFixed(2)} / w {region.bbox.w.toFixed(2)} / h{' '}
                  {region.bbox.h.toFixed(2)} 英寸
                </dd>
              </div>
              <div>
                <dt>内部坐标系</dt>
                <dd className={styles.mono}>
                  viewBox {region.coordinate_system.view_box[0]}×{region.coordinate_system.view_box[1]} · 原点 (
                  {region.coordinate_system.origin[0]}, {region.coordinate_system.origin[1]}) · 单位{' '}
                  {region.coordinate_system.unit} · y 轴
                  {region.coordinate_system.y_axis === 'up' ? '向上' : '向下'}
                </dd>
              </div>
              <div>
                <dt>底图</dt>
                <dd className={styles.mono}>
                  {region.assets.page_image} → {region.assets.erased_image}
                </dd>
              </div>
              {region.notes !== undefined && region.notes.length > 0 && (
                <div>
                  <dt>后端备注</dt>
                  <dd>{region.notes}</dd>
                </div>
              )}
            </dl>
          </section>

          <section className={styles.section} aria-label="参数确认">
            <h4 className={styles.sectionTitle}>参数（名称 / 值 / 单位 / 来源页 / 来源状态）</h4>
            <RegionParamTable
              rows={paramRows}
              disabled={disabled}
              onEditValue={actions.onEditValue}
              onEditUnit={actions.onEditUnit}
              onResetParam={actions.onResetParam}
            />
          </section>

          <section className={styles.section} aria-label="文字映射">
            <h4 className={styles.sectionTitle}>跟随变化的原文文字（映射）</h4>
            <RegionMappingList
              rows={mappingRows}
              disabled={disabled}
              onEditTemplate={actions.onEditTemplate}
              onResetTemplate={actions.onResetTemplate}
            />
          </section>

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.primary}
              disabled={disabled || unsupported}
              onClick={actions.onConfirm}
            >
              确认为可交互
            </button>
            <button
              type="button"
              className={styles.secondary}
              disabled={disabled}
              onClick={actions.onStaticOnly}
            >
              标为仅静态阅读
            </button>
            <button type="button" className={styles.linkButton} onClick={actions.onOpenPage}>
              在工作台打开第 {region.page} 页
            </button>
            {unsupported && (
              <p className={styles.unsupported} role="note">
                该区域已识别但首版没有对应交互组件，只能保持静态阅读；不做"盖白块换通用图"。
              </p>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

export default RegionCard;