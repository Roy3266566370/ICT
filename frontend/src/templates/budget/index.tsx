/**
 * index.tsx —— budget_compare 模板入口（C-REG@1 用 import.meta.glob 自动发现）
 *
 * 职责边界（plan §2.1.2 / §2.2.11 约束 4）：
 *  - 纯展示 + 事件上抛：不直接 fetch、不读全局 store；参数一律经
 *    `TemplateProps.onParameterChange` 提交，派生数值优先用宿主 `result`。
 *  - 金额全程是**十进制字符串**：本视图不做任何 `number` 金额运算/比较，
 *    差、余量、相等判定全部取内核输出；曲线上的坐标换算（仅几何定位）在
 *    BudgetChart 内单独注释，不参与任何真值。
 *  - 「不设上限」是视图级开关（R9-AC5）：置位后本地按 `budget_limit_parameter_id=null`
 *    重新派生，不画预算线、不显示余量；**不改写对象参数**（参数通道无法表达 null），
 *    界面明确标注这一点，不假装已保存。
 */
import { useEffect, useId, useMemo, useState } from 'react';
import { SourcePanel } from '@/components/ui';
import type {
  BudgetCompareResult,
  KnowledgeObject,
  LineSeries,
  Parameter,
  ScenarioId,
  SourceRef,
  TemplateProps,
} from '@/api/types';
import { readConfigString } from '@/api/types';
import { calcBudget, PEOPLE_MAX, PEOPLE_MIN } from '@/domain/budget';
import { formatMoney } from '@/domain/format';
import BudgetChart from './BudgetChart';
import BudgetInputs, { type BudgetParameterSet, type Coefficient } from './BudgetInputs';
import BudgetTable from './BudgetTable';
import styles from './budget.module.css';

/* -------------------------------------------------------------------------- */
/* 参数解析                                                                   */
/* -------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asDecimalText(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() === '' ? null : value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

/** 读取 `config.coefficients = { plan_a: { fixed, per_unit }, plan_b: {...} }`（团队裁决形态）。 */
function readCoefficient(object: KnowledgeObject, scenarioId: ScenarioId): Coefficient | null {
  const coefficients = object.config['coefficients'];
  if (!isRecord(coefficients)) return null;
  const entry = coefficients[scenarioId];
  if (!isRecord(entry)) return null;
  const fixed = asDecimalText(entry['fixed']);
  const perUnit = asDecimalText(entry['per_unit']);
  if (fixed === null || perUnit === null) return null;
  return { fixed, perUnit };
}

function findById(object: KnowledgeObject, id: string | null): Parameter | null {
  if (id === null) return null;
  return object.parameters.find((parameter) => parameter.id === id) ?? null;
}

/**
 * 定位预算模板的参数：
 *  - 人数：`config.people_parameter_id` → id `people_n` / `people` → 第一个既非上限的 integer；
 *  - 上限：`config.budget_limit_parameter_id`（字符串）→ id `budget_limit` / `budget_limit_parameter`；
 *  - 成本：`{plan_a|plan_b}_fixed` / `_per_person`（T1 fixture 形态，可编辑）；
 *  - 名称：`{plan_a|plan_b}_name` → 前两个 text 参数（与 domain 的取参规则一致）。
 */
function resolveParameters(object: KnowledgeObject): BudgetParameterSet {
  const configuredLimitId = readConfigString(object.config, 'budget_limit_parameter_id');
  const limit =
    findById(object, configuredLimitId) ??
    findById(object, 'budget_limit') ??
    findById(object, 'budget_limit_parameter');

  const configuredPeopleId = readConfigString(object.config, 'people_parameter_id');
  const people =
    findById(object, configuredPeopleId) ??
    findById(object, 'people_n') ??
    findById(object, 'people') ??
    object.parameters.find(
      (parameter) => parameter.type === 'integer' && parameter.id !== limit?.id,
    ) ??
    null;

  const textParameters = object.parameters.filter((parameter) => parameter.type === 'text');
  const nameA =
    findById(object, 'plan_a_name') ?? textParameters[0] ?? null;
  const nameB =
    findById(object, 'plan_b_name') ?? textParameters[1] ?? null;

  return {
    people,
    limit,
    configuredLimitId,
    fixedA: findById(object, 'plan_a_fixed'),
    perPersonA: findById(object, 'plan_a_per_person'),
    fixedB: findById(object, 'plan_b_fixed'),
    perPersonB: findById(object, 'plan_b_per_person'),
    nameA,
    nameB,
    coefficientA: readCoefficient(object, 'plan_a'),
    coefficientB: readCoefficient(object, 'plan_b'),
  };
}

