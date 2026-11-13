import { useId, useState } from 'react';
import styles from './TransformShowcase.module.css';

const VIEW_W = 760;
const VIEW_H = 310;
const PLOT = { x: 44, y: 16, w: 690, h: 258 };
const BOUNDS = { minX: -0.3, maxX: 3.2, minY: -0.3, maxY: 2.2 };

function px(x: number): number {
  return PLOT.x + ((x - BOUNDS.minX) / (BOUNDS.maxX - BOUNDS.minX)) * PLOT.w;
}

function py(y: number): number {
  return PLOT.y + PLOT.h - ((y - BOUNDS.minY) / (BOUNDS.maxY - BOUNDS.minY)) * PLOT.h;
}

function fmt(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

const X_TICKS = [0, 0.5, 1, 1.5, 2, 2.5, 3];
const Y_TICKS = [0, 0.5, 1, 1.5, 2];

function MiniPlot({ sheared }: { sheared: boolean }): JSX.Element {
  const width = 220;
  const height = 172;
  const area = { x: 31, y: 15, w: 160, h: 126 };
  const bounds = { minX: -0.15, maxX: 2.2, minY: -0.15, maxY: 2.05 };
  const mapX = (value: number): number => area.x + ((value - bounds.minX) / (bounds.maxX - bounds.minX)) * area.w;
  const mapY = (value: number): number => area.y + area.h - ((value - bounds.minY) / (bounds.maxY - bounds.minY)) * area.h;
  const shape = sheared
    ? `${mapX(0)},${mapY(0)} ${mapX(1)},${mapY(0)} ${mapX(2)},${mapY(1)} ${mapX(1)},${mapY(1)}`
    : `${mapX(0)},${mapY(0)} ${mapX(1)},${mapY(0)} ${mapX(1)},${mapY(1)} ${mapX(0)},${mapY(1)}`;
  const ticks = [0, 1, 2];
  return <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={sheared ? '变换后的平行四边形' : '原单位方格'}>
    {ticks.map((tick) => <g key={tick}>
      <line x1={mapX(tick)} y1={area.y} x2={mapX(tick)} y2={area.y + area.h} stroke="#ece9e2" />
      <line x1={area.x} y1={mapY(tick)} x2={area.x + area.w} y2={mapY(tick)} stroke="#ece9e2" />
    </g>)}
    <line x1={area.x} y1={mapY(0)} x2={area.x + area.w + 8} y2={mapY(0)} stroke="#26334a" strokeWidth={1.1}/>
    <line x1={mapX(0)} y1={area.y + area.h + 6} x2={mapX(0)} y2={area.y - 8} stroke="#26334a" strokeWidth={1.1}/>
    <polygon points={shape} fill="#f0eee8" stroke="#26334a" strokeWidth={1.6}/>
    {ticks.map((tick) => <g key={`x-${tick}`}>
      <text x={mapX(tick)} y={mapY(0) + 14} textAnchor="middle" fontSize={9} fill="#596274">{tick}</text>
      <text x={mapX(0) - 8} y={mapY(tick) + 3} textAnchor="end" fontSize={9} fill="#596274">{tick}</text>
    </g>)}
    <text x={mapX(0) - 12} y={area.y + 2} fontSize={10} fill="#26334a">y</text>
    <text x={area.x + area.w + 14} y={mapY(0) + 4} fontSize={10} fill="#26334a">x</text>
  </svg>;
}

export function TransformShowcase(): JSX.Element {
  const [shear, setShear] = useState(1);
  const [showWork, setShowWork] = useState(false);
  const sliderId = useId();
  const workId = useId();
  const arrowId = useId();
  const imageX = 1 + shear;
  const vertices: Array<[number, number]> = [[0, 0], [1, 0], [imageX, 1], [shear, 1]];
  const transformed = vertices.map(([x, y]) => `${px(x)},${py(y)}`).join(' ');
  const original = ([[0, 0], [1, 0], [1, 1], [0, 1]] as Array<[number, number]>)
    .map(([x, y]) => `${px(x)},${py(y)}`).join(' ');
  const endpointX = px(imageX);
  const endpointY = py(1);
  const labelAnchor = endpointX > VIEW_W - 70 ? 'end' : 'start';
  const labelX = labelAnchor === 'end' ? endpointX - 10 : endpointX + 10;

  return <div className={styles.wrap}>
    <div className={styles.pair}>
      <article className={styles.originalCard} aria-label="原始 PPT 示例页">
        <div className={styles.sourceMeta}><span>原始课件</span><span>PPTX / 06</span></div>
        <h2 className={styles.originalTitle}>二维线性变换</h2>
        <span className={styles.titleRule} aria-hidden="true"/>
        <div className={styles.originalFormula} role="img" aria-label="矩阵 A 等于第一行 1 1，第二行 0 1">
          <span className={styles.mathVar}>A</span><span>=</span>
          <span className={styles.bracket} aria-hidden="true">[</span>
          <span className={styles.matrixCells}><span>1</span><span>1</span><span>0</span><span>1</span></span>
          <span className={styles.bracket} aria-hidden="true">]</span>
        </div>
        <div className={styles.miniPair}>
          <MiniPlot sheared={false}/>
          <span className={styles.miniArrow} aria-hidden="true">→</span>
          <MiniPlot sheared/>
        </div>
        <p className={styles.originalFoot}><span>示例课件 · 第 6 页</span><span aria-hidden="true">→</span></p>
      </article>

      <section className={styles.demoCard} aria-label="可交互的剪切变换示例">
        <header className={styles.demoHead}>
          <div className={styles.demoHeadTop}><span>交互实验 / LIVE CANVAS</span><span className={styles.liveLabel}><i aria-hidden="true" />实时联动</span></div>
          <h2>二维线性变换（剪切变换）</h2>
          <p>
            <span>A = </span>
            <span className={styles.inlineMatrix}>
              <span className={styles.inlineBracket} aria-hidden="true">[</span>
              <span className={styles.inlineCells}><span>1</span><span>{shear.toFixed(1)}</span><span>0</span><span>1</span></span>
              <span className={styles.inlineBracket} aria-hidden="true">]</span>
            </span>
            <span className={styles.mapText}>（1, 1）→（{fmt(imageX)}, 1）</span>
          </p>
        </header>

        <div className={styles.demoBody}>
          <div className={styles.plot}>
            <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} role="img"
              aria-label={`剪切系数 ${shear.toFixed(1)}，单位方格变为平行四边形，面积保持不变`}>
              <defs>
                <marker id={arrowId} viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#ff7a59"/>
                </marker>
              </defs>
              {X_TICKS.map((tick) => <g key={`gx-${tick}`}>
                <line x1={px(tick)} y1={PLOT.y} x2={px(tick)} y2={PLOT.y + PLOT.h} stroke="#e4e1f4" strokeWidth={0.8}/>
                <text x={px(tick)} y={py(0) + 17} textAnchor="middle" fontSize={10} fill="#566074">{tick.toFixed(1)}</text>
              </g>)}
              {Y_TICKS.map((tick) => <g key={`gy-${tick}`}>
                <line x1={PLOT.x} y1={py(tick)} x2={PLOT.x + PLOT.w} y2={py(tick)} stroke="#e4e1f4" strokeWidth={0.8}/>
                <text x={px(0) - 9} y={py(tick) + 4} textAnchor="end" fontSize={10} fill="#566074">{tick.toFixed(1)}</text>
              </g>)}
              <line x1={PLOT.x} y1={py(0)} x2={PLOT.x + PLOT.w + 10} y2={py(0)} stroke="#8a93a6" strokeWidth={1.2}/>
              <line x1={px(0)} y1={PLOT.y + PLOT.h} x2={px(0)} y2={PLOT.y - 10} stroke="#8a93a6" strokeWidth={1.2}/>
              <polygon points={transformed} fill="rgba(255, 122, 89, 0.16)" stroke="#e8552f" strokeWidth={2}/>
              <polygon points={original} fill="none" stroke="#4f46e5" strokeWidth={1.6} strokeDasharray="6 5"/>
              <line x1={px(0)} y1={py(0)} x2={endpointX} y2={endpointY} stroke="#ff7a59" strokeWidth={2.5}
                markerEnd={`url(#${arrowId})`}/>
              <circle cx={endpointX} cy={endpointY} r={4.5} fill="#ff7a59" stroke="#ffffff" strokeWidth={1.5}/>
              <text x={labelX} y={endpointY - 10} textAnchor={labelAnchor} fontSize={12} fontWeight={600} fill="#b8431f">
                ({fmt(imageX)}, 1)
              </text>
              <text x={px(0.08)} y={py(1.14)} fontSize={9.5} fill="#566074">原图</text>
              <text x={px(0.5 + shear / 2)} y={py(0.45)} textAnchor="middle" fontSize={9.5} fill="#b8431f">剪切后</text>
            </svg>
          </div>

          <aside className={styles.demoRail} aria-label="实验参数与结果">
            <p className={styles.controlLabel}><label htmlFor={sliderId}>剪切系数 k</label><button type="button" onClick={() => setShear(1)} disabled={shear === 1} aria-label="重置剪切系数">重置</button></p>
            <div className={styles.controlRow}>
              <input id={sliderId} type="range" min={0} max={2} step={0.1} value={shear}
                aria-label="剪切系数 k" onChange={(event) => setShear(Number(event.target.value))}/>
              <output htmlFor={sliderId}>{shear.toFixed(1)}</output>
            </div>
            <div className={styles.railRule}/>
            <p className={styles.metricLabel}>计算结果</p>
            <p className={styles.metricResult} aria-live="polite">A·x = ({fmt(imageX)}, 1)</p>
            <p className={styles.metricLabel}>面积比</p>
            <p className={`${styles.metricResult} ${styles.areaResult}`}>1.00</p>
            <p className={styles.metricNote}>det A = 1<br />形状改变，面积保持不变。</p>
          </aside>

          {showWork ? <div className={styles.workPanel} id={workId} role="region" aria-label="计算依据">
            <div className={styles.workTitle}>计算依据</div>
            <dl className={styles.workRows}>
              <div><dt>A</dt><dd>[[1, {shear.toFixed(1)}], [0, 1]]</dd></div>
              <div><dt>A·x</dt><dd>(1·1 + {shear.toFixed(1)}·1, 0·1 + 1·1) = ({fmt(imageX)}, 1)</dd></div>
              <div><dt>面积</dt><dd>|det A| · 1 = 1.00</dd></div>
            </dl>
          </div> : null}
        </div>

        <footer className={styles.demoFoot}>
          <span>形状改变，面积保持不变。</span>
          <button type="button" aria-expanded={showWork} aria-controls={workId}
            onClick={() => setShowWork((open) => !open)}>
            {showWork ? '收起计算依据' : '查看计算依据'} <span aria-hidden="true">{showWork ? '↘' : '↗'}</span>
          </button>
        </footer>
      </section>
    </div>
  </div>;
}
