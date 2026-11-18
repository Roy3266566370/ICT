import { inspectMath } from './mathKeyboard.ts';

export type IntegralTask = 'integral' | 'antiderivative' | 'derivative' | 'inverse_derivative' | 'limit' | 'parameter_limit' | 'higher_derivative' | 'continuity' | 'implicit_normal' | 'implicit_derivative' | 'parametric_derivative' | 'curvature' | 'asymptote' | 'sequence_limit' | 'arc_length' | 'parametric_arc_length' | 'surface_of_revolution' | 'polar_area' | 'polar_arc_length' | 'function_study' | 'taylor' | 'geometric_area' | 'rotation_volume' | 'integral_function' | 'ode' | 'multivariable' | 'multivariable_extrema' | 'double_integral' | 'triple_integral' | 'series_convergence' | 'power_series' | 'fourier_series' | 'space_geometry' | 'curve_surface_integral' | 'proof';
export type SpaceGeometryKind = 'vector_operations' | 'vector_products' | 'line_from_points' | 'line_point_direction' | 'plane_point_normal' | 'plane_three_points' | 'line_line_relation' | 'line_plane_relation' | 'plane_plane_relation' | 'point_line_distance' | 'point_plane_distance' | 'line_plane_projection' | 'surface_tangent' | 'quadric_surface';
export type SpaceFieldKey = 'spaceA' | 'spaceB' | 'spaceC' | 'spaceD';
export interface SpaceFieldSpec { key: SpaceFieldKey; condition: string; label: string; placeholder: string; }
export const SPACE_KIND_FIELDS: Record<SpaceGeometryKind, readonly SpaceFieldSpec[]> = {
  vector_operations: [{ key: 'spaceA', condition: 'vector_a', label: '向量 a', placeholder: '如 1,2,3' }, { key: 'spaceB', condition: 'vector_b', label: '向量 b', placeholder: '如 -1,0,2' }],
  vector_products: [{ key: 'spaceA', condition: 'vector_a', label: '向量 a', placeholder: '如 1,0,0' }, { key: 'spaceB', condition: 'vector_b', label: '向量 b', placeholder: '如 0,1,0' }, { key: 'spaceC', condition: 'vector_c', label: '向量 c', placeholder: '如 0,0,1' }],
  line_from_points: [{ key: 'spaceA', condition: 'point_a', label: '点 A', placeholder: '如 0,0,0' }, { key: 'spaceB', condition: 'point_b', label: '点 B', placeholder: '如 1,2,3' }],
  line_point_direction: [{ key: 'spaceA', condition: 'line_point', label: '直线过点', placeholder: '如 1,0,0' }, { key: 'spaceB', condition: 'line_direction', label: '方向向量', placeholder: '如 1,2,3' }],
  plane_point_normal: [{ key: 'spaceA', condition: 'point', label: '平面过点', placeholder: '如 1,2,3' }, { key: 'spaceB', condition: 'normal', label: '法向量', placeholder: '如 2,3,4' }],
  plane_three_points: [{ key: 'spaceA', condition: 'point_a', label: '点 A', placeholder: '如 1,0,0' }, { key: 'spaceB', condition: 'point_b', label: '点 B', placeholder: '如 0,1,0' }, { key: 'spaceC', condition: 'point_c', label: '点 C', placeholder: '如 0,0,1' }],
  line_line_relation: [{ key: 'spaceA', condition: 'point_a', label: '直线1过点', placeholder: '如 0,0,0' }, { key: 'spaceB', condition: 'direction_a', label: '直线1方向', placeholder: '如 1,0,0' }, { key: 'spaceC', condition: 'point_b', label: '直线2过点', placeholder: '如 0,0,0' }, { key: 'spaceD', condition: 'direction_b', label: '直线2方向', placeholder: '如 0,1,0' }],
  line_plane_relation: [{ key: 'spaceA', condition: 'line_point', label: '直线过点', placeholder: '如 0,0,0' }, { key: 'spaceB', condition: 'line_direction', label: '直线方向', placeholder: '如 0,0,1' }, { key: 'spaceC', condition: 'plane', label: '平面 (a,b,c,d)', placeholder: '如 0,0,1,-2' }],
  plane_plane_relation: [{ key: 'spaceA', condition: 'plane', label: '平面1 (a,b,c,d)', placeholder: '如 1,0,0,0' }, { key: 'spaceB', condition: 'plane2', label: '平面2 (a,b,c,d)', placeholder: '如 0,1,0,0' }],
  point_line_distance: [{ key: 'spaceA', condition: 'point', label: '点 P', placeholder: '如 0,1,0' }, { key: 'spaceB', condition: 'line_point', label: '直线过点', placeholder: '如 0,0,0' }, { key: 'spaceC', condition: 'line_direction', label: '直线方向', placeholder: '如 1,0,0' }],
  point_plane_distance: [{ key: 'spaceA', condition: 'point', label: '点 P', placeholder: '如 0,0,0' }, { key: 'spaceB', condition: 'plane', label: '平面 (a,b,c,d)', placeholder: '如 1,0,0,-2' }],
  line_plane_projection: [{ key: 'spaceA', condition: 'line_point', label: '直线过点', placeholder: '如 0,0,1' }, { key: 'spaceB', condition: 'line_direction', label: '直线方向', placeholder: '如 1,0,1' }, { key: 'spaceC', condition: 'plane', label: '平面 (a,b,c,d)', placeholder: '如 0,0,1,0' }],
  surface_tangent: [{ key: 'spaceA', condition: 'point', label: '曲面上的点 P', placeholder: '如 1,1,2' }],
  quadric_surface: [],
};
export const SPACE_SURFACE_KINDS: readonly SpaceGeometryKind[] = ['surface_tangent', 'quadric_surface'];
export type CurveSurfaceIntegralKind = 'line_scalar' | 'line_vector' | 'surface_scalar_graph' | 'surface_scalar_param' | 'surface_flux_graph' | 'surface_flux_param' | 'green' | 'gauss' | 'stokes';
export type CurveSurfaceFieldKey = 'curveX' | 'curveY' | 'curveZ' | 'surfaceZ' | 'surfaceX' | 'surfaceY' | 'surfaceZuv' | 'fieldP' | 'fieldQ' | 'fieldR' | 'lower' | 'upper' | 'innerLower' | 'innerUpper' | 'tripleInnerLower' | 'tripleInnerUpper';
export interface CurveSurfaceFieldSpec { key: CurveSurfaceFieldKey; condition: string; label: string; placeholder: string; }
export const CURVE_SURFACE_SCALAR_KINDS: readonly CurveSurfaceIntegralKind[] = ['line_scalar', 'surface_scalar_graph', 'surface_scalar_param'];
export const CURVE_SURFACE_FORMULA_KINDS: readonly CurveSurfaceIntegralKind[] = ['green', 'gauss', 'stokes'];
export const CURVE_SURFACE_ORIENTATIONS: Partial<Record<CurveSurfaceIntegralKind, { value: string; label: string }[]>> = {
  line_vector: [{ value: 'forward', label: '参数增大方向' }, { value: 'reverse', label: '反向' }],
  surface_flux_graph: [{ value: 'up', label: '上侧' }, { value: 'down', label: '下侧' }],
  surface_flux_param: [{ value: 'positive', label: '正向 r_u×r_v' }, { value: 'negative', label: '反向' }],
  green: [{ value: 'positive', label: '正向（逆时针）' }, { value: 'negative', label: '负向（顺时针）' }],
  stokes: [{ value: 'up', label: '上侧（边界逆时针）' }, { value: 'down', label: '下侧（边界顺时针）' }],
};
export const CURVE_SURFACE_KIND_LABELS: Record<CurveSurfaceIntegralKind, string> = {
  line_scalar: '第一类曲线积分（对弧长）',
  line_vector: '第二类曲线积分（对坐标）',
  surface_scalar_graph: '第一类曲面积分（显式曲面）',
  surface_scalar_param: '第一类曲面积分（参数曲面）',
  surface_flux_graph: '第二类曲面积分（显式曲面）',
  surface_flux_param: '第二类曲面积分（参数曲面）',
  green: 'Green 公式',
  gauss: 'Gauss 公式',
  stokes: 'Stokes 公式',
};
const LINE_FIELDS: readonly CurveSurfaceFieldSpec[] = [
  { key: 'curveX', condition: 'curve_x', label: '曲线 x(t)', placeholder: '例如 t 或 2*cos(t)' },
  { key: 'curveY', condition: 'curve_y', label: '曲线 y(t)', placeholder: '例如 t 或 2*sin(t)' },
  { key: 'curveZ', condition: 'curve_z', label: '曲线 z(t)（平面曲线填0）', placeholder: '例如 0 或 t' },
  { key: 'lower', condition: 't_lower', label: 't 下限', placeholder: '例如 0' },
  { key: 'upper', condition: 't_upper', label: 't 上限', placeholder: '例如 pi' },
];
const GRAPH_SURFACE_FIELDS: readonly CurveSurfaceFieldSpec[] = [
  { key: 'surfaceZ', condition: 'surface_z', label: '曲面 z(x,y)', placeholder: '例如 x+y 或 x^2+y^2' },
  { key: 'lower', condition: 'x_lower', label: 'x 下限', placeholder: '例如 0' },
  { key: 'upper', condition: 'x_upper', label: 'x 上限', placeholder: '例如 1' },
  { key: 'innerLower', condition: 'y_lower', label: 'y 下界', placeholder: '例如 0 或 x^2' },
  { key: 'innerUpper', condition: 'y_upper', label: 'y 上界', placeholder: '例如 1 或 x' },
];
const PARAM_SURFACE_FIELDS: readonly CurveSurfaceFieldSpec[] = [
  { key: 'surfaceX', condition: 'surface_x', label: '曲面 x(u,v)', placeholder: '例如 u' },
  { key: 'surfaceY', condition: 'surface_y', label: '曲面 y(u,v)', placeholder: '例如 v' },
  { key: 'surfaceZuv', condition: 'surface_z_uv', label: '曲面 z(u,v)', placeholder: '例如 u+v 或 u^2+v^2' },
  { key: 'lower', condition: 'u_lower', label: 'u 下限', placeholder: '例如 0' },
  { key: 'upper', condition: 'u_upper', label: 'u 上限', placeholder: '例如 1' },
  { key: 'innerLower', condition: 'v_lower', label: 'v 下限', placeholder: '例如 0' },
  { key: 'innerUpper', condition: 'v_upper', label: 'v 上限', placeholder: '例如 1' },
];
const PQR_FIELDS: readonly CurveSurfaceFieldSpec[] = [
  { key: 'fieldP', condition: 'field_p', label: 'P', placeholder: '例如 -y' },
  { key: 'fieldQ', condition: 'field_q', label: 'Q', placeholder: '例如 x' },
  { key: 'fieldR', condition: 'field_r', label: 'R', placeholder: '例如 0' },
];
const PQ_FIELDS: readonly CurveSurfaceFieldSpec[] = [
  { key: 'fieldP', condition: 'field_p', label: 'P(x,y)', placeholder: '例如 -y' },
  { key: 'fieldQ', condition: 'field_q', label: 'Q(x,y)', placeholder: '例如 x' },
];
const RECT_FIELDS: readonly CurveSurfaceFieldSpec[] = [
  { key: 'lower', condition: 'x_lower', label: 'x 下限', placeholder: '例如 0' },
  { key: 'upper', condition: 'x_upper', label: 'x 上限', placeholder: '例如 1' },
  { key: 'innerLower', condition: 'y_lower', label: 'y 下界', placeholder: '例如 0' },
  { key: 'innerUpper', condition: 'y_upper', label: 'y 上界', placeholder: '例如 1' },
];
const BOX_FIELDS: readonly CurveSurfaceFieldSpec[] = [
  { key: 'lower', condition: 'x_lower', label: 'x 下限', placeholder: '例如 0' },
  { key: 'upper', condition: 'x_upper', label: 'x 上限', placeholder: '例如 1' },
  { key: 'innerLower', condition: 'y_lower', label: 'y 下限', placeholder: '例如 0' },
  { key: 'innerUpper', condition: 'y_upper', label: 'y 上限', placeholder: '例如 1' },
  { key: 'tripleInnerLower', condition: 'z_lower', label: 'z 下限', placeholder: '例如 0' },
  { key: 'tripleInnerUpper', condition: 'z_upper', label: 'z 上限', placeholder: '例如 1' },
];
const STOKES_REGION_FIELDS: readonly CurveSurfaceFieldSpec[] = [
  { key: 'surfaceZ', condition: 'surface_z', label: '曲面 z(x,y)', placeholder: '例如 0 或 x+y' },
  { key: 'lower', condition: 'x_lower', label: 'x 下限', placeholder: '例如 0' },
  { key: 'upper', condition: 'x_upper', label: 'x 上限', placeholder: '例如 1' },
  { key: 'innerLower', condition: 'y_lower', label: 'y 下限', placeholder: '例如 0' },
  { key: 'innerUpper', condition: 'y_upper', label: 'y 上限', placeholder: '例如 1' },
];
export const CURVE_SURFACE_KIND_FIELDS: Record<CurveSurfaceIntegralKind, readonly CurveSurfaceFieldSpec[]> = {
  line_scalar: LINE_FIELDS,
  line_vector: [...LINE_FIELDS, ...PQR_FIELDS],
  surface_scalar_graph: GRAPH_SURFACE_FIELDS,
  surface_scalar_param: PARAM_SURFACE_FIELDS,
  surface_flux_graph: [...GRAPH_SURFACE_FIELDS, ...PQR_FIELDS],
  surface_flux_param: [...PARAM_SURFACE_FIELDS, ...PQR_FIELDS],
  green: [...PQ_FIELDS, ...RECT_FIELDS],
  gauss: [...PQR_FIELDS, ...BOX_FIELDS],
  stokes: [...PQR_FIELDS, ...STOKES_REGION_FIELDS],
};
const CURVE_SURFACE_FIELD_VARIABLES: Record<string, readonly string[]> = {
  curve_x: ['t'], curve_y: ['t'], curve_z: ['t'],
  surface_z: ['x', 'y'], surface_x: ['u', 'v'], surface_y: ['u', 'v'], surface_z_uv: ['u', 'v'],
  y_lower: ['x'], y_upper: ['x'],
  field_p: ['x', 'y', 'z'], field_q: ['x', 'y', 'z'], field_r: ['x', 'y', 'z'],
};
export function curveSurfaceFieldError(kind: CurveSurfaceIntegralKind, field: CurveSurfaceFieldSpec, value: string | undefined): string | null {
  const raw = (value ?? '').trim();
  if (!raw) return `请填写${field.label}。`;
  let variables = CURVE_SURFACE_FIELD_VARIABLES[field.condition] ?? [];
  if (kind === 'green' && (field.condition === 'field_p' || field.condition === 'field_q')) variables = ['x', 'y'];
  if (kind === 'stokes' && (field.condition === 'y_lower' || field.condition === 'y_upper')) variables = [];
  if (inspectMath(raw, variables).error) {
    return variables.length ? `${field.label}只能含 ${variables.join('、')} 或常数。` : `${field.label}必须是有限实常数表达式。`;
  }
  return null;
}
export type ProofKind = 'ivt_root' | 'ivt_unique_root' | 'rolle' | 'mvt' | 'cauchy_mvt' | 'monotone_inequality' | 'inequality' | 'counterexample' | 'steps';
export const PROOF_KIND_LABELS: Record<ProofKind, string> = {
  ivt_root: '零点存在性（介值定理）',
  ivt_unique_root: '零点存在且唯一（介值定理+单调性）',
  rolle: '罗尔定理',
  mvt: '拉格朗日中值定理',
  cauchy_mvt: '柯西中值定理',
  monotone_inequality: '函数不等式（单调性，f≥0）',
  inequality: '函数不等式（两个函数作差）',
  counterexample: '反例否定全称命题',
  steps: '综合题步骤核对',
};
export const PROOF_SINGLE_KINDS: readonly ProofKind[] = ['ivt_root', 'ivt_unique_root', 'rolle', 'mvt', 'monotone_inequality'];
export const PROOF_BOUND_KINDS: readonly ProofKind[] = ['ivt_root', 'ivt_unique_root', 'rolle', 'mvt', 'cauchy_mvt', 'monotone_inequality', 'inequality'];
export const PROOF_RELATION_KINDS: readonly ProofKind[] = ['inequality', 'counterexample'];
export function proofStepError(raw: string): string | null {
  const lines = raw.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length < 1 || lines.length > 20) return '请填写1至20行证明步骤。';
  for (const [index, line] of lines.entries()) {
    const parts = line.split('=');
    if (parts.length !== 2 || parts.some(part => !part.trim())) return `第 ${index + 1} 步必须是 lhs=rhs 形式。`;
    if (parts.some(part => inspectMath(part, ['x']).error)) return `第 ${index + 1} 步只能使用变量 x，或为代数式。`;
  }
  return null;
}
export type TripleMode = 'box' | 'z_simple' | 'cylindrical' | 'spherical';
export interface ManualIntegralDraft {
  task: IntegralTask;
  expression: string;
  xExpression?: string;
  yExpression?: string;
  variable: string;
  lower: string;
  upper: string;
  point?: string;
  order?: string;
  parameter?: string;
  targetValue?: string;
  valueMode?: 'expression' | 'undefined' | 'value';
  pointValue?: string;
  pointY?: string;
  initialConditions?: string;
  doubleOuter?: 'x' | 'y';
  doubleMode?: 'strip' | 'pieces' | 'polar' | 'improper' | 'polar_improper' | 'strip_improper' | 'affine' | 'change_variables';
  tripleMode?: TripleMode;
  tripleInnerLower?: string;
  tripleInnerUpper?: string;
  doubleApplication?: 'integral' | 'mass' | 'centroid' | 'inertia' | 'probability';
  inertiaAxis?: '' | 'x' | 'y' | 'origin';
  xMap?: string;
  yMap?: string;
  eventOuterLower?: string;
  eventOuterUpper?: string;
  eventInnerLower?: string;
  eventInnerUpper?: string;
  piecesText?: string;
  swapOrder?: boolean;
  integralMode?: 'proper' | 'improper';
  innerLower?: string;
  innerUpper?: string;
  extremaOperation?: 'unconstrained' | 'constrained';
  extremaConstraint?: string;
  multiVariables?: 'x,y' | 'x,y,z';
  multiOperation?: 'partial' | 'differential' | 'directional' | 'gradient';
  partialVariable?: string;
  multiPoint?: string;
  multiDirection?: string;
  directionLimit?: 'forward' | 'two_sided';
  regionKind?: '' | 'between_axis' | 'vertical_inequality' | 'between_curves';
  lowerExpression?: string;
  rotationAxis?: '' | 'x' | 'y';
  intervalType?: 'closed' | 'open' | 'left_open' | 'right_open';
  side?: 'both' | 'left' | 'right';
  indexStart?: string;
  powerGoal?: 'radius' | 'sum';
  powerCenter?: string;
  spaceKind?: SpaceGeometryKind;
  spaceA?: string;
  spaceB?: string;
  spaceC?: string;
  spaceD?: string;
  integralKind?: CurveSurfaceIntegralKind;
  curveX?: string;
  curveY?: string;
  curveZ?: string;
  surfaceZ?: string;
  surfaceX?: string;
  surfaceY?: string;
  surfaceZuv?: string;
  fieldP?: string;
  fieldQ?: string;
  fieldR?: string;
  integralOrientation?: string;
  proofKind?: ProofKind;
  proofLeft?: string;
  proofRight?: string;
  proofRelation?: string;
  proofSteps?: string;
  proofStatement?: string;
}
export interface ManualIntegralPreview {
  task: IntegralTask;
  label: string;
  conditions: Record<string, string>;
  latex: string;
  question: string;
}

