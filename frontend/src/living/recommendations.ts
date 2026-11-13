import type { LivingPageDoc } from './types';

export function recommendationContentKey(document: Pick<LivingPageDoc, 'title' | 'blocks'>): string {
  const content = document.blocks.flatMap((b) => {
    if (b.type !== 'text' && b.type !== 'section') return [];
    return [[b.id, b.type, b.source?.file_id ?? '', b.source?.page ?? null,
      b.type === 'text' ? b.data.md : b.data.heading, b.type === 'section' ? b.data.level : null]];
  });
  return JSON.stringify([document.title, content]);
}
