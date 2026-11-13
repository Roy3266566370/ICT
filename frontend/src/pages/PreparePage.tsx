/**
 * `/materials/:id/prepare` —— 识别区域与参数确认/纠正页（v0.3）。
 *
 * 与 v0.2 的差别（rebuild-spec §2 第 5 条）：
 *  - 中部从"候选参数表格"改为**按页列出识别出的交互区域**：页缩略图 + 区域位置 + 状态 + 识别说明；
 *  - 每个区域可展开，改参数值 / 单位 / 文字映射，并"确认为可交互"或"标为仅静态阅读"；
 *  - 没有知识对象、没有区域时**不阻断**阅读：底部始终可以"仅阅读模式"进入工作台；
 *  - 旧的知识对象确认 / 编译能力保留在折叠区，不做功能回退。
 *
 * 数据来源（只读组合，未改 `src/api`）：
 *  1. 材料详情里可能下发的 `regions`（后端扩展字段，按契约解析）；
 *  2. `GET /fixtures/regions/<material_id>.json`（渲染产物，见 `components/reader/regionData`）；
 *  3. 演示区域（仅课程材料，界面明确标注），保证后端就绪前也能走通确认流程。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { errorMessage } from '@/api/client';
import {readEmbeddedSpecs} from '@/components/reader/specData';
import {ConversionReview} from '@/components/presentation/ConversionReview';
import { usePatchMaterialRegion } from '@/api/hooks';
import type {
  CandidateObject,
  JobStage,
  KnowledgeObject,
  MaterialStatus,
  MaterialSummary,
  Parameter,
  RegionOverridePatch,
} from '@/api/types';
import CandidateTable, {
  type CandidateParameterRow,
  type CandidateRelationRow,
} from '@/components/workbench/CandidateTable';
import ConflictDialog, { type ConflictDetail } from '@/components/workbench/ConflictDialog';
import {
  formatDateTime,
  formatParameterValue,
  formatRange,
  formatRelativeTime,
  parseParameterValueText,
  pickPrimaryProvenance,
} from '@/components/workbench/format';
import { buildCandidateRelations } from '@/components/workbench/relations';
import {
  describeFailure,
  isVersionConflict,
  templateLabel,
  toApiFailure,
  useMaterialView,
  useWorkbenchActions,
  type ApiFailure,
} from '@/components/workbench/workbenchData';
import { isExampleMaterial, pageImageFor, parsePageRegions, usePageRegions } from '@/components/reader/regionData';
import { useMaterialSpecs } from '@/components/reader/specData';
import {
  RegionConfirmationPanel,
  extraDemoRegions,
  useRegionDrafts,
  type RegionDraft,
} from '@/components/regions';
import type { PageRegion, RegionStatus } from '@/regions/types';
import styles from './PreparePage.module.css';

/** 状态机阶段（§2.2.7 `JobStage`，顺序与后端迁移一致）。 */
const MATERIAL_STAGES: { id: JobStage; label: string }[] = [
  { id: 'queued', label: '排队等待' },
  { id: 'parsing', label: '解析页面结构' },
  { id: 'rendering', label: '原页生成中' },
  { id: 'extracting', label: '交互识别中' },
  { id: 'awaiting_confirmation', label: '需要核对' },
  { id: 'compiling', label: '交互编译中' },
  { id: 'validating', label: '一致性校验中' },
  { id: 'ready', label: '可交互' },
];

const MATERIAL_STATUS_TEXT: Record<MaterialStatus, string> = {
  processing: '处理中',
  awaiting_confirmation: '等待确认',
  ready: '可阅读',
  failed: '失败',
};

/** 区域改动的服务端保存延迟：连续键入合并成一次 PATCH，避免每键一次请求。 */
const REGION_SYNC_DEBOUNCE_MS = 500;

/* -------------------------------------------------------------------------- */
/* 只读收窄：后端可能新增、但前端契约尚未声明的字段                            */
/* -------------------------------------------------------------------------- */

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** 材料详情里的区域列表（后端扩展字段；不存在时返回空数组）。 */
function readEmbeddedRegions(detail: unknown): PageRegion[] {
  const record = asRecord(detail);
  if (record === null) return [];
  return parsePageRegions(record['regions']);
}

/** 渲染引擎 / 保真度：由渲染任务产出，缺失时明确显示"未标注"，不做推断。 */
function readRenderInfo(material: MaterialSummary): { engine: string | null; fidelity: string | null } {
  const record = asRecord(material);
  const engine = record === null ? null : record['render_engine'];
  const fidelity = record === null ? null : record['fidelity'];
  return {
    engine: typeof engine === 'string' && engine.length > 0 ? engine : null,
    fidelity: typeof fidelity === 'string' && fidelity.length > 0 ? fidelity : null,
  };
}

