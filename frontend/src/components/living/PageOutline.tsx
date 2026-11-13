import type { PageBlock } from '@/living/types';

export function PageOutline({ blocks }: { blocks: PageBlock[] }) {
  const headings = blocks.filter((b) => b.type === 'section');
  if (headings.length < 2) return null;
  return <nav aria-label="活页目录" style={{ margin: '1rem 0', position: 'sticky', top: 0, zIndex: 5, background: 'var(--paper-1)', padding: '0.75rem' }}>
    <label>目录 / 跳转页面 {' '}
      <select aria-label="跳转页面" defaultValue="" style={{ maxWidth: '100%' }} onChange={(e) => document.getElementById(e.target.value)?.scrollIntoView({ block: 'start' })}>
        <option value="" disabled>选择小节或页码（{headings.length} 项）</option>
        {headings.map((b) => b.type === 'section' ? <option key={b.id} value={b.id}>{b.data.heading}</option> : null)}
      </select>
    </label>
  </nav>;
}
