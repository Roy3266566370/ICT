/**
 * client.ts —— C-API@1 类型化 HTTP 客户端（plan §2.2.7）
 *
 * 约定：
 *  - 所有请求带 `credentials: 'include'`（会话 Cookie 由服务端 HttpOnly 下发，R2-AC1），
 *    以及 `X-Request-Id`；写请求额外带 `X-CSRF-Token`。
 *  - 成功响应对 `{ data, request_id }` 统一解包；错误响应解 `{ error, request_id }`
 *    并抛出 `ApiRequestError`（含 `code` 与 `retryable`，R13-AC1）。
 *  - `GET /materials/{id}/assets/{asset_id}` 返回二进制：只暴露 URL 构造器，
 *    由 `<img src>` 直接携带 Cookie 访问，不读进内存。
 *  - 默认连接真实 API；`VITE_USE_MOCK=true` 时由 `mockClient.ts` 提供离线示例。
 */
import type { LearningPublishSelection } from '@/ppt-ai/learning/types';
import type {
  ApiErrorBody,
  AuthUser,
  CloneExampleResponse,
  CompileResponse,
  CreateRunRequest,
  ErrorCode,
  ISpecScalar,
  ISpecValuesRecord,
  ISpecValuesResult,
  JobStatus,
  KnowledgeObject,
  LoginRequestPayload,
  LoginResult,
  MaterialDetail,
  MaterialRegionsResponse,
  MaterialsListResponse,
  MeResponse,
  ObjectBundleResponse,
  ProfileUpdateResult,
  PublishResult,
  RegionOverridePatch,
  RegionOverrideResult,
  RegisterRequestPayload,
  RetryJobResponse,
  RevokePublishResult,
  RunSnapshot,
  RunsListResponse,
  SendRegisterCodePayload,
  SendRegisterCodeResult,
  SessionInfo,
  ShareSnapshot,
  TemplateDescriptor,
  UpdateMePayload,
  UpdateModelResponse,
  UploadMaterialResponse,
  ValidationReport,
  ChecksListResponse,
} from './types';
import {
  isAuthUser,
  isErrorCode,
  isMeResponse,
  isSendRegisterCodeResult,
  isShareSnapshot,
  isUserProfile,
} from './types';
import { normalizeLimit } from './queryKeys';
import { createMockClient } from './mockClient';

/* -------------------------------------------------------------------------- */
/* 错误类型                                                                   */
/* -------------------------------------------------------------------------- */

/** 业务错误（带 §2.2.8 的错误码），供 UI 按码分支展示。 */
export class ApiRequestError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly status: number;
  readonly requestId: string;
  readonly details: Record<string, unknown> | undefined;

  constructor(params: {
    code: ErrorCode;
    message: string;
    retryable: boolean;
    status: number;
    requestId: string;
    details?: Record<string, unknown>;
  }) {
    super(params.message);
    this.name = 'ApiRequestError';
    this.code = params.code;
    this.retryable = params.retryable;
    this.status = params.status;
    this.requestId = params.requestId;
    this.details = params.details;
  }
}

/** 判定是否为某个业务错误码（避免到处 `as`）。 */
export function isApiError(error: unknown, code?: ErrorCode): error is ApiRequestError {
  if (!(error instanceof ApiRequestError)) return false;
  return code === undefined || error.code === code;
}

/** 从 `unknown` 里读错误信息，供 UI 兜底展示。 */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  if (error instanceof Error) return error.message;
  return '请求失败，请稍后重试';
}

/* -------------------------------------------------------------------------- */
/* 客户端接口                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * 19 个端点的统一接口。`client.ts`（HTTP）与 `mockClient.ts`（离线）都实现它，
 * 因此上层 hooks / 页面完全不需要知道当前跑在哪种模式。
 */
export interface ApiClient {
  readonly mode: 'http' | 'mock';

