/**
 * regions/matrixColumns/index.tsx —— S9「矩阵各列与基向量」区域组件入口。
 *
 * 契约：`RegionRendererProps`（`@/regions/types` 冻结）。
 *
 * 参数入口**唯一**（rebuild-spec §6）：滑块 / 数字输入由宿主 `ParamDrawer` 统一渲染，
 * 本组件内嵌面板已停用；区域内部保留两条交互与只读数值：
 *  - 拖动两列的箭头端点 → 反推矩阵列（col₁=(a11,a21)、col₂=(a12,a22)），走 `onChange`；
 *  - 右下角只读角标显示 rank 与两列当前值（退化时附文案）。
 *  - `stage` 控制组合过程：0 原像 / 1 显示 v₁·col₁ / 2 加上 v₂·col₂ 与合向量 A·v。
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
import { MatrixColumnsScene } from './MatrixColumnsScene';
import { isOffOriginal } from './scene';
import {
  DEFAULT_CS,
  DEFAULT_MATRIX,
  DEFAULT_VECTOR,
  PARAM_MAX,
  PARAM_MIN,
  buildColumnsModel,
  buildLinkedTexts,
  clampParam,
  clampVector,
  degenerationNotice,
  fmt,
  readInputVector,
  readMatrix,
  type Mat2,
  type Vec2,
} from './scene';
import styles from './matrixColumns.module.css';
import type { ColumnsParamKey } from './RegionPanel';

const DEFAULT_SCREEN_WIDTH = 720;

function clearKey(record: Record<string, string>, key: string): Record<string, string> {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
}

function patchMatrix(key: ColumnsParamKey, value: number): Partial<Mat2> {
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

/** 区域未带 `linked_texts` 时补三条：e₁→col₁、e₂→col₂、v→A·v。 */
function linkedRows(regionLinked: RegionLinkedText[]): RegionLinkedText[] {
  if (regionLinked.length >= 3) return regionLinked;
  const synthetic: RegionLinkedText[] = [
    {
      element_id: 'rgn_s09_e1',
      bbox: { x: 0, y: 0, w: 0, h: 0 },
      template: 'e₁ = (1, 0) → ({x1}, {y1})',
      kind: 'result',
    },
    {
      element_id: 'rgn_s09_e2',
      bbox: { x: 0, y: 0, w: 0, h: 0 },
      template: 'e₂ = (0, 1) → ({x1}, {y1})',
      kind: 'result',
    },
    {
      element_id: 'rgn_s09_v',
      bbox: { x: 0, y: 0, w: 0, h: 0 },
      template: 'v = ({v1}, {v2}) → A·v = ({x1}, {y1})',
      kind: 'result',
    },
  ];
  return [...regionLinked, ...synthetic].slice(0, 3);
}

