import { useEffect, useMemo, useRef, useState } from 'react';
import type { CanvasNode, NodeType, PortValue, RuleControlSpec } from './types.ts';
import type { NodeBodyProps, NodeDef } from './nodes.tsx';
import {
  defaultAiRuleParams,
  defaultAiRulePayload,
  normalizeAiRulePayload,
  parseAiRulePayload,
  serializeAiRulePayload,
  type AiRuleBlockPayload,
} from './aiRuleBlock.ts';
import { runRuleInSandbox } from './ruleSandbox.ts';
import { generateAiRuleBlock } from '@/api/workshopAi';
import { errorMessage } from '@/api/client';
import { Notice } from './BlockPrimitives.tsx';
import styles from './blocks.module.css';

function payloadParams(node: CanvasNode, payload: AiRuleBlockPayload): Record<string, number> {
  return { ...defaultAiRuleParams(payload), ...node.params };
}

async function verifyPayload(payload: AiRuleBlockPayload, node: CanvasNode): Promise<string> {
  const text = node.text ?? payload.defaultText ?? '';
  const base = payloadParams(node, payload);
  try {
    const run = await runRuleInSandbox(payload.code, { text, params: base, upstream: [] });
    if (run.result.frames.length < 2) return 'AI 规则至少需要 2 帧逐帧过程';
    for (const preset of payload.presets ?? []) {
      await runRuleInSandbox(payload.code, {
        text: preset.text ?? text,
        params: { ...base, ...preset.params },
        upstream: [],
      });
    }
    return '';
  } catch (error) {
    return error instanceof Error ? error.message : '规则试跑失败';
  }
}

export function useAiRuleRunner(node: CanvasNode, onLive?: (outputs: Record<string, PortValue>) => void): {
  payload: AiRuleBlockPayload;
  result: Awaited<ReturnType<typeof runRuleInSandbox>> | null;
  error: string;
  busy: boolean;
} {
  const parsed = useMemo(() => parseAiRulePayload(node.payload), [node.payload]);
  const payload = useMemo(() => parsed ?? defaultAiRulePayload(), [parsed]);
  const liveRef = useRef(onLive);
  liveRef.current = onLive;
  const [result, setResult] = useState<Awaited<ReturnType<typeof runRuleInSandbox>> | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const signature = useMemo(() => JSON.stringify({
    code: payload.code,
    params: payloadParams(node, payload),
    text: node.text ?? payload.defaultText ?? '',
  }), [node.params, node.text, payload]);
  useEffect(() => {
    let dead = false;
    setBusy(true);
    setError('');
    void Promise.resolve().then(() => runRuleInSandbox(payload.code, {
      text: node.text ?? payload.defaultText ?? '',
      params: payloadParams(node, payload),
      upstream: [],
    })).then((next) => {
      if (dead) return;
      setResult(next);
      liveRef.current?.({ out: {
        kind: 'customFrames',
        title: payload.title,
        controls: payload.controls,
        result: next.result,
        elapsedMs: next.elapsedMs,
      } });
    }).catch((cause: unknown) => {
      if (dead) return;
      const message = cause instanceof Error ? cause.message : '规则执行失败';
      setError(message);
      setResult(null);
      liveRef.current?.({ out: {
        kind: 'customFrames',
        title: payload.title,
        controls: payload.controls,
        result: { data: {}, frames: [] },
        error: message,
      } });
    }).finally(() => {
      if (!dead) setBusy(false);
    });
    return () => { dead = true; };
  }, [signature, payload]);
  return { payload, result, error, busy };
}

export function AiRuleLive({ node, onLive }: { node: CanvasNode; onLive?: NodeBodyProps['onLive'] }): null {
  useAiRuleRunner(node, onLive);
  return null;
}

function controlValue(node: CanvasNode, control: RuleControlSpec): number {
  const value = node.params[control.key];
  return typeof value === 'number' && Number.isFinite(value) ? value : control.value;
}