  /** #1 POST /api/v1/sessions */
  createSession(): Promise<SessionInfo>;
  /** #2 GET /api/v1/sessions/current */
  getCurrentSession(): Promise<SessionInfo>;
  /** #3 GET /api/v1/templates */
  listTemplates(): Promise<TemplateDescriptor[]>;
  /** #4 POST /api/v1/examples/{example_id}/clone */
  cloneExample(exampleId: string): Promise<CloneExampleResponse>;
  /** #5 POST /api/v1/materials（multipart/form-data，字段 file） */
  uploadMaterial(file: File): Promise<UploadMaterialResponse>;
  /** #6 GET /api/v1/materials?limit? */
  listMaterials(limit?: number): Promise<MaterialsListResponse>;
  /** #7 GET /api/v1/materials/{material_id} */
  getMaterial(materialId: string): Promise<MaterialDetail>;
  /** P2 追加：GET /api/v1/materials/{material_id}/regions（基线 + 用户覆盖） */
  listMaterialRegions(materialId: string): Promise<MaterialRegionsResponse>;
  /** P2 追加：PATCH /api/v1/materials/{material_id}/regions/{region_id} */
  patchMaterialRegion(
    materialId: string,
    regionId: string,
    patch: RegionOverridePatch,
  ): Promise<RegionOverrideResult>;
  /**
   * §10.1 第 5 步：GET /api/v1/materials/{material_id}/ispecs/{object_id}/values
   * 读取跨会话保存的 iSpec 参数值；从未保存过时 `values` 为 `{}`。
   */
  getISpecValues(materialId: string, objectId: string): Promise<ISpecValuesRecord>;
  /**
   * §10.1 第 5 步：PUT /api/v1/materials/{material_id}/ispecs/{object_id}/values
   * 整体覆盖保存（自动带 CSRF）；传空 `values` 表示清除。
   */
  putISpecValues(
    materialId: string,
    objectId: string,
    values: Record<string, ISpecScalar>,
    expectedUpdatedAt?: string | null,
  ): Promise<ISpecValuesResult>;
  /** #8 DELETE /api/v1/materials/{material_id}（204 无体） */
  deleteMaterial(materialId: string): Promise<void>;
  /** #9 GET /api/v1/materials/{material_id}/assets/{asset_id}（二进制，返回 URL） */
  getMaterialAssetUrl(materialId: string, assetId: string): string;
  /** #10 GET /api/v1/jobs/{job_id} */
  getJob(jobId: string): Promise<JobStatus>;
  /** #11 POST /api/v1/jobs/{job_id}/retry */
  retryJob(jobId: string): Promise<RetryJobResponse>;
  /** #12 GET /api/v1/objects/{object_id} */
  getObject(objectId: string): Promise<ObjectBundleResponse>;
  /** #13 PUT /api/v1/objects/{object_id}/model */
  updateObjectModel(
    objectId: string,
    expectedVersion: number,
    object: KnowledgeObject,
  ): Promise<UpdateModelResponse>;
  /** #14 POST /api/v1/objects/{object_id}/compile */
  compileObject(objectId: string, modelVersion: number): Promise<CompileResponse>;
  /** #15 POST /api/v1/objects/{object_id}/runs */
  createRun(objectId: string, payload: CreateRunRequest): Promise<RunSnapshot>;
  /** #16 GET /api/v1/objects/{object_id}/runs?limit? */
  listRuns(objectId: string, limit?: number): Promise<RunsListResponse>;
  /** #17 GET /api/v1/runs/{run_id} */
  getRun(runId: string): Promise<RunSnapshot>;
  /** #18 POST /api/v1/objects/{object_id}/validate */
  validateObject(objectId: string, modelVersion: number, revision: number): Promise<ValidationReport>;
  /** #19 GET /api/v1/objects/{object_id}/checks */
  listChecks(objectId: string): Promise<ChecksListResponse>;
  /**
   * P2-10：POST /api/v1/materials/{material_id}/publish
   * 冻结当前材料并返回不可枚举的 `share_id` 与学生端链接。
   */
  publishMaterial(materialId: string, selection?: LearningPublishSelection): Promise<PublishResult>;
  /** P2-10：DELETE /api/v1/materials/{material_id}/publish（撤销全部活链接，幂等） */
  revokeMaterialPublish(materialId: string): Promise<RevokePublishResult>;
  /**
   * P2-10：GET /api/v1/p/{share_id}（公开，无需会话 Cookie）
   * 只读快照；不存在 / 已撤销 → `SESSION_EXPIRED` + HTTP 404。
   */
  getShare(shareId: string): Promise<ShareSnapshot>;

