import { useCallback, useEffect, useRef, useState } from 'react';
import type { PageLab } from '@/api/pptAI';
import { SANDBOX_SRCDOC } from '@/ppt-ai/sandbox/host';
import { ViewAstRenderer } from '@/ppt-ai/runtime/ViewAstRenderer';
import {
  PROTOCOL_VERSION,
  isSandboxResult,
  newNonce,
  parseSandboxMessage,
  validateViewAst,
  type SandboxInit,
} from '@/ppt-ai/sandbox/protocol';
import styles from './LabCanvas.module.css';

const RUN_TIMEOUT_MS = 3000;

type Values = Record<string, number>;

/** One in-flight Worker per canvas; intermediate playback frames collapse to the latest input. */
export function LabCanvas({
  lab,
  values,
  identity,
  editable = true,
  onParamChange,
}: {
  lab: PageLab;
  values: Values;
  identity?: string;
  editable?: boolean;
  onParamChange?: (patch: Values) => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const nonceRef = useRef('');
  const timerRef = useRef<number | null>(null);
  const busy = useRef(false);
  const sent = useRef<Values | null>(null);
  const latest = useRef(values);
  latest.current = values;
  const [loaded, setLoaded] = useState(false);
  const [ast, setAst] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState('');
  const [failed, setFailed] = useState(false);
  const [generation, setGeneration] = useState(0);
  const artifactId = identity || `page-lab-${lab.page_no}`;
  const revision = lab.content_hash;
  const stop = useCallback(() => {
    iframeRef.current?.contentWindow?.postMessage({type:'stop', protocol:PROTOCOL_VERSION}, '*');
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    busy.current = false;
  }, []);
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      const parsed = parseSandboxMessage(event.data, {nonce:nonceRef.current, artifactId, revision,
        source:event.source, contentWindow:iframeRef.current?.contentWindow ?? null});
      if (!parsed.ok) return;
      stop();
      if (!isSandboxResult(parsed.message)) setError(parsed.message.message || '交互程序执行失败');
      else {
        const errors = validateViewAst(parsed.message.ast);
        setError(errors[0] ?? '');
        if (!errors.length) setAst(parsed.message.ast);
      }
      if (latest.current !== sent.current) setGeneration(value => value + 1);
    };
    window.addEventListener('message', listener);
    return () => { window.removeEventListener('message', listener); stop(); };
  }, [artifactId, revision, stop]);
  useEffect(() => {
    if (!loaded || failed || busy.current || sent.current === values) return;
    const target = iframeRef.current?.contentWindow;
    if (!target) return;
    busy.current = true;
    sent.current = values;
    const nonce = newNonce();
    nonceRef.current = nonce;
    timerRef.current = window.setTimeout(() => {
      stop(); setFailed(true); setError('交互程序运行超时，已终止。');
    }, RUN_TIMEOUT_MS + 100);
    const init: SandboxInit = {type:'init', protocol:PROTOCOL_VERSION, nonce, artifactId, revision,
      program:lab.program, input:values, timeoutMs:RUN_TIMEOUT_MS};
    target.postMessage(init, '*');
  }, [loaded, failed, values, lab.program, artifactId, revision, generation, stop]);
  return <div className={styles.stage}>
    {!failed && <iframe ref={iframeRef} className={styles.iframe} sandbox="allow-scripts"
      referrerPolicy="no-referrer" title="AI 交互隔离沙箱" tabIndex={-1} aria-hidden="true"
      srcDoc={SANDBOX_SRCDOC} onLoad={() => setLoaded(true)} />}
    {ast ? <ViewAstRenderer ast={ast} className={styles.view} interactive={editable} onParamChange={editable ? onParamChange : undefined} /> : <p className={styles.stageNote} role="status">正在运行…</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
  </div>;
}
