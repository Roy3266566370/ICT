import type {
  ScienceData,
  ScienceFrame,
  ScienceMetric,
  SciencePipelineMap,
  ScienceResult,
  ScienceScene,
} from './sciencePipelineTypes.ts';

const ELEMENTARY_CHARGE = 1.602176634e-19;
const PROTON_MASS = 1.67262192369e-27;
const PARTICLE_FRAME_COUNT = 81;
const CIRCUIT_FRAME_COUNT = 101;

type NumericSeries = { label: string; values: number[] }[];
type NumericRow = (string | number)[];

function finiteParameter(
  parameters: Record<string, number>,
  key: string,
  fallback: number,
): number {
  const value = parameters[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function boundedParameter(
  parameters: Record<string, number>,
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  return Math.min(maximum, Math.max(minimum, finiteParameter(parameters, key, fallback)));
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value === 0) return '0';
  const magnitude = Math.abs(value);
  if (magnitude >= 100000 || magnitude < 0.001) return value.toExponential(5);
  return Number(value.toPrecision(7)).toString();
}

function numericMetric(label: string, value: number, unit = '', emphasis = false): ScienceMetric {
  const formatted = formatNumber(value);
  return {
    label,
    value: unit ? `${formatted} ${unit}` : formatted,
    ...(emphasis ? { emphasis: true } : {}),
  };
}

function scienceData(parameters: Record<string, number>, text: string): ScienceData {
  return { parameters: { ...parameters }, text };
}

function scienceFrame(
  title: string,
  summary: string,
  scene: ScienceScene,
  metrics: ScienceMetric[],
  columns?: string[],
  rows?: NumericRow[],
  series?: NumericSeries,
): ScienceFrame {
  return {
    title,
    summary,
    scene,
    metrics,
    ...(columns ? { columns } : {}),
    ...(rows ? { rows } : {}),
    ...(series ? { series } : {}),
  };
}

interface ChargedParticleParameters extends Record<string, number> {
  mass: number;
  charge: number;
  speed: number;
  electricField: number;
  magneticField: number;
  polarity: number;
}

interface ChargedParticleSample {
  time: number;
  angle: number;
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
}

interface ChargedParticleModel {
  parameters: ChargedParticleParameters;
  selectedSpeed: number;
  selectorPass: boolean;
  radius: number;
  period: number;
  angularFrequency: number;
  magneticForce: number;
  kineticEnergy: number;
  samples: ChargedParticleSample[];
}

function cleanChargedParticleParameters(parameters: Record<string, number>): ChargedParticleParameters {
  return {
    mass: boundedParameter(parameters, 'mass', PROTON_MASS, 1e-30, 1e-24),
    charge: boundedParameter(parameters, 'charge', ELEMENTARY_CHARGE, ELEMENTARY_CHARGE * 0.01, ELEMENTARY_CHARGE * 100),
    speed: boundedParameter(parameters, 'speed', 200000, 1, 1e7),
    electricField: boundedParameter(parameters, 'electricField', 4000, 0, 1e6),
    magneticField: boundedParameter(parameters, 'magneticField', 0.02, 1e-5, 10),
    polarity: finiteParameter(parameters, 'polarity', 1) < 0 ? -1 : 1,
  };
}

function calculateChargedParticle(parameters: Record<string, number>): ChargedParticleModel {
  const cleaned = cleanChargedParticleParameters(parameters);
  const selectedSpeed = cleaned.electricField / cleaned.magneticField;
  const selectorPass = Math.abs(cleaned.speed - selectedSpeed) <= Math.max(1e-9, Math.abs(selectedSpeed) * 0.01);
  const radius = cleaned.mass * cleaned.speed / (cleaned.charge * cleaned.magneticField);
  const angularFrequency = cleaned.charge * cleaned.magneticField / cleaned.mass;
  const period = 2 * Math.PI / angularFrequency;
  const magneticForce = cleaned.charge * cleaned.speed * cleaned.magneticField;
  const kineticEnergy = 0.5 * cleaned.mass * cleaned.speed ** 2;
  const samples = Array.from({ length: PARTICLE_FRAME_COUNT }, (_, index) => {
    const time = period * index / (PARTICLE_FRAME_COUNT - 1);
    const angle = angularFrequency * time;
    return {
      time,
      angle,
      x: radius * Math.sin(angle),
      y: cleaned.polarity * radius * (1 - Math.cos(angle)),
      velocityX: cleaned.speed * Math.cos(angle),
      velocityY: cleaned.polarity * cleaned.speed * Math.sin(angle),
    };
  });
  return {
    parameters: cleaned,
    selectedSpeed,
    selectorPass,
    radius,
    period,
    angularFrequency,
    magneticForce,
    kineticEnergy,
    samples,
  };
}

function chargedParticlePixel(sample: ChargedParticleSample, polarity: number): { x: number; y: number } {
  return {
    x: 205 + 76 * Math.sin(sample.angle),
    y: 120 + 76 * polarity * Math.cos(sample.angle),
  };
}

function chargedParticleOrbitScene(
  model: ChargedParticleModel,
  sample: ChargedParticleSample,
  showForce: boolean,
): ScienceScene {
  const point = chargedParticlePixel(sample, model.parameters.polarity);
  const pathPoints: [number, number][] = model.samples.map((entry) => {
    const pixel = chargedParticlePixel(entry, model.parameters.polarity);
    return [pixel.x, pixel.y];
  });
  const vectors: ScienceScene['vectors'] = [
    {
      x: point.x,
      y: point.y,
      dx: 42 * Math.cos(sample.angle),
      dy: -42 * model.parameters.polarity * Math.sin(sample.angle),
      color: '#38bdf8',
      label: 'v',
    },
  ];
  if (showForce) {
    vectors.push({
      x: point.x,
      y: point.y,
      dx: -42 * Math.sin(sample.angle),
      dy: -42 * model.parameters.polarity * Math.cos(sample.angle),
      color: '#fb7185',
      label: 'F洛',
    });
  }
  return {
    ariaLabel: showForce ? '洛伦兹力始终指向磁场圆轨道圆心' : '带电粒子在匀强磁场中的圆弧轨道',
    grid: true,
    paths: [
      { points: pathPoints, stroke: '#818cf8', strokeWidth: 2, closed: true },
    ],
    vectors,
    points: [
      { x: 205, y: 120, radius: 3, color: '#94a3b8', label: 'O', hollow: true },
      { x: point.x, y: point.y, radius: 6, color: model.parameters.polarity > 0 ? '#f59e0b' : '#38bdf8', label: model.parameters.polarity > 0 ? '+q' : '−q' },
    ],
    labels: [
      { x: 26, y: 28, text: '×  ×  ×  ×  ×  B（垂直纸面向里）', color: '#94a3b8', size: 12 },
      { x: 205, y: 226, text: `R = ${formatNumber(model.radius)} m`, color: '#c4b5fd', size: 12, anchor: 'middle' },
    ],
  };
}

function chargedParticleSelectorScene(model: ChargedParticleModel, progress: number): ScienceScene {
  const x = 42 + 292 * progress;
  const deflectionDirection = model.parameters.speed >= model.selectedSpeed ? 1 : -1;
  const deflection = model.selectorPass ? 0 : model.parameters.polarity * deflectionDirection * 42 * progress ** 2;
  const y = 120 + deflection;
  return {
    ariaLabel: model.selectorPass ? '粒子速度满足选择条件并沿直线通过' : '粒子速度不满足选择条件并发生偏转',
    paths: [
      { points: [[42, 120], [334, 120]], stroke: '#64748b', dashed: true },
      { points: [[42, 120], [x, y]], stroke: model.selectorPass ? '#34d399' : '#fb7185', strokeWidth: 2.5 },
    ],
    vectors: [
      { x, y, dx: 46, dy: 0, color: '#38bdf8', label: 'v' },
      { x: 366, y: 82, dx: 0, dy: 70, color: '#fbbf24', label: 'E' },
    ],
    points: [{ x, y, radius: 6, color: model.selectorPass ? '#34d399' : '#fb7185', label: model.parameters.polarity > 0 ? '+q' : '−q' }],
    rects: [
      { x: 36, y: 61, width: 304, height: 10, fill: '#475569', label: '+ 极板' },
      { x: 36, y: 169, width: 304, height: 10, fill: '#334155', label: '− 极板' },
    ],
    labels: [
      { x: 188, y: 43, text: '×  ×  ×  ×  ×  ×  B', color: '#94a3b8', size: 12, anchor: 'middle' },
      { x: 188, y: 211, text: model.selectorPass ? 'qE = qvB，速度匹配' : 'qE ≠ qvB，不能直线通过', color: model.selectorPass ? '#34d399' : '#fb7185', size: 13, anchor: 'middle' },
    ],
  };
}

function chargedParticleSeries(model: ChargedParticleModel): NumericSeries {
  return [
    { label: '时间 (s)', values: model.samples.map((sample) => sample.time) },
    { label: '轨道 x (m)', values: model.samples.map((sample) => sample.x) },
    { label: '轨道 y (m)', values: model.samples.map((sample) => sample.y) },
    { label: '速度 x (m/s)', values: model.samples.map((sample) => sample.velocityX) },
    { label: '速度 y (m/s)', values: model.samples.map((sample) => sample.velocityY) },
    { label: '动能 (J)', values: model.samples.map(() => model.kineticEnergy) },
  ];
}

type ChargedParticleView = 'selector' | 'orbit' | 'force' | 'summary';

function chargedParticleResult(
  parameters: Record<string, number>,
  text: string,
  view: ChargedParticleView,
): ScienceResult {
  const model = calculateChargedParticle(parameters);
  const series = chargedParticleSeries(model);
  const selectorState = model.selectorPass ? '通过：v = E/B' : '偏转：v ≠ E/B';
  const titles: Record<ChargedParticleView, string> = {
    selector: '速度选择器',
    orbit: '磁场圆周轨道',
    force: '洛伦兹力分析',
    summary: '选择与轨道对照',
  };
  const frames = model.samples.map((sample) => {
    const progress = sample.time / model.period;
    const scene = view === 'selector'
      ? chargedParticleSelectorScene(model, progress)
      : chargedParticleOrbitScene(model, sample, view === 'force');
    let metrics: ScienceMetric[];
    let rows: NumericRow[];
    if (view === 'selector') {
      metrics = [
        numericMetric('实际速度', model.parameters.speed, 'm/s', true),
        numericMetric('筛选速度 E/B', model.selectedSpeed, 'm/s'),
        { label: '选择状态', value: selectorState, emphasis: model.selectorPass },
        numericMetric('电场力大小', model.parameters.charge * model.parameters.electricField, 'N'),
      ];
      rows = [
        ['实际速度', model.parameters.speed, 'm/s'],
        ['筛选速度', model.selectedSpeed, 'm/s'],
        ['相对偏差', (model.parameters.speed - model.selectedSpeed) / Math.max(1, Math.abs(model.selectedSpeed)), ''],
        ['选择状态', selectorState, ''],
      ];
    } else if (view === 'force') {
      metrics = [
        numericMetric('洛伦兹力 |q|vB', model.magneticForce, 'N', true),
        numericMetric('向心加速度', model.magneticForce / model.parameters.mass, 'm/s²'),
        numericMetric('轨道半径', model.radius, 'm'),
        numericMetric('磁场做功', 0, 'J'),
      ];
      rows = [
        ['时刻', sample.time, 's'],
        ['速度 x', sample.velocityX, 'm/s'],
        ['速度 y', sample.velocityY, 'm/s'],
        ['向心力', model.magneticForce, 'N'],
        ['动能', model.kineticEnergy, 'J'],
      ];
    } else {
      metrics = [
        numericMetric('半径 mv/(|q|B)', model.radius, 'm', true),
        numericMetric('周期 2πm/(|q|B)', model.period, 's'),
        numericMetric('角频率', model.angularFrequency, 'rad/s'),
        numericMetric('动能', model.kineticEnergy, 'J'),
      ];
      rows = [
        ['时刻', sample.time, 's'],
        ['位置 x', sample.x, 'm'],
        ['位置 y', sample.y, 'm'],
        ['速率', model.parameters.speed, 'm/s'],
        ['周期', model.period, 's'],
      ];
    }
    return scienceFrame(
      titles[view],
      `${selectorState}；磁场只改变速度方向，不改变动能。`,
      scene,
      metrics,
      ['物理量', '数值', '单位'],
      rows,
      series,
    );
  });
  return { data: scienceData(model.parameters, text), frames };
}

interface RcParameters extends Record<string, number> {
  resistance: number;
  capacitance: number;
  sourceVoltage: number;
  initialVoltage: number;
  mode: number;
}

interface RcSample {
  time: number;
  voltage: number;
  current: number;
  capacitorEnergy: number;
  jouleHeat: number;
  sourceEnergy: number;
  energyResidual: number;
}

interface RcModel {
  parameters: RcParameters;
  timeConstant: number;
  duration: number;
  initialEnergy: number;
  samples: RcSample[];
}

function cleanRcParameters(parameters: Record<string, number>): RcParameters {
  return {
    resistance: boundedParameter(parameters, 'resistance', 1000, 1e-3, 1e9),
    capacitance: boundedParameter(parameters, 'capacitance', 0.001, 1e-9, 1),
    sourceVoltage: boundedParameter(parameters, 'sourceVoltage', 5, 0, 1e6),
    initialVoltage: boundedParameter(parameters, 'initialVoltage', 0, 0, 1e6),
    mode: finiteParameter(parameters, 'mode', 1) < 0.5 ? 0 : 1,
  };
}

function calculateRcCircuit(parameters: Record<string, number>): RcModel {
  const cleaned = cleanRcParameters(parameters);
  const timeConstant = cleaned.resistance * cleaned.capacitance;
  const duration = 5 * timeConstant;
  const initialEnergy = 0.5 * cleaned.capacitance * cleaned.initialVoltage ** 2;
  const samples = Array.from({ length: CIRCUIT_FRAME_COUNT }, (_, index) => {
    const time = duration * index / (CIRCUIT_FRAME_COUNT - 1);
    const decay = Math.exp(-time / timeConstant);
    const doubleDecay = Math.exp(-2 * time / timeConstant);
    const charging = cleaned.mode === 1;
    const voltage = charging
      ? cleaned.sourceVoltage + (cleaned.initialVoltage - cleaned.sourceVoltage) * decay
      : cleaned.initialVoltage * decay;
    const drivingVoltage = charging ? cleaned.sourceVoltage - cleaned.initialVoltage : -cleaned.initialVoltage;
    const current = drivingVoltage / cleaned.resistance * decay;
    const capacitorEnergy = 0.5 * cleaned.capacitance * voltage ** 2;
    const jouleHeat = 0.5 * cleaned.capacitance * drivingVoltage ** 2 * (1 - doubleDecay);
    const sourceEnergy = charging
      ? cleaned.sourceVoltage * cleaned.capacitance * (cleaned.sourceVoltage - cleaned.initialVoltage) * (1 - decay)
      : 0;
    const energyResidual = charging
      ? sourceEnergy - (capacitorEnergy - initialEnergy) - jouleHeat
      : initialEnergy - capacitorEnergy - jouleHeat;
    return { time, voltage, current, capacitorEnergy, jouleHeat, sourceEnergy, energyResidual };
  });
  return { parameters: cleaned, timeConstant, duration, initialEnergy, samples };
}

function rcCircuitScene(model: RcModel, sample: RcSample): ScienceScene {
  const charging = model.parameters.mode === 1;
  const maximumVoltage = Math.max(1e-12, model.parameters.sourceVoltage, model.parameters.initialVoltage);
  const chargeRatio = Math.min(1, Math.abs(sample.voltage) / maximumVoltage);
  const currentDirection = sample.current === 0 ? 0 : Math.sign(sample.current);
  return {
    ariaLabel: charging ? 'RC 充电电路与电容储能状态' : 'RC 放电电路与电容储能状态',
    paths: [
      { points: [[52, 60], [146, 60]], stroke: '#94a3b8', strokeWidth: 2 },
      { points: [[234, 60], [330, 60], [330, 103]], stroke: '#94a3b8', strokeWidth: 2 },
      { points: [[309, 103], [351, 103]], stroke: '#38bdf8', strokeWidth: 3 },
      { points: [[309, 125], [351, 125]], stroke: '#38bdf8', strokeWidth: 3 },
      { points: [[330, 125], [330, 180], [52, 180], [52, 140]], stroke: '#94a3b8', strokeWidth: 2 },
      { points: [[52, 100], [52, 60]], stroke: '#94a3b8', strokeWidth: 2 },
    ],
    vectors: currentDirection === 0 ? [] : [
      { x: 112, y: 43, dx: 44 * currentDirection, dy: 0, color: '#fbbf24', label: 'I' },
    ],
    rects: [
      { x: 146, y: 45, width: 88, height: 30, fill: '#334155', stroke: '#94a3b8', label: 'R' },
      { x: 271, y: 142, width: 18, height: 36 * chargeRatio, fill: '#34d399', opacity: 0.75, label: '储能' },
    ],
    ellipses: [{ cx: 52, cy: 120, rx: 20, ry: 20, fill: '#1e293b', stroke: charging ? '#34d399' : '#64748b', label: charging ? 'U' : 'S' }],
    labels: [
      { x: 365, y: 117, text: 'C', color: '#38bdf8', size: 15 },
      { x: 190, y: 38, text: `R = ${formatNumber(model.parameters.resistance)} Ω`, color: '#cbd5e1', size: 12, anchor: 'middle' },
      { x: 190, y: 214, text: `${charging ? '充电' : '放电'} · τ = RC = ${formatNumber(model.timeConstant)} s`, color: '#c4b5fd', size: 13, anchor: 'middle' },
      { x: 330, y: 91, text: formatNumber(sample.voltage) + ' V', color: '#34d399', size: 11, anchor: 'middle' },
    ],
  };
}

function rcTransientScene(model: RcModel, sample: RcSample): ScienceScene {
  const maximumVoltage = Math.max(1e-12, ...model.samples.map((entry) => Math.abs(entry.voltage)));
  const maximumCurrent = Math.max(1e-12, ...model.samples.map((entry) => Math.abs(entry.current)));
  const voltagePoints: [number, number][] = model.samples.map((entry) => [
    40 + 340 * entry.time / model.duration,
    200 - 165 * entry.voltage / maximumVoltage,
  ]);
  const currentPoints: [number, number][] = model.samples.map((entry) => [
    40 + 340 * entry.time / model.duration,
    120 - 70 * entry.current / maximumCurrent,
  ]);
  const x = 40 + 340 * sample.time / model.duration;
  return {
    ariaLabel: 'RC 电容电压与回路电流随时间变化曲线',
    grid: true,
    axes: true,
    paths: [
      { points: [[40, 120], [380, 120]], stroke: '#475569', dashed: true },
      { points: voltagePoints, stroke: '#34d399', strokeWidth: 2.5, label: 'uC' },
      { points: currentPoints, stroke: '#fbbf24', strokeWidth: 2, label: 'i' },
      { points: [[x, 30], [x, 205]], stroke: '#e2e8f0', dashed: true },
    ],
    points: [
      { x, y: 200 - 165 * sample.voltage / maximumVoltage, radius: 5, color: '#34d399', label: 'uC' },
      { x, y: 120 - 70 * sample.current / maximumCurrent, radius: 5, color: '#fbbf24', label: 'i' },
    ],
    labels: [
      { x: 375, y: 226, text: 't', color: '#94a3b8', size: 12, anchor: 'end' },
      { x: 48, y: 28, text: 'uC', color: '#34d399', size: 12 },
      { x: 84, y: 28, text: 'i（独立归一化）', color: '#fbbf24', size: 12 },
    ],
  };
}

function rcEnergyScene(model: RcModel, sample: RcSample): ScienceScene {
  const maximumEnergy = Math.max(
    1e-12,
    model.initialEnergy,
    ...model.samples.map((entry) => Math.max(entry.capacitorEnergy, entry.jouleHeat)),
  );
  const capacitorPoints: [number, number][] = model.samples.map((entry) => [
    40 + 340 * entry.time / model.duration,
    200 - 165 * entry.capacitorEnergy / maximumEnergy,
  ]);
  const heatPoints: [number, number][] = model.samples.map((entry) => [
    40 + 340 * entry.time / model.duration,
    200 - 165 * entry.jouleHeat / maximumEnergy,
  ]);
  const x = 40 + 340 * sample.time / model.duration;
  return {
    ariaLabel: 'RC 电容储能与电阻焦耳热累计曲线',
    grid: true,
    axes: true,
    paths: [
      { points: capacitorPoints, stroke: '#38bdf8', strokeWidth: 2.5, label: '电容储能' },
      { points: heatPoints, stroke: '#fb7185', strokeWidth: 2.5, label: '焦耳热' },
      { points: [[x, 30], [x, 205]], stroke: '#e2e8f0', dashed: true },
    ],
    points: [
      { x, y: 200 - 165 * sample.capacitorEnergy / maximumEnergy, radius: 5, color: '#38bdf8', label: 'UC' },
      { x, y: 200 - 165 * sample.jouleHeat / maximumEnergy, radius: 5, color: '#fb7185', label: 'Q' },
    ],
    labels: [
      { x: 44, y: 28, text: 'UC = Cu²/2', color: '#38bdf8', size: 12 },
      { x: 148, y: 28, text: 'Q = ∫i²Rdt', color: '#fb7185', size: 12 },
      { x: 375, y: 226, text: 't', color: '#94a3b8', size: 12, anchor: 'end' },
    ],
  };
}

function rcSeries(model: RcModel): NumericSeries {
  return [
    { label: '时间 (s)', values: model.samples.map((sample) => sample.time) },
    { label: '电容电压 (V)', values: model.samples.map((sample) => sample.voltage) },
    { label: '电流 (A)', values: model.samples.map((sample) => sample.current) },
    { label: '电容储能 (J)', values: model.samples.map((sample) => sample.capacitorEnergy) },
    { label: '焦耳热 (J)', values: model.samples.map((sample) => sample.jouleHeat) },
    { label: '电源输出能量 (J)', values: model.samples.map((sample) => sample.sourceEnergy) },
    { label: '能量守恒残差 (J)', values: model.samples.map((sample) => sample.energyResidual) },
  ];
}

type RcView = 'source' | 'transient' | 'energy' | 'balance';

function rcCircuitResult(parameters: Record<string, number>, text: string, view: RcView): ScienceResult {
  const model = calculateRcCircuit(parameters);
  const series = rcSeries(model);
  const charging = model.parameters.mode === 1;
  const titles: Record<RcView, string> = {
    source: 'RC 电路与参数',
    transient: '电压 / 电流暂态',
    energy: '储能与焦耳热',
    balance: '能量守恒对照',
  };
  const frames = model.samples.map((sample) => {
    const scene = view === 'source'
      ? rcCircuitScene(model, sample)
      : view === 'transient'
        ? rcTransientScene(model, sample)
        : rcEnergyScene(model, sample);
    const metrics: ScienceMetric[] = view === 'source'
      ? [
          numericMetric('时间常数 τ', model.timeConstant, 's', true),
          numericMetric('电容电压', sample.voltage, 'V'),
          numericMetric('回路电流（充电为正）', sample.current, 'A'),
          { label: '工作状态', value: charging ? '充电' : '放电' },
        ]
      : view === 'transient'
        ? [
            numericMetric('归一化时刻 t/τ', sample.time / model.timeConstant, '', true),
            numericMetric('电容电压', sample.voltage, 'V'),
            numericMetric('回路电流', sample.current, 'A'),
            numericMetric('时间常数', model.timeConstant, 's'),
          ]
        : [
            numericMetric('电容储能', sample.capacitorEnergy, 'J', true),
            numericMetric('累计焦耳热', sample.jouleHeat, 'J'),
            numericMetric('电源输出能量', sample.sourceEnergy, 'J'),
            numericMetric('守恒残差', sample.energyResidual, 'J'),
          ];
    const rows: NumericRow[] = [
      ['t/τ', sample.time / model.timeConstant, ''],
      ['电容电压', sample.voltage, 'V'],
      ['电流', sample.current, 'A'],
      ['电容储能', sample.capacitorEnergy, 'J'],
      ['焦耳热', sample.jouleHeat, 'J'],
      ['能量守恒残差', sample.energyResidual, 'J'],
    ];
    return scienceFrame(
      titles[view],
      charging
        ? '充电电流取正；电源输出能量等于电容储能增量与电阻焦耳热之和。'
        : '放电电流取负；电容初始储能转化为电容剩余储能与电阻焦耳热。',
      scene,
      metrics,
      ['物理量', '数值', '单位'],
      rows,
      series,
    );
  });
  return { data: scienceData(model.parameters, text), frames };
}

interface MotionalEmfParameters extends Record<string, number> {
  length: number;
  resistance: number;
  mass: number;
  magneticField: number;
  initialSpeed: number;
}

interface MotionalEmfSample {
  time: number;
  speed: number;
  displacement: number;
  emf: number;
  current: number;
  magneticDrag: number;
  kineticEnergy: number;
  jouleHeat: number;
  energyResidual: number;
}

interface MotionalEmfModel {
  parameters: MotionalEmfParameters;
  dampingCoefficient: number;
  timeConstant: number;
  duration: number;
  finalDisplacement: number;
  initialEnergy: number;
  samples: MotionalEmfSample[];
}

function cleanMotionalEmfParameters(parameters: Record<string, number>): MotionalEmfParameters {
  return {
    length: boundedParameter(parameters, 'length', 0.4, 1e-4, 100),
    resistance: boundedParameter(parameters, 'resistance', 2, 1e-6, 1e9),
    mass: boundedParameter(parameters, 'mass', 0.1, 1e-6, 1e6),
    magneticField: boundedParameter(parameters, 'magneticField', 0.5, 1e-6, 100),
    initialSpeed: boundedParameter(parameters, 'initialSpeed', 4, 0, 1e6),
  };
}

function calculateMotionalEmf(parameters: Record<string, number>): MotionalEmfModel {
  const cleaned = cleanMotionalEmfParameters(parameters);
  const dampingCoefficient = cleaned.magneticField ** 2 * cleaned.length ** 2 / cleaned.resistance;
  const timeConstant = cleaned.mass / dampingCoefficient;
  const duration = 5 * timeConstant;
  const finalDisplacement = cleaned.initialSpeed * timeConstant;
  const initialEnergy = 0.5 * cleaned.mass * cleaned.initialSpeed ** 2;
  const samples = Array.from({ length: CIRCUIT_FRAME_COUNT }, (_, index) => {
    const time = duration * index / (CIRCUIT_FRAME_COUNT - 1);
    const decay = Math.exp(-time / timeConstant);
    const speed = cleaned.initialSpeed * decay;
    const displacement = finalDisplacement * (1 - decay);
    const emf = cleaned.magneticField * cleaned.length * speed;
    const current = emf / cleaned.resistance;
    const magneticDrag = dampingCoefficient * speed;
    const kineticEnergy = 0.5 * cleaned.mass * speed ** 2;
    const jouleHeat = initialEnergy - kineticEnergy;
    const energyResidual = initialEnergy - kineticEnergy - jouleHeat;
    return { time, speed, displacement, emf, current, magneticDrag, kineticEnergy, jouleHeat, energyResidual };
  });
  return {
    parameters: cleaned,
    dampingCoefficient,
    timeConstant,
    duration,
    finalDisplacement,
    initialEnergy,
    samples,
  };
}

function motionalDeviceScene(model: MotionalEmfModel, sample: MotionalEmfSample): ScienceScene {
  const travelRatio = model.finalDisplacement > 0 ? sample.displacement / model.finalDisplacement : 0;
  const speedRatio = model.parameters.initialSpeed > 0 ? sample.speed / model.parameters.initialSpeed : 0;
  const rodX = 62 + 260 * travelRatio;
  return {
    ariaLabel: '导体棒切割磁感线并受到反向安培力',
    paths: [
      { points: [[44, 86], [356, 86]], stroke: '#94a3b8', strokeWidth: 3 },
      { points: [[44, 154], [356, 154]], stroke: '#94a3b8', strokeWidth: 3 },
      { points: [[44, 86], [44, 154]], stroke: '#94a3b8', strokeWidth: 3 },
      { points: [[rodX, 86], [rodX, 154]], stroke: '#38bdf8', strokeWidth: 5 },
    ],
    vectors: [
      { x: rodX, y: 61, dx: 62 * speedRatio, dy: 0, color: '#34d399', label: 'v' },
      { x: rodX, y: 181, dx: -62 * speedRatio, dy: 0, color: '#fb7185', label: 'FA' },
      ...(sample.current !== 0 ? [{ x: rodX + 13, y: 140, dx: 0, dy: -38 * speedRatio, color: '#fbbf24', label: 'I' }] : []),
    ],
    rects: [{ x: 28, y: 105, width: 32, height: 30, fill: '#334155', stroke: '#94a3b8', label: 'R' }],
    points: [{ x: rodX, y: 120, radius: 5, color: '#38bdf8', label: 'L' }],
    labels: [
      { x: 104, y: 28, text: '×   ×   ×   ×   ×   ×   B', color: '#94a3b8', size: 13 },
      { x: 200, y: 218, text: `ε = BLv = ${formatNumber(sample.emf)} V`, color: '#c4b5fd', size: 13, anchor: 'middle' },
      { x: 362, y: 126, text: '导轨', color: '#94a3b8', size: 11, anchor: 'end' },
    ],
  };
}

function motionalMotionScene(model: MotionalEmfModel, sample: MotionalEmfSample): ScienceScene {
  const maximumSpeed = Math.max(1e-12, model.parameters.initialSpeed);
  const maximumDisplacement = Math.max(1e-12, model.finalDisplacement);
  const speedPoints: [number, number][] = model.samples.map((entry) => [
    40 + 340 * entry.time / model.duration,
    200 - 165 * entry.speed / maximumSpeed,
  ]);
  const displacementPoints: [number, number][] = model.samples.map((entry) => [
    40 + 340 * entry.time / model.duration,
    200 - 165 * entry.displacement / maximumDisplacement,
  ]);
  const x = 40 + 340 * sample.time / model.duration;
  return {
    ariaLabel: '安培阻力作用下导体棒速度指数衰减且位移趋于极限',
    grid: true,
    axes: true,
    paths: [
      { points: speedPoints, stroke: '#34d399', strokeWidth: 2.5, label: '速度' },
      { points: displacementPoints, stroke: '#818cf8', strokeWidth: 2.5, label: '位移' },
      { points: [[x, 30], [x, 205]], stroke: '#e2e8f0', dashed: true },
    ],
    points: [
      { x, y: 200 - 165 * sample.speed / maximumSpeed, radius: 5, color: '#34d399', label: 'v' },
      { x, y: 200 - 165 * sample.displacement / maximumDisplacement, radius: 5, color: '#818cf8', label: 'x' },
    ],
    labels: [
      { x: 45, y: 28, text: 'v = v₀e⁻ᵗᐟτ', color: '#34d399', size: 12 },
      { x: 157, y: 28, text: 'x = v₀τ(1−e⁻ᵗᐟτ)', color: '#818cf8', size: 12 },
      { x: 375, y: 226, text: 't', color: '#94a3b8', size: 12, anchor: 'end' },
    ],
  };
}

function motionalEnergyScene(model: MotionalEmfModel, sample: MotionalEmfSample): ScienceScene {
  const maximumEnergy = Math.max(1e-12, model.initialEnergy);
  const kineticPoints: [number, number][] = model.samples.map((entry) => [
    40 + 340 * entry.time / model.duration,
    200 - 165 * entry.kineticEnergy / maximumEnergy,
  ]);
  const heatPoints: [number, number][] = model.samples.map((entry) => [
    40 + 340 * entry.time / model.duration,
    200 - 165 * entry.jouleHeat / maximumEnergy,
  ]);
  const x = 40 + 340 * sample.time / model.duration;
  return {
    ariaLabel: '导体棒机械能转化为回路焦耳热',
    grid: true,
    axes: true,
    paths: [
      { points: kineticPoints, stroke: '#38bdf8', strokeWidth: 2.5, label: '机械能' },
      { points: heatPoints, stroke: '#fb7185', strokeWidth: 2.5, label: '焦耳热' },
      { points: [[x, 30], [x, 205]], stroke: '#e2e8f0', dashed: true },
    ],
    points: [
      { x, y: 200 - 165 * sample.kineticEnergy / maximumEnergy, radius: 5, color: '#38bdf8', label: 'K' },
      { x, y: 200 - 165 * sample.jouleHeat / maximumEnergy, radius: 5, color: '#fb7185', label: 'Q' },
    ],
    labels: [
      { x: 44, y: 28, text: 'K = mv²/2', color: '#38bdf8', size: 12 },
      { x: 144, y: 28, text: 'Q = ∫I²Rdt', color: '#fb7185', size: 12 },
      { x: 260, y: 28, text: 'K + Q = K₀', color: '#c4b5fd', size: 12 },
    ],
  };
}

function motionalEmfSeries(model: MotionalEmfModel): NumericSeries {
  return [
    { label: '时间 (s)', values: model.samples.map((sample) => sample.time) },
    { label: '速度 (m/s)', values: model.samples.map((sample) => sample.speed) },
    { label: '位移 (m)', values: model.samples.map((sample) => sample.displacement) },
    { label: '感应电动势 (V)', values: model.samples.map((sample) => sample.emf) },
    { label: '感应电流 (A)', values: model.samples.map((sample) => sample.current) },
    { label: '安培阻力 (N)', values: model.samples.map((sample) => sample.magneticDrag) },
    { label: '机械能 (J)', values: model.samples.map((sample) => sample.kineticEnergy) },
    { label: '焦耳热 (J)', values: model.samples.map((sample) => sample.jouleHeat) },
    { label: '能量守恒残差 (J)', values: model.samples.map((sample) => sample.energyResidual) },
  ];
}

type MotionalEmfView = 'source' | 'current' | 'motion' | 'energy';

function motionalEmfResult(
  parameters: Record<string, number>,
  text: string,
  view: MotionalEmfView,
): ScienceResult {
  const model = calculateMotionalEmf(parameters);
  const series = motionalEmfSeries(model);
  const titles: Record<MotionalEmfView, string> = {
    source: '动生电动势',
    current: '感应电流与安培阻力',
    motion: '速度衰减与位移',
    energy: '机械能与焦耳热',
  };
  const frames = model.samples.map((sample) => {
    const scene = view === 'motion'
      ? motionalMotionScene(model, sample)
      : view === 'energy'
        ? motionalEnergyScene(model, sample)
        : motionalDeviceScene(model, sample);
    const metrics: ScienceMetric[] = view === 'source'
      ? [
          numericMetric('感应电动势 BLv', sample.emf, 'V', true),
          numericMetric('导体棒速度', sample.speed, 'm/s'),
          numericMetric('磁感应强度', model.parameters.magneticField, 'T'),
          numericMetric('导体棒长度', model.parameters.length, 'm'),
        ]
      : view === 'current'
        ? [
            numericMetric('感应电流 BLv/R', sample.current, 'A', true),
            numericMetric('安培阻力 B²L²v/R', sample.magneticDrag, 'N'),
            numericMetric('焦耳功率 I²R', sample.current ** 2 * model.parameters.resistance, 'W'),
            numericMetric('速度衰减时间常数', model.timeConstant, 's'),
          ]
        : view === 'motion'
          ? [
              numericMetric('速度', sample.speed, 'm/s', true),
              numericMetric('位移', sample.displacement, 'm'),
              numericMetric('t/τ', sample.time / model.timeConstant),
              numericMetric('极限滑行距离', model.finalDisplacement, 'm'),
            ]
          : [
              numericMetric('剩余机械能', sample.kineticEnergy, 'J', true),
              numericMetric('累计焦耳热', sample.jouleHeat, 'J'),
              numericMetric('初始机械能', model.initialEnergy, 'J'),
              numericMetric('能量守恒残差', sample.energyResidual, 'J'),
            ];
    const rows: NumericRow[] = [
      ['t/τ', sample.time / model.timeConstant, ''],
      ['速度', sample.speed, 'm/s'],
      ['位移', sample.displacement, 'm'],
      ['感应电动势', sample.emf, 'V'],
      ['感应电流', sample.current, 'A'],
      ['安培阻力', sample.magneticDrag, 'N'],
      ['机械能', sample.kineticEnergy, 'J'],
      ['焦耳热', sample.jouleHeat, 'J'],
    ];
    const summary = model.parameters.initialSpeed === 0
      ? '导体棒初始静止，感应电动势、电流与焦耳热均为零。'
      : '安培力始终与速度反向；减少的机械能全部转化为回路焦耳热。';
    return scienceFrame(
      titles[view],
      summary,
      scene,
      metrics,
      ['物理量', '数值', '单位'],
      rows,
      series,
    );
  });
  return { data: scienceData(model.parameters, text), frames };
}

export const physicsEmPipelines: SciencePipelineMap = {
  'charged-particle': {
    stages: [
      {
        id: 'particle-selector',
        title: '速度选择',
        diagram: 'source',
        text: '调节粒子速度与场强，观察 v=E/B 的筛选条件。',
        controls: [
          { key: 'mass', label: '粒子质量 m (kg)', value: PROTON_MASS, min: 1e-30, max: 1e-24, step: 1e-28 },
          { key: 'charge', label: '电荷量大小 |q| (C)', value: ELEMENTARY_CHARGE, min: ELEMENTARY_CHARGE * 0.01, max: ELEMENTARY_CHARGE * 100, step: ELEMENTARY_CHARGE },
          { key: 'polarity', label: '电荷符号', value: 1, options: [{ value: 1, label: '正电荷' }, { value: -1, label: '负电荷' }] },
          { key: 'speed', label: '入射速度 v (m/s)', value: 200000, min: 1, max: 1e7, step: 1000 },
          { key: 'electricField', label: '选择器电场 E (V/m)', value: 4000, min: 0, max: 1e6, step: 100 },
          { key: 'magneticField', label: '磁感应强度 B (T)', value: 0.02, min: 1e-5, max: 10, step: 0.001 },
        ],
        presets: [
          {
            label: '质子速度匹配',
            params: { mass: PROTON_MASS, charge: ELEMENTARY_CHARGE, polarity: 1, speed: 200000, electricField: 4000, magneticField: 0.02 },
          },
          {
            label: '速度偏快',
            params: { mass: PROTON_MASS, charge: ELEMENTARY_CHARGE, polarity: 1, speed: 300000, electricField: 4000, magneticField: 0.02 },
          },
        ],
        run: ({ text, params }) => chargedParticleResult(params, text, 'selector'),
      },
      {
        id: 'particle-orbit',
        title: '磁场轨道',
        diagram: 'motion',
        inputs: ['particle-selector'],
        run: ({ text, params }) => chargedParticleResult(params, text, 'orbit'),
      },
      {
        id: 'particle-lorentz',
        title: '洛伦兹力',
        diagram: 'force',
        inputs: ['particle-orbit'],
        run: ({ text, params }) => chargedParticleResult(params, text, 'force'),
      },
      {
        id: 'particle-summary',
        title: '半径周期对照',
        diagram: 'summary',
        inputs: ['particle-lorentz'],
        run: ({ text, params }) => chargedParticleResult(params, text, 'summary'),
      },
    ],
  },
  'rc-circuit': {
    stages: [
      {
        id: 'rc-source',
        title: 'RC 电路源',
        diagram: 'source',
        text: '切换充电或放电，观察 τ=RC 如何决定暂态。',
        controls: [
          { key: 'mode', label: '电路状态', value: 1, options: [{ value: 1, label: '充电' }, { value: 0, label: '放电' }] },
          { key: 'resistance', label: '电阻 R (Ω)', value: 1000, min: 1e-3, max: 1e9, step: 100 },
          { key: 'capacitance', label: '电容 C (F)', value: 0.001, min: 1e-9, max: 1, step: 0.0001 },
          { key: 'sourceVoltage', label: '电源电压 Us (V)', value: 5, min: 0, max: 1e6, step: 0.1 },
          { key: 'initialVoltage', label: '初始电容电压 U₀ (V)', value: 0, min: 0, max: 1e6, step: 0.1 },
        ],
        presets: [
          { label: '5 V 充电', params: { mode: 1, resistance: 1000, capacitance: 0.001, sourceVoltage: 5, initialVoltage: 0 } },
          { label: '5 V 放电', params: { mode: 0, resistance: 1000, capacitance: 0.001, sourceVoltage: 5, initialVoltage: 5 } },
        ],
        run: ({ text, params }) => rcCircuitResult(params, text, 'source'),
      },
      {
        id: 'rc-transient',
        title: '电压电流',
        diagram: 'circuit',
        inputs: ['rc-source'],
        run: ({ text, params }) => rcCircuitResult(params, text, 'transient'),
      },
      {
        id: 'rc-energy',
        title: '储能与焦耳热',
        diagram: 'energy',
        inputs: ['rc-transient'],
        run: ({ text, params }) => rcCircuitResult(params, text, 'energy'),
      },
      {
        id: 'rc-balance',
        title: '能量守恒对照',
        diagram: 'summary',
        inputs: ['rc-energy'],
        run: ({ text, params }) => rcCircuitResult(params, text, 'balance'),
      },
    ],
  },
  'motional-emf': {
    stages: [
      {
        id: 'motional-source',
        title: '切割磁感线',
        diagram: 'source',
        text: '让导体棒在导轨上运动，观察动生电动势与能量转化。',
        controls: [
          { key: 'length', label: '导体棒长度 L (m)', value: 0.4, min: 1e-4, max: 100, step: 0.05 },
          { key: 'resistance', label: '回路电阻 R (Ω)', value: 2, min: 1e-6, max: 1e9, step: 0.1 },
          { key: 'mass', label: '导体棒质量 m (kg)', value: 0.1, min: 1e-6, max: 1e6, step: 0.01 },
          { key: 'magneticField', label: '磁感应强度 B (T)', value: 0.5, min: 1e-6, max: 100, step: 0.05 },
          { key: 'initialSpeed', label: '初速度 v₀ (m/s)', value: 4, min: 0, max: 1e6, step: 0.1 },
        ],
        presets: [
          { label: '标准阻尼滑行', params: { length: 0.4, resistance: 2, mass: 0.1, magneticField: 0.5, initialSpeed: 4 } },
          { label: '强磁场快速阻尼', params: { length: 0.4, resistance: 2, mass: 0.1, magneticField: 1.5, initialSpeed: 4 } },
        ],
        run: ({ text, params }) => motionalEmfResult(params, text, 'source'),
      },
      {
        id: 'motional-current',
        title: '电流与安培力',
        diagram: 'induction',
        inputs: ['motional-source'],
        run: ({ text, params }) => motionalEmfResult(params, text, 'current'),
      },
      {
        id: 'motional-motion',
        title: '速度与位移',
        diagram: 'motion',
        inputs: ['motional-current'],
        run: ({ text, params }) => motionalEmfResult(params, text, 'motion'),
      },
      {
        id: 'motional-energy',
        title: '焦耳热与守恒',
        diagram: 'energy',
        inputs: ['motional-motion'],
        run: ({ text, params }) => motionalEmfResult(params, text, 'energy'),
      },
    ],
  },
};