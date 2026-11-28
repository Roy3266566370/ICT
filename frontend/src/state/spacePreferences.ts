/**
 * 个人主页氛围、精选置顶与全站创作偏好（按账号 scope 本地持久化）。
 */

export type SpaceCoverTheme = 'ivory-gold' | 'indigo-star' | 'chalk-board' | 'oat-editorial';

export interface SpacePreferences {
  coverTheme: SpaceCoverTheme;
  defaultPptTheme: string;
  defaultRatio: '16:9' | '4:3';
  defaultSubject: string;
  reducedMotion: boolean;
  pinnedKeys: string[];
}

export const COVER_THEMES = [
  { id: 'ivory-gold', name: '宣纸金线', dot: '#e9dec4' },
  { id: 'indigo-star', name: '靛蓝星图', dot: '#243866' },
  { id: 'chalk-board', name: '学院黑板', dot: '#1f443b' },
  { id: 'oat-editorial', name: '燕麦人文', dot: '#dfd0ba' },
] as const;

export const DEFAULT_SUBJECT_OPTIONS = [
  '高等数学',
  '线性代数',
  '大学物理',
  '408 专题',
  '办公决策',
] as const;

export const DEFAULT_SPACE_PREFERENCES: SpacePreferences = {
  coverTheme: 'ivory-gold',
  defaultPptTheme: 'academic-paper',
  defaultRatio: '16:9',
  defaultSubject: '高等数学',
  reducedMotion: false,
  pinnedKeys: [],
};

const STORAGE_PREFIX = 'wanxiang:space-prefs:v1:';
const COVER_IDS = new Set<string>(COVER_THEMES.map((item) => item.id));

function storageKey(scope: string): string {
  return `${STORAGE_PREFIX}${scope || 'guest'}`;
}

export function readSpacePreferences(scope: string): SpacePreferences {
  if (typeof window === 'undefined') return { ...DEFAULT_SPACE_PREFERENCES };
  try {
    const raw = window.localStorage.getItem(storageKey(scope));
    if (!raw) return { ...DEFAULT_SPACE_PREFERENCES };
    const parsed = JSON.parse(raw) as Partial<SpacePreferences>;
    return {
      coverTheme:
        typeof parsed.coverTheme === 'string' && COVER_IDS.has(parsed.coverTheme)
          ? (parsed.coverTheme as SpaceCoverTheme)
          : DEFAULT_SPACE_PREFERENCES.coverTheme,
      defaultPptTheme:
        typeof parsed.defaultPptTheme === 'string' && parsed.defaultPptTheme.trim()
          ? parsed.defaultPptTheme
          : DEFAULT_SPACE_PREFERENCES.defaultPptTheme,
      defaultRatio: parsed.defaultRatio === '4:3' ? '4:3' : '16:9',
      defaultSubject:
        typeof parsed.defaultSubject === 'string' && parsed.defaultSubject.trim()
          ? (parsed.defaultSubject === '408 计算机' ? '408 专题' : parsed.defaultSubject)
          : DEFAULT_SPACE_PREFERENCES.defaultSubject,
      reducedMotion: Boolean(parsed.reducedMotion),
      pinnedKeys: Array.isArray(parsed.pinnedKeys)
        ? parsed.pinnedKeys.filter((item): item is string => typeof item === 'string').slice(0, 3)
        : [],
    };
  } catch {
    return { ...DEFAULT_SPACE_PREFERENCES };
  }
}

export function writeSpacePreferences(scope: string, prefs: SpacePreferences): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey(scope), JSON.stringify(prefs));
  } catch {
    // 浏览器隐私模式或配额不足时静默忽略
  }
  applyReducedMotionPreference(prefs.reducedMotion);
}

export function applyReducedMotionPreference(enabled: boolean): void {
  if (typeof document === 'undefined') return;
  if (enabled) {
    document.documentElement.dataset.reducedMotion = 'true';
  } else {
    delete document.documentElement.dataset.reducedMotion;
  }
}
