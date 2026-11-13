/**
 * WorkbenchPage.tsx —— 以"这一页 PPT"为中心的工作台（rebuild-spec §6）。
 *
 * 用户进入后先看到熟悉的原页：左侧 24 页缩略图、中央保持 16:9 原比例的页面、
 * 右侧参数抽屉默认收起。点中页面上的向量/矩阵/曲线才出现控件；
 * 数值表、计算步骤、验证报告、revision/element_id/坐标/模板标识等
 * 全部收进按需展开的"详情"面板。
 *
 * URL：`/materials/:materialId/work?page=6&region=rgn_s06_vectors&view=page|details&from=prepare`
 *
 * P0 修复：
 *  - P0-01：区域来源只认当前材料；识别为空时显示"未识别到交互区域（原因：…）"，不渲染热点；
 *  - P0-02：图 / 文字 / 参数表 / 校验 / 保存统一读 `useUnifiedSpecState` 的合并结果；
 *  - P0-03：面包屑（首页 / 材料名 / 第 N 页）+ 来源感知返回 + 参数会话持久化。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { evaluateSpec } from '@/ispec';
import { capabilityKindsOf } from '@/ispec/capabilities';
import type { ISpec, PrimitiveKind } from '@/ispec/types';
import { resolveRegionComponent } from '@/regions/registry';
import type { LinkedTextRuntime } from '@/regions/types';
import type { ISpecViewProps } from '@/components/ispec';
import { ISpecView } from '@/components/ispec/ISpecView';
import type { PageThumbnailItem } from '@/components/reader/PageThumbnails';
import {
  DetailsPanel,
  PageCanvas,
  PageThumbnails,
  ParamDrawer,
  PlayBar,
  isRegionChanged,
  pageImageFor,
  pickSpecForPage,
  useMaterialSpecs,
  usePageRegions,
  useUnifiedSpecState,
} from '@/components/reader';
import {
  deriveTemplateResult,
  describeFailure,
  isReportStale,
  pickLatestReport,
  toApiFailure,
  useChecksView,
  useMaterialView,
  useModelDraft,
  useObjectView,
  useRunsView,
  useWorkbenchActions,
} from '@/components/workbench/workbenchData';
import { shortId } from '@/components/workbench/format';
import { useReducedMotion } from '@/components/workbench/useMediaQuery';
import styles from './WorkbenchPage.module.css';
import MaterialDeckPage from './MaterialDeckPage';
import { api } from '@/api/client';

const DEFAULT_PAGE_COUNT = 24;
const PLAY_INTERVAL_MS = 1100;

type Stage = 0 | 1 | 2;

const HOME_PATH = '/';

/** 返回来源：准备页进工作台 → 回准备页；分享页 / 外部链接 → 回首页（P0-03）。 */
type ReturnSource = 'prepare' | 'home';

function readReturnSource(searchValue: string | null, state: unknown): ReturnSource {
  if (searchValue === 'prepare') return 'prepare';
  if (typeof state === 'object' && state !== null && !Array.isArray(state)) {
    const from = (state as Record<string, unknown>)['from'];
    if (from === 'prepare') return 'prepare';
  }
  return 'home';
}

/** 识别结论用于“本页仅阅读”提示；读取进度类文案不展示，避免和区域提示抢话。 */
function recognitionNote(recognition: { found: boolean; reason: string }): string {
  const reason = recognition.reason.trim();
  if (!reason) return '';
  if (/^(正在读取|已读取|读取 iSpec)/.test(reason)) return '';
  return reason;
}

/** 原生文字回调的载荷（与 #25 的 `ISpecViewProps.onLinkedTexts` 对齐）。 */
interface SpecLinkedText {
  id: string;
  text: string;
  changed: boolean;
}

export function WorkbenchPage() {
  return api.mode === 'mock' ? <LegacyWorkbenchPage /> : <MaterialDeckPage />;
}

