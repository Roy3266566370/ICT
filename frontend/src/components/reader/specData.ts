/**
 * `specData.ts` —— 读取材料上的 iSpec（通用运行时的输入）。
 *
 * 数据来源（按优先级）：
 * 1. 材料详情里下发的 iSpec（后端 P0-05 产物，字段名兼容 `ispec` / `ispecs` / `specs`）；
 * 2. `/fixtures/materials/<material_id>/ispec.json`（或 `ispecs.json` / `objects.json` 内的 iSpec）；
 * 3. 没有 → 返回空的 `specs`，工作台回退到现有 regions 组件（不伪造 iSpec）。
 *
 * 与 P0-01 一致：fixtures 路径**只探测当前 material_id 自己的目录**，
 * 示例材料额外登记 `matrix-courseware` 别名，绝不把示例产物兜底给用户上传材料。
 */
import { useEffect, useMemo, useState } from 'react';
import type { MaterialDetail } from '@/api/types';
import { validateISpecLite } from '@/ispec/types';
import type { ISpec } from '@/ispec/types';
import { isExampleMaterial } from './regionData';

export type SpecDataSource = 'detail' | 'fixtures' | 'none';

export interface SpecRecognition {
  found: boolean;
  reason: string;
  coverage?: Record<string, unknown>;
}

export interface MaterialSpecsState {
  specs: ISpec[];
  loading: boolean;
  source: SpecDataSource;
  detail: string;
  recognition: SpecRecognition;
}

