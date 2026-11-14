import { inspectMath } from './mathKeyboard.ts';

export type IntegralTask = 'integral' | 'antiderivative' | 'derivative' | 'limit' | 'higher_derivative' | 'continuity' | 'implicit_normal' | 'function_study' | 'taylor' | 'geometric_area' | 'rotation_volume' | 'ode' | 'multivariable' | 'multivariable_extrema' | 'double_integral';
export interface ManualIntegralDraft {
  task: IntegralTask;
  expression: string;
  variable: string;
  lower: string;
  upper: string;
  point?: string;
  order?: string;
  valueMode?: 'expression' | 'undefined' | 'value';
  pointValue?: string;
  pointY?: string;
  initialConditions?: string;
  doubleOuter?: 'x' | 'y';
  doubleMode?: 'strip' | 'pieces' | 'polar' | 'improper' | 'polar_improper' | 'strip_improper' | 'affine' | 'change_variables';
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
  regionKind?: '' | 'between_axis' | 'vertical_inequality';
  rotationAxis?: '' | 'x' | 'y';
  intervalType?: 'closed' | 'open' | 'left_open' | 'right_open';
  side?: 'both' | 'left' | 'right';
}
export interface ManualIntegralPreview {
  task: IntegralTask;
  label: string;
  conditions: Record<string, string>;
  latex: string;
  question: string;
}

export function manualConditions(draft: ManualIntegralDraft): Record<string, string> {
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
  if (['geometric_area','rotation_volume'].includes(draft.task)) return { expression:draft.expression.trim(), lower:draft.lower.trim(), upper:draft.upper.trim(), region_kind:draft.regionKind ?? '', ...(draft.task === 'rotation_volume' ? { rotation_axis:draft.rotationAxis ?? '' } : {}) };
  if (draft.task === 'implicit_normal') return { implicit_expression: draft.expression.trim(), point_x: draft.point?.trim() ?? '', ...(draft.pointY?.trim() ? { point_y: draft.pointY.trim() } : {}) };
  return { expression: draft.expression.trim(), variable: draft.variable,
    ...(['derivative', 'limit', 'continuity', 'taylor'].includes(draft.task) ? { point: (draft.point ?? '').trim() } : {}),
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
  if (!draft.expression.trim()) return ['integral', 'antiderivative'].includes(draft.task) ? '请填写被积函数。' : '请填写函数表达式。';
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
  if (['geometric_area','rotation_volume'].includes(draft.task) && !draft.regionKind) return '请选择区域的完整定义，不能默认把负函数区域删去。';
  if (draft.task === 'rotation_volume' && draft.rotationAxis !== 'x') return draft.rotationAxis ? '当前仅支持绕x轴旋转；不会替换题目给定的旋转轴。' : '请选择题目给定的旋转轴。';
  const expression = inspectMath(draft.expression, [draft.variable]);
  if (expression.error) return `请检查公式：${expression.error}`;
  if (['higher_derivative','taylor'].includes(draft.task) && !/^(?:[1-9]|10)$/.test(draft.order ?? '1')) return '导数阶数必须是1至10的整数。';
  if (draft.task === 'derivative' || draft.task === 'limit' || draft.task === 'continuity' || draft.task === 'taylor' || (draft.task === 'higher_derivative' && !!draft.point?.trim())) {
    const point = draft.point?.trim() ?? '';
    const infinity = draft.task === 'limit' && ['oo', '+oo', '-oo', 'inf', '+inf', '-inf', '∞', '+∞', '-∞'].includes(point);
    if (!point || (!infinity && inspectMath(point, []).error)) return '请填写常数求导点或趋近点，如 1/3、pi；极限还支持 ±∞。';
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
