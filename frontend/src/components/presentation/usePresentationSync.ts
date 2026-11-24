import { createContext, useLayoutEffect, useMemo, useRef } from 'react';
import type { CanvasDoc } from '@/canvas/types';

export interface InkStroke {
  id: string;
  tool: 'pen' | 'highlighter';
  color: string;
  size: number;
  points: Array<[number, number, number]>;
}

export interface InkFrame {
  strokes: InkStroke[];
  active: InkStroke | null;
  laser: [number, number] | null;
}

type Message =
  | {kind: 'hello'}
  | {kind: 'page'; pageNo: number}
  | {kind: 'ink'; pageNo: number; frame: InkFrame}
  | {kind: 'workshop-request'; node: string}
  | {kind: 'workshop'; node: string; doc: CanvasDoc}
  | {kind: 'timeline'; node: string; key: string; position: number}
  | {kind: 'timeline-playback'; node: string; key: string; playing: boolean};

type Listener = (message: Message) => void;
interface PresentationSync {
  send: Listener;
  subscribe: (listener: Listener) => () => void;
  workshop: (node: string) => CanvasDoc | undefined;
  timeline: (node: string) => Record<string, number>;
}

export const PresentationSyncContext = createContext<PresentationSync | null>(null);

function remember(message: Message, docs: Map<string, CanvasDoc>, timelines: Map<string, Record<string, number>>) {
  if (message.kind === 'workshop') docs.set(message.node, message.doc);
  if (message.kind === 'timeline') {
    timelines.set(message.node, {...timelines.get(message.node), [message.key]: message.position});
  }
}

export function usePresentationSync(session: string | null): PresentationSync | null {
  const channel = useRef<BroadcastChannel | null>(null);
  const listeners = useRef(new Set<Listener>());
  const cache = useMemo(() => ({docs: new Map<string, CanvasDoc>(), timelines: new Map<string, Record<string, number>>()}), [session]);
  useLayoutEffect(() => {
    if (!session || typeof BroadcastChannel === 'undefined') return;
    const connection = new BroadcastChannel(`wanxiang.presentation.${session}`);
    channel.current = connection;
    connection.onmessage = ({data}: MessageEvent<Message>) => {
      if (!data?.kind) return;
      remember(data, cache.docs, cache.timelines);
      listeners.current.forEach(listener => listener(data));
    };
    return () => { channel.current = null; connection.close(); };
  }, [session, cache]);
  return useMemo(() => session ? {
    send: message => {
      remember(message, cache.docs, cache.timelines);
      channel.current?.postMessage(message);
    },
    subscribe: listener => {
      listeners.current.add(listener);
      return () => { listeners.current.delete(listener); };
    },
    workshop: node => cache.docs.get(node),
    timeline: node => cache.timelines.get(node) ?? {},
  } : null, [session, cache]);
}
