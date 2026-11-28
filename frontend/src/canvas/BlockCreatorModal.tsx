/** 双栏「创建积木」工作台：整合 AI 一句话造积木、清晰规则说明书、手写代码与实时带图预览。 */

import { useEffect, useMemo, useState } from 'react';
import {
  defaultAiRuleParams,
  defaultAiRulePayload,
  normalizeAiRulePayload,
  type AiRuleBlockPayload,
} from './aiRuleBlock.ts';
import { RULE_TIMEOUT_MS, runRuleInSandbox } from './ruleSandbox.ts';
import type { RuleUpstreamContext } from './aiRulePorts.ts';
import { verifyAiRulePayload } from './AiRuleBlockNode.tsx';
import { PipelineFrameDetails } from './Lab408PipelineNode.tsx';
import { fuseAiRuleBlock, generateAiRuleBlock } from '@/api/workshopAi';
import { errorMessage } from '@/api/client';
import blockStyles from './blocks.module.css';
import styles from './blockCreator.module.css';

export interface RuleFuseContext {
  nodeIds: string[];
  nodeTitles: string[];
  defaultPrompt: string;
  nodesSummary: Array<Record<string, unknown>>;
  wiresSummary: Array<Record<string, unknown>>;
  externalPorts: {
    inputs: Array<{ id: string; label: string; kind?: string; fromNodeTitle?: string }>;
    outputs: Array<{ id: string; label: string; kind?: string; toNodeTitle?: string }>;
  };
  sampleInputs: Record<string, unknown>;
  sampleUpstream: Record<string, unknown>[];
}

interface BlockCreatorModalProps {
  open: boolean;
  upstreamContext?: RuleUpstreamContext | null;
  fuseContext?: RuleFuseContext | null;
  onClose: () => void;
  onInsert: (
    payload: AiRuleBlockPayload,
    params: Record<string, number>,
    text: string,
    saveToLibrary: boolean,
    options?: { keepOriginals?: boolean },
  ) => void;
}

type CreatorTab = 'ai' | 'manual';
type PreferredView = AiRuleBlockPayload['preferredView'];

const AI_EXAMPLES = [
  { label: '弹簧振子', prompt: '用 2D 图元逐帧展示弹簧振子的往复运动和回复力矢量，支持调整振幅' },
  { label: '热力扩散', prompt: '用二维网格热力图逐帧展示中心热源的扩散，支持调整扩散速度和随机种子' },
  { label: '磁盘调度 SCAN', prompt: '演示电梯磁盘调度 SCAN 的磁头轨迹，并对比 FCFS 总寻道长度，支持自定义请求序列与初始磁头位置' },
  { label: '二阶阻尼响应', prompt: '演示二阶阻尼振子 y\'\' + 2ζωy\' + ω²y = 0 在不同阻尼比 ζ 与频率 ω 下的时域曲线响应' },
  { label: 'B 树节点分裂', prompt: '演示 3 阶 B 树依次插入关键字时节点分裂的逐帧图拓扑结构' },
  { label: '排队论 M/M/1', prompt: '演示 M/M/1 排队模型在不同到达率 λ 和服务率 μ 下的平均等待时间与队列长度变化曲线' },
];

const VIEW_OPTIONS: Array<{ value: PreferredView; label: string }> = [
  { value: 'auto', label: '自动选择' },
  { value: 'shapes', label: '2D 图形' },
  { value: 'grid', label: '网格热图' },
  { value: 'chart', label: '折线/曲线图' },
  { value: 'graph', label: '节点拓扑图' },
  { value: 'timeline', label: '甘特时间轴' },
  { value: 'table', label: '步骤数据表' },
];