/** 文件名：优先 `source_filename`（后端扩展字段），否则用标题。 */
function readFileName(material: MaterialSummary): string | null {
  const record = asRecord(material);
  const name = record === null ? null : record['source_filename'];
  return typeof name === 'string' && name.length > 0 ? name : null;
}

const ENGINE_TEXT: Record<string, string> = {
  powerpoint_com: 'PowerPoint（COM）',
  libreoffice: 'LibreOffice',
  svg_fallback: '结构化 SVG 还原（兜底）',
};

const FIDELITY_TEXT: Record<string, string> = {
  high: '高（与原版式一致）',
  medium: '中',
  low: '低（可能与原文版式有差异）',
};

/* -------------------------------------------------------------------------- */
/* 知识对象（折叠区）的纯函数：沿用 v0.2 的确认能力                            */
/* -------------------------------------------------------------------------- */

function deriveCandidateFromObject(object: KnowledgeObject): CandidateObject {
  return {
    candidate_id: `derived:${object.object_id}`,
    template_id: object.template_id,
    confidence_hint: 'medium',
    fields: object.parameters.map((parameter) => ({
      parameter_id: parameter.id,
      name: parameter.name,
      status: parameter.provenance === 'inferred' ? 'inferred' : 'present',
    })),
  };
}

function mergeConfirmedParameters(base: KnowledgeObject, rows: CandidateParameterRow[]): KnowledgeObject {
  const parameters: Parameter[] = base.parameters.map((parameter) => {
    const row = rows.find((candidateRow) => candidateRow.parameterId === parameter.id);
    if (!row) return parameter;
    const parsed = parseParameterValueText(parameter.type, row.valueText);
    if (!parsed.ok) return parameter;
    return {
      ...parameter,
      value: parsed.value,
      provenance: row.confirmed ? ('user_confirmed' as const) : parameter.provenance,
    };
  });
  return { ...base, parameters };
}

/** 区域状态统计（底部操作条使用）。 */
function countStatuses(regions: PageRegion[], drafts: Record<string, RegionDraft>): Record<RegionStatus, number> {
  const counts: Record<RegionStatus, number> = { pending: 0, confirmed: 0, static_only: 0, unsupported: 0 };
  regions.forEach((region) => {
    counts[drafts[region.region_id]?.status ?? region.status] += 1;
  });
  return counts;
}

/**
 * 进入工作台时定位哪个区域：
 *  1. 用户刚刚操作过的区域（改过参数或点过确认/仅阅读）—— 这是交互预期；
 *  2. 否则第一个已确认区域；
 *  3. 否则第一个待确认区域。
 */
function specCoverageNote(reason: string): string {
  const trimmed = reason.trim();
  if (!trimmed || /^(正在读取|已读取|读取 iSpec)/.test(trimmed)) return '';
  return trimmed;
}

function pickTargetRegion(
  regions: PageRegion[],
  drafts: Record<string, RegionDraft>,
  preferredRegionId: string | null,
): PageRegion | null {
  if (preferredRegionId !== null) {
    const touched = regions.find((region) => region.region_id === preferredRegionId);
    if (touched !== undefined) return touched;
  }
  const confirmed = regions.find((region) => (drafts[region.region_id]?.status ?? region.status) === 'confirmed');
  if (confirmed !== undefined) return confirmed;
  return regions.find((region) => (drafts[region.region_id]?.status ?? region.status) === 'pending') ?? null;
}

/* -------------------------------------------------------------------------- */
/* 页面                                                                        */
/* -------------------------------------------------------------------------- */

