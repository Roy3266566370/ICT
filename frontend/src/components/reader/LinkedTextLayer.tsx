/**
 * LinkedTextLayer.tsx —— 原位覆盖原页文字（rebuild-spec §8）。
 *
 * 三类文字：
 *  1. 原文固定内容：不覆盖（本层只处理 `linked_texts` 声明的元素）；
 *  2. 当前参数计算结果（kind=result）：**仅在偏离原始值后**覆盖，并加"当前值"标识；
 *  3. 只在原始条件下成立的说明（kind=hint）：参数变化后显示"（原页为 … 时）"，
 *     不再以当前结论出现在主阅读区。
 *
 * 组件回传的 `LinkedTextRuntime` 优先（组件最清楚自己的计算结果）；
 * 组件未回报时，宿主按 `linked_texts` 模板自行替换，保证文字与图形同步。
 */
import type { ReactElement } from 'react';
import type { LinkedTextRuntime, PageRegion, RegionLinkedText } from '@/regions/types';
import { bboxToPercent, isRegionChanged } from './regionData';
import styles from './LinkedTextLayer.module.css';

export interface LinkedTextLayerProps {
  region: PageRegion;
  params: Record<string, unknown>;
  /** 组件通过 `onLinkedTexts` 回传的运行时文字（可为空）。 */
  runtime: LinkedTextRuntime[];
  /** 页面宽度 / 1280 的缩放系数，用于让覆盖文字随页面一起缩放。 */
  scale: number;
}

type Vec2 = [number, number];

function formatNumber(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  if (Math.abs(rounded - Math.round(rounded)) < 1e-9) return String(Math.round(rounded));
  return String(rounded);
}

function readNumberArray(value: unknown): Vec2[] | null {
  if (!Array.isArray(value)) return null;
  const out: Vec2[] = [];
  for (const item of value) {
    if (!Array.isArray(item) || item.length < 2) return null;
    const [x, y] = item;
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
      return null;
    }
    out.push([x, y]);
  }
  return out;
}

function readMatrix(params: Record<string, unknown>): [number, number, number, number] | null {
  const { a11, a12, a21, a22 } = params;
  if (
    typeof a11 !== 'number' ||
    typeof a12 !== 'number' ||
    typeof a21 !== 'number' ||
    typeof a22 !== 'number' ||
    ![a11, a12, a21, a22].every((value) => Number.isFinite(value))
  ) {
    return null;
  }
  return [a11, a12, a21, a22];
}

function applyMatrix(matrix: [number, number, number, number], vector: Vec2): Vec2 {
  const [a11, a12, a21, a22] = matrix;
  return [a11 * vector[0] + a12 * vector[1], a21 * vector[0] + a22 * vector[1]];
}

/** 用数值表填充 `{x0}` 等占位符；仍有未填充占位符时返回 null（不覆盖原页）。 */
function fillTemplate(template: string, values: Record<string, string>): string | null {
  const filled = template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key: string) => values[key] ?? match);
  return /\{[a-zA-Z0-9_]+\}/.test(filled) ? null : filled;
}

/** 原页参数的一句话描述，用于 hint 类文字被参数变化"失效"后的说明。 */
function describeOriginal(region: PageRegion): string {
  const matrix = readMatrix(region.original_params);
  if (matrix !== null) {
    const [a11, a12, a21, a22] = matrix;
    return `A=[[${formatNumber(a11)},${formatNumber(a12)}],[${formatNumber(a21)},${formatNumber(a22)}]]`;
  }
  return '原页参数';
}

function resolveText(
  linked: RegionLinkedText,
  index: number,
  region: PageRegion,
  params: Record<string, unknown>,
  changed: boolean,
  runtimeText: LinkedTextRuntime | undefined,
): { text: string; changed: boolean } | null {
  // 1. 组件回报的运行时文字优先（已渲染且不含占位符）
  if (runtimeText !== undefined && !/\{[a-zA-Z0-9_]+\}/.test(runtimeText.text)) {
    return { text: runtimeText.text, changed: runtimeText.changed };
  }

  // 2. hint：只在原参数下成立，参数变化后改为"原页为 … 时"
  if (linked.kind === 'hint') {
    return changed ? { text: `（原页为 ${describeOriginal(region)} 时）`, changed: true } : null;
  }

  // 3. result：参数未变时不覆盖（原页文字已经正确，默认态才能与原页一致）
  if (!changed) return null;

  const vectors = readNumberArray(params.vectors ?? region.original_params.vectors);
  const matrix = readMatrix(params);
  const vector = vectors?.[index];
  if (vectors === null || matrix === null || vector === undefined) return null;

  const image = applyMatrix(matrix, vector);
  const filled = fillTemplate(linked.template, {
    x0: formatNumber(vector[0]),
    y0: formatNumber(vector[1]),
    x1: formatNumber(image[0]),
    y1: formatNumber(image[1]),
  });
  return filled === null ? null : { text: filled, changed: true };
}

export function LinkedTextLayer(props: LinkedTextLayerProps): ReactElement | null {
  const { region, params, runtime, scale } = props;
  const changed = isRegionChanged(region, params);
  const runtimeById = new Map(runtime.map((item) => [item.element_id, item] as const));

  const items = region.linked_texts.flatMap((linked, index) => {
    const resolved = resolveText(linked, index, region, params, changed, runtimeById.get(linked.element_id));
    if (resolved === null) return [];
    return [
      {
        key: linked.element_id,
        style: bboxToPercent(linked.bbox),
        text: resolved.text,
        changed: resolved.changed,
      },
    ];
  });

  if (items.length === 0) return null;

  return (
    <div className={styles.layer} aria-label="随参数更新的原位数值">
      {items.map((item) => (
        <div key={item.key} className={styles.slot} style={item.style} data-changed={item.changed ? 'true' : undefined}>
          <span className={styles.pill} style={{ fontSize: `${12.5 * scale}px` }}>
            {item.text}
          </span>
          {item.changed ? <span className={styles.tag}>当前值</span> : null}
        </div>
      ))}
    </div>
  );
}