const SPEC_FIELDS = ['ispec', 'ispecs', 'spec', 'specs'] as const;
const CONTAINER_FIELDS = ['objects', 'items', 'data'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isISpecShape(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && value['spec_version'] === '1.0' && typeof value['object_id'] === 'string';
}

interface CollectResult {
  specs: ISpec[];
  invalid: number;
  recognition?: { reason: string; coverage?: Record<string, unknown> };
}

function readRecognition(value: unknown): { reason: string; coverage?: Record<string, unknown> } | null {
  if (!isRecord(value)) return null;
  const recognition = value['recognition'];
  if (!isRecord(recognition)) return null;
  const reason = typeof recognition['reason'] === 'string' ? recognition['reason'] : '';
  const coverage = isRecord(recognition['coverage']) ? recognition['coverage'] : undefined;
  if (!reason && coverage === undefined) return null;
  return { reason, coverage };
}

/** 递归收集 iSpec（最多两层，避免把任意大对象翻遍）。 */
function collectSpecs(value: unknown, depth: number, acc: CollectResult): void {
  if (depth > 2) return;
  if (Array.isArray(value)) {
    value.forEach((item) => collectSpecs(item, depth + 1, acc));
    return;
  }
  if (!isRecord(value)) return;

  const recognition = readRecognition(value);
  if (recognition !== null) {
    const previous = acc.recognition;
    if (!previous || recognition.reason.length > previous.reason.length) {
      acc.recognition = recognition;
    }
  }

  if (isISpecShape(value)) {
    const issues = validateISpecLite(value);
    if (issues.length === 0) acc.specs.push(value as unknown as ISpec);
    else acc.invalid += 1;
    return;
  }

  for (const field of SPEC_FIELDS) collectSpecs(value[field], depth + 1, acc);
  for (const field of CONTAINER_FIELDS) collectSpecs(value[field], depth + 1, acc);
}

function readSpecs(value: unknown): CollectResult {
  const acc: CollectResult = { specs: [], invalid: 0 };
  collectSpecs(value, 0, acc);
  // 去重（同一份 iSpec 可能同时出现在详情与对象里）
  const seen = new Set<string>();
  acc.specs = acc.specs.filter((spec) => {
    const key = `${spec.object_id}:${spec.kind}:${spec.parameters.length}:${spec.views.length}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return acc;
}

/** 材料详情里下发的 iSpec（后端字段未定，按扩展字段兼容读取）。 */
export function readEmbeddedSpecs(detail: MaterialDetail | null): ISpec[] {
  if (detail === null) return [];
  return readSpecs(detail as unknown).specs;
}

function fixtureDirsFor(materialId: string): string[] {
  const dirs = [materialId];
  if (isExampleMaterial(materialId) && materialId !== 'matrix-courseware') {
    dirs.push('matrix-courseware');
  }
  return dirs;
}

function candidateUrls(materialId: string): string[] {
  return [
    // 后端产物优先：0 条 iSpec 时也要读取 recognition.reason/coverage 说明原因。
    `/api/v1/materials/${encodeURIComponent(materialId)}/ispecs`,
    ...fixtureDirsFor(materialId).flatMap((dir) => [
      `/fixtures/materials/${encodeURIComponent(dir)}/ispec.json`,
      `/fixtures/materials/${encodeURIComponent(dir)}/ispecs.json`,
      `/fixtures/materials/${encodeURIComponent(dir)}/objects.json`,
    ]),
  ];
}

const NONE_REASON = '材料未提供 iSpec 产物（详情字段与 ispec.json 均缺失）';

export function useMaterialSpecs(
  materialId: string | null,
  detail: MaterialDetail | null,
): MaterialSpecsState {
  const embedded = useMemo(() => readEmbeddedSpecs(detail), [detail]);
  const embeddedKey = useMemo(
    () => embedded.map((spec) => `${spec.object_id}:${spec.kind}`).join('|'),
    [embedded],
  );

  const [fetched, setFetched] = useState<MaterialSpecsState>(() => ({
    specs: [],
    loading: materialId !== null,
    source: 'none',
    detail: '正在读取 iSpec…',
    recognition: { found: false, reason: '正在读取 iSpec…' },
  }));

  useEffect(() => {
    if (materialId === null) {
      setFetched({
        specs: [],
        loading: false,
        source: 'none',
        detail: '缺少材料编号，无法读取 iSpec。',
        recognition: { found: false, reason: '缺少材料编号' },
      });
      return undefined;
    }
    if (embedded.length > 0) {
      setFetched({
        specs: [],
        loading: false,
        source: 'none',
        detail: 'iSpec 由材料详情下发。',
        recognition: { found: false, reason: '' },
      });
      return undefined;
    }

    const controller = new AbortController();
    setFetched({
      specs: [],
      loading: true,
      source: 'none',
      detail: '正在读取 iSpec…',
      recognition: { found: false, reason: '正在读取 iSpec…' },
    });

    const tryLoad = async (): Promise<CollectResult> => {
      const acc: CollectResult = { specs: [], invalid: 0 };
      for (const url of candidateUrls(materialId)) {
        try {
          const response = await fetch(url, {
            signal: controller.signal,
            headers: { Accept: 'application/json' },
          });
          if (!response.ok) continue;
          const json: unknown = await response.json();
          const loaded = readSpecs(json);
          loaded.specs.forEach((spec) => acc.specs.push(spec));
          acc.invalid += loaded.invalid;
          if (acc.recognition === undefined && loaded.recognition !== undefined) {
            acc.recognition = loaded.recognition;
          }
          if (acc.specs.length > 0) break;
        } catch {
          if (controller.signal.aborted) return acc;
        }
      }
      return acc;
    };

    void tryLoad()
      .then((result) => {
        if (controller.signal.aborted) return;
        const valid = result.specs;
        const backendReason = result.recognition?.reason?.trim() ?? '';
        if (valid.length > 0) {
          setFetched({
            specs: valid,
            loading: false,
            source: 'fixtures',
            detail: `iSpec 数据：${valid.length} 份（材料产物）`,
            recognition: {
              found: true,
              reason: backendReason || `已读取 ${valid.length} 份 iSpec`,
              ...(result.recognition?.coverage ? { coverage: result.recognition.coverage } : {}),
            },
          });
        } else {
          const fallbackReason =
            result.invalid > 0
              ? `${NONE_REASON}；另有 ${result.invalid} 份结构不合法已被忽略`
              : NONE_REASON;
          setFetched({
            specs: [],
            loading: false,
            source: 'none',
            detail: 'iSpec 数据：未提供，回退到区域组件。',
            recognition: {
              found: false,
              reason: backendReason || fallbackReason,
              ...(result.recognition?.coverage ? { coverage: result.recognition.coverage } : {}),
            },
          });
        }
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setFetched({
          specs: [],
          loading: false,
          source: 'none',
          detail: 'iSpec 数据：读取失败，回退到区域组件。',
          recognition: { found: false, reason: '读取 iSpec 失败（网络或格式异常）' },
        });
      });

    return () => {
      controller.abort();
    };
    // `embedded` 由 embeddedKey 代表；避免详情对象每次重建都触发重新拉取。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materialId, embeddedKey]);

  if (embedded.length > 0) {
    return {
      specs: embedded,
      loading: false,
      source: 'detail',
      detail: `iSpec 数据：${embedded.length} 份（材料详情）`,
      recognition: { found: true, reason: `已读取 ${embedded.length} 份 iSpec` },
    };
  }

  return fetched;
}

/**
 * 当前页命中的 iSpec。
 *
 * 优先按 `region_id === object_id` 精确匹配；否则退回"参数/检查项来源页码等于当前页"的
 * 第一份。没有任何页码证据时返回 null（不把别的页的 iSpec 硬套到本页）。
 */
export function pickSpecForPage(
  specs: ISpec[],
  page: number,
  regionId: string | null,
): ISpec | null {
  const byPage = specs.filter(
    (spec) =>
      spec.parameters.some((parameter) => parameter.source.page === page) ||
      (spec.checks ?? []).some((check) => check.page === page),
  );
  if (byPage.length === 0) return null;
  if (regionId !== null) {
    const exact = byPage.find((spec) => spec.object_id === regionId);
    if (exact !== undefined) return exact;
  }
  return byPage[0] ?? null;
}