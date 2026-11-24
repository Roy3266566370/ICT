import { useState } from 'react';
import type { NodeBodyProps } from './nodes.tsx';
import type { NodeDef } from './nodes.tsx';
import type { NodeType } from './types.ts';
import { PipelineFrameDetails } from './Lab408PipelineNode.tsx';
import { Timeline } from './Lab408SimNodes.tsx';
import { Notice } from './BlockPrimitives.tsx';
import styles from './blocks.module.css';

export function UniversalStageViewBody(props: NodeBodyProps): JSX.Element {
  const { inCard } = props;
  const input = props.values.in;
  const [raw, setRaw] = useState(0);
  const [playing, setPlaying] = useState(false);
  if (input?.kind !== 'customFrames') {
    return <Notice>把「AI 智能计算方块」的实验数据输出接到通用舞台。</Notice>;
  }
  const frames = input.result.frames;
  const last = Math.max(0, frames.length - 1);
  const index = Math.max(0, Math.min(last, props.timeline ? props.timeline.step : raw));
  const frame = frames[index];
  return <div className={styles.root}>
    <div className={styles.tagRow}>
      <span className={styles.tag}>{input.title || 'AI 实验数据'}</span>
      <span className={styles.tag}>{frames.length} 帧</span>
      {input.elapsedMs !== undefined ? <span className={styles.tag}>{Number(input.elapsedMs.toFixed(1))} ms</span> : null}
      {input.error ? <span className={styles.tag}>试跑失败</span> : null}
    </div>
    {input.error ? <Notice>{input.error}</Notice> : null}
    {frame ? <PipelineFrameDetails frame={frame} compact={inCard} /> : !input.error ? <Notice>实验数据还没有可用帧。</Notice> : null}
    {frames.length > 1 ? <div className={styles.controls}>
      <label className={styles.controlRow}>
        <span>时间轴</span>
        <input type="range" aria-label="实验帧" min={0} max={last} step={1} value={index}
          onChange={(event) => { const next = event.currentTarget.valueAsNumber; props.timeline?.onStep(next); setRaw(next); }} />
        <output>{index + 1}/{last + 1}</output>
      </label>
      {!inCard ? <Timeline total={frames.length} index={index} playing={playing}
        onIndex={(next) => { props.timeline?.onStep(next); setRaw(next); }}
        onPlaying={setPlaying} /> : null}
    </div> : null}
    {!inCard && frame?.summary ? <p className={styles.tip}>{frame.summary}</p> : null}
  </div>;
}

export const UNIVERSAL_STAGE_DEFS: Partial<Record<NodeType, NodeDef>> = {
  universalStageView: {
    title: '通用多形态舞台', badge: '视图', width: 400,
    inputs: [{ id: 'in', label: '实验数据', kind: 'customFrames' }],
    Body: UniversalStageViewBody,
  },
};
