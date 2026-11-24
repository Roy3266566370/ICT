/**
 * NodeSchematic.tsx —— 画布极简图解模块卡片
 *
 * 画布上只呈现清爽的结构卡片：名称 + 类别色标 + 规格徽标 + 对应结构示意图（SVG）。
 * 绝不在画布卡片里堆砌数字、表格与输入框；点击任意卡片后，在右侧检查器展开具体数据与调参。
 */
import type { CanvasNode, PortValue } from './types.ts';
import type { NodeDef } from './nodes.tsx';
import { kernelData, pixelData } from './deepCore.ts';
import { parseCsvDatasetPayload, parseRealImagePayload } from './imageInput.ts';
import { isStudyStage } from './studyStages.ts';
import { find408Stage } from './lab408Pipeline.ts';
import { Lab408Diagram } from './Lab408PipelineNode';
import { findPhysicsStage } from './physicsPipeline.ts';
import { findCalculusStage } from './calculusPipeline.ts';
import { ScienceMiniDiagram } from './SciencePipelineScene.tsx';
import styles from './nodeSchematic.module.css';

interface SchematicMeta {
  title: string;
  spec: string;
  accent: string;
  foot: string;
}

const COLORS = {
  source: '#2563eb',
  op: '#d96236',
  view: '#0f766e',
  physics: '#c2410c',
  lab408: '#6d28d9',
  calculus: '#4f46e5',
  learn: '#0284c7',
};

function shapeText(v: PortValue | null): string {
  if (!v) return '';
  if (v.kind === 'tensor2d') return `${v.data.length}×${v.data[0]?.length ?? 0}`;
  if (v.kind === 'dataset2d') return `${v.points.length} 样本`;
  if (v.kind === 'function') return 'f(x)';
  if (v.kind === 'function2d') return 'f(x,y)';
  if (v.kind === 'matrix2') return '2×2';
  if (v.kind === 'scalar') return '标量';
  if (v.kind === 'body') return '动力学';
  if (v.kind === 'series') return `${v.values.length} 点`;
  if (v.kind === 'field2d') return v.mode === 'electric' ? '电场' : v.mode === 'magnetic' ? '磁场' : '光路';
  if (v.kind === 'algoData') return v.mode === 'graph' ? `${v.edges?.length ?? 0} 边` : v.mode === 'addrStream' ? `${v.addresses?.length ?? 0} 地址` : `${v.values?.length ?? 0} 项`;
  if (v.kind === 'customFrames') return `${v.result.frames.length} 帧`;
  return '';
}