export function PreparePage(): ReactElement {
  const params = useParams<{ materialId?: string; id?: string }>();
  const materialId = params.materialId ?? params.id ?? null;
  const navigate = useNavigate();
  // 深链：`?expand=<region_id>` 直接展开某个区域（供工作台"详情"与文档链接使用）
  const [searchParams] = useSearchParams();
  const initialExpandedRegion = searchParams.get('expand');

  const materialView = useMaterialView(materialId);
  const detail = materialView.data;
  const actions = useWorkbenchActions();
  const regionState = usePageRegions(materialId);
  const specMeta = useMaterialSpecs(materialId, detail ?? null);

  /* ---------------- 区域数据：详情内嵌 → fixtures 产物 → 演示 ---------------- */

  const embeddedRegions = useMemo(() => readEmbeddedRegions(detail), [detail]);
  const realRegions = embeddedRegions.length > 0 ? embeddedRegions : regionState.regions;
  const regionsAreReal = embeddedRegions.length > 0 || regionState.source === 'fixtures';
  const regions = useMemo<PageRegion[]>(
    () => (regionsAreReal ? realRegions : [...realRegions, ...extraDemoRegions(materialId, realRegions)]),
    [realRegions, regionsAreReal, materialId],
  );
  const regionSourceNote = useMemo(() => {
    if (embeddedRegions.length > 0) return `区域数据：材料详情下发 ${embeddedRegions.length} 个区域。`;
    if (regionsAreReal) return regionState.detail;
    if (isExampleMaterial(materialId)) {
      return `${regionState.detail}；示例材料额外展示演示区域（仅示例可用）。`;
    }
    return `${regionState.detail}；未启用任何示例/演示区域。`;
  }, [embeddedRegions.length, regionsAreReal, regionState.detail, materialId]);

  const { drafts, updateDraft, resetAll } = useRegionDrafts(materialId, regions);
  /** 用户最近操作过的区域：决定"确认并进入工作台"后定位到哪一页 */
  const [lastTouchedRegionId, setLastTouchedRegionId] = useState<string | null>(null);

  /* ---------------- 区域确认/纠正 → 服务端持久化（P2 追加端点） ---------------- */

  const patchRegion = usePatchMaterialRegion();
  const [regionSyncError, setRegionSyncError] = useState<string | null>(null);
  const regionsById = useMemo(
    () => new Map(regions.map((region) => [region.region_id, region] as const)),
    [regions],
  );
  /** 待发送的草稿（按区域合并，只发最后一份） */
  const pendingSyncRef = useRef<Map<string, { region: PageRegion; draft: RegionDraft }>>(new Map());
  const timersRef = useRef<Map<string, number>>(new Map());
  const materialIdRef = useRef<string | null>(materialId);
  materialIdRef.current = materialId;

  /**
   * 把草稿差异整理成 PATCH 体：
   *  - `parameter_overrides` 只含 `editedKeys` 里的键（不把未确认的推断值写回）；
   *  - `status` 只在用户明确点过"确认/仅阅读"时传（pending 不落盘）。
   */
  const syncRegionOverride = useCallback(
    async (regionId: string): Promise<void> => {
      const pending = pendingSyncRef.current.get(regionId);
      const currentMaterialId = materialIdRef.current;
      if (pending === undefined || currentMaterialId === null) return;
      pendingSyncRef.current.delete(regionId);

      const { region, draft } = pending;
      const overrides: Record<string, unknown> = {};
      Object.keys(draft.editedKeys).forEach((key) => {
        if (draft.params[key] !== undefined) overrides[key] = draft.params[key];
      });
      const confirmStatus: RegionOverridePatch['status'] =
        draft.status === 'confirmed'
          ? 'confirmed'
          : draft.status === 'static_only'
            ? 'static_only'
            : undefined;
      if (confirmStatus === undefined && Object.keys(overrides).length === 0) return;

      const patch: RegionOverridePatch = { parameter_overrides: overrides };
      if (confirmStatus !== undefined) patch.status = confirmStatus;
      try {
        await patchRegion.mutateAsync({ materialId: currentMaterialId, regionId, patch });
        setRegionSyncError(null);
      } catch (error) {
        // 失败不清空本地草稿（sessionStorage 仍有兜底），只给中文提示
        setRegionSyncError(
          `区域「${region.region_id}」的确认未能保存到服务器：${errorMessage(error)}。已保留本地草稿，可继续确认或稍后重试。`,
        );
      }
    },
    [patchRegion],
  );

  const scheduleRegionSync = useCallback(
    (region: PageRegion, draft: RegionDraft): void => {
      pendingSyncRef.current.set(region.region_id, { region, draft });
      const existingTimer = timersRef.current.get(region.region_id);
      if (existingTimer !== undefined) window.clearTimeout(existingTimer);
      timersRef.current.set(
        region.region_id,
        window.setTimeout(() => {
          timersRef.current.delete(region.region_id);
          void syncRegionOverride(region.region_id);
        }, REGION_SYNC_DEBOUNCE_MS),
      );
    },
    [syncRegionOverride],
  );

  const cancelPendingSync = useCallback((): void => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current.clear();
    pendingSyncRef.current.clear();
  }, []);

  /** 跳转前把待发送的改动全部落库（保证工作台读到新值）。 */
  const flushRegionSync = useCallback(async (): Promise<void> => {
    const regionIds = [...pendingSyncRef.current.keys()];
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current.clear();
    await Promise.all(regionIds.map((regionId) => syncRegionOverride(regionId)));
  }, [syncRegionOverride]);

  useEffect(() => () => cancelPendingSync(), [cancelPendingSync]);

  /** "恢复全部原始参数"：本地重建草稿 + 清除服务端覆盖（空 overrides = 删除记录）。 */
  const handleResetAll = useCallback((): void => {
    cancelPendingSync();
    resetAll();
    if (materialId === null) return;
    regions.forEach((region) => {
      void patchRegion
        .mutateAsync({
          materialId,
          regionId: region.region_id,
          patch: { parameter_overrides: {} },
        })
        .catch(() => {
          setRegionSyncError(
            `区域「${region.region_id}」的服务端确认未能清除：请检查服务连接后重试。`,
          );
        });
    });
  }, [cancelPendingSync, materialId, patchRegion, regions, resetAll]);

  /* ---------------- 页缩略图 ---------------- */

  const pageImageForPage = useMemo(
    () => (page: number): string => {
      const slide = detail?.slides.find((item) => item.page_no === page) ?? null;
      const region = regions.find((item) => item.page === page) ?? null;
      return pageImageFor(page, slide?.image_url ?? null, region);
    },
    [detail?.slides, regions],
  );

  /* ---------------- 知识对象（折叠区） ---------------- */

  const [objectSectionOpen, setObjectSectionOpen] = useState(false);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [confirmedRows, setConfirmedRows] = useState<Record<string, boolean>>({});
  const [rowEdits, setRowEdits] = useState<Record<string, string>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string | null>>({});
  const [confirmedRelations, setConfirmedRelations] = useState<Record<string, boolean>>({});

  const backendCandidates = detail?.candidates;
  const candidates = useMemo<CandidateObject[]>(() => {
    if (backendCandidates !== undefined && backendCandidates.length > 0) return backendCandidates;
    return (detail?.objects ?? []).map(deriveCandidateFromObject);
  }, [backendCandidates, detail?.objects]);
  const derivedCandidate = (backendCandidates?.length ?? 0) === 0 && candidates.length > 0;

  const candidate = useMemo<CandidateObject | null>(() => {
    if (candidates.length === 0) return null;
    return candidates.find((item) => item.candidate_id === selectedCandidateId) ?? candidates[0] ?? null;
  }, [candidates, selectedCandidateId]);

  const object = useMemo<KnowledgeObject | null>(() => {
    if (!detail) return null;
    if (!candidate) return detail.objects[0] ?? null;
    return detail.objects.find((item) => item.template_id === candidate.template_id) ?? detail.objects[0] ?? null;
  }, [detail, candidate]);

  const rows = useMemo<CandidateParameterRow[]>(() => {
    if (!candidate) return [];
    return candidate.fields.map((field) => {
      const key = `${candidate.candidate_id}:${field.parameter_id}`;
      const parameter = object?.parameters.find((item) => item.id === field.parameter_id);
      const sourceRefs = parameter
        ? (object?.source_refs ?? []).filter((source) => parameter.source_ref_ids.includes(source.id))
        : [];
      const provenance = parameter
        ? pickPrimaryProvenance([parameter.provenance, ...sourceRefs.map((source) => source.provenance)])
        : null;
      const sourcePage = sourceRefs.find((source) => source.page !== null)?.page ?? null;
      const baseValueText = parameter ? formatParameterValue(parameter.type, parameter.value) : '';
      return {
        key,
        candidateId: candidate.candidate_id,
        parameterId: field.parameter_id,
        name: field.name,
        type: parameter?.type ?? 'text',
        valueText: rowEdits[key] ?? baseValueText,
        unit: parameter?.unit ?? '1',
        rangeText: parameter ? formatRange(parameter.range, parameter.unit) : '未知（字段缺失）',
        sourcePage,
        provenance,
        fieldStatus: field.status,
        confirmed: confirmedRows[key] === true,
        error: rowErrors[key] ?? null,
        editable: parameter !== undefined && parameter.editable,
      };
    });
  }, [candidate, object, confirmedRows, rowEdits, rowErrors]);

  const relations = useMemo<CandidateRelationRow[]>(
    () => (candidate && object ? buildCandidateRelations(candidate, object, confirmedRelations) : []),
    [candidate, object, confirmedRelations],
  );

  const missingCount = rows.filter((row) => row.fieldStatus === 'missing').length;
  const invalidCount = rows.filter((row) => row.error !== null).length;

  /* ---------------- 提交与跳转 ---------------- */

  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ConflictDetail | null>(null);

  function handleToggleRow(key: string): void {
    setConfirmedRows((previous) => ({ ...previous, [key]: !previous[key] }));
  }

  function handleToggleAll(checked: boolean): void {
    const next: Record<string, boolean> = {};
    rows.forEach((row) => {
      next[row.key] = checked;
    });
    setConfirmedRows(next);
  }

  function handleEditValue(key: string, text: string): void {
    setRowEdits((previous) => ({ ...previous, [key]: text }));
    const row = rows.find((item) => item.key === key);
    if (!row) return;
    const parsed = parseParameterValueText(row.type, text);
    setRowErrors((previous) => ({ ...previous, [key]: parsed.ok ? null : parsed.message }));
  }

  function handleToggleRelation(key: string): void {
    setConfirmedRelations((previous) => ({ ...previous, [key]: !previous[key] }));
  }

  /** 工作台（仅阅读）跳转：不带区域，只定位页。 */
  function openSourcePage(page: number): void {
    if (!materialId) return;
    const objectQuery = object ? `&object=${encodeURIComponent(object.object_id)}` : '';
    navigate(`/materials/${materialId}/work?view=source&page=${page}&from=prepare${objectQuery}`, {
      state: { from: 'prepare' },
    });
  }

  /** 进入可交互视图：带 `page` 与 `region`，参数快照已按区域写入会话存储。 */
  function enterInteractive(target: PageRegion | null): void {
    if (!materialId) return;
    const query: string[] = ['view=interactive', 'from=prepare'];
    if (target !== null) {
      query.push(`page=${target.page}`);
      query.push(`region=${encodeURIComponent(target.region_id)}`);
    } else {
      query.push(`page=${regions[0]?.page ?? 1}`);
    }
    if (object) query.push(`object=${encodeURIComponent(object.object_id)}`);
    navigate(`/materials/${materialId}/work?${query.join('&')}`, { state: { from: 'prepare' } });
  }

  /** 仅阅读模式：任何情况下都可用（spec §0：无知识对象也能读原文）。 */
  function enterReadOnly(): void {
    if (!materialId) return;
    const target = regions[0] ?? null;
    const objectQuery = object ? `&object=${encodeURIComponent(object.object_id)}` : '';
    const pageQuery = target === null ? '&page=1' : `&page=${target.page}`;
    navigate(`/materials/${materialId}/work?view=source&from=prepare${pageQuery}${objectQuery}`, {
      state: { from: 'prepare' },
    });
  }

  /**
   * 确认并进入。
   * 1) 若有知识对象：沿用 v0.2 的 #13 保存 + #14 编译（失败只提示，不阻断阅读）；
   * 2) 跳转到工作台，带 page / region。
   */
  async function handleEnter(): Promise<void> {
    if (!materialId) return;
    const target = pickTargetRegion(regions, drafts, lastTouchedRegionId);
    setBusy(true);
    setFailure(null);
    setNotice(null);

    // 先把准备页的区域确认/纠正落库，否则工作台只会读到识别基线
    await flushRegionSync();

    if (object !== null) {
      try {
        const nextObject = mergeConfirmedParameters(object, rows);
        const saved = await actions.confirmModel({
          objectId: object.object_id,
          expectedVersion: object.model_version,
          object: nextObject,
        });
        const jobId = await actions.compileObject({
          objectId: saved.object_id,
          modelVersion: saved.model_version,
        });
        setNotice(`已保存知识对象确认并提交编译（任务 ${jobId}）。`);
      } catch (error) {
        if (isVersionConflict(error)) {
          const failureInfo = toApiFailure(error);
          setConflict({
            message: failureInfo.message,
            localModelVersion: object.model_version,
            localRevision: object.revision,
            serverModelVersion: null,
            serverRevision: null,
            operation: '确认并进入工作台',
          });
          setBusy(false);
          return;
        }
        // 候选对象保存失败不阻断：区域确认与原文阅读仍可继续
        setFailure(toApiFailure(error));
      }
    }

    setBusy(false);
    enterInteractive(target);
  }

  async function handleReloadAndConfirm(): Promise<void> {
    setBusy(true);
    try {
      await materialView.refetch();
    } catch (error) {
      setFailure(toApiFailure(error));
    } finally {
      setConflict(null);
      setBusy(false);
    }
  }

  /* ---------------- 渲染：加载 / 错误 / 缺失 ---------------- */

  if (!materialId) {
    return (
      <main className={`${styles.page} studio-scope`}>
        <p className={styles.stateBox} role="alert">
          缺少材料编号，无法进入准备页。<Link to="/">返回首页</Link>
        </p>
      </main>
    );
  }

  if (materialView.loading && detail === null) {
    return (
      <main className={`${styles.page} studio-scope`} aria-busy="true">
        <p className={styles.stateBox} role="status">
          正在读取材料与识别区域…
        </p>
      </main>
    );
  }

  if (materialView.error !== null && detail === null) {
    return (
      <main className={`${styles.page} studio-scope`}>
        <div className={styles.stateBox} role="alert">
          <p>{describeFailure(materialView.error)}</p>
          <p className={styles.stateActions}>
            <Link to="/">返回首页</Link>
            <button type="button" className={styles.textButton} onClick={() => void materialView.refetch()}>
              重新载入
            </button>
          </p>
        </div>
      </main>
    );
  }

  if (!detail) {
    return (
      <main className={`${styles.page} studio-scope`}>
        <p className={styles.stateBox} role="status">
          材料不可用或不属于当前会话。<Link to="/">返回首页</Link>
        </p>
      </main>
    );
  }

  const { material } = detail;
  const generatedSpecs=readEmbeddedSpecs(detail);
  if(generatedSpecs.length && materialId) return <ConversionReview materialId={materialId} title={material.title}
    pageCount={material.page_count} specs={generatedSpecs}/>;
  const job = detail.job;
  const stageIndex = job ? MATERIAL_STAGES.findIndex((stage) => stage.id === job.stage) : -1;
  const renderInfo = readRenderInfo(material);
  const fileName = readFileName(material);
  const statusCounts = countStatuses(regions, drafts);
  const interactiveCount = statusCounts.confirmed + statusCounts.pending;
  const targetRegion = pickTargetRegion(regions, drafts, lastTouchedRegionId);
  const canConfirmObject = object !== null && rows.length > 0 && missingCount === 0 && invalidCount === 0 && !busy;

  return (
    <main className={`${styles.page} studio-scope`}>
      <header className={styles.pageHead}>
        <div className={styles.headMain}>
          <nav className={styles.breadcrumb} aria-label="面包屑">
            <Link className={styles.back} to="/">
              首页
            </Link>
            <span className={styles.crumbSep} aria-hidden="true">
              /
            </span>
            <Link className={styles.back} to={`/materials/${materialId}/prepare`}>
              {fileName ?? material.title}
            </Link>
            <span className={styles.crumbSep} aria-hidden="true">
              /
            </span>
            <span className={styles.crumbCurrent} aria-current="page">
              准备
            </span>
          </nav>
          <h1 className={styles.pageTitle}>识别区域与参数确认</h1>
          <p className={styles.pageSubtitle}>
            先核对"识别到的区域"和"识别到的参数"，识别错了可以改；不支持的图示会明确标为仅静态阅读，不会被硬盖成通用图。
          </p>
        </div>
        <div className={styles.headAside}>
          <span className={styles.statusChip} data-status={material.status}>
            {MATERIAL_STATUS_TEXT[material.status]}
          </span>
          <button type="button" className={styles.textButton} onClick={enterReadOnly}>
            直接以仅阅读模式进入工作台
          </button>
        </div>
      </header>

      {/* 顶部：材料卡片（文件名 / 页数 / 渲染引擎 / 保真度 / 状态） */}
      <section className={styles.materialCard} aria-label="材料信息">
        <div className={styles.materialMain}>
          <h2 className={styles.materialTitle}>{fileName ?? material.title}</h2>
          {fileName !== null && material.title !== fileName && (
            <p className={styles.materialSub}>{material.title}</p>
          )}
          <dl className={styles.metaGrid}>
            <div>
              <dt>页数</dt>
              <dd>{material.page_count} 页</dd>
            </div>
            <div>
              <dt>渲染引擎</dt>
              <dd>{renderInfo.engine === null ? '未标注（后端未下发）' : (ENGINE_TEXT[renderInfo.engine] ?? renderInfo.engine)}</dd>
            </div>
            <div>
              <dt>保真度</dt>
              <dd>{renderInfo.fidelity === null ? '未标注（后端未下发）' : (FIDELITY_TEXT[renderInfo.fidelity] ?? renderInfo.fidelity)}</dd>
            </div>
            <div>
              <dt>材料状态</dt>
              <dd>{MATERIAL_STATUS_TEXT[material.status]}</dd>
            </div>
            <div>
              <dt>知识对象</dt>
              <dd>{material.object_count} 个</dd>
            </div>
            <div>
              <dt>上传 / 到期</dt>
              <dd title={`${material.created_at} → ${material.expires_at}`}>
                {formatDateTime(material.created_at)}（{formatRelativeTime(material.created_at)}）
                <br />
                到期 {formatDateTime(material.expires_at)}（{formatRelativeTime(material.expires_at)}）
              </dd>
            </div>
            <div>
              <dt>材料编号</dt>
              <dd className={styles.mono}>{material.material_id}</dd>
            </div>
            <div>
              <dt>识别区域</dt>
              <dd>{regions.length} 个（可交互 {statusCounts.confirmed} · 待确认 {statusCounts.pending} · 仅阅读 {statusCounts.static_only} · 不支持 {statusCounts.unsupported}）</dd>
            </div>
          </dl>
        </div>

        <div className={styles.progressCard} aria-label="解析与确认进度">
          <p className={styles.progressTitle}>
            处理进度
            {job !== null && (
              <span className={styles.progressMeta}>
                第 {job.attempt} 次尝试 · {job.stage === 'failed' ? '处理失败' : MATERIAL_STAGES.find(stage => stage.id === job.stage)?.label ?? '处理中'}
              </span>
            )}
          </p>
          {job?.error != null && (
            <p className={styles.progressError} role="alert">
              {job.stage} 阶段失败：{job.error.code} — {job.error.message}
            </p>
          )}
          <ol className={styles.stages}>
            {MATERIAL_STAGES.map((stage, index) => {
              const isFailed = job?.stage === 'failed';
              const state =
                stageIndex < 0
                  ? 'pending'
                  : index < stageIndex
                    ? 'done'
                    : index === stageIndex
                      ? isFailed
                        ? 'failed'
                        : 'current'
                      : 'pending';
              return (
                <li key={stage.id} className={styles.stage} data-state={state}>
                  <span className={styles.stageMark} aria-hidden="true">
                    {state === 'done' ? '✓' : state === 'failed' ? '!' : state === 'current' ? '›' : '·'}
                  </span>
                  <span className={styles.stageLabel}>{stage.label}</span>
                  <span className={styles.stageState}>
                    {state === 'done'
                      ? '已完成'
                      : state === 'current'
                        ? '进行中'
                        : state === 'failed'
                          ? '失败'
                          : '待开始'}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      </section>

      {/* 明确提示：三条规则用户必须看到 */}
      <section className={styles.hintBox} aria-label="确认须知">
        <p>
          <strong>同名符号 / 相似图形不会自动合并</strong>：每个区域都单独列出，需你逐条确认，避免把两处不同的图当成同一个。
        </p>
        <p>
          <strong>识别错了可以在这里改</strong>：参数值、单位、跟随变化的原文文字都能修正；改过的项会标"已修改"。
        </p>
        <p>
          <strong>不支持的内容会标为仅阅读</strong>：不可分离或没有对应组件的区域保持原页，不会被替换成通用图。
        </p>
      </section>

      {/* 中部：按页列出识别出的交互区域；识别为空时明确说明原因，不展示示例区域 */}
      {regionState.loading && regions.length === 0 ? (
        <section className={styles.missingRegions} aria-busy="true">
          <p role="status">正在读取识别区域…</p>
        </section>
      ) : regions.length === 0 ? (
        <section className={styles.missingRegions} aria-label="未识别到交互区域">
          <h2 className={styles.missingTitle}>未识别到交互区域</h2>
          <p className={styles.missingReason} role="status">
            原因：{regionState.recognition.reason}
          </p>
          {specCoverageNote(specMeta.recognition.reason) !== '' && (
            <p className={styles.missingReason} role="status">
              识别结论：{specCoverageNote(specMeta.recognition.reason)}
            </p>
          )}
          <p className={styles.missingHint}>
            这不影响阅读：材料仍会以原版式打开，可以翻页与缩放。系统不会为这份材料展示任何示例区域、
            热点或参数，也不会"盖白块换通用图"。
          </p>
          <button type="button" className={styles.secondary} disabled={busy} onClick={enterReadOnly}>
            仅阅读模式进入
          </button>
        </section>
      ) : (
        <RegionConfirmationPanel
          materialId={materialId}
          regions={regions}
          loading={regionState.loading}
          sourceNote={regionSourceNote}
          disabled={busy}
          pageImageFor={pageImageForPage}
          onOpenPage={openSourcePage}
          drafts={drafts}
          onDraftChange={(regionId, draft) => {
            setLastTouchedRegionId(regionId);
            // sessionStorage 仍即时写入（离线兜底）；服务端保存按 500ms 合并去抖
            updateDraft(regionId, () => draft);
            const region = regionsById.get(regionId);
            if (region !== undefined) scheduleRegionSync(region, draft);
          }}
          initialExpandedId={initialExpandedRegion}
        />
      )}

      {/* 次级：知识对象确认（v0.2 能力保留，默认折叠） */}
      <section className={styles.objectSection} aria-label="知识对象确认">
        <div className={styles.objectHead}>
          <h2 className={styles.objectTitle}>知识对象参数（可选）</h2>
          <p className={styles.objectNote}>
            这里的参数属于工作台知识对象（区别于上面的"识别区域"）。没有知识对象时不影响阅读与区域确认。
          </p>
          <button
            type="button"
            className={styles.objectToggle}
            aria-expanded={objectSectionOpen}
            onClick={() => setObjectSectionOpen((previous) => !previous)}
          >
            {objectSectionOpen ? '收起' : '展开'}
          </button>
        </div>

        {objectSectionOpen && (
          <div className={styles.objectBody}>
            {object === null ? (
              <p className={styles.objectEmpty} role="status">
                当前材料没有知识对象：仍可确认区域、仍可进入工作台仅阅读。识别能力不可用时会明确提示，而不是让你看到空白。
              </p>
            ) : (
              <>
                {derivedCandidate && (
                  <p className={styles.derivedNotice} role="note">
                    后端未下发候选对象：下表由已有知识对象派生，仅用于核对；来源字段仍取自对象本身。
                  </p>
                )}
                {candidates.length > 1 && (
                  <div className={styles.candidatePicker} role="tablist" aria-label="候选对象">
                    {candidates.map((item) => {
                      const active = item.candidate_id === candidate?.candidate_id;
                      return (
                        <button
                          key={item.candidate_id}
                          type="button"
                          role="tab"
                          aria-selected={active}
                          className={styles.candidateTab}
                          data-active={active ? 'true' : undefined}
                          onClick={() => setSelectedCandidateId(item.candidate_id)}
                        >
                          {templateLabel(item.template_id)}
                        </button>
                      );
                    })}
                  </div>
                )}
                <CandidateTable
                  templateName={candidate ? templateLabel(candidate.template_id) : '未识别模板'}
                  confidenceHint={candidate?.confidence_hint ?? 'low'}
                  rows={rows}
                  relations={relations}
                  allConfirmed={rows.length > 0 && rows.every((row) => row.confirmed)}
                  missingCount={missingCount}
                  disabled={busy}
                  onToggleAll={handleToggleAll}
                  onToggleRow={handleToggleRow}
                  onEditValue={handleEditValue}
                  onToggleRelation={handleToggleRelation}
                  onFocusSource={openSourcePage}
                />
                <div className={styles.objectActions}>
                  <p className={styles.actionHint}>
                    {missingCount > 0
                      ? `有 ${missingCount} 个候选字段缺失，补齐前无法编译（不影响区域确认与阅读）。`
                      : invalidCount > 0
                        ? `有 ${invalidCount} 行取值不合法，请按提示修正。`
                        : rows.length === 0
                          ? '后端未返回候选字段，可先阅读原材料。'
                          : `已勾选 ${rows.filter((row) => row.confirmed).length} / ${rows.length} 行。`}
                  </p>
                  <button
                    type="button"
                    className={styles.primary}
                    disabled={!canConfirmObject}
                    onClick={() => void handleEnter()}
                  >
                    {busy ? '正在保存并编译…' : '保存知识对象确认并进入'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </section>

      {failure !== null && (
        <div className={styles.failure} role="alert">
          <p className={styles.failureText}>{describeFailure(failure)}</p>
          <p className={styles.failureMeta}>
            错误码：{failure.code ?? '未提供'} · 可重试：{failure.retryable ? '是' : '否'}
          </p>
        </div>
      )}

      {notice !== null && (
        <p className={styles.noticeBox} role="status">
          {notice}
        </p>
      )}

      {regionSyncError !== null && (
        <p className={styles.noticeBox} role="alert">
          {regionSyncError}
        </p>
      )}

      {/* 底部：确认并进入工作台 */}
      <footer className={styles.footer} aria-label="完成确认">
        <div className={styles.footerStats}>
          <span>
            可交互 <strong>{statusCounts.pending + statusCounts.confirmed}</strong> 个
          </span>
          <span>
            已确认 <strong>{statusCounts.confirmed}</strong> 个
          </span>
          <span>
            仅阅读 <strong>{statusCounts.static_only + statusCounts.unsupported}</strong> 个
          </span>
          {targetRegion !== null && <span className={styles.footerTarget}>将定位到第 {targetRegion.page} 页</span>}
        </div>
        <div className={styles.footerActions}>
          <button
            type="button"
            className={styles.textButton}
            disabled={busy}
            onClick={handleResetAll}
          >
            恢复全部原始参数
          </button>
          <button type="button" className={styles.secondary} disabled={busy} onClick={enterReadOnly}>
            仅阅读模式进入
          </button>
          <button
            type="button"
            className={styles.primary}
            disabled={busy}
            onClick={() => void handleEnter()}
          >
            {busy
              ? '正在进入…'
              : interactiveCount > 0
                ? '确认并进入工作台'
                : '以仅阅读模式进入工作台'}
          </button>
        </div>
      </footer>

      <ConflictDialog
        open={conflict !== null}
        conflict={conflict}
        busy={busy}
        onKeepLocal={() => setConflict(null)}
        onReloadAndConfirm={() => void handleReloadAndConfirm()}
      />
    </main>
  );
}

export default PreparePage;
