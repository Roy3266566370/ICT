import { ScienceStagePanel } from './SciencePipelineScene.tsx';
import { findCalculusStage } from './calculusPipeline.ts';
import type { NodeBodyProps } from './nodes.tsx';
import styles from './calculusPipeline.module.css';

export function CalculusPipelineNode({
  node,
  self,
  onParams,
  onText,
  timeline,
}: NodeBodyProps): JSX.Element {
  const definition = findCalculusStage(node);
  if (!definition) return <p role="status">这个高数模块的配置无法读取。</p>;

  const output = self?.kind === 'calculusData' ? self : null;
  return (
    <div className={styles.detail} data-calculus-stage={definition.stage.id}>
      <ScienceStagePanel
        node={node}
        stage={definition.stage}
        output={output}
        onParams={onParams}
        onText={onText}
        timeline={timeline}
        subject="calculus"
      />
    </div>
  );
}