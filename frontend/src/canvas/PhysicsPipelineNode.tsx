import type { NodeBodyProps } from './nodes.tsx';
import { findPhysicsStage } from './physicsPipeline.ts';
import styles from './physicsPipeline.module.css';
import { ScienceStagePanel } from './SciencePipelineScene.tsx';

export function PhysicsPipelineNode({
  node,
  self,
  onParams,
  onText,
  timeline,
}: NodeBodyProps): JSX.Element {
  const definition = findPhysicsStage(node);
  if (!definition) return <p role="status">这个物理模块的配置无法读取。</p>;
  const output = self?.kind === 'physicsData' ? self : null;

  return (
    <div className={styles.detail} data-physics-stage={definition.stage.id}>
      <ScienceStagePanel
        node={node}
        stage={definition.stage}
        output={output}
        onParams={onParams}
        onText={onText}
        timeline={timeline}
        subject="physics"
      />
    </div>
  );
}