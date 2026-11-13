import { useEffect, useMemo, useRef, useState } from 'react';
import Formula from './Formula';
import SurfaceCanvas from './SurfaceCanvas';
import { LabSlider, Segmented, Stat } from './controls';
import {
  FIELD_OPTIONS,
  SCALAR_OPTIONS,
  bandArea,
  cumulativeAt,
  exactCumulative,
  exactIntegral,
  findField,
  findScalar,
  formatNumber,
  formatSigned,
  relativeError,
  riemannBands,
  sliceRadius,
  type FieldKey,
  type IntegralKind,
  type ScalarKey,
} from './surfaceMath';
import styles from './surfaceIntegral.module.css';

function CumulativeChart({
  R,
  h,
  bands,
  kind,
  scalarKey,
  fieldKey,
  orientation,
  exact,
}: {
  R: number;
  h: number;
  bands: ReturnType<typeof riemannBands>;
  kind: IntegralKind;
  scalarKey: ScalarKey;
  fieldKey: FieldKey;
  orientation: 1 | -1;
  exact: number;
}): JSX.Element {
  const width = 680;
  const height = 184;
  const plot = { x: 52, y: 18, w: width - 76, h: height - 50 };
  const samples = 90;
  const exactPoints = Array.from({ length: samples + 1 }, (_, index) => {
    const z = -R + (2 * R * index) / samples;
    return { z, value: exactCumulative(kind, scalarKey, fieldKey, R, z, orientation) };
  });
  const values = [
    ...exactPoints.map((point) => point.value),
    ...bands.map((band) => band.cumulative),
    0,
  ];
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (max - min < 1e-9) {
    min -= 1;
    max += 1;
  }
  const pad = (max - min) * 0.15;
  min -= pad;
  max += pad;
  const px = (z: number): number => plot.x + ((z + R) / (2 * R)) * plot.w;
  const py = (value: number): number => plot.y + plot.h - ((value - min) / (max - min)) * plot.h;

  const exactPath = exactPoints
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${px(point.z).toFixed(2)},${py(point.value).toFixed(2)}`)
    .join(' ');
  let stepPath = `M${px(-R).toFixed(2)},${py(0).toFixed(2)}`;
  let current = 0;
  for (const band of bands) {
    const zStart = band.zMid - band.dz / 2;
    const zEnd = band.zMid + band.dz / 2;
    stepPath += ` L${px(zStart).toFixed(2)},${py(current).toFixed(2)}`;
    stepPath += ` L${px(zEnd).toFixed(2)},${py(band.cumulative).toFixed(2)}`;
    current = band.cumulative;
  }
  const currentExact = exactCumulative(kind, scalarKey, fieldKey, R, h, orientation);
  const currentApprox = cumulativeAt(bands, h);
  const zeroY = py(0);

  return (
    <div className={styles.chart}>
      <div className={styles.chartHead}>
        <div>
          <h3>沿 z 累积</h3>
          <p>移动截面，两条曲线分别给出精确累积与 {bands.length} 个环带的离散累加。</p>
        </div>
        <div className={styles.legend}>
          <span data-kind="exact"><i/>精确 I(z)</span>
          <span data-kind="approx"><i/>离散 ΣΔI</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="曲面积分沿高度的累积曲线">
        <rect x={plot.x} y={plot.y} width={plot.w} height={plot.h} className={styles.chartBg}/>
        {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
          const y = plot.y + plot.h * tick;
          return <line key={tick} x1={plot.x} y1={y} x2={plot.x + plot.w} y2={y} className={styles.chartGrid}/>;
        })}
        {[-R, 0, R].map((tick) => (
          <g key={tick}>
            <line x1={px(tick)} y1={plot.y} x2={px(tick)} y2={plot.y + plot.h} className={styles.chartGrid}/>
            <text x={px(tick)} y={plot.y + plot.h + 16} textAnchor="middle" className={styles.chartTick}>
              {tick.toFixed(1)}
            </text>
          </g>
        ))}
        {zeroY >= plot.y && zeroY <= plot.y + plot.h ? (
          <line x1={plot.x} y1={zeroY} x2={plot.x + plot.w} y2={zeroY} className={styles.chartZero}/>
        ) : null}
        <text x={plot.x - 8} y={plot.y + 8} textAnchor="end" className={styles.chartTick}>{formatNumber(max, 1)}</text>
        <text x={plot.x - 8} y={plot.y + plot.h} textAnchor="end" className={styles.chartTick}>{formatNumber(min, 1)}</text>
        <path d={exactPath} className={styles.exactLine}/>
        <path d={stepPath} className={styles.stepLine}/>
        <line x1={px(h)} y1={plot.y} x2={px(h)} y2={plot.y + plot.h} className={styles.sliceLine}/>
        <circle cx={px(h)} cy={py(currentExact)} r={4.2} className={styles.exactDot}/>
        <circle cx={px(h)} cy={py(currentApprox)} r={4.2} className={styles.approxDot}/>
        <text x={px(h)} y={plot.y - 5} textAnchor="middle" className={styles.sliceLabel}>
          h = {h.toFixed(2)}
        </text>
        <text x={plot.x + 4} y={plot.y + plot.h + 30} className={styles.chartTick}>z = −R</text>
        <text x={plot.x + plot.w} y={plot.y + plot.h + 30} textAnchor="end" className={styles.chartTick}>z = R · 精确值 {formatNumber(exact, 3)}</text>
      </svg>
    </div>
  );
}

export function SurfaceIntegralLab(): JSX.Element {
  const [kind, setKind] = useState<IntegralKind>('scalar');
  const [scalarKey, setScalarKey] = useState<ScalarKey>('z2');
  const [fieldKey, setFieldKey] = useState<FieldKey>('axial');
  const [R, setR] = useState(1);
  const [h, setH] = useState(0.2);
  const [slices, setSlices] = useState(12);
  const [orientation, setOrientation] = useState<1 | -1>(1);
  const [playing, setPlaying] = useState(false);
  const hRef = useRef(h);
  hRef.current = h;

  useEffect(() => {
    setH((current) => Math.max(-R * 0.999, Math.min(R * 0.999, current)));
  }, [R]);

  useEffect(() => {
    if (!playing) return undefined;
    const timer = window.setInterval(() => {
      const step = (2 * R * 0.999) / 120;
      const next = hRef.current + step;
      if (next >= R * 0.999) {
        setH(R * 0.999);
        setPlaying(false);
      } else {
        setH(next);
      }
    }, 50);
    return () => window.clearInterval(timer);
  }, [playing, R]);

  const bands = useMemo(
    () => riemannBands(kind, scalarKey, fieldKey, R, slices, orientation),
    [kind, scalarKey, fieldKey, R, slices, orientation],
  );
  const exact = exactIntegral(kind, scalarKey, fieldKey, R, orientation);
  const approx = bands[bands.length - 1]?.cumulative ?? 0;
  const cumulative = cumulativeAt(bands, h);
  const exactCumulativeValue = exactCumulative(kind, scalarKey, fieldKey, R, h, orientation);
  const activeIndex = Math.min(
    slices - 1,
    Math.max(0, Math.floor(((h + R) / (2 * R)) * slices)),
  );
  const activeBand = bands[activeIndex];
  const activeValue = activeBand?.contribution ?? 0;
  const deltaZ = (2 * R) / slices;
  const area = bandArea(R, deltaZ);
  const radius = sliceRadius(R, h);
  const error = relativeError(approx, exact);
  const scalar = findScalar(scalarKey);
  const field = findField(fieldKey);
  const activeScalarValue = scalar.valueAt(activeBand?.zMid ?? h, R);
  const activeFluxValue = orientation * field.normalDot(activeBand?.zMid ?? h, R);
  const activeDensity = kind === 'scalar' ? activeScalarValue : activeFluxValue;

  const restartPlay = (): void => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (h >= R * 0.99) setH(-R * 0.999);
    setPlaying(true);
  };

  const scalarCardActive = kind === 'scalar';
  const fluxCardActive = kind === 'flux';

  return (
    <article className={styles.lab} aria-labelledby="surface-lab-title">
      <header className={styles.labHeader}>
        <div className={styles.headerText}>
          <p className={styles.kicker}>数学 · 曲面积分</p>
          <h2 id="surface-lab-title">把球面切成环带，移动截面看积分如何累加</h2>
          <p className={styles.lead}>
            球面被水平截面切成一条条环带。移动截面，读出当前环带的被积函数与面积微元，
            再把它们沿 z 方向累加；第一类曲面积分与第二类曲面积分用的是同一组环带。
          </p>
        </div>
        <div className={styles.headerBadge}>
          <span>Σ : x² + y² + z² = R²</span>
          <strong>dS = 2πR dz</strong>
        </div>
      </header>

      <div className={styles.grid}>
        <div className={styles.stage}>
          <SurfaceCanvas
            R={R}
            h={h}
            kind={kind}
            scalarKey={scalarKey}
            fieldKey={fieldKey}
            orientation={orientation}
            onMoveSlice={(value) => {
              setPlaying(false);
              setH(value);
            }}
          />
          <div className={styles.stageBar}>
            <div className={styles.stagePrompt}>
              <span className={styles.pulseDot} aria-hidden="true"/>
              <span>
                截面高度 <strong>z = {h.toFixed(2)}</strong> · 半径 <strong>{radius.toFixed(3)}</strong>
              </span>
            </div>
            <div className={styles.stageActions}>
              <button type="button" className={styles.primaryButton} onClick={restartPlay}>
                {playing ? '暂停累加' : '播放累加'}
              </button>
              <button
                type="button"
                className={styles.ghostButton}
                onClick={() => {
                  setPlaying(false);
                  setH(0.2);
                }}
              >
                重置截面
              </button>
            </div>
          </div>

          <div className={styles.metrics}>
            <Stat
              label="截面圆半径"
              value={radius.toFixed(3)}
              note={`r = √(R² − h²) = √(${(R * R).toFixed(2)} − ${(h * h).toFixed(2)})`}
            />
            <Stat
              label="当前环带面积"
              value={formatNumber(area, 3)}
              note={`2πRΔz，Δz = ${deltaZ.toFixed(3)}`}
            />
            <Stat
              label="当前累积"
              value={formatNumber(cumulative, 3)}
              note={`精确累积 ${formatNumber(exactCumulativeValue, 3)}`}
              tone="accent"
            />
            <Stat
              label={kind === 'scalar' ? '第一类积分精确值' : '第二类积分精确值'}
              value={formatNumber(exact, 3)}
              note={
                error === null
                  ? `离散值 ${formatNumber(approx, 3)} · 精确值为 0`
                  : `${slices} 片离散值 ${formatNumber(approx, 3)} · 相对误差 ${(error * 100).toFixed(2)}%`
              }
              tone="good"
            />
          </div>

          <CumulativeChart
            R={R}
            h={h}
            bands={bands}
            kind={kind}
            scalarKey={scalarKey}
            fieldKey={fieldKey}
            orientation={orientation}
            exact={exact}
          />
        </div>

        <aside className={styles.rail}>
          <section className={styles.controlPanel} aria-label="曲面与截面参数">
            <div className={styles.panelHead}>
              <h3>曲面与截面</h3>
              <span>同一组参数驱动图、公式与数值</span>
            </div>
            <LabSlider
              label="截面高度 h"
              value={h}
              min={-R * 0.999}
              max={R * 0.999}
              step={0.01}
              onChange={(value) => {
                setPlaying(false);
                setH(value);
              }}
              format={(value) => value.toFixed(2)}
              hint="拖动橙色圆点或滑块；截面从球底移到球顶，累积值随之增长。"
            />
            <LabSlider
              label="球半径 R"
              value={R}
              min={0.6}
              max={1.4}
              step={0.05}
              onChange={setR}
              format={(value) => value.toFixed(2)}
              hint="改变半径，截面圆、环带面积和积分值同时变化。"
            />
            <LabSlider
              label="环带数量 n"
              value={slices}
              min={6}
              max={60}
              step={2}
              onChange={setSlices}
              format={(value) => `${value} 片`}
              hint="n 越大，离散累加越接近精确积分；误差显示在左侧指标卡。"
            />
          </section>

          <section className={styles.formulaCards} aria-label="两类曲面积分">
            <article className={styles.formulaCard} data-active={scalarCardActive || undefined}>
              <div className={styles.formulaCardHead}>
                <div>
                  <span className={styles.cardTag}>第一类 · 对面积</span>
                  <h3>∬<sub>Σ</sub> f dS</h3>
                </div>
                <button
                  type="button"
                  className={styles.activate}
                  aria-pressed={scalarCardActive}
                  onClick={() => setKind('scalar')}
                >
                  {scalarCardActive ? '正在演示' : '切换到此式'}
                </button>
              </div>
              <Formula
                block
                tex={String.raw`\iint_{\Sigma} f(x,y,z)\,dS=\int_{-R}^{R} f(z)\cdot 2\pi R\,dz`}
                className={styles.formula}
              />
              <Segmented
                label="第一类被积函数"
                value={scalarKey}
                options={SCALAR_OPTIONS.map((option) => ({ value: option.key, label: option.label.split('（')[0]!, detail: option.meaning }))}
                onChange={(value) => {
                  setKind('scalar');
                  setScalarKey(value);
                }}
              />
              <p className={styles.formulaMeaning}>{scalar.meaning}</p>
              <dl className={styles.formulaFacts}>
                <div><dt>当前 f</dt><dd><Formula tex={scalar.tex}/></dd></div>
                <div><dt>精确值</dt><dd><Formula tex={scalar.exactTex}/> = {formatNumber(scalar.exact(R), 3)}</dd></div>
                <div><dt>环带贡献</dt><dd>f(z)·2πR·Δz = {formatNumber(activeDensity, 3)} × {formatNumber(area, 3)}</dd></div>
              </dl>
            </article>

            <article className={styles.formulaCard} data-active={fluxCardActive || undefined}>
              <div className={styles.formulaCardHead}>
                <div>
                  <span className={styles.cardTag}>第二类 · 对坐标 / 通量</span>
                  <h3>∬<sub>Σ</sub> F · n dS</h3>
                </div>
                <button
                  type="button"
                  className={styles.activate}
                  aria-pressed={fluxCardActive}
                  onClick={() => setKind('flux')}
                >
                  {fluxCardActive ? '正在演示' : '切换到此式'}
                </button>
              </div>
              <Formula
                block
                tex={String.raw`\iint_{\Sigma}\mathbf F\cdot\mathbf n\,dS=\int_{-R}^{R}\big(\mathbf F\cdot\mathbf n\big)(z)\;2\pi R\,dz`}
                className={styles.formula}
              />
              <div className={styles.fluxControls}>
                <Segmented
                  label="第二类向量场"
                  value={fieldKey}
                  options={FIELD_OPTIONS.map((option) => ({ value: option.key, label: option.label.replace('F = ', ''), detail: option.meaning }))}
                  onChange={(value) => {
                    setKind('flux');
                    setFieldKey(value);
                  }}
                />
                <Segmented
                  label="曲面方向"
                  value={orientation === 1 ? 'out' : 'in'}
                  options={[
                    { value: 'out', label: '外法向 +' },
                    { value: 'in', label: '内法向 −' },
                  ]}
                  onChange={(value) => {
                    setKind('flux');
                    setOrientation(value === 'out' ? 1 : -1);
                  }}
                />
              </div>
              <p className={styles.formulaMeaning}>{field.meaning}</p>
              <dl className={styles.formulaFacts}>
                <div><dt>当前 F·n</dt><dd>{formatNumber(activeFluxValue, 3)}（{orientation === 1 ? '外法向' : '内法向'}）</dd></div>
                <div><dt>精确值</dt><dd>{orientation === 1 ? '' : '−'}<Formula tex={field.exactTex}/> = {formatNumber(exact, 3)}</dd></div>
                <div><dt>散度校验</dt><dd>∇·F = {fieldKey === 'radial' ? '3' : fieldKey === 'axial' ? '1' : '0'}，∭<sub>Ω</sub> ∇·F dV = {formatNumber(field.exact(R), 3)}</dd></div>
              </dl>
            </article>
          </section>

          <section className={styles.microPanel} aria-label="当前环带的积分微元">
            <div className={styles.microHead}>
              <h3>当前环带 ΔI</h3>
              <span>第 {activeIndex + 1} / {slices} 片</span>
            </div>
            <Formula
              block
              tex={
                kind === 'scalar'
                  ? String.raw`\Delta I_i \approx f(z_i)\,2\pi R\,\Delta z = ${formatNumber(activeDensity, 3)}\times ${formatNumber(area, 3)} = ${formatSigned(activeValue, 3)}`
                  : String.raw`\Delta \Phi_i \approx \mathbf F\cdot\mathbf n\,(z_i)\,2\pi R\,\Delta z = ${formatNumber(activeDensity, 3)}\times ${formatNumber(area, 3)} = ${formatSigned(activeValue, 3)}`
              }
              className={styles.microFormula}
            />
            <div className={styles.microRows}>
              <span>z<sub>i</sub> = {formatNumber(activeBand?.zMid ?? h, 3)}</span>
              <span>Δz = {formatNumber(deltaZ, 3)}</span>
              <span>Σ 到此处 = {formatNumber(cumulative, 3)}</span>
            </div>
          </section>
        </aside>
      </div>

      <section className={styles.derivation} aria-labelledby="surface-derivation-title">
        <div className={styles.derivationHead}>
          <h3 id="surface-derivation-title">公式从哪里来</h3>
          <p>两条推导都只用到球面的旋转对称性，因此可以把二重积分压成一元积分。</p>
        </div>
        <div className={styles.derivationGrid}>
          <article>
            <h4>1. 球面参数化与面积微元</h4>
            <Formula
              block
              tex={String.raw`\mathbf r(\theta,\varphi)=\big(R\sin\varphi\cos\theta,\;R\sin\varphi\sin\theta,\;R\cos\varphi\big),\quad \varphi\in[0,\pi]`}
            />
            <Formula
              block
              tex={String.raw`dS=|\mathbf r_\theta\times\mathbf r_\varphi|\,d\theta\,d\varphi=R^2\sin\varphi\,d\theta\,d\varphi`}
            />
            <p>
              取 <Formula tex={String.raw`z=R\cos\varphi`}/>，则 <Formula tex={String.raw`dz=-R\sin\varphi\,d\varphi`}/>，
              所以 <Formula tex={String.raw`dS=R\,d\theta\,|dz|`}/>。对 <Formula tex={String.raw`\theta`}/> 积分一周得
              <strong> 2πR dz</strong>：同一高度上的环带面积只与厚度有关，与 z 无关（阿基米德帽盒定理）。
            </p>
          </article>
          <article>
            <h4>2. 第二类与第一类的关系</h4>
            <Formula
              block
              tex={String.raw`\iint_{\Sigma}P\,dy\,dz+Q\,dz\,dx+R\,dx\,dy=\iint_{\Sigma}\mathbf F\cdot\mathbf n\,dS`}
            />
            <p>
              其中 <Formula tex={String.raw`\mathbf F=(P,Q,R)`}/>，
              <Formula tex={String.raw`\mathbf n`}/> 为单位法向。球面外法向为
              <Formula tex={String.raw`\mathbf n=(x,y,z)/R`}/>；
              换成内法向时每一项都变号。
            </p>
            <p>
              当前 <Formula tex={field.tex}/>，在高度 z 的环带上
              <Formula tex={String.raw`\mathbf F\cdot\mathbf n=${formatNumber(activeFluxValue, 3)}`}/>
              （截面上取代表值），所以通量微元是
              <Formula tex={String.raw`\mathbf F\cdot\mathbf n\,2\pi R\,dz`}/>。
            </p>
          </article>
          <article>
            <h4>3. 用散度定理独立校验</h4>
            <Formula
              block
              tex={String.raw`\iint_{\Sigma}\mathbf F\cdot\mathbf n\,dS=\iiint_{\Omega}\nabla\cdot\mathbf F\,dV`}
            />
            <p>
              球体体积 <Formula tex={String.raw`V=\tfrac{4}{3}\pi R^3`}/>。
              轴向场 <Formula tex={String.raw`\nabla\cdot\mathbf F=1`}/> 给出 <Formula tex={String.raw`\tfrac{4}{3}\pi R^3`}/>；
              径向场散度为 3，给出 <Formula tex={String.raw`4\pi R^3`}/>；
              常场散度为 0，上下半球通量相消，净通量为 0。左侧积分卡中的精确值与这些结果一致。
            </p>
          </article>
        </div>
      </section>
    </article>
  );
}

export default SurfaceIntegralLab;
