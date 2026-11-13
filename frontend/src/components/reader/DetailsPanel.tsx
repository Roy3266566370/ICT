/**
 * DetailsPanel.tsx —— 按需展开的"详情"次级面板（rebuild-spec §6）。
 *
 * 这里才是实现信息的容器：`revision`、`element_id`、bbox、模板标识等，
 * 主阅读区不出现它们。内容分节：来源 / 识别说明 / 数值表 / 检查 / 运行记录 /
 * 实现信息（默认折叠）。
 */
import { useMemo, useState, type ReactElement } from 'react';
import type { KnowledgeObject, RunSnapshot, ValidationReport } from '@/api/types';
import { ChecksPanel, RunsPanel } from '@/components/ui';
import { formatDateTime, formatSourceLocation, shortId } from '@/components/workbench/format';
import { CAPABILITIES } from '@/ispec/capabilities';
import type { PrimitiveKind, SharedGroup, SpecEvaluation } from '@/ispec/types';
import type { PageRegion } from '@/regions/types';
import type { RegionsState } from './regionData';
import { describeSharedConflict, describeSharedConsistency } from './sharedParamPool';
import type { SharedConsistencyItem } from './sharedParamPool';
import type { UnifiedParameterRow } from './unifiedSpecState';
import styles from './DetailsPanel.module.css';

export interface DetailsPanelProps {
  open: boolean;
  onClose: () => void;
  materialId: string;
  page: number;
  pageCount: number;
  region: PageRegion | null;
  regionMeta: RegionsState;
  object: KnowledgeObject | null;
  revision: number;
  dirty: boolean;
  params: Record<string, unknown>;
  /**
   * 「当前参数」表的唯一数据源（P0-02）。由 `useUnifiedSpecState` 提供：
   * 与图、文字、保存、校验读的是同一份合并值；缺省时回退到知识对象参数。
   */
  paramRows?: UnifiedParameterRow[];
  /** iSpec 约束的求值结果；用于让"校验"与当前参数保持同源。 */
  specEvaluation?: SpecEvaluation | null;
  /** §9-4 跨 iSpec 共享组中默认值冲突的组（需用户确认一个值）。 */
  sharedConflicts?: SharedGroup[];
  /** §9-4 跨 iSpec 一致性校验结果（`ok:false` 时提示取值不一致）。 */
  sharedConsistency?: SharedConsistencyItem[];
  /** 本页是否由 iSpec 通用运行时驱动（有 iSpec 时不再提示"未识别到交互区域"）。 */
  hasSpec?: boolean;
  /** 本材料出现过的原语类型（只读展示"扩展只需加 iSpec"的能力边界）。 */
  capabilityKinds?: PrimitiveKind[];
  checks: ValidationReport[];
  latestReport: ValidationReport | null;
  reportStale: boolean;
  runs: RunSnapshot[];
  checksLoading: boolean;
  runsLoading: boolean;
  runningChecks: boolean;
  busy: boolean;
  notice: string | null;
  onRunChecks: () => void;
  onSaveRun: () => void;
}

function extractTrace(result: unknown): { label: string; items: string[] } | null {
  if (result === null || typeof result !== 'object' || Array.isArray(result)) return null;
  const record = result as Record<string, unknown>;
  const trace = record['trace'];
  if (Array.isArray(trace)) return { label: '执行轨迹（trace）', items: trace.map((item) => JSON.stringify(item)) };
  const steps = record['steps'];
  if (Array.isArray(steps)) return { label: '计算步骤（steps）', items: steps.map((item) => JSON.stringify(item)) };
  const order = record['order'];
  if (Array.isArray(order)) return { label: '访问序列（order）', items: order.map((item) => String(item)) };
  return null;
}

function formatNumber(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  if (Math.abs(rounded - Math.round(rounded)) < 1e-9) return String(Math.round(rounded));
  return String(rounded);
}

function bboxText(bbox: { x: number; y: number; w: number; h: number }): string {
  return `${formatNumber(bbox.x)}, ${formatNumber(bbox.y)} · ${formatNumber(bbox.w)} × ${formatNumber(bbox.h)} 英寸`;
}