export default function MatrixColumnsRegion(props: RegionRendererProps): ReactElement {
  const { region, params, onChange, stage, reducedMotion, onLinkedTexts } = props;

  const cs = region.coordinate_system ?? DEFAULT_CS;
  const originalMatrix = useMemo(
    () => readMatrix(region.original_params, DEFAULT_MATRIX),
    [region.original_params],
  );
  const originalVector = useMemo(
    () => readInputVector(region.original_params, DEFAULT_VECTOR),
    [region.original_params],
  );

  const matrix = readMatrix(params, originalMatrix);
  const vector = readInputVector(params, originalVector);
  const changed = isOffOriginal(
    { ...matrix, v1: vector[0], v2: vector[1] },
    { ...originalMatrix, v1: originalVector[0], v2: originalVector[1] },
  );

  /* ------------------------------ 拖动快照 ------------------------------ */

  const [dragOverride, setDragOverride] = useState<{ matrix: Mat2; vector: Vec2 } | null>(null);
  const paramsSignature = JSON.stringify(params);

  useEffect(() => {
    setDragOverride(null);
  }, [paramsSignature]);

  const effectiveMatrix = dragOverride?.matrix ?? matrix;
  const effectiveVector = dragOverride?.vector ?? vector;

  /* ------------------------------ 拖动反推矩阵列 ------------------------------ */

  const [screenWidth, setScreenWidth] = useState(DEFAULT_SCREEN_WIDTH);
  const hostRef = useRef<HTMLDivElement | null>(null);

  const handleColumnChange = useCallback(
    (index: 0 | 1, next: Vec2) => {
      const clamped = clampVector(next);
      const patch: Partial<Mat2> =
        index === 0 ? { a11: clamped[0], a21: clamped[1] } : { a12: clamped[0], a22: clamped[1] };
      const nextMatrix: Mat2 = { ...effectiveMatrix, ...patch };
      setDragOverride({ matrix: nextMatrix, vector: effectiveVector });
      onChange({ ...patch });
    },
    [effectiveMatrix, effectiveVector, onChange],
  );

  /* ------------------------------ 参数抽屉 ------------------------------ */

  const [errors, setErrors] = useState<Record<string, string>>({});
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
    (key: ColumnsParamKey, raw: string) => {
      const value = parseParam(key, key, raw);
      if (value === null) return;
      const patch = patchMatrix(key, value);
      const nextMatrix: Mat2 = { ...effectiveMatrix, ...patch };
      setDragOverride({ matrix: nextMatrix, vector: effectiveVector });
      onChange({ ...patch });
    },
    [effectiveMatrix, effectiveVector, onChange, parseParam],
  );

  const handleVectorParam = useCallback(
    (axis: 0 | 1, raw: string) => {
      const name = axis === 0 ? 'v₁' : 'v₂';
      const value = parseParam(axis === 0 ? 'v1' : 'v2', name, raw);
      if (value === null) return;
      const next: Vec2 =
        axis === 0 ? [value, effectiveVector[1]] : [effectiveVector[0], value];
      setDragOverride({ matrix: effectiveMatrix, vector: next });
      onChange({ vector: next });
    },
    [effectiveMatrix, effectiveVector, onChange, parseParam],
  );

  /* ------------------------------ 文字同步 ------------------------------ */

  const linkedTexts = useMemo(() => linkedRows(region.linked_texts), [region.linked_texts]);
  const model = useMemo(
    () => buildColumnsModel(effectiveMatrix, effectiveVector),
    [effectiveMatrix, effectiveVector],
  );

  const linkedOutputs = useMemo(
    () =>
      buildLinkedTexts(linkedTexts, model, {
        matrix: originalMatrix,
        vector: originalVector,
      }).map((item) => ({ ...item, changed: item.changed || changed })),
    [linkedTexts, model, originalMatrix, originalVector, changed],
  );

  const linkedSignature = linkedOutputs
    .map((item) => `${item.element_id}|${item.changed ? 1 : 0}|${item.text}`)
    .join('\n');

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

  const notice = degenerationNotice(model);

  return (
    <div className={styles.root} ref={hostRef} data-region-id={region.region_id}>
      <MatrixColumnsScene
        cs={cs}
        matrix={effectiveMatrix}
        vector={effectiveVector}
        stage={stage}
        reducedMotion={reducedMotion}
        screenWidth={screenWidth}
        onColumnChange={handleColumnChange}
      />
      {/*
        参数入口唯一：滑块 / 数字输入由宿主 `ParamDrawer` 渲染（rebuild-spec §6）。
        内嵌 `RegionPanel` 已停用（组件文件保留，便于宿主复用），区域内只保留只读数值。
      */}
      {/* 只读数值角标：与参数抽屉互不替代，随时可见 */}
      <p className={styles.readout} aria-live="polite">
        rank = {model.rank} · col₁ = ({fmt(model.col1[0])}, {fmt(model.col1[1])}) · col₂ = (
        {fmt(model.col2[0])}, {fmt(model.col2[1])})
      </p>
      {notice === null ? null : <p className={styles.noticeTag}>{notice}</p>}
    </div>
  );
}