const STARTER_TEMPLATES: Record<Exclude<PreferredView, 'auto'>, AiRuleBlockPayload> = {
  shapes: {
    version: 1,
    prompt: '弹簧振子和回复力',
    title: '弹簧振子和回复力',
    summary: '观察弹簧两侧的位移和回复力方向',
    controls: [{ key: 'amplitude', label: '振幅', value: 72, min: 12, max: 110, step: 1 }],
    preferredView: 'shapes',
    verificationNote: '振子在最右侧时回复力指向左侧；平衡位置回复力为零。',
    code: `function run({ params }) {
  const amplitude = params.amplitude ?? 72;
  const frames = Array.from({ length: 16 }, (_, i) => {
    const shift = amplitude * Math.cos(i * Math.PI / 8);
    const x = 220 + shift;
    const spring = Array.from({ length: 11 }, (_, j) => [
      45 + (x - 63) * j / 10, 120 + (j % 2 ? 12 : -12) * Number(j > 0 && j < 10),
    ]);
    return {
      title: '弹簧振动 · ' + (i + 1),
      summary: '位移 ' + shift.toFixed(1) + '，回复力 ' + (-shift).toFixed(1),
      shapes: {
        items: [
          { kind: 'line', x1: 220, y1: 42, x2: 220, y2: 198, stroke: '#8ba0bc', dashed: true },
          ...spring.slice(1).map(([x2, y2], j) => ({ kind: 'line', x1: spring[j][0], y1: spring[j][1], x2, y2 })),
          { kind: 'rect', x: 29, y: 83, w: 16, h: 74, fill: '#526684', stroke: 'none' },
          { kind: 'circle', cx: x, cy: 120, r: 18, fill: '#8cc9e8', label: 'm' },
          ...(Math.abs(shift) < 1 ? [] : [{ kind: 'arrow', x1: x, y1: 66, x2: x - shift * 0.65, y2: 66, stroke: '#b04936', label: '回复力' }]),
        ],
      },
    };
  });
  return { data: { value: amplitude }, frames };
}`,
  },
  grid: {
    version: 1,
    prompt: '热量在二维网格中扩散',
    title: '二维热力扩散',
    summary: '观察局部热源逐步向四周扩散',
    preferredView: 'grid',
    controls: [
      { key: 'rate', label: '扩散速度', value: 0.75, min: 0.1, max: 1, step: 0.05 },
      { key: 'seed', label: '随机种子', value: 42, min: 0, max: 100, step: 1 },
    ],
    verificationNote: '均匀环境中热源温度最高；下一步其相邻格温度升高。',
    code: `function run({ params, rand }) {
  const rate = params.rate ?? 0.75;
  let cells = Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => Math.floor(rand() * 4)));
  cells[4][4] = 100;
  const frames = [];
  for (let i = 0; i < 16; i += 1) {
    frames.push({
      title: '扩散第 ' + i + ' 步',
      summary: '中心温度 ' + cells[4][4].toFixed(1),
      grid: { cells, min: 0, max: 100, showValues: false, activeCell: [4, 4] },
    });
    cells = cells.map((row, r) => row.map((v, c) => {
      const mean = ((cells[r - 1]?.[c] ?? v) + (cells[r + 1]?.[c] ?? v) +
        (row[c - 1] ?? v) + (row[c + 1] ?? v)) / 4;
      return v + rate * (mean - v);
    }));
  }
  return { data: { value: cells[4][4] }, frames };
}`,
  },
  chart: {
    version: 1,
    prompt: '自定义折线函数演示',
    title: '自定义阻尼波形',
    summary: '按参数实时生成带衰减包络的波形曲线',
    textLabel: '自定义说明（可选）',
    defaultText: '阻尼振子自定义实验',
    controls: [
      { key: 'zeta', label: '阻尼比 ζ', value: 0.25, min: 0.05, max: 1.2, step: 0.05 },
      { key: 'freq', label: '频率 ω', value: 3, min: 1, max: 6, step: 0.25 },
    ],
    presets: [
      { label: '欠阻尼振荡', params: { zeta: 0.2, freq: 3.5 } },
      { label: '临界阻尼', params: { zeta: 1.0, freq: 3.0 } },
    ],
    preferredView: 'chart',
    verificationNote: 't=0 时 y(0)=1；ζ 越小振荡衰减越慢',
    code: `function run({ params }) {
  const z = Number(params.zeta ?? 0.25);
  const w = Number(params.freq ?? 3);
  const frames = [];
  for (let step = 1; step <= 6; step += 1) {
    const tMax = step;
    const pts = [];
    for (let i = 0; i <= 30; i += 1) {
      const t = (i / 30) * tMax;
      const y = Math.exp(-z * w * t) * Math.cos(w * t);
      pts.push({ x: Number(t.toFixed(2)), y: Number(y.toFixed(3)) });
    }
    frames.push({
      title: '时间窗口 0 ~ ' + tMax + 's',
      summary: 'ζ=' + z.toFixed(2) + '，ω=' + w.toFixed(2) + '，当前终点 y=' + pts[pts.length - 1].y,
      series: [{ label: '响应 y(t)', values: pts.map(({ y }) => y) }],
    });
  }
  return { data: { zeta: z, freq: w }, frames };
}`,
  },
  graph: {
    version: 1,
    prompt: '自定义图节点遍历演示',
    title: '图节点高亮演化',
    summary: '按步长依次点亮节点并展示拓扑边连接',
    textLabel: '节点标签（逗号分隔）',
    defaultText: 'A, B, C, D, E',
    controls: [{ key: 'start', label: '起始编号', value: 0, min: 0, max: 4, step: 1 }],
    presets: [
      { label: '从 A 出发', params: { start: 0 }, text: 'A, B, C, D, E' },
      { label: '从 C 出发', params: { start: 2 }, text: 'A, B, C, D, E' },
    ],
    preferredView: 'graph',
    verificationNote: '按环形拓扑从起始节点顺时针依次访问',
    code: `function run({ text, params }) {
  const names = String(text || 'A,B,C,D,E').split(/[,，\\s]+/).filter(Boolean).slice(0, 8);
  const list = names.length >= 2 ? names : ['A', 'B', 'C', 'D'];
  const start = Math.max(0, Math.min(list.length - 1, Math.round(Number(params.start ?? 0))));
  const frames = list.map((_, step) => {
    const active = (start + step) % list.length;
    const nodes = list.map((label, idx) => ({
      id: 'n' + idx,
      label,
      x: 50 + 30 * Math.cos((idx / list.length) * Math.PI * 2 - Math.PI / 2),
      y: 50 + 34 * Math.sin((idx / list.length) * Math.PI * 2 - Math.PI / 2),
      active: idx === active,
    }));
    const edges = list.map((_, idx) => ({ from: 'n' + idx, to: 'n' + ((idx + 1) % list.length) }));
    return {
      title: '第 ' + (step + 1) + ' 步：访问 ' + list[active],
      summary: '当前高亮节点 ' + list[active] + '（共 ' + list.length + ' 个节点）',
      graph: { nodes, edges },
    };
  });
  return { data: { count: list.length }, frames };
}`,
  },
  timeline: {
    version: 1,
    prompt: '自定义任务调度甘特图',
    title: '任务调度时间轴',
    summary: '根据自定义任务耗时生成逐帧甘特调度条',
    textLabel: '任务耗时序列（逗号分隔）',
    defaultText: '4, 2, 5, 3',
    controls: [{ key: 'gap', label: '切换开销', value: 1, min: 0, max: 3, step: 1 }],
    presets: [
      { label: '零切换开销', params: { gap: 0 }, text: '4, 2, 5, 3' },
      { label: '高切换开销', params: { gap: 2 }, text: '4, 2, 5, 3' },
    ],
    preferredView: 'timeline',
    verificationNote: '总完工时间 = 各任务耗时之和 + (任务数-1) × 切换开销',
    code: `function run({ text, params }) {
  const nums = String(text || '4,2,5,3').split(/[,，\\s]+/).map(Number).filter((n) => n > 0).slice(0, 6);
  const jobs = nums.length ? nums : [4, 2, 5, 3];
  const gap = Math.max(0, Math.round(Number(params.gap ?? 1)));
  const bars = [];
  let t = 0;
  const frames = jobs.map((dur, idx) => {
    bars.push({ label: '任务 P' + (idx + 1), start: t, end: t + dur });
    t += dur + gap;
    return {
      title: '调度 P' + (idx + 1) + '（耗时 ' + dur + '）',
      summary: '已完成 ' + (idx + 1) + ' 个任务，累计时钟 ' + (t - gap),
      timeline: [{ label: '调度', segments: bars.slice() }],
    };
  });
  return { data: { totalTime: t - gap }, frames };
}`,
  },
  table: {
    version: 1,
    prompt: '自定义迭代数值表',
    title: '迭代计算数据表',
    summary: '逐帧记录递推序列的变化过程',
    textLabel: '初始说明',
    defaultText: '斐波那契 / 指数递推对比',
    controls: [{ key: 'ratio', label: '增长系数 r', value: 1.4, min: 0.6, max: 2.2, step: 0.1 }],
    presets: [
      { label: '衰减过程', params: { ratio: 0.8 } },
      { label: '增长过程', params: { ratio: 1.5 } },
    ],
    preferredView: 'table',
    verificationNote: '第 k 步值等于上一步乘以系数 r',
    code: `function run({ params }) {
  const r = Number(params.ratio ?? 1.4);
  const rows = [];
  let val = 10;
  const frames = [];
  for (let k = 1; k <= 6; k += 1) {
    val = Number((val * r).toFixed(2));
    rows.push([String(k), r.toFixed(1), String(val)]);
    frames.push({
      title: '第 ' + k + ' 轮迭代',
      summary: 'r=' + r.toFixed(1) + '，当前值=' + val,
      columns: ['轮次', '系数 r', '当前值'],
      rows: rows.slice(),
    });
  }
  return { data: { finalValue: val }, frames };
}`,
  },
};

