import type { ErrorCode } from '@/api/types';

/** 单个错误码的界面文案。文案对齐 plan §2.2.8 的"前端处理"列。 */
export interface ErrorCopy {
  /** 一句话标题，能独立说明发生了什么 */
  title: string;
  /** 具体处置建议，必须可执行 */
  guidance: string;
  /** 是否建议提供"重试"动作 */
  retryable: boolean;
}

export const ERROR_COPY: Record<ErrorCode, ErrorCopy> = {
  INVALID_FILE: {
    title: '这个文件读不了',
    guidance: '请确认是未加密的 .pptx；.ppt 旧格式、含 VBA 宏的 .pptm、损坏的包都不支持。',
    retryable: false,
  },
  LIMIT_EXCEEDED: {
    title: '超出了文件限制',
    guidance: '单文件最多 70 MB、最多 100 页；请压缩图片或拆分后再上传。',
    retryable: false,
  },
  PARSE_FAILED: {
    title: '解析失败',
    guidance: '解析器在读取这份 PPT 时中断了，可以重试一次；重复失败请换一份导出文件。',
    retryable: true,
  },
  MODEL_UNAVAILABLE: {
    title: '结构化候选暂不可用',
    guidance: '原始材料的阅读入口仍然可用，稍后再回到准备页确认候选对象。',
    retryable: true,
  },
  UNSUPPORTED_TEMPLATE: {
    title: '该模板暂不支持',
    guidance: '当前只支持矩阵、力、流程与预算四类模板；可先回退到原始材料阅读。',
    retryable: false,
  },
  MISSING_FIELD: {
    title: '缺少或越界的字段',
    guidance: '按提示检查高亮的参数名与取值范围后重新提交。',
    retryable: false,
  },
  VERSION_CONFLICT: {
    title: '版本冲突',
    guidance: '这份对象已在别处更新；本地修改会保留，重新载入后即可确认。',
    retryable: false,
  },
  SESSION_EXPIRED: {
    title: '会话已过期',
    guidance: '访客会话默认保留 24 小时，请重新进入工作空间后再试。',
    retryable: false,
  },
  /* C-ERR@2 追加：6 个账号错误码，末尾追加，既有 8 条一字未改。
   * 其中 EMAIL_NOT_VERIFIED 与 RATE_LIMITED 为**保留值，本版本不产生**
   * （未实现邮箱验证，限流整体不做），这里只作兜底展示。 */
  AUTH_REQUIRED: {
    title: '请先登录',
    guidance: '登录状态已失效或尚未登录；请使用用户名（或邮箱）与密码登录后重新操作。',
    retryable: false,
  },
  INVALID_CREDENTIALS: {
    title: '用户名或密码不正确',
    guidance: '请确认用户名（或邮箱）与密码后重新输入；出于安全考虑不会提示具体是哪一项错误。',
    retryable: false,
  },
  EMAIL_ALREADY_REGISTERED: {
    title: '该邮箱已注册，可直接登录',
    guidance: '请直接用该邮箱登录，或改用其他邮箱注册。',
    retryable: false,
  },
  FORBIDDEN: {
    title: '账号不可用，请联系管理员',
    guidance: '当前账号状态不允许登录；请联系管理员确认账号状态后再试。',
    retryable: false,
  },
  /** 保留值：本版本不产生（未实现邮箱验证），仅作兜底展示。 */
  EMAIL_NOT_VERIFIED: {
    title: '请先完成邮箱验证',
    guidance: '本版本未实现邮箱验证，该错误码暂不会产生；如遇到请联系管理员。',
    retryable: false,
  },
  /** 保留值：本版本不产生（限流整体不做），仅作兜底展示。 */
  RATE_LIMITED: {
    title: '请求过于频繁，请稍后再试',
    guidance: '本版本未实现限流，该错误码暂不会产生；请稍后重试。',
    retryable: false,
  },
  USERNAME_ALREADY_REGISTERED: {
    title: '该用户名已被占用',
    guidance: '换一个用户名再试；用户名不区分大小写，3–20 位，需以字母开头。',
    retryable: false,
  },
};

/** 界面统一消费的错误展示状态，不依赖后端响应是否完整。 */
export interface NoticeState {
  code: ErrorCode | null;
  message: string;
  retryable: boolean;
}

const UNKNOWN_NOTICE: NoticeState = {
  code: null,
  message: '操作没有完成，请稍后再试。',
  retryable: true,
};

interface ErrorEnvelopeShape {
  error?: { code?: unknown; message?: unknown; retryable?: unknown };
}

function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && value in ERROR_COPY;
}

/**
 * 把任意抛出物（`ApiError` 包体、`Error`、字符串）归一成展示状态。
 * 这里做结构化读取而不是强转 T2 的类型名，避免跨任务类型命名差异导致编译失败。
 */
export function readApiError(thrown: unknown): NoticeState {
  if (typeof thrown === 'object' && thrown !== null) {
    const envelope = thrown as ErrorEnvelopeShape;
    const body = envelope.error;
    if (body && typeof body === 'object') {
      const code = isErrorCode(body.code) ? body.code : null;
      const fallbackTitle = code ? ERROR_COPY[code].title : UNKNOWN_NOTICE.message;
      const message =
        typeof body.message === 'string' && body.message.trim().length > 0
          ? body.message
          : fallbackTitle;
      const retryable =
        typeof body.retryable === 'boolean'
          ? body.retryable
          : code
            ? ERROR_COPY[code].retryable
            : UNKNOWN_NOTICE.retryable;
      return { code, message, retryable };
    }
    const maybeError = thrown as { message?: unknown };
    if (typeof maybeError.message === 'string' && maybeError.message.length > 0) {
      return { code: null, message: maybeError.message, retryable: true };
    }
  }
  if (typeof thrown === 'string' && thrown.length > 0) {
    return { code: null, message: thrown, retryable: true };
  }
  return UNKNOWN_NOTICE;
}