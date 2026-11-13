export interface AssistantParam {
  specId: string;
  specTitle: string;
  id: string;
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
}

export type AssistantAction =
  | { kind: 'set'; param: AssistantParam; value: number }
  | { kind: 'reset' }
  | { kind: 'page'; index: number }
  | { kind: 'say'; text: string };

export interface AssistantContext { pageCount: number; currentIndex: number }

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NUMBER = '(-?\\d+(?:\\.\\d+)?)';
const fmt = (value: number) => String(Number(value.toFixed(6)));

function standalone(text: string, id: string, ignoreCase: boolean): boolean {
  return new RegExp(`(?<![A-Za-z0-9_])${escape(id)}(?![A-Za-z0-9_])`, ignoreCase ? 'i' : '').test(text);
}

/** 先按大小写精确匹配参数 id，其次不分大小写，最后按中文标签包含关系。 */
export function matchParams(text: string, params: AssistantParam[]): AssistantParam[] {
  const exact = params.filter(p => standalone(text, p.id, false));
  if (exact.length) return exact;
  const loose = params.filter(p => standalone(text, p.id, true));
  if (loose.length) return loose;
  return params.filter(p => p.label.trim().length >= 2 && text.includes(p.label.trim()));
}

/**
 * 确定性指令解析：只做「设值 / 增减 / 恢复原稿 / 翻页」。
 * 不确定就返回 say，绝不猜测执行；执行方仍要走参数校验。
 */
export function parseAssistantCommand(raw: string, params: AssistantParam[], ctx: AssistantContext): AssistantAction {
  const text = raw.replace(/[−–—]/g, '-').replace(/＝/g, '=').replace(/\s+/g, ' ').trim();
  if (!text) return { kind: 'say', text: '请输入指令，例如「把 a 设为 3」。' };

  if (/恢复|还原|重置|复原/.test(text)) return { kind: 'reset' };
  const absolute = text.match(/第\s*(\d+)\s*页/);
  if (absolute) {
    const index = Number(absolute[1]) - 1;
    return index >= 0 && index < ctx.pageCount ? { kind: 'page', index }
      : { kind: 'say', text: `没有第 ${absolute[1]} 页，本文档共 ${ctx.pageCount} 页。` };
  }
  if (/下一页|后一页/.test(text)) return { kind: 'page', index: Math.min(ctx.pageCount - 1, ctx.currentIndex + 1) };
  if (/上一页|前一页/.test(text)) return { kind: 'page', index: Math.max(0, ctx.currentIndex - 1) };

  const matches = matchParams(text, params);
  const set = text.match(new RegExp(`(?:设为|设成|调成|调到|改成|改为|等于|=|:|：)\\s*${NUMBER}`));
  const add = text.match(new RegExp(`(?:增加|加上|加|增大|调大|提高)\\s*${NUMBER}`));
  const sub = text.match(new RegExp(`(?:减少|减去|减|调小|降低)\\s*${NUMBER}`));
  if (!set && !add && !sub) {
    return { kind: 'say', text: matches.length
      ? `我没听清要把「${matches[0]!.id}」改成多少，试试「把 ${matches[0]!.id} 设为 3」。`
      : '这条我没有把握执行，不会改动页面。可以试试「把 a 设为 3」、「恢复原稿」或「第 2 页」。' };
  }
  if (!matches.length) {
    return { kind: 'say', text: params.length
      ? `这一页没找到你说的参数。可调参数：${params.slice(0, 8).map(p => p.id).join('、')}。`
      : '这一页没有可调参数。' };
  }
  const distinct = new Map(matches.map(p => [`${p.specId}:${p.id}`, p]));
  if (distinct.size > 1) {
    return { kind: 'say', text: `有多个参数符合：${[...distinct.values()].map(p => `${p.specTitle}·${p.id}`).join('、')}，请说得具体一些。` };
  }
  const param = [...distinct.values()][0]!;
  const target = set ? Number(set[1]) : add ? param.value + Number(add[1]) : param.value - Number(sub![1]);
  if ((param.min !== undefined && target < param.min) || (param.max !== undefined && target > param.max)) {
    return { kind: 'say', text: `「${param.id}」只能取 ${param.min ?? '−∞'} 到 ${param.max ?? '∞'}，${fmt(target)} 超出范围，未改动。` };
  }
  return { kind: 'set', param, value: target };
}

export function describeSet(param: AssistantParam, value: number): string {
  return `已把 ${param.id} 从 ${fmt(param.value)} 调为 ${fmt(value)}，数字、图形与结果同步更新。`;
}