/* -------------------------------------------------------------------------- */
/* 结果收窄                                                                   */
/* -------------------------------------------------------------------------- */

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isStringPair(value: unknown, predicate: (item: unknown) => boolean): boolean {
  return Array.isArray(value) && value.length === 2 && value.every(predicate);
}

function isScenario(value: unknown): value is BudgetCompareResult['scenarios'][number] {
  return (
    isRecord(value) &&
    (value['scenario_id'] === 'plan_a' || value['scenario_id'] === 'plan_b') &&
    typeof value['name'] === 'string' &&
    typeof value['total'] === 'string' &&
    typeof value['per_person'] === 'string' &&
    typeof value['fixed'] === 'string'
  );
}

function isLine(value: unknown): value is LineSeries {
  return (
    isRecord(value) &&
    (value['scenario_id'] === 'plan_a' || value['scenario_id'] === 'plan_b') &&
    typeof value['at_zero'] === 'string' &&
    typeof value['at_max'] === 'string' &&
    typeof value['slope'] === 'string'
  );
}

/** 把宿主传入的 unknown 结果按 C-BUD@1 形状收窄；不合法返回 null 交给兜底路径。 */
function asBudgetCompareResult(value: unknown): BudgetCompareResult | null {
  if (!isRecord(value)) return null;
  const inputs = value['inputs'];
  if (!isRecord(inputs) || !isFiniteNumber(inputs['people'])) return null;
  const scenarios = value['scenarios'];
  if (!Array.isArray(scenarios) || scenarios.length !== 2 || !scenarios.every(isScenario)) return null;
  if (typeof value['difference'] !== 'string') return null;
  if (typeof value['equal'] !== 'boolean') return null;
  const budgetLimit = value['budget_limit'];
  if (budgetLimit !== null && typeof budgetLimit !== 'string') return null;
  const remaining = value['remaining'];
  if (remaining !== null && !isStringPair(remaining, (item) => typeof item === 'string')) return null;
  const overBudget = value['over_budget'];
  if (overBudget !== null && !isStringPair(overBudget, (item) => typeof item === 'boolean')) return null;
  const lines = value['lines'];
  if (!Array.isArray(lines) || lines.length !== 2 || !lines.every(isLine)) return null;
  if (!isFiniteNumber(value['display_precision'])) return null;
  return value as unknown as BudgetCompareResult;
}

/* -------------------------------------------------------------------------- */
/* 视图                                                                       */
/* -------------------------------------------------------------------------- */