export function nodeSchematicMeta(
  node: CanvasNode,
  def: NodeDef,
  self: PortValue | null,
  convOrdinal?: number,
): SchematicMeta {
  const lab = find408Stage(node);
  if (lab) return {
    title: lab.stage.title, spec: lab.stage.inputs?.length ? (lab.stage.controls?.length ? '可调' : '408') : '输入',
    accent: lab.stage.inputs?.length ? COLORS.lab408 : COLORS.source,
    foot: '',
  };
  const physics = findPhysicsStage(node);
  if (physics) return {
    title: physics.stage.title,
    spec: physics.stage.inputs?.length ? (physics.stage.controls?.length ? '可调' : '物理') : '输入',
    accent: physics.stage.inputs?.length ? COLORS.physics : COLORS.source,
    foot: '',
  };
  const calculus = findCalculusStage(node);
  if (calculus) return {
    title: calculus.stage.title,
    spec: calculus.stage.inputs?.length ? (calculus.stage.controls?.length ? '可调' : '高数') : '输入',
    accent: calculus.stage.inputs?.length ? COLORS.calculus : COLORS.source,
    foot: '',
  };
  const outShape = shapeText(self);
  const realImg = node.type === 'pixelGridSource' ? parseRealImagePayload(node.payload) : null;
  const csvData = node.type === 'dataset2dSource' ? parseCsvDatasetPayload(node.payload) : null;

  if (node.type === 'conv2dOp') {
    const name = node.text?.trim() || (convOrdinal ? `conv${convOrdinal}` : 'conv');
    const stride = Math.round(node.params.stride ?? 1);
    return {
      title: name,
      spec: '3×3',
      accent: COLORS.op,
      foot: outShape ? `s=${stride} · ${outShape}` : `3×3 卷积核`,
    };
  }
  if (node.type === 'pixelGridSource') {
    return {
      title: realImg ? '真实图片' : '图片输入',
      spec: realImg ? '真图' : '12×12',
      accent: COLORS.source,
      foot: realImg ? realImg.name : '12×12 灰度图',
    };
  }
  if (node.type === 'dataset2dSource') {
    const names = ['XOR', 'Moons', 'Circles', 'Spiral'];
    return {
      title: csvData ? 'CSV 数据' : '二维点云',
      spec: csvData ? 'CSV' : names[Math.round(node.params.kind ?? 0)] ?? '2D',
      accent: COLORS.source,
      foot: csvData ? csvData.name : (outShape || '训练/验证集'),
    };
  }
  if (node.type === 'studyPool') {
    return { title: 'MaxPool', spec: '2×2', accent: COLORS.op, foot: outShape || '2×2 下采样' };
  }
  if (node.type === 'activationOp' || node.type === 'studyActivation' || node.type === 'activationProbe') {
    const acts = ['ReLU', 'LReLU', 'Sigmoid', 'Tanh', 'GELU'];
    const actName = acts[Math.round(node.params.kind ?? 0)] ?? '激活';
    return { title: node.type === 'activationOp' ? actName : def.title, spec: 'σ(x)', accent: COLORS.op, foot: outShape || '非线性映射' };
  }
  if (node.type === 'linearOp' || node.type === 'studyProjection') {
    return { title: node.text || def.title, spec: 'Wx+b', accent: COLORS.op, foot: outShape || '线性投影' };
  }
  if (node.type === 'studyScores' || node.type === 'attentionOp' || node.type === 'attentionAB') {
    return { title: node.text || def.title, spec: 'QKᵀ', accent: COLORS.op, foot: outShape || '注意力权重' };
  }
  if (node.type === 'studySoftmax') {
    return { title: 'Softmax', spec: '∑=1', accent: COLORS.op, foot: outShape || '概率归一' };
  }
  if (node.type === 'studyScale') {
    return { title: '缩放', spec: '÷√dₖ', accent: COLORS.op, foot: outShape || '方差稳定' };
  }
  if (node.type === 'studyMask') {
    return { title: '因果掩码', spec: 'Mask', accent: COLORS.op, foot: outShape || '上三角屏蔽' };
  }
  if (node.type === 'normOp' || node.type === 'studyNorm') {
    const mode = Math.round(node.params.mode ?? 1);
    return { title: mode === 2 ? 'LayerNorm' : 'BatchNorm', spec: 'μ,σ', accent: COLORS.op, foot: outShape || '分布归一' };
  }
  if (node.type === 'residualJoin') {
    return { title: '残差相加', spec: 'x+F', accent: COLORS.op, foot: outShape || '跳跃连接' };
  }
  if (node.type === 'mlpTrainer') {
    return { title: 'MLP 训练', spec: 'BCE', accent: COLORS.learn, foot: '前向 · 反传 · 更新' };
  }
  if (node.type === 'slider') {
    return { title: node.text || '参数滑杆', spec: '参数', accent: COLORS.source, foot: '点击调节数值' };
  }
  if (node.type === 'matrixHeatmapView') {
    return { title: node.text || '特征图视图', spec: outShape || '热图', accent: COLORS.view, foot: '点击显微追踪' };
  }
  if (['projectile', 'springOsc', 'pendulum', 'inclineLab', 'collisionLab', 'resonanceLab', 'waveLab', 'trailView', 'energyMeter'].includes(node.type)) {
    return { title: node.text || def.title, spec: '力学', accent: COLORS.physics, foot: def.badge === '源' ? '动力学仿真' : '实时观测' };
  }
  if (['dsTraversal', 'dsStepLab', 'cacheSimLab', 'cacheSplit', 'pipelineLab', 'ieee754Lab', 'cpuScheduleLab', 'bankerLab', 'pageReplace', 'tcpCongestionLab', 'slidingWindowLab', 'ipSubnet', 'lab408Workbench'].includes(node.type)) {
    return { title: def.title, spec: '408', accent: COLORS.lab408, foot: '点击步进推演' };
  }
  if (node.type.startsWith('biz')) {
    return { title: def.title, spec: '办公', accent: '#0d9488', foot: outShape || '业务序列' };
  }
  if (['emFieldSource', 'emFieldView', 'rlcCircuitLab', 'opticsBench', 'thermoCycle'].includes(node.type)) {
    return { title: def.title, spec: '物理', accent: COLORS.physics, foot: outShape || '实时观测' };
  }
  if (['funcCombineOp', 'svdDecomposeOp', 'linearSolveView', 'probDistSource'].includes(node.type)) {
    return { title: def.title, spec: '高数', accent: COLORS.calculus, foot: outShape || '可连线' };
  }
  if (['arraySource', 'sortCompareView', 'graphSource', 'shortestPathView', 'memAddrSource', 'addrTranslateView', 'cacheMapView'].includes(node.type)) {
    return { title: def.title, spec: '408', accent: COLORS.lab408, foot: outShape || '可步进' };
  }
  if (['lossProbeOp', 'loraAdapterOp', 'quantProbeOp', 'samplingDecoderView'].includes(node.type)) {
    return { title: def.title, spec: 'DL', accent: COLORS.learn, foot: outShape || '点击查看' };
  }
  if (node.type === 'aiRuleBlock') {
    return { title: def.title, spec: 'AI', accent: '#7c3aed', foot: outShape || '自然语言规则' };
  }
  if (node.type === 'universalStageView') {
    return { title: def.title, spec: '舞台', accent: COLORS.view, foot: outShape || '自动多形态' };
  }
  if (['functionSource', 'functionPlot', 'limitProbe', 'derivative', 'integral', 'taylor', 'ftcView', 'fourierLab', 'odeSlopeField', 'func2dSource', 'gradientContour', 'doubleIntegralView', 'matrixSource', 'transformView', 'eigRead'].includes(node.type)) {
    return { title: def.title, spec: '高数', accent: COLORS.calculus, foot: outShape || '点击查看曲线' };
  }
  const title = (node.type === 'composite' || isStudyStage(node.type)) ? (node.text || def.title) : def.title;
  const accent = def.badge === '源' ? COLORS.source : def.badge === '视图' ? COLORS.view : COLORS.op;
  return { title, spec: def.badge, accent, foot: outShape || '点击查看详情' };
}

