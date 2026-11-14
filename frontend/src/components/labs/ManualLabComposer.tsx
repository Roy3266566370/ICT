import { useRef, useState } from 'react';
import { calculusCatalog } from '@/labs/calculusCatalog';
import { doubleIntegralExamples, doubleIntegralExample } from '@/labs/doubleIntegralExamples';
import { tripleIntegralExamples, tripleIntegralExample } from '@/labs/tripleIntegralExamples';
import { useNavigate } from 'react-router-dom';
import { createManualLab, previewManualLab } from '@/api/labs';
import { errorMessage } from '@/api/client';
import { manualConditions, manualInputError, manualInputKey,
  SPACE_KIND_FIELDS, SPACE_SURFACE_KINDS,
  CURVE_SURFACE_KIND_FIELDS, CURVE_SURFACE_SCALAR_KINDS,
  CURVE_SURFACE_ORIENTATIONS, CURVE_SURFACE_KIND_LABELS,
  PROOF_KIND_LABELS, PROOF_SINGLE_KINDS, PROOF_BOUND_KINDS, PROOF_RELATION_KINDS,
  type ManualIntegralDraft, type ManualIntegralPreview, type SpaceGeometryKind,
  type CurveSurfaceIntegralKind, type ProofKind } from '@/labs/manualInput';
import { MathExpressionInput, MathKeyboard, type MathKeyboardHandle } from './MathExpressionInput';
import { Formula } from '@/components/showcase/Formula';
import styles from './ManualLabComposer.module.css';

const EMPTY: ManualIntegralDraft = { task: 'integral', expression: '', variable: 'x', lower: '', upper: '', point: '', order: '1', side: 'both', valueMode: 'expression', pointValue: '', intervalType: 'closed', indexStart: '', powerGoal: 'radius', powerCenter: '', spaceKind: 'vector_operations', spaceA: '', spaceB: '', spaceC: '', spaceD: '', integralKind: 'line_scalar', curveX: '', curveY: '', curveZ: '', surfaceZ: '', surfaceX: '', surfaceY: '', surfaceZuv: '', fieldP: '', fieldQ: '', fieldR: '', integralOrientation: 'forward', proofKind: 'ivt_root', proofLeft: '', proofRight: '', proofRelation: '>=', proofSteps: '', proofStatement: '' };
const SPACE_KIND_LABELS: Record<SpaceGeometryKind, string> = {
  vector_operations: '向量运算：模、点积、叉积、夹角、投影',
  vector_products: '向量积与体积：面积、四面体体积、共面性',
  line_from_points: '两点确定直线',
  line_point_direction: '点向式直线',
  plane_point_normal: '点法式平面',
  plane_three_points: '三点确定平面',
  line_line_relation: '两直线位置关系',
  line_plane_relation: '直线与平面位置关系',
  plane_plane_relation: '两平面位置关系',
  point_line_distance: '点到直线距离与垂足',
  point_plane_distance: '点到平面距离与投影',
  line_plane_projection: '直线在平面上的投影',
  surface_tangent: '曲面切平面与法线',
  quadric_surface: '二次曲面识别',
};
const SPACE_EXAMPLES: Record<SpaceGeometryKind, Partial<ManualIntegralDraft>> = {
  vector_operations: { spaceA: '1,2,3', spaceB: '4,5,6' },
  vector_products: { spaceA: '1,0,0', spaceB: '0,1,0', spaceC: '0,0,1' },
  line_from_points: { spaceA: '0,0,0', spaceB: '1,2,3' },
  line_point_direction: { spaceA: '1,0,0', spaceB: '1,2,3' },
  plane_point_normal: { spaceA: '1,2,3', spaceB: '2,3,4' },
  plane_three_points: { spaceA: '1,0,0', spaceB: '0,1,0', spaceC: '0,0,1' },
  line_line_relation: { spaceA: '0,0,0', spaceB: '1,0,0', spaceC: '0,0,0', spaceD: '0,1,0' },
  line_plane_relation: { spaceA: '0,0,0', spaceB: '0,0,1', spaceC: '0,0,1,-2' },
  plane_plane_relation: { spaceA: '1,0,0,0', spaceB: '0,1,0,0' },
  point_line_distance: { spaceA: '0,1,0', spaceB: '0,0,0', spaceC: '1,0,0' },
  point_plane_distance: { spaceA: '0,0,0', spaceB: '1,0,0,-2' },
  line_plane_projection: { spaceA: '0,0,1', spaceB: '1,0,1', spaceC: '0,0,1,0' },
  surface_tangent: { expression: 'z=x^2+y^2', spaceA: '1,1,2' },
  quadric_surface: { expression: 'x^2/4+y^2/9+z^2=1' },
};
const CURVE_SURFACE_EXAMPLES: Record<CurveSurfaceIntegralKind, Partial<ManualIntegralDraft>> = {
  line_scalar: { curveX: 't', curveY: 't', curveZ: '0', lower: '0', upper: '1', expression: '1' },
  line_vector: { curveX: 't', curveY: '0', curveZ: '0', lower: '0', upper: '1', fieldP: '1', fieldQ: '0', fieldR: '0', integralOrientation: 'forward' },
  surface_scalar_graph: { surfaceZ: 'x+y', lower: '0', upper: '1', innerLower: '0', innerUpper: 'x', expression: '1' },
  surface_scalar_param: { surfaceX: 'u', surfaceY: 'v', surfaceZuv: '0', lower: '0', upper: '1', innerLower: '0', innerUpper: '1', expression: '1' },
  surface_flux_graph: { surfaceZ: '1', lower: '0', upper: '1', innerLower: '0', innerUpper: '1', fieldP: '0', fieldQ: '0', fieldR: 'z', integralOrientation: 'up' },
  surface_flux_param: { surfaceX: 'u', surfaceY: 'v', surfaceZuv: '0', lower: '0', upper: '1', innerLower: '0', innerUpper: '1', fieldP: '0', fieldQ: '0', fieldR: '1', integralOrientation: 'positive' },
  green: { fieldP: '-y', fieldQ: 'x', lower: '0', upper: '1', innerLower: '0', innerUpper: '1', integralOrientation: 'positive' },
  gauss: { fieldP: 'x', fieldQ: 'y', fieldR: 'z', lower: '0', upper: '1', innerLower: '0', innerUpper: '1', tripleInnerLower: '0', tripleInnerUpper: '1' },
  stokes: { fieldP: '-y', fieldQ: 'x', fieldR: '0', surfaceZ: '0', lower: '0', upper: '1', innerLower: '0', innerUpper: '1', integralOrientation: 'up' },
};
const PROOF_EXAMPLES: Record<ProofKind, Partial<ManualIntegralDraft>> = {
  ivt_root: { expression: 'x^2-1', lower: '0', upper: '2', proofStatement: '证明方程 x^2-1=0 在 [0,2] 上存在实根。' },
  ivt_unique_root: { expression: 'x^3+x-1', lower: '0', upper: '1', proofStatement: '证明方程 x^3+x-1=0 在 [0,1] 上有唯一实根。' },
  rolle: { expression: 'x^2', lower: '-1', upper: '1', proofStatement: '验证并证明 x^2 在 [-1,1] 上满足罗尔定理。' },
  mvt: { expression: 'x^2', lower: '0', upper: '2', proofStatement: '验证并证明 x^2 在 [0,2] 上满足拉格朗日中值定理。' },
  cauchy_mvt: { proofLeft: 'x^2', proofRight: 'x', lower: '1', upper: '2', proofStatement: '验证并证明 x^2 与 x 在 [1,2] 上满足柯西中值定理。' },
  monotone_inequality: { expression: 'x^2', lower: '0', upper: '1', proofStatement: '用单调性证明 x^2≥0，x∈[0,1]。' },
  inequality: { proofLeft: 'x^2', proofRight: 'x', proofRelation: '>=', lower: '1', upper: '2', proofStatement: '用单调性证明 x^2≥x，x∈[1,2]。' },
  counterexample: { proofLeft: 'x^2', proofRight: 'x', proofRelation: '>=', point: '1/2', proofStatement: '判断全称命题 x^2≥x 是否成立。' },
  steps: { proofSteps: 'x^2-1=(x-1)*(x+1)\n(x-1)*(x+1)=x^2-1', proofStatement: '综合题局部步骤核对。' },
};
type FieldKey = 'xMap' | 'yMap' | 'eventOuterLower' | 'eventOuterUpper' | 'eventInnerLower' | 'eventInnerUpper' | 'tripleInnerLower' | 'tripleInnerUpper' | 'expression' | 'constraint' | 'innerLower' | 'innerUpper' | 'lower' | 'upper' | 'point' | 'pointValue' | 'pointY' | 'powerCenter';
const FIELD_LABELS: Record<FieldKey, string> = { xMap:'映射x(u,v)',yMap:'映射y(u,v)',eventOuterLower:'事件外层下限',eventOuterUpper:'事件外层上限',eventInnerLower:'事件内层下界',eventInnerUpper:'事件内层上界',tripleInnerLower:'最内层下界',tripleInnerUpper:'最内层上界',expression: '函数表达式', constraint:'完整等式约束', innerLower:'内层下界',innerUpper:'内层上界',lower: '积分下限', upper: '积分上限', point: '研究点', pointValue: '单点函数值', pointY: '研究点纵坐标', powerCenter:'幂级数中心' };

