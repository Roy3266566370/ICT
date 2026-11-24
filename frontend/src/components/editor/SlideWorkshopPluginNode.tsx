/**
 * SlideWorkshopPluginNode.tsx —— 嵌入万象活页 PPT 中的万象工坊交互插件节点
 *
 * 直接复用万象工坊的 CanvasBoard（交互仪器态），纯前端确定性计算，
 * 支持自由拖动、实时调参、时间轴播放，且离线导出 100% 保留交互。
 */
import { lazy, Suspense, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { buildTemplateDoc } from '@/canvas/templateCatalog';
import type { CanvasDoc } from '@/canvas/types';
import type { WorkshopPluginConfig, WorkshopPluginPreset } from '@/document/types';
import {
  applyPresetToDoc, defaultPresetsForTemplate, WORKSHOP_PRESET_PREVIEW_EVENT, WORKSHOP_PRESET_SNAPSHOT_EVENT,
} from '@/canvas/pluginPresets';
import { richNodeStyle, type SlideRichNodeProps } from './SlideDiagramNode';
import { PresentationSyncContext } from '@/components/presentation/usePresentationSync';
import { useWorkshopPluginPreview } from './useWorkshopPluginPreview';
import './slideRichNodes.css';

const CanvasBoard = lazy(() => import('@/canvas/CanvasBoard').then((m) => ({ default: m.CanvasBoard })));

function PluginLiveRunner({
  plugin,
  nodeId,
  authoring,
  expandable,
  readOnly,
  onDocPersist,
  presentationKey,
}: {
  plugin: WorkshopPluginConfig;
  nodeId: string;
  authoring: boolean;
  expandable: boolean;
  readOnly: boolean;
  onDocPersist?: (doc: CanvasDoc) => void;
  presentationKey?: string;
}): JSX.Element {
  const templateKind = plugin.template_kind;
  const initialDoc = useMemo(() => {
    if (plugin.doc) return plugin.doc;
    if (templateKind === 'custom-work') return undefined;
    try { return buildTemplateDoc(templateKind); } catch { return undefined; }
  }, [templateKind, plugin.doc]);
  const [doc, setDoc] = useState(initialDoc);
  const [fullscreen, setFullscreen] = useState(false);
  const [requestedPreset, setRequestedPreset] = useState<WorkshopPluginPreset>();
  const defaults = useMemo(() => defaultPresetsForTemplate(templateKind), [templateKind]);
  const [boardHost] = useState(() => {
    const host = document.createElement('div');
    host.className = 'slideWorkshopBoardHost';
    return host;
  });
  const inlineHost = useRef<HTMLDivElement>(null);
  const fullscreenHost = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const fullscreenButton = useRef<HTMLButtonElement>(null);
  const wasFullscreen = useRef(false);
  const latest = useRef(doc);
  const sync = useContext(PresentationSyncContext);
  const replace = (next: CanvasDoc | undefined) => { latest.current = next; setDoc(next); };

  useEffect(() => {
    replace(initialDoc);
  }, [initialDoc]);
  useEffect(() => {
    if (!presentationKey || !sync) return;
    const cached = sync.workshop(presentationKey);
    if (cached) replace(cached);
    const unsubscribe = sync.subscribe(message => {
      if (message.kind === 'workshop' && message.node === presentationKey) replace(message.doc);
      if (message.kind === 'workshop-request' && message.node === presentationKey && latest.current) {
        sync.send({kind: 'workshop', node: presentationKey, doc: latest.current});
      }
    });
    if (!cached) sync.send({kind: 'workshop-request', node: presentationKey});
    return unsubscribe;
  }, [presentationKey, sync]);
  useEffect(() => {
    if (!authoring) return;
    const preview = (event: Event) => {
      const { detail } = event as CustomEvent<{ nodeId: string; preset: WorkshopPluginPreset }>;
      if (detail.nodeId === nodeId) setRequestedPreset({ ...detail.preset });
    };
    const snapshot = (event: Event) => {
      const { detail } = event as CustomEvent<{ nodeId: string; receive: (doc: CanvasDoc) => void }>;
      if (detail.nodeId === nodeId && latest.current) detail.receive(latest.current);
    };
    window.addEventListener(WORKSHOP_PRESET_PREVIEW_EVENT, preview);
    window.addEventListener(WORKSHOP_PRESET_SNAPSHOT_EVENT, snapshot);
    return () => {
      window.removeEventListener(WORKSHOP_PRESET_PREVIEW_EVENT, preview);
      window.removeEventListener(WORKSHOP_PRESET_SNAPSHOT_EVENT, snapshot);
    };
  }, [authoring, nodeId]);

  useLayoutEffect(() => {
    const parent = fullscreen ? fullscreenHost.current : inlineHost.current;
    if (parent) parent.appendChild(boardHost);
    if (fullscreen && dialog.current && !dialog.current.open) dialog.current.showModal();
    if (!fullscreen && wasFullscreen.current) fullscreenButton.current?.focus();
    wasFullscreen.current = fullscreen;
  }, [boardHost, fullscreen, doc !== undefined]);
  useLayoutEffect(() => () => boardHost.remove(), [boardHost]);
  useEffect(() => {
    if (!fullscreen) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setFullscreen(false);
    };
    window.addEventListener('keydown', escape, true);
    return () => window.removeEventListener('keydown', escape, true);
  }, [fullscreen]);

  const handleSetDoc: React.Dispatch<React.SetStateAction<CanvasDoc>> = (update) => {
    if (readOnly || !latest.current) return;
    const next = typeof update === 'function' ? update(latest.current) : update;
    if (next === latest.current) return;
    replace(next);
    onDocPersist?.(next);
    if (presentationKey) sync?.send({kind: 'workshop', node: presentationKey, doc: next});
  };

  if (!doc) return <div className="slideDemoPreview"><strong>此工坊作品的画布无法读取</strong></div>;
  return <>
    {expandable && <div className="slideWorkshopPresentationToolbar">
      <button ref={fullscreenButton} type="button" aria-label="全屏展开演示" onClick={() => setFullscreen(true)}>⛶ 全屏展开演示</button>
    </div>}
    <div className="slideWorkshopInlineHost" ref={inlineHost} />
    {fullscreen && createPortal(
      <dialog ref={dialog} aria-label="全屏工坊演示" className="slideWorkshopFullScreen" data-workshop-fullscreen data-no-pan
        onClose={() => setFullscreen(false)} onCancel={event => { event.preventDefault(); setFullscreen(false); }}
        onKeyDown={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}>
        <div className="slideWorkshopFullScreenBar">
          <strong>{plugin.title}</strong>
          <button type="button" onClick={() => setFullscreen(false)}>退出全屏</button>
        </div>
        <div className="slideRichContent" ref={fullscreenHost} />
      </dialog>,
      document.fullscreenElement ?? document.body,
    )}
    {createPortal(<Suspense fallback={<div className="slideDemoPreview"><strong>正在载入万象工坊交互插件…</strong></div>}>
      <CanvasBoard
        doc={doc}
        setDoc={handleSetDoc}
        tool="select"
        inkColor="#2F3A49"
        mode="instrument"
        slideInstrument
        templateKind={templateKind}
        workshopEmbed={{
          authoring, requestedPreset, display_mode: fullscreen ? 'full' : plugin.display_mode,
          theme: plugin.theme, transparent_bg: plugin.transparent_bg, hide_border: plugin.hide_border,
          visible_params: plugin.visible_params, presets: plugin.presets ?? defaults,
        }}
        onPreviewPreset={authoring ? preset => {
          if (latest.current) replace(applyPresetToDoc(latest.current, preset));
        } : undefined}
        readOnly={readOnly}
        interactivePanel={!readOnly}
        presentationKey={presentationKey}
      />
    </Suspense>, boardHost)}
  </>;
}