  /* C-WEBAPI@1 追加：账号端点（既有 19 个端点的方法签名一律不变） */

  /** AUTH：POST /api/v1/auth/register/code（匿名，发送 6 位邮箱验证码） */
  sendRegisterCode(payload: SendRegisterCodePayload): Promise<SendRegisterCodeResult>;
  /** AUTH：POST /api/v1/auth/register（匿名，201，不下发 Cookie） */
  registerAccount(payload: RegisterRequestPayload): Promise<AuthUser>;
  /** AUTH：POST /api/v1/auth/login（匿名，200 + Set-Cookie `xs_auth`） */
  loginAccount(payload: LoginRequestPayload): Promise<LoginResult>;
  /** AUTH：POST /api/v1/auth/logout（需 Cookie + `X-CSRF-Token`，204 无体） */
  logoutAccount(): Promise<void>;
  /** AUTH：GET /api/v1/me（需 Cookie；失败 401 `AUTH_REQUIRED`） */
  getMe(): Promise<MeResponse>;
  /** PROFILE：PATCH /api/v1/me（需 Cookie + `X-CSRF-Token`） */
  updateMe(payload: UpdateMePayload): Promise<ProfileUpdateResult>;
  /** PROFILE：POST /api/v1/me/avatar（multipart，字段 file） */
  uploadAvatar(file: Blob, fileName?: string): Promise<ProfileUpdateResult>;
  /** PROFILE：DELETE /api/v1/me/avatar（恢复默认头像，幂等） */
  deleteAvatar(): Promise<ProfileUpdateResult>;
}

/* -------------------------------------------------------------------------- */
/* 环境与请求工具                                                             */
/* -------------------------------------------------------------------------- */

/** API origin；空字符串表示通过同源 /api 代理访问真实后端。 */
export function apiBase(): string {
  const raw = import.meta.env.VITE_API_BASE ?? '';
  return raw.trim().replace(/\/+$/, '');
}

/**
 * 把后端返回的相对资源地址（如 `/api/v1/me/avatar?v=...`）补上 API origin。
 * 已是绝对地址 / blob / data URL 时原样返回。
 */
export function resolveApiAssetUrl(path: string | null | undefined): string | null {
  if (typeof path !== 'string' || path === '') return null;
  if (/^(https?:|blob:|data:)/i.test(path)) return path;
  const base = apiBase();
  return `${base}${path.startsWith('/') ? '' : '/'}${path}`;
}

export function isMockMode(): boolean {
  return import.meta.env.VITE_USE_MOCK === 'true';
}

/** 当前会话的 CSRF 令牌缓存（写请求必需，R13-AC4）。 */
let csrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

export function getCsrfToken(): string | null {
  return csrfToken;
}

/**
 * 账号会话的 CSRF 令牌缓存（C-WEBAPI@1）。
 *
 * **必须与访客 `csrfToken` 是两条独立变量**（§2.3.5 集成风险）：账号登录/登出
 * 不得覆盖访客 CSRF，访客会话刷新也不得覆盖账号 CSRF。否则现有写请求会 422。
 */
let authCsrfToken: string | null = null;

export function setAuthCsrfToken(token: string | null): void {
  authCsrfToken = token;
}

export function getAuthCsrfToken(): string | null {
  return authCsrfToken;
}

