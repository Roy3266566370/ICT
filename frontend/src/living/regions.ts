import type { PageBlock, PageRegion, PageVariables } from './types.ts';
import { REGION_LABELS } from './types.ts';
import type { CanvasDoc } from '../canvas/types.ts';
import { compileExpression } from '../labs/expr.ts';

export interface RegionStyle {
  left: string;
  top: string;
  width: string;
  height: string;
}

function clamp(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/** 归一化 bbox → 百分比定位；旧文档越界/反序坐标也收敛到可点击区域。 */
export function regionStyle(region: Pick<PageRegion, 'bbox'>): RegionStyle {
  const [rawX0, rawY0, rawX1, rawY1] = region.bbox;
  const x0 = clamp(rawX0 ?? 0);
  const y0 = clamp(rawY0 ?? 0);
  const x1 = clamp(rawX1 ?? 0);
  const y1 = clamp(rawY1 ?? 0);
  const left = Math.min(x0, x1);
  const top = Math.min(y0, y1);
  const right = Math.max(x0, x1);
  const bottom = Math.max(y0, y1);
  return {
    left: `${(left * 100).toFixed(3)}%`,
    top: `${(top * 100).toFixed(3)}%`,
    width: `${(Math.max(0.005, right - left) * 100).toFixed(3)}%`,
    height: `${(Math.max(0.005, bottom - top) * 100).toFixed(3)}%`,
  };
}

export function regionAriaLabel(region: Pick<PageRegion, 'kind' | 'label'>): string {
  const kind = REGION_LABELS[region.kind] ?? '区域';
  return `${kind}：${(region.label || '可交互区域').slice(0, 120)}`;
}

/** 公式区域的受限表达式 → 标准函数图画布（函数源 + 图像 + x₀ 滑杆）。

 *  生成前用受限解析器先编译一次，解析不了的表达式不造画布。
 *  节点 id 固定为 ``f_src``/``f_plot``/``f_x``，``bindings`` 键约定为
 *  ``f_src.<param>``，与 EmbeddedCanvasBlock 的 ``node_id.param_key``
 *  绑定协议一致。 */
export function functionDocForRegion(region: Pick<PageRegion, 'expression'>): CanvasDoc | null {
  const expression = region.expression?.trim();
  if (!expression || expression.length > 500) return null;
  try {
    compileExpression(expression, ['x', 'a', 'b', 'c']);
  } catch {
    return null;
  }
  return {
    version: 1,
    title: '函数图',
    nodes: [
      { id: 'f_src', type: 'functionSource', x: 40, y: 60, params: { a: 1, b: 0, c: 0 }, text: expression },
      { id: 'f_plot', type: 'functionPlot', x: 480, y: 40, params: { min: -3, max: 3, x: 0 } },
      { id: 'f_x', type: 'slider', x: 40, y: 430, params: { v: 0, min: -5, max: 5, step: 0.01 } },
    ],
    wires: [
      { id: 'w_f', from: 'f_src', to: 'f_plot', toPort: 'in' },
      { id: 'w_x', from: 'f_x', to: 'f_plot', toPort: 'x' },
    ],
    strokes: [],
    zoom: 0.85,
  };
}

/** 插入到正文的最小条件：figure/diagram/table 总能落成 figure 块；
 *  公式区域需要 latex 或可求值表达式。 */
export function canInsertRegion(region: PageRegion): boolean {
  if (region.kind === 'formula') {
    return Boolean(region.latex?.trim()) || functionDocForRegion(region) !== null;
  }
  return Boolean(region.asset_id);
}

export interface RegionInsertPlan {
  blocks: PageBlock[];
  /** 写回 ``region.block_id``（公式保真块/图块）；已有锚块时为 undefined。 */
  blockAnchorId?: string;
  /** 写回 ``region.canvas_block_id``（函数图画布块）。 */
  canvasAnchorId?: string;
  /** 需要合并进文档的页面变量（表达式参数 → 滑杆）。 */
  variables: PageVariables;
}

function pickVarName(letter: string, used: Set<string>): string {
  if (!used.has(letter)) return letter;
  for (let index = 2; ; index += 1) {
    const candidate = `${letter}${index}`;
    if (!used.has(candidate)) return candidate;
  }
}

function canvasBlockForRegion(
  region: PageRegion, doc: CanvasDoc, taken: ReadonlySet<string>,
  variables: PageVariables, newId: () => string,
): PageBlock {
  const used = new Set(taken);
  const bindings: Record<string, string> = {};
  for (const param of (region.params ?? []).slice(0, 3)) {
    const name = pickVarName(param, used);
    used.add(name);
    variables[name] = {
      label: `参数 ${param}`,
      type: 'number',
      value: param === 'a' ? 1 : 0,
      // 系数滑杆留足负值探索空间（a<0 翻转抛物线等典型变化）。
      min: -4,
      max: 4,
      step: 0.1,
    };
    bindings[`f_src.${param}`] = name;
  }
  return {
    id: newId(),
    type: 'canvas',
    data: { doc: doc as unknown as Record<string, unknown> },
    bindings,
  };
}

/** 点击「插入到正文」：区域 → 块序列。公式区域落成 formula + canvas 双块
 *  （表达式参数绑定成页面变量滑杆）；图示/表格落成 figure 块。
 *  ``region.block_id`` 已存在（转换期自动生成的 formula 保真块）时
 *  只补 canvas，不重复插入 formula。 */
export function planRegionInsert(
  region: PageRegion,
  taken: ReadonlySet<string>,
  newId: () => string,
): RegionInsertPlan | null {
  const variables: PageVariables = {};
  if (region.kind === 'formula') {
    const latex = (region.latex ?? '').trim();
    const doc = functionDocForRegion(region);
    if (region.block_id) {
      // 公式保真块已在正文：只补交互画布。
      if (!doc) return null;
      const canvas = canvasBlockForRegion(region, doc, taken, variables, newId);
      return { blocks: [canvas], canvasAnchorId: canvas.id, variables };
    }
    if (!latex && !doc) return null;
    const blocks: PageBlock[] = [];
    let blockAnchorId: string | undefined;
    let canvasAnchorId: string | undefined;
    if (latex) {
      blockAnchorId = newId();
      blocks.push({ id: blockAnchorId, type: 'formula', data: { latex: latex.slice(0, 4000) } });
    }
    if (doc) {
      const canvas = canvasBlockForRegion(region, doc, taken, variables, newId);
      canvasAnchorId = canvas.id;
      blocks.push(canvas);
    }
    return { blocks, blockAnchorId, canvasAnchorId, variables };
  }
  const blockId = newId();
  return {
    blocks: [{
      id: blockId,
      type: 'figure',
      data: {
        asset_id: region.asset_id,
        caption: (region.caption || region.label || '').slice(0, 300),
      },
    }],
    blockAnchorId: blockId,
    variables,
  };
}
