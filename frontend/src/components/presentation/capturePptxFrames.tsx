import { createRoot } from 'react-dom/client';
import type { ScenePage } from '@/document/types';
import { ScenePageView } from '@/components/editor/ScenePageView';

interface Snapshot {
  page_no: number;
  id: string;
  image_data: string;
}

const selector = '[data-presentation-snapshot]';
const types = new Set(['workshop_plugin', 'math_scene', 'demo', 'diagram']);

export async function capturePptxFrames(pages: ScenePage[], slide: HTMLElement | null, pageNo: number): Promise<Snapshot[]> {
  const candidates = pages.filter(page => page.preparation?.status === 'ready' &&
    page.nodes.some(node => types.has(node.type) && !node.deleted && !node.hidden));
  if (!candidates.length) return [];
  const {toPng} = await import('html-to-image');
  const snapshots: Snapshot[] = [];
  const deadline = performance.now() + 15000;
  let bytes = 0;
  const hasRoom = () => snapshots.length < 40 && bytes < 19_000_000 && performance.now() < deadline;
  const capture = async (root: HTMLElement, page: ScenePage) => {
    const ids = new Set(page.nodes.filter(node => types.has(node.type) && !node.deleted && !node.hidden).map(node => node.id));
    for (const node of root.querySelectorAll<HTMLElement>(selector)) {
      if (!hasRoom()) return;
      const id = node.dataset.presentationSnapshot;
      const width = node.offsetWidth;
      const height = node.offsetHeight;
      if (!id || !ids.has(id) || !width || !height || node.closest('[hidden]') ||
          (node.hasAttribute('data-scene-workshop-plugin') && !node.querySelector('[data-instrument-stage]')) ||
          snapshots.some(snapshot => snapshot.page_no === page.page_no && snapshot.id === id)) continue;
      let timer: number | undefined;
      try {
        const png = await Promise.race([
          toPng(node, {
            width, height, pixelRatio: Math.min(2, 4000 / Math.max(width, height), Math.sqrt(7_900_000 / (width * height))),
            style: {position: 'relative', left: '0', top: '0', transform: 'none'},
            preferredFontFormat: 'woff2',
          }),
          new Promise<null>(resolve => {
            timer = window.setTimeout(() => resolve(null), Math.min(2500, Math.max(0, deadline - performance.now())));
          }),
        ]);
        if (!png?.startsWith('data:image/png;base64,') || png.length > 5_500_000 || bytes + png.length > 19_000_000) continue;
        snapshots.push({page_no: page.page_no, id, image_data: png});
        bytes += png.length;
      } catch {
        // Failed browser captures still have a static substitute in the PPTX writer.
      } finally {
        window.clearTimeout(timer);
      }
    }
  };
  const current = candidates.find(page => page.page_no === pageNo);
  if (current && slide) await capture(slide, current);
  const remaining = candidates.filter(page => page.nodes.some(node => types.has(node.type) && !node.deleted && !node.hidden &&
    !snapshots.some(snapshot => snapshot.page_no === page.page_no && snapshot.id === node.id)));
  if (!remaining.length || !hasRoom()) return snapshots;
  const host = window.document.createElement('div');
  host.style.cssText = 'position:fixed;left:-30000px;top:0;pointer-events:none';
  host.inert = true;
  host.setAttribute('aria-hidden', 'true');
  window.document.body.append(host);
  const root = createRoot(host);
  try {
    for (const page of remaining) {
      if (!hasRoom()) break;
      root.render(<ScenePageView key={page.page_no} page={page} scale={1} presentVectors inlineAllDemos/>);
      const renderDeadline = performance.now() + 2500;
      const workshops = page.nodes.filter(node => node.type === 'workshop_plugin' && node.workshop_plugin && !node.deleted && !node.hidden).length;
      while (performance.now() < renderDeadline && hasRoom()) {
        await new Promise(resolve => window.setTimeout(resolve, 50));
        if (host.querySelector(`[data-scene-page="${page.page_no}"]`) &&
          host.querySelectorAll('[data-instrument-stage]').length >= workshops) break;
      }
      if (host.querySelector(`[data-scene-page="${page.page_no}"]`)) await capture(host, page);
    }
  } finally {
    root.unmount();
    host.remove();
  }
  return snapshots;
}