export function spaceFieldSize(condition: string): number {
  return ['plane', 'plane2'].includes(condition) ? 4 : 3;
}

export function spaceFieldError(value: string | undefined, label: string, size: number): string | null {
  const parts = (value ?? '').trim().split(/[,，;；\s]+/).filter(Boolean);
  if (parts.length !== size) return `${label}需要${size}个分量，用逗号分隔。`;
  for (const part of parts) {
    if (inspectMath(part, []).error) return `请检查${label}的分量“${part}”，只能填写有限实常数表达式。`;
  }
  return null;
}

export function manualConditions(draft: ManualIntegralDraft): Record<string, string> {
  if (draft.task === 'space_geometry') {
    const kind = draft.spaceKind ?? 'vector_operations';
    const conditions: Record<string, string> = { geometry_kind: kind };
    for (const field of SPACE_KIND_FIELDS[kind]) conditions[field.condition] = (draft[field.key] ?? '').trim();
    if (kind === 'surface_tangent') conditions.surface = draft.expression.trim();
    if (kind === 'quadric_surface') conditions.expression = draft.expression.trim();
    return conditions;
  }
  if (draft.task === 'curve_surface_integral') {
    const kind = draft.integralKind ?? 'line_scalar';
    const conditions: Record<string, string> = { integral_kind: kind };
    for (const field of CURVE_SURFACE_KIND_FIELDS[kind]) conditions[field.condition] = (draft[field.key] ?? '').trim();
    if (CURVE_SURFACE_SCALAR_KINDS.includes(kind)) conditions.integrand = draft.expression.trim();
    const orientations = CURVE_SURFACE_ORIENTATIONS[kind];
    if (orientations) conditions.orientation = draft.integralOrientation ?? orientations[0]?.value ?? '';
    return conditions;
  }
  if (draft.task === 'proof') {
    const kind = draft.proofKind ?? 'ivt_root';
    const conditions: Record<string, string> = { proof_kind: kind };
    if (PROOF_SINGLE_KINDS.includes(kind)) conditions.expression = draft.expression.trim();
    if (kind === 'cauchy_mvt' || kind === 'inequality' || kind === 'counterexample') {
      conditions.left = draft.proofLeft?.trim() ?? '';
      conditions.right = draft.proofRight?.trim() ?? '';
    }
    if (PROOF_RELATION_KINDS.includes(kind)) conditions.relation = draft.proofRelation ?? '>=';
    if (PROOF_BOUND_KINDS.includes(kind)) {
      conditions.lower = draft.lower.trim();
      conditions.upper = draft.upper.trim();
    }
    if (kind === 'counterexample') conditions.point = draft.point?.trim() ?? '';
    if (kind === 'steps') conditions.steps = draft.proofSteps?.trim() ?? '';
    if (draft.proofStatement?.trim()) conditions.statement = draft.proofStatement.trim();
    return conditions;
  }
  if (draft.task === 'series_convergence') return { term: draft.expression.trim(), index_start: draft.indexStart?.trim() ?? '' };
  if (draft.task === 'power_series') return { goal: draft.powerGoal ?? 'radius', coefficient: draft.expression.trim(),
    center: draft.powerCenter?.trim() ?? '', index_start: draft.indexStart?.trim() ?? '' };
  if (draft.task === 'fourier_series') return { expression: draft.expression.trim(), lower: draft.lower.trim(),
    upper: draft.upper.trim(), order: draft.order ?? '3' };
  if (draft.task === 'triple_integral') {
    const integrand = draft.expression.trim();
    const mode = draft.tripleMode ?? 'box';
    const outerLower = draft.lower.trim(), outerUpper = draft.upper.trim();
    const middleLower = draft.innerLower?.trim() ?? '', middleUpper = draft.innerUpper?.trim() ?? '';
    const innerLower = draft.tripleInnerLower?.trim() ?? '', innerUpper = draft.tripleInnerUpper?.trim() ?? '';
    if (mode === 'cylindrical') return { integrand, region_mode: mode, theta_lower: outerLower, theta_upper: outerUpper,
      radius_lower: middleLower, radius_upper: middleUpper, z_lower: innerLower, z_upper: innerUpper };
    if (mode === 'spherical') return { integrand, region_mode: mode, theta_lower: outerLower, theta_upper: outerUpper,
      phi_lower: middleLower, phi_upper: middleUpper, rho_lower: innerLower, rho_upper: innerUpper };
    return { integrand, region_mode: mode, x_lower: outerLower, x_upper: outerUpper,
      y_lower: middleLower, y_upper: middleUpper, z_lower: innerLower, z_upper: innerUpper };
  }
  if (draft.task === 'double_integral') {
    const integrand=draft.expression.trim();
    const swap:Record<string,string>=draft.swapOrder ? {swap_order:'true'} : {};
    let c:Record<string,string>;
    if (draft.doubleMode==='affine' || draft.doubleMode==='change_variables') c={integrand,region_mode:draft.doubleMode,x_map:draft.xMap?.trim() ?? '',y_map:draft.yMap?.trim() ?? '',outer_lower:draft.lower.trim(),outer_upper:draft.upper.trim(),inner_lower:draft.innerLower?.trim() ?? '',inner_upper:draft.innerUpper?.trim() ?? ''};
    else if (draft.doubleMode==='polar' || draft.doubleMode==='polar_improper') c={integrand,region_mode:draft.doubleMode,theta_lower:draft.lower.trim(),theta_upper:draft.upper.trim(),radius_lower:draft.innerLower?.trim() ?? '',radius_upper:draft.innerUpper?.trim() ?? ''};
    else if (draft.doubleMode==='pieces') c={integrand,region_mode:'pieces',outer_variable:draft.doubleOuter ?? 'x',pieces_text:draft.piecesText?.trim() ?? '',...swap};
    else c={integrand,outer_variable:draft.doubleOuter ?? 'x',outer_lower:draft.lower.trim(),outer_upper:draft.upper.trim(),inner_lower:draft.innerLower?.trim() ?? '',inner_upper:draft.innerUpper?.trim() ?? '',...(['improper','strip_improper'].includes(draft.doubleMode ?? '') ? {region_mode:draft.doubleMode!} : {}),...swap};
    if(draft.doubleApplication && draft.doubleApplication!=='integral'){
      c.application=draft.doubleApplication;
      if(draft.doubleApplication==='inertia')c.inertia_axis=draft.inertiaAxis ?? '';
      if(draft.doubleApplication==='probability')Object.assign(c,{event_outer_lower:draft.eventOuterLower?.trim() ?? '',event_outer_upper:draft.eventOuterUpper?.trim() ?? '',event_inner_lower:draft.eventInnerLower?.trim() ?? '',event_inner_upper:draft.eventInnerUpper?.trim() ?? ''});
    }
    return c;
  }
  if (draft.task === 'multivariable_extrema') return {expression:draft.expression.trim(),variables:'x,y',operation:draft.extremaOperation ?? 'unconstrained',...(draft.extremaOperation === 'constrained' ? {constraint:draft.extremaConstraint?.trim() ?? ''} : {})};
  if (draft.task === 'multivariable') return {expression:draft.expression.trim(),variables:draft.multiVariables ?? 'x,y',operation:draft.multiOperation ?? 'partial',...(draft.multiPoint?.trim() ? {point:draft.multiPoint.trim()} : {}),...((draft.multiOperation ?? 'partial') === 'partial' ? {partial_variable:draft.partialVariable ?? 'x'} : {}),...(draft.multiOperation === 'directional' ? {direction:draft.multiDirection?.trim() ?? '',direction_limit:draft.directionLimit ?? 'forward'} : {})};
  if (draft.task === 'ode') return {equation:draft.expression.trim(),independent_variable:draft.variable,initial_conditions:draft.initialConditions?.trim() ?? ''};
  if (['geometric_area','rotation_volume'].includes(draft.task)) return { expression:draft.expression.trim(), lower:draft.lower.trim(), upper:draft.upper.trim(), region_kind:draft.regionKind ?? '', ...(draft.regionKind === 'between_curves' ? { lower_expression:draft.lowerExpression?.trim() ?? '' } : {}), ...(draft.task === 'rotation_volume' ? { rotation_axis:draft.rotationAxis ?? '' } : {}) };
  if (draft.task === 'implicit_normal') return { implicit_expression: draft.expression.trim(), point_x: draft.point?.trim() ?? '', ...(draft.pointY?.trim() ? { point_y: draft.pointY.trim() } : {}) };
  if (draft.task === 'parametric_derivative') return { x_expression: draft.xExpression?.trim() ?? '',
    y_expression: draft.yExpression?.trim() ?? '', point: draft.point?.trim() ?? '', order: draft.order ?? '1' };
  if (draft.task === 'implicit_derivative') return { implicit_expression: draft.expression.trim(),
    point_x: draft.point?.trim() ?? '', ...(draft.pointY?.trim() ? { point_y: draft.pointY.trim() } : {}), order: draft.order ?? '1' };
  if (draft.task === 'parametric_arc_length') return { x_expression: draft.xExpression?.trim() ?? '',
    y_expression: draft.yExpression?.trim() ?? '', lower: draft.lower.trim(), upper: draft.upper.trim() };
  if (['arc_length','surface_of_revolution','polar_area','polar_arc_length'].includes(draft.task)) return { expression: draft.expression.trim(),
    lower: draft.lower.trim(), upper: draft.upper.trim(),
    ...(draft.task === 'surface_of_revolution' ? { rotation_axis: draft.rotationAxis ?? '' } : {}) };
  if (draft.task === 'curvature') return { expression: draft.expression.trim(), point: draft.point?.trim() ?? '' };
  if (['asymptote','sequence_limit'].includes(draft.task)) return { expression: draft.expression.trim() };
  if (draft.task === 'integral_function') return { expression: draft.expression.trim(),
    lower_expression: draft.lower.trim(), upper_expression: draft.upper.trim(),
    ...(draft.point?.trim() ? { point: draft.point.trim() } : {}) };
  if (draft.task === 'parameter_limit') return { expression: draft.expression.trim(), variable: draft.variable,
    point: (draft.point ?? '').trim(), parameter: (draft.parameter ?? '').trim(), target_value: (draft.targetValue ?? '').trim() };
  return { expression: draft.expression.trim(), variable: draft.variable,
    ...(['derivative', 'inverse_derivative', 'limit', 'continuity', 'taylor'].includes(draft.task) ? { point: (draft.point ?? '').trim() } : {}),
    ...(draft.task === 'continuity' ? { value_mode: draft.valueMode ?? 'expression', ...(draft.valueMode === 'value' ? { point_value: draft.pointValue?.trim() ?? '' } : {}) } : {}),
    ...(draft.task === 'taylor' ? { order: draft.order ?? '3' } : {}),
    ...(draft.task === 'higher_derivative' ? { order: draft.order ?? '1', ...(draft.point?.trim() ? { point: draft.point.trim() } : {}) } : {}),
    ...(draft.task === 'limit' ? { side: draft.side ?? 'both' } : {}),
    ...(draft.task === 'function_study' ? { lower: draft.lower.trim(), upper: draft.upper.trim(), interval_type: draft.intervalType ?? 'closed' } : {}),
    ...(draft.task === 'integral' ? { lower: draft.lower.trim(), upper: draft.upper.trim(),...(draft.integralMode==='improper' ? {integral_mode:'improper'} : {}) } : {}) };
}

