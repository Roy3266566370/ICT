import type { NodeBodyProps } from './nodes.tsx';
import { findBusinessStage } from './businessPipeline.ts';
import { ScienceStagePanel } from './SciencePipelineScene.tsx';
import { BusinessParameterEditor, BusinessUnitEditor } from './BusinessParameterEditor.tsx';
import { isBusinessTemplateKind } from './businessTemplates.ts';
import { readBusinessUnits } from './businessUnits.ts';

export function BusinessPipelineNode({ node, self, onParams, onText, timeline }: NodeBodyProps): JSX.Element {
  const definition = findBusinessStage(node);
  if (!definition) return <p role="status">这个办公决策模块的配置无法读取。</p>;
  const { pipeline, stage } = definition;
  const output = self?.kind === 'businessData' ? self : null;
  if (stage.id !== 'source' || !isBusinessTemplateKind(pipeline)) {
    return <ScienceStagePanel node={node} stage={stage} output={output} timeline={timeline} subject="business" />;
  }
  const units = readBusinessUnits(pipeline, node.text);
  return <>
    {stage.controls?.filter((control) => !control.options).map((control) => <BusinessParameterEditor
      key={control.key} kind={pipeline} paramKey={control.key} label={control.label} units={units}
      value={output?.result.data.parameters[control.key] ?? node.params[control.key] ?? control.value}
      min={control.min ?? 0} max={control.max ?? 1} step={control.step ?? .01}
      onChange={onParams && ((value) => onParams({ [control.key]: value }))} />)}
    <BusinessUnitEditor kind={pipeline} units={units} sourceText={node.text} onChange={onText} onParams={onParams} />
    <ScienceStagePanel node={node} stage={{ ...stage, controls: stage.controls?.filter(({ options }) => options) }}
      output={output} onParams={onParams} timeline={timeline} subject="business" />
  </>;
}