export function ManualLabComposer(): JSX.Element {
  const navigate = useNavigate();
  const [draft, setDraft] = useState<ManualIntegralDraft>(EMPTY);
  const [preview, setPreview] = useState<{ inputKey: string; data: ManualIntegralPreview } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState<'preview' | 'compute' | null>(null);
  const [error, setError] = useState('');
  const [activeField, setActiveField] = useState<FieldKey>('expression');
  const [keyboardOpen, setKeyboardOpen] = useState(true);
  const requestId = useRef(0);
  const confirmation = useRef<HTMLHeadingElement>(null);
  const confirmationSection = useRef<HTMLElement>(null);
  const expressionHandle = useRef<MathKeyboardHandle | null>(null);
  const constraintHandle = useRef<MathKeyboardHandle | null>(null);
  const innerLowerHandle = useRef<MathKeyboardHandle | null>(null);
  const innerUpperHandle = useRef<MathKeyboardHandle | null>(null);
  const lowerHandle = useRef<MathKeyboardHandle | null>(null);
  const upperHandle = useRef<MathKeyboardHandle | null>(null);
  const pointYHandle = useRef<MathKeyboardHandle | null>(null);
  const pointValueHandle = useRef<MathKeyboardHandle | null>(null);
  const pointHandle = useRef<MathKeyboardHandle | null>(null);
  const xMapHandle=useRef<MathKeyboardHandle|null>(null);
  const yMapHandle=useRef<MathKeyboardHandle|null>(null);
  const eventOuterLowerHandle=useRef<MathKeyboardHandle|null>(null);
  const eventOuterUpperHandle=useRef<MathKeyboardHandle|null>(null);
  const eventInnerLowerHandle=useRef<MathKeyboardHandle|null>(null);
  const eventInnerUpperHandle=useRef<MathKeyboardHandle|null>(null);
  const tripleInnerLowerHandle=useRef<MathKeyboardHandle|null>(null);
  const tripleInnerUpperHandle=useRef<MathKeyboardHandle|null>(null);
  const powerCenterHandle=useRef<MathKeyboardHandle|null>(null);
  const activeHandle={expression:expressionHandle,constraint:constraintHandle,innerLower:innerLowerHandle,innerUpper:innerUpperHandle,tripleInnerLower:tripleInnerLowerHandle,tripleInnerUpper:tripleInnerUpperHandle,lower:lowerHandle,upper:upperHandle,point:pointHandle,pointValue:pointValueHandle,pointY:pointYHandle,xMap:xMapHandle,yMap:yMapHandle,eventOuterLower:eventOuterLowerHandle,eventOuterUpper:eventOuterUpperHandle,eventInnerLower:eventInnerLowerHandle,eventInnerUpper:eventInnerUpperHandle,powerCenter:powerCenterHandle}[activeField];
  const polarMode=draft.doubleMode==='polar' || draft.doubleMode==='polar_improper';
  const affineMode=draft.doubleMode==='affine' || draft.doubleMode==='change_variables';
  const improperMode=['improper','polar_improper','strip_improper'].includes(draft.doubleMode ?? '');
  const applicationMode=!!draft.doubleApplication && draft.doubleApplication!=='integral';
  const innerVariable=affineMode ? 'v' : polarMode ? 'r' : draft.doubleOuter==='y' ? 'x' : 'y';
  const outerVariable=affineMode ? 'u' : polarMode ? 'theta' : draft.doubleOuter ?? 'x';
  const tripleMode=draft.tripleMode ?? 'box';
  const tripleCartesian=tripleMode==='box' || tripleMode==='z_simple';
  const tripleMiddleVariable=tripleCartesian ? 'y' : tripleMode==='cylindrical' ? 'r' : 'phi';
  const tripleInnerVariable=tripleCartesian || tripleMode==='cylindrical' ? 'z' : 'rho';
  const tripleOuterVariable=tripleCartesian ? 'x' : 'theta';
  const tripleMiddleVariables=tripleMode==='z_simple' ? ['x'] : tripleMode==='cylindrical' ? ['theta'] : [];
  const tripleInnerVariables=tripleMode==='z_simple' ? ['x','y'] : tripleMode==='cylindrical' ? ['theta','r'] : tripleMode==='spherical' ? ['theta','phi'] : [];
  const spaceKind: SpaceGeometryKind = draft.spaceKind ?? 'vector_operations';
  const spaceFields = SPACE_KIND_FIELDS[spaceKind];
  const spaceSurface = SPACE_SURFACE_KINDS.includes(spaceKind);
  const integralKind: CurveSurfaceIntegralKind = draft.integralKind ?? 'line_scalar';
  const integralFields = CURVE_SURFACE_KIND_FIELDS[integralKind];
  const integralScalar = CURVE_SURFACE_SCALAR_KINDS.includes(integralKind);
  const integralOrientations = CURVE_SURFACE_ORIENTATIONS[integralKind];
  const proofKind: ProofKind = draft.proofKind ?? 'ivt_root';
  const proofSingle = PROOF_SINGLE_KINDS.includes(proofKind);
  const proofBounds = PROOF_BOUND_KINDS.includes(proofKind);
  const proofLeftRight = proofKind === 'cauchy_mvt' || proofKind === 'inequality' || proofKind === 'counterexample';
  const proofRelation = PROOF_RELATION_KINDS.includes(proofKind);
  const update = (patch: Partial<ManualIntegralDraft>): void => {
    requestId.current += 1;
    setDraft(current => ({ ...current, ...patch }));
    if (patch.task) setActiveField('expression');
    setPreview(null); setConfirmed(false); setError('');
  };
  const prepare = async (): Promise<void> => {
    const invalid = manualInputError(draft);
    if (invalid) { setError(invalid); return; }
    const id = ++requestId.current;
    setBusy('preview'); setError(''); setPreview(null); setConfirmed(false);
    try {
      const data = await previewManualLab({ task: draft.task, conditions: manualConditions(draft) });
      if (id !== requestId.current) return;
      setPreview({ inputKey: manualInputKey(draft), data });
      requestAnimationFrame(() => {
        confirmationSection.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        confirmation.current?.focus({ preventScroll: true });
      });
    } catch (cause) { if (id === requestId.current) setError(errorMessage(cause)); }
    finally { setBusy(null); }
  };
  const compute = async (): Promise<void> => {
    if (!preview || !confirmed || preview.inputKey !== manualInputKey(draft) || busy) return;
    setBusy('compute'); setError('');
    try {
      const lab = await createManualLab({ task: preview.data.task, conditions: preview.data.conditions, confirmed: true });
      navigate(`/labs/${lab.lab_id}`);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(null); }
  };
  return <section className={styles.panel} aria-labelledby="manual-lab-title">
    <header className={styles.header}>
      <span className={styles.kicker}>SOLVE YOUR PROBLEM</span>
      <h2 id="manual-lab-title">输入我的题目</h2>
      <p>选择题型，填写公式与条件。核对完整题目后，由本地内核计算并展示过程。</p>
    </header>
    <ol className={styles.steps} aria-label="解题流程">
      {['选择题型', '填写条件', '确认题目', '计算与展示'].map((step, i) => <li key={step} data-active={preview ? i === 2 : i < 2}>{i + 1} · {step}</li>)}
    </ol>
    <details><summary>高数题型目录与支持范围</summary>
      <p>以下“已有内核”表示已实现部分计算能力，尚不等于该模块所有题目均可求解。</p>
      <ul>{calculusCatalog.map(item => <li key={item.module}><strong>{item.module}</strong>：{item.manual ? `可手动求解：${item.manual}。` : ''}{item.pending}</li>)}</ul>
    </details>
    <fieldset className={styles.fields} disabled={busy !== null}>
      <div className={styles.classification}>
        <label>科目<select aria-label="科目" defaultValue="calculus"><option value="calculus">高等数学</option></select></label>
        <span>知识模块<strong>{draft.task === 'proof' ? '证明与综合题' : draft.task === 'curve_surface_integral' ? '曲线与曲面积分' : draft.task === 'space_geometry' ? '空间解析几何' : ['double_integral','triple_integral'].includes(draft.task) ? '重积分' : draft.task === 'multivariable_extrema' ? '多元极值' : draft.task === 'multivariable' ? '多元微分' : draft.task === 'ode' ? '微分方程' : ['geometric_area','rotation_volume'].includes(draft.task) ? '定积分应用' : ['taylor','series_convergence','power_series','fourier_series'].includes(draft.task) ? '级数与展开' : draft.task === 'function_study' ? '函数研究' : draft.task === 'implicit_normal' ? '切线与法线' : draft.task === 'continuity' ? '连续性' : draft.task === 'limit' ? '极限' : ['derivative', 'higher_derivative'].includes(draft.task) ? '导数' : '积分'}</strong></span>
        <p>手动求解：定积分、不定积分、导函数与高阶导数、指定点导数与切线、极限、连续性与间断点、切线与法线、函数区间研究、泰勒展开、数项级数敛散性、幂级数收敛域与求和、傅里叶级数、定积分应用、常微分方程、多元微分、多元局部极值与等式约束极值、分片与极坐标二重积分、自动换序、矩形/极坐标/曲边区域反常积分、仿射与可核验非线性变量代换及质量/质心/惯量/联合概率应用、长方体/z型/柱坐标/球坐标三重积分、向量运算与混合积、直线与平面方程及位置关系、点到直线与平面的距离、直线在平面上的投影、曲面切平面与法线、无交叉项二次曲面识别、两类曲线积分、两类曲面积分及 Green/Gauss/Stokes 公式、中值定理与零点存在/唯一性证明、函数不等式、反例与综合题局部步骤核对。408等其他题型可使用下方文件识别或示例入口。</p>
      </div>
      <div className={styles.tasks} role="group" aria-label="选择高数题型">
        <button type="button" aria-pressed={draft.task === 'integral' && draft.integralMode !== 'improper'} onClick={() => update({ task: 'integral', integralMode:'proper' })}>
          <strong>定积分</strong><span>给出函数与上下限，求积分值并观察黎曼和。</span>
        </button>
        <button type="button" aria-pressed={draft.task === 'antiderivative'} onClick={() => update({ task: 'antiderivative' })}>
          <strong>不定积分</strong><span>求原函数族 F(x) + C，并通过求导核对。</span>
        </button>
        <button type="button" aria-pressed={draft.task === 'derivative'} onClick={() => update({ task: 'derivative' })}>
          <strong>导数与切线</strong><span>输入函数和求导点，求导数并观察切线。</span>
        </button>
        <button type="button" aria-pressed={draft.task === 'limit'} onClick={() => update({ task: 'limit' })}>
          <strong>极限</strong><span>输入函数、趋近点和方向，检查左右极限。</span>
        </button>
        <button type="button" aria-pressed={draft.task === 'higher_derivative'} onClick={() => update({ task: 'higher_derivative', order: '1', point: '' })}>
          <strong>导函数与高阶导数</strong><span>选择1至10阶，可选填求值点。</span>
        </button>
        <button type="button" aria-pressed={draft.task === 'continuity'} onClick={() => update({ task: 'continuity', point: '', valueMode: 'expression', pointValue: '', intervalType: 'closed' })}>
          <strong>连续性与间断点</strong><span>核对函数值、左右极限并分类。</span>
        </button>
        <button type="button" aria-pressed={draft.task === 'implicit_normal'} onClick={() => update({ task: 'implicit_normal', expression: '', point: '', pointY: '' })}>
          <strong>切线与法线</strong><span>输入曲线方程与研究点，核对隐函数分支。</span>
        </button>
        <button type="button" aria-pressed={draft.task === 'function_study'} onClick={() => update({ task: 'function_study' })}>
          <strong>函数区间研究</strong><span>分析单调性、极值最值、凹凸性与拐点。</span>
        </button>
        <button type="button" aria-pressed={draft.task === 'taylor'} onClick={() => update({ task: 'taylor', point: '', order: '3' })}>
          <strong>泰勒展开</strong><span>选择精确展开点与阶数，核对系数、余项和观察范围。</span>
        </button>
        <button type="button" aria-pressed={draft.task === 'series_convergence'} onClick={() => update({ task: 'series_convergence', expression: '', indexStart: '' })}>
          <strong>数项级数敛散性</strong><span>输入通项与起始项，判定绝对收敛、条件收敛或发散。</span>
        </button>
        <button type="button" aria-pressed={draft.task === 'power_series'} onClick={() => update({ task: 'power_series', expression: '', powerGoal: 'radius', powerCenter: '', indexStart: '' })}>
          <strong>幂级数收敛域与求和</strong><span>核对收敛半径、端点、收敛域与和函数。</span>
        </button>
        <button type="button" aria-pressed={draft.task === 'fourier_series'} onClick={() => update({ task: 'fourier_series', expression: '', lower: '', upper: '', order: '3' })}>
          <strong>傅里叶级数</strong><span>按完整区间计算系数与前n阶部分和，说明间断点。</span>
        </button>
        <button type="button" aria-pressed={draft.task === 'geometric_area'} onClick={() => update({ task:'geometric_area',variable:'x',regionKind:'' })}>
          <strong>平面区域面积</strong><span>确认曲线与x轴的区域，按几何面积计算。</span>
        </button>
        <button type="button" aria-pressed={draft.task === 'rotation_volume'} onClick={() => update({ task:'rotation_volume',variable:'x',regionKind:'',rotationAxis:'' })}>
          <strong>旋转体积</strong><span>确认区域与旋转轴，用圆盘法计算体积。</span>
        </button>
        <button type="button" aria-pressed={draft.task === 'ode'} onClick={() => update({task:'ode',variable:'x',expression:'',initialConditions:''})}>
          <strong>常微分方程</strong><span>输入方程与可选条件，代回核验解或解族。</span>
        </button>
        <button type="button" aria-pressed={draft.task === 'multivariable'} onClick={() => update({task:'multivariable',expression:'',multiVariables:'x,y',multiOperation:'partial',partialVariable:'x',multiPoint:'',multiDirection:'',directionLimit:'forward'})}>
          <strong>多元函数微分</strong><span>偏导数、全微分、方向导数与梯度。</span>
        </button>
        <button type="button" aria-pressed={draft.task === 'multivariable_extrema'} onClick={() => update({task:'multivariable_extrema',expression:'',extremaOperation:'unconstrained',extremaConstraint:''})}>
          <strong>多元函数极值与条件极值</strong><span>核对全部驻点、Hessian判别与完整等式约束。</span>
        </button>
        <button type="button" aria-pressed={draft.task === 'double_integral'} onClick={()=>update({task:'double_integral',expression:'',doubleOuter:'x',lower:'',upper:'',innerLower:'',innerUpper:''})}>
          <strong>二重积分</strong><span>区域与换序、反常积分、变量代换和密度应用。</span>
        </button>
        <button type="button" aria-pressed={draft.task === 'triple_integral'} onClick={()=>update({task:'triple_integral',expression:'',tripleMode:'box',lower:'',upper:'',innerLower:'',innerUpper:'',tripleInnerLower:'',tripleInnerUpper:''})}>
          <strong>三重积分</strong><span>长方体、z型区域、柱坐标与球坐标，逐层核验。</span>
        </button>
        <button type="button" aria-pressed={draft.task === 'space_geometry'} onClick={()=>update({task:'space_geometry',spaceKind:'vector_operations',spaceA:'',spaceB:'',spaceC:'',spaceD:'',expression:''})}>
          <strong>空间解析几何</strong><span>向量、直线、平面、曲面及其夹角、距离、交点与投影。</span>
        </button>
        <button type="button" aria-pressed={draft.task === 'curve_surface_integral'} onClick={()=>update({task:'curve_surface_integral',integralKind:'line_scalar',curveX:'',curveY:'',curveZ:'',surfaceZ:'',surfaceX:'',surfaceY:'',surfaceZuv:'',fieldP:'',fieldQ:'',fieldR:'',lower:'',upper:'',innerLower:'',innerUpper:'',tripleInnerLower:'',tripleInnerUpper:'',expression:'',integralOrientation:'forward'})}>
          <strong>曲线与曲面积分</strong><span>两类曲线积分、两类曲面积分，以及 Green/Gauss/Stokes 公式。</span>
        </button>
        <button type="button" aria-pressed={draft.task === 'proof'} onClick={()=>update({task:'proof',proofKind:'ivt_root',expression:'',lower:'',upper:'',point:'',proofLeft:'',proofRight:'',proofRelation:'>=',proofSteps:'',proofStatement:''})}>
          <strong>证明与综合题</strong><span>中值定理、零点唯一性、不等式、反例与局部步骤核对。</span>
        </button>
      </div>
      {draft.task === 'integral' ? <label className={styles.modeField}>积分类型<select aria-label="积分类型" value={draft.integralMode ?? 'proper'} onChange={e=>update({integralMode:e.target.value as 'proper'|'improper'})}><option value="proper">有限定积分</option><option value="improper">反常积分（无穷限或瑕点）</option></select>{draft.integralMode === 'improper' ? <small>上下限可输入 oo、-oo 或 ±∞。逐个瑕点分别检查两侧收敛；不使用柯西主值，不计算有限截断黎曼和。</small> : null}</label> : null}
      <div className={styles.inputHeading}>
        {!['implicit_normal','geometric_area','rotation_volume','multivariable','multivariable_extrema','double_integral','triple_integral','series_convergence','power_series','fourier_series','space_geometry','curve_surface_integral','proof'].includes(draft.task) ? <label>计算变量<select aria-label="计算变量" value={draft.variable} onChange={e => update({ variable: e.target.value })}>
          {(draft.task === 'ode' ? ['x','t'] : ['x', 't', 'y', 'z']).map(v => <option key={v} value={v}>{v}</option>)}
        </select></label> : <p>{draft.task === 'proof' ? `证明类型：${PROOF_KIND_LABELS[proofKind]}` : draft.task === 'curve_surface_integral' ? `积分类型：${CURVE_SURFACE_KIND_LABELS[integralKind]}` : draft.task === 'space_geometry' ? `空间对象：${SPACE_KIND_LABELS[spaceKind]}` : draft.task === 'triple_integral' ? '被积函数变量：x、y、z' : draft.task === 'double_integral' ? '被积函数变量：x、y' : draft.task === 'multivariable_extrema' ? '变量顺序：x,y（二元）' : draft.task === 'multivariable' ? `变量顺序：${draft.multiVariables ?? 'x,y'}` : draft.task === 'series_convergence' || draft.task === 'power_series' ? '通项/系数变量：n；幂变量：x' : draft.task === 'fourier_series' ? '函数变量：x' : '曲线坐标：x、y'}</p>}
        <button type="button" onClick={() => update(draft.task === 'proof' ? { ...PROOF_EXAMPLES[proofKind], proofKind } : draft.task === 'curve_surface_integral' ? { ...CURVE_SURFACE_EXAMPLES[integralKind], integralKind } : draft.task === 'space_geometry' ? { ...SPACE_EXAMPLES[spaceKind], spaceKind }
          : draft.task === 'integral'
          ? draft.integralMode==='improper' ? {expression:'exp(-x)',variable:'x',lower:'0',upper:'oo'} : { expression: 'x^2', variable: 'x', lower: '0', upper: '2' }
          : draft.task === 'triple_integral' ? tripleIntegralExample(draft) : draft.task === 'double_integral' ? doubleIntegralExample(draft) : draft.task === 'multivariable_extrema' ? {expression:'x*y',extremaOperation:'constrained',extremaConstraint:'x+y=2'} : draft.task === 'multivariable' ? {expression:'x^2+y^2',multiVariables:'x,y',multiOperation:'directional',multiPoint:'1,2',multiDirection:'3,4',directionLimit:'forward'} : draft.task === 'ode' ? {expression:"y''+y=0",variable:'x',initialConditions:"y(0)=0\ny'(0)=1"} : ['geometric_area','rotation_volume'].includes(draft.task) ? { expression:'x', variable:'x', lower:'-1',upper:'1',regionKind:'between_axis',rotationAxis:'x' } : draft.task === 'series_convergence' ? { expression:'(-1)^n/sqrt(n)', indexStart:'1' } : draft.task === 'power_series' ? { expression:'1/n', powerGoal:'radius', powerCenter:'0', indexStart:'1' } : draft.task === 'fourier_series' ? { expression:'x', lower:'-pi', upper:'pi', order:'3' } : draft.task === 'taylor' ? { expression: 'exp(x)', variable: 'x', point: '0', order: '3' } : draft.task === 'function_study' ? { expression: 'x^3-3*x', variable: 'x', lower: '-2', upper: '2', intervalType: 'closed' } : draft.task === 'implicit_normal' ? { expression: 'x^2+y^2=1', point: '0', pointY: '1' } : draft.task === 'continuity' ? { expression: 'sin(x)/x', variable: 'x', point: '0', valueMode: 'value', pointValue: '1' } : draft.task === 'higher_derivative' ? { expression: 'x^4', variable: 'x', order: '2', point: '' } : draft.task === 'limit' ? { expression: 'sin(x)/x', variable: 'x', point: '0', side: 'both' } : draft.task === 'derivative' ? { expression: 'x^3', variable: 'x', point: '2' } : { expression: 'x*cos(x)', variable: 'x', lower: '', upper: '' })}>填入可修改示例</button>
      </div>
      {draft.task === 'space_geometry' && !spaceSurface ? null : draft.task === 'curve_surface_integral' && !integralScalar ? null : draft.task === 'proof' && !proofSingle ? null : <MathExpressionInput answerMode={['implicit_normal','ode'].includes(draft.task) || (draft.task === 'space_geometry' && spaceSurface)} label={draft.task==='proof' ? '函数 f(x)' : draft.task==='curve_surface_integral' ? '被积函数' : draft.task==='space_geometry' ? '曲面方程' : draft.task==='double_integral' && applicationMode ? '密度函数' : draft.task === 'series_convergence' ? '级数通项 u_n' : draft.task === 'power_series' ? '幂级数系数 a_n' : draft.task === 'fourier_series' ? '周期函数表达式' : draft.task === 'multivariable_extrema' ? '极值目标函数' : draft.task === 'multivariable' ? '多元函数表达式' : draft.task === 'ode' ? '微分方程' : ['geometric_area','rotation_volume'].includes(draft.task) ? '区域边界函数' : draft.task === 'implicit_normal' ? '曲线方程' : ['derivative', 'limit', 'higher_derivative', 'continuity', 'function_study', 'taylor'].includes(draft.task) ? '函数表达式' : '被积函数'} value={draft.expression} variables={draft.task === 'proof' ? ['x'] : draft.task === 'curve_surface_integral' || draft.task === 'space_geometry' ? ['x','y','z'] : draft.task === 'triple_integral' ? ['x','y','z'] : draft.task === 'double_integral' ? ['x','y'] : draft.task === 'series_convergence' || draft.task === 'power_series' ? ['n'] : draft.task === 'fourier_series' ? ['x'] : draft.task === 'multivariable_extrema' ? ['x','y'] : draft.task === 'multivariable' ? (draft.multiVariables ?? 'x,y').split(',') : draft.task === 'implicit_normal' ? ['x', 'y'] : draft.task === 'ode' ? [draft.variable,'y'] : [draft.variable]}
        onChange={expression => update({ expression })} placeholder={draft.task === 'proof' ? '例如 x^2-1、x^3+x-1 或 sin(x)' : draft.task === 'curve_surface_integral' ? '例如 1、x^2+y^2 或 z' : draft.task === 'space_geometry' ? '例如 z=x^2+y^2 或 x^2+y^2+z^2=1；也可填 F(x,y,z)=0' : draft.task === 'series_convergence' ? '例如 (-1)^n/n 或 1/n^2；只填通项，不含求和符号' : draft.task === 'power_series' ? '例如 1/n、(-1)^n/(2*n+1)；只填系数 a_n' : draft.task === 'fourier_series' ? '例如 x、x^2；只含 x，不含级数符号' : draft.task === 'triple_integral' ? '例如 x*y*z 或 x^2+y^2+z^2' : draft.task === 'multivariable_extrema' ? '例如 x^4-2*x^2+y^2' : draft.task === 'multivariable' ? '例如 x^2*y+sin(y)' : draft.task === 'ode' ? "例如 y'=x+y 或 y''+y=0，未知函数固定y" : draft.task === 'implicit_normal' ? '例如 y=x^2 或 x^2+y^2=1' : `例如 ${draft.variable}^2；只填函数，不含积分符号`}
        keyboard={false} apiRef={expressionHandle} onActivate={() => setActiveField('expression')} />}
      {draft.task === 'space_geometry' ? <>
        <label className={styles.modeField}>空间对象类型<select aria-label="空间对象类型" value={spaceKind} onChange={e=>{const kind=e.target.value as SpaceGeometryKind;update({spaceKind:kind,spaceA:'',spaceB:'',spaceC:'',spaceD:'',expression:''});setActiveField('expression');}}>
          <optgroup label="向量"><option value="vector_operations">向量运算（模、点积、叉积、夹角、投影）</option><option value="vector_products">向量积与体积（面积、四面体、共面）</option></optgroup>
          <optgroup label="直线"><option value="line_from_points">两点确定直线</option><option value="line_point_direction">点向式直线</option></optgroup>
          <optgroup label="平面"><option value="plane_point_normal">点法式平面</option><option value="plane_three_points">三点确定平面</option></optgroup>
          <optgroup label="关系、距离与投影"><option value="line_line_relation">两直线位置关系</option><option value="line_plane_relation">直线与平面位置关系</option><option value="plane_plane_relation">两平面位置关系</option><option value="point_line_distance">点到直线距离</option><option value="point_plane_distance">点到平面距离</option><option value="line_plane_projection">直线在平面上的投影</option></optgroup>
          <optgroup label="曲面"><option value="surface_tangent">曲面切平面与法线</option><option value="quadric_surface">二次曲面识别</option></optgroup>
        </select></label>
        <p>{spaceKind === 'vector_operations' ? '求模长、方向余弦、点积、叉积、夹角以及一个向量在另一个向量上的数量投影与向量投影；零向量拒绝计算。' : spaceKind === 'vector_products' ? '由 a×b 的模求平行四边形/三角形面积，由混合积 (a×b)·c 求平行六面体与四面体体积，并判断三向量是否共面。' : spaceKind === 'line_from_points' ? '由 A、B 两点求方向向量与直线的参数方程、对称式；两点重合会拒绝。' : spaceKind === 'line_point_direction' ? '由点与方向向量写出直线的参数方程与对称式；某个方向分量为零时单独写成等式。' : spaceKind === 'plane_point_normal' ? '由点与法向量写出平面方程；法向量不能为零。' : spaceKind === 'plane_three_points' ? '由不共线三点求法向量与平面方程；三点共线会拒绝。' : spaceKind === 'line_line_relation' ? '比较方向向量与共面条件，判定重合、平行、相交或异面，并给出夹角、距离与交点。' : spaceKind === 'line_plane_relation' ? '判定直线在平面内、平行或相交，并给出夹角、距离与交点。' : spaceKind === 'plane_plane_relation' ? '判定两平面重合、平行或相交，并给出夹角与交线（相交时）。' : spaceKind === 'point_line_distance' ? '用叉积公式求点到直线的距离，并给出垂足。' : spaceKind === 'point_plane_distance' ? '用点到平面距离公式计算，并给出沿法向量的投影点。' : spaceKind === 'line_plane_projection' ? '求直线在平面上的投影；垂直时投影退化为交点，平行时投影保持方向。' : spaceKind === 'surface_tangent' ? '以 F(x,y,z)=0 的梯度为法向量，求曲面在给定点处的切平面与法线；点不在曲面上或梯度为零会拒绝。' : '识别不含交叉项的二次曲面标准方程，给出类型、标准形与配方中心；含交叉项时需先正交变换。'}</p>
        {spaceFields.length ? <div className={styles.bounds}>{spaceFields.map(field => <label key={field.key}>{field.label}<input aria-label={field.label} value={draft[field.key] ?? ''} onChange={e=>update({[field.key]: e.target.value})} placeholder={field.placeholder} /></label>)}</div> : null}
        <p>点与向量写成 a,b,c；平面写成 a,b,c,d，表示 ax+by+cz+d=0。所有分量必须完整填写，不能补0或省略。</p>
      </> : null}
      {draft.task === 'curve_surface_integral' ? <>
        <label className={styles.modeField}>积分类型<select aria-label="曲线曲面积分类型" value={integralKind} onChange={e=>{const next=e.target.value as CurveSurfaceIntegralKind;update({integralKind:next,integralOrientation:CURVE_SURFACE_ORIENTATIONS[next]?.[0]?.value ?? ''});setActiveField('expression');}}>
          <optgroup label="曲线积分"><option value="line_scalar">第一类曲线积分（对弧长）</option><option value="line_vector">第二类曲线积分（对坐标）</option></optgroup>
          <optgroup label="曲面积分"><option value="surface_scalar_graph">第一类曲面积分（显式曲面）</option><option value="surface_scalar_param">第一类曲面积分（参数曲面）</option><option value="surface_flux_graph">第二类曲面积分（显式曲面）</option><option value="surface_flux_param">第二类曲面积分（参数曲面）</option></optgroup>
          <optgroup label="三大公式"><option value="green">Green 公式</option><option value="gauss">Gauss 公式</option><option value="stokes">Stokes 公式</option></optgroup>
        </select></label>
        <p>{integralKind === 'line_scalar' ? 'C 由 x(t)、y(t)、z(t) 参数化，计算 ∫_C f ds；平面曲线把 z(t) 填 0。' : integralKind === 'line_vector' ? '计算 ∫_C P dx+Q dy+R dz；方向由参数增大方向或“反向”决定，反向时积分整体变号。' : integralKind === 'surface_scalar_graph' ? '显式曲面 z=z(x,y) 投影到 x 型区域 D，计算 ∬_S f dS；y 上下界可含 x。' : integralKind === 'surface_scalar_param' ? '参数曲面 r(u,v) 在矩形参数域上计算 ∬_S f dS；面积元为 |r_u×r_v| du dv。参数域重复覆盖同一几何曲面时按覆盖次数累计，不等同于底层几何面积。' : integralKind === 'surface_flux_graph' ? '显式曲面的第二类曲面积分，取上侧或下侧；法向量为 (-z_x,-z_y,1) 或反向。' : integralKind === 'surface_flux_param' ? '参数曲面的通量积分，定向由 r_u×r_v 的正向或反向确定；参数域重复覆盖时通量也按覆盖次数累计。' : integralKind === 'green' ? '区域为 x 型简单区域；正向为逆时针，负向为顺时针，边界分段方向随区域定向。' : integralKind === 'gauss' ? '目前支持长方体区域与外法向；分别计算闭合曲面通量与散度体积分并互验。' : '曲面为 z=z(x,y)、投影为矩形；上侧对应边界逆时针，下侧两侧同时变号。'}</p>
        <div className={styles.bounds}>{integralFields.map(field => <label key={`${integralKind}-${field.condition}`}>{field.label}<input aria-label={field.label} value={draft[field.key] ?? ''} onChange={e=>update({[field.key]:e.target.value})} placeholder={field.placeholder} /></label>)}</div>
        {integralOrientations ? <label className={styles.modeField}>定向<select aria-label="曲线曲面积分定向" value={draft.integralOrientation ?? integralOrientations[0]?.value ?? ''} onChange={e=>update({integralOrientation:e.target.value})}>{integralOrientations.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}</select></label> : null}
        <p>点、参数和分量必须完整填写，不补默认边界；曲线需连续可微且导数不恒为零，曲面法向量不能恒为零。含瑕点、跨奇点或无法得到闭式结果的积分会明确保留未完成原因。</p>
      </> : null}
      {draft.task === 'proof' ? <>
        <label className={styles.modeField}>证明类型<select aria-label="证明类型" value={proofKind} onChange={e=>{const next=e.target.value as ProofKind;update({proofKind:next,proofRelation:next==='inequality'?'>=':'>='});setActiveField('expression');}}>
          <optgroup label="存在性与唯一性"><option value="ivt_root">零点存在性（介值定理）</option><option value="ivt_unique_root">零点存在且唯一</option></optgroup>
          <optgroup label="微分中值定理"><option value="rolle">罗尔定理</option><option value="mvt">拉格朗日中值定理</option><option value="cauchy_mvt">柯西中值定理</option></optgroup>
          <optgroup label="函数不等式"><option value="monotone_inequality">单调性证明 f≥0</option><option value="inequality">两个函数作差证明</option></optgroup>
          <optgroup label="反例与综合"><option value="counterexample">反例否定全称命题</option><option value="steps">综合题步骤核对</option></optgroup>
        </select></label>
        <p>{proofKind === 'ivt_root' ? '验证闭区间连续与端点异号/为零，由介值定理证明零点存在。' : proofKind === 'ivt_unique_root' ? '在零点存在的基础上，用严格单调性证书证明零点唯一。' : proofKind === 'rolle' ? '核验闭区间连续、开区间可导与端点函数值相等，给出罗尔定理证书。' : proofKind === 'mvt' ? '核验闭区间连续与开区间可导，给出拉格朗日中值定理证书与中值斜率。' : proofKind === 'cauchy_mvt' ? '核验 f、g 的连续/可导条件及 g\' 保持同号，给出柯西中值定理证书。' : proofKind === 'monotone_inequality' ? '对 f 使用导数符号与端点非负条件证明 f(x)≥0；非单调情形会保留未认证。' : proofKind === 'inequality' ? '对左右两端作差，用差函数的单调性证明不等式；两个关系符号、区间和端点条件都会逐项核验。' : proofKind === 'counterexample' ? '给出全称命题的左右表达式、关系符号与反例点；只有反例点使命题不成立时才否定原命题。' : '逐行核对综合题的代数等式步骤；只认证局部等式，不把步骤通过当作整体证明完成。'}</p>
        {proofLeftRight ? <div className={styles.bounds}>
          <label>{proofKind === 'cauchy_mvt' ? '函数 f(x)' : '左端表达式'}<input aria-label={proofKind === 'cauchy_mvt' ? '函数 f(x)' : '左端表达式'} value={draft.proofLeft ?? ''} onChange={e=>update({proofLeft:e.target.value})} placeholder="例如 x^2 或 sin(x)" /></label>
          <label>{proofKind === 'cauchy_mvt' ? '函数 g(x)' : '右端表达式'}<input aria-label={proofKind === 'cauchy_mvt' ? '函数 g(x)' : '右端表达式'} value={draft.proofRight ?? ''} onChange={e=>update({proofRight:e.target.value})} placeholder="例如 x 或 x^2+1" /></label>
        </div> : null}
        {proofRelation ? <label className={styles.modeField}>关系符号<select aria-label="证明关系符号" value={draft.proofRelation ?? '>='} onChange={e=>update({proofRelation:e.target.value})}>
          <option value=">=">{proofKind === 'inequality' ? '≥' : '≥'}</option><option value="<=">≤</option>
          {proofKind === 'counterexample' ? <><option value=">">&gt;</option><option value="<">&lt;</option><option value="=">=</option></> : null}
        </select></label> : null}
        {proofBounds ? <div className={styles.bounds}>
          <label>区间下限<input aria-label="区间下限" value={draft.lower} onChange={e=>update({lower:e.target.value})} placeholder="例如 0" /></label>
          <label>区间上限<input aria-label="区间上限" value={draft.upper} onChange={e=>update({upper:e.target.value})} placeholder="例如 2" /></label>
        </div> : null}
        {proofKind === 'counterexample' ? <label>反例点 x0<input aria-label="反例点 x0" value={draft.point ?? ''} onChange={e=>update({point:e.target.value})} placeholder="例如 1/2" /></label> : null}
        {proofKind === 'steps' ? <label>证明步骤（每行一个等式）<textarea aria-label="证明步骤" rows={5} value={draft.proofSteps ?? ''} onChange={e=>update({proofSteps:e.target.value})} placeholder={'例如：\nx^2-1=(x-1)*(x+1)\n(x-1)*(x+1)=x^2-1'} /><small>只核对每一步的代数恒等；整体证明逻辑不自动认证，也不自动判分。</small></label> : null}
        <label>命题陈述（可选）<textarea aria-label="命题陈述" rows={2} value={draft.proofStatement ?? ''} onChange={e=>update({proofStatement:e.target.value})} placeholder="保留原题表述，便于核对；不能替代条件字段。" /></label>
        <p>定理证书只核验模板条件与结论；反例必须使命题不成立；局部等式步骤通过不等于整段证明成立。未认证或无效时保留已核验义务，不自动判分。</p>
      </> : null}
      {draft.task === 'double_integral' ? <>
        {!improperMode && !affineMode ? <label className={styles.modeField}>计算任务<select aria-label="二重积分任务" value={draft.doubleApplication ?? 'integral'} onChange={e=>update({doubleApplication:e.target.value as ManualIntegralDraft['doubleApplication'],swapOrder:false})}><option value="integral">求积分值</option><option value="mass">质量</option><option value="centroid">质心</option><option value="inertia">转动惯量</option><option value="probability">联合概率：事件概率</option></select></label> : null}
        {applicationMode ? <p>原函数作为密度ρ(x,y)；非负性必须核验。质心要求严格正质量；联合概率要求完整支持区域的密度积分等于1，不自动归一化。</p> : null}
        {draft.doubleApplication==='inertia' ? <label className={styles.modeField}>惯量轴<select aria-label="惯量轴" value={draft.inertiaAxis ?? ''} onChange={e=>update({inertiaAxis:e.target.value as ManualIntegralDraft['inertiaAxis']})}><option value="">请选择轴</option><option value="x">x轴：∬ y²ρ dA</option><option value="y">y轴：∬ x²ρ dA</option><option value="origin">过原点垂直平面的轴：∬ (x²+y²)ρ dA</option></select></label> : null}
        {affineMode ? <div className={styles.bounds}>
          <MathExpressionInput label="映射 x(u,v)" value={draft.xMap ?? ''} variables={['u','v']} onChange={xMap=>update({xMap})} keyboard={false} apiRef={xMapHandle} onActivate={()=>setActiveField('xMap')} placeholder="例如 2*u+v" />
          <MathExpressionInput label="映射 y(u,v)" value={draft.yMap ?? ''} variables={['u','v']} onChange={yMap=>update({yMap})} keyboard={false} apiRef={yMapHandle} onActivate={()=>setActiveField('yMap')} placeholder="例如 u-v" />
        </div> : null}
        <label className={styles.modeField}>二重积分例题<select aria-label="二重积分例题" value="" onChange={e=>{const sample=doubleIntegralExamples.find(item=>item.id===e.target.value);if(sample)update({...sample.draft,doubleApplication:'integral'});}}><option value="">选择例题后可修改全部条件</option>{doubleIntegralExamples.map(sample=><option key={sample.id} value={sample.id}>{sample.label}</option>)}</select></label>
        <label className={styles.modeField}>区域模式<select aria-label="二重积分区域模式" value={draft.doubleMode ?? 'strip'} onChange={e=>{update({doubleMode:e.target.value as ManualIntegralDraft['doubleMode'],doubleApplication:'integral',xMap:'',yMap:'',lower:'',upper:'',innerLower:'',innerUpper:'',piecesText:'',swapOrder:false});setActiveField('expression');}}><option value="strip">直角坐标单片</option><option value="pieces">直角坐标分片</option><option value="polar">极坐标</option><option value="improper">二重反常积分（矩形可分离乘积）</option><option value="polar_improper">极坐标反常积分</option><option value="strip_improper">曲边区域反常积分</option><option value="affine">仿射变量代换</option><option value="change_variables">非线性代换（可核验三角/分离映射）</option></select></label>
        {!polarMode && !affineMode ? <>
          <label className={styles.modeField}>积分次序<select aria-label="二重积分次序" value={draft.doubleOuter ?? 'x'} onChange={e=>{update({doubleOuter:e.target.value as 'x'|'y',lower:'',upper:'',innerLower:'',innerUpper:'',piecesText:''});setActiveField('expression');}}><option value="x">先对y、再对x（dy dx）</option><option value="y">先对x、再对y（dx dy）</option></select></label>
          {!improperMode && !applicationMode ? <label className={styles.checkbox}><input type="checkbox" checked={draft.swapOrder ?? false} onChange={e=>update({swapOrder:e.target.checked})} />自动换序：由原区域推导新积分限并核验等价性</label> : improperMode ? <p>{draft.doubleMode==='strip_improper' ? '曲边反常积分使用有限外层区间与完整曲边，内核在参数域核验实定义域、绝对收敛或Tonelli条件。' : '矩形反常积分可填±∞，逐方向核验绝对收敛；不把条件收敛的累次积分当作二重积分。'}</p> : null}
          <p>切换输入次序会清空积分限；勾选自动换序会保留原区域并推导等价表示。二次多项式边界可自动分段；三角、指数、对数与更高次边界在临界点及反函数可完整核验时，也支持分段换序。全部分段一起核验，不能完整推导时保留未完成原因。</p>
        </> : affineMode ? <p>输入原函数f(x,y)，完整填写x(u,v)、y(u,v)与参数域。内核核验映射在参数域一一对应，乘雅可比绝对值；非线性模式支持x仅依赖u且y可分离或关于v为一次式的映射。图形显示原坐标区域。</p> : <p>输入原函数 f(x,y)；内核按 x=r*cos(theta)、y=r*sin(theta) 代换并自动乘雅可比 r。普通模式的极径边界可含theta；反常模式极径为常数，上限可为∞。极角跨度不超过2*pi，极径非负。</p>}
        {draft.doubleMode==='pieces' ? <label>全部分片<textarea aria-label="全部分片" rows={5} value={draft.piecesText ?? ''} onChange={e=>update({piecesText:e.target.value})} placeholder={'每行：外层下限;外层上限;内层下界;内层上界\n例如：0;1;0;x\n1;2;0;2-x'} /><small>每行四个限，用英文分号分隔；外层区间不得重叠，最多20片。所有片之并就是完整区域，不能省略任何片。分片可直接键入或粘贴，数学键盘用于被积函数。</small></label> : null}
        {draft.doubleApplication==='probability' ? <>
          <h4>事件区域（须完整包含在支持区域内）</h4>
          <p>上方函数与下方普通积分限定义整个支持区域；事件使用相同积分次序，需另外完整填写四个限。不会把支持区域误当事件，也不会自动截断越界事件。</p>
          <div className={styles.bounds}>{([
            ['eventOuterLower','事件外层下限',[],eventOuterLowerHandle],['eventOuterUpper','事件外层上限',[],eventOuterUpperHandle],
            ['eventInnerLower','事件内层下界',[draft.doubleOuter ?? 'x'],eventInnerLowerHandle],['eventInnerUpper','事件内层上界',[draft.doubleOuter ?? 'x'],eventInnerUpperHandle],
          ] as const).map(([field,label,variables,handle])=><MathExpressionInput key={field} label={label} value={draft[field] ?? ''} variables={variables} onChange={value=>update({[field]:value})} keyboard={false} apiRef={handle} onActivate={()=>setActiveField(field)} />)}</div>
        </> : null}
      </> : null}
      {draft.task === 'triple_integral' ? <>
        <label className={styles.modeField}>三重积分例题<select aria-label="三重积分例题" value="" onChange={e=>{const sample=tripleIntegralExamples.find(item=>item.id===e.target.value);if(sample)update(sample.draft);}}><option value="">选择例题后可修改全部条件</option>{tripleIntegralExamples.map(sample=><option key={sample.id} value={sample.id}>{sample.label}</option>)}</select></label>
        <label className={styles.modeField}>区域模式<select aria-label="三重积分区域模式" value={tripleMode} onChange={e=>{update({tripleMode:e.target.value as ManualIntegralDraft['tripleMode'],lower:'',upper:'',innerLower:'',innerUpper:'',tripleInnerLower:'',tripleInnerUpper:''});setActiveField('expression');}}><option value="box">长方体：三对常数积分限</option><option value="z_simple">z型区域：投影到xy平面</option><option value="cylindrical">柱坐标：z → r → theta</option><option value="spherical">球坐标：rho → phi → theta</option></select></label>
        <p>{tripleCartesian ? '先对 z、再对 y、最后对 x 积分；雅可比为 1。z型区域的 y 下界/上界可含 x，z 下界/上界可含 x、y。' : tripleMode==='cylindrical' ? '先对 z、再对 r、最后对 theta 积分；x=r*cos(theta)，y=r*sin(theta)，内核自动乘雅可比 r。半径边界可含 theta，z 边界可含 theta、r。' : '先对 rho、再对 phi、最后对 theta 积分；x=rho*sin(phi)*cos(theta)，y=rho*sin(phi)*sin(theta)，z=rho*cos(phi)，内核自动乘雅可比 rho²*sin(phi)。径向边界可含 theta、phi。'}</p>
      </> : null}
      {draft.task === 'multivariable_extrema' ? <>
        <label>极值任务<select aria-label="极值任务" value={draft.extremaOperation ?? 'unconstrained'} onChange={e=>{update({extremaOperation:e.target.value as ManualIntegralDraft['extremaOperation']});setActiveField('expression');}}><option value="unconstrained">无约束局部极值与鞍点</option><option value="constrained">单等式约束局部极值</option></select></label>
        {draft.extremaOperation === 'constrained' ? <MathExpressionInput label="完整等式约束" value={draft.extremaConstraint ?? ''} answerMode variables={['x','y']} onChange={extremaConstraint=>update({extremaConstraint})} placeholder="例如 x+y=2；不能省略其他原题条件" keyboard={false} apiRef={constraintHandle} onActivate={()=>setActiveField('constraint')} /> : <p>无约束任务研究整个实平面；如原题另有限制，请选择对应任务并保留全部条件。</p>}
        <p>首批支持二元多项式目标（至6次）及单个多项式等式约束（至4次）。求驻点、检查候选全集与二阶判别；退化点不强行分类，奇异约束点另行检查。不等式、多约束和额外区域边界暂不支持，不能省略后计算；结果为局部极值，不宣称全局最值。</p>
      </> : null}
      {draft.task === 'multivariable' ? <>
        <label>计算任务<select aria-label="多元计算任务" value={draft.multiOperation ?? 'partial'} onChange={e=>update({multiOperation:e.target.value as ManualIntegralDraft['multiOperation']})}><option value="partial">一阶偏导数</option><option value="differential">全微分</option><option value="directional">方向导数</option><option value="gradient">梯度</option></select></label>
        <label>变量顺序<select aria-label="多元变量顺序" value={draft.multiVariables ?? 'x,y'} onChange={e=>update({multiVariables:e.target.value as ManualIntegralDraft['multiVariables'],partialVariable:'x'})}><option value="x,y">x,y（二元）</option><option value="x,y,z">x,y,z（三元）</option></select></label>
        {(draft.multiOperation ?? 'partial') === 'partial' ? <label>偏导变量<select aria-label="偏导变量" value={draft.partialVariable ?? 'x'} onChange={e=>update({partialVariable:e.target.value})}>{(draft.multiVariables ?? 'x,y').split(',').map(v=><option key={v} value={v}>{v}</option>)}</select></label> : null}
        <label>求值点（{draft.multiOperation === 'directional' ? '必填' : '可选，留空求符号公式'}）<input aria-label="多元求值点" value={draft.multiPoint ?? ''} onChange={e=>update({multiPoint:e.target.value})} placeholder="按变量顺序填写，如 1,pi/2 或 1,2,3" /></label>
        {draft.multiOperation === 'directional' ? <><label>方向向量<input aria-label="方向向量" value={draft.multiDirection ?? ''} onChange={e=>update({multiDirection:e.target.value})} placeholder="如 3,4；会明确归一化为单位向量" /></label><label>方向导数约定<select aria-label="方向导数约定" value={draft.directionLimit ?? 'forward'} onChange={e=>update({directionLimit:e.target.value as ManualIntegralDraft['directionLimit']})}><option value="forward">正向单侧 h→0+</option><option value="two_sided">双侧 h→0</option></select></label></> : null}
        <p>首批为显式二元/三元函数的一阶微分。坐标和方向分量必须完整，不能补0；偏导存在不代表可微。方向导数在不能确认可微时用所选方向的定义核对。</p>
      </> : null}
      {draft.task === 'ode' ? <>
        <div role="group" aria-label="输入导数记号">{["y'", "y''", "y'''"].map(token=><button key={token} type="button" onClick={()=>expressionHandle.current?.press(token)}>{token}</button>)}<button type="button" onClick={()=>expressionHandle.current?.press('=')}>=</button></div>
        <label>初值条件（可选，每行一条）<textarea aria-label="初值条件" rows={3} value={draft.initialConditions ?? ''} onChange={e=>update({initialConditions:e.target.value})} placeholder={"y(0)=1\ny'(0)=0"} /></label>
        <p>未知函数固定为y，自变量为x或t；导数用y'、y''、y'''。支持内核能显式求解并核验的1至3阶常微分方程。留空条件时保留任意常数，不自动选取示例初值；部分条件也可能不能唯一确定解。</p>
      </> : null}
      {['derivative', 'limit', 'higher_derivative', 'continuity', 'implicit_normal', 'taylor'].includes(draft.task) ? <MathExpressionInput label={draft.task === 'taylor' ? '展开点' : draft.task === 'implicit_normal' ? '研究点横坐标' : draft.task === 'continuity' ? '研究点' : draft.task === 'limit' ? '趋近点' : draft.task === 'higher_derivative' ? '求值点（可选）' : '求导点'} value={draft.point ?? ''} variables={[]}
        answerMode={draft.task === 'limit' && ['oo', '+oo', '-oo', 'inf', '+inf', '-inf', '∞', '+∞', '-∞'].includes((draft.point ?? '').trim())}
        onChange={point => update({ point })} placeholder={draft.task === 'limit' ? '例如 0、1/3、pi、oo、-oo' : '例如 1/3、pi/2'}
        keyboard={false} apiRef={pointHandle} onActivate={() => setActiveField('point')} /> : null}
      {draft.task === 'implicit_normal' ? <><MathExpressionInput label="研究点纵坐标（可选）" value={draft.pointY ?? ''} variables={[]} onChange={pointY => update({ pointY })} placeholder="多分支时必填，如 1、-1、sqrt(2)/2" keyboard={false} apiRef={pointYHandle} onActivate={() => setActiveField('pointY')} /><p>可填 y=x^2 或 F(x,y)=0。纵坐标省略时仅接受能唯一确认的实分支，确认页会展示完整点；奇异点不自动指定切线。</p></> : null}
      {draft.task === 'continuity' ? <>
        <label>该点函数值的定义<select aria-label="该点函数值的定义" value={draft.valueMode ?? 'expression'} onChange={e => update({ valueMode: e.target.value as 'expression' | 'undefined' | 'value' })}>
          <option value="expression">按原式取值</option><option value="undefined">题目说明该点未定义</option><option value="value">题目另给单点值</option>
        </select></label>
        {draft.valueMode === 'value' ? <MathExpressionInput label="单点函数值" value={draft.pointValue ?? ''} variables={[]} onChange={pointValue => update({ pointValue })}
          placeholder="例如 1、1/3、pi" keyboard={false} apiRef={pointValueHandle} onActivate={() => setActiveField('pointValue')} /> : null}
        <p>支持单个表达式和单点补定义。另给的值只作用于研究点，不改变左右极限；定义域边界单独提示。</p>
      </> : null}
      {['higher_derivative','taylor'].includes(draft.task) ? <label>{draft.task === 'taylor' ? '展开阶数' : '导数阶数'}<input aria-label={draft.task === 'taylor' ? '展开阶数' : '导数阶数'} type="number" min={1} max={10} step={1} value={draft.order ?? '1'} onChange={e => update({ order: e.target.value })} /><small>{draft.task === 'taylor' ? '支持1至10阶；必须明确展开点。余项和观察区间分别核验。' : '1阶求导函数；留空求值点时只求导函数，不补入默认点。'}</small></label> : null}
      {draft.task === 'series_convergence' ? <label>级数起始项 n =<input aria-label="级数起始项" inputMode="numeric" value={draft.indexStart ?? ''} onChange={e => update({ indexStart: e.target.value })} placeholder="例如 1" /><small>必须与题目给出一致，不自动从1开始。只接受以 n 为通项变量的显式公式，不含求和符号。</small></label> : null}
      {draft.task === 'power_series' ? <>
        <label>求解目标<select aria-label="幂级数目标" value={draft.powerGoal ?? 'radius'} onChange={e => update({ powerGoal: e.target.value as 'radius' | 'sum' })}><option value="radius">收敛半径、收敛域与端点</option><option value="sum">和函数（同时核验收敛域）</option></select></label>
        <MathExpressionInput label="幂级数中心" value={draft.powerCenter ?? ''} variables={[]} onChange={powerCenter => update({ powerCenter })} keyboard={false} apiRef={powerCenterHandle} onActivate={() => setActiveField('powerCenter')} placeholder="例如 0、1/2、-1；必须明确" />
        <label>级数起始项 n =<input aria-label="幂级数起始项" inputMode="numeric" value={draft.indexStart ?? ''} onChange={e => update({ indexStart: e.target.value })} placeholder="例如 0 或 1" /><small>不自动补0或1。级数按 Σ a_n(x-c)^n 核验。</small></label>
        <p>系数 a_n 只含 n，中心 c 为有限实常数。收敛半径由根值/比值判别核验；两个端点逐点代入原级数单独判断，不自动并入收敛域。和函数只在收敛域内给出。</p>
      </> : null}
      {draft.task === 'fourier_series' ? <>
        <div className={styles.bounds}>
          <MathExpressionInput label="区间下限" value={draft.lower} variables={[]} onChange={lower => update({ lower })} keyboard={false} apiRef={lowerHandle} onActivate={() => setActiveField('lower')} placeholder="例如 -pi" />
          <MathExpressionInput label="区间上限" value={draft.upper} variables={[]} onChange={upper => update({ upper })} keyboard={false} apiRef={upperHandle} onActivate={() => setActiveField('upper')} placeholder="例如 pi" />
        </div>
        <label>展开阶数（1至12）<input aria-label="傅里叶展开阶数" type="number" min={1} max={12} step={1} value={draft.order ?? '3'} onChange={e => update({ order: e.target.value })} /><small>计算 a0、a_n、b_n 与前 n 阶部分和；按给定区间计算，不默认 [-pi,pi]。</small></label>
        <p>函数只含 x，且须在完整闭区间连续。系数按给定区间积分核验；间断点与端点跳跃按 Dirichlet 定理说明，部分和只作观察。</p>
      </> : null}
      {draft.task === 'limit' ? <label>趋近方向<select aria-label="趋近方向" value={draft.side ?? 'both'} onChange={e => update({ side: e.target.value as 'both' | 'left' | 'right' })}>
        <option value="both">双侧（无穷远时为通常极限）</option><option value="left">从左侧趋近</option><option value="right">从右侧趋近</option>
      </select></label> : null}
      {['geometric_area','rotation_volume'].includes(draft.task) ? <>
        <label>区域定义<select aria-label="区域定义" value={draft.regionKind ?? ''} onChange={e => update({regionKind:e.target.value as ManualIntegralDraft['regionKind']})}>
          <option value="">请选择题目区域</option><option value="between_axis">曲线与x轴之间（包含负函数区域）</option><option value="vertical_inequality">不等式 0≤y≤f(x)（负值处为空）</option>
        </select></label>
        {draft.task === 'rotation_volume' ? <label>旋转轴<select aria-label="旋转轴" value={draft.rotationAxis ?? ''} onChange={e => update({rotationAxis:e.target.value as ManualIntegralDraft['rotationAxis']})}><option value="">请选择旋转轴</option><option value="x">x轴</option><option value="y">y轴（暂不支持）</option></select></label> : null}
        <p>首批支持有限区间内连续实函数与x轴之间的区域，或明确的0≤y≤f(x)区域。两条非零曲线之间的区域、其他旋转轴及反常积分应用暂未开放。</p>
      </> : null}
      {draft.task === 'function_study' ? <label>区间端点<select aria-label="区间端点" value={draft.intervalType ?? 'closed'} onChange={e => update({ intervalType: e.target.value as ManualIntegralDraft['intervalType'] })}><option value="closed">闭区间 [a,b]</option><option value="open">开区间 (a,b)</option><option value="left_open">左开右闭 (a,b]</option><option value="right_open">左闭右开 [a,b)</option></select></label> : null}
      {['integral','function_study','geometric_area','rotation_volume','double_integral','triple_integral'].includes(draft.task) && !(draft.task==='double_integral' && draft.doubleMode==='pieces') ? <div className={styles.bounds}>
        <MathExpressionInput label={draft.task === 'triple_integral' ? tripleCartesian ? 'x 下限' : '极角 theta 下限' : draft.task === 'double_integral' ? polarMode ? '极角下限 theta' : `外层下限 ${outerVariable}` : ['function_study','geometric_area','rotation_volume'].includes(draft.task) ? '区间下限' : '积分下限'} value={draft.lower} allowInfinity={(draft.task==='integral' && draft.integralMode==='improper' || draft.task==='double_integral' && draft.doubleMode==='improper')} variables={[]} onChange={lower => update({ lower })}
          placeholder="例如 0、1/3" keyboard={false} apiRef={lowerHandle} onActivate={() => setActiveField('lower')} />
        <MathExpressionInput label={draft.task === 'triple_integral' ? tripleCartesian ? 'x 上限' : '极角 theta 上限' : draft.task === 'double_integral' ? polarMode ? '极角上限 theta' : `外层上限 ${outerVariable}` : ['function_study','geometric_area','rotation_volume'].includes(draft.task) ? '区间上限' : '积分上限'} value={draft.upper} allowInfinity={(draft.task==='integral' && draft.integralMode==='improper' || draft.task==='double_integral' && draft.doubleMode==='improper')} variables={[]} onChange={upper => update({ upper })}
          placeholder="例如 2、pi" keyboard={false} apiRef={upperHandle} onActivate={() => setActiveField('upper')} />
      </div> : draft.task === 'proof' ? <p>按所选证明类型填写函数/表达式、区间与命题；未填字段不会补默认值。</p> : draft.task === 'curve_surface_integral' ? <p>按所选积分类型填写参数、边界、分量与定向；未填字段不会补默认值。</p> : draft.task === 'space_geometry' ? <p>按所选空间对象填写点、向量或平面系数；坐标必须完整，不补默认值。</p> : draft.task === 'antiderivative' ? <p className={styles.note}>不定积分不需要上下限；任意常数 C 会保留在答案中。</p> : draft.task === 'limit' ? <p>区分有限极限、无穷发散、左右不一致与无法判定；趋近点无定义不等于没有极限。</p> : draft.task === 'higher_derivative' ? <p>支持显式单变量函数1至10阶普通导数；公式仅在原式相应阶可导处适用。</p> : draft.task === 'continuity' ? <p>连续性检查分别保留函数值和左右极限，不会自动填补单点定义。</p> : draft.task === 'implicit_normal' ? <p>光滑点使用梯度确定切线与法线；水平、竖直方向单独处理。</p> : draft.task === 'double_integral' ? <p>区域与上下限按完整区间核验，不能以交换微分符号代替同一区域的重新定限。</p> : draft.task === 'triple_integral' ? <p>外层积分限先显示；中层与最内层在下方填写。区域边界与次序逐层核验。</p> : draft.task === 'multivariable_extrema' ? <p>驻点、奇异约束点与极值分类分别核验，不以一次数值优化代替候选全集。</p> : draft.task === 'multivariable' ? <p>一阶偏导、全微分、方向导数和梯度分别核验，不将多元问题替换成单变量或最优化示例。</p> : draft.task === 'ode' ? <p>不自动取多解列表的第一支；未给初值时求解族，给定条件仍会逐条核验。</p> : ['geometric_area','rotation_volume'].includes(draft.task) ? <p>按完整区域和明确旋转轴计算；不支持两条非零边界之间的区域。</p> : draft.task === 'taylor' ? <p>展示精确系数、展开式、经核验的余项及局部观察区间。</p> : draft.task === 'series_convergence' ? <p>只支持以 n 为通项的显式级数；结论由符号判别给出，部分和仅用于观察，未判定时保留原因。</p> : draft.task === 'power_series' ? <p>收敛半径与端点分别核验；端点必须逐点代入原级数，和函数不越出收敛域。</p> : draft.task === 'fourier_series' ? <p>傅里叶系数按给定完整区间计算，间断点与端点按狄利克雷定理说明，不以部分和代替收敛性结论。</p> : <p>求双侧有限导数；不支持的边界点或不可导点会明确提示。</p>}
      {draft.task === 'double_integral' && draft.doubleMode!=='pieces' ? <div className={styles.bounds}>
        <MathExpressionInput label={polarMode ? '极径下界 r' : `内层下界 ${innerVariable}`}  value={draft.innerLower ?? ''} allowInfinity={draft.doubleMode==='improper'} variables={draft.doubleMode==='improper' || draft.doubleMode==='polar_improper' ? [] : [outerVariable]} onChange={innerLower=>update({innerLower})} placeholder={`如 0 或 ${draft.doubleOuter ?? 'x'}^2；只能含外层变量`} keyboard={false} apiRef={innerLowerHandle} onActivate={()=>setActiveField('innerLower')} />
        <MathExpressionInput label={polarMode ? '极径上界 r' : `内层上界 ${innerVariable}`}  value={draft.innerUpper ?? ''} allowInfinity={draft.doubleMode==='improper' || draft.doubleMode==='polar_improper'} variables={draft.doubleMode==='improper' || draft.doubleMode==='polar_improper' ? [] : [outerVariable]} onChange={innerUpper=>update({innerUpper})} placeholder={`如 1 或 ${draft.doubleOuter ?? 'x'}；不能填内层变量自身`} keyboard={false} apiRef={innerUpperHandle} onActivate={()=>setActiveField('innerUpper')} />
      </div> : null}
      {draft.task === 'triple_integral' ? <>
        <div className={styles.bounds}>
          <MathExpressionInput label={tripleMiddleVariable === 'y' ? (tripleMode === 'z_simple' ? 'y 下界' : 'y 下限') : tripleMiddleVariable === 'r' ? '半径 r 下界' : '极角 phi 下限'} value={draft.innerLower ?? ''} variables={tripleMiddleVariables} onChange={innerLower=>update({innerLower})} placeholder={tripleMiddleVariables.length ? `可含 ${tripleMiddleVariables.join('、')}，或为常数` : '必须是常数'} keyboard={false} apiRef={innerLowerHandle} onActivate={()=>setActiveField('innerLower')} />
          <MathExpressionInput label={tripleMiddleVariable === 'y' ? (tripleMode === 'z_simple' ? 'y 上界' : 'y 上限') : tripleMiddleVariable === 'r' ? '半径 r 上界' : '极角 phi 上限'} value={draft.innerUpper ?? ''} variables={tripleMiddleVariables} onChange={innerUpper=>update({innerUpper})} placeholder={tripleMiddleVariables.length ? `可含 ${tripleMiddleVariables.join('、')}，或为常数` : '必须是常数'} keyboard={false} apiRef={innerUpperHandle} onActivate={()=>setActiveField('innerUpper')} />
        </div>
        <div className={styles.bounds}>
          <MathExpressionInput label={tripleInnerVariable === 'z' ? 'z 下界' : '径向 rho 下界'} value={draft.tripleInnerLower ?? ''} variables={tripleInnerVariables} onChange={tripleInnerLower=>update({tripleInnerLower})} placeholder={tripleInnerVariables.length ? `可含 ${tripleInnerVariables.join('、')}` : '必须是常数'} keyboard={false} apiRef={tripleInnerLowerHandle} onActivate={()=>setActiveField('tripleInnerLower')} />
          <MathExpressionInput label={tripleInnerVariable === 'z' ? 'z 上界' : '径向 rho 上界'} value={draft.tripleInnerUpper ?? ''} variables={tripleInnerVariables} onChange={tripleInnerUpper=>update({tripleInnerUpper})} placeholder={tripleInnerVariables.length ? `可含 ${tripleInnerVariables.join('、')}` : '必须是常数'} keyboard={false} apiRef={tripleInnerUpperHandle} onActivate={()=>setActiveField('tripleInnerUpper')} />
        </div>
      </> : null}
      <p className={styles.note}>{draft.task === 'proof' ? '证明结果区分已认证、已否定、局部步骤通过、无效与未认证；图形与抽样只辅助观察，不代替证明。' : draft.task === 'curve_surface_integral' ? '积分值由符号积分与独立数值复核给出；曲线、曲面与边界图形为有限采样，不代替原题条件。' : draft.task === 'space_geometry' ? '空间几何结果由符号向量运算与方程求解给出；图形只做有限范围采样，距离、夹角、交线与位置关系不以像素判定。' : draft.task === 'integral' ? '有限定积分与反常积分分别选择输入类型；原式定义域、瑕点和收敛性单独检查，不会自动补条件。' : draft.task === 'triple_integral' ? '三重积分检查完整区域、偏序关系与连续实定义；柱坐标和球坐标自动乘雅可比。数值积分只作独立复核，不能代替全域证明。' : draft.task === 'double_integral' ? '普通二重积分检查连续实定义；反常模式单独检查原式定义域和绝对收敛，区域条件必须完整。' : draft.task === 'multivariable_extrema' ? '完整约束必须保留；二阶判别不足不等于无极值，局部极值不等于全局最值。' : draft.task === 'multivariable' ? '区分偏导、可微充分条件和方向定义；不能把形式梯度内积当作所有点的方向导数。' : draft.task === 'ode' ? '代回原方程和条件核验；多个分支不默认选第一支，不将已核验的一个解当作唯一性证明。' : ['geometric_area','rotation_volume'].includes(draft.task) ? '几何面积不作正负抵消；旋转轴与区域定义按已确认条件计算，不能互相替代。' : draft.task === 'taylor' ? '余项阶只说明展开点附近的性质；观察区间不等于保证精度的范围，数值抽查不是误差上界。' : draft.task === 'series_convergence' ? '符号判别与部分和观察分开；未判定时保存原题与原因，不猜测敛散性。' : draft.task === 'power_series' ? '收敛半径、收敛域、端点与和函数分别核验；端点不自动并入收敛域。' : draft.task === 'fourier_series' ? '系数按给定区间计算；周期延拓、间断点与端点跳跃单独说明。' : draft.task === 'function_study' ? '先按原式定义域分段，再检查端点、驻点与不可导点；未取到的上下确界不会显示成最值。' : draft.task === 'implicit_normal' ? '确认完整研究点和分支；图形用于局部观察，直线方程由内核计算。' : draft.task === 'continuity' ? '先确认该点定义；图像仅辅助观察，不替代单点值与极限的核对。' : draft.task === 'limit' ? '输入趋近点和方向；数值图像用于辅助观察，结论由极限内核给出。' : draft.task === 'derivative' ? '输入单变量实函数和求导点，展示求导、代入与切线；差商仅作辅助观察。' : '当前输入单变量实函数；图形用于观察原函数族，符号求导用于核对。'}</p>
      <p className={styles.note}>{draft.task === 'proof' ? '证明条件与综合题步骤直接键入；变量固定为 x，步骤每行一个等式。' : draft.task === 'curve_surface_integral' ? '参数、边界与场分量直接键入；曲线用 t，显式曲面用 x、y，参数曲面用 u、v。' : draft.task === 'space_geometry' && !spaceSurface
        ? '点、向量与平面系数直接键入，用逗号分隔；切换到曲面类型后可使用数学键盘编辑方程。'
        : draft.task === 'integral'
        ? '三个输入框共用一个数学键盘：点到哪个框，键盘就作用于哪个框。'
        : '输入框与下方数学键盘联动：点进输入框后，键盘即作用于该字段。'}</p>
    </fieldset>
    <div className={styles.actions}>
      <button type="button" className={styles.primary} disabled={busy !== null} onClick={() => void prepare()}>{busy === 'preview' ? '正在检查条件…' : '预览并确认题目'}</button>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {busy ? <p className={styles.busy} role="status">{busy === 'compute' ? '正在调用本地计算内核，完成后进入过程展示。' : '正在校验公式与条件，尚未开始计算。'}</p> : null}
    </div>
    {preview ? <section className={styles.confirmation} aria-label="确认题目" ref={confirmationSection}>
      <h3 ref={confirmation} tabIndex={-1}>确认这是你要计算的题目</h3>
      <p>高等数学 / {draft.task === 'proof' ? '证明与综合题' : draft.task === 'curve_surface_integral' ? '曲线与曲面积分' : draft.task === 'space_geometry' ? '空间解析几何' : ['double_integral','triple_integral'].includes(draft.task) ? '重积分' : draft.task === 'multivariable_extrema' ? '多元极值' : draft.task === 'multivariable' ? '多元微分' : draft.task === 'ode' ? '微分方程' : ['geometric_area','rotation_volume'].includes(draft.task) ? '定积分应用' : ['taylor','series_convergence','power_series','fourier_series'].includes(draft.task) ? '级数与展开' : draft.task === 'function_study' ? '函数研究' : draft.task === 'implicit_normal' ? '切线与法线' : draft.task === 'continuity' ? '连续性' : draft.task === 'limit' ? '极限' : ['derivative', 'higher_derivative'].includes(draft.task) ? '导数' : '积分'} / {preview.data.label} {draft.task === 'proof' ? `· ${PROOF_KIND_LABELS[proofKind]}` : draft.task === 'curve_surface_integral' ? `· ${CURVE_SURFACE_KIND_LABELS[integralKind]}` : draft.task === 'space_geometry' ? `· ${SPACE_KIND_LABELS[spaceKind]}` : ['implicit_normal','geometric_area','rotation_volume'].includes(draft.task) ? '· 区域坐标 x、y' : ['series_convergence','power_series'].includes(draft.task) ? '· 通项变量 n' : draft.task === 'fourier_series' ? '· 函数变量 x' : `· 计算变量 ${preview.data.conditions.variable ?? preview.data.conditions.independent_variable ?? preview.data.conditions.variables ?? preview.data.conditions.outer_variable ?? preview.data.conditions.region_mode}`}</p>
      <div className={styles.formula}><Formula tex={preview.data.latex} block /></div>
      <p>{preview.data.question}</p>
      <p>如有遗漏或错误，请修改上方字段；修改后需要重新预览与确认。</p>
      <label className={styles.checkbox}><input type="checkbox" checked={confirmed} disabled={busy !== null} onChange={e => setConfirmed(e.target.checked)} />{draft.task === 'proof' ? '我已核对证明类型、函数/表达式、区间、命题与全部条件，没有省略前提' : draft.task === 'curve_surface_integral' ? '我已核对积分类型、全部参数/边界/场分量和定向，没有省略条件' : draft.task === 'space_geometry' ? '我已核对空间对象类型、全部点/向量/平面系数和曲面方程，没有省略条件' : draft.task === 'triple_integral' ? '我已核对被积函数、区域模式、三层积分限及变量依赖，没有遗漏区域限制' : draft.task === 'double_integral' ? '我已核对被积函数、区域模式、全部积分限或分片，以及换序要求，没有遗漏区域限制' : draft.task === 'series_convergence' ? '我已核对通项、起始项和全部已知条件，没有省略外层限制' : draft.task === 'power_series' ? '我已核对系数、中心、起始项和求解目标' : draft.task === 'fourier_series' ? '我已核对函数、完整区间和展开阶数' : draft.task === 'multivariable_extrema' ? '我已核对目标函数、研究范围和全部约束，没有省略附加条件' : draft.task === 'multivariable' ? '我已核对变量顺序、求值点和全部方向条件' : draft.task === 'ode' ? '我已核对方程、自变量和全部条件' : ['geometric_area','rotation_volume'].includes(draft.task) ? '我已核对区域、完整区间和旋转条件' : draft.task === 'taylor' ? '我已核对函数、精确展开点和阶数' : draft.task === 'function_study' ? '我已核对函数、区间和端点开闭' : draft.task === 'implicit_normal' ? '我已核对曲线、完整研究点和分支' : draft.task === 'continuity' ? '我已核对公式、研究点和单点定义' : draft.task === 'higher_derivative' ? '我已核对公式、阶数和可选求值点' : draft.task === 'limit' ? '我已核对公式、趋近点和方向' : draft.task === 'derivative' ? '我已核对公式、求导点和全部条件' : '我已核对公式、积分变量和全部条件'}</label>
      <button type="button" className={styles.primary} disabled={!confirmed || busy !== null} onClick={() => void compute()}>{busy === 'compute' ? '内核正在计算…' : '确认并计算'}</button>
    </section> : null}
    {(draft.task === 'space_geometry' && !spaceSurface) || draft.task === 'curve_surface_integral' || draft.task === 'proof' ? null : <section className={styles.keyboardPanel} aria-label="共用数学键盘">
      <div className={styles.keyboardHeading}>
        <p>数学键盘 · 正在编辑<strong>{draft.task === 'space_geometry' ? '曲面方程' : FIELD_LABELS[activeField]}</strong></p>
        <button type="button" aria-expanded={keyboardOpen} onClick={() => setKeyboardOpen(open => !open)}>
          {keyboardOpen ? '收起键盘' : '展开键盘'}
        </button>
      </div>
      {keyboardOpen ? <MathKeyboard label={draft.task === 'space_geometry' ? '曲面方程' : FIELD_LABELS[activeField]}
        variables={draft.task === 'triple_integral' ? activeField==='expression' ? ['x','y','z'] : ['tripleInnerLower','tripleInnerUpper'].includes(activeField) ? tripleInnerVariables : ['innerLower','innerUpper'].includes(activeField) ? tripleMiddleVariables : [] : draft.task === 'double_integral' ? activeField==='expression' ? ['x','y'] : ['xMap','yMap'].includes(activeField) ? ['u','v'] : ['eventInnerLower','eventInnerUpper'].includes(activeField) ? [draft.doubleOuter ?? 'x'] : ['innerLower','innerUpper'].includes(activeField) ? draft.doubleMode==='improper' || draft.doubleMode==='polar_improper' ? [] : [outerVariable] : [] : activeField === 'constraint' || (activeField === 'expression' && draft.task === 'multivariable_extrema') ? ['x','y'] : activeField === 'expression' ? draft.task === 'space_geometry' ? ['x','y','z'] : draft.task === 'series_convergence' || draft.task === 'power_series' ? ['n'] : draft.task === 'fourier_series' ? ['x'] : draft.task === 'multivariable' ? (draft.multiVariables ?? 'x,y').split(',') : draft.task === 'implicit_normal' ? ['x', 'y'] : draft.task === 'ode' ? [draft.variable,'y'] : [draft.variable] : []}
        allowInfinity={((draft.task==='integral' && draft.integralMode==='improper' || draft.task==='double_integral' && draft.doubleMode==='improper') && ['lower','upper','innerLower','innerUpper'].includes(activeField)) || (draft.task==='double_integral' && draft.doubleMode==='polar_improper' && activeField==='innerUpper')} disabled={busy !== null} onPress={key => activeHandle.current?.press(key)} /> : null}
      {activeField === 'constraint' && draft.task === 'multivariable_extrema' && draft.extremaOperation === 'constrained' ? <button type="button" disabled={busy !== null} aria-label="输入约束等号" onClick={()=>constraintHandle.current?.press('=')}>=</button> : null}
    </section>}
  </section>;
}