export function SlideWorkshopPluginNode({ node, editing, interactive, onPatch, presentationKey }: SlideRichNodeProps & {presentationKey?: string}): JSX.Element {
  const plugin = node.workshop_plugin;
  const title = plugin?.title || node.name || '万象工坊插件';
  const category = plugin?.category || '工坊插件';
  const showInstrument = editing || interactive;
  const previewHost = useRef<HTMLDivElement>(null);
  useWorkshopPluginPreview(previewHost, plugin ?? undefined, editing && !node.locked, preview => {
    if (plugin) onPatch({ workshop_plugin: { ...plugin, preview_data: preview } }, 'workshop-preview');
  });

  return (
    <div
      ref={previewHost}
      className="slideRichNode slideWorkshopNode"
      data-no-pan
      data-scene-workshop-plugin={node.id}
      data-presentation-snapshot={node.id}
      data-transparent-bg={plugin?.transparent_bg || undefined}
      data-hide-border={plugin?.hide_border || undefined}
      data-instrument-theme={plugin?.theme ?? 'auto'}
      style={richNodeStyle(node, showInstrument)}
    >
      {editing && interactive && !node.locked && (
        <div className="slideRichGrip" title="拖动调整工坊插件位置">
          <span>🎛️ {category} · {title}</span>
          <span className="slideWorkshopBadge">原生离线支持</span>
        </div>
      )}
      <div
        className="slideRichContent"
        ref={element => { if (element) element.inert = !interactive; }}
        onPointerDown={(e) => { if (interactive) e.stopPropagation(); }}
        onKeyDown={(e) => { if (interactive) e.stopPropagation(); }}
      >
        {plugin ? (
          showInstrument ? (
            <PluginLiveRunner
              key={plugin.template_kind}
              plugin={plugin}
              nodeId={node.id}
              authoring={editing}
              expandable={!editing && interactive}
              presentationKey={editing ? undefined : presentationKey}
              readOnly={node.locked || (!editing && node.viewer_editable === false)}
              onDocPersist={
                editing && interactive && !node.locked
                  ? (nextDoc) => onPatch({ workshop_plugin: { ...plugin, doc: nextDoc } }, 'workshop-doc')
                  : undefined
              }
            />
          ) : plugin.preview_data ? (
            <img className="slideWorkshopPreviewImage" data-workshop-preview alt="" src={plugin.preview_data} draggable={false} />
          ) : (
            <div className="slideDemoPreview">
              <span className="slideWorkshopTag">{category}</span>
              <strong>{title}</strong>
              <p>万象工坊交互插件 · 演示态可直接拖动滑杆与时间轴</p>
              <span>▶ 原位交互插件</span>
            </div>
          )
        ) : (
          <div className="slideDemoPreview">
            <strong>未绑定工坊插件</strong>
            <p>请在右侧属性面板选择一个万象工坊交互模板。</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default SlideWorkshopPluginNode;
