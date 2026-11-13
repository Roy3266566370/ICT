import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { GeneratedViewArtifact } from '@/ppt-ai/types';
import {
  PROTOCOL_VERSION,
  isSandboxResult,
  newNonce,
  parseSandboxMessage,
  validateViewAst,
  type SandboxInit,
} from '@/ppt-ai/sandbox/protocol';
import { SANDBOX_SRCDOC } from '@/ppt-ai/sandbox/host';
import { ViewAstRenderer } from '@/ppt-ai/runtime/ViewAstRenderer';
import styles from './GeneratedViewFrame.module.css';

export interface GeneratedViewEvidence {
  status: 'accepted' | 'rejected';
  evidence: Record<string, unknown>;
}

interface Props {
  artifact: GeneratedViewArtifact;
  input: Record<string, unknown>;
  bindings?: string[];
  fallback?: ReactNode;
  onEvidence?: (result: GeneratedViewEvidence) => void;
  onAccepted?: () => void;
}

type Status = 'pending' | 'rendered' | 'failed' | 'timeout';

export function GeneratedViewFrame({ artifact, input, bindings = [], fallback, onEvidence, onAccepted }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const timerRef = useRef<number | null>(null);
  const inputKey = useMemo(() => JSON.stringify(input), [input]);
  const [nonce, setNonce] = useState(() => newNonce());
  const [status, setStatus] = useState<Status>('pending');
  const [ast, setAst] = useState<Record<string, unknown> | null>(null);
  const [message, setMessage] = useState('');
  const timeoutMs = Math.max(50, Number(artifact.isolation?.timeout_ms ?? 200));
  const revision = artifact.content_hash || artifact.artifact_id;

  useEffect(() => {
    setNonce(newNonce());
    setStatus('pending');
    setAst(null);
    setMessage('');
  }, [artifact.artifact_id, artifact.content_hash, inputKey]);

  const timeout = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    setStatus('timeout');
    setMessage(`专用视图在 ${timeoutMs}ms 内未返回，已终止并回退声明式视图。`);
    onEvidence?.({
      status: 'rejected',
      evidence: {
        artifact_hash: artifact.content_hash,
        nonce_ok: true,
        timeout_ok: false,
        reason: 'timeout',
        timeout_ms: timeoutMs,
      },
    });
  }, [artifact.content_hash, onEvidence, timeoutMs]);

  const start = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(timeout, timeoutMs);
    const init: SandboxInit = {
      type: 'init',
      protocol: PROTOCOL_VERSION,
      nonce,
      artifactId: artifact.artifact_id,
      revision,
      program: artifact.program,
      input,
      timeoutMs,
    };
    iframe.contentWindow.postMessage(init, '*');
  }, [artifact.artifact_id, artifact.program, input, nonce, revision, timeout, timeoutMs]);

  useEffect(() => {
    const listener = (event: MessageEvent) => {
      const iframe = iframeRef.current;
      const parsed = parseSandboxMessage(event.data, {
        nonce,
        artifactId: artifact.artifact_id,
        revision,
        source: event.source,
        contentWindow: iframe?.contentWindow ?? null,
      });
      if (!parsed.ok) return;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
      if (!isSandboxResult(parsed.message)) {
        setStatus('failed');
        setMessage(parsed.message.message || '沙箱程序执行失败');
        onEvidence?.({
          status: 'rejected',
          evidence: {
            artifact_hash: artifact.content_hash,
            nonce_ok: true,
            timeout_ok: true,
            reason: parsed.message.message || 'sandbox failure',
          },
        });
        return;
      }
      const errors = validateViewAst(parsed.message.ast, bindings);
      if (errors.length) {
        setStatus('failed');
        setMessage(errors[0] ?? 'ViewAST 未通过白名单校验');
        onEvidence?.({
          status: 'rejected',
          evidence: {
            artifact_hash: artifact.content_hash,
            nonce_ok: true,
            timeout_ok: true,
            reason: 'ast_rejected',
            errors: errors.slice(0, 5),
          },
        });
        return;
      }
      setAst(parsed.message.ast);
      setStatus('rendered');
      setMessage('');
      const nodeCount = Array.isArray(parsed.message.ast.nodes) ? parsed.message.ast.nodes.length : 0;
      onEvidence?.({
        status: 'accepted',
        evidence: {
          artifact_hash: artifact.content_hash,
          nonce_ok: true,
          timeout_ok: true,
          node_count: nodeCount,
          elapsed_ms: parsed.message.elapsedMs,
          source: 'opaque-origin-worker',
        },
      });
      onAccepted?.();
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, [artifact.artifact_id, artifact.content_hash, bindings, nonce, onAccepted, onEvidence, revision]);

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  if (status === 'timeout' || status === 'failed') {
    return (
      <div className={styles.frame} data-status={status}>
        <p className={styles.notice} role="alert">{message || '专用视图不可用，已回退声明式视图。'}</p>
        {fallback}
      </div>
    );
  }

  return (
    <div className={styles.frame} data-status={status}>
      <iframe
        key={`${nonce}-${revision}`}
        ref={iframeRef}
        className={styles.iframe}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        title="专用视图隔离沙箱"
        srcDoc={SANDBOX_SRCDOC}
        onLoad={start}
      />
      {status === 'pending' ? <p className={styles.notice} role="status">正在隔离环境中运行专用视图…</p> : null}
      {status === 'rendered' && ast ? <ViewAstRenderer ast={ast} bindings={bindings} className={styles.view} /> : null}
      <p className={styles.meta}>
        <span>{artifact.acceptance_status === 'accepted' ? '已通过隔离验收' : '待隔离验收'}</span>
        <span>allow-scripts · opaque origin · Worker · {timeoutMs}ms</span>
      </p>
    </div>
  );
}

export default GeneratedViewFrame;
