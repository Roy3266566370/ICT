import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import {
  useChecks,
  useCompileObject,
  useCreateRun,
  useMaterial,
  useObjectBundle,
  useRuns,
  useUpdateObjectModel,
  useValidateObject,
} from '@/api/hooks';
import { ApiRequestError } from '@/api/client';
import type {
  KnowledgeObject,
  MaterialDetail,
  RunSnapshot,
  TemplateId,
  TemplateProps,
  ValidationReport,
} from '@/api/types';
import { deriveBfsFlow } from '@/domain/bfs';
import { deriveBudgetCompare } from '@/domain/budget';
import { deriveForce2d } from '@/domain/force';
import { deriveMatrix2d } from '@/domain/matrix';
import { useModelStore, useModelObject } from '@/state/modelStore';
import { resolveTemplate, templateLoaders } from '@/templates/registry';
import { UnsupportedTemplateView } from '@/templates/registry';

/**
 * T4 与 T2（前端底座）之间的唯一适配层。
 *
 * 目的：把 `@/api`、`@/state`、`@/domain`、`@/templates` 的导出集中到一处，
 * 工作台组件只依赖本文件导出的稳定形状。若 T2 后续调整签名，只需改这一处。
 * 当前对齐依据为 T2 工程师确认的定稿签名（见交付说明）。
 */

/* ------------------------------------------------------------------ */
/* 展示常量                                                            */
/* ------------------------------------------------------------------ */

/** 模板 → 场景中文名（与首页四场景卡文案一致，不新增跨任务契约）。 */
export const TEMPLATE_LABELS: Record<TemplateId, string> = {
  matrix_2d: '空间与矩阵',
  force_2d: '力与向量',
  bfs_flow: '计算机过程',
  budget_compare: '办公推演',
};

/** 未知模板的兜底名称。 */
export const UNKNOWN_TEMPLATE_LABEL = '未知模板';

export function templateLabel(templateId: string): string {
  return TEMPLATE_LABELS[templateId as TemplateId] ?? UNKNOWN_TEMPLATE_LABEL;
}

/* ------------------------------------------------------------------ */
/* 错误归一化（C-ERR@1）                                                */
/* ------------------------------------------------------------------ */

export interface ApiFailure {
  code: string | null;
  message: string;
  retryable: boolean;
}

export function toApiFailure(error: unknown): ApiFailure {
  if (error instanceof ApiRequestError) {
    return { code: error.code, message: error.message, retryable: error.retryable };
  }
  if (error instanceof Error) {
    return { code: null, message: error.message, retryable: false };
  }
  return { code: null, message: '请求失败，请稍后重试。', retryable: true };
}

export function isVersionConflict(error: unknown): boolean {
  return error instanceof ApiRequestError && error.code === 'VERSION_CONFLICT';
}

/** 错误码 → 面向用户的中文说明（§2.2.8 的"前端处理"列）。 */
export function describeFailure(failure: ApiFailure): string {
  switch (failure.code) {
    case 'MISSING_FIELD':
      return `缺少字段或取值不合法：${failure.message}`;
    case 'UNSUPPORTED_TEMPLATE':
      return `该模板暂不支持（仅支持 matrix_2d / force_2d / bfs_flow / budget_compare）。可先阅读原材料。`;
    case 'VERSION_CONFLICT':
      return `材料或对象已被更新（VERSION_CONFLICT）：${failure.message}`;
    case 'INVALID_FILE':
      return `文件不合法：${failure.message}`;
    case 'LIMIT_EXCEEDED':
      return `超出限制：${failure.message}`;
    case 'PARSE_FAILED':
      return `解析失败：${failure.message}${failure.retryable ? '（可重试）' : ''}`;
    case 'MODEL_UNAVAILABLE':
      return `模型能力暂不可用：${failure.message}。可先阅读原材料。`;
    case 'SESSION_EXPIRED':
      return `会话已失效或资源不可用，请回到工作空间重新进入。`;
    default:
      return failure.message;
  }
}