export function AiRuleBlockBody(props: NodeBodyProps): JSX.Element {
  const { node, inCard, onParams, onText, onPayload } = props;
  const parsed = useMemo(() => parseAiRulePayload(node.payload), [node.payload]);
  const payload = useMemo(() => parsed ?? defaultAiRulePayload(), [parsed]);
  const { result, error, busy } = useAiRuleRunner(node, props.onLive);
  const [prompt, setPrompt] = useState(payload.prompt);
  const [draftOpen, setDraftOpen] = useState(false);
  const [codeDraft, setCodeDraft] = useState(payload.code);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState('');
  const [applyError, setApplyError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => setPrompt(payload.prompt), [payload.prompt]);
  useEffect(() => setCodeDraft(payload.code), [payload.code]);

  const savePayload = (next: AiRuleBlockPayload): void => {
    onPayload?.(serializeAiRulePayload(next));
  };
  const generate = async (): Promise<void> => {
    if (!onPayload || !prompt.trim()) return;
    setGenerating(true);
    setGenerateError('');
    setNotice('');
    let lastError = '';
    let current = parsed;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let next: AiRuleBlockPayload;
      try {
        next = await generateAiRuleBlock({
          prompt: prompt.trim(),
          current_payload: current,
          ...(lastError ? { last_error: lastError } : {}),
          upstream_hints: [],
        });
      } catch (cause) {
        setGenerateError(errorMessage(cause));
        setGenerating(false);
        return;
      }
      const failure = await verifyPayload(next, node);
      if (!failure) {
        savePayload(next);
        setNotice(`已生成 ${next.title} · ${next.controls.length} 个参数${next.presets?.length ? ` · ${next.presets.length} 组预设` : ''}`);
        setGenerating(false);
        return;
      }
      lastError = failure;
      current = next;
    }
    setGenerateError(`规则试跑未通过：${lastError}`);
    setGenerating(false);
  };

  const applyCode = async (): Promise<void> => {
    if (!onPayload) return;
    try {
      const next = normalizeAiRulePayload({ ...payload, code: codeDraft });
      const failure = await verifyPayload(next, node);
      if (failure) {
        setApplyError(failure);
        return;
      }
      savePayload(next);
      setApplyError('');
      setNotice('规则代码已应用并通过试跑');
    } catch (cause) {
      setApplyError(errorMessage(cause));
    }
  };

  const valueControls = payload.controls.slice(0, inCard ? 4 : 8);
  return <div className={styles.root}>
    {!parsed ? <Notice>规则载荷无法解析；当前使用内置示例。可在代码抽屉中重新应用规则。</Notice> : null}
    <textarea className={styles.textarea} rows={inCard ? 2 : 3} value={prompt} spellCheck={false}
      aria-label="自然语言规则描述" placeholder="例如：演示 3 阶 B 树插入分裂"
      readOnly={!onPayload || generating} onChange={(event) => setPrompt(event.currentTarget.value)} />
    {onPayload ? <div className={styles.presets}>
      <button type="button" disabled={generating || !prompt.trim()} onClick={() => void generate()}>
        {generating ? 'AI 生成中…' : parsed ? 'AI 修改规则' : 'AI 生成规则'}
      </button>
      {notice ? <span className={styles.fileStatus}>{notice}</span> : null}
    </div> : null}
    {generateError ? <p className={styles.fileStatus} data-error="true" role="alert">{generateError}</p> : null}
    {payload.textLabel && onText ? <label className={`${styles.field} ${styles.wide}`}>{payload.textLabel}
      <textarea className={styles.textarea} rows={2} value={node.text ?? payload.defaultText ?? ''} spellCheck={false}
        onChange={(event) => onText(event.currentTarget.value)} />
    </label> : null}
    {valueControls.length ? <div className={styles.controls}>
      {valueControls.map((control) => control.options ? <label key={control.key} className={styles.field}>{control.label}
        <select value={controlValue(node, control)} onChange={(event) => onParams?.({ [control.key]: Number(event.currentTarget.value) })}>
          {control.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label> : <label key={control.key} className={styles.controlRow}>
        <span>{control.label}</span>
        <input type="range" aria-label={control.label} min={control.min ?? 0} max={control.max ?? 1} step={control.step ?? 0.01}
          value={controlValue(node, control)} onChange={(event) => onParams?.({ [control.key]: event.currentTarget.valueAsNumber })} />
        <output>{controlValue(node, control)}</output>
      </label>)}
    </div> : null}
    {payload.presets?.length ? <div className={styles.presets} role="group" aria-label="AI 规则情景预设">
      {payload.presets.map((preset) => <button key={preset.label} type="button"
        onClick={() => { onParams?.(preset.params); if (preset.text !== undefined) onText?.(preset.text); }}>{preset.label}</button>)}
    </div> : null}
    <div className={styles.tagRow}>
      <span className={styles.tag}>{payload.preferredView === 'auto' ? '自动舞台' : payload.preferredView}</span>
      <span className={styles.tag}>{busy ? '运行中…' : error ? '试跑失败' : result ? `✓ ${result.result.frames.length} 帧 · ${Number(result.elapsedMs.toFixed(1))}ms` : '等待运行'}</span>
      {payload.verificationNote ? <span className={styles.tag}>可核对</span> : null}
    </div>
    {error ? <Notice>{error}</Notice> : null}
    {!inCard && <>
      {payload.summary ? <p className={styles.tip}>{payload.summary}</p> : null}
      {payload.verificationNote ? <p className={styles.tip}>核对：{payload.verificationNote}</p> : null}
      <details className={styles.tip} open={draftOpen} onToggle={(event) => setDraftOpen(event.currentTarget.open)}>
        <summary>查看 / 编辑规则代码</summary>
        <textarea className={styles.textarea} rows={12} value={codeDraft} spellCheck={false} aria-label="规则代码"
          readOnly={!onPayload} onChange={(event) => setCodeDraft(event.currentTarget.value)} />
        {onPayload ? <button type="button" className={styles.tag} onClick={() => void applyCode()}>应用并校验</button> : null}
        {applyError ? <p className={styles.fileStatus} data-error="true" role="alert">{applyError}</p> : null}
      </details>
    </>}
  </div>;
}

export const AI_RULE_DEFS: Partial<Record<NodeType, NodeDef>> = {
  aiRuleBlock: {
    title: 'AI 智能计算方块', badge: '实验', width: 360,
    outputs: [{ id: 'out', label: '实验数据', kind: 'customFrames' }],
    Body: AiRuleBlockBody,
  },
};