export function LegacyWorkbenchPage() {
  const params = useParams<{ materialId?: string }>();
  const materialId = params.materialId ?? null;
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const reducedMotion = useReducedMotion();

  const materialView = useMaterialView(materialId);
  const detail = materialView.data;
  const objectSummary = detail?.objects[0] ?? null;
  const objectId = objectSummary?.object_id ?? null;

  const objectView = useObjectView(objectId);
  const checksView = useChecksView(objectId);
  const runsView = useRunsView(objectId);
  const bundle = objectView.data;
  const draft = useModelDraft(objectId, bundle?.object ?? objectSummary);
  const actions = useWorkbenchActions();

  const regionMeta = usePageRegions(materialId);
  const specMeta = useMaterialSpecs(materialId, detail ?? null);

  /** 本材料出现过的原语类型（只读展示；新增知识点只加 iSpec 即可扩展）。 */
  const materialCapabilityKinds: PrimitiveKind[] = useMemo(
    () => capabilityKindsOf(specMeta.specs),
    [specMeta.specs],
  );

  /* ---------------- URL 状态 ---------------- */

  const pageCount = detail?.material.page_count ?? DEFAULT_PAGE_COUNT;
  const rawPage = searchParams.get('page');
  const parsedPage = rawPage === null ? Number.NaN : Number.parseInt(rawPage, 10);
  const sourcePage = objectSummary?.source_refs.find((source) => source.page !== null)?.page ?? 1;
  const page = Math.min(
    Math.max(1, Number.isFinite(parsedPage) ? parsedPage : sourcePage),
    Math.max(1, pageCount),
  );
  const regionParam = searchParams.get('region');
  const showDetails = searchParams.get('view') === 'details';
  const returnSource = readReturnSource(searchParams.get('from'), location.state);
  const backTarget = returnSource === 'prepare' ? `/materials/${materialId}/prepare` : HOME_PATH;
  const backLabel = returnSource === 'prepare' ? '← 返回准备页' : '← 返回首页';

  const updateQuery = useCallback(
    (patch: Record<string, string | null>): void => {
      const next = new URLSearchParams(searchParams);
      Object.keys(patch).forEach((key) => {
        const value = patch[key] ?? null;
        if (value === null || value.length === 0) next.delete(key);
        else next.set(key, value);
      });
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  /* ---------------- 区域与参数（跨页/对象保留） ---------------- */

  const pageRegions = useMemo(
    () => regionMeta.regions.filter((region) => region.page === page),
    [regionMeta.regions, page],
  );

  const activeRegion = useMemo(() => {
    if (regionParam === null) return null;
    return pageRegions.find((region) => region.region_id === regionParam) ?? null;
  }, [regionParam, pageRegions]);

  const activeRegionId = activeRegion?.region_id ?? null;
  const resolution =
    activeRegion === null ? null : resolveRegionComponent(activeRegion.script_id, activeRegion.status);
  const live = activeRegion !== null && resolution !== null && resolution.supported;

  /** 本页命中的 iSpec：有则优先用通用运行时，没有才回退到 regions 组件。 */
  const activeSpec: ISpec | null = useMemo(
    () => pickSpecForPage(specMeta.specs, page, activeRegionId),
    [specMeta.specs, page, activeRegionId],
  );

  const unified = useUnifiedSpecState({
    materialId,
    regions: regionMeta.regions,
    activeRegion,
    object: draft.object,
    spec: activeSpec,
    // §9-4：把本材料全部 iSpec 交给状态层，用于汇总跨页共享组与冲突
    specs: specMeta.specs,
  });

  const specEvaluation = useMemo(
    () => (activeSpec === null ? null : evaluateSpec(activeSpec, unified.specValues)),
    [activeSpec, unified.specValues],
  );

  const [specLinkedTexts, setSpecLinkedTexts] = useState<SpecLinkedText[]>([]);
  useEffect(() => {
    setSpecLinkedTexts([]);
  }, [activeSpec?.object_id]);

  /* ---------------- 区域播放控制 ---------------- */

  const [stages, setStages] = useState<Record<string, Stage>>({});
  const [playing, setPlaying] = useState(false);
  const [specStage, setSpecStage] = useState<Stage>(2);
  const [specPlaying, setSpecPlaying] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [runningChecks, setRunningChecks] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const activeStage: Stage = activeRegionId === null ? 2 : (stages[activeRegionId] ?? 2);
  const specUsesStage = activeSpec !== null && activeSpec.kind === 'step';

  const stageRef = useRef<Stage>(activeStage);
  useEffect(() => {
    stageRef.current = activeStage;
  }, [activeStage]);

  // 播放：0 → 1 → 2，到 2 自动停止。依赖 stable 的 region id，避免每帧重建计时器。
  useEffect(() => {
    if (!playing || activeRegionId === null) return undefined;
    const timer = window.setInterval(() => {
      if (stageRef.current >= 2) {
        setPlaying(false);
        return;
      }
      const next = (stageRef.current + 1) as Stage;
      stageRef.current = next;
      setStages((previous) => ({ ...previous, [activeRegionId]: next }));
    }, PLAY_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [playing, activeRegionId]);

  const specStageRef = useRef<Stage>(specStage);
  useEffect(() => {
    specStageRef.current = specStage;
  }, [specStage]);

  // iSpec 的 step 视图同样由宿主推进阶段；参数仍来自 unified。
  useEffect(() => {
    if (!specPlaying || !specUsesStage) return undefined;
    const timer = window.setInterval(() => {
      if (specStageRef.current >= 2) {
        setSpecPlaying(false);
        return;
      }
      const next = (specStageRef.current + 1) as Stage;
      specStageRef.current = next;
      setSpecStage(next);
    }, PLAY_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [specPlaying, specUsesStage]);

  // 切换页/区域时停止播放并收起抽屉（参数仍然保留）。
  useEffect(() => {
    setPlaying(false);
    setSpecPlaying(false);
    setDrawerOpen(false);
  }, [page, activeRegionId]);

  useEffect(() => {
    setSpecStage(2);
    setSpecPlaying(false);
  }, [activeSpec?.object_id]);

  /* ---------------- 缩略图 ---------------- */

  const thumbnails = useMemo<PageThumbnailItem[]>(() => {
    const titles = new Map((detail?.slides ?? []).map((slide) => [slide.page_no, slide.title] as const));
    const interactivePages = new Set(
      regionMeta.regions.filter((region) => region.status === 'confirmed').map((region) => region.page),
    );
    specMeta.specs.forEach((spec) =>
      spec.parameters.forEach((parameter) => interactivePages.add(parameter.source.page)),
    );
    return Array.from({ length: Math.max(1, pageCount) }, (_, index) => {
      const pageNo = index + 1;
      return {
        page: pageNo,
        title: titles.get(pageNo) ?? `第 ${pageNo} 页`,
        interactive: interactivePages.has(pageNo),
      };
    });
  }, [detail?.slides, regionMeta.regions, specMeta.specs, pageCount]);

  /* ---------------- 页面图 ---------------- */

  const slideImageUrl =
    detail?.slides.find((slide) => slide.page_no === page)?.image_url ?? null;
  const pageImage = pageImageFor(page, slideImageUrl, activeRegion ?? pageRegions[0] ?? null);

  /* ---------------- 详情所需的只读数据 ---------------- */

  /** 保存 / 校验 / 表格 / 图 都读这一个对象（已把区域参数投影进来）。 */
  const effectiveObject = unified.objectWithParams ?? draft.object;
  const outcome = deriveTemplateResult(effectiveObject);
  const modelDirty = draft.dirty || unified.activeRegionChanged;

  const latestReport = useMemo(() => {
    const fromChecks = pickLatestReport(checksView.data);
    if (fromChecks !== null) return fromChecks;
    return bundle?.checks_summary ?? null;
  }, [checksView.data, bundle?.checks_summary]);
  const reportStale =
    modelDirty || isReportStale(latestReport, effectiveObject, draft.revision);
  const runs = runsView.data ?? [];

  /* ---------------- 交互 ---------------- */

  const handleSelectPage = useCallback(
    (nextPage: number): void => {
      updateQuery({ page: String(nextPage), region: null });
    },
    [updateQuery],
  );

  const handleActivate = useCallback(
    (regionId: string): void => {
      setNotice(null);
      updateQuery({ region: regionId });
      setStages((previous) => (previous[regionId] === undefined ? { ...previous, [regionId]: 2 } : previous));
    },
    [updateQuery],
  );

  const handleDeactivate = useCallback((): void => {
    updateQuery({ region: null });
  }, [updateQuery]);

  const handleChangeParams = useCallback(
    (regionId: string, patch: Record<string, unknown>): void => {
      unified.setRegionParams(regionId, patch);
    },
    [unified],
  );

  const handleResetRegion = useCallback(
    (regionId: string): void => {
      unified.resetRegionParams(regionId);
    },
    [unified],
  );

  const handleLinkedTexts = useCallback(
    (regionId: string, texts: LinkedTextRuntime[]): void => {
      unified.setLinkedTexts(regionId, texts);
    },
    [unified],
  );

  const handlePlay = useCallback((): void => {
    if (activeRegionId === null) return;
    stageRef.current = 0;
    setStages((previous) => ({ ...previous, [activeRegionId]: 0 }));
    setPlaying(true);
  }, [activeRegionId]);

  const handlePause = useCallback((): void => {
    setPlaying(false);
  }, []);

  const handleStep = useCallback((): void => {
    if (activeRegionId === null) return;
    setPlaying(false);
    setStages((previous) => {
      const current = previous[activeRegionId] ?? 2;
      const next: Stage = current >= 2 ? 0 : ((current + 1) as Stage);
      return { ...previous, [activeRegionId]: next };
    });
  }, [activeRegionId]);

  const handleReset = useCallback((): void => {
    if (activeRegionId === null) return;
    setPlaying(false);
    setStages((previous) => ({ ...previous, [activeRegionId]: 0 }));
  }, [activeRegionId]);

  const handleRestoreOriginal = useCallback((): void => {
    if (activeRegionId === null) {
      handleDeactivate();
      return;
    }
    unified.resetRegionParams(activeRegionId);
    setStages((previous) => ({ ...previous, [activeRegionId]: 2 }));
    setPlaying(false);
    setNotice('已恢复本区域原稿参数（图表、文字、参数表与保存值同步）。');
    handleDeactivate();
  }, [activeRegionId, handleDeactivate, unified]);

  const handleSpecPlay = useCallback((): void => {
    specStageRef.current = 0;
    setSpecStage(0);
    setSpecPlaying(true);
  }, []);

  const handleSpecStep = useCallback((): void => {
    setSpecPlaying(false);
    setSpecStage((current) => (current >= 2 ? 0 : ((current + 1) as Stage)));
  }, []);

  const handleSpecReset = useCallback((): void => {
    setSpecPlaying(false);
    setSpecStage(0);
  }, []);

  const handleSpecRestore = useCallback((): void => {
    unified.resetSpecValues();
    setSpecPlaying(false);
    setSpecStage(2);
    setNotice('已恢复 iSpec 参数默认值；图、文字、表格与校验同步更新。');
  }, [unified]);

  const handleSpecLinkedTexts = useCallback((texts: SpecLinkedText[]): void => {
    setSpecLinkedTexts((previous) => {
      if (
        previous.length === texts.length &&
        previous.every(
          (item, index) =>
            item.id === texts[index]?.id &&
            item.text === texts[index]?.text &&
            item.changed === texts[index]?.changed,
        )
      ) {
        return previous;
      }
      return texts;
    });
  }, []);

  const handleToggleDetails = useCallback((): void => {
    updateQuery({ view: showDetails ? null : 'details' });
  }, [showDetails, updateQuery]);

  const handleSaveRun = useCallback(async (): Promise<void> => {
    if (objectId === null || effectiveObject === null) return;
    setBusy(true);
    setNotice(null);
    try {
      const base = bundle?.object ?? effectiveObject;
      // 区域参数已经投影到 effectiveObject；只有确实变了才提交新模型版本。
      const saved = modelDirty
        ? await actions.confirmModel({
            objectId,
            expectedVersion: base.model_version,
            object: effectiveObject,
          })
        : base;
      const run = await actions.saveRun({
        objectId,
        modelVersion: saved.model_version,
        revision: saved.revision,
        inputSnapshot: saved,
        result: outcome.result,
      });
      draft.markSynced();
      setNotice(`已保存运行 ${shortId(run.run_id)}：冻结 revision ${run.revision}。`);
      await runsView.refetch();
    } catch (error) {
      setNotice(toApiFailure(error).message);
    } finally {
      setBusy(false);
    }
  }, [actions, bundle?.object, draft, effectiveObject, modelDirty, objectId, outcome.result, runsView]);

  const handleRunChecks = useCallback(async (): Promise<void> => {
    if (objectId === null || effectiveObject === null) return;
    setRunningChecks(true);
    setNotice(null);
    try {
      const base = bundle?.object ?? effectiveObject;
      const saved = modelDirty
        ? await actions.confirmModel({
            objectId,
            expectedVersion: base.model_version,
            object: effectiveObject,
          })
        : base;
      const report = await actions.runValidation({
        objectId,
        modelVersion: saved.model_version,
        revision: saved.revision,
      });
      draft.markSynced();
      setNotice(
        `独立校验完成：通过 ${report.summary.pass} 项，失败 ${report.summary.fail} 项，未覆盖 ${report.summary.not_covered} 项。`,
      );
      await Promise.all([checksView.refetch(), objectView.refetch()]);
    } catch (error) {
      setNotice(toApiFailure(error).message);
    } finally {
      setRunningChecks(false);
    }
  }, [
    actions,
    bundle?.object,
    checksView,
    draft,
    effectiveObject,
    modelDirty,
    objectId,
    objectView,
  ]);

  /* ---------------- 渲染 ---------------- */

  if (materialId === null) {
    return (
      <main className={styles.statePage}>
        <p role="alert">
          缺少材料编号。<Link to={HOME_PATH}>返回首页</Link>
        </p>
      </main>
    );
  }

  const materialTitle = detail?.material.title ?? '原始材料';
  const pageInteractive =
    activeSpec !== null || pageRegions.some((region) => region.status === 'confirmed');
  // 有 iSpec 时优先通用运行时：本页不再渲染（也不会激活）区域热点。
  const canvasRegions = activeSpec === null ? pageRegions : [];
  const canvasActiveRegion = activeSpec === null ? activeRegion : null;

  const specViewProps: ISpecViewProps | null =
    activeSpec === null
      ? null
      : {
          spec: activeSpec,
          values: unified.specValues,
          onChange: unified.setSpecValue,
          stage: specUsesStage ? specStage : 2,
          reducedMotion,
          onLinkedTexts: handleSpecLinkedTexts,
        };

  return (
    <main className={styles.reader} data-reduced-motion={reducedMotion ? 'true' : 'false'}>
      <div className={styles.breadcrumbBar}>
        <nav className={styles.breadcrumb} aria-label="面包屑">
          <Link className={styles.crumb} to={HOME_PATH}>
            首页
          </Link>
          <span className={styles.crumbSep} aria-hidden="true">
            /
          </span>
          <Link className={styles.crumb} to={`/materials/${materialId}/prepare`}>
            {materialTitle}
          </Link>
          <span className={styles.crumbSep} aria-hidden="true">
            /
          </span>
          <Link
            className={styles.crumb}
            to={{ pathname: location.pathname, search: location.search }}
            aria-current="page"
          >
            第 {page} 页
          </Link>
        </nav>
        <Link className={styles.back} to={backTarget}>
          {backLabel}
        </Link>
      </div>

      <header className={styles.header}>
        <div className={styles.heading}>
          <h1 className={styles.title}>{materialTitle}</h1>
          <p className={styles.subtitle}>
            第 {page} / {pageCount} 页 · {pageInteractive ? '可交互' : '仅阅读'}
            {specMeta.loading ? ' · 正在匹配 iSpec…' : ''}
            {materialView.loading ? ' · 正在载入材料信息…' : ''}
          </p>
        </div>
        <div className={styles.headActions}>
          {(unified.persistNotice ?? notice) !== null ? (
            <p className={styles.notice} role="status">
              {unified.persistNotice ?? notice}
            </p>
          ) : null}
          <button
            type="button"
            className={styles.detailsButton}
            aria-expanded={showDetails}
            aria-controls="reader-details"
            onClick={handleToggleDetails}
          >
            详情
          </button>
        </div>
      </header>

      {materialView.error !== null && (
        <p className={styles.errorBanner} role="alert">
          {describeFailure(materialView.error)}
          <button type="button" className={styles.retryButton} onClick={() => void materialView.refetch()}>
            重新载入
          </button>
        </p>
      )}

      <div className={styles.body}>
        <PageThumbnails items={thumbnails} currentPage={page} onSelect={handleSelectPage} />

        <div className={styles.main}>
          <div className={styles.stageTop}>
            {!regionMeta.loading && !regionMeta.recognition.found && activeSpec === null ? (
              <p className={styles.stageState} role="status" data-region-recognition="none">
                未识别到交互区域（原因：
                {recognitionNote(specMeta.recognition) || regionMeta.recognition.reason}）。
                本页仅显示原文，不提供热点与参数。
              </p>
            ) : (
              <p className={styles.stageState} role="status">
                {activeSpec !== null
                  ? '本页由 iSpec 通用运行时驱动：调参数，图表与表格同步更新'
                  : pageRegions.length === 0
                    ? '本页按原文阅读，未识别到可交互图示'
                    : pageInteractive
                      ? '点页面中的图示即可激活；也可以直接阅读原文'
                      : '本页图示暂不支持交互，按原文阅读'}
              </p>
            )}
            {activeRegion !== null && !live && activeSpec === null ? (
              <p className={styles.stageNote}>该图示暂不支持交互，可继续阅读原页</p>
            ) : null}
          </div>

          {specViewProps !== null ? (
            <section className={styles.specPanel} aria-label="iSpec 通用运行时">
              <header className={styles.specHead}>
                <div>
                  <h2 className={styles.specTitle}>本页可交互运行时</h2>
                  <p className={styles.specNote}>
                    由 iSpec 通用运行时渲染（{activeSpec?.kind ?? 'iSpec'}）；参数与右侧"当前参数"表、
                    校验报告和保存值读取同一份状态。
                  </p>
                </div>
                <span className={styles.specBadge}>{activeSpec?.title ?? activeSpec?.object_id ?? 'iSpec'}</span>
              </header>
              <ISpecView {...specViewProps} />
              {specLinkedTexts.length > 0 ? (
                <p className={styles.specNote} role="status">
                  原位文字已同步 {specLinkedTexts.length} 条（与图示同源）。
                </p>
              ) : null}
              {specUsesStage ? (
                <PlayBar
                  stage={specStage}
                  playing={specPlaying}
                  changed={unified.specChanged}
                  reducedMotion={reducedMotion}
                  onPlay={handleSpecPlay}
                  onPause={() => setSpecPlaying(false)}
                  onStep={handleSpecStep}
                  onReset={handleSpecReset}
                  onRestore={handleSpecRestore}
                />
              ) : null}
            </section>
          ) : null}

          <div className={styles.stageArea}>
            <PageCanvas
              page={page}
              pageImage={pageImage}
              regions={canvasRegions}
              activeRegion={canvasActiveRegion}
              paramsByRegion={unified.paramsByRegion}
              stages={stages}
              runtimeTexts={unified.runtimeTextsByRegion}
              reducedMotion={reducedMotion}
              onActivate={handleActivate}
              onDeactivate={handleDeactivate}
              onChangeParams={handleChangeParams}
              onLinkedTexts={handleLinkedTexts}
            />

            {activeSpec === null && live && activeRegion !== null && (
              <PlayBar
                stage={activeStage}
                playing={playing}
                changed={isRegionChanged(activeRegion, unified.activeParams)}
                reducedMotion={reducedMotion}
                onPlay={handlePlay}
                onPause={handlePause}
                onStep={handleStep}
                onReset={handleReset}
                onRestore={handleRestoreOriginal}
              />
            )}

            {activeSpec === null && live && activeRegion !== null && (
              <ParamDrawer
                region={activeRegion}
                params={unified.activeParams}
                errors={{}}
                open={drawerOpen}
                onToggle={() => setDrawerOpen((previous) => !previous)}
                onChange={(patch) => handleChangeParams(activeRegion.region_id, patch)}
                onReset={() => handleResetRegion(activeRegion.region_id)}
              />
            )}
          </div>
        </div>
      </div>

      <div id="reader-details">
        <DetailsPanel
          open={showDetails}
          onClose={handleToggleDetails}
          materialId={materialId}
          page={page}
          pageCount={pageCount}
          region={activeRegion}
          regionMeta={regionMeta}
          object={effectiveObject}
          revision={draft.revision}
          dirty={modelDirty}
          params={unified.activeParams}
          paramRows={unified.rows}
          hasSpec={activeSpec !== null}
          capabilityKinds={materialCapabilityKinds}
          specEvaluation={specEvaluation}
          sharedConflicts={unified.sharedConflicts}
          sharedConsistency={unified.sharedConsistency}
          checks={checksView.data ?? []}
          latestReport={latestReport}
          reportStale={reportStale}
          runs={runs}
          checksLoading={checksView.loading}
          runsLoading={runsView.loading}
          runningChecks={runningChecks}
          busy={busy}
          notice={notice}
          onRunChecks={() => void handleRunChecks()}
          onSaveRun={() => void handleSaveRun()}
        />
      </div>
    </main>
  );
}

export default WorkbenchPage;