export function SchematicGraphic({ node }: { node: CanvasNode }): JSX.Element {
  const lab = find408Stage(node);
  if (lab) return <Lab408Diagram diagram={lab.stage.diagram} />;
  const physics = findPhysicsStage(node);
  if (physics) return <ScienceMiniDiagram diagram={physics.stage.diagram} />;
  const calculus = findCalculusStage(node);
  if (calculus) return <ScienceMiniDiagram diagram={calculus.stage.diagram} />;
  // 1. 卷积核：清晰 3×3 九宫格图示（按当前核正负权重着色，无杂乱数字）
  if (node.type === 'conv2dOp') {
    const k = kernelData(node.params);
    const maxAbs = Math.max(0.1, ...k.flat().map(Math.abs));
    return (
      <svg viewBox="0 0 148 56" aria-hidden="true">
        {/* 左侧抽象输入示意网格 */}
        <rect x="14" y="9" width="38" height="38" rx="4" fill="#f3efe6" stroke="#cfc8bb" strokeWidth="1" />
        <rect x="22" y="17" width="18" height="18" rx="2" fill="rgba(217,98,54,0.16)" stroke="#d96236" strokeWidth="1.2" strokeDasharray="2 1.5" />
        {/* 乘号连线 */}
        <path d="M56 28h12m-4-4 4 4-4 4" fill="none" stroke="#94a3b8" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        {/* 中间核心 3×3 卷积核图示 */}
        <g transform="translate(74, 7)">
          {k.flatMap((row, r) => row.map((v, c) => {
            const ratio = Math.min(1, Math.abs(v) / maxAbs);
            const fill = Math.abs(v) < 1e-4 ? '#f1f5f9' : v > 0 ? `rgba(79,70,229,${0.2 + ratio * 0.72})` : `rgba(217,98,54,${0.2 + ratio * 0.72})`;
            return <rect key={`${r}-${c}`} x={c * 14} y={r * 14} width="12.5" height="12.5" rx="2.2" fill={fill} stroke="#ffffff" strokeWidth="0.9" />;
          }))}
        </g>
        <text x="122" y="31" fontSize="9.5" fill="#64748b" fontFamily="var(--font-family-mono)">3×3</text>
      </svg>
    );
  }

  // 2. 图片输入：若有上传真实图片直接显示真实缩略图，否则画 12×12 微缩像素图
  if (node.type === 'pixelGridSource') {
    const realImg = parseRealImagePayload(node.payload);
    if (realImg?.previewUrl) {
      return <img src={realImg.previewUrl} alt={realImg.name} className={styles.thumbImg} />;
    }
    const grid = pixelData(node.params, node.payload);
    return (
      <svg viewBox="0 0 148 56" aria-hidden="true">
        <g transform="translate(50, 4)">
          {grid.flatMap((row, r) => row.map((v, c) => (
            <rect key={`${r}-${c}`} x={c * 4} y={r * 4} width="3.8" height="3.8" fill={`rgb(${Math.round(v * 235 + 15)},${Math.round(v * 235 + 15)},${Math.round(v * 235 + 15)})`} />
          )))}
          <rect x="0" y="0" width="48" height="48" fill="none" stroke="#94a3b8" strokeWidth="1" rx="2" />
        </g>
      </svg>
    );
  }

  // 3. 池化：2×2 → 1 汇聚示意
  if (node.type === 'studyPool') {
    return (
      <svg viewBox="0 0 148 56" aria-hidden="true">
        <g transform="translate(30, 12)">
          {[0, 1].flatMap((r) => [0, 1].map((c) => (
            <rect key={`${r}-${c}`} x={c * 16} y={r * 16} width="14" height="14" rx="2.5"
              fill={r === 0 && c === 1 ? 'rgba(217,98,54,0.75)' : 'rgba(79,70,229,0.16)'} stroke="#cbd5e1" strokeWidth="0.9" />
          )))}
        </g>
        <path d="M68 28h22m-5-4 5 4-5 4" fill="none" stroke="#64748b" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="98" y="18" width="20" height="20" rx="3.5" fill="rgba(217,98,54,0.82)" />
      </svg>
    );
  }

  // 4. 激活函数曲线
  if (node.type === 'activationOp' || node.type === 'studyActivation' || node.type === 'activationProbe') {
    const kind = Math.round(node.params.kind ?? 0);
    const d = kind === 0 ? 'M26 42 H74 L120 12' : kind === 2 ? 'M26 44 C64 44, 84 12, 120 12' : 'M26 44 C62 44, 84 12, 120 12';
    return (
      <svg viewBox="0 0 148 56" aria-hidden="true">
        <path d="M22 42H126M74 8V48" stroke="#cbd5e1" strokeWidth="1" />
        <path d={d} fill="none" stroke="#d96236" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
    );
  }

  // 5. 注意力 / Softmax / QKᵀ
  if (['studyScores', 'studyScale', 'studyMask', 'studySoftmax', 'studyWeighted', 'attentionOp', 'attentionAB', 'multiheadLab', 'attentionSim'].includes(node.type)) {
    return (
      <svg viewBox="0 0 148 56" aria-hidden="true">
        <g transform="translate(46, 6)">
          {[0, 1, 2, 3].flatMap((r) => [0, 1, 2, 3].map((c) => {
            const op = r === c ? 0.8 : ((r + c) % 3) * 0.18 + 0.1;
            return <rect key={`${r}-${c}`} x={c * 14} y={r * 11} width="12" height="9" rx="2" fill={`rgba(79,70,229,${op})`} />;
          }))}
        </g>
        <path d="M22 44 Q74 10 126 44" fill="none" stroke="#d96236" strokeWidth="1.4" strokeDasharray="3 2.5" opacity="0.7" />
      </svg>
    );
  }

  // 6. 线性层 / MLP / 网络拓扑
  if (['linearOp', 'studyProjection', 'studyHiddenLayer', 'studyMlpModel', 'mlpTrainer', 'resnetLab'].includes(node.type)) {
    return (
      <svg viewBox="0 0 148 56" aria-hidden="true">
        {[0, 1, 2].flatMap((a) => [0, 1, 2].map((b) => (
          <line key={`${a}-${b}`} x1="42" y1={14 + a * 14} x2="106" y2={14 + b * 14} stroke="#cbd5e1" strokeWidth="1.1" />
        )))}
        {[0, 1, 2].map((i) => <circle key={`l${i}`} cx="42" cy={14 + i * 14} r="4.5" fill="#fff" stroke="#4f46e5" strokeWidth="1.6" />)}
        {[0, 1, 2].map((i) => <circle key={`r${i}`} cx="106" cy={14 + i * 14} r="4.5" fill="rgba(217,98,54,0.2)" stroke="#d96236" strokeWidth="1.6" />)}
      </svg>
    );
  }

  // 7. 点云 / 边界 / SVM / 扩散
  if (['dataset2dSource', 'boundaryView', 'svmLab', 'diffusionLab', 'studyCloudPlot', 'studyVectorPlot', 'autoencoderLab'].includes(node.type)) {
    return (
      <svg viewBox="0 0 148 56" aria-hidden="true">
        <path d="M28 46 Q74 28 120 10" fill="none" stroke="#64748b" strokeWidth="1.3" strokeDasharray="3 3" />
        {[[42, 18, 0], [56, 26, 0], [48, 34, 0], [64, 16, 0], [92, 34, 1], [104, 24, 1], [108, 40, 1], [86, 42, 1]].map(([x, y, cls], i) => (
          <circle key={i} cx={x} cy={y} r="3.4" fill={cls ? '#d96236' : '#2563eb'} opacity="0.82" />
        ))}
      </svg>
    );
  }

  // 8. 柱状图 / 梯度 / 矩阵热图
  if (['matrixHeatmapView', 'studyBars', 'gradFlowMeter', 'studyGradient', 'studyStatsView', 'kvCache'].includes(node.type)) {
    const hs = [38, 28, 20, 14, 9, 6];
    return (
      <svg viewBox="0 0 148 56" aria-hidden="true">
        <line x1="24" y1="46" x2="124" y2="46" stroke="#cbd5e1" strokeWidth="1" />
        {hs.map((h, i) => <rect key={i} x={30 + i * 15} y={46 - h} width="10" height={h} rx="2" fill={i < 2 ? '#4f46e5' : '#d96236'} opacity={0.85 - i * 0.08} />)}
      </svg>
    );
  }

  // 9. 物理类装置简图
  if (node.type === 'projectile') {
    return (
      <svg viewBox="0 0 148 56" aria-hidden="true">
        <line x1="16" y1="46" x2="132" y2="46" stroke="#94a3b8" strokeWidth="1.2" />
        <path d="M24 46 Q74 2 124 46" fill="none" stroke="#d96236" strokeWidth="1.8" strokeDasharray="3 3" />
        <circle cx="62" cy="25" r="4.5" fill="#d96236" />
        <path d="M62 25 L80 18" stroke="#2563eb" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }
  if (node.type === 'springOsc' || node.type === 'resonanceLab') {
    return (
      <svg viewBox="0 0 148 56" aria-hidden="true">
        <line x1="22" y1="12" x2="22" y2="44" stroke="#475569" strokeWidth="2.4" />
        <path d="M24 28 L34 19 L44 37 L54 19 L64 37 L74 19 L84 28" fill="none" stroke="#475569" strokeWidth="1.6" strokeLinejoin="round" />
        <rect x="84" y="18" width="22" height="20" rx="3" fill="#d96236" />
      </svg>
    );
  }
  if (node.type === 'pendulum') {
    return (
      <svg viewBox="0 0 148 56" aria-hidden="true">
        <line x1="50" y1="8" x2="98" y2="8" stroke="#64748b" strokeWidth="1.6" />
        <path d="M44 36 Q74 52 104 36" fill="none" stroke="#cbd5e1" strokeWidth="1.2" strokeDasharray="3 2" />
        <line x1="74" y1="8" x2="54" y2="39" stroke="#334155" strokeWidth="1.6" />
        <circle cx="54" cy="39" r="5.5" fill="#d96236" />
      </svg>
    );
  }
  if (node.type === 'inclineLab') {
    return (
      <svg viewBox="0 0 148 56" aria-hidden="true">
        <polygon points="28,12 120,46 28,46" fill="rgba(217,98,54,0.12)" stroke="#94a3b8" strokeWidth="1.2" />
        <rect x="64" y="20" width="16" height="10" rx="2" transform="rotate(20 72 25)" fill="#d96236" />
      </svg>
    );
  }
  if (node.type === 'collisionLab') {
    return (
      <svg viewBox="0 0 148 56" aria-hidden="true">
        <line x1="18" y1="42" x2="130" y2="42" stroke="#94a3b8" strokeWidth="1.4" />
        <circle cx="52" cy="32" r="9" fill="#d96236" />
        <circle cx="96" cy="30" r="11" fill="#4f46e5" />
        <path d="M65 32h14" stroke="#64748b" strokeWidth="1.4" strokeDasharray="2 2" />
      </svg>
    );
  }
  if (node.type === 'waveLab') {
    return (
      <svg viewBox="0 0 148 56" aria-hidden="true">
        <line x1="16" y1="28" x2="132" y2="28" stroke="#cbd5e1" strokeWidth="1" />
        <path d="M18 28 Q36 6 54 28 T90 28 T126 28" fill="none" stroke="#4f46e5" strokeWidth="2.2" />
      </svg>
    );
  }
  if (node.type === 'energyMeter') {
    return (
      <svg viewBox="0 0 148 56" aria-hidden="true">
        <rect x="22" y="20" width="60" height="16" rx="4" fill="#d96236" opacity="0.85" />
        <rect x="82" y="20" width="44" height="16" rx="4" fill="#38bdf8" opacity="0.85" />
      </svg>
    );
  }

  // 10. 408 硬件与算法简图
  if (node.type === 'dsTraversal' || node.type === 'dsStepLab') {
    return (
      <svg viewBox="0 0 148 56" aria-hidden="true">
        <path d="M74 12 L48 30 M74 12 L100 30 M48 30 L34 46 M48 30 L62 46" stroke="#94a3b8" strokeWidth="1.4" />
        {[[74, 12], [48, 30], [100, 30], [34, 46], [62, 46]].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="5.5" fill={i === 0 ? '#d96236' : '#fff'} stroke={i === 0 ? '#d96236' : '#6d28d9'} strokeWidth="1.4" />
        ))}
      </svg>
    );
  }
  if (node.type === 'cacheSplit' || node.type === 'cacheSimLab' || node.type === 'ieee754Lab') {
    return (
      <svg viewBox="0 0 148 56" aria-hidden="true">
        <rect x="18" y="18" width="54" height="20" rx="3" fill="#4f46e5" opacity="0.85" />
        <rect x="74" y="18" width="34" height="20" rx="3" fill="#d96236" opacity="0.85" />
        <rect x="110" y="18" width="20" height="20" rx="3" fill="#94a3b8" opacity="0.85" />
      </svg>
    );
  }
  if (node.type === 'pipelineLab' || node.type === 'cpuScheduleLab') {
    return (
      <svg viewBox="0 0 148 56" aria-hidden="true">
        {[0, 1, 2].map((row) => [0, 1, 2, 3].map((col) => (
          <rect key={`${row}-${col}`} x={24 + (row + col) * 18} y={10 + row * 13} width="15" height="9" rx="2"
            fill={col === 1 ? '#d96236' : '#6d28d9'} opacity={0.22 + col * 0.18} />
        )))}
      </svg>
    );
  }
  if (node.type === 'tcpCongestionLab') {
    return (
      <svg viewBox="0 0 148 56" aria-hidden="true">
        <path d="M20 46 H130 M20 46 V10" stroke="#cbd5e1" strokeWidth="1" />
        <path d="M22 44 L44 34 L62 14 L82 28 L104 20 L124 38" fill="none" stroke="#d96236" strokeWidth="2" strokeLinejoin="round" />
      </svg>
    );
  }

  // 11. 高数与通用滑杆
  if (node.type === 'slider') {
    const min = node.params.min ?? 0;
    const max = node.params.max ?? 1;
    const v = node.params.v ?? min;
    const ratio = max > min ? Math.max(0, Math.min(1, (v - min) / (max - min))) : 0.5;
    const cx = 24 + ratio * 100;
    return (
      <svg viewBox="0 0 148 56" aria-hidden="true">
        <rect x="24" y="25" width="100" height="6" rx="3" fill="#e2e8f0" />
        <rect x="24" y="25" width={cx - 24} height="6" rx="3" fill="#4f46e5" />
        <circle cx={cx} cy="28" r="7" fill="#fff" stroke="#4f46e5" strokeWidth="2.4" />
      </svg>
    );
  }
  if (['integral', 'ftcView', 'doubleIntegralView'].includes(node.type)) {
    return (
      <svg viewBox="0 0 148 56" aria-hidden="true">
        <line x1="18" y1="44" x2="130" y2="44" stroke="#cbd5e1" strokeWidth="1" />
        {[0, 1, 2, 3, 4, 5].map((i) => {
          const h = 10 + i * 5;
          return <rect key={i} x={28 + i * 16} y={44 - h} width="14" height={h} fill="rgba(217,98,54,0.22)" stroke="#d96236" strokeWidth="0.9" />;
        })}
        <path d="M24 38 Q78 30 124 10" fill="none" stroke="#4f46e5" strokeWidth="2" />
      </svg>
    );
  }
  if (['gradientContour', 'func2dSource'].includes(node.type)) {
    return (
      <svg viewBox="0 0 148 56" aria-hidden="true">
        {[22, 15, 8].map((r, i) => <ellipse key={i} cx="74" cy="28" rx={r * 1.9} ry={r} fill="none" stroke="#4f46e5" strokeWidth="1.2" opacity={0.35 + i * 0.25} />)}
        <path d="M74 28 L98 16" stroke="#d96236" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }

  if (node.type.startsWith('biz')) {
    return (
      <svg viewBox="0 0 148 56" aria-hidden="true">
        <line x1="22" y1="46" x2="126" y2="46" stroke="#cbd5e1" />
        {[18, 30, 22, 38, 28, 42].map((h, index) => <rect key={index} x={28 + index * 16} y={46 - h} width="10" height={h} rx="2"
          fill={index === 5 ? '#0d9488' : '#4f46e5'} opacity={0.35 + index * 0.08} />)}
      </svg>
    );
  }
  if (['emFieldSource', 'emFieldView'].includes(node.type)) {
    return (
      <svg viewBox="0 0 148 56" aria-hidden="true">
        <circle cx="58" cy="28" r="8" fill="none" stroke="#b15236" strokeWidth="1.5" />
        <circle cx="96" cy="28" r="6" fill="none" stroke="#4f46e5" strokeWidth="1.5" />
        {[0, 1, 2].map((index) => <path key={index} d={`M64 22Q80 ${8 + index * 12} 92 24`} fill="none" stroke="#d96236" strokeWidth="1.1" opacity="0.7" />)}
      </svg>
    );
  }
  if (node.type === 'rlcCircuitLab') {
    return (
      <svg viewBox="0 0 148 56" aria-hidden="true">
        <path d="M22 40 C40 4, 58 52, 74 20 S108 44 126 12" fill="none" stroke="#0d9488" strokeWidth="2" />
        <path d="M22 46 H126" stroke="#cbd5e1" strokeWidth="1" />
      </svg>
    );
  }
  if (node.type === 'opticsBench' || node.type === 'thermoCycle') {
    return (
      <svg viewBox="0 0 148 56" aria-hidden="true">
        {node.type === 'opticsBench'
          ? <><ellipse cx="74" cy="28" rx="7" ry="20" fill="#4f46e522" stroke="#4f46e5" /><path d="M24 44 L74 28 L126 12" stroke="#d96236" strokeWidth="1.5" fill="none" /></>
          : <path d="M34 44 C48 10 90 8 112 28 C96 48 58 50 34 44Z" fill="#b152361f" stroke="#b15236" strokeWidth="1.5" />}
      </svg>
    );
  }
  if (['funcCombineOp', 'probDistSource'].includes(node.type)) {
    return (
      <svg viewBox="0 0 148 56" aria-hidden="true">
        {node.type === 'probDistSource'
          ? [14, 26, 38, 30, 18, 8].map((h, index) => <rect key={index} x={28 + index * 16} y={46 - h} width="11" height={h} rx="2" fill="#4f46e5" opacity="0.72" />)
          : <><path d="M20 44 H128" stroke="#cbd5e1" /><path d="M24 42 Q52 8 74 28 T124 18" fill="none" stroke="#d96236" strokeWidth="1.8" /><path d="M24 34 Q64 50 124 30" fill="none" stroke="#4f46e5" strokeWidth="1.4" strokeDasharray="3 2" /></>}
      </svg>
    );
  }
  if (['svdDecomposeOp', 'linearSolveView'].includes(node.type)) {
    return (
      <svg viewBox="0 0 148 56" aria-hidden="true">
        {[0, 1, 2].map((index) => <g key={index}>{[0, 1].map((row) => [0, 1].map((col) => (
          <rect key={`${row}-${col}`} x={26 + index * 36 + col * 11} y={18 + row * 11} width="9" height="9" rx="1.5" fill="#4f46e5" opacity={0.2 + (index + row + col) * 0.12} />
        )))}</g>)}
        <path d="M112 28 H132" stroke="#d96236" strokeWidth="2" />
      </svg>
    );
  }
  if (['arraySource', 'sortCompareView', 'memAddrSource', 'addrTranslateView', 'cacheMapView'].includes(node.type)) {
    return (
      <svg viewBox="0 0 148 56" aria-hidden="true">
        {[22, 36, 28, 44, 30].map((h, index) => <rect key={index} x={24 + index * 18} y={46 - h} width="12" height={h} rx="2" fill="#6d28d9" opacity={0.3 + index * 0.1} />)}
        <line x1="20" y1="46" x2="128" y2="46" stroke="#cbd5e1" />
      </svg>
    );
  }
  if (['graphSource', 'shortestPathView'].includes(node.type)) {
    return (
      <svg viewBox="0 0 148 56" aria-hidden="true">
        <path d="M34 38 L62 18 L94 34 L120 16 M62 18 L94 34" stroke="#94a3b8" strokeWidth="1.2" />
        {[[34, 38], [62, 18], [94, 34], [120, 16]].map(([x, y], index) => <circle key={index} cx={x} cy={y} r="6" fill={index === 2 ? '#6d28d9' : '#fff'} stroke="#6d28d9" strokeWidth="1.4" />)}
      </svg>
    );
  }
  if (['lossProbeOp', 'loraAdapterOp', 'quantProbeOp', 'samplingDecoderView'].includes(node.type)) {
    return (
      <svg viewBox="0 0 148 56" aria-hidden="true">
        {[0, 1, 2, 3].flatMap((row) => [0, 1, 2, 3].map((col) => (
          <rect key={`${row}-${col}`} x={40 + col * 16} y={8 + row * 10} width="14" height="8" rx="1.5"
            fill={node.type === 'samplingDecoderView' ? '#4f46e5' : (row + col) % 2 ? '#0d9488' : '#d96236'}
            opacity={0.18 + ((row * 3 + col * 2) % 5) * 0.14} />
        )))}
      </svg>
    );
  }

  // 默认清爽波形/函数示意
  return (
    <svg viewBox="0 0 148 56" aria-hidden="true">
      <path d="M20 42 H128 M74 8 V48" stroke="#e2e8f0" strokeWidth="1" />
      <path d="M24 38 Q74 4 124 34" fill="none" stroke="#4f46e5" strokeWidth="2" strokeLinecap="round" />
      <circle cx="74" cy="21" r="3.5" fill="#d96236" />
    </svg>
  );
}

