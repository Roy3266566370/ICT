export const SUBJECTS = {
  math: '数学', physics: '物理', cs: '计算机 / 408', ai: '人工智能',
  business: '经管商科', ppt: '通用 PPT 模板', general: '通用',
} as const;

/** 定象坊广场聚焦的学科集合（去除通文册 PPT 模板）。 */
export const WORKSHOP_SUBJECTS = {
  math: '数学', physics: '物理', cs: '计算机 / 408', ai: '人工智能',
  business: '经管商科', general: '通用',
} as const;

/** 学科专属色标：胶囊标签与封面主色调共用。 */
export const SUBJECT_COLORS: Record<keyof typeof SUBJECTS, string> = {
  math: '#2b4c7e',
  physics: '#b5492e',
  cs: '#1e6f68',
  ai: '#55418c',
  business: '#9a6324',
  ppt: '#47525e',
  general: '#47525e',
};

/** 画布轻量拓扑缩略图：节点归一化到 [8,92]×[14,86] 视窗，连线按下标引用。 */
export interface CoverTopology {
  nodes: { x: number; y: number; kind: 'control' | 'stage' | 'plot' | 'note'; label: string }[];
  wires: { f: number; t: number }[];
}

export interface ListingOptions {
  subject: keyof typeof SUBJECTS;
  summary: string;
  allow_fork: boolean;
}

export interface PlazaItem extends ListingOptions {
  id: string;
  kind: 'workshop' | 'deck';
  share_id: string;
  title: string;
  is_featured: boolean;
  pinned: boolean;
  can_manage: boolean;
  forks: number;
  likes: number;
  liked_by_me: boolean;
  bookmarked_by_me: boolean;
  cover: {
    node_count?: number; wire_count?: number; page_count?: number; theme_id?: string; page_no?: number;
    preview_template?: string; topology?: CoverTopology;
  };
  author: { id: string | null; display_name: string; avatar_url: string | null };
  origin?: PlazaItem;
}

export interface PlazaPageData {
  items: PlazaItem[];
  has_more: boolean;
}

export interface Creator extends PlazaPageData {
  id: string;
  display_name: string;
  avatar_url: string | null;
  bio: string;
  occupation: string;
  school: string;
  interests: string[];
  stats: { count: number; likes: number; forks: number };
}

export function previewPath(item: Pick<PlazaItem, 'kind' | 'share_id'>) {
  return (item.kind === 'deck' ? '/p/' : '/work-shares/') + encodeURIComponent(item.share_id);
}
