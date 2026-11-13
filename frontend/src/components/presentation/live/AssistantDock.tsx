import { useEffect, useRef, useState, type PointerEvent } from 'react';
import styles from './Assistant.module.css';

export interface ClientRect { left: number; top: number; right: number; bottom: number }

interface DockProps {
  message: string;
  suggestions: string[];
  lassoArmed: boolean;
  onSend: (text: string) => void;
  onToggleLasso: () => void;
}

/** 常驻 AI 助手：确定性指令 + 圈选。离线可用，不发网络请求。 */
export function AssistantDock({ message, suggestions, lassoArmed, onSend, onToggleLasso }: DockProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const submit = (value: string) => { if (value.trim()) { onSend(value); setText(''); } };
  if (!open) return <button type="button" className={styles.pill} onClick={() => setOpen(true)} data-no-pan>✦ AI 助手</button>;
  return <section className={styles.dock} aria-label="AI 助手" data-no-pan>
    <header><b>✦ AI 助手</b><span>一直在场 · 离线可用</span>
      <button type="button" onClick={() => setOpen(false)} aria-label="收起 AI 助手">×</button></header>
    {message && <p className={styles.message} role="status">{message}</p>}
    <form onSubmit={event => { event.preventDefault(); submit(text); }}>
      <input value={text} onChange={event => setText(event.target.value)} placeholder="例如：把 a 设为 3" aria-label="向 AI 助手下指令"
        onKeyDown={event => event.stopPropagation()}/>
      <button type="submit">发送</button>
    </form>
    <button type="button" className={styles.lasso} aria-pressed={lassoArmed} onClick={onToggleLasso}>
      {lassoArmed ? '◎ 在页面上拖出一个框…（再点取消）' : '◎ 圈选页面内容提问'}</button>
    <div className={styles.suggestions}>{suggestions.map(item =>
      <button key={item} type="button" onClick={() => submit(item)}>{item}</button>)}</div>
  </section>;
}

/** 覆盖在幻灯片上的圈选层：拖出矩形，松手后回调客户端坐标。 */
export function LassoLayer({ onDone, onCancel }: { onDone: (rect: ClientRect) => void; onCancel: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onCancel(); } };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [onCancel]);
  const local = (event: PointerEvent) => {
    const rect = ref.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  return <div ref={ref} className={styles.lassoLayer} data-no-pan
    onPointerDown={event => { event.stopPropagation(); start.current = local(event); event.currentTarget.setPointerCapture(event.pointerId); }}
    onPointerMove={event => {
      if (!start.current) return;
      const now = local(event);
      setBox({ x: Math.min(start.current.x, now.x), y: Math.min(start.current.y, now.y),
        w: Math.abs(now.x - start.current.x), h: Math.abs(now.y - start.current.y) });
    }}
    onPointerUp={event => {
      const origin = ref.current!.getBoundingClientRect();
      const done = box;
      start.current = null; setBox(null);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      if (done && done.w > 6 && done.h > 6) {
        onDone({ left: origin.left + done.x, top: origin.top + done.y, right: origin.left + done.x + done.w, bottom: origin.top + done.y + done.h });
      } else onCancel();
    }}>
    {box && <div className={styles.lassoBox} style={{ left: box.x, top: box.y, width: box.w, height: box.h }}/>}
  </div>;
}