function newRequestId(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') {
    return cryptoApi.randomUUID().replace(/-/g, '').slice(0, 16);
  }
  // 退化为时间戳 + 随机数；仅用于追踪，不作安全用途
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`.slice(0, 16);
}

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
let sessionRequest: Promise<void> | null = null;

/** Establish the visitor cookie before any private API request, including uploads. */
async function ensureHttpSession(): Promise<void> {
  if (sessionRequest === null) {
    sessionRequest = (async () => {
      try { await httpApi.getCurrentSession(); }
      catch (error) {
        if (isApiError(error) && error.status === 401) await httpApi.createSession();
        else throw error;
      }
    })().finally(() => { sessionRequest = null; });
  }
  await sessionRequest;
}

/**
 * 组装请求头。
 *
 * `csrfOverride` 语义（C-WEBAPI@1）：
 *  - `undefined`（默认）：沿用访客 `csrfToken` 缓存，保持既有 19 端点行为不变；
 *  - `string`：使用调用方给定的账号 CSRF（如 `getAuthCsrfToken()`）；
 *  - `null`：本次请求**不带** `X-CSRF-Token`（账号匿名端点用，避免串用访客 CSRF）。
 */
function buildHeaders(init: RequestInit | undefined, csrfOverride?: string | null): Headers {
  const headers = new Headers(init?.headers);
  headers.set('X-Request-Id', newRequestId());
  const method = (init?.method ?? 'GET').toUpperCase();
  if (WRITE_METHODS.has(method) && !headers.has('X-CSRF-Token')) {
    const candidate = csrfOverride === undefined ? csrfToken : csrfOverride;
    if (typeof candidate === 'string' && candidate !== '') {
      headers.set('X-CSRF-Token', candidate);
    }
  }
  if (init?.body !== undefined && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  headers.set('Accept', 'application/json');
  return headers;
}

function readErrorBody(raw: unknown): ApiErrorBody | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const container = raw as Record<string, unknown>;
  const error = container['error'];
  if (typeof error !== 'object' || error === null) return null;
  const body = error as Record<string, unknown>;
  const code = body['code'];
  if (!isErrorCode(code)) return null;
  const message = typeof body['message'] === 'string' ? body['message'] : '请求失败';
  const retryable = body['retryable'] === true;
  const details =
    typeof body['details'] === 'object' && body['details'] !== null
      ? (body['details'] as Record<string, unknown>)
      : undefined;
  return details === undefined ? { code, message, retryable } : { code, message, retryable, details };
}

function readRequestId(raw: unknown, fallback: string): string {
  if (typeof raw === 'object' && raw !== null) {
    const value = (raw as Record<string, unknown>)['request_id'];
    if (typeof value === 'string' && value !== '') return value;
  }
  return fallback;
}

/** 解包 `{ data, request_id }`，其余形状按契约违约处理（不静默吞掉）。 */
function unwrap<T>(raw: unknown, requestId: string): T {
  if (typeof raw === 'object' && raw !== null && 'data' in raw) {
    return (raw as { data: T }).data;
  }
  // 204 已在上层单独处理；能到这里说明后端漏包，直接抛错便于定位
  throw new ApiRequestError({
    code: 'MODEL_UNAVAILABLE',
    message: '响应不符合 { data, request_id } 约定',
    retryable: true,
    status: 200,
    requestId: readRequestId(raw, requestId),
  });
}

/** `requestJson` 的追加选项（C-WEBAPI@1）；不传时行为与既有 19 端点完全一致。 */
export interface RequestJsonOptions {
  /**
   * 覆盖 `X-CSRF-Token` 的来源：
   * `undefined` → 访客缓存；`string` → 账号 CSRF；`null` → 不带该头。
   */
  csrfOverride?: string | null;
}

export async function requestJson<T>(
  path: string,
  init?: RequestInit,
  options?: RequestJsonOptions,
): Promise<T> {
  // R11-6：`/me` 与其子路径、`/auth/*` 不得为账号请求预先创建访客会话。
  const isAuthOrMePath =
    path === '/api/v1/me' ||
    path.startsWith('/api/v1/me/') ||
    path.startsWith('/api/v1/auth/');
  if (
    !isAuthOrMePath &&
    !path.startsWith('/api/v1/sessions') &&
    !path.startsWith('/api/v1/p/') &&
    !path.startsWith('/api/v1/lab-shares/')
  ) {
    await ensureHttpSession();
  }
  const requestId = newRequestId();
  const base = apiBase();
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      ...init,
      credentials: 'include',
      headers: buildHeaders(init, options?.csrfOverride),
    });
  } catch (error) {
    // 网络层失败：按可重试的“服务不可用”处理，绝不把堆栈暴露给用户
    throw new ApiRequestError({
      code: 'MODEL_UNAVAILABLE',
      message: '无法连接服务，请确认后端已启动或检查网络',
      retryable: true,
      status: 0,
      requestId,
    });
  }

  const responseRequestId = response.headers.get('X-Request-Id') ?? requestId;
  const contentType = response.headers.get('Content-Type') ?? '';

  if (response.status === 204) {
    return undefined as T;
  }

  if (!response.ok) {
    let raw: unknown = null;
    try {
      raw = await response.json();
    } catch {
      raw = null;
    }
    const body = readErrorBody(raw);
    if (body !== null) {
      throw new ApiRequestError({
        code: body.code,
        message: body.message,
        retryable: body.retryable,
        status: response.status,
        requestId: readRequestId(raw, responseRequestId),
        ...(body.details === undefined ? {} : { details: body.details }),
      });
    }
    throw new ApiRequestError({
      code: 'MODEL_UNAVAILABLE',
      message: `服务返回 ${response.status}${contentType === '' ? '' : `（${contentType}）`}`,
      retryable: true,
      status: response.status,
      requestId: responseRequestId,
    });
  }

  if (!contentType.includes('application/json')) {
    throw new ApiRequestError({
      code: 'MODEL_UNAVAILABLE',
      message: '服务返回了非 JSON 响应，可能被反向代理或登录页拦截',
      retryable: true,
      status: response.status,
      requestId: responseRequestId,
    });
  }

  const raw: unknown = await response.json();
  return unwrap<T>(raw, responseRequestId);
}

/** Authenticated file response: preserve the same visitor session and CSRF rules. */
export async function requestDownload(path:string,body?:unknown):Promise<Blob> {
  await ensureHttpSession();
  let response:Response;
  try {
    response=await fetch(`${apiBase()}${path}`,{method:'POST',credentials:'include',
      headers:buildHeaders({method:'POST',...(body!==undefined?{body:JSON.stringify(body)}:{})}),
      ...(body!==undefined?{body:JSON.stringify(body)}:{})});
  }catch {throw new Error('无法连接服务，请确认后端已启动');}
  if(!response.ok) {
    const raw:unknown=await response.json().catch(()=>null);
    const body=readErrorBody(raw);
    throw new Error(body?.message??`导出失败（${response.status}）`);
  }
  if(!(response.headers.get('content-type')??'').includes('text/html')) throw new Error('导出服务没有返回网页文件');
  return response.blob();
}

