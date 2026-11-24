/**
 * NodeInspector.tsx —— 右侧模块详情检查器（数据显微 + 调参 + 真实图片/CSV 导入）
 *
 * - 未选中模块时：展示实验总览（探究引导、常用全局参数、核心结果预览）。
 * - 选中画布上任意模块时：展示上下游跳转、专属显微过程（如 CNN 3×3 滑动窗口动画、
 *   真实图片上传与 32×32 高清滤波对照、CSV 真实数据集导入）及该模块的完整交互面板。
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { CanvasDoc, CanvasNode, CanvasPanel, PortValue } from './types.ts';
import type { NodeBodyProps, NodeDef } from './nodes.tsx';
import { kernelData, type Matrix } from './deepCore.ts';
import {
  builtinSampleImage,
  convolvePreview,
  decodeImageFile,
  parseCsvDatasetPayload,
  parseCsvText,
  parseRealImagePayload,
  type ImageChannel,
  type RealImagePayload,
} from './imageInput.ts';
import { nodeSchematicMeta } from './NodeSchematic.tsx';
import { FunctionSourceControls } from './CalculusNodes.tsx';
import styles from './nodeInspector.module.css';

export function MatrixSvg({
  data,
  highlightBox,
  highlightCell,
  signed = false,
  onSelectCell,
}: {
  data: Matrix;
  highlightBox?: { r0: number; c0: number; size: number };
  highlightCell?: { r: number; c: number };
  signed?: boolean;
  onSelectCell?: (r: number, c: number) => void;
}): JSX.Element {
  const rows = data.length;
  const cols = data[0]?.length ?? 1;
  const maxAbs = Math.max(1e-6, ...data.flat().map(Math.abs));
  const cell = 10;
  const W = cols * cell;
  const H = rows * cell;
  return (
    <svg className={styles.scanSvg} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${rows}×${cols} 矩阵预览`}>
      {data.flatMap((row, r) => row.map((v, c) => {
        const fill = signed
          ? `hsl(${v < 0 ? 18 : 215} 68% ${90 - (Math.abs(v) / maxAbs) * 48}%)`
          : `rgb(${Math.round(Math.max(0, Math.min(1, v)) * 245)},${Math.round(Math.max(0, Math.min(1, v)) * 245)},${Math.round(Math.max(0, Math.min(1, v)) * 245)})`;
        return (
          <rect
            key={`${r}-${c}`}
            x={c * cell}
            y={r * cell}
            width={cell - 0.35}
            height={cell - 0.35}
            fill={fill}
            style={onSelectCell ? { cursor: 'pointer' } : undefined}
            onClick={onSelectCell ? () => onSelectCell(r, c) : undefined}
          />
        );
      }))}
      {highlightBox ? (
        <rect
          x={highlightBox.c0 * cell}
          y={highlightBox.r0 * cell}
          width={highlightBox.size * cell}
          height={highlightBox.size * cell}
          fill="rgba(217, 98, 54, 0.16)"
          stroke="#d96236"
          strokeWidth={Math.max(1.2, cell * 0.18)}
        />
      ) : null}
      {highlightCell ? (
        <rect
          x={highlightCell.c * cell}
          y={highlightCell.r * cell}
          width={cell}
          height={cell}
          fill="none"
          stroke="#d96236"
          strokeWidth={Math.max(1.4, cell * 0.22)}
        />
      ) : null}
    </svg>
  );
}

/** CNN 卷积层过程显微：3×3 滑窗逐格扫描动画 + 逐元素乘加分解 + 32×32 真图高清对照 */
function ConvMicroScanner({
  node,
  inputMatrix,
  outputMatrix,
  upstreamRealImage,
}: {
  node: CanvasNode;
  inputMatrix: Matrix | null;
  outputMatrix: Matrix | null;
  upstreamRealImage: RealImagePayload | null;
}): JSX.Element | null {
  const kernel = useMemo(() => kernelData(node.params), [node.params]);
  const stride = Math.round(node.params.stride ?? 1) === 2 ? 2 : 1;
  const padding = node.params.padding ? 1 : 0;
  const outH = outputMatrix?.length ?? 0;
  const outW = outputMatrix?.[0]?.length ?? 0;
  const totalSteps = Math.max(0, outH * outW);

  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    setStep((prev) => (totalSteps > 0 ? Math.min(prev, totalSteps - 1) : 0));
  }, [totalSteps]);

  useEffect(() => {
    if (!playing || totalSteps <= 1) return;
    const timer = window.setInterval(() => {
      setStep((prev) => (prev + 1) % totalSteps);
    }, 320);
    return () => window.clearInterval(timer);
  }, [playing, totalSteps]);

  const hiResFiltered = useMemo(() => {
    if (!upstreamRealImage?.hiRes) return null;
    return convolvePreview(upstreamRealImage.hiRes, kernel, stride, padding);
  }, [upstreamRealImage, kernel, stride, padding]);

  if (!inputMatrix || !outputMatrix || totalSteps === 0) return null;

  const outR = Math.floor(step / outW);
  const outC = step % outW;
  const inR0 = outR * stride - padding;
  const inC0 = outC * stride - padding;

  const cells: { x: number; k: number; prod: number }[] = [];
  let sum = 0;
  for (let u = 0; u < 3; u++) {
    for (let v = 0; v < 3; v++) {
      const x = inputMatrix[inR0 + u]?.[inC0 + v] ?? 0;
      const k = kernel[u]?.[v] ?? 0;
      const prod = x * k;
      sum += prod;
      cells.push({ x, k, prod });
    }
  }

  return (
    <section className={styles.section} aria-label="卷积过程显微">
      <div className={styles.sectionHead}>
        <h3>卷积滑动窗口显微（3×3 逐格计算）</h3>
        <div className={styles.microControls}>
          <button type="button" className={styles.microBtn} onClick={() => { setPlaying(false); setStep((s) => (s - 1 + totalSteps) % totalSteps); }}>上一步</button>
          <button type="button" className={`${styles.microBtn} ${playing ? styles.microBtnPrimary : ''}`} onClick={() => setPlaying((p) => !p)}>
            {playing ? '暂停扫描' : '播放扫描'}
          </button>
          <button type="button" className={styles.microBtn} onClick={() => { setPlaying(false); setStep((s) => (s + 1) % totalSteps); }}>下一步</button>
        </div>
      </div>

      <div className={styles.scanRow}>
        <div className={styles.scanCol}>
          <MatrixSvg data={inputMatrix} highlightBox={{ r0: Math.max(0, inR0), c0: Math.max(0, inC0), size: 3 }} />
          <span>输入特征（红框 = 当前 3×3）</span>
        </div>
        <span style={{ fontSize: 16, color: 'var(--ink-400)' }}>→</span>
        <div className={styles.scanCol}>
          <MatrixSvg
            data={outputMatrix}
            signed
            highlightCell={{ r: outR, c: outC }}
            onSelectCell={(r, c) => { setPlaying(false); setStep(r * outW + c); }}
          />
          <span>输出 [{outR}, {outC}]（点击任意格定位）</span>
        </div>
      </div>

      <div className={styles.mulGrid}>
        {cells.map((cell, idx) => (
          <div key={idx} className={styles.mulCell}>
            {cell.x.toFixed(2)} × {cell.k.toFixed(1)}
            <span className={styles.mulProd}>= {cell.prod.toFixed(2)}</span>
          </div>
        ))}
      </div>
      <div className={styles.mulSum}>
        当前格 [{outR}, {outC}] 乘加总和 = <b>{sum.toFixed(4)}</b>（stride={stride}，padding={padding}）
      </div>

      {upstreamRealImage?.hiRes && hiResFiltered ? (
        <div className={styles.previewPair}>
          <div className={styles.previewBox}>
            <MatrixSvg data={upstreamRealImage.hiRes} />
            <span>真图 32×32 原图</span>
          </div>
          <div className={styles.previewBox}>
            <MatrixSvg data={hiResFiltered} signed />
            <span>32×32 经当前 3×3 核滤波效果</span>
          </div>
        </div>
      ) : null}
    </section>
  );
}

