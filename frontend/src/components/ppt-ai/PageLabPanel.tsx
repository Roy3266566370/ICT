import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '@/api/client';
import { createPageLab, getPageLab, type PageLab } from '@/api/pptAI';
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
import styles from './PageLabPanel.module.css';

const RUN_TIMEOUT_MS = 3000;

type Values = Record<string, number>;

function defaultsOf(lab: PageLab): Values {
  return Object.fromEntries(lab.params.map((param) => [param.id, param.default]));
}

function formatValue(value: number, step: number): string {
  const digits = Math.min(4, Math.max(0, Math.ceil(-Math.log10(step || 1))));
  return value.toFixed(digits);
}

/** 在 opaque-origin iframe + Worker 里运行模型生成的程序；滑块变化时复用同一个 iframe。 */
export function LabCanvas({ lab, values }: { lab: PageLab; values: Values }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const nonceRef = useRef('');
  const timerRef = useRef<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [ast, setAst] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState('');
  const artifactId = `page-lab-${lab.page_no}`;
  const revision = lab.content_hash;

  const clearTimer = () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  useEffect(() => {
    const listener = (event: MessageEvent) => {
      const parsed = parseSandboxMessage(event.data, {
        nonce: nonceRef.current,
        artifactId,
        revision,
        source: event.source,
        contentWindow: iframeRef.current?.contentWindow ?? null,
      });
      if (!parsed.ok) return;
      clearTimer();
      if (!isSandboxResult(parsed.message)) {
        setError(parsed.message.message || '交互程序执行失败');
        return;
      }
      const errors = validateViewAst(parsed.message.ast);
      if (errors.length) {
        setError(errors[0] ?? '视图未通过白名单校验');
        return;
      }
      setError('');
      setAst(parsed.message.ast);
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, [artifactId, revision]);

  useEffect(() => {
    if (!loaded) return;
    const target = iframeRef.current?.contentWindow;
    if (!target) return;
    const nonce = newNonce();
    nonceRef.current = nonce;
    clearTimer();
    timerRef.current = window.setTimeout(() => setError('交互程序运行超时，已终止。'), RUN_TIMEOUT_MS);
    const init: SandboxInit = {
      type: 'init',
      protocol: PROTOCOL_VERSION,
      nonce,
      artifactId,
      revision,
      program: lab.program,
      input: values,
      timeoutMs: RUN_TIMEOUT_MS,
    };
    target.postMessage(init, '*');
  }, [loaded, lab.program, values, artifactId, revision]);

  useEffect(() => clearTimer, []);

  return (
    <div className={styles.stage}>
      <iframe
        ref={iframeRef}
        className={styles.iframe}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        title="AI 交互隔离沙箱"
        srcDoc={SANDBOX_SRCDOC}
        onLoad={() => setLoaded(true)}
      />
      {ast ? <ViewAstRenderer ast={ast} className={styles.view} /> : <p className={styles.stageNote} role="status">正在运行…</p>}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
    </div>
  );
}

interface Props {
  materialId: string;
  pageNo: number;
  onClose: () => void;
}

export function PageLabPanel({ materialId, pageNo, onClose }: Props) {
  const [lab, setLab] = useState<PageLab | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [values, setValues] = useState<Values>({});

  useEffect(() => {
    let cancelled = false;
    setLab(null);
    setError('');
    setLoading(true);
    getPageLab(materialId, pageNo)
      .then((result) => {
        if (cancelled) return;
        setLab(result.lab);
        setValues(result.lab ? defaultsOf(result.lab) : {});
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(errorMessage(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [materialId, pageNo]);

  const generate = useCallback(
    async (force: boolean) => {
      setGenerating(true);
      setError('');
      try {
        const result = await createPageLab(materialId, pageNo, force);
        setLab(result.lab);
        setValues(defaultsOf(result.lab));
      } catch (reason) {
        setError(errorMessage(reason));
      } finally {
        setGenerating(false);
      }
    },
    [materialId, pageNo],
  );

  return (
    <div className={styles.panel}>
      <div className={styles.head}>
        <span>AI 交互 · 第 {pageNo} 页</span>
        <button type="button" onClick={onClose} aria-label="关闭 AI 交互面板">×</button>
      </div>
      <div className={styles.body}>
        {loading ? <p className={styles.hint} role="status">正在读取…</p> : null}
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        {!loading && !lab ? (
          <>
            <p className={styles.hint}>
              让模型阅读本页内容，生成一个可拖动参数的交互实验。结果在隔离沙箱里运行，原页保持不变。
            </p>
            <button type="button" className={styles.primary} onClick={() => void generate(false)} disabled={generating}>
              {generating ? '正在生成，通常需要 30–90 秒，请不要关闭面板…' : 'AI 生成本页交互'}
            </button>
          </>
        ) : null}
        {lab ? (
          <>
            <h3 className={styles.title}>{lab.title}</h3>
            {lab.summary ? <p className={styles.summary}>{lab.summary}</p> : null}
            <LabCanvas lab={lab} values={values} />
            <fieldset className={styles.sliders}>
              {lab.params.map((param) => (
                <label key={param.id} className={styles.slider}>
                  <span>{param.label}</span>
                  <output>
                    {formatValue(values[param.id] ?? param.default, param.step)}
                    {param.unit}
                  </output>
                  <input
                    type="range"
                    min={param.min}
                    max={param.max}
                    step={param.step}
                    value={values[param.id] ?? param.default}
                    onChange={(event) => setValues((current) => ({ ...current, [param.id]: Number(event.target.value) }))}
                  />
                </label>
              ))}
            </fieldset>
            {lab.explain.length ? (
              <ul className={styles.explain}>
                {lab.explain.map((item) => <li key={item}>{item}</li>)}
              </ul>
            ) : null}
            <div className={styles.actions}>
              <button type="button" className={styles.secondary} onClick={() => setValues(defaultsOf(lab))}>恢复默认</button>
              <button type="button" className={styles.secondary} onClick={() => void generate(true)} disabled={generating}>
                {generating ? '正在重新生成…' : '重新生成'}
              </button>
            </div>
            <p className={styles.meta}>由 {lab.generator.model} 生成 · 示例数据为教学演示，不代表原稿数值</p>
          </>
        ) : null}
      </div>
    </div>
  );
}

export default PageLabPanel;