/* ------------------------------------------------------------------ */
/* 查询包装                                                            */
/* ------------------------------------------------------------------ */

export interface QueryView<T> {
  data: T | null;
  loading: boolean;
  error: ApiFailure | null;
  /** 重新拉取并返回最新数据（用于 VERSION_CONFLICT 后"重新载入再提交"）。 */
  refetch: () => Promise<T | null>;
}

function toQueryView<T>(query: UseQueryResult<T>): QueryView<T> {
  return {
    data: query.data ?? null,
    loading: query.isLoading,
    error: query.error === null ? null : toApiFailure(query.error),
    refetch: () => query.refetch().then((result) => result.data ?? null),
  };
}

/** #7 `GET /materials/{id}` */
export function useMaterialView(materialId: string | null): QueryView<MaterialDetail> {
  return toQueryView(useMaterial(materialId ?? ''));
}

/** #12 `GET /objects/{id}` → 对象 + 最新检查摘要 */
export function useObjectView(objectId: string | null): QueryView<{
  object: KnowledgeObject;
  checks_summary: ValidationReport | null;
}> {
  return toQueryView(useObjectBundle(objectId ?? ''));
}

/** #16 `GET /objects/{id}/runs` */
export function useRunsView(objectId: string | null): QueryView<RunSnapshot[]> {
  return toQueryView(useRuns(objectId ?? ''));
}

/** #19 `GET /objects/{id}/checks` */
export function useChecksView(objectId: string | null): QueryView<ValidationReport[]> {
  return toQueryView(useChecks(objectId ?? ''));
}

/** 取"最新一份"报告：按 created_at 降序，其次按 revision 降序（`is_stale` 在下方独立判定）。 */
export function pickLatestReport(reports: ValidationReport[] | null): ValidationReport | null {
  if (!reports || reports.length === 0) return null;
  const sorted = [...reports].sort((left, right) => {
    const byTime = new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
    if (byTime !== 0) return byTime;
    return right.revision - left.revision;
  });
  return sorted[0] ?? null;
}

/**
 * 报告过期判定（R10-AC7 / R11-AC4）：
 * 服务端 `is_stale` 之外，前端再按当前 model_version + revision 复核一次，
 * 避免"报告未过期但对象已变更"时误显示通过。
 */
export function isReportStale(
  report: ValidationReport | null,
  object: KnowledgeObject | null,
  revision: number,
): boolean {
  if (!report) return false;
  if (report.is_stale) return true;
  if (!object) return true;
  return report.model_version !== object.model_version || report.revision !== revision;
}

/* ------------------------------------------------------------------ */
/* 变更动作（#13 #14 #15 #18）                                          */
/* ------------------------------------------------------------------ */

export interface ConfirmModelInput {
  objectId: string;
  expectedVersion: number;
  object: KnowledgeObject;
}

export interface SaveRunInput {
  objectId: string;
  modelVersion: number;
  revision: number;
  inputSnapshot: KnowledgeObject;
  result?: unknown;
}

export interface WorkbenchActions {
  /** #13 `PUT /objects/{id}/model`，返回服务端对象。 */
  confirmModel: (input: ConfirmModelInput) => Promise<KnowledgeObject>;
  /** #14 `POST /objects/{id}/compile`，返回 job_id。 */
  compileObject: (input: { objectId: string; modelVersion: number }) => Promise<string>;
  /** #15 `POST /objects/{id}/runs`：服务端会用内核重算并覆盖 result。 */
  saveRun: (input: SaveRunInput) => Promise<RunSnapshot>;
  /** #18 `POST /objects/{id}/validate`。 */
  runValidation: (input: { objectId: string; modelVersion: number; revision: number }) => Promise<ValidationReport>;
}