export function manualInputKey(draft: ManualIntegralDraft): string {
  return JSON.stringify([draft.task, manualConditions(draft)]);
}

export function manualInputError(draft: ManualIntegralDraft): string | null {
  if (draft.task === 'space_geometry') {
    const kind = draft.spaceKind ?? 'vector_operations';
    for (const field of SPACE_KIND_FIELDS[kind]) {
      const invalid = spaceFieldError(draft[field.key], field.label, spaceFieldSize(field.condition));
      if (invalid) return invalid;
    }
    if (kind === 'surface_tangent' || kind === 'quadric_surface') {
      const raw = draft.expression.trim();
      if (!raw) return kind === 'surface_tangent' ? '请填写曲面方程。' : '请填写二次曲面方程。';
      const parts = raw.split('=');
      if (parts.length > 2 || parts.some(part => !part.trim())) return '曲面方程最多有一个等号，且两边不能为空。';
      if (parts.some(part => inspectMath(part, ['x', 'y', 'z']).error)) return '请检查曲面方程，只使用 x、y、z。';
    }
    return null;
  }
  if (draft.task === 'curve_surface_integral') {
    const kind = draft.integralKind ?? 'line_scalar';
    for (const field of CURVE_SURFACE_KIND_FIELDS[kind]) {
      const invalid = curveSurfaceFieldError(kind, field, draft[field.key]);
      if (invalid) return invalid;
    }
    if (CURVE_SURFACE_SCALAR_KINDS.includes(kind)) {
      if (!draft.expression.trim()) return '请填写被积函数。';
      if (inspectMath(draft.expression, ['x', 'y', 'z']).error) return '请检查被积函数，只使用 x、y、z。';
    }
    const orientations = CURVE_SURFACE_ORIENTATIONS[kind];
    const orientation = draft.integralOrientation ?? orientations?.[0]?.value;
    if (orientations && !orientations.some(item => item.value === orientation)) return '请选择该积分类型的定向。';
    return null;
  }
  if (draft.task === 'proof') {
    const kind = draft.proofKind ?? 'ivt_root';
    if (PROOF_SINGLE_KINDS.includes(kind)) {
      if (!draft.expression.trim()) return '请填写函数 f(x)。';
      if (inspectMath(draft.expression, ['x']).error) return '请检查函数 f(x)，只使用变量 x。';
    }
    if (kind === 'cauchy_mvt' || kind === 'inequality' || kind === 'counterexample') {
      if (!draft.proofLeft?.trim()) return '请填写左端函数或左式。';
      if (!draft.proofRight?.trim()) return '请填写右端函数或右式。';
      if (inspectMath(draft.proofLeft, ['x']).error || inspectMath(draft.proofRight, ['x']).error) return '请检查左、右表达式，只使用变量 x。';
    }
    if (PROOF_BOUND_KINDS.includes(kind)) {
      if (!draft.lower.trim() || inspectMath(draft.lower, []).error) return '区间下限必须是有限实常数表达式。';
      if (!draft.upper.trim() || inspectMath(draft.upper, []).error) return '区间上限必须是有限实常数表达式。';
    }
    if (PROOF_RELATION_KINDS.includes(kind)) {
      const allowed = kind === 'inequality' ? ['>=', '<='] : ['>=', '<=', '>', '<', '='];
      if (!allowed.includes(draft.proofRelation ?? '>=')) return '请选择该证明类型允许的关系符号。';
    }
    if (kind === 'counterexample' && (!draft.point?.trim() || inspectMath(draft.point, []).error)) return '反例点必须是有限实常数表达式。';
    if (kind === 'steps') {
      const invalid = proofStepError(draft.proofSteps?.trim() ?? '');
      if (invalid) return invalid;
    }
    if ((draft.proofStatement?.trim().length ?? 0) > 600) return '命题陈述不能超过600字。';
    return null;
  }
  if (draft.task === 'series_convergence' || draft.task === 'power_series') {
    const raw = draft.expression.trim();
    if (!raw) return draft.task === 'series_convergence' ? '请填写级数通项。' : '请填写幂级数系数。';
    if (inspectMath(raw, ['n']).error) return draft.task === 'series_convergence' ? '请检查级数通项，只使用指标 n。' : '请检查幂级数系数，只使用指标 n。';
    const start = (draft.indexStart ?? '').trim();
    if (!/^\d+$/.test(start) || Number(start) > 100) return '起始指标必须是0至100的整数，不自动补默认值。';
    if (draft.task === 'power_series') {
      if (!['radius', 'sum'].includes(draft.powerGoal ?? 'radius')) return '请选择求收敛域或收敛域与和函数。';
      const center = (draft.powerCenter ?? '').trim();
      if (!center || inspectMath(center, []).error) return '请填写有限实展开中心，如 0、-1/2 或 pi。';
    }
    return null;
  }
  if (draft.task === 'fourier_series') {
    const raw = draft.expression.trim();
    if (!raw) return '请填写周期函数表达式。';
    if (inspectMath(raw, ['x']).error) return '请检查傅里叶级数函数，只使用变量 x。';
    for (const [key, label] of [['lower', '区间下限'], ['upper', '区间上限']] as const) {
      if (!draft[key].trim() || inspectMath(draft[key], []).error) return `${label}必须是有限实常数表达式，如 -pi 或 0。`;
    }
    if (!/^(?:[1-9]|1[0-2])$/.test(draft.order ?? '3')) return '傅里叶截断阶数必须是1至12的整数。';
    return null;
  }
  if (draft.task === 'parametric_derivative') {
    if (!draft.xExpression?.trim() || inspectMath(draft.xExpression, ['t']).error) return '请填写 x(t)，只使用参数 t。';
    if (!draft.yExpression?.trim() || inspectMath(draft.yExpression, ['t']).error) return '请填写 y(t)，只使用参数 t。';
    if (!draft.point?.trim() || inspectMath(draft.point, []).error) return '请填写有限参数点 t0，如 1、pi/4。';
    if (!['1','2'].includes(draft.order ?? '1')) return '参数方程求导只支持一阶或二阶。';
    return null;
  }
  if (draft.task === 'implicit_derivative') {
    const parts = draft.expression.split('=');
    if (parts.length > 2 || parts.some(part => !part.trim() || inspectMath(part, ['x','y']).error)) return '请检查曲线方程，如 x^2+y^2=1 或 y-x^2=0。';
    if (!draft.point?.trim() || inspectMath(draft.point, []).error) return '请填写研究点横坐标 x0，如 1/3、pi。';
    if (draft.pointY?.trim() && inspectMath(draft.pointY, []).error) return '研究点纵坐标应为有限实常数。';
    if (!['1','2'].includes(draft.order ?? '1')) return '隐函数求导只支持一阶或二阶。';
    return null;
  }
  if (['arc_length','parametric_arc_length','surface_of_revolution','polar_area','polar_arc_length'].includes(draft.task)) {
    if (draft.task === 'parametric_arc_length') {
      if (!draft.xExpression?.trim() || inspectMath(draft.xExpression, ['t']).error) return '请填写 x(t)，只使用参数 t。';
      if (!draft.yExpression?.trim() || inspectMath(draft.yExpression, ['t']).error) return '请填写 y(t)，只使用参数 t。';
    } else {
      const variables = ['polar_area','polar_arc_length'].includes(draft.task) ? ['theta'] : ['x'];
      const label = variables[0] === 'theta' ? '极径 r(θ)' : '曲线 y=f(x)';
      if (!draft.expression.trim() || inspectMath(draft.expression, variables).error) return `请填写${label}，只使用变量 ${variables[0]}。`;
      if (draft.task === 'surface_of_revolution' && !['x','y'].includes(draft.rotationAxis ?? '')) return '请选择旋转轴（x 轴或 y 轴）。';
    }
    for (const [key, label] of [['lower', '下限'], ['upper', '上限']] as const) {
      if (!draft[key].trim() || inspectMath(draft[key], []).error) return `积分${label}必须是有限实常数表达式，如 0、pi。`;
    }
    return null;
  }
  if (['asymptote','sequence_limit'].includes(draft.task)) {
    const variable = draft.task === 'sequence_limit' ? 'n' : 'x';
    if (!draft.expression.trim() || inspectMath(draft.expression, [variable]).error) return draft.task === 'sequence_limit' ? '请填写数列通项 aₙ，只使用指标 n。' : '请填写有理函数 f(x)（多项式之比），只使用变量 x。';
    return null;
  }
  if (draft.task === 'curvature') {
    if (!draft.expression.trim() || inspectMath(draft.expression, ['x']).error) return '请填写函数 f(x)，只使用变量 x。';
    if (!draft.point?.trim() || inspectMath(draft.point, []).error) return '请填写有限曲率点 x0，如 1、pi/2。';
    return null;
  }
  if (draft.task === 'integral_function') {
    if (!draft.expression.trim()) return '请填写被积函数 f(t)。';
    if (inspectMath(draft.expression, ['t']).error) return '被积函数只能含积分变量 t，不能含 x。';
    for (const [key, label] of [['lower', '下限 a(x)'], ['upper', '上限 b(x)']] as const) {
      if (!draft[key].trim() || inspectMath(draft[key], ['x']).error) return `${label}只能含自由变量 x，且必须完整填写。`;
    }
    if (draft.point?.trim() && inspectMath(draft.point, []).error) return '求值点必须是有限实常数，可留空。';
    return null;
  }
  if (draft.task === 'parameter_limit') {
    const parameter=(draft.parameter ?? '').trim();
    if (!/^[a-df-hj-z]$/.test(parameter) || parameter === draft.variable) return '参数必须是不同于自变量的单个实数字母（不含 e、i）。';
    if (!draft.expression.trim()) return '请填写含参函数表达式。';
    if (inspectMath(draft.expression,[draft.variable,parameter]).error) return `请检查含参函数，只使用 ${draft.variable} 和参数 ${parameter}。`;
    if (!draft.point?.trim() || inspectMath(draft.point, []).error) return '请填写有限极限点，可使用分数或 pi。';
    if (!draft.targetValue?.trim() || inspectMath(draft.targetValue, []).error) return '请填写题目给定的有限极限值。';
    return null;
  }
  if (!draft.expression.trim()) return ['integral', 'antiderivative', 'triple_integral'].includes(draft.task) ? '请填写被积函数。' : '请填写函数表达式。';
  if (draft.task === 'triple_integral') {
    if (inspectMath(draft.expression,['x','y','z']).error) return '请检查三重积分被积函数，只使用x、y、z。';
    const mode = draft.tripleMode ?? 'box';
    const layers: [string,string,string[]][] = mode === 'box'
      ? [['lower','x 下限',[]],['upper','x 上限',[]],['innerLower','y 下限',[]],['innerUpper','y 上限',[]],['tripleInnerLower','z 下限',[]],['tripleInnerUpper','z 上限',[]]]
      : mode === 'z_simple'
      ? [['lower','x 下限',[]],['upper','x 上限',[]],['innerLower','y 下界',['x']],['innerUpper','y 上界',['x']],['tripleInnerLower','z 下界',['x','y']],['tripleInnerUpper','z 上界',['x','y']]]
      : mode === 'cylindrical'
      ? [['lower','极角 theta 下限',[]],['upper','极角 theta 上限',[]],['innerLower','半径 r 下界',['theta']],['innerUpper','半径 r 上界',['theta']],['tripleInnerLower','z 下界',['theta','r']],['tripleInnerUpper','z 上界',['theta','r']]]
      : [['lower','方位角 theta 下限',[]],['upper','方位角 theta 上限',[]],['innerLower','极角 phi 下限',[]],['innerUpper','极角 phi 上限',[]],['tripleInnerLower','径向 rho 下界',['theta','phi']],['tripleInnerUpper','径向 rho 上界',['theta','phi']]];
    for (const [key,label,variables] of layers) {
      const raw = (draft[key as keyof ManualIntegralDraft] as string | undefined)?.trim() ?? '';
      if (!raw) return `请填写${label}，不自动补0。`;
      if (inspectMath(raw,variables).error) return variables.length ? `${label}只能含已列出的外层变量(${variables.join('、')})，或为常数。` : `${label}必须是完整填写的有限实常数表达式。`;
    }
    return null;
  }
  if (draft.task === 'double_integral') {
    if (inspectMath(draft.expression,['x','y']).error) return '请检查二重积分被积函数，只使用x、y。';
    if(draft.doubleApplication && draft.doubleApplication!=='integral'){
      if(!['strip','pieces','polar'].includes(draft.doubleMode ?? 'strip'))return '应用题请使用有限单片、分片或极坐标区域。';
      if(draft.doubleApplication==='inertia' && !draft.inertiaAxis)return '请选择转动惯量的轴。';
      if(draft.doubleApplication==='probability'){
        if((draft.doubleMode ?? 'strip')!=='strip')return '联合概率请完整输入直角坐标单片支持区域和事件区域。';
        for(const [key,label,variables] of [['eventOuterLower','事件外层下限',[]],['eventOuterUpper','事件外层上限',[]],['eventInnerLower','事件内层下界',[draft.doubleOuter ?? 'x']],['eventInnerUpper','事件内层上界',[draft.doubleOuter ?? 'x']]] as const){
          if(!draft[key]?.trim() || inspectMath(draft[key]!,variables).error)return `请完整填写${label}并核对变量依赖。`;
        }
      }
    }
    if(['affine','change_variables'].includes(draft.doubleMode ?? '') && (!draft.xMap?.trim() || !draft.yMap?.trim() || inspectMath(draft.xMap,['u','v']).error || inspectMath(draft.yMap,['u','v']).error))return '请完整填写x(u,v)与y(u,v)，只使用u、v。';
    if(draft.doubleMode==='improper'){
      for(const value of [draft.lower,draft.upper,draft.innerLower,draft.innerUpper]){
        if(!value?.trim()) return '二重反常积分必须完整填写四个常数积分限。';
        if(!['oo','+oo','-oo','inf','+inf','-inf','∞','+∞','-∞'].includes(value.trim()) && inspectMath(value,[]).error) return '首批二重反常积分限矩形常数边界，积分限可使用±∞。';
      }
      return null;
    }
    if(draft.doubleMode==='polar_improper'){
      for(const value of [draft.lower,draft.upper,draft.innerLower])if(!value?.trim() || inspectMath(value,[]).error)return '极角上下限和极径下限必须是有限常数。';
      if(!draft.innerUpper?.trim() || (!['oo','+oo','inf','+inf','∞','+∞'].includes(draft.innerUpper.trim()) && inspectMath(draft.innerUpper,[]).error))return '极径上限必须是常数或正无穷。';
      return null;
    }
    if (draft.doubleMode==='pieces') {
      const rows=(draft.piecesText ?? '').trim().split(/\r?\n/).filter(row=>row.trim());
      if (!rows.length || rows.length>20) return '请填写1至20个分片，每行四个积分限。';
      for(const row of rows){
        const bounds=row.split(';');
        if(bounds.length!==4 || bounds.some(v=>!v.trim())) return '每片必须填写四个积分限，用英文分号分隔。';
        if(bounds.some((v,i)=>inspectMath(v,i<2 ? [] : [draft.doubleOuter ?? 'x']).error)) return '请检查分片积分限的常数及变量依赖。';
      }
      return null;
    }
    for (const [key,label] of [['lower','外层下限'],['upper','外层上限']] as const) {
      if (!draft[key].trim() || inspectMath(draft[key],[]).error) return `${label}必须完整填写有限实常数表达式。`;
    }
    for (const [key,label] of [['innerLower','内层下界'],['innerUpper','内层上界']] as const) {
      if (!draft[key]?.trim()) return `请填写${label}，不自动补0。`;
      const outer=['affine','change_variables'].includes(draft.doubleMode ?? '') ? 'u' : draft.doubleMode==='polar' ? 'theta' : draft.doubleOuter ?? 'x';
      if (inspectMath(draft[key]!,[outer]).error) return `${label}只能含外层变量${outer}，或为常数。`;
    }
    return null;
  }
  if (draft.task === 'multivariable_extrema') {
    if (inspectMath(draft.expression,['x','y']).error) return '请检查二元目标函数，只使用x、y。';
    if (draft.extremaOperation === 'constrained') {
      const raw=draft.extremaConstraint?.trim() ?? '';
      if (!raw) return '请填写完整等式约束，不自动补入示例。';
      if (/[<>≤≥\n\r;,；，]/.test(raw) || raw.split('=').length !== 2) return '首批仅支持一个等式约束；不等式、多约束和附加条件不能省略。';
      if (raw.split('=').some(part=>!part.trim() || inspectMath(part,['x','y']).error)) return '请检查完整等式约束左右两边。';
    }
    return null;
  }
  if (draft.task === 'multivariable') {
    if (inspectMath(draft.expression,(draft.multiVariables ?? 'x,y').split(',')).error) return '请核对多元函数，只使用已选变量。';
    if (draft.multiOperation === 'directional' && (!draft.multiPoint?.trim() || !draft.multiDirection?.trim())) return '方向导数必须完整填写求值点和方向向量。';
    return null;
  }
  if (draft.task === 'ode') {
    if (draft.expression.length>600 || draft.expression.split('=').length !== 2) return '请输入含一个等号的微分方程，如 y\'=x+y。';
    if (!['x','t'].includes(draft.variable)) return '自变量请选择x或t。';
    if ((draft.initialConditions ?? '').split(/\r?\n/).filter(line=>line.trim()).length>6) return '初值条件最多6条，每行一条。';
    return null;
  }
  if (draft.task === 'implicit_normal') {
    const parts = draft.expression.split('=');
    if (parts.length > 2 || parts.some(p => !p.trim() || inspectMath(p, ['x', 'y']).error)) return '请检查曲线方程，如 y=x^2 或 x^2+y^2=1。';
    if (!draft.point?.trim() || inspectMath(draft.point, []).error || (draft.pointY?.trim() && inspectMath(draft.pointY, []).error)) return '研究点坐标应为常数，如 1/3 或 pi。';
    return null;
  }
  if (['geometric_area','rotation_volume'].includes(draft.task) && !['between_axis','vertical_inequality','between_curves'].includes(draft.regionKind ?? '')) return '请选择区域的完整定义，不能默认把负函数区域删去。';
  if (draft.task === 'rotation_volume' && !['x','y'].includes(draft.rotationAxis ?? '')) return '请选择题目给定的旋转轴（x 轴或 y 轴）。';
  if (draft.regionKind === 'between_curves') {
    const lower = draft.lowerExpression?.trim() ?? '';
    if (!lower) return '请填写两条曲线之间区域的下边界函数 g(x)。';
    if (inspectMath(lower, [draft.variable]).error) return '请检查下边界函数 g(x)，只使用变量 x。';
  }
  const expression = inspectMath(draft.expression, [draft.variable]);
  if (expression.error) return `请检查公式：${expression.error}`;
  if (['higher_derivative','taylor'].includes(draft.task) && !/^(?:[1-9]|10)$/.test(draft.order ?? '1')) return '导数阶数必须是1至10的整数。';
  if (draft.task === 'derivative' || draft.task === 'inverse_derivative' || draft.task === 'limit' || draft.task === 'continuity' || draft.task === 'taylor' || (draft.task === 'higher_derivative' && !!draft.point?.trim())) {
    const point = draft.point?.trim() ?? '';
    const infinity = draft.task === 'limit' && ['oo', '+oo', '-oo', 'inf', '+inf', '-inf', '∞', '+∞', '-∞'].includes(point);
    if (!point || (!infinity && inspectMath(point, []).error)) return draft.task === 'inverse_derivative' ? '请填写有限的反函数输入值，如 1/3、pi。' : '请填写常数求导点或趋近点，如 1/3、pi；极限还支持 ±∞。';
  }
  if (draft.task === 'continuity' && draft.valueMode === 'value' && (!draft.pointValue?.trim() || inspectMath(draft.pointValue, []).error)) return '请填写有限实常数单点函数值，如 1/3 或 pi。';
  if (['integral','function_study','geometric_area','rotation_volume'].includes(draft.task)) {
    for (const [key, label] of [['lower', '下限'], ['upper', '上限']] as const) {
      if (!draft[key].trim()) return `请填写${draft.task === 'function_study' ? '区间' : '积分'}${label}。`;
      if (draft.task==='integral' && draft.integralMode==='improper' && ['oo','+oo','-oo','inf','+inf','-inf','∞','+∞','-∞'].includes(draft[key].trim())) continue;
      if (inspectMath(draft[key], []).error) return `${draft.task === 'function_study' ? '区间' : '积分'}${label}必须是常数表达式，如 0、1/3 或 pi。`;
    }
  }
  return null;
}
