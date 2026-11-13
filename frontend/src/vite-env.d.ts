/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * 后端 API 基址（含 `/api/v1` 前缀）。
   * 留空表示走 `src/api/mockClient.ts` 的离线 mock 实现。
   */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}