export function useWorkbenchActions(): WorkbenchActions {
  const updateModel = useUpdateObjectModel();
  const compile = useCompileObject();
  const createRun = useCreateRun();
  const validate = useValidateObject();

  const confirmModel = useCallback(
    async (input: ConfirmModelInput): Promise<KnowledgeObject> => {
      const response = await updateModel.mutateAsync({
        objectId: input.objectId,
        expectedVersion: input.expectedVersion,
        object: input.object,
      });
      return response.object;
    },
    [updateModel],
  );

  const compileObject = useCallback(
    async (input: { objectId: string; modelVersion: number }): Promise<string> => {
      const response = await compile.mutateAsync(input);
      return response.job_id;
    },
    [compile],
  );

  const saveRun = useCallback(
    (input: SaveRunInput): Promise<RunSnapshot> =>
      createRun.mutateAsync({
        objectId: input.objectId,
        model_version: input.modelVersion,
        revision: input.revision,
        input_snapshot: input.inputSnapshot,
        result: input.result,
      }),
    [createRun],
  );

  const runValidation = useCallback(
    (input: { objectId: string; modelVersion: number; revision: number }): Promise<ValidationReport> =>
      validate.mutateAsync(input),
    [validate],
  );

  return useMemo(
    () => ({ confirmModel, compileObject, saveRun, runValidation }),
    [confirmModel, compileObject, saveRun, runValidation],
  );
}

/* ------------------------------------------------------------------ */
/* 参数草稿（@/state/modelStore）                                       */
/* ------------------------------------------------------------------ */

export interface ModelDraft {
  /** 已合并本地参数的当前对象；服务端对象未到达时为 null。 */
  object: KnowledgeObject | null;
  revision: number;
  paramErrors: Record<string, string>;
  dirty: boolean;
  setParameter: (parameterId: string, value: unknown) => { ok: boolean; error: string | null };
  reset: () => void;
  /** 提交成功后复位 dirty（#13 / #15 成功后调用）。 */
  markSynced: () => void;
}

/**
 * 宿主对 modelStore 的唯一入口。
 *
 * - 本地参数按 `object_id` 隔离（R5-AC5），切换视图/对象都不重建 store（R10-AC2）；
 * - 只有在"store 内无该对象"或"服务端 model_version 变化"时才 hydrate，
 *   避免 refetch 覆盖用户本地修改（R10-AC6 的前置条件）。
 */
export function useModelDraft(objectId: string | null, serverObject: KnowledgeObject | null): ModelDraft {
  const storeObject = useModelObject(objectId);
  const loadObject = useModelStore((state) => state.loadObject);
  const setParam = useModelStore((state) => state.setParam);
  const resetObject = useModelStore((state) => state.resetObject);
  const getObject = useModelStore((state) => state.getObject);
  const markSyncedAction = useModelStore((state) => state.markSynced);
  const hydratedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!serverObject) return;
    const key = `${serverObject.object_id}:${serverObject.model_version}`;
    if (hydratedKeyRef.current === key) return;

    const existing = getObject(serverObject.object_id);
    if (existing && existing.model_version === serverObject.model_version) {
      // store 已有同版本对象：保留其本地参数与 revision。
      hydratedKeyRef.current = key;
      return;
    }
    loadObject(serverObject);
    hydratedKeyRef.current = key;
  }, [serverObject, getObject, loadObject]);

  const mergedObject = storeObject?.object ?? serverObject;
  // 必须显式区分「revision 为 0」与「尚未 hydrate」：不能用 `||`，否则本地重置（revision=0）
  // 会错误地回落到服务端 revision，破坏 R10-AC3 的基线语义。
  const revision = storeObject !== null ? storeObject.object.revision : (serverObject?.revision ?? 0);

  const handleSetParameter = useCallback(
    (parameterId: string, value: unknown): { ok: boolean; error: string | null } => {
      if (!objectId) return { ok: false, error: '尚未选择知识对象' };
      const outcome = setParam(objectId, parameterId, value);
      return { ok: outcome.ok, error: outcome.error };
    },
    [objectId, setParam],
  );

  const handleReset = useCallback(() => {
    if (!objectId) return;
    const restored = resetObject(objectId);
    if (restored) hydratedKeyRef.current = `${restored.object_id}:${restored.model_version}`;
  }, [objectId, resetObject]);

  const handleMarkSynced = useCallback(() => {
    if (!objectId) return;
    markSyncedAction(objectId);
  }, [objectId, markSyncedAction]);

  return {
    object: mergedObject,
    revision,
    paramErrors: storeObject?.paramErrors ?? {},
    dirty: storeObject?.dirty ?? false,
    setParameter: handleSetParameter,
    reset: handleReset,
    markSynced: handleMarkSynced,
  };
}

