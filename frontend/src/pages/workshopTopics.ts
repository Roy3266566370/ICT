/** 定象坊专题的本地自定义名称：只改显示名，不改变模板归属与模板 kind。 */

export const TOPIC_ALIAS_KEY = 'wanxiang.workshop.topicNames.v1';
const MAX_TOPIC_NAME = 60;

export type TopicAliases = Record<string, string>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, MAX_TOPIC_NAME);
}

export function readTopicAliases(): TopicAliases {
  if (typeof localStorage === 'undefined') return {};
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(TOPIC_ALIAS_KEY) ?? '{}');
    if (!isRecord(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).flatMap(([id, name]) => {
      const clean = typeof name === 'string' ? cleanName(name) : '';
      return clean ? [[id, clean]] : [];
    }));
  } catch {
    return {};
  }
}

export function writeTopicAlias(topicId: string, name: string, aliases: TopicAliases = readTopicAliases()): TopicAliases {
  if (!topicId) return aliases;
  const clean = cleanName(name);
  const next = { ...aliases };
  if (clean) next[topicId] = clean;
  else delete next[topicId];
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(TOPIC_ALIAS_KEY, JSON.stringify(next));
    } catch {
      /* 隐私模式或配额不足时只保留本次会话内的名称 */
    }
  }
  return next;
}

export function topicDisplayName(topic: { id: string; name: string }, aliases: TopicAliases): string {
  return aliases[topic.id] || topic.name;
}