/** Authenticated binary download (GET); used by project packages and images. */
export async function requestBinary(path: string, init: RequestInit = {}): Promise<Blob> {
  await ensureHttpSession();
  let response: Response;
  try {
    response = await fetch(`${apiBase()}${path}`, {
      credentials: 'include',
      ...init,
      headers: buildHeaders(init),
    });
  } catch {
    throw new Error('无法连接服务，请确认后端已启动');
  }
  if (!response.ok) {
    const raw: unknown = await response.json().catch(() => null);
    const body = readErrorBody(raw);
    throw new Error(body?.message ?? `下载失败（${response.status}）`);
  }
  return response.blob();
}

/* -------------------------------------------------------------------------- */
/* HTTP 实现                                                                  */
/* -------------------------------------------------------------------------- */

const P = '/api/v1';

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 收窄 `POST /auth/login` 的 data 形状（C-AUTHAPI@1 的 `LoginResult`）。
 * 外部 JSON 一律按 `unknown` 进入，只做字段级 `typeof` 判定；不通过返回 `null`。
 */
function parseLoginResult(raw: unknown): LoginResult | null {
  if (!isRecordValue(raw)) return null;
  const user = raw['user'];
  const csrfToken = raw['csrf_token'];
  const expiresAt = raw['expires_at'];
  const absoluteExpiresAt = raw['absolute_expires_at'];
  if (!isAuthUser(user)) return null;
  if (typeof csrfToken !== 'string' || csrfToken === '') return null;
  if (typeof expiresAt !== 'string' || expiresAt === '') return null;
  if (typeof absoluteExpiresAt !== 'string' || absoluteExpiresAt === '') return null;
  return {
    user,
    csrf_token: csrfToken,
    expires_at: expiresAt,
    absolute_expires_at: absoluteExpiresAt,
  };
}

