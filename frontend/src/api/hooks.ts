/**
 * hooks.ts —— C-API@1 的 TanStack Query 封装（数据获取的唯一入口）
 *
 * 约定：
 *  - 查询 hook 返回 `UseQueryResult<T>`：使用方写 `const { data } = useXxx()`；
 *  - 变更 hook 返回 `UseMutationResult<Data, Error, Variables>`：使用方写 `.mutate(vars)`；
 *  - 参数为空串/空值时自动 `enabled: false`，避免无意义的 404；
 *  - 写操作成功后按 queryKeys 前缀精准失效，不整树刷新。
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { api, isApiError } from './client';
import { listLabs } from './labs';
import { queryKeys, useScopedQueryKeys } from './queryKeys';
import type { LabSummary } from '@/labs/types';
import type {
  CloneExampleResponse,
  CompileResponse,
  CreateRunRequest,
  ISpecScalar,
  ISpecValuesRecord,
  ISpecValuesResult,
  KnowledgeObject,
  MaterialDetail,
  MaterialRegionsResponse,
  MaterialsListResponse,
  ObjectBundleResponse,
  RegionOverridePatch,
  RegionOverrideResult,
  RunSnapshot,
  RunsListResponse,
  SessionInfo,
  TemplateDescriptor,
  UpdateModelResponse,
  ValidationReport,
  ChecksListResponse,
} from './types';

const SESSION_STALE_MS = 60_000;
const STATIC_STALE_MS = 5 * 60_000;

/* -------------------------------------------------------------------------- */
/* 会话                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * 取当前会话；Cookie 不存在/过期时自动创建访客会话（R2-AC1、R13-AC3）。
 * 原始凭据始终由服务端 HttpOnly Cookie 持有，前端只拿到 `csrf_token` 用于写请求。
 */
export async function fetchSession(): Promise<SessionInfo> {
  try {
    return await api.getCurrentSession();
  } catch (error) {
    if (isApiError(error, 'SESSION_EXPIRED')) return api.createSession();
    throw error;
  }
}

export function useSession(): UseQueryResult<SessionInfo> {
  return useQuery({
    queryKey: queryKeys.session(),
    queryFn: fetchSession,
    staleTime: SESSION_STALE_MS,
    retry: false,
  });
}

export function useCreateSession(): UseMutationResult<SessionInfo, Error, void> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.createSession(),
    onSuccess: (session) => {
      queryClient.setQueryData(queryKeys.session(), session);
    },
  });
}

/* -------------------------------------------------------------------------- */
/* 模板                                                                       */
/* -------------------------------------------------------------------------- */

export function useTemplates(): UseQueryResult<TemplateDescriptor[]> {
  return useQuery({
    queryKey: queryKeys.templates(),
    queryFn: () => api.listTemplates(),
    // 模板白名单是静态事实，一次拉取后不再重复请求
    staleTime: Infinity,
  });
}

/* -------------------------------------------------------------------------- */
/* 材料与任务                                                                 */
/* -------------------------------------------------------------------------- */

export function useMaterials(limit?: number): UseQueryResult<MaterialsListResponse> {
  const keys = useScopedQueryKeys();
  return useQuery({
    queryKey: keys.materials(limit),
    queryFn: () => api.listMaterials(limit),
    refetchOnMount: 'always',
  });
}

export function useMaterial(materialId: string): UseQueryResult<MaterialDetail> {
  const keys = useScopedQueryKeys();
  return useQuery({
    queryKey: keys.material(materialId),
    queryFn: () => api.getMaterial(materialId),
    enabled: materialId !== '',
    staleTime: 10_000,
  });
}

/**
 * 当前访客会话下的题目实验列表（个人主页「题目实验」标签用）。
 * 与 LabPage 的 `listLabs` 共用同一端点，但走账号 scope 的查询键，
 * 账号切换时随其它私有缓存一起清理。
 */
export function useLabs(enabled = true): UseQueryResult<LabSummary[]> {
  const keys = useScopedQueryKeys();
  return useQuery({
    queryKey: keys.labs(),
    queryFn: () => listLabs(),
    enabled,
    staleTime: 10_000,
  });
}

/* -------------------------------------------------------------------------- */
/* 区域确认/纠正（C-API@1 P2 追加）                                            */
/* -------------------------------------------------------------------------- */

