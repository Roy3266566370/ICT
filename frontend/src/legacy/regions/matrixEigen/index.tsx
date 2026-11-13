/**
 * regions/matrixEigen/index.tsx —— S6「矩阵作用在三条向量上」区域组件入口。
 *
 * 对外契约：`RegionRendererProps`（`@/regions/types` 冻结）。
 *
 * 参数入口**唯一**（rebuild-spec §6：右侧 42px 抽屉由宿主 `ParamDrawer` 渲染）：
 *  - 本组件不再内嵌任何滑块 / 数字输入（内嵌 `RegionPanel` 已停用，文件保留可复用）；
 *  - 参数变更只通过 `onChange` 上抛；区域内部仅提供**拖动端点**与只读数值角标；
 *  - `onLinkedTexts` 回传三行 `(x0, y0) → (x1, y1)`，参数偏离原值时 `changed=true`。
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import type { RegionLinkedText, RegionRendererProps } from '@/regions/types';
import { MatrixEigenScene } from './MatrixEigenScene';
import { isOffOriginal } from './projection';
import {
  DEFAULT_CS,
  DEFAULT_MATRIX,
  DEFAULT_VECTORS,
  PARAM_MAX,
  PARAM_MIN,
  buildLinkedTexts,
  clampParam,
  clampVector,
  eigenSummary,
  fmt,
  readMatrix,
  readVectors,
  type Mat2,
  type Vec2,
} from './scene';
import styles from './matrixEigen.module.css';
import type { MatrixParamKey } from './RegionPanel';

/** 区域未带 `linked_texts` 时的兜底模板：与 spec §4 示例一致。 */
const FALLBACK_TEMPLATE = '({x0}, {y0}) → ({x1}, {y1})';

/** 首帧与客户端一致的宽度估计，避免 hydration 抖动。 */
const DEFAULT_SCREEN_WIDTH = 720;

function clearKey(record: Record<string, string>, key: string): Record<string, string> {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
}

/** 单键 patch：保持 Partial<Mat2> 的精确类型。 */
function patchMatrix(key: MatrixParamKey, value: number): Partial<Mat2> {
  switch (key) {
    case 'a11':
      return { a11: value };
    case 'a12':
      return { a12: value };
    case 'a21':
      return { a21: value };
    case 'a22':
      return { a22: value };
    default:
      return {};
  }
}

