/**
 * ISpecView.tsx —— iSpec 通用运行时入口（宿主唯一需要认识的组件）。
 *
 * 渲染顺序（契约硬要求）：参数控件 → 视图列表 → 约束/错误提示。
 * 设计目标：新增知识类型 = 新增一份 iSpec，不改宿主、不新增组件。
 *
 * 职责边界：
 *  - 参数越界：**不写入**，在控件下方给中文原因；
 *  - 派生量：交给 `evaluateSpecWithIssues`，失败只显示提示，不抛异常、不白屏；
 *  - 文字同步：对每个 text 视图回调 `{ id, text, changed }`，`changed` 表示参数偏离默认值；
 *  - 视图分派：table / text / vega / figure 四类，全部由 spec 驱动。
 */
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import type { FigureView, ISpec, SpecParameter, SpecView } from '../../ispec/types';
import { clampToSpec, isOffDefault, validateISpecLite } from '../../ispec/types';
import { evaluateSpecWithIssues } from '../../ispec/evaluate';
import { formatNumberSmart, renderTemplate, type SpecCell } from '../../ispec/format';
import { ParamControls } from './ParamControls';
import { PRIMITIVE_LABELS, routeSpecViews } from './primitiveRouter';
import { TableSpecView } from './views/TableSpecView';
import { TextSpecView } from './views/TextSpecView';
import { VegaSpecView } from './views/VegaSpecView';
import { FigureSpecView } from './views/FigureSpecView';
import styles from './ISpecView.module.css';

export interface ISpecViewProps {
  /** Presentation surfaces keep implementation identifiers in the evidence panel. */
  presentation?: boolean;
  spec: ISpec;
  values: Record<string, SpecCell>;
  onChange: (id: string, value: SpecCell) => void;
  /** 0 原像 / 1 变化中 / 2 完成，供 step 类视图使用 */
  stage?: 0 | 1 | 2;
  reducedMotion?: boolean;
  /** 参数未偏离默认值时不要覆盖原页文字（文档硬要求） */
  onLinkedTexts?: (texts: Array<{ id: string; text: string; changed: boolean }>) => void;
  /** 宿主已单独渲染 figure 时，把模板名传进来，参数分组才能识别矩阵/四格。 */
  figureRef?: FigureView['spec_ref'];
}

export type ParameterCheck =
  | { ok: true; value: SpecCell }
  | { ok: false; reason: string };


function unitSuffix(parameter: SpecParameter): string {
  return parameter.unit === undefined || parameter.unit === '' ? '' : ` ${parameter.unit}`;
}

/**
 * 参数输入校验：类型 + 区间。
 * 越界/类型不符时返回中文原因（不夹紧、不写入）；通过后再按 min/max/step 归一。
 * 该函数导出给宿主复用（保存草稿、URL 参数反序列化时可走同一套规则）。
 */
export function validateParameterInput(parameter: SpecParameter, raw: SpecCell): ParameterCheck {
  const type = parameter.type ?? 'number';

  if (type === 'boolean') {
    if (typeof raw !== 'boolean') {
      return { ok: false, reason: '该参数只接受「开 / 关」两种取值。' };
    }
    return { ok: true, value: raw };
  }

  if (type === 'enum') {
    if (typeof raw !== 'string') {
      return { ok: false, reason: '该参数只接受选项中的文本值。' };
    }
    const options = parameter.options ?? [];
    if (options.length > 0 && !options.includes(raw)) {
      return { ok: false, reason: `不在可选项中，只能取：${options.join(' / ')}。` };
    }
    return { ok: true, value: raw };
  }

  if (type === 'string') {
    return { ok: true, value: typeof raw === 'string' ? raw : String(raw) };
  }

  const numeric = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(numeric)) {
    return { ok: false, reason: `「${String(raw)}」不是有效数字。` };
  }
  if (typeof parameter.min === 'number' && numeric < parameter.min) {
    return {
      ok: false,
      reason: `低于下限：允许 ${formatNumberSmart(parameter.min)}${unitSuffix(parameter)}，输入为 ${formatNumberSmart(numeric)}，未写入。`,
    };
  }
  if (typeof parameter.max === 'number' && numeric > parameter.max) {
    return {
      ok: false,
      reason: `高于上限：允许 ${formatNumberSmart(parameter.max)}${unitSuffix(parameter)}，输入为 ${formatNumberSmart(numeric)}，未写入。`,
    };
  }
  return { ok: true, value: clampToSpec(parameter, numeric) };
}