/** 真实图片上传与通道切换（挂载在 pixelGridSource 检查器顶部） */
export function RealImagePanel({
  node,
  onPayload,
}: {
  node: CanvasNode;
  onPayload?: (payload: string | undefined) => void;
}): JSX.Element {
  const realImg = parseRealImagePayload(node.payload);
  const [channel, setChannel] = useState<ImageChannel>(realImg?.channel ?? 'gray');
  const [lastFile, setLastFile] = useState<File | null>(null);
  const [error, setError] = useState('');

  const applyFile = async (file: File, nextChannel: ImageChannel): Promise<void> => {
    setError('');
    try {
      const payload = await decodeImageFile(file, nextChannel);
      setLastFile(file);
      onPayload?.(JSON.stringify(payload));
    } catch (e) {
      setError(e instanceof Error ? e.message : '读取图片失败');
    }
  };

  const switchChannel = (nextChannel: ImageChannel): void => {
    setChannel(nextChannel);
    if (lastFile) void applyFile(lastFile, nextChannel);
  };

  return (
    <section className={styles.section} aria-label="真实图片输入渠道">
      <div className={styles.sectionHead}>
        <h3>真实图片测试通道</h3>
        {realImg ? (
          <button type="button" className={styles.microBtn} onClick={() => { setLastFile(null); onPayload?.(undefined); }}>
            恢复手绘画板
          </button>
        ) : null}
      </div>

      <div className={styles.uploadRow}>
        <label className={styles.fileLabel}>
          上传一张真实图片
          <input
            type="file"
            accept="image/*"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void applyFile(file, channel);
              e.target.value = '';
            }}
          />
        </label>
        <select
          aria-label="图像通道"
          className={styles.microBtn}
          value={channel}
          onChange={(e) => switchChannel(e.target.value as ImageChannel)}
        >
          <option value="gray">灰度通道</option>
          <option value="r">R 通道</option>
          <option value="g">G 通道</option>
          <option value="b">B 通道</option>
        </select>
      </div>

      <div className={styles.uploadRow}>
        <span className={styles.flowLabel}>快速测试样例：</span>
        {([
          ['digit7', '手写数字 7'],
          ['corner', '房屋轮廓'],
          ['ring', '同心圆靶'],
        ] as const).map(([kind, label]) => (
          <button
            key={kind}
            type="button"
            className={styles.flowChip}
            onClick={() => {
              setLastFile(null);
              onPayload?.(JSON.stringify(builtinSampleImage(kind)));
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {error ? <p className={styles.error} role="alert">{error}</p> : null}

      {realImg ? (
        <div className={styles.previewPair}>
          <div className={styles.previewBox}>
            {realImg.previewUrl ? (
              <img src={realImg.previewUrl} alt={realImg.name} className={styles.previewImg} />
            ) : realImg.hiRes ? (
              <MatrixSvg data={realImg.hiRes} />
            ) : null}
            <span>原图：{realImg.name}</span>
          </div>
          <div className={styles.previewBox}>
            <MatrixSvg data={realImg.data} />
            <span>12×12 输入矩阵（实时送入下游卷积）</span>
          </div>
        </div>
      ) : (
        <div className={styles.banner}>
          上传任意一张 JPG / PNG 图片，将自动居中裁剪并同步生成 <b>12×12 显微矩阵</b> 与 <b>32×32 高清对照图</b>，直接流入下游 conv1 / conv2 / MaxPool 实时测试。
        </div>
      )}
    </section>
  );
}

/** 微型真实 CSV 数据集导入（挂载在 dataset2dSource 检查器顶部） */
export function CsvDatasetPanel({
  node,
  onPayload,
}: {
  node: CanvasNode;
  onPayload?: (payload: string | undefined) => void;
}): JSX.Element {
  const current = parseCsvDatasetPayload(node.payload);
  const [draft, setDraft] = useState('1.2, 2.1, 0\n1.5, 1.8, 0\n2.0, 2.4, 0\n4.2, 5.0, 1\n4.8, 4.5, 1\n5.1, 5.3, 1');
  const [error, setError] = useState('');

  const importText = (raw: string, name?: string): void => {
    setError('');
    try {
      const parsed = parseCsvText(raw, name);
      onPayload?.(JSON.stringify(parsed));
    } catch (e) {
      setError(e instanceof Error ? e.message : '解析 CSV 失败');
    }
  };

  return (
    <section className={styles.section} aria-label="真实 CSV 数据集导入">
      <div className={styles.sectionHead}>
        <h3>真实小数据集导入（CSV）</h3>
        {current ? (
          <button type="button" className={styles.microBtn} onClick={() => onPayload?.(undefined)}>
            恢复内置点云
          </button>
        ) : null}
      </div>
      <div className={styles.uploadRow}>
        <label className={styles.fileLabel}>
          上传 CSV 文件
          <input
            type="file"
            accept=".csv,.txt"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              file.text().then((txt) => {
                setDraft(txt.slice(0, 4000));
                importText(txt, file.name);
              }).catch(() => setError('读取文件失败'));
              e.target.value = '';
            }}
          />
        </label>
        <button type="button" className={styles.microBtn} onClick={() => importText(draft, '粘贴 CSV')}>
          应用下方数据
        </button>
      </div>
      <textarea
        className={styles.csvArea}
        aria-label="CSV 数据内容"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="每行 x, y, label（0 或 1），最多 120 行"
      />
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {current ? (
        <div className={styles.banner}>
          已加载真实数据：<b>{current.name}</b>（共 {current.points.length} 条，已自动归一化到 [-1, 1] 并划分训练/验证集）
        </div>
      ) : null}
    </section>
  );
}

export interface NodeInspectorProps {
  doc: CanvasDoc;
  panel?: CanvasPanel;
  selectedNode: CanvasNode | null;
  selectedDef: NodeDef | null;
  selectedBodyProps: NodeBodyProps | null;
  convOrdinal?: number;
  upstreamRealImage: RealImagePayload | null;
  closeLabel?: string;
  overviewNodes: { node: CanvasNode; title: string; content: ReactNode }[];
  onSelectNode: (id: string | null) => void;
  onUpdateParam: (nodeId: string, patch: Record<string, number>) => void;
  nodeTitle: (node: CanvasNode) => string;
}

export function NodeInspector({
  doc,
  panel,
  selectedNode,
  selectedDef,
  selectedBodyProps,
  convOrdinal,
  upstreamRealImage,
  overviewNodes,
  closeLabel,
  onSelectNode,
  onUpdateParam,
  nodeTitle,
}: NodeInspectorProps): JSX.Element {
  const notes = doc.nodes.filter((n) => n.type === 'textNote' && n.text?.trim());

  if (selectedNode && selectedDef && selectedBodyProps) {
    const meta = nodeSchematicMeta(selectedNode, selectedDef, selectedBodyProps.self, convOrdinal);
    const Body = selectedDef.Body;
    const upstream = doc.wires
      .filter((w) => w.to === selectedNode.id)
      .map((w) => doc.nodes.find((n) => n.id === w.from))
      .filter((n): n is CanvasNode => !!n);
    const downstream = doc.wires
      .filter((w) => w.from === selectedNode.id)
      .map((w) => doc.nodes.find((n) => n.id === w.to))
      .filter((n): n is CanvasNode => !!n);

    const inTensor = selectedBodyProps.values.in?.kind === 'tensor2d' ? selectedBodyProps.values.in.data : null;
    const outTensor = selectedBodyProps.self?.kind === 'tensor2d' ? selectedBodyProps.self.data : null;

    return (
      <aside className={styles.panel} aria-label="结果与参数">
        <header className={styles.header}>
          <div className={styles.headerTitle}>
            <span className={styles.badge}>{meta.spec}</span>
            <h2>{meta.title}</h2>
          </div>
          <button type="button" className={styles.backBtn} onClick={() => onSelectNode(null)}>
            {closeLabel ?? '返回总览'}
          </button>
        </header>

        <div className={styles.scroll}>
          {(upstream.length > 0 || downstream.length > 0) ? (
            <div className={styles.flowBar}>
              {upstream.length > 0 ? (
                <>
                  <span className={styles.flowLabel}>输入自</span>
                  {upstream.map((u) => (
                    <button key={u.id} type="button" className={styles.flowChip} onClick={() => onSelectNode(u.id)}>
                      ← {nodeTitle(u)}
                    </button>
                  ))}
                </>
              ) : null}
              {downstream.length > 0 ? (
                <>
                  <span className={styles.flowLabel}>流向</span>
                  {downstream.map((d) => (
                    <button key={d.id} type="button" className={styles.flowChip} onClick={() => onSelectNode(d.id)}>
                      {nodeTitle(d)} →
                    </button>
                  ))}
                </>
              ) : null}
            </div>
          ) : null}

          {selectedNode.type === 'pixelGridSource' ? (
            <RealImagePanel node={selectedNode} onPayload={selectedBodyProps.onPayload} />
          ) : null}

          {selectedNode.type === 'dataset2dSource' ? (
            <CsvDatasetPanel node={selectedNode} onPayload={selectedBodyProps.onPayload} />
          ) : null}

          {selectedNode.type === 'conv2dOp' ? (
            <ConvMicroScanner
              node={selectedNode}
              inputMatrix={inTensor}
              outputMatrix={outTensor}
              upstreamRealImage={upstreamRealImage}
            />
          ) : null}

          <section className={styles.section} aria-label="模块数据与参数">
            <div className={styles.sectionHead}>
              <h3>模块数据与参数调节</h3>
            </div>
            {selectedNode.type === 'functionSource'
              ? <FunctionSourceControls key={selectedNode.id} {...selectedBodyProps} />
              : <Body key={selectedNode.id} {...selectedBodyProps} />}
          </section>
        </div>
      </aside>
    );
  }

  return (
    <aside className={styles.panel} aria-label="结果与参数">
      <header className={styles.header}>
        <div className={styles.headerTitle}>
          <span className={styles.badge}>总览</span>
          <h2>实验结果</h2>
        </div>
      </header>

      <div className={styles.scroll}>
        <div className={styles.banner}>
          点击左侧画布中的任意小模块，即可在这里查看它的<b>内部数据、逐格计算细节</b>并调节参数；修改后整条链路会实时同步。
        </div>

        {notes.length > 0 ? (
          <section className={styles.section}>
            <details className={styles.noteDetails} open={notes.length === 1}>
              <summary>实验探究与步骤（{notes.length} 条）</summary>
              {notes.map((n) => (
                <p key={n.id} className={styles.noteBody}>{n.text}</p>
              ))}
            </details>
          </section>
        ) : null}

        {panel && panel.exposed_params.length > 0 ? (
          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <h2>常用参数</h2>
            </div>
            <div className={styles.paramList}>
              {panel.exposed_params.map((param) => {
                const node = doc.nodes.find((item) => item.id === param.node_id);
                if (!node) return null;
                const value = node.params[param.param_key] ?? param.min ?? 0;
                return (
                  <label key={`${param.node_id}:${param.param_key}`} className={styles.paramItem}>
                    <span>{param.label}</span>
                    <output>{value}</output>
                    <input
                      type="range"
                      aria-label={param.label || param.param_key}
                      min={param.min}
                      max={param.max}
                      step={param.step}
                      value={value}
                      onChange={(event) => onUpdateParam(node.id, { [param.param_key]: Number(event.target.value) })}
                    />
                  </label>
                );
              })}
            </div>
          </section>
        ) : null}

        {overviewNodes.length > 0 ? (
          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <h3>核心观测视图</h3>
            </div>
            {overviewNodes.map((entry) => (
              <div key={entry.node.id} className={styles.overviewCard}>
                <div className={styles.overviewCardHead}>
                  <h3>{entry.title}</h3>
                  <button type="button" className={styles.flowChip} onClick={() => onSelectNode(entry.node.id)}>
                    展开细节 →
                  </button>
                </div>
                {entry.content}
              </div>
            ))}
          </section>
        ) : null}
      </div>
    </aside>
  );
}
