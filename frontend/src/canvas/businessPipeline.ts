import { abFrames, breakevenFrames, cpmFrames, funnelFrames } from './businessCharts.ts';
import { BUSINESS_CONTROLS, calculateAbTest, calculateBreakeven, calculateCpm, calculateFunnel } from './businessModels.ts';
import { businessControlLabel, readBusinessSettings, type BusinessSettings } from './businessUnits.ts';
import type { BusinessStageId, BusinessTemplateKind } from './businessPipelineTypes.ts';
import {
  buildSciencePipeline,
  evaluateScienceStage,
  findScienceStage,
  sciencePipelinePorts,
} from './sciencePipelineRuntime.ts';
import type { ScienceFrame, SciencePipelineDefinition, ScienceStage } from './sciencePipelineTypes.ts';
import type { CanvasDoc, CanvasNode, PortSpec, PortValue } from './types.ts';

type ViewStage = Exclude<BusinessStageId, 'source'>;
type BusinessModel = { parameters: Record<string, number> };

function definition<Model extends BusinessModel>(
  kind: BusinessTemplateKind,
  titles: [string, string, string],
  calculate: (params: Record<string, number>, settings: BusinessSettings) => Model,
  render: (model: Model, stage: ViewStage, units: Record<string, string>) => ScienceFrame[],
): SciencePipelineDefinition {
  const controls = BUSINESS_CONTROLS[kind];
  const source: ScienceStage = {
    id: 'source',
    title: '参数源',
    diagram: 'source',
    controls,
    run: ({ params, text }) => {
      const settings = readBusinessSettings(kind, text);
      const { parameters } = calculate(params, settings);
      const metrics = controls.map(({ key, label }) => ({
        label: businessControlLabel(kind, key, label, settings.units),
        value: label.endsWith('（%）') ? Number(((parameters[key] ?? 0) * 100).toFixed(2)) + '%' : String(parameters[key]),
      }));
      return { data: { parameters, text }, frames: [{
        title: '参数源',
        scene: { ariaLabel: '办公决策模型输入', labels: metrics.map((metric, i) => ({
          x: 20, y: 35 + i * 29, text: metric.label + '  ' + metric.value,
        })) },
        metrics,
      }] };
    },
  };
  const ids: ViewStage[] = ['main', 'analysis', 'summary'];
  return { stages: [source, ...ids.map((id, i): ScienceStage => ({
    id,
    title: titles[i]!,
    diagram: id === 'summary' ? 'summary' : 'function',
    inputs: [ids[i - 1] ?? 'source'],
    run: ({ params, text }) => {
      const settings = readBusinessSettings(kind, text);
      const model = calculate(params, settings);
      return { data: { parameters: model.parameters, text }, frames: render(model, id, settings.units) };
    },
  }))] };
}

export const businessPipelines: Record<BusinessTemplateKind, SciencePipelineDefinition> = {
  'biz-breakeven': definition('biz-breakeven', ['盈亏平衡图', '利润拆解与敏感性', '累计净现金流'], calculateBreakeven, breakevenFrames),
  'biz-funnel': definition('biz-funnel', ['增长漏斗', '边际增长杠杆', '留存队列与累计活跃'], calculateFunnel, funnelFrames),
  'biz-cpm': definition('biz-cpm', ['项目甘特图', '任务浮动时间', '并行任务负载'], calculateCpm, cpmFrames),
  'biz-abtest': definition('biz-abtest', ['双组转化率抽样分布', '置信区间收敛带', '预计 p 值走势'], calculateAbTest, abFrames),
};

export function findBusinessStage(node: Pick<CanvasNode, 'type' | 'payload'>): ReturnType<typeof findScienceStage> {
  const [kind] = node.payload?.split('/') ?? [];
  return node.type === 'businessStage' && kind && Object.hasOwn(businessPipelines, kind)
    ? findScienceStage(node, businessPipelines) : undefined;
}

export function businessPipelinePorts(node: CanvasNode, dir: 'in' | 'out'): readonly PortSpec[] {
  return findBusinessStage(node) ? sciencePipelinePorts(node, businessPipelines, 'businessData', dir) : [];
}

export function evaluateBusinessStage(
  node: CanvasNode,
  input: (id: string) => PortValue | null,
): Extract<PortValue, { kind: 'businessData' }> | null {
  if (!findBusinessStage(node)) return null;
  const evaluation = evaluateScienceStage(node, input, businessPipelines, (stage, params) => stage.id === 'source' ? params : {});
  return evaluation ? { kind: 'businessData', ...evaluation } : null;
}

export function buildBusinessPipeline(kind: BusinessTemplateKind, title: string, note: string): CanvasDoc {
  return buildSciencePipeline(kind, title, note, 'businessStage', businessPipelines);
}