/* ------------------------------------------------------------------ */
/* 模板派生结果（@/domain）与装载（C-REG@1）                             */
/* ------------------------------------------------------------------ */

export interface TemplateOutcome {
  result: unknown;
  resultError: string | null;
}

/**
 * `TemplateProps.result` 的来源：与模板组件共享同一 Result 对象（R10-AC1）。
 * `@/domain/*` 的 `ok:false` 直接映射到 `TemplateProps.resultError`。
 */
export function deriveTemplateResult(object: KnowledgeObject | null): TemplateOutcome {
  if (!object) return { result: null, resultError: '尚未载入知识对象' };
  switch (object.template_id) {
    case 'matrix_2d': {
      const outcome = deriveMatrix2d(object);
      return outcome.ok ? { result: outcome.result, resultError: null } : { result: null, resultError: outcome.error };
    }
    case 'force_2d': {
      const outcome = deriveForce2d(object);
      return outcome.ok ? { result: outcome.result, resultError: null } : { result: null, resultError: outcome.error };
    }
    case 'bfs_flow': {
      const outcome = deriveBfsFlow(object);
      return outcome.ok ? { result: outcome.result, resultError: null } : { result: null, resultError: outcome.error };
    }
    case 'budget_compare': {
      const outcome = deriveBudgetCompare(object);
      return outcome.ok ? { result: outcome.result, resultError: null } : { result: null, resultError: outcome.error };
    }
    default:
      return { result: null, resultError: null };
  }
}

export type TemplateLoadStatus = 'idle' | 'loading' | 'ready' | 'unsupported' | 'error';

export interface TemplateLoadState {
  status: TemplateLoadStatus;
  Component: ComponentType<TemplateProps> | null;
  message: string | null;
}

/**
 * C-REG@1 前端部分：按白名单 + `import.meta.glob` 映射装载模板组件。
 * 未知模板不白屏：宿主渲染 `UnsupportedTemplateView` 并保留原材料阅读入口（R12-AC3）。
 */
export function useTemplateComponent(templateId: string | null): TemplateLoadState {
  const resolution = useMemo(() => (templateId ? resolveTemplate(templateId) : null), [templateId]);
  const [state, setState] = useState<TemplateLoadState>({
    status: 'idle',
    Component: null,
    message: null,
  });

  useEffect(() => {
    if (!templateId) {
      setState({ status: 'unsupported', Component: null, message: '对象未绑定模板' });
      return undefined;
    }
    if (!resolution || !resolution.supported) {
      setState({
        status: 'unsupported',
        Component: null,
        message: resolution ? resolution.message : '对象未绑定模板',
      });
      return undefined;
    }

    // 白名单内但模板目录尚未落地时 supported=true、definition.loader=null：
    // 宿主降级为"模板暂不可用"，不白屏、不阻断编译（T5/T6 并行落地）。
    const loader = resolution.definition.loader ?? templateLoaders[templateId] ?? null;
    if (!loader) {
      setState({ status: 'unsupported', Component: null, message: '该模板暂不支持（组件尚未落地）' });
      return undefined;
    }

    let cancelled = false;
    setState({ status: 'loading', Component: null, message: null });
    loader()
      .then((module) => {
        if (cancelled) return;
        setState({ status: 'ready', Component: module.default, message: null });
      })
      .catch(() => {
        if (cancelled) return;
        setState({ status: 'error', Component: null, message: '模板组件加载失败，可回到原材料视图阅读。' });
      });

    return () => {
      cancelled = true;
    };
  }, [templateId, resolution]);

  return state;
}

export { UnsupportedTemplateView };
export type { TemplateProps };