export default function BudgetTemplate(props: TemplateProps) {
  const {
    object,
    result: rawResult,
    resultError,
    onParameterChange,
    onReset,
    onFocusSource,
    reducedMotion,
  } = props;

  const uid = useId();
  const tableTitleId = `${uid}-table-title`;
  const sourceTitleId = `${uid}-source-title`;

  const parameters = useMemo(() => resolveParameters(object), [object]);
  const [limitDisabled, setLimitDisabled] = useState(parameters.configuredLimitId === null);
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);

  // 切换对象（或宿主改了上限参数配置）时回到该对象的默认上限开关
  useEffect(() => {
    setLimitDisabled(parameters.configuredLimitId === null);
  }, [parameters.configuredLimitId]);

  /**
   * 视图级「未设上限」：把合成对象的 `budget_limit_parameter_id` 置 null，
   * 再走同一 `calcBudget`（内部 deriveBudgetCompare），从而得到 remaining=null、
   * over_budget=null，界面自然不画预算线、不显示余量（R9-AC5）。
   */
  const composedObject = useMemo<KnowledgeObject>(() => {
    if (!limitDisabled) return object;
    return { ...object, config: { ...object.config, budget_limit_parameter_id: null } };
  }, [object, limitDisabled]);

  const outcome = useMemo(() => {
    if (!limitDisabled) {
      const parsed = asBudgetCompareResult(rawResult);
      if (parsed !== null) return { result: parsed, error: null };
    }
    return calcBudget(composedObject);
  }, [rawResult, limitDisabled, composedObject]);

  if (parameters.people === null) {
    return (
      <div className={styles.root} data-reduced-motion={reducedMotion ? 'true' : 'false'}>
        <section className={styles.card} role="alert">
          <h2 className={styles.title}>预算对比视图暂时不可用</h2>
          <p className={styles.lead}>
            缺少人数参数（type=&quot;integer&quot;）：无法计算两方案总额。请检查对象参数或
            config.people_parameter_id。
          </p>
        </section>
      </div>
    );
  }

  const result = outcome.result;
  const errorMessage = resultError ?? outcome.error;
  const sources: SourceRef[] = object.source_refs;

  const names: [string, string] = [
    fallbackName(result.scenarios[0]?.name, '方案 A'),
    fallbackName(result.scenarios[1]?.name, '方案 B'),
  ];
  const totalA = result.scenarios[0]?.total ?? '0.00';
  const totalB = result.scenarios[1]?.total ?? '0.00';

  const handleFocusSource = (sourceRefId: string): void => {
    setActiveSourceId(sourceRefId);
    onFocusSource(sourceRefId);
  };

  return (
    <div className={styles.root} data-reduced-motion={reducedMotion ? 'true' : 'false'}>
      <header className={styles.header}>
        <div className={styles.headerText}>
          <h2 className={styles.title}>{object.title}</h2>
          <p className={styles.lead}>
            两个线性方案按人数 n 对比：总额 = 固定成本 + 人均成本 × n。金额全程以十进制字符串
            传输并计算，采用十进制计算，避免二进制浮点误差；曲线上的像素坐标只用于几何定位。
          </p>
        </div>
        <div className={styles.headerActions}>
          <button type="button" className={styles.button} onClick={onReset}>
            重置为初始值
          </button>
        </div>
      </header>

      {errorMessage !== null ? (
        <div className={styles.alert} role="alert">
          <span aria-hidden="true">⚠</span>
          <span>{errorMessage}</span>
        </div>
      ) : null}

      <div className={styles.summaryBar}>
        <span className={styles.summaryItem}>
          人数 n
          <span className={styles.summaryValue}>{result.inputs.people}</span>
          <span className={styles.summaryTag}>人</span>
        </span>
        <span className={styles.summaryItem}>
          {names[0]}
          <span className={styles.summaryValue}>{formatMoney(totalA)}</span>
          <span className={styles.summaryTag}>元</span>
        </span>
        <span className={styles.summaryItem}>
          {names[1]}
          <span className={styles.summaryValue}>{formatMoney(totalB)}</span>
          <span className={styles.summaryTag}>元</span>
        </span>
        <span className={styles.summaryItem}>
          差额（A − B）
          <span className={styles.summaryValue}>{formatMoney(result.difference)}</span>
          <span className={styles.summaryTag}>元</span>
          {result.equal ? <span className={styles.equalBadge}>相等</span> : null}
        </span>
        {result.budget_limit === null ? (
          <span className={styles.summaryItem}>
            预算上限
            <span className={styles.summaryMuted}>未设上限（不画预算线、不显示余量）</span>
          </span>
        ) : (
          <span className={styles.summaryItem}>
            预算上限
            <span className={styles.summaryValue}>{formatMoney(result.budget_limit)}</span>
            <span className={styles.summaryTag}>元</span>
          </span>
        )}
      </div>

      <div className={styles.mainGrid}>
        <BudgetInputs
          parameters={parameters}
          result={result}
          limitDisabled={limitDisabled}
          onLimitDisabledChange={setLimitDisabled}
          onChange={onParameterChange}
        />

        <section className={styles.card} aria-label="两方案金额曲线">
          <h3 className={styles.cardTitle}>
            金额曲线（横轴人数 n，纵轴金额）
            <span className={styles.cardTitleMeta}>
              {result.budget_limit === null
                ? '未设上限：不渲染预算水平线，也不显示余量'
                : `预算上限 ${formatMoney(result.budget_limit)} 元`}
            </span>
          </h3>
          <BudgetChart
            result={result}
            names={names}
            reducedMotion={reducedMotion}
          />
        </section>
      </div>

      <section className={styles.card} aria-labelledby={tableTitleId}>
        <h3 id={tableTitleId} className={styles.cardTitle}>
          方案对比表
          <span className={styles.cardTitleMeta}>
            n = {result.inputs.people}（{PEOPLE_MIN} ~ {PEOPLE_MAX} 人）
          </span>
        </h3>
        <BudgetTable result={result} names={names} />
      </section>

      <section className={`${styles.card} ${styles.sourceSection}`} aria-labelledby={sourceTitleId}>
        <h3 id={sourceTitleId} className={styles.cardTitle}>
          来源
        </h3>
        {sources.length === 0 ? (
          <p className={styles.sourceNote}>当前对象没有来源记录。</p>
        ) : (
          <SourcePanel
            sources={sources}
            activeSourceId={activeSourceId}
            onSelect={handleFocusSource}
          />
        )}
        <p className={styles.sourceNote}>
          来源只用于定位到原始材料；缺少元素框的页级来源只高亮页码，不绘制元素框。
        </p>
      </section>
    </div>
  );
}

/** 方案名回退：内核未给出名称时用「方案 A / 方案 B」，不显示空标题。 */
function fallbackName(name: string | undefined, fallback: string): string {
  return name === undefined || name.trim() === '' ? fallback : name;
}