export function BlockCreatorModal({ open, upstreamContext, fuseContext, onClose, onInsert }: BlockCreatorModalProps): JSX.Element | null {
  const isFuse = Boolean(fuseContext);
  const [tab, setTab] = useState<CreatorTab>('ai');
  const [payload, setPayload] = useState<AiRuleBlockPayload>(() => defaultAiRulePayload());
  const [params, setParams] = useState<Record<string, number>>(() => defaultAiRuleParams(defaultAiRulePayload()));
  const [textInput, setTextInput] = useState<string>(() => defaultAiRulePayload().defaultText ?? '');
  const [aiPrompt, setAiPrompt] = useState(() => fuseContext
    ? fuseContext.defaultPrompt
    : upstreamContext
      ? `根据「${upstreamContext.nodeTitle}」的${upstreamContext.portLabel}，创建一个能随上游数据变化的可视化积木`
      : '');
  const [keepOriginals, setKeepOriginals] = useState(false);
  const [fuseGenerated, setFuseGenerated] = useState(false);
  const [preferredView, setPreferredView] = useState<PreferredView>('auto');
  const [codeDraft, setCodeDraft] = useState(() => defaultAiRulePayload().code);
  const [titleDraft, setTitleDraft] = useState(() => defaultAiRulePayload().title);
  const [textLabelDraft, setTextLabelDraft] = useState(() => defaultAiRulePayload().textLabel ?? '');

  const [aiBusy, setAiBusy] = useState(false);
  const [statusError, setStatusError] = useState('');
  const [statusOk, setStatusOk] = useState('');

  const [previewRun, setPreviewRun] = useState<Awaited<ReturnType<typeof runRuleInSandbox>> | null>(null);
  const [completedPreview, setCompletedPreview] = useState('');
  const [previewError, setPreviewError] = useState('');
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);

  const upstream = useMemo(
    () => fuseContext ? fuseContext.sampleUpstream : upstreamContext?.value ? [upstreamContext.value] : [],
    [fuseContext, upstreamContext],
  );
  const sampleInputs = useMemo(
    () => fuseContext ? fuseContext.sampleInputs : {},
    [fuseContext],
  );
  const previewSig = useMemo(
    () => JSON.stringify({ code: payload.code, params, text: textInput }),
    [payload.code, params, textInput],
  );

  useEffect(() => {
    if (!open) return undefined;
    let dead = false;
    setPreviewError('');
    void runRuleInSandbox(payload.code, { text: textInput, params, upstream, inputs: sampleInputs })
      .then((res) => {
        if (dead) return;
        setPreviewRun(res);
        setCompletedPreview(previewSig);
        setFrameIndex(0);
      })
      .catch((cause: unknown) => {
        if (dead) return;
        setPreviewRun(null);
        setPreviewError(cause instanceof Error ? cause.message : '沙箱试跑失败');
      });
    return () => { dead = true; };
  }, [open, previewSig, payload.code, params, textInput, upstream, sampleInputs]);

  const frames = previewRun?.result.frames ?? [];
  const lastFrame = Math.max(0, frames.length - 1);

  useEffect(() => {
    if (!playing || frames.length <= 1) return undefined;
    const timer = window.setInterval(() => {
      setFrameIndex((prev) => (prev >= lastFrame ? 0 : prev + 1));
    }, 650);
    return () => window.clearInterval(timer);
  }, [playing, frames.length, lastFrame]);

  if (!open) return null;

  const applyPayloadToDraft = (next: AiRuleBlockPayload): void => {
    setPayload(next);
    setParams(defaultAiRuleParams(next));
    setTextInput(next.defaultText ?? '');
    setCodeDraft(next.code);
    setTitleDraft(next.title);
    setTextLabelDraft(next.textLabel ?? '');
    setPreferredView(next.preferredView);
    setPlaying(false);
    setFrameIndex(0);
  };

  const handleAiGenerate = async (fixError?: string): Promise<void> => {
    const rawPrompt = (aiPrompt.trim() || payload.prompt || titleDraft).trim();
    if (!rawPrompt) {
      setStatusError('请先输入你想创建的积木内容或实验主题');
      return;
    }
    const viewHint = preferredView === 'auto'
      ? ''
      : `（请优先使用 ${VIEW_OPTIONS.find((o) => o.value === preferredView)?.label ?? preferredView} 形态展示）`;
    setAiBusy(true);
    setStatusError('');
    setStatusOk('');
    let lastError = fixError ?? '';
    let current: AiRuleBlockPayload | null = fixError ? { ...payload, code: codeDraft, title: titleDraft } : null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const next = fuseContext
          ? await fuseAiRuleBlock({
              user_prompt: `${rawPrompt}${viewHint}`,
              nodes_summary: fuseContext.nodesSummary,
              wires_summary: fuseContext.wiresSummary,
              external_ports: fuseContext.externalPorts,
              current_payload: current,
              ...(lastError ? { last_error: lastError } : {}),
            })
          : await generateAiRuleBlock({
              prompt: `${rawPrompt}${viewHint}`,
              current_payload: current,
              ...(lastError ? { last_error: lastError } : {}),
              upstream_hints: upstreamContext ? [upstreamContext.hint] : [],
            });
        const failure = await verifyAiRulePayload(next, defaultAiRuleParams(next), next.defaultText, upstream, sampleInputs);
        if (!failure) {
          applyPayloadToDraft(next);
          if (fuseContext) setFuseGenerated(true);
          setStatusOk(`✓ 已${fuseContext ? '融合生成' : '生成'}「${next.title}」· ${next.controls.length} 个可调参数`);
          setAiBusy(false);
          return;
        }
        lastError = failure;
        current = next;
      } catch (cause) {
        setStatusError(errorMessage(cause));
        setAiBusy(false);
        return;
      }
    }
    const timeoutTip = /超时/.test(lastError) && fuseContext
      ? '（计算超出 300ms 沙箱预算，建议改用「📦 封装成积木」进行无损结构封装）'
      : '';
    setStatusError(`规则试跑未通过：${lastError}${timeoutTip}`);
    setAiBusy(false);
  };

  const handleApplyManual = async (): Promise<void> => {
    setStatusError('');
    setStatusOk('');
    try {
      const next = normalizeAiRulePayload({
        ...payload,
        title: titleDraft.trim() || '我的自建积木',
        preferredView,
        textLabel: textLabelDraft.trim() || undefined,
        code: codeDraft,
      });
      const failure = await verifyAiRulePayload(next, params, textInput, upstream, sampleInputs);
      if (failure) {
        setStatusError(failure);
        return;
      }
      setPayload(next);
      if (fuseContext) setFuseGenerated(true);
      setStatusOk('✓ 规则校验通过，右侧已更新实时图画预览');
    } catch (cause) {
      setStatusError(errorMessage(cause));
    }
  };

  const activeFrame = frames[Math.min(frameIndex, lastFrame)];

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-label="创建积木工作台">
      <div className={styles.modal}>
        <header className={styles.header}>
          <div className={styles.headerTitle}>
            <h2>{isFuse ? '✨ AI 积木语义融合' : '＋ 创建积木'}</h2>
            <span className={styles.headerSub}>
              {isFuse
                ? '将多块选中积木按意图重铸为单块同屏联动积木 · 试跑通过才落地，支持 Ctrl+Z 无损还原'
                : 'AI 一句话生成或按规则手写 · 卡片自带实时图画，选中后可在检查器调参'}
            </span>
          </div>
          <button type="button" className={styles.closeBtn} aria-label="关闭创建积木" onClick={onClose}>×</button>
        </header>

        {fuseContext && <p className={styles.upstreamContext}>
          待融合积木（{fuseContext.nodeTitles.length} 块）：{fuseContext.nodeTitles.join(' + ')}
          {fuseContext.externalPorts.inputs.length > 0 ? ` · 外部入边 ${fuseContext.externalPorts.inputs.length} 路` : ''}
          {fuseContext.externalPorts.outputs.length > 0 ? ` · 外部出边 ${fuseContext.externalPorts.outputs.length} 路` : ''}
        </p>}
        {upstreamContext && !fuseContext && <p className={styles.upstreamContext}>
          将自动连接「{upstreamContext.nodeTitle}」的{upstreamContext.portLabel}
        </p>}
        <div className={styles.body}>
          {/* 左栏：AI 帮我造 / 手写规则 & 规则说明 */}
          <div className={styles.leftCol}>
            <div className={styles.tabs} role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'ai'}
                className={`${styles.tabBtn} ${tab === 'ai' ? styles.tabBtnActive : ''}`}
                onClick={() => setTab('ai')}
              >
                ✨ AI 帮我造
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'manual'}
                className={`${styles.tabBtn} ${tab === 'manual' ? styles.tabBtnActive : ''}`}
                onClick={() => setTab('manual')}
              >
                📐 手写规则 & 规则说明
              </button>
            </div>

            {tab === 'ai' ? (
              <>
                <label className={styles.fieldLabel}>
                  用一句话描述你想造的积木
                  <textarea
                    className={styles.textarea}
                    rows={4}
                    value={aiPrompt}
                    spellCheck={false}
                    placeholder="例如：演示电梯磁盘调度 SCAN 的磁头轨迹，支持输入自己的磁道请求序列和初始磁头位置"
                    onChange={(event) => { setAiPrompt(event.currentTarget.value); setStatusError(''); }}
                  />
                </label>

                <div className={styles.fieldLabel}>
                  <span>灵感示例（点一下直接填入）</span>
                  <div className={styles.chipRow}>
                    {AI_EXAMPLES.map((item) => (
                      <button
                        key={item.label}
                        type="button"
                        className={styles.chip}
                        onClick={() => { setAiPrompt(item.prompt); setStatusError(''); }}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className={styles.fieldLabel}>
                  <span>期望卡片图画风格</span>
                  <div className={styles.chipRow}>
                    {VIEW_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        className={`${styles.chip} ${preferredView === opt.value ? styles.chipActive : ''}`}
                        onClick={() => setPreferredView(opt.value)}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className={styles.actionRow}>
                  <button
                    type="button"
                    className={styles.primaryBtn}
                    disabled={aiBusy || !aiPrompt.trim()}
                    onClick={() => void handleAiGenerate()}
                  >
                    {aiBusy ? (isFuse ? 'AI 正在融合并试跑…' : 'AI 正在生成并试跑…') : (isFuse ? '✨ AI 融合生成' : '✨ AI 生成积木')}
                  </button>
                  <button
                    type="button"
                    className={styles.secondaryBtn}
                    onClick={() => setTab('manual')}
                  >
                    切换到手写规则 / 查看代码 →
                  </button>
                </div>
              </>
            ) : (
              <>
                <details className={styles.rulesCard} open>
                  <summary>📖 积木编写规则速查（30 秒看懂）</summary>
                  <ul className={styles.rulesList}>
                    <li>
                      必须导出同步函数 <code>{'function run({ text, params, upstream, rand })'}</code>，返回 <code>{'{ data, frames }'}</code>。
                    </li>
                    <li>
                      <code>text</code> 是用户在右侧检查器输入的自定义数据；<code>params</code> 是滑杆参数对象。<code>upstream[0]</code> 是上游端口的数据。<code>rand()</code> 生成可由 <code>params.seed</code> 复现的随机数。
                    </li>
                    <li>
                      <code>frames</code> 为逐帧数组，每帧含 <code>title</code>、<code>summary</code>，以及以下任一图画字段：
                      <code>shapes</code>（2D 图元）、<code>grid</code>（二维网格）、<code>series</code>（折线）、<code>graph</code>（节点边）、<code>timeline</code>（甘特条）、<code>columns + rows</code>（表格）。
                    </li>
                    <li>安全沙箱：仅做纯数值/逻辑计算，禁止联网、DOM 与异步，单次需在 {RULE_TIMEOUT_MS}ms 内算完。</li>
                  </ul>
                  <div className={styles.chipRow}>
                    {VIEW_OPTIONS.map(({ value, label }) => value === 'auto' ? null : (
                      <button key={value} type="button" className={styles.chip}
                        onClick={() => applyPayloadToDraft(STARTER_TEMPLATES[value])}>填入：{label}模板</button>
                    ))}
                  </div>
                </details>

                <div className={styles.inlineRow}>
                  <label className={styles.fieldLabel}>
                    积木名称
                    <input
                      className={styles.input}
                      value={titleDraft}
                      onChange={(e) => setTitleDraft(e.currentTarget.value)}
                    />
                  </label>
                  <label className={styles.fieldLabel}>
                    检查器自定义数据标签（可选）
                    <input
                      className={styles.input}
                      value={textLabelDraft}
                      placeholder="例如：输入请求序列（逗号分隔）"
                      onChange={(e) => setTextLabelDraft(e.currentTarget.value)}
                    />
                  </label>
                </div>

                <label className={styles.fieldLabel}>
                  规则纯函数代码（JavaScript）
                  <textarea
                    className={`${styles.textarea} ${styles.codeArea}`}
                    rows={10}
                    spellCheck={false}
                    value={codeDraft}
                    onChange={(e) => setCodeDraft(e.currentTarget.value)}
                  />
                </label>

                <div className={styles.actionRow}>
                  <button type="button" className={styles.primaryBtn} onClick={() => void handleApplyManual()}>
                    ▶ 试跑并更新预览
                  </button>
                  {statusError || previewError ? (
                    <button
                      type="button"
                      className={styles.secondaryBtn}
                      disabled={aiBusy}
                      onClick={() => void handleAiGenerate(statusError || previewError)}
                    >
                      {aiBusy ? 'AI 修复中…' : '✨ 让 AI 帮我修复代码'}
                    </button>
                  ) : null}
                </div>
              </>
            )}

            {statusError ? <p className={styles.errorText} role="alert">{statusError}</p> : null}
            {statusOk ? <p className={styles.okText}>{statusOk}</p> : null}
          </div>

          {/* 右栏：画布卡片实时预览 + 实时调参验算 */}
          <div className={styles.rightCol}>
            <div className={styles.previewTitle}>
              <span>画布卡片预览（放到画布后的真实效果）</span>
              <span>{previewRun ? `✓ ${frames.length} 帧 · ${Number(previewRun.elapsedMs.toFixed(1))}ms` : '等待试跑'}</span>
            </div>

            <div className={styles.previewCard}>
              <div className={blockStyles.aiCardHeader}>
                <span className={blockStyles.aiCardTitle}>{payload.title}</span>
                <span className={blockStyles.tag}>
                  {VIEW_OPTIONS.find((o) => o.value === payload.preferredView)?.label ?? '自动图画'}
                </span>
              </div>

              <div className={blockStyles.aiCardVisual}>
                {previewError ? (
                  <p className={styles.errorText}>{previewError}</p>
                ) : activeFrame ? (
                  <PipelineFrameDetails frame={activeFrame} compact showSummary={false} />
                ) : (
                  <p className={styles.footerHint}>点击左侧「AI 生成积木」或「试跑」立即查看图画</p>
                )}
              </div>

              {frames.length > 1 ? (
                <div className={blockStyles.aiCardPlaybar}>
                  <button
                    type="button"
                    className={blockStyles.aiCardPlayBtn}
                    onClick={() => setPlaying((prev) => !prev)}
                  >
                    {playing ? '⏸' : '▶'}
                  </button>
                  <input
                    type="range"
                    className={blockStyles.aiCardRange}
                    min={0}
                    max={lastFrame}
                    step={1}
                    value={Math.min(frameIndex, lastFrame)}
                    onChange={(e) => {
                      setPlaying(false);
                      setFrameIndex(e.currentTarget.valueAsNumber);
                    }}
                  />
                  <span className={blockStyles.aiCardFrameCount}>
                    {Math.min(frameIndex, lastFrame) + 1}/{frames.length}
                  </span>
                </div>
              ) : null}

              {activeFrame?.summary ? (
                <p className={blockStyles.aiCardSummary}>{activeFrame.summary}</p>
              ) : null}
            </div>

            <div className={styles.previewControls}>
              <div className={styles.previewTitle}>
                <span>实时验算（放入画布后位于右侧检查器）</span>
              </div>

              <label className={styles.controlItem}>
                <span>{payload.textLabel || '自定义输入数据（可选）'}</span>
                <input
                  className={styles.input}
                  value={textInput}
                  placeholder="输入自定义数据，上方卡片实时重算"
                  onChange={(e) => setTextInput(e.currentTarget.value)}
                />
              </label>

              {payload.controls.map((ctrl) => (
                <label key={ctrl.key} className={styles.controlItem}>
                  <div className={styles.controlItemTop}>
                    <span>{ctrl.label}</span>
                    <output>{params[ctrl.key] ?? ctrl.value}</output>
                  </div>
                  <input
                    type="range"
                    min={ctrl.min ?? 0}
                    max={ctrl.max ?? 1}
                    step={ctrl.step ?? 0.01}
                    value={params[ctrl.key] ?? ctrl.value}
                    onChange={(e) => {
                      const nextVal = e.currentTarget.valueAsNumber;
                      setParams((prev) => ({ ...prev, [ctrl.key]: nextVal }));
                    }}
                  />
                </label>
              ))}

              {payload.presets?.length ? (
                <div className={styles.chipRow}>
                  {payload.presets.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      className={styles.chip}
                      onClick={() => {
                        setParams((prev) => ({ ...prev, ...preset.params }));
                        if (preset.text !== undefined) setTextInput(preset.text);
                      }}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <footer className={styles.footer}>
          {isFuse ? (
            <label className={styles.footerHint} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={keepOriginals}
                onChange={(e) => setKeepOriginals(e.currentTarget.checked)}
              />
              保留原积木，在旁边生成融合块（不勾选则替换并自动重接外连线，支持 Ctrl+Z 撤销）
            </label>
          ) : (
            <span className={styles.footerHint}>
              放入画布不会清空已有内容；选中卡片后，在右侧检查器即可调参或输入自己的数据。
            </span>
          )}
          <div className={styles.actionRow}>
            <button type="button" className={styles.secondaryBtn} onClick={onClose}>取消</button>
            <button
              type="button"
              className={styles.secondaryBtn}
              disabled={!previewRun || completedPreview !== previewSig || Boolean(previewError) || aiBusy || (isFuse && !fuseGenerated)}
              onClick={() => onInsert(payload, params, textInput, false, isFuse ? { keepOriginals } : undefined)}
            >
              {isFuse ? (keepOriginals ? '在旁生成融合块' : '确认融合替换') : '放到当前画布'}
            </button>
            <button
              type="button"
              className={styles.primaryBtn}
              disabled={!previewRun || completedPreview !== previewSig || Boolean(previewError) || aiBusy || (isFuse && !fuseGenerated)}
              onClick={() => onInsert(payload, params, textInput, true, isFuse ? { keepOriginals } : undefined)}
            >
              {isFuse ? '融合并存入我的积木库' : '放到画布并存入我的积木库'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
