import { useEffect, useRef, type RefObject } from 'react';
import type { WorkshopPluginConfig } from '@/document/types';

const debounceMs = 1200;
const maxPreviewLength = Math.floor((256 * 1024 - 32) / 3) * 4;

async function capturePreview(chart: HTMLElement): Promise<string | undefined> {
  const { offsetWidth: width, offsetHeight: height } = chart;
  if (!width || !height) return undefined;
  const scale = Math.min(1, 480 / Math.max(width, height));
  const { toCanvas } = await import('html-to-image');
  const canvas = await toCanvas(chart, {
    width, height, skipFonts: true, pixelRatio: 1,
    canvasWidth: Math.max(1, Math.round(width * scale)),
    canvasHeight: Math.max(1, Math.round(height * scale)),
    style: { margin: '0', transform: 'none' },
  });
  for (const quality of [.82, .6]) {
    const image = canvas.toDataURL('image/webp', quality);
    if (/^data:image\/(png|webp);base64,/.test(image) && image.length <= maxPreviewLength) return image;
  }
  return undefined;
}

export function useWorkshopPluginPreview(
  host: RefObject<HTMLElement>,
  plugin: WorkshopPluginConfig | undefined,
  enabled: boolean,
  onPreview: (preview: string) => void,
): void {
  const { template_kind, doc, display_mode, transparent_bg, hide_border, theme } = plugin ?? {};
  const latest = useRef({ plugin, onPreview, enabled });
  latest.current = { plugin, onPreview, enabled };

  useEffect(() => {
    const element = host.current;
    if (!element || !enabled || !template_kind) return;

    let current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let observer: MutationObserver | undefined;
    const schedule = () => {
      const chart = element.querySelector<HTMLElement>('[data-stage-chart], [data-instrument-stage]');
      if (!chart) return;
      observer?.disconnect();
      timer = setTimeout(() => {
        const target = element.querySelector<HTMLElement>('[data-stage-chart]') ?? chart;
        void capturePreview(target).then(image => {
          const state = latest.current;
          if (!current || !state.enabled || !image || !state.plugin) return;
          const config = state.plugin;
          if (config.template_kind === template_kind && config.doc === doc && config.display_mode === display_mode
            && config.transparent_bg === transparent_bg && config.hide_border === hide_border && config.theme === theme
            && image !== config.preview_data) state.onPreview(image);
        }).catch(() => { /* A preview is optional if a chart cannot be captured. */ });
      }, debounceMs);
    };

    observer = new MutationObserver(schedule);
    observer.observe(element, { childList: true, subtree: true });
    schedule();
    return () => {
      current = false;
      clearTimeout(timer);
      observer?.disconnect();
    };
  }, [host, enabled, template_kind, doc, display_mode, transparent_bg, hide_border, theme]);
}
