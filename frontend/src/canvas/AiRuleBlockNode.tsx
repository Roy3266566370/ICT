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
import { ruleAuxiliaryOutputs, ruleUpstream, upstreamHint } from './aiRulePorts.ts';
import { runRuleInSandbox } from './ruleSandbox.ts';
import { saveCustomAiRuleBlock } from './customBlocks.ts';
import { PipelineFrameDetails } from './Lab408PipelineNode.tsx';
import { generateAiRuleBlock } from '@/api/workshopAi';
import { errorMessage } from '@/api/client';
import { Notice } from './BlockPrimitives.tsx';
import styles from './blocks.module.css';

function payloadParams(node: CanvasNode, payload: AiRuleBlockPayload): Record<string, number> {
  return { ...defaultAiRuleParams(payload), ...node.params };
}

const VIEW_LABELS: Record<AiRuleBlockPayload['preferredView'], string> = {
  auto: '自动图画',
  shapes: '2D 图形',
  grid: '网格热图',
  chart: '折线图',
  graph: '节点图',
  timeline: '时间轴',
  table: '数据表',
};

export async function verifyAiRulePayload(
  payload: AiRuleBlockPayload,
  params?: Record<string, number>,
  text?: string,
  upstream: Record<string, unknown>[] = [],
): Promise<string> {
  const effectiveText = text ?? payload.defaultText ?? '';
  const base = { ...defaultAiRuleParams(payload), ...(params ?? {}) };
  try {
    const run = await runRuleInSandbox(payload.code, { text: effectiveText, params: base, upstream });
    if (run.result.frames.length < 1) return '规则至少需要返回 1 帧数据';
    for (const preset of payload.presets ?? []) {
      await runRuleInSandbox(payload.code, {
        text: preset.text ?? effectiveText,
        params: { ...base, ...preset.params },
        upstream,
      });
    }
    return '';
  } catch (error) {
    return error instanceof Error ? error.message : '规则试跑失败';
  }
}