/** 收窄资料变更响应（`PATCH /me`、头像上传/删除共用）。 */
function parseProfileUpdateResult(raw: unknown): ProfileUpdateResult | null {
  if (!isRecordValue(raw)) return null;
  const user = raw['user'];
  const profile = raw['profile'];
  if (!isAuthUser(user) || !isUserProfile(profile)) return null;
  return { user, profile };
}

/** 响应形状不符合契约时的统一错误（与既有 `getShare` 风格一致）。 */
function contractViolationError(message: string): ApiRequestError {
  return new ApiRequestError({
    code: 'MODEL_UNAVAILABLE',
    message,
    retryable: true,
    status: 200,
    requestId: newRequestId(),
  });
}

export const httpApi: ApiClient = {
  mode: 'http',

  async createSession() {
    const session = await requestJson<SessionInfo>(`${P}/sessions`, { method: 'POST' });
    setCsrfToken(session.csrf_token);
    return session;
  },

  async getCurrentSession() {
    const session = await requestJson<SessionInfo>(`${P}/sessions/current`);
    setCsrfToken(session.csrf_token);
    return session;
  },

  async listTemplates() {
    return requestJson<TemplateDescriptor[]>(`${P}/templates`);
  },

  async cloneExample(exampleId) {
    return requestJson<CloneExampleResponse>(
      `${P}/examples/${encodeURIComponent(exampleId)}/clone`,
      { method: 'POST' },
    );
  },

  async uploadMaterial(file) {
    const form = new FormData();
    form.append('file', file, file.name);
    // 不设置 Content-Type：交给浏览器自动带 multipart boundary
    return requestJson<UploadMaterialResponse>(`${P}/materials`, {
      method: 'POST',
      body: form,
    });
  },

  async listMaterials(limit) {
    const query = `?limit=${normalizeLimit(limit)}`;
    return requestJson<MaterialsListResponse>(`${P}/materials${query}`);
  },

  async getMaterial(materialId) {
    return requestJson<MaterialDetail>(`${P}/materials/${encodeURIComponent(materialId)}`);
  },

  async listMaterialRegions(materialId) {
    return requestJson<MaterialRegionsResponse>(
      `${P}/materials/${encodeURIComponent(materialId)}/regions`,
    );
  },

  async patchMaterialRegion(materialId, regionId, patch) {
    return requestJson<RegionOverrideResult>(
      `${P}/materials/${encodeURIComponent(materialId)}/regions/${encodeURIComponent(regionId)}`,
      { method: 'PATCH', body: JSON.stringify(patch) },
    );
  },

  async getISpecValues(materialId, objectId) {
    return requestJson<ISpecValuesRecord>(
      `${P}/materials/${encodeURIComponent(materialId)}/ispecs/${encodeURIComponent(
        objectId,
      )}/values`,
      { priority: 'low' },
    );
  },

  async putISpecValues(materialId, objectId, values, expectedUpdatedAt) {
    const body: { values: Record<string, ISpecScalar>; expected_updated_at?: string } = {
      values,
    };
    // 显式传 null / undefined 表示"不做乐观锁校验"（首次保存或已合并过冲突）。
    if (typeof expectedUpdatedAt === 'string') body.expected_updated_at = expectedUpdatedAt;
    return requestJson<ISpecValuesResult>(
      `${P}/materials/${encodeURIComponent(materialId)}/ispecs/${encodeURIComponent(
        objectId,
      )}/values`,
      { method: 'PUT', body: JSON.stringify(body) },
    );
  },

  async deleteMaterial(materialId) {
    await requestJson<void>(`${P}/materials/${encodeURIComponent(materialId)}`, {
      method: 'DELETE',
    });
  },

  getMaterialAssetUrl(materialId, assetId) {
    return `${apiBase()}${P}/materials/${encodeURIComponent(materialId)}/assets/${encodeURIComponent(
      assetId,
    )}`;
  },

  async getJob(jobId) {
    return requestJson<JobStatus>(`${P}/jobs/${encodeURIComponent(jobId)}`);
  },

  async retryJob(jobId) {
    return requestJson<RetryJobResponse>(`${P}/jobs/${encodeURIComponent(jobId)}/retry`, {
      method: 'POST',
    });
  },

  async getObject(objectId) {
    return requestJson<ObjectBundleResponse>(`${P}/objects/${encodeURIComponent(objectId)}`);
  },

  async updateObjectModel(objectId, expectedVersion, object) {
    return requestJson<UpdateModelResponse>(`${P}/objects/${encodeURIComponent(objectId)}/model`, {
      method: 'PUT',
      body: JSON.stringify({ expected_version: expectedVersion, object }),
    });
  },

  async compileObject(objectId, modelVersion) {
    return requestJson<CompileResponse>(`${P}/objects/${encodeURIComponent(objectId)}/compile`, {
      method: 'POST',
      body: JSON.stringify({ model_version: modelVersion }),
    });
  },

  async createRun(objectId, payload) {
    return requestJson<RunSnapshot>(`${P}/objects/${encodeURIComponent(objectId)}/runs`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async listRuns(objectId, limit) {
    const query = `?limit=${normalizeLimit(limit)}`;
    return requestJson<RunsListResponse>(`${P}/objects/${encodeURIComponent(objectId)}/runs${query}`);
  },

  async getRun(runId) {
    return requestJson<RunSnapshot>(`${P}/runs/${encodeURIComponent(runId)}`);
  },

  async validateObject(objectId, modelVersion, revision) {
    return requestJson<ValidationReport>(
      `${P}/objects/${encodeURIComponent(objectId)}/validate`,
      { method: 'POST', body: JSON.stringify({ model_version: modelVersion, revision }) },
    );
  },

  async listChecks(objectId) {
    return requestJson<ChecksListResponse>(`${P}/objects/${encodeURIComponent(objectId)}/checks`);
  },

  async publishMaterial(materialId, selection) {
    return requestJson<PublishResult>(
      `${P}/materials/${encodeURIComponent(materialId)}/publish`,
      {
        method: 'POST',
        ...(selection ? { body: JSON.stringify(selection) } : {}),
      },
    );
  },

  async revokeMaterialPublish(materialId) {
    return requestJson<RevokePublishResult>(
      `${P}/materials/${encodeURIComponent(materialId)}/publish`,
      { method: 'DELETE' },
    );
  },

  async getShare(shareId) {
    // 公开端点刻意不带 CSRF（GET 本来也不带），但仍走统一的 Cookie/请求头流程，
    // 这样 5173 → 8000 的 CORS 与错误解析行为与其它端点一致。
    const raw = await requestJson<unknown>(`${P}/p/${encodeURIComponent(shareId)}`);
    if (!isShareSnapshot(raw)) {
      throw new ApiRequestError({
        code: 'MODEL_UNAVAILABLE',
        message: '分享数据格式异常，请稍后重试',
        retryable: true,
        status: 200,
        requestId: newRequestId(),
      });
    }
    return raw;
  },

  /* ---------------- C-WEBAPI@1 追加：账号端点 ---------------- */

  async sendRegisterCode(payload) {
    // 匿名端点：不要求 CSRF（R11-6）。
    const raw = await requestJson<unknown>(
      `${P}/auth/register/code`,
      { method: 'POST', body: JSON.stringify({ email: payload.email }) },
      { csrfOverride: null },
    );
    if (!isSendRegisterCodeResult(raw)) {
      throw contractViolationError('验证码发送响应格式异常，请稍后重试');
    }
    return raw;
  },

  async registerAccount(payload) {
    const body: {
      username: string;
      email: string;
      password: string;
      verification_code: string;
      display_name?: string;
    } = {
      username: payload.username,
      email: payload.email,
      password: payload.password,
      verification_code: payload.verification_code,
    };
    // 契约：仅当 `display_name` 为非空字符串时附加该键，避免把 null/空串当成显式改名。
    if (typeof payload.display_name === 'string' && payload.display_name.trim() !== '') {
      body.display_name = payload.display_name;
    }
    // 匿名端点：不要求 CSRF，也刻意不串用访客 CSRF（R11-6）。
    const raw = await requestJson<unknown>(
      `${P}/auth/register`,
      { method: 'POST', body: JSON.stringify(body) },
      { csrfOverride: null },
    );
    if (!isAuthUser(raw)) {
      throw contractViolationError('注册响应格式异常，请稍后重试');
    }
    return raw;
  },

  async loginAccount(payload) {
    const body: { identifier: string; password: string; remember?: boolean } = {
      identifier: payload.identifier,
      password: payload.password,
    };
    // 契约：`remember` 省略时不下发该键。
    if (payload.remember !== undefined) body.remember = payload.remember;
    const raw = await requestJson<unknown>(
      `${P}/auth/login`,
      { method: 'POST', body: JSON.stringify(body) },
      { csrfOverride: null },
    );
    const result = parseLoginResult(raw);
    if (result === null) {
      throw contractViolationError('登录响应格式异常，请稍后重试');
    }
    // 账号 CSRF 走独立缓存，不触碰访客 csrfToken。
    setAuthCsrfToken(result.csrf_token);
    return result;
  },

  async logoutAccount() {
    // 请求头带账号缓存；为空时 buildHeaders 不会附加该头（契约要求）。
    await requestJson<void>(
      `${P}/auth/logout`,
      { method: 'POST' },
      { csrfOverride: getAuthCsrfToken() },
    );
    // 204 已在 requestJson 内解包；失败会抛 ApiRequestError，此处不会被执行。
    setAuthCsrfToken(null);
  },

  async getMe() {
    const raw = await requestJson<unknown>(`${P}/me`);
    if (!isMeResponse(raw)) {
      throw contractViolationError('账号信息格式异常，请稍后重试');
    }
    // 页面刷新后靠 `/me` 恢复退出能力（R5-3）。
    setAuthCsrfToken(raw.csrf_token);
    return raw;
  },

  async updateMe(payload) {
    const raw = await requestJson<unknown>(
      `${P}/me`,
      { method: 'PATCH', body: JSON.stringify(payload) },
      { csrfOverride: getAuthCsrfToken() },
    );
    const result = parseProfileUpdateResult(raw);
    if (result === null) {
      throw contractViolationError('资料保存响应格式异常，请稍后重试');
    }
    return result;
  },

  async uploadAvatar(file, fileName = 'avatar.jpg') {
    const form = new FormData();
    form.append('file', file, fileName);
    // 不设置 Content-Type：交给浏览器自动带 multipart boundary。
    const raw = await requestJson<unknown>(
      `${P}/me/avatar`,
      { method: 'POST', body: form },
      { csrfOverride: getAuthCsrfToken() },
    );
    const result = parseProfileUpdateResult(raw);
    if (result === null) {
      throw contractViolationError('头像上传响应格式异常，请稍后重试');
    }
    return result;
  },

  async deleteAvatar() {
    const raw = await requestJson<unknown>(
      `${P}/me/avatar`,
      { method: 'DELETE' },
      { csrfOverride: getAuthCsrfToken() },
    );
    const result = parseProfileUpdateResult(raw);
    if (result === null) {
      throw contractViolationError('头像更新响应格式异常，请稍后重试');
    }
    return result;
  },
};

/* -------------------------------------------------------------------------- */
/* 单例                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * 默认真实 HTTP；只有 `VITE_USE_MOCK=true` 才开启离线示例。页面只依赖本单例。
 * 错误类通过工厂注入 mock，使 `mockClient` 对 `client` 只有类型依赖（零运行时循环）。
 */
export const api: ApiClient = isMockMode()
  ? createMockClient({
      makeError: (init) =>
        new ApiRequestError({
          code: init.code,
          message: init.message,
          retryable: init.retryable,
          status: init.status,
          requestId: init.requestId,
          ...(init.details === undefined ? {} : { details: init.details }),
        }),
    })
  : httpApi;