export default function MatrixEigenRegion(props: RegionRendererProps): ReactElement {
  const { region, params, onChange, stage, reducedMotion, onLinkedTexts } = props;

  const cs = region.coordinate_system ?? DEFAULT_CS;
  const originalMatrix = useMemo(
    () => readMatrix(region.original_params, DEFAULT_MATRIX),
    [region.original_params],
  );
  const originalVectors = useMemo(
    () => readVectors(region.original_params, DEFAULT_VECTORS),
    [region.original_params],
  );

  const matrix = readMatrix(params, originalMatrix);
  const vectors = readVectors(params, originalVectors);
  const changed = isOffOriginal(params, region.original_params);

  /* ------------------------------ 拖动快照 ------------------------------ */

  const [dragOverride, setDragOverride] = useState<Vec2[] | null>(null);
  const paramsSignature = JSON.stringify(params);

  // 宿主一旦回灌参数（或用户重置），本地快照立即让位，保持"参数唯一来源"
  useEffect(() => {
    setDragOverride(null);
  }, [paramsSignature]);

  const effectiveVectors = dragOverride ?? vectors;

  /* ------------------------------ 参数提交 ------------------------------ */

  const [screenWidth, setScreenWidth] = useState(DEFAULT_SCREEN_WIDTH);
  const hostRef = useRef<HTMLDivElement | null>(null);

  const handleVectorDrag = useCallback(
    (index: number, next: Vec2) => {
      const base: Vec2[] = effectiveVectors.map((item) => [item[0], item[1]] as Vec2);
      const current = base[index];
      if (current === undefined) return;
      base[index] = clampVector(next);
      setDragOverride(base);
      onChange({ vectors: base });
    },
    [effectiveVectors, onChange],
  );

  /**
   * 组件内参数抽屉（默认收起）：6 个可调参数 = 4 个矩阵元素 + 当前向量的两个分量。
   * 宿主 `ParamDrawer` 也能改同一批数值，二者共用 `onChange`，参数仍只有一份。
   */
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState(0);
  const [collapsed, setCollapsed] = useState(true);

  /** 越界 / 非法输入不写入，只记录原因（任务 R3-2、spec §8）。 */
  const parseParam = useCallback((key: string, label: string, raw: string): number | null => {
    const text = raw.trim();
    if (text === '' || !/^-?\d*(\.\d*)?$/.test(text)) {
      setErrors((previous) => ({ ...previous, [key]: `${label} 需要数字，已忽略 "${raw}"` }));
      return null;
    }
    const value = Number(text);
    if (!Number.isFinite(value)) {
      setErrors((previous) => ({ ...previous, [key]: `${label} 需要有限数字，已忽略 "${raw}"` }));
      return null;
    }
    if (value < PARAM_MIN || value > PARAM_MAX) {
      setErrors((previous) => ({
        ...previous,
        [key]: `${label} 需在 [${PARAM_MIN}, ${PARAM_MAX}] 内，已忽略 ${value}`,
      }));
      return null;
    }
    setErrors((previous) => clearKey(previous, key));
    return clampParam(value);
  }, []);

  const handleMatrixParam = useCallback(
    (key: MatrixParamKey, raw: string) => {
      const value = parseParam(key, key, raw);
      if (value === null) return;
      onChange({ ...patchMatrix(key, value) });
    },
    [onChange, parseParam],
  );

  const handleVectorParam = useCallback(
    (index: number, axis: 0 | 1, raw: string) => {
      const label = axis === 0 ? 'x' : 'y';
      const value = parseParam(`v${index}${label}`, `v${index + 1}.${label}`, raw);
      if (value === null) return;
      const base: Vec2[] = effectiveVectors.map((item) => [item[0], item[1]] as Vec2);
      const target = base[index];
      if (target === undefined) return;
      target[axis] = value;
      setDragOverride(base);
      onChange({ vectors: base });
    },
    [effectiveVectors, onChange, parseParam],
  );

  /* ------------------------------ 文字同步 ------------------------------ */

  const linkedTexts = useMemo<RegionLinkedText[]>(() => {
    if (region.linked_texts.length >= 3) return region.linked_texts;
    const template = region.linked_texts[0]?.template ?? FALLBACK_TEMPLATE;
    const synthetic: RegionLinkedText[] = Array.from({ length: 3 }, (_unused, index) => ({
      element_id: `rgn_s06_vec${index + 1}`,
      bbox: { x: 0, y: 0, w: 0, h: 0 },
      template,
      kind: 'result',
    }));
    return [...region.linked_texts, ...synthetic].slice(0, 3);
  }, [region.linked_texts]);

  const linkedOutputs = useMemo(
    () =>
      buildLinkedTexts(linkedTexts, effectiveVectors, matrix, {
        matrix: originalMatrix,
        vectors: originalVectors,
      }).map((item) => ({ ...item, changed: item.changed || changed })),
    [linkedTexts, effectiveVectors, matrix, originalMatrix, originalVectors, changed],
  );

  const linkedSignature = linkedOutputs
    .map((item) => `${item.element_id}|${item.changed ? 1 : 0}|${item.text}`)
    .join('\n');

  // 用 ref 持有最新回调，避免宿主每次渲染传新函数导致重复回传
  const linkedCallbackRef = useRef(onLinkedTexts);
  linkedCallbackRef.current = onLinkedTexts;

  useEffect(() => {
    linkedCallbackRef.current(linkedOutputs);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在文字内容变化时回传
  }, [linkedSignature]);

  /* ------------------------------ 尺寸测量 ------------------------------ */

  useEffect(() => {
    const element = hostRef.current;
    if (element === null || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (typeof width === 'number' && width > 0) setScreenWidth(width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const summary = eigenSummary(matrix);

  return (
    <div className={styles.root} ref={hostRef} data-region-id={region.region_id}>
      <MatrixEigenScene
        cs={cs}
        matrix={matrix}
        vectors={effectiveVectors}
        stage={stage}
        reducedMotion={reducedMotion}
        screenWidth={screenWidth}
        onVectorChange={handleVectorDrag}
      />
      {/*
        参数入口唯一：滑块 / 数字输入由宿主 `ParamDrawer` 渲染（rebuild-spec §6）。
        内嵌 `RegionPanel` 已停用（组件文件保留，便于宿主复用），区域内只保留只读数值。
      */}
      {/* 只读数值角标：与参数抽屉互不替代，随时可见（spec §8 第 2 类文字） */}
      <p className={styles.readout} aria-live="polite">
        det A = {fmt(summary.det)} · tr A = {fmt(summary.trace)}
        {summary.values === null
          ? ' · λ 为复数'
          : ` · λ = ${fmt(summary.values[0])} / ${fmt(summary.values[1])}`}
      </p>
    </div>
  );
}