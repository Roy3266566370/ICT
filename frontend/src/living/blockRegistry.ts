import type { PageBlock } from './types';

export interface BlockField {
  key: string;
  label: string;
  kind: 'text' | 'textarea' | 'number' | 'url' | 'select' | 'checkbox' | 'bindings' | 'gate';
  /** kind === 'select' 时的候选值 */
  options?: { value: string; label: string }[];
  /** kind === 'bindings' 或 'gate' 时的占位提示 */
  hint?: string;
}

interface BlockDefinition {
  label: string;
  fields: readonly BlockField[];
}

const BINDINGS_FIELD: BlockField = {
  key: 'bindings',
  label: '变量绑定（块内参数 ← 页面变量）',
  kind: 'bindings',
  hint: 'lab 填引擎参数名；canvas 填 node_id.param_key 精确坐标',
};

const GATE_FIELD: BlockField = {
  key: 'locked_until',
  label: '门控（先完成指定作答再解锁）',
  kind: 'gate',
  hint: '读者完成所选的先猜再看/判分点后，本块才显示',
};

export const blockRegistry: Partial<Record<PageBlock['type'], BlockDefinition>> = Object.assign(Object.create(null), {
  text: { label: '文字', fields: [{ key: 'md', label: '正文（Markdown，支持 ${变量} / ${expr: 表达式} / ${条件 ? a : b} 与 [v:变量] 胶囊）', kind: 'textarea' }, GATE_FIELD] },
  formula: { label: '公式', fields: [{ key: 'latex', label: '公式（LaTeX，支持 ${变量} 插值）', kind: 'textarea' }, GATE_FIELD] },
  section: { label: '小节', fields: [
    { key: 'heading', label: '小节标题', kind: 'text' },
    { key: 'level', label: '标题层级（1、2 或 3）', kind: 'number' },
    GATE_FIELD,
  ] },
  callout: { label: '知识卡片', fields: [
    { key: 'kind', label: '卡片类型', kind: 'select', options: [
      { value: 'theorem', label: '定理' },
      { value: 'proof', label: '证明' },
      { value: 'example', label: '例题' },
      { value: 'warning', label: '易错提示' },
    ] },
    { key: 'title', label: '标题（可留空）', kind: 'text' },
    { key: 'md', label: '正文（Markdown）', kind: 'textarea' },
    { key: 'collapsible', label: '允许折叠', kind: 'checkbox' },
    GATE_FIELD,
  ] },
  quiz: { label: '先猜再看', fields: [
    { key: 'question', label: '问题', kind: 'textarea' },
    { key: 'answer', label: '答案说明', kind: 'textarea' },
    { key: 'explain', label: '解析', kind: 'textarea' },
    { key: 'min', label: '最小值', kind: 'number' },
    { key: 'max', label: '最大值', kind: 'number' },
    { key: 'value', label: '实际值', kind: 'number' },
    GATE_FIELD,
  ] },
  checkpoint: { label: '判分点', fields: [
    { key: 'prompt', label: '题目提示', kind: 'textarea' },
    { key: 'expected', label: '参考答案', kind: 'textarea' },
    { key: 'placeholder', label: '输入框占位提示', kind: 'text' },
    { key: 'grading', label: '判分模式', kind: 'select', options: [
      { value: 'exact', label: '精确文本（宽松比对）' },
      { value: 'expr', label: '数学等价（1/2 ≡ 0.5）' },
      { value: 'numeric', label: '纯数值' },
    ] },
    GATE_FIELD,
  ] },
  lab: { label: '解题实验', fields: [BINDINGS_FIELD, GATE_FIELD] },
  canvas: { label: '工坊画布', fields: [{ ...BINDINGS_FIELD, hint: '格式 node_id.param_key，例如 k1.learning_rate' }, GATE_FIELD] },
  embed: { label: '嵌入', fields: [
    { key: 'url', label: '网页地址（可留空，或填写 http/https URL）', kind: 'url' },
    { key: 'height', label: '高度（120–1200 像素）', kind: 'number' },
    GATE_FIELD,
  ] },
});