export function AiRuleLive({ node, values, onLive }: Pick<NodeBodyProps, 'node' | 'values' | 'onLive'>): null {
  const payload = useMemo(() => parseAiRulePayload(node.payload) ?? defaultAiRulePayload(), [node.payload]);
  const liveRef = useRef(onLive);
  liveRef.current = onLive;
  const signature = JSON.stringify({
    text: node.text ?? payload.defaultText ?? '',
    params: payloadParams(node, payload),
    upstream: ruleUpstream(values),
  });
  const pending = useRef<{ signature: string; payload: AiRuleBlockPayload } | null>(null);
  const currentPayload = useRef(payload);
  currentPayload.current = payload;
  const running = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pending.current = null;
    };
  }, []);

  useEffect(() => {
    pending.current = { signature, payload };
    if (running.current) return;
    running.current = true;
    // Animated sources can update before a Worker finishes. Keep only their latest input.
    void (async () => {
      try {
        while (mounted.current && pending.current) {
          const request = pending.current;
          pending.current = null;
          const { code, title, controls } = request.payload;
          let outputs: Record<string, PortValue>;
          try {
            const next = await runRuleInSandbox(code, JSON.parse(request.signature) as Parameters<typeof runRuleInSandbox>[1]);
            outputs = {
              out: { kind: 'customFrames', title, controls, result: next.result, elapsedMs: next.elapsedMs },
              ...ruleAuxiliaryOutputs(next.result, title),
            };
          } catch (cause) {
            const error = cause instanceof Error ? cause.message : '规则执行失败';
            outputs = { out: { kind: 'customFrames', title, controls, result: { data: {}, frames: [] }, error } };
          }
          if (mounted.current && currentPayload.current === request.payload) liveRef.current?.(outputs);
          await new Promise<void>((resolve) => window.setTimeout(resolve, 64));
        }
      } finally {
        running.current = false;
      }
    })();
  }, [signature, payload]);
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
  const result = props.self?.kind === 'customFrames' ? props.self : null;
  const error = result?.error;
  const busy = result === null;
  const upstream = () => ruleUpstream(props.values);

  // 画布卡片极简播放进度条状态
  const frames = result?.result.frames ?? [];
  const lastFrame = Math.max(0, frames.length - 1);
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    setFrameIndex((prev) => Math.min(prev, lastFrame));
  }, [lastFrame]);

  useEffect(() => {
    if (!playing || frames.length <= 1) return undefined;
    const timer = window.setInterval(() => {
      setFrameIndex((prev) => (prev >= lastFrame ? 0 : prev + 1));
    }, 650);
    return () => window.clearInterval(timer);
  }, [playing, frames.length, lastFrame]);

  // 右侧检查器状态
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
          upstream_hints: props.upstreamLabel ? [`${props.upstreamLabel} · ${upstreamHint(upstream()[0] ?? null)}`] : [],
        });
      } catch (cause) {
        setGenerateError(errorMessage(cause));
        setGenerating(false);
        return;
      }
      const failure = await verifyAiRulePayload(next, payloadParams(node, next), node.text ?? next.defaultText, upstream());
      if (!failure) {
        savePayload(next);
        onParams?.(defaultAiRuleParams(next));
        if (next.defaultText !== undefined) onText?.(next.defaultText);
        setNotice(`已更新：${next.title} · ${next.controls.length} 个参数`);
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
      const failure = await verifyAiRulePayload(next, payloadParams(node, next), node.text ?? next.defaultText, upstream());
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

  const saveToLibrary = (): void => {
    const title = window.prompt('给这块自建积木起个名字', payload.title || '我的自建积木');
    if (title === null) return;
    try {
      saveCustomAiRuleBlock(title, payload, payloadParams(node, payload), node.text ?? payload.defaultText);
      setNotice('已存入「我的积木库」，可在任意画布拖出复用');
    } catch (cause) {
      setNotice(errorMessage(cause));
    }
  };

  const activeFrame = frames[Math.min(frameIndex, lastFrame)];

  // 1) 画布卡片态：展示对应图画 + 极简 ▶ 播放/进度条 + 一行核心结论
  if (inCard) {
    return (
      <div className={styles.aiCardShell}>
        <div className={styles.aiCardHeader}>
          <span className={styles.aiCardTitle}>{payload.title || '自建智能积木'}</span>
          <div className={styles.tagRow}>
            <span className={styles.tag}>{VIEW_LABELS[payload.preferredView]}</span>
            {props.upstreamLabel && <span className={styles.tag} title={props.upstreamLabel}>已接入上游数据</span>}
            <span className={styles.tag}>
              {busy ? '计算中…' : error ? '试跑失败' : result ? `✓ ${frames.length}帧` : '就绪'}
            </span>
          </div>
        </div>

        <div className={styles.aiCardVisual}>
          {error ? (
            <Notice>{error}</Notice>
          ) : activeFrame ? (
            <PipelineFrameDetails frame={activeFrame} compact showSummary={false} />
          ) : (
            <Notice>{busy ? '正在沙箱中计算画面…' : '暂无可展示帧'}</Notice>
          )}
        </div>

        {frames.length > 1 ? (
          <div
            className={styles.aiCardPlaybar}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className={styles.aiCardPlayBtn}
              aria-label={playing ? '暂停播放' : '播放帧动画'}
              onClick={() => setPlaying((prev) => !prev)}
            >
              {playing ? '⏸' : '▶'}
            </button>
            <input
              type="range"
              className={styles.aiCardRange}
              aria-label="卡片帧进度"
              min={0}
              max={lastFrame}
              step={1}
              value={Math.min(frameIndex, lastFrame)}
              onChange={(event) => {
                setPlaying(false);
                setFrameIndex(event.currentTarget.valueAsNumber);
              }}
            />
            <span className={styles.aiCardFrameCount}>
              {Math.min(frameIndex, lastFrame) + 1}/{frames.length}
            </span>
          </div>
        ) : null}

        {activeFrame?.summary ? (
          <p className={styles.aiCardSummary}>{activeFrame.summary}</p>
        ) : payload.summary ? (
          <p className={styles.aiCardSummary}>{payload.summary}</p>
        ) : null}

      </div>
    );
  }

  // 2) 右侧检查器态：调参 + 自定义数据输入 + 预设 + AI 微调 + 规则代码 + 存入积木库
  const valueControls = payload.controls.slice(0, 8);
  return (
    <div className={styles.root}>
      {!parsed ? <Notice>规则载荷无法解析；当前使用内置示例。可在下方代码抽屉重新应用。</Notice> : null}

      <div className={styles.tagRow}>
        {props.upstreamLabel && <span className={styles.tag} title={props.upstreamLabel}>已接入上游数据</span>}
        <span className={styles.tag}>{VIEW_LABELS[payload.preferredView]}</span>
        <span className={styles.tag}>
          {busy ? '运行中…' : error ? '试跑失败' : result ? `✓ ${frames.length} 帧 · ${Number((result.elapsedMs ?? 0).toFixed(1))}ms` : '等待运行'}
        </span>
        {payload.verificationNote ? <span className={styles.tag}>可手算核对</span> : null}
      </div>

      {error ? <Notice>{error}</Notice> : null}

      {onText ? (
        <div className={styles.aiInspectorGroup}>
          <p className={styles.aiInspectorLabel}>{payload.textLabel || '自定义输入数据（文本 / 序列 / 参数表）'}</p>
          <textarea
            className={styles.textarea}
            rows={2}
            value={node.text ?? payload.defaultText ?? ''}
            spellCheck={false}
            placeholder="输入你自己的测试数据，卡片图画将实时重算"
            onChange={(event) => onText(event.currentTarget.value)}
          />
        </div>
      ) : null}

      {valueControls.length > 0 ? (
        <div className={styles.aiInspectorGroup}>
          <p className={styles.aiInspectorLabel}>参数调节</p>
          <div className={styles.controls}>
            {valueControls.map((control) =>
              control.options ? (
                <label key={control.key} className={styles.field}>
                  {control.label}
                  <select
                    value={controlValue(node, control)}
                    onChange={(event) => onParams?.({ [control.key]: Number(event.currentTarget.value) })}
                  >
                    {control.options.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
              ) : (
                <label key={control.key} className={styles.controlRow}>
                  <span>{control.label}</span>
                  <input
                    type="range"
                    aria-label={control.label}
                    min={control.min ?? 0}
                    max={control.max ?? 1}
                    step={control.step ?? 0.01}
                    value={controlValue(node, control)}
                    onChange={(event) => onParams?.({ [control.key]: event.currentTarget.valueAsNumber })}
                  />
                  <output>{controlValue(node, control)}</output>
                </label>
              ),
            )}
          </div>
        </div>
      ) : null}

      {payload.presets?.length ? (
        <div className={styles.presets} role="group" aria-label="情景预设">
          {payload.presets.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => {
                onParams?.(preset.params);
                if (preset.text !== undefined) onText?.(preset.text);
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>
      ) : null}

      {onPayload ? (
        <div className={styles.aiInspectorGroup}>
          <p className={styles.aiInspectorLabel}>用一句话让 AI 微调此积木</p>
          <textarea
            className={styles.textarea}
            rows={2}
            value={prompt}
            spellCheck={false}
            aria-label="自然语言规则描述"
            placeholder="例如：增加一个学习率滑杆，并标出最优点"
            readOnly={generating}
            onChange={(event) => setPrompt(event.currentTarget.value)}
          />
          <div className={styles.presets}>
            <button type="button" disabled={generating || !prompt.trim()} onClick={() => void generate()}>
              {generating ? 'AI 修改中…' : 'AI 微调规则'}
            </button>
            <button type="button" onClick={saveToLibrary}>
              💾 存入我的积木库
            </button>
          </div>
          {notice ? <span className={styles.fileStatus}>{notice}</span> : null}
          {generateError ? <p className={styles.fileStatus} data-error="true" role="alert">{generateError}</p> : null}
        </div>
      ) : null}

      {payload.summary ? <p className={styles.tip}>{payload.summary}</p> : null}
      {payload.verificationNote ? <p className={styles.tip}>核对：{payload.verificationNote}</p> : null}

      <details className={styles.tip} open={draftOpen} onToggle={(event) => setDraftOpen(event.currentTarget.open)}>
        <summary>查看 / 编辑规则代码</summary>
        <textarea
          className={styles.textarea}
          rows={12}
          value={codeDraft}
          spellCheck={false}
          aria-label="规则代码"
          readOnly={!onPayload}
          onChange={(event) => setCodeDraft(event.currentTarget.value)}
        />
        {onPayload ? (
          <button type="button" className={styles.tag} onClick={() => void applyCode()}>
            应用并校验
          </button>
        ) : null}
        {applyError ? <p className={styles.fileStatus} data-error="true" role="alert">{applyError}</p> : null}
      </details>
    </div>
  );
}

export const AI_RULE_DEFS: Partial<Record<NodeType, NodeDef>> = {
  aiRuleBlock: {
    title: '自建智能积木', badge: '实验', width: 340,
    inputs: [{ id: 'in', label: '上游数据' }],
    outputs: [
      { id: 'out', label: '实验数据', kind: 'customFrames' },
      { id: 'value', label: '主数值', kind: 'scalar' },
      { id: 'series', label: '数据曲线', kind: 'series' },
    ],
    Body: AiRuleBlockBody,
  },
};
