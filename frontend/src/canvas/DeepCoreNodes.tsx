import { DF_ACTIVATIONS } from './deepFirst';
import { useEffect, useRef, useState } from 'react';
import type { NodeBodyProps, NodeDef } from './nodes';
import type { NodeType, PortSpec, PortValue } from './types';
import { activation, mlpSetup, boundaryModels, clamp, createModel, deepCoreOutput, forward, kernelData, pixelData, traces, trainEpoch, trainingOutputs } from './deepCore';
import type { Matrix, Trace } from './deepCore';
import styles from './deepCore.module.css';
export function deepCoreDefaults(type: NodeType): Record<string, number> | null {
    const all: Partial<Record<NodeType, Record<string, number>>> = {
        dataset2dSource: { kind: 0, samples: 100, noise: .08, seed: 7 }, pixelGridSource: { preset: 0, brush: 1 }, tokenSeqSource: { seed: 7 },
        linearOp: { width: 2, seed: 7, orthogonal: 0 }, activationOp: { kind: 3 }, residualJoin: {}, normOp: { mode: 1 },
        conv2dOp: { kernel: 0, stride: 1, padding: 0, pool: 0, second: 0 }, attentionOp: { scaled: 1, temperature: 1, causal: 0 },
        mlpTrainer: { width: 6, seed: 7, lr: .08, batch: 16, l1: 0, l2: 0, dropout: 0, play: 0, reset: 0 }, boundaryView: { layer: 0 }, matrixHeatmapView: {}, gradFlowMeter: {},
    };
    return all[type]! ? { ...all[type]! } : null;
}
function TraceTree({ trace, depth = 0 }: {
    trace: Trace;
    depth?: number;
}) { return <div className={styles.trace}><div>层 {depth} · [{trace.row},{trace.col}]</div><code>{trace.expression}</code>{trace.children.length > 0 && <details><summary>展开前一层 {trace.children.length} 个计算</summary>{trace.children.map((child, i) => <TraceTree key={i} trace={child} depth={depth + 1}/>)}</details>}</div>; }
function Heatmap({ data }: {
    data: Matrix;
}) {
    const [cell, setCell] = useState<[
        number,
        number
    ]>([0, 0]);
    const max = Math.max(1e-8, ...data.flat().map(Math.abs));
    const trace = traces.get(data)?.[cell[0]!]?.[cell[1]!];
    return <><div className={styles.matrix} data-study-matrix style={{ gridTemplateColumns: `repeat(${data[0]!?.length || 1}, 1fr)` }}>{data.flatMap((row, i) => row.map((v, j) => <button key={`${i}-${j}`} type="button" aria-label={`行 ${i} 列 ${j} 值 ${v.toFixed(5)}`} title={`[${i},${j}] ${v.toFixed(5)}`} style={{ background: `hsl(${v < 0 ? 20 : 195} 65% ${88 - Math.abs(v) / max * 48}%)`, outline: cell[0]! === i || cell[1]! === j ? '1px solid #577580' : undefined }} onMouseEnter={() => setCell([i, j])} onFocus={() => setCell([i, j])} onClick={() => setCell([i, j])}>{data.length <= 4 && row.length <= 4 ? v.toFixed(2) : ''}</button>))}</div><output>[{cell.join(',')}] = {data[cell[0]!]!?.[cell[1]!]?.toFixed(5) ?? '—'}</output>{trace && <><div>原图感受野：{trace.sources.length} 像素（含零权重位置）</div><div className={styles.receptive}>{Array.from({ length: 144 }, (_, i) => <span key={i} style={{ background: trace.sources.includes(`${Math.floor(i / 12)},${i % 12}`) ? '#149cac' : '#e1e7ec' }}/>)}</div><TraceTree trace={trace}/></>}</>;
}
function Boundary({ value, layer }: {
    value: PortValue | null;
    layer: number;
}) {
    if (value?.kind !== 'dataset2d')
        return <p role="status">连接 dataset2d 数据集 / 训练边界</p>;
    const model = boundaryModels.get(value);
    const map = (x: number, y: number): number[] => { if (!model || layer === 0)
        return [x, y]; const f = forward(model, [x, y]); const a = f.acts[layer]!; return layer === 3 ? [a[0]! * 2 - 1, 0] : [a[0]!, a[1]! ?? 0]; };
    const coord = (x: number, y: number) => { const a = map(x, y); return [150 + a[0]! * 70, 120 - a[1]! * 70]; };
    const grid = Array.from({ length: 17 }, (_, i) => -1.6 + i * .2);
    return <><svg viewBox="0 0 300 240" className={styles.plot} role="img" aria-label="真实模型的决策场、坐标网格与训练验证点云">
    {model && layer === 0 && grid.flatMap(x => grid.map(y => { const prob = forward(model, [x, y]).probability; return <rect key={`${x},${y}`} x={150 + x * 70 - 7} y={120 - y * 70 - 7} width="14" height="14" fill={prob > .5 ? '#a8daee' : '#f3c3aa'} opacity={Math.abs(prob - .5) * 1.5 + .15}/>; }))}
    {grid.flatMap((t, i) => [false, true].map(vertical => <polyline key={`${i}-${vertical}`} points={Array.from({ length: 49 }, (_, j) => { const v = -1.6 + j / 15; return coord(vertical ? t : v, vertical ? v : t).join(','); }).join(' ')} fill="none" stroke="#81939d" strokeWidth=".5"/>))}
    {value.points.map((p, i) => { const [x, y] = coord(p.x, p.y); return <circle key={i} cx={x} cy={y} r={p.split === 'validation' ? 3.8 : 2.8} fill={p.split === 'validation' ? 'white' : p.label >= .5 ? '#1684af' : '#d26536'} stroke={p.label >= .5 ? '#1684af' : '#d26536'}><title>{p.split} · label {p.label.toFixed(2)}{model ? ` · p=${forward(model, [p.x, p.y]).probability.toFixed(3)}` : ''}</title></circle>; })}
  </svg><small>{model ? `Epoch ${model.epoch} · ${model.epoch ? '实际优化结果，不保证线性可分' : '未训练初始化，并非已分离'}` : '原始点云（没有训练模型）'} · 空心=验证集{layer === 1 ? ' · Layer 1 仅投影前两个神经元' : ''}</small></>;
}
function ActivationCurve({ kind, input }: {
    kind: number;
    input: PortValue | null;
}) {
    const samples = input?.kind === 'tensor2d' ? input.data.flat().slice(0, 400) : [];
    const X = Math.max(6, ...samples.map((v) => Math.abs(v) + 1));
    const xs = Array.from({ length: 121 }, (_, i) => -X + (2 * X * i) / 120);
    const ys = xs.map((x) => activation(x, kind));
    const lo0 = Math.min(0, ...ys.flat()), hi0 = Math.max(1, ...ys.flat());
    const pad = Math.max(.05, (hi0 - lo0) * .08);
    const lo = lo0 - pad, hi = hi0 + pad;
    const px = (x: number) => 30 + ((x + X) / (2 * X)) * 260;
    const py = (y: number) => 146 - ((y - lo) / (hi - lo)) * 132;
    const ticksX = [-X, -X / 2, 0, X / 2, X];
    const ticksY = Array.from({ length: 4 }, (_, i) => lo + ((hi - lo) * i) / 3);
    const seg = (idx: 0 | 1) => xs.map((x, i) => `${px(x).toFixed(1)},${py(ys[i]![idx]).toFixed(1)}`).join(' ');
    return <svg viewBox="0 0 300 160" className={styles.plot} role="img" aria-label={`${DF_ACTIVATIONS[kind] ?? '激活'} 函数及其导数曲线`}>
      {ticksX.map((t) => <g key={t}><line x1={px(t)} y1={8} x2={px(t)} y2={146} stroke="#e3eaee" strokeWidth=".6" /><text x={px(t)} y={157} fontSize="7" textAnchor="middle" fill="#7a8c94">{+t.toFixed(1)}</text></g>)}
      {ticksY.map((t) => <g key={t}><line x1={30} y1={py(t)} x2={290} y2={py(t)} stroke="#e3eaee" strokeWidth=".6" /><text x={26} y={py(t) + 2.5} fontSize="7" textAnchor="end" fill="#7a8c94">{+t.toFixed(2)}</text></g>)}
      {lo <= 0 && hi >= 0 && <line x1={30} y1={py(0)} x2={290} y2={py(0)} stroke="#9fb0b8" strokeWidth=".8" />}
      <line x1={px(0)} y1={8} x2={px(0)} y2={146} stroke="#9fb0b8" strokeWidth=".8" />
      <polyline points={seg(1)} fill="none" stroke="#d26536" strokeWidth="1.4" strokeDasharray="4 3" />
      <polyline points={seg(0)} fill="none" stroke="#1684af" strokeWidth="1.8" />
      {samples.map((v, i) => <circle key={i} cx={px(v)} cy={py(activation(v, kind)[0]!)} r="1.6" fill="#1684af" opacity=".5"><title>x={v.toFixed(3)} → {activation(v, kind)[0]!.toFixed(4)}</title></circle>)}
      <text x={34} y={14} fontSize="8" fill="#1684af">f(x)</text>
      <text x={34} y={24} fontSize="8" fill="#d26536">f′(x)</text>
      {samples.length > 0 && <text x={290} y={14} fontSize="7" textAnchor="end" fill="#7a8c94">·{samples.length} 个输入样本落点</text>}
    </svg>;
}
function Trainer(props: NodeBodyProps) {
    const { node, values, onParams, onLive } = props;
    const config = mlpSetup(node, (port) => values[port] ?? null);
    const p = config ?? node.params;
    const data = config && values.in?.kind === 'dataset2d' ? values.in.points : [];
    const signature = JSON.stringify([data, p.width, p.second, p.act1, p.act2, p.seed, p.lr, p.batch, p.l1, p.l2, p.dropout, p.reset]);
    const model = useRef(createModel(p.width, p.seed, p.second, p.act1, p.act2));
    const live = useRef(onLive);
    live.current = onLive;
    const [snapshot, setSnapshot] = useState(model.current);
    const dataRef = useRef(data);
    dataRef.current = data;
    const paramsRef = useRef(p);
    paramsRef.current = p;
    const lastSignature = useRef(signature);
    const [activeSignature, setActiveSignature] = useState(signature);
    useEffect(() => {
        if (lastSignature.current !== signature) {
            lastSignature.current = signature;
            if (node.params.play) onParams?.({ play: 0 });
            setActiveSignature(signature);
        }
    }, [signature, node.params.play, onParams]);
    useEffect(() => { model.current = createModel(p.width, p.seed, p.second, p.act1, p.act2); setSnapshot(model.current); live.current?.(trainingOutputs(model.current, dataRef.current)); }, [signature]); // Parameters reset deliberately; frames never write the document.
    useEffect(() => { if (!p.play || !data.length || activeSignature !== signature)
        return; const timer = window.setInterval(() => { if (model.current.epoch >= 2000) {
        window.clearInterval(timer);
        return;
    } model.current = trainEpoch(model.current, dataRef.current, paramsRef.current); setSnapshot(model.current); live.current?.(trainingOutputs(model.current, dataRef.current)); }, 40); return () => window.clearInterval(timer); }, [p.play, signature, activeSignature]);
    const out = trainingOutputs(snapshot, data);
    const losses = snapshot.history;
    const max = Math.max(1, ...losses.flat());
    if (!config || !data.length) return <p role="status">请连接有效点云、模型和训练配置。</p>;
    return <><div className={styles.controls}><button onClick={() => onParams?.({ play: p.play ? 0 : 1 })}>{p.play ? '暂停' : '开始训练'}</button><button onClick={() => onParams?.({ reset: (p.reset ?? 0) + 1, play: 0 })}>重置</button></div><p>2 → {clamp(p.width ?? 6, 1, 8)} → {p.second ?? 2} → 1 · {DF_ACTIVATIONS[p.act1 ?? 3]} / {DF_ACTIVATIONS[p.act2 ?? 3]} / BCE<br />Epoch {snapshot.epoch}/2000 {snapshot.epoch >= 2000 ? '已达上限，重置后继续' : ''}</p><output>训练 {out.loss.kind === 'scalar' ? out.loss.v.toFixed(4) : ''} / 验证 {out.validationLoss.kind === 'scalar' ? out.validationLoss.v.toFixed(4) : ''}</output><svg viewBox="0 0 300 70" className={styles.loss} role="img" aria-label="最近200轮训练蓝线与验证橙线损失">{[0, 1].map(k => <polyline key={k} fill="none" stroke={k ? '#d26536' : '#1684af'} strokeWidth="2" points={losses.map((v, i) => `${i / Math.max(1, losses.length - 1) * 300},${65 - v[k]! / max * 60}`).join(' ')}/>)}</svg><small>蓝=训练，橙=验证；仅 train 更新权重；无 Dropout 评估。</small><Boundary value={out.boundary} layer={0}/></>;
}
function DeepBody(props: NodeBodyProps) {
    const { node, values, onParams, onText, onPayload, inCard } = props, p = { ...deepCoreDefaults(node.type), ...node.params };
    const [drawing, setDrawing] = useState(false);
    const numeric = (key: string, label: string, min: number, max: number, step = 1) => <label key={key}>{label}<input aria-label={label} type="number" min={min} max={max} step={step} value={p[key]! ?? min} onChange={e => { const value = Number(e.target.value); if (Number.isFinite(value))
        onParams?.({ [key]: clamp(value, min, max) }); }}/></label>;
    const select = (key: string, label: string, options: string[]) => <label>{label}<select aria-label={label} value={p[key]! ?? 0} onChange={e => onParams?.({ [key]: Number(e.target.value) })}>{options.map((o, i) => <option key={o} value={i}>{o}</option>)}</select></label>;
    const toggle = (key: string, label: string) => <label><input type="checkbox" checked={!!p[key]!} onChange={e => onParams?.({ [key]: Number(e.target.checked) })}/>{label}</label>;
    const out = deepCoreOutput({ ...node, params: p }, port => values[port]! ?? null, 'out');
    return <div className={styles.body} onPointerDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}>
    {node.type === 'dataset2dSource' && <>{!inCard && <>{select('kind', '数据分布', ['XOR', 'Moons', 'Circles', 'Spiral'])}{numeric('samples', '样本数', 8, 120)}{numeric('noise', '噪声', 0, 1, .01)}{numeric('seed', '随机种子', 0, 99999)}</>}<Boundary value={out} layer={0}/></>}
    {node.type === 'pixelGridSource' && <>{!inCard && <>{select('preset', '预设底图', ['竖线', '圆盘', '交叉'])}{numeric('brush', '笔刷灰度', 0, 1, .1)}<button onClick={() => { const patch: Record<string, number> = {}; const base = pixelData({ preset: p.preset ?? 0 }); base.forEach((r, i) => r.forEach((v, j) => { patch[`pixel_${i}_${j}`]! = v; })); onPayload?.(undefined); onParams?.(patch); }}>应用预设 / 清除涂抹</button></>}<div className={styles.pixels} onPointerUp={() => setDrawing(false)} onPointerLeave={() => setDrawing(false)}>{pixelData(p, node.payload).flatMap((r, i) => r.map((v, j) => <button key={`${i}-${j}`} aria-label={`像素 ${i},${j} 灰度 ${v}`} style={{ background: `rgb(${v * 255},${v * 255},${v * 255})` }} onPointerDown={() => { setDrawing(true); onPayload?.(undefined); onParams?.({ [`pixel_${i}_${j}`]: (p.brush ?? 1) }); }} onPointerEnter={e => { if (drawing && e.buttons) { onPayload?.(undefined); onParams?.({ [`pixel_${i}_${j}`]: (p.brush ?? 1) }); } }} onClick={() => { onPayload?.(undefined); onParams?.({ [`pixel_${i}_${j}`]: (p.brush ?? 1) }); }}/>))}</div></>}
    {node.type === 'tokenSeqSource' && <><label>词元（空格分隔，4–6 个）<input aria-label="词元文本" value={node.text ?? '我 爱 学习 深度 网络'} onChange={e => onText?.(e.target.value)}/></label>{!inCard && <>{numeric('seed', '嵌入种子', 0, 99999)}<small>每个词确定性4维嵌入；不足4个补 [pad]，超过6个截断。</small></>}</>}
    {node.type === 'linearOp' && !inCard && <>{numeric('width', '输出宽度', 1, 8)}{numeric('seed', '权重种子', 0, 99999)}{toggle('orthogonal', '正交初始化（否则 Xavier）')}<details><summary>编辑 W 与偏置（输入行 × W）</summary>{(() => { const w = deepCoreOutput({ ...node, params: p }, port => values[port]! ?? null, 'weights'); return w?.kind === 'tensor2d' ? w.data.map((row, i) => <div key={i}>{row.map((v, j) => <label key={j}>W{i},{j}<input aria-label={`权重 ${i},${j}`} type="number" step=".05" min="-10" max="10" value={p[`w${i}_${j}`]! ?? v} onChange={e => onParams?.({ [`w${i}_${j}`]: clamp(Number(e.target.value), -10, 10) })}/></label>)}</div>) : '请连接输入'; })()}{Array.from({ length: Math.round(clamp(p.width ?? 2, 1, 8)) }, (_, j) => numeric(`b${j}`, `偏置 ${j}`, -10, 10, .05))}</details></>}
    {node.type === 'activationOp' && <>{select('kind', '激活函数', ['ReLU', 'LeakyReLU', 'Sigmoid', 'Tanh', 'GELU'])}<ActivationCurve kind={Math.round(p.kind ?? 3)} input={values.in ?? null}/><small>蓝=f(x)，橙虚线=f′(x)；derivative 端口广播逐元素局部导数。</small></>}
    {node.type === 'residualJoin' && <p>A + B：必须严格同形，不广播维度。</p>}
    {node.type === 'normOp' && !inCard && <>{select('mode', '归一化', ['None', 'BatchNorm', 'LayerNorm'])}<small>BN 沿 batch 行统计每列；LN 沿特征列统计每行。当前批统计，ε=10⁻⁵，不含可学习仿射。</small></>}
    {node.type === 'conv2dOp' && !inCard && <>{select('kernel', '卷积核预设', ['边缘', '锐化', '模糊'])}<button onClick={() => { const patch: Record<string, number> = {}; kernelData({ kernel: p.kernel ?? 0 }).forEach((r, i) => r.forEach((v, j) => { patch[`k${i}${j}`]! = v; })); onParams?.(patch); }}>应用核预设</button><div className={styles.kernel}>{kernelData(p).flatMap((r, i) => r.map((v, j) => <input key={`${i}-${j}`} aria-label={`卷积权重 ${i},${j}`} type="number" min="-10" max="10" step=".1" value={v} onChange={e => onParams?.({ [`k${i}${j}`]: clamp(Number(e.target.value), -10, 10) })}/>))}</div>{numeric('stride', 'Stride', 1, 2)}{toggle('padding', '零填充 Padding=1')}{toggle('pool', '首层后 2×2 MaxPool')}{toggle('second', '第二层（同核，stride=1）')}<small>互相关约定，不翻转核。也可串联独立卷积节点；点击输出逐层追踪乘加。</small></>}
    {node.type === 'attentionOp' && !inCard && <>{toggle('scaled', '除以 √d')}{toggle('causal', '因果掩码')}{numeric('temperature', '温度', .05, 5, .05)}<small>固定恒等投影的自注意：Q=K=V=输入；weights=softmax(QKᵀ/√d/T)，out=weights·V。序列≤8。</small></>}
    {node.type === 'mlpTrainer' && <>{!inCard && <>{numeric('width', '隐层宽度', 1, 8)}{numeric('seed', '训练种子', 0, 99999)}{numeric('lr', '学习率', .0001, .5, .01)}{numeric('batch', 'Mini-batch', 1, 16)}{numeric('l1', 'L1', 0, 1, .001)}{numeric('l2', 'L2', 0, 1, .001)}{numeric('dropout', 'Dropout', 0, .8, .05)}</>}<Trainer {...props}/></>}
    {node.type === 'boundaryView' && <>{!inCard && select('layer', '层级穿梭', ['Input / 决策边界', 'Layer 1（前两维）', 'Layer 2（二维）', 'Output（概率轴）'])}<Boundary value={values.in ?? null} layer={Math.round(clamp(p.layer ?? 0, 0, 3))}/></>}
    {node.type === 'matrixHeatmapView' && (values.in?.kind === 'tensor2d' ? <Heatmap data={values.in.data}/> : <p role="status">连接 tensor2d 查看数值与 CNN 追踪</p>)}
    {node.type === 'gradFlowMeter' && (values.in?.kind === 'tensor2d' ? values.in.data.flat().map((v, i) => <label key={i}>层 {i + 1} · {v.toExponential(2)} {Math.abs(v) < 1e-4 ? '梯度消失' : Math.abs(v) > 10 ? '梯度爆炸' : ''}<meter min="0" max="10" value={Math.min(10, Math.abs(v))} aria-label={`层${i + 1}梯度幅值`}/></label>) : <p>连接 grad 张量</p>)}
    {out?.kind === 'tensor2d' && node.type !== 'pixelGridSource' && <Heatmap data={out.data}/>}
    {!out && ['linearOp', 'activationOp', 'residualJoin', 'normOp', 'conv2dOp', 'attentionOp'].includes(node.type) && <p role="status">请连接有效输入；检查形状、尺寸与有限数值。</p>}
  </div>;
}
const port = (id: string, kind: PortSpec['kind'] = 'tensor2d'): PortSpec => ({ id, label: id, kind });
const def = (title: string, inputs: PortSpec[], outputs: PortSpec[], badge: NodeDef['badge'] = '变换'): NodeDef => ({ title, badge, width: 340, inputs, outputs, Body: DeepBody });
export const DEEP_CORE_DEFS: Partial<Record<NodeType, NodeDef>> = {
    dataset2dSource: def('二维数据集', [], [port('out', 'dataset2d')], '源'), pixelGridSource: def('12×12 像素画板', [], [port('out')], '源'), tokenSeqSource: def('词元嵌入', [], [port('out')], '源'),
    linearOp: def('线性层 Wx+b', [port('in')], [port('out'), port('weights')]), activationOp: def('激活函数', [port('in')], [port('out'), port('derivative')]), residualJoin: def('残差相加', [port('A'), port('B')], [port('out')]), normOp: def('BN / LN', [port('in')], [port('out')]), conv2dOp: def('卷积与感受野', [port('in')], [port('out')]), attentionOp: def('自注意力', [port('in')], [port('out'), port('weights')]),
    mlpTrainer: def('MLP / 正则化训练器', [port('in', 'dataset2d'), port('model'), port('training')], [port('boundary', 'dataset2d'), port('probability', 'dataset2d'), port('loss', 'scalar'), port('validationLoss', 'scalar'), port('grad')], '实验'),
    boundaryView: def('边界与流形折叠', [port('in', 'dataset2d')], [], '视图'), matrixHeatmapView: def('矩阵热力与追踪', [port('in')], [], '视图'), gradFlowMeter: def('梯度幅值', [port('in')], [], '视图'),
};