export interface NodeSchematicProps {
  node: CanvasNode;
  def: NodeDef;
  self: PortValue | null;
  selected: boolean;
  readOnly?: boolean;
  convOrdinal?: number;
  onDragStart?: (e: React.PointerEvent) => void;
  onRemove?: () => void;
}

export function NodeSchematic({
  node,
  def,
  self,
  selected,
  readOnly,
  convOrdinal,
  onDragStart,
  onRemove,
}: NodeSchematicProps): JSX.Element {
  const meta = nodeSchematicMeta(node, def, self, convOrdinal);
  const pipelineCard = node.type === 'lab408Stage' || node.type === 'physicsStage' || node.type === 'calculusStage' || node.type === 'businessStage';
  return (
    <div className={`${styles.card} ${selected ? styles.selected : ''} ${pipelineCard ? styles.labCard : ''}`}>
      <div
        className={styles.head}
        onPointerDown={readOnly ? undefined : onDragStart}
        role="button"
        aria-label={readOnly ? `查看 ${meta.title}` : `拖动 ${meta.title}`}
        tabIndex={0}
      >
        <span className={styles.accent} style={{ background: meta.accent }} aria-hidden="true" />
        <span className={styles.title} title={meta.title}>{meta.title}</span>
        {!pipelineCard && <span className={styles.spec}>{meta.spec}</span>}
        {readOnly ? null : (
          <button
            type="button"
            className={styles.remove}
            data-node-x
            aria-label={`移除 ${meta.title}`}
            onClick={(e) => { e.stopPropagation(); onRemove?.(); }}
          >
            ×
          </button>
        )}
      </div>
      <div className={styles.graphic}>
        <SchematicGraphic node={node} />
      </div>
      <div className={styles.foot}>
        <span className={styles.footText}>{meta.foot}</span>
        <span className={styles.footHint}>{selected ? '检查中' : '查看 →'}</span>
      </div>
    </div>
  );
}