export function DetailsPanel(props: DetailsPanelProps): ReactElement {
  const {
    open,
    onClose,
    materialId,
    page,
    pageCount,
    region,
    regionMeta,
    object,
    revision,
    dirty,
    params,
    paramRows,
    hasSpec = false,
    capabilityKinds,
    specEvaluation,
    sharedConflicts,
    sharedConsistency,
    latestReport,
    reportStale,
    runs,
    checksLoading,
    runsLoading,
    runningChecks,
    busy,
    notice,
    onRunChecks,
    onSaveRun,
  } = props;

  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const activeRun = useMemo(
    () => runs.find((run) => run.run_id === activeRunId) ?? null,
    [runs, activeRunId],
  );
  const trace = activeRun === null ? null : extractTrace(activeRun.result);

  const sources = object?.source_refs ?? [];

  return (
    <>
      {open ? <div className={styles.backdrop} aria-hidden="true" onClick={onClose} /> : null}
      <aside
        className={styles.panel}
        data-open={open ? 'true' : 'false'}
        aria-hidden={!open}
        aria-label="详情：来源、识别说明、检查与运行记录"
      >
        <header className={styles.header}>
          <div>
            <h2 className={styles.title}>详情</h2>
            <p className={styles.subtitle}>
              第 {page} / {pageCount} 页 · revision {revision}
              {dirty ? ' · 有未保存改动' : ''}
            </p>
          </div>
          <button type="button" className={styles.close} onClick={onClose} aria-label="关闭详情面板">
            ×
          </button>
        </header>

        <div className={styles.scroll}>
          {notice !== null ? (
            <p className={styles.notice} role="status">
              {notice}
            </p>
          ) : null}

          <section className={styles.section} aria-label="来源">
            <h3 className={styles.sectionTitle}>来源</h3>
            {sources.length === 0 ? (
              <p className={styles.empty}>当前对象未声明来源（手工示例对象没有页码与元素框）。</p>
            ) : (
              <ul className={styles.sourceList}>
                {sources.map((source) => (
                  <li key={source.id} className={styles.sourceItem}>
                    <p className={styles.sourceLabel}>{source.label}</p>
                    <p className={styles.sourceMeta}>{formatSourceLocation(source)}</p>
                    {source.excerpt !== null ? <p className={styles.excerpt}>{source.excerpt}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={styles.section} aria-label="识别说明">
            <h3 className={styles.sectionTitle}>识别说明</h3>
            <p className={styles.metaLine}>
              区域数据：{regionMeta.loading ? '载入中…' : regionMeta.detail}
            </p>
            {!regionMeta.recognition.found && !hasSpec ? (
              <p className={styles.empty} role="status">
                未识别到交互区域（原因：{regionMeta.recognition.reason}）。本页只显示原文，不显示任何热点或参数。
              </p>
            ) : null}
            {region === null ? (
              hasSpec ? null : (
                <p className={styles.empty}>
                  本页未识别到可交互图示，按原文阅读；不会伪造交互，也不会覆盖原页。
                </p>
              )
            ) : (
              <>
                <p className={styles.metaLine}>
                  当前区域：{region.region_id} · 状态 {region.status} · 组件 {region.script_id}
                </p>
                {region.notes !== undefined ? <p className={styles.excerpt}>{region.notes}</p> : null}
                <p className={styles.metaLine}>区域范围：{bboxText(region.bbox)}</p>
              </>
            )}
            <p className={styles.metaLine}>材料：{materialId}</p>
          </section>

          <section className={styles.section} aria-label="原语类型">
            <h3 className={styles.sectionTitle}>本材料支持的原语类型</h3>
            {capabilityKinds === undefined || capabilityKinds.length === 0 ? (
              <p className={styles.empty}>材料暂未提供 iSpec，因此没有可展示的原语类型。</p>
            ) : (
              <ul className={styles.sourceList} data-capability-list>
                {capabilityKinds.map((kind) => {
                  const capability = CAPABILITIES[kind];
                  return (
                    <li key={kind} className={styles.sourceItem} data-capability={kind}>
                      <p className={styles.sourceLabel}>{capability.label}</p>
                      <p className={styles.sourceMeta}>{capability.views.join(' / ')}</p>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className={styles.metaLine}>新增知识点只需新增一份 iSpec，不改宿主组件。</p>
          </section>

          <section className={styles.section} aria-label="数值表">
            <h3 className={styles.sectionTitle}>数值表（当前参数）</h3>
            {paramRows !== undefined && paramRows.length > 0 ? (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">参数</th>
                      <th scope="col">值</th>
                      <th scope="col">单位</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paramRows.map((row) => (
                      <tr key={row.id} data-param-id={row.id} data-param-source={row.source}>
                        <th scope="row">{row.label}</th>
                        <td className={styles.mono}>{row.valueText}</td>
                        <td className={styles.mono}>{row.unit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : object === null ? (
              <p className={styles.empty}>该页暂无可运行的知识对象；图示参数可在右侧抽屉调整。</p>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">参数</th>
                      <th scope="col">值</th>
                    </tr>
                  </thead>
                  <tbody>
                    {object.parameters.map((parameter) => (
                      <tr key={parameter.id}>
                        <th scope="row">{parameter.name}</th>
                        <td className={styles.mono}>{JSON.stringify(parameter.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {sharedConflicts !== undefined && sharedConflicts.length > 0 ? (
              <ul className={styles.sourceList} data-shared-conflicts>
                {sharedConflicts.map((group) => (
                  <li key={group.shared_key} className={styles.sourceItem} role="alert">
                    <p className={styles.sourceLabel}>跨页共享参数冲突</p>
                    <p className={styles.sourceMeta}>{describeSharedConflict(group)}</p>
                  </li>
                ))}
              </ul>
            ) : null}
            {sharedConsistency !== undefined
              ? sharedConsistency
                  .filter((item) => !item.ok)
                  .map((item) => (
                    <p
                      key={`shared-consistency-${item.shared_key}`}
                      className={styles.metaLine}
                      role="alert"
                      data-shared-consistency={item.shared_key}
                    >
                      {describeSharedConsistency(item)}
                    </p>
                  ))
              : null}
            {specEvaluation !== undefined && specEvaluation !== null ? (
              <p className={styles.metaLine} role="status">
                当前参数约束：
                {specEvaluation.violations.length === 0
                  ? '全部通过'
                  : specEvaluation.violations
                      .map((violation) => `${violation.severity === 'error' ? '错误' : '警告'}：${violation.message}`)
                      .join('；')}
              </p>
            ) : null}
            {region !== null ? <pre className={styles.codeBlock}>{JSON.stringify(params, null, 2)}</pre> : null}
          </section>

          <section className={styles.section} aria-label="检查">
            <ChecksPanel
              report={latestReport}
              isStale={reportStale}
              onRun={onRunChecks}
              running={runningChecks}
            />
            {checksLoading ? <p className={styles.metaLine}>正在载入检查记录…</p> : null}
            {object === null ? <p className={styles.empty}>无对象时不能运行独立校验；阅读不受影响。</p> : null}
          </section>

          <section className={styles.section} aria-label="运行记录">
            <h3 className={styles.sectionTitle}>运行记录</h3>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.actionButton}
                onClick={onSaveRun}
                disabled={busy || object === null}
              >
                {busy ? '保存中…' : '保存本次运行'}
              </button>
            </div>
            {runsLoading ? <p className={styles.metaLine}>正在载入运行记录…</p> : null}
            <RunsPanel
              runs={runs}
              activeRunId={activeRunId}
              onSelect={(runId) => setActiveRunId(runId)}
              onRestore={(run) => setActiveRunId(run.run_id)}
            />
            {activeRun !== null ? (
              <div className={styles.replay}>
                <p className={styles.metaLine}>
                  {shortId(activeRun.run_id)} · {formatDateTime(activeRun.created_at)} · revision{' '}
                  {activeRun.revision}（只读回放，不会覆盖当前参数）
                </p>
                {trace !== null ? (
                  <>
                    <h4 className={styles.subTitle}>{trace.label}</h4>
                    <ol className={styles.traceList}>
                      {trace.items.map((item, index) => (
                        <li key={`${activeRun.run_id}-trace-${index}`}>
                          <code>{item}</code>
                        </li>
                      ))}
                    </ol>
                  </>
                ) : null}
                <pre className={styles.codeBlock}>{JSON.stringify(activeRun.result, null, 2)}</pre>
              </div>
            ) : null}
          </section>

          <details className={styles.impl}>
            <summary className={styles.implSummary}>实现信息（实现标识与坐标，默认折叠）</summary>
            <dl className={styles.implList}>
              <div>
                <dt>material_id</dt>
                <dd>{materialId}</dd>
              </div>
              <div>
                <dt>page</dt>
                <dd>{page}</dd>
              </div>
              <div>
                <dt>object_id</dt>
                <dd>{object?.object_id ?? '—'}</dd>
              </div>
              <div>
                <dt>model_version</dt>
                <dd>{object?.model_version ?? '—'}</dd>
              </div>
              <div>
                <dt>revision</dt>
                <dd>{revision}</dd>
              </div>
              <div>
                <dt>template_id</dt>
                <dd>{object?.template_id ?? '—'}</dd>
              </div>
              <div>
                <dt>region_id</dt>
                <dd>{region?.region_id ?? '—'}</dd>
              </div>
              <div>
                <dt>script_id</dt>
                <dd>{region?.script_id ?? '—'}</dd>
              </div>
              <div>
                <dt>status</dt>
                <dd>{region?.status ?? '—'}</dd>
              </div>
              <div>
                <dt>bbox</dt>
                <dd>{region === null ? '—' : bboxText(region.bbox)}</dd>
              </div>
              <div>
                <dt>view_box / origin / unit</dt>
                <dd>
                  {region === null
                    ? '—'
                    : `${region.coordinate_system.view_box.join(' × ')} / (${region.coordinate_system.origin.join(
                        ', ',
                      )}) / ${region.coordinate_system.unit}`}
                </dd>
              </div>
              <div>
                <dt>linked element_id</dt>
                <dd>
                  {region === null || region.linked_texts.length === 0
                    ? '—'
                    : region.linked_texts.map((text) => text.element_id).join(', ')}
                </dd>
              </div>
              <div>
                <dt>page_image / erased_image</dt>
                <dd>{region === null ? '—' : `${region.assets.page_image} / ${region.assets.erased_image}`}</dd>
              </div>
            </dl>
          </details>
        </div>
      </aside>
    </>
  );
}