function sameCell(left: SpecCell | undefined, right: SpecCell): boolean {
  if (left === undefined) return false;
  if (typeof left === 'number' && typeof right === 'number') {
    return Math.abs(left - right) <= 1e-12;
  }
  return left === right;
}

export function ISpecView(props: ISpecViewProps): ReactElement {
  const { spec, values, onChange, stage = 0, reducedMotion = false, onLinkedTexts } = props;
  const headingId = useId();
  const [errors, setErrors] = useState<Record<string, string>>({});

  // 换规格时清掉旧参数的越界提示，避免原因挂在新控件上
  useEffect(() => {
    setErrors({});
  }, [spec]);

  const { evaluation, issues } = useMemo(
    () => evaluateSpecWithIssues(spec, values),
    [spec, values],
  );

  const structuralIssues = useMemo(() => validateISpecLite(spec), [spec]);
  const changed = useMemo(() => isOffDefault(spec, evaluation.values), [spec, evaluation.values]);
  /** 五类原语分流：step 按 stage 逐项显现，branch 按 enum 选项筛选视图。 */
  const route = useMemo(
    () => routeSpecViews(spec, evaluation.values, stage),
    [spec, evaluation.values, stage],
  );

  /* ---------------------------- 文字视图同步 ---------------------------- */
  const linkedTexts = useMemo(() => {
    const scope: Record<string, SpecCell> = { ...evaluation.values, ...evaluation.derived };
    const items: Array<{ id: string; text: string; changed: boolean }> = [];
    spec.views.forEach((view, index) => {
      if (view.type !== 'text') return;
      items.push({
        id: `text-${index}`,
        text: renderTemplate(view.template, scope).text,
        changed,
      });
    });
    return items;
  }, [spec.views, evaluation, changed]);

  const lastSignature = useRef<string>('');
  const linkedSignature = linkedTexts
    .map((item) => `${item.id}|${item.text}|${item.changed}`)
    .join('\n');
  useEffect(() => {
    if (linkedSignature === lastSignature.current) return;
    lastSignature.current = linkedSignature;
    onLinkedTexts?.(linkedTexts);
  }, [linkedSignature, linkedTexts, onLinkedTexts]);

  /* ---------------------------- 参数写入 ---------------------------- */
  const handleParamChange = useCallback(
    (id: string, raw: SpecCell): void => {
      const parameter = spec.parameters.find((item) => item.id === id);
      if (parameter === undefined) return;
      const checked = validateParameterInput(parameter, raw);
      if (!checked.ok) {
        setErrors((previous) => ({ ...previous, [id]: checked.reason }));
        return;
      }
      setErrors((previous) => {
        if (previous[id] === undefined) return previous;
        const next = { ...previous };
        delete next[id];
        return next;
      });
      if (sameCell(values[id], checked.value)) return;
      onChange(id, checked.value);
    },
    [spec.parameters, values, onChange],
  );

  const renderView = (view: SpecView): ReactElement => {
    switch (view.type) {
      case 'table':
        return (
          <TableSpecView view={view} spec={spec} evaluation={evaluation} changed={changed} />
        );
      case 'text':
        return <TextSpecView view={view} evaluation={evaluation} changed={changed} />;
      case 'vega':
        return (
          <VegaSpecView
            view={view}
            spec={spec}
            evaluation={evaluation}
            reducedMotion={reducedMotion}
          />
        );
      case 'figure':
        return (
          <FigureSpecView
            view={view}
            spec={spec}
            evaluation={evaluation}
            stage={stage}
            reducedMotion={reducedMotion}
            draggable={route.draggable}
            onParamChange={handleParamChange}
          />
        );
    }
  };

  return (
    <section
      className={styles.root}
      data-ispec-version={spec.spec_version}
      data-ispec-object={spec.object_id}
      data-ispec-kind={spec.kind}
      data-ispec-primitive={spec.kind}
      data-ispec-visible-views={route.visibleCount}
      data-ispec-total-views={spec.views.length}
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
      aria-labelledby={headingId}
    >
      <header className={styles.header}>
        <h3 className={styles.title} id={headingId}>
          {spec.title ?? spec.object_id}
        </h3>
        {!props.presentation && <p className={styles.subtitle}>
          <span>{PRIMITIVE_LABELS[spec.kind]}</span>
          <span aria-hidden="true"> · </span>
          <code className={styles.code}>{spec.object_id}</code>
        </p>}
        {route.kind === 'step' && !props.presentation ? (
          <p className={styles.routeNote} data-step-indicator={route.visibleCount - 1}>
            步骤 {Math.min(route.visibleCount, route.stepCount)} / {route.stepCount}
            （视图顺序即步骤顺序）
          </p>
        ) : null}
        {route.kind === 'branch' && route.branchParameter !== null ? (
          <p className={styles.routeNote} data-branch-options={route.branchValue ?? ''}>
            分支：{route.branchValue ?? '—'}（选项：
            {(route.branchParameter.options ?? []).join(' / ')}）
          </p>
        ) : null}
        {route.kind === 'geometric' ? (
          <p className={styles.routeNote} data-geometric-hint>
            几何操作：可直接改参数；带圆点的图还支持拖动端点。
          </p>
        ) : null}
      </header>

      {structuralIssues.length > 0 ? (
        <div className={styles.structure} data-ispec-structure role="alert">
          <p className={styles.structureTitle}>iSpec 结构不完整，已尽量渲染：</p>
          <ul className={styles.structureList}>
            {structuralIssues.map((issue, index) => (
              <li key={`${issue.path}-${index}`}>
                {issue.path === '' ? issue.message : `${issue.path}：${issue.message}`}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!props.presentation && <ParamControls
        parameters={spec.parameters}
        values={evaluation.values}
        errors={errors}
        onChange={handleParamChange}
        figureRef={props.figureRef ?? spec.views.find((view) => view.type === 'figure')?.spec_ref}
      />}

      <div
        className={styles.views}
        data-ispec-views={route.visibleCount}
        data-ispec-all-views={spec.views.length}
      >
        {route.views
          .filter((item) => item.visible)
          .map((item) => (
            <div
              className={styles.view}
              key={`${item.view.type}-${item.index}`}
              data-view-type={item.view.type}
              data-view-index={item.index}
              data-ispec-view-index={item.index}
              data-step-index={item.stepIndex >= 0 ? item.stepIndex : undefined}
            >
              {renderView(item.view)}
            </div>
          ))}
      </div>

      {props.presentation && <ParamControls parameters={spec.parameters} values={evaluation.values}
        errors={errors} onChange={handleParamChange}
        figureRef={props.figureRef ?? spec.views.find((view) => view.type === 'figure')?.spec_ref} />}

      {evaluation.violations.length > 0 || issues.length > 0 ? (
        <div className={styles.notices} data-ispec-notices>
          {evaluation.violations.map((violation, index) => (
            <p
              key={`violation-${index}`}
              className={styles.notice}
              data-ispec-violation={violation.severity}
              data-severity={violation.severity}
              role={violation.severity === 'error' ? 'alert' : 'status'}
            >
              <span aria-hidden="true">{violation.severity === 'error' ? '✕' : '△'}</span>{' '}
              {violation.message}
            </p>
          ))}
          {issues.map((issue, index) => (
            <p key={`issue-${index}`} className={styles.notice} data-ispec-issue role="status">
              <span aria-hidden="true">△</span> 派生量 {issue.id} 未求出：{issue.error}
            </p>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export default ISpecView;