export function blockDraft(block: PageBlock): Record<string, string> {
  const data = block.data as Record<string, unknown>;
  const draft = Object.fromEntries(
    (blockRegistry[block.type]?.fields ?? [])
      .filter(({ kind }) => kind !== 'bindings' && kind !== 'gate')
      .map(({ key, kind }) => [key, kind === 'checkbox' ? (data[key] ? 'true' : 'false') : String(data[key] ?? '')]),
  );
  const fields = blockRegistry[block.type]?.fields ?? [];
  if (fields.some(({ kind }) => kind === 'bindings')) {
    draft.bindings = JSON.stringify(block.bindings ?? {});
  }
  if (fields.some(({ kind }) => kind === 'gate')) {
    draft.locked_until = block.locked_until ? JSON.stringify(block.locked_until) : '';
  }
  return draft;
}

export function parseBlockDraft(block: PageBlock, draft: Record<string, string>): {
  block: PageBlock | null;
  errors: Record<string, string>;
} {
  const definition = blockRegistry[block.type];
  if (!definition) return { block: null, errors: { form: '此块暂不支持编辑。' } };
  const data: Record<string, unknown> = { ...block.data };
  const errors: Record<string, string> = {};
  let bindings = block.bindings;
  let lockedUntil = block.locked_until;
  for (const field of definition.fields) {
    const raw = draft[field.key] ?? '';
    if (field.kind === 'gate') {
      const trimmed = raw.trim();
      if (!trimmed || trimmed === '{}') {
        lockedUntil = undefined;
        continue;
      }
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('bad gate');
        const gate = parsed as Record<string, unknown>;
        const target = gate.block_id;
        const rule = gate.rule === undefined ? 'submitted' : gate.rule;
        if (typeof target !== 'string' || !target.trim()) throw new Error('bad gate');
        if (target === block.id) {
          errors[field.key] = '门控不能指向块自身。';
          continue;
        }
        if (rule !== 'submitted' && rule !== 'correct') throw new Error('bad gate');
        lockedUntil = { block_id: target.trim(), rule };
      } catch {
        errors[field.key] = '门控格式无效：应为 {"block_id":"目标块","rule":"submitted|correct"}。';
      }
      continue;
    }
    if (field.kind === 'bindings') {
      const trimmed = raw.trim();
      if (!trimmed || trimmed === '{}') {
        bindings = undefined;
        continue;
      }
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)
          || Object.entries(parsed as Record<string, unknown>).some(([k, v]) => !k || typeof v !== 'string' || !/^[A-Za-z][A-Za-z0-9_]*$/.test(v))) {
          throw new Error('bad bindings');
        }
        bindings = parsed as Record<string, string>;
      } catch {
        errors[field.key] = '绑定格式无效：应为 {"块内参数": "变量名"} 的 JSON，例如 {"lr":"eta"} 或 {"k1.rate":"eta"}。';
      }
      continue;
    }
    if (field.kind === 'checkbox') {
      data[field.key] = raw === 'true';
      continue;
    }
    if (field.kind === 'number') {
      const value = Number(raw);
      if (!raw.trim() || !Number.isFinite(value)) errors[field.key] = `${field.label}必须是有限数值，不能留空。`;
      else data[field.key] = value;
    } else if (field.kind === 'url') {
      const url = raw.trim();
      data[field.key] = url;
      if (url) {
        try {
          const parsed = new URL(url);
          if (!/^https?:\/\//i.test(url) || !['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname
            || parsed.username || parsed.password || /[\s\\\u0000-\u001f\u007f]/.test(url) || url.length > 2000) throw new Error();
        } catch {
          errors[field.key] = '请输入有效的 http:// 或 https:// 网页地址，或留空。';
        }
      }
    } else data[field.key] = raw;
  }
  if (block.type === 'section' && !errors.level && ![1, 2, 3].includes(Number(data.level))) {
    errors.level = '标题层级只能是 1、2 或 3。';
  }
  if (block.type === 'quiz') {
    if (!errors.min && !errors.max && Number(data.min) >= Number(data.max)) errors.max = '最大值必须大于最小值。';
    if (!errors.min && !errors.max && !errors.value && (Number(data.value) < Number(data.min) || Number(data.value) > Number(data.max))) {
      errors.value = '实际值必须在最小值与最大值之间（含端点）。';
    }
  }
  if (block.type === 'callout') {
    if (!['theorem', 'proof', 'example', 'warning'].includes(String(data.kind))) {
      errors.kind = '卡片类型只能是 theorem / proof / example / warning。';
    }
  }
  if (block.type === 'embed' && !errors.height && (Number(data.height) < 120 || Number(data.height) > 1200)) {
    errors.height = '高度必须在 120–1200 像素之间。';
  }
  return {
    block: Object.keys(errors).length ? null : { ...block, data, bindings, locked_until: lockedUntil } as PageBlock,
    errors,
  };
}