/**
 * 材料区域清单（基线 + 用户覆盖）。
 * 与 `regionData.usePageRegions` 的区别：这里走 React Query 缓存，
 * 供准备页/详情面板随时拿到"服务端已保存的确认值"。
 */
export function useMaterialRegions(materialId: string): UseQueryResult<MaterialRegionsResponse> {
  const keys = useScopedQueryKeys();
  return useQuery({
    queryKey: keys.materialRegions(materialId),
    queryFn: () => api.listMaterialRegions(materialId),
    enabled: materialId !== '',
    // 用户刚在准备页改完参数就要读，缓存时间要短
    staleTime: 0,
  });
}

export interface PatchMaterialRegionVariables {
  materialId: string;
  regionId: string;
  patch: RegionOverridePatch;
}

/** 保存一条区域确认/纠正；成功后失效该材料的区域查询，工作台再读即拿到新值。 */
export function usePatchMaterialRegion(): UseMutationResult<
  RegionOverrideResult,
  Error,
  PatchMaterialRegionVariables
> {
  const queryClient = useQueryClient();
  const keys = useScopedQueryKeys();
  return useMutation({
    mutationFn: (input: PatchMaterialRegionVariables) =>
      api.patchMaterialRegion(input.materialId, input.regionId, input.patch),
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({ queryKey: keys.materialRegions(input.materialId) });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* iSpec 参数值（§10.1 第 5 步：跨会话持久化）                                 */
/* -------------------------------------------------------------------------- */

/**
 * 读取某个 iSpec（或共享池桶 `__shared__`）已保存的参数值。
 * `staleTime: 0`：用户刚改完就要读，缓存必须是"刚刚落盘"的那一份。
 */
export function useISpecValues(
  materialId: string,
  objectId: string,
): UseQueryResult<ISpecValuesRecord> {
  const keys = useScopedQueryKeys();
  return useQuery({
    queryKey: keys.materialIspecValues(materialId, objectId),
    queryFn: () => api.getISpecValues(materialId, objectId),
    enabled: materialId !== '' && objectId !== '',
    staleTime: 0,
  });
}

export interface SaveISpecValuesVariables {
  materialId: string;
  objectId: string;
  values: Record<string, ISpecScalar>;
  /** 上一次读到的桶级版本号；不传表示不做乐观锁校验。 */
  expectedUpdatedAt?: string | null;
}

/**
 * 保存 iSpec 参数值；成功后把服务端结果写回缓存。
 *
 * 刻意**不** invalidate：PUT 返回的就是权威值（含新 `updated_at`），
 * 立刻失效只会制造一次多余往返；冲突由调用方按 409 details 合并处理。
 */
export function useSaveISpecValues(): UseMutationResult<
  ISpecValuesResult,
  Error,
  SaveISpecValuesVariables
> {
  const queryClient = useQueryClient();
  const keys = useScopedQueryKeys();
  return useMutation({
    mutationFn: (input: SaveISpecValuesVariables) =>
      api.putISpecValues(
        input.materialId,
        input.objectId,
        input.values,
        input.expectedUpdatedAt ?? null,
      ),
    onSuccess: (data, input) => {
      queryClient.setQueryData(
        keys.materialIspecValues(input.materialId, input.objectId),
        data,
      );
    },
  });
}


export function useDeleteMaterial(): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  const keys = useScopedQueryKeys();
  return useMutation({
    mutationFn: (materialId: string) => api.deleteMaterial(materialId),
    onSuccess: async (_data, materialId) => {
      const listQueries = { queryKey: keys.materials().slice(0, -1) };
      await queryClient.cancelQueries(listQueries);
      queryClient.setQueriesData<MaterialsListResponse>(listQueries, previous => previous && ({
        ...previous,
        items: previous.items.filter(item => item.material_id !== materialId),
      }));
      queryClient.removeQueries({ queryKey: keys.material(materialId) });
      void queryClient.invalidateQueries({ queryKey: keys.materialsRoot() });
    },
  });
}

export function useCloneExample(): UseMutationResult<CloneExampleResponse, Error, string> {
  const queryClient = useQueryClient();
  const keys = useScopedQueryKeys();
  return useMutation({
    mutationFn: (exampleId: string) => api.cloneExample(exampleId),
    onSuccess: () => {
      // 克隆会新增材料，空间页与示例大厅都需要刷新
      void queryClient.invalidateQueries({ queryKey: keys.materialsRoot() });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* 知识对象 / 运行 / 检查                                                      */
/* -------------------------------------------------------------------------- */

export function useObjectBundle(objectId: string): UseQueryResult<ObjectBundleResponse> {
  const keys = useScopedQueryKeys();
  return useQuery({
    queryKey: keys.object(objectId),
    queryFn: () => api.getObject(objectId),
    enabled: objectId !== '',
    staleTime: 30_000,
  });
}

export function useUpdateObjectModel(): UseMutationResult<
  UpdateModelResponse,
  Error,
  { objectId: string; expectedVersion: number; object: KnowledgeObject }
> {
  const queryClient = useQueryClient();
  const keys = useScopedQueryKeys();
  return useMutation({
    mutationFn: (input: { objectId: string; expectedVersion: number; object: KnowledgeObject }) =>
      api.updateObjectModel(input.objectId, input.expectedVersion, input.object),
    onSuccess: (data, input) => {
      // 结构变更会推进 model_version 且清空 revision，服务端对象为权威值
      queryClient.setQueryData(keys.object(input.objectId), {
        object: data.object,
        checks_summary: null,
      });
      void queryClient.invalidateQueries({ queryKey: keys.object(input.objectId) });
      void queryClient.invalidateQueries({ queryKey: keys.checks(input.objectId) });
    },
  });
}

export function useCompileObject(): UseMutationResult<
  CompileResponse,
  Error,
  { objectId: string; modelVersion: number }
> {
  return useMutation({
    mutationFn: (input: { objectId: string; modelVersion: number }) =>
      api.compileObject(input.objectId, input.modelVersion),
  });
}

export function useCreateRun(): UseMutationResult<
  RunSnapshot,
  Error,
  { objectId: string } & CreateRunRequest
> {
  const queryClient = useQueryClient();
  const keys = useScopedQueryKeys();
  return useMutation({
    mutationFn: (input: { objectId: string } & CreateRunRequest) =>
      api.createRun(input.objectId, {
        model_version: input.model_version,
        revision: input.revision,
        input_snapshot: input.input_snapshot,
        ...(input.result === undefined ? {} : { result: input.result }),
      }),
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({ queryKey: keys.runsRoot(input.objectId) });
    },
  });
}

export function useRuns(objectId: string, limit?: number): UseQueryResult<RunSnapshot[]> {
  const keys = useScopedQueryKeys();
  return useQuery({
    queryKey: keys.runs(objectId, limit),
    queryFn: async (): Promise<RunSnapshot[]> => {
      const response: RunsListResponse = await api.listRuns(objectId, limit);
      return response.items;
    },
    enabled: objectId !== '',
    staleTime: 10_000,
  });
}

export function useRun(runId: string): UseQueryResult<RunSnapshot> {
  const keys = useScopedQueryKeys();
  return useQuery({
    queryKey: keys.run(runId),
    queryFn: () => api.getRun(runId),
    enabled: runId !== '',
    staleTime: STATIC_STALE_MS,
  });
}

export function useValidateObject(): UseMutationResult<
  ValidationReport,
  Error,
  { objectId: string; modelVersion: number; revision: number }
> {
  const queryClient = useQueryClient();
  const keys = useScopedQueryKeys();
  return useMutation({
    mutationFn: (input: { objectId: string; modelVersion: number; revision: number }) =>
      api.validateObject(input.objectId, input.modelVersion, input.revision),
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({ queryKey: keys.checks(input.objectId) });
      void queryClient.invalidateQueries({ queryKey: keys.object(input.objectId) });
    },
  });
}

export function useChecks(objectId: string): UseQueryResult<ValidationReport[]> {
  const keys = useScopedQueryKeys();
  return useQuery({
    queryKey: keys.checks(objectId),
    queryFn: async (): Promise<ValidationReport[]> => {
      const response: ChecksListResponse = await api.listChecks(objectId);
      return response.items;
    },
    enabled: objectId !== '',
    staleTime: 10_000,
  });
}
