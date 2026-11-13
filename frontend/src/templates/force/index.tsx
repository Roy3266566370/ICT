/**
 * index.tsx —— force_2d 模板入口（C-REG@1 用 import.meta.glob 自动发现）
 *
 * 职责边界（plan §2.1.2 / §2.2.11 约束 4）：
 *  - 纯展示 + 事件上抛：不直接 fetch、不读全局 store；参数一律经
 *    `TemplateProps.onParameterChange` 提交，派生数值优先用宿主传入的 `result`。
 *  - 宿主未给出合法 `result`（独立挂载、mock 缺字段）时才调用 `calcForce2d`
 *    （§2.2.11 P1 澄清的冻结纯函数）兜底，保证同一份对象在任何宿主里看到同样的数字。
 *  - `force_list` 是**整体**参数（长度 2..4），交互上是每个力的「大小 / 方向」两个标量：
 *    这里为每个标量派生一个视图参数（沿用原参数的单位/范围/来源），交给共享的
 *    `ParamControl` 渲染——滑块与数字输入的双向同步、范围提示与其它模板完全一致。
 *  - 显示两个精度（R7-AC2）：`magnitude_rounded`（舍入展示值）与 `magnitude_exact`
 *    （计算精度值）分开呈现，并明确注释二者区别，不混用。
 */
import { useEffect, useId, useMemo, useState } from 'react';
import { ParamControl, SourcePanel } from '@/components/ui';
import type {
  Force2dResult,
  ForceInput,
  KnowledgeObject,
  Parameter,
  SourceRef,
  TemplateProps,
} from '@/api/types';
import { isForceInputList, readConfigString } from '@/api/types';
import {
  calcForce2d,
  FORCE_COUNT_MAX,
  FORCE_COUNT_MIN,
  FORCE_MAX,
  FORCE_MIN,
} from '@/domain/force';
import { formatNumber, trimDecimalString } from '@/domain/format';
import ForceCanvas from './ForceCanvas';
import ForceTable from './ForceTable';
import styles from './force.module.css';

/** 角度允许区间 [0, 360)；滑块上界取 359，数字输入越界由本地校验拦下 */
const ANGLE_MIN = 0;
const ANGLE_MAX_EXCLUSIVE = 360;
const ANGLE_SLIDER_MAX = 359;
/** 默认展示精度（与 C-FC@1 config 默认值一致） */
const DEFAULT_DISPLAY_PRECISION = 2;
const DEFAULT_COMPUTE_PRECISION = 6;

/* -------------------------------------------------------------------------- */
/* 参数解析                                                                   */
/* -------------------------------------------------------------------------- */

type ForceResolution =
  | { ok: true; parameter: Parameter; forces: ForceInput[] }
  | { ok: false; error: string };

/**
 * 定位 `type="force_list"` 参数：优先 `config.force_parameter_id`，
 * 其次固定 id `force_list`，最后按类型兜底（与 domain 选参规则一致）。
 */
function resolveForceParameter(object: KnowledgeObject): ForceResolution {
  const explicitId = readConfigString(object.config, 'force_parameter_id');
  const candidates: (Parameter | undefined)[] = [
    explicitId === null
      ? undefined
      : object.parameters.find((parameter) => parameter.id === explicitId),
    object.parameters.find((parameter) => parameter.id === 'force_list'),
    object.parameters.find((parameter) => parameter.type === 'force_list'),
  ];
  const parameter = candidates.find((item): item is Parameter => item !== undefined);
  if (parameter === undefined) {
    return { ok: false, error: '缺少力的参数（type="force_list"）：无法绘制共点力视图。' };
  }
  if (!isForceInputList(parameter.value)) {
    return {
      ok: false,
      error: `参数 ${parameter.name}（${parameter.id}）不是合法的力列表：需要 2 至 4 个 { magnitude: 十进制字符串, angle_deg: 度数 }。`,
    };
  }
  return {
    ok: true,
    parameter,
    // 复制一份，避免后续 map 时改动宿主传入的对象
    forces: parameter.value.map((force) => ({ ...force })),
  };
}

/* -------------------------------------------------------------------------- */
/* 结果收窄                                                                   */
/* -------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isForceComponent(value: unknown): value is Force2dResult['forces'][number] {
  return (
    isRecord(value) &&
    typeof value['magnitude'] === 'string' &&
    isFiniteNumber(value['angle_deg']) &&
    isFiniteNumber(value['fx']) &&
    isFiniteNumber(value['fy'])
  );
}

/** 把宿主传入的 unknown 结果按 C-FC@1 形状收窄；不合法返回 null 交给兜底路径。 */
function asForce2dResult(value: unknown): Force2dResult | null {
  if (!isRecord(value)) return null;
  const forces = value['forces'];
  if (!Array.isArray(forces) || forces.length < FORCE_COUNT_MIN || forces.length > FORCE_COUNT_MAX) {
    return null;
  }
  if (!forces.every(isForceComponent)) return null;
  if (!isFiniteNumber(value['fx']) || !isFiniteNumber(value['fy'])) return null;
  if (!isFiniteNumber(value['magnitude']) || value['magnitude'] < 0) return null;
  if (typeof value['magnitude_rounded'] !== 'string') return null;
  if (typeof value['magnitude_exact'] !== 'string') return null;
  const direction = value['direction_deg'];
  if (direction !== null && !isFiniteNumber(direction)) return null;
  const directionRounded = value['direction_rounded'];
  if (directionRounded !== null && typeof directionRounded !== 'string') return null;
  if (typeof value['direction_defined'] !== 'boolean') return null;
  if (typeof value['cancel'] !== 'boolean') return null;
  if (typeof value['note'] !== 'string') return null;
  if (!isFiniteNumber(value['tolerance'])) return null;
  return value as unknown as Force2dResult;
}

function resolveResult(
  rawResult: unknown,
  object: KnowledgeObject,
): { result: Force2dResult; error: string | null } {
  const parsed = asForce2dResult(rawResult);
  if (parsed !== null) return { result: parsed, error: null };
  // 宿主未提供合法结果时用契约纯函数兜底（同一算法、同一数值）
  return calcForce2d(object);
}

/* -------------------------------------------------------------------------- */
/* 标量视图参数与数值解析                                                     */
/* -------------------------------------------------------------------------- */

/** 每个力的标量视图参数：id 只用于本地草稿与 ParamControl 的 DOM 标识，不进入任何契约。 */
function scalarParameter(
  base: Parameter,
  key: string,
  name: string,
  type: 'decimal',
  unit: string,
  range: Parameter['range'],
  value: unknown,
): Parameter {
  return {
    id: `${base.id}__${key}`,
    name,
    type,
    value,
    unit,
    range,
    source_ref_ids: base.source_ref_ids,
    provenance: base.provenance,
    editable: base.editable,
  };
}

function parseNumericInput(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'string') {
    const text = raw.trim();
    // 用户正在输入的中间态（空、单独负号、单独小数点）不判定为错误
    if (text === '' || text === '-' || text === '.' || text === '-.') return null;
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** 去掉无意义的尾随零后展示（"10.00" → "10"、"14.14" → "14.14"）。 */
function fmt(value: string | number, digits = DEFAULT_DISPLAY_PRECISION): string {
  if (typeof value === 'string') return trimDecimalString(value);
  return trimDecimalString(formatNumber(value, digits));
}

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record;
  const next: Record<string, T> = { ...record };
  delete next[key];
  return next;
}

/* -------------------------------------------------------------------------- */
/* 视图                                                                       */
/* -------------------------------------------------------------------------- */

export default function ForceTemplate(props: TemplateProps) {
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
  const precisionNoteId = `${uid}-precision`;
  const sourceTitleId = `${uid}-source-title`;

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);

  const resolution = useMemo(() => resolveForceParameter(object), [object]);
  const outcome = useMemo(() => resolveResult(rawResult, object), [rawResult, object]);

  const forces = resolution.ok ? resolution.forces : [];
  const signature = forces.map((force) => `${force.magnitude}|${force.angle_deg}`).join(',');

  // 外部值变化（提交成功、宿主重置、切换对象）时丢弃本地错误与动作提示
  useEffect(() => {
    setFieldErrors({});
    setActionError(null);
  }, [signature]);

  if (!resolution.ok) {
    return (
      <div className={styles.root} data-reduced-motion={reducedMotion ? 'true' : 'false'}>
        <section className={styles.card} role="alert">
          <h2 className={styles.title}>力与向量视图暂时不可用</h2>
          <p className={styles.lead}>{resolution.error}</p>
        </section>
      </div>
    );
  }

  const { parameter: forceParameter } = resolution;
  const { result } = outcome;
  const errorMessage = resultError ?? outcome.error;
  const sources: SourceRef[] = object.source_refs;
  // config 里的精度是"期望值"：domain 对 display / compute 有防御上限（8 / 12），
  // 这里从内核输出的十进制字符串反推**实际生效**位数，避免出现"文案 10 位、数值 8 位"的不一致。
  const configuredDisplay = readPrecision(object.config['display_precision'], DEFAULT_DISPLAY_PRECISION);
  const configuredCompute = readPrecision(object.config['compute_precision'], DEFAULT_COMPUTE_PRECISION);
  const displayPrecision = effectiveDigits(result.magnitude_rounded, configuredDisplay);
  const computePrecision = effectiveDigits(result.magnitude_exact, configuredCompute);
  const precisionClamped = displayPrecision !== configuredDisplay || computePrecision !== configuredCompute;

  const allZero = forces.every((force) => Number(force.magnitude) === 0);
  const roundedNumber = Number(result.magnitude_rounded);
  const roundingDelta =
    Number.isFinite(roundedNumber) && Number.isFinite(result.magnitude)
      ? Math.abs(result.magnitude - roundedNumber)
      : null;

  /* ---------------------------- 参数写入 ---------------------------- */

  const submitForces = (next: ForceInput[]): void => {
    setActionError(null);
    onParameterChange(forceParameter.id, next);
  };

  const handleMagnitude = (index: number, raw: unknown): void => {
    const key = `f${index}-magnitude`;
    const parsed = parseNumericInput(raw);
    if (parsed === null) {
      setFieldErrors((previous) => ({
        ...previous,
        [key]: `第 ${index + 1} 个力的大小请输入数字（例如 10），未写入`,
      }));
      return;
    }
    if (parsed < FORCE_MIN || parsed > FORCE_MAX) {
      setFieldErrors((previous) => ({
        ...previous,
        [key]: `第 ${index + 1} 个力的大小 = ${fmt(parsed)}N 超出允许范围 ${FORCE_MIN} ~ ${FORCE_MAX}N，未写入`,
      }));
      return;
    }
    const magnitudeText = trimDecimalString(String(parsed));
    const next = forces.map((force, position) =>
      position === index ? { ...force, magnitude: magnitudeText } : force,
    );
    setFieldErrors((previous) => withoutKey(previous, key));
    submitForces(next);
  };

  const handleAngle = (index: number, raw: unknown): void => {
    const key = `f${index}-angle`;
    const parsed = parseNumericInput(raw);
    if (parsed === null) {
      setFieldErrors((previous) => ({
        ...previous,
        [key]: `第 ${index + 1} 个力的方向请输入度数（例如 45），未写入`,
      }));
      return;
    }
    if (parsed < ANGLE_MIN || parsed >= ANGLE_MAX_EXCLUSIVE) {
      setFieldErrors((previous) => ({
        ...previous,
        [key]: `第 ${index + 1} 个力的方向 = ${fmt(parsed)}° 超出允许范围 [0, 360)，未写入`,
      }));
      return;
    }
    const next = forces.map((force, position) =>
      position === index ? { ...force, angle_deg: parsed } : force,
    );
    setFieldErrors((previous) => withoutKey(previous, key));
    submitForces(next);
  };

  const handleAddForce = (): void => {
    if (forces.length >= FORCE_COUNT_MAX) {
      setActionError(`共点力的数量上限为 ${FORCE_COUNT_MAX} 个，无法继续添加。`);
      return;
    }
    // 新力默认 5N / 180°，加入后合力形态立刻可见变化
    submitForces([...forces, { magnitude: '5', angle_deg: 180 }]);
  };

  const handleRemoveForce = (index: number): void => {
    if (forces.length <= FORCE_COUNT_MIN) {
      setActionError(`共点力至少需要 ${FORCE_COUNT_MIN} 个，无法继续删除。`);
      return;
    }
    submitForces(forces.filter((_, position) => position !== index));
  };

  const handleFocusSource = (sourceRefId: string): void => {
    setActiveSourceId(sourceRefId);
    onFocusSource(sourceRefId);
  };

  /* ------------------------------ 渲染 ------------------------------ */

  return (
    <div className={styles.root} data-reduced-motion={reducedMotion ? 'true' : 'false'}>
      <header className={styles.header}>
        <div className={styles.headerText}>
          <h2 className={styles.title}>{object.title}</h2>
          <p className={styles.lead}>
            只做共点力的合成（求合力），不计算运动、摩擦或碰撞。角度以度为单位：0° 指向 x 轴正方向，
            逆时针为正，因此「10N 向东 + 10N 向北」的合力方向为 45°。
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

      {actionError !== null ? (
        <div className={styles.alert} role="alert">
          <span aria-hidden="true">⚠</span>
          <span>{actionError}</span>
        </div>
      ) : null}

      <div className={styles.summaryBar}>
        <span className={styles.summaryItem}>
          合力大小
          <span className={styles.summaryValue}>
            {fmt(result.magnitude_rounded)} N
          </span>
          <span className={styles.summaryTag}>展示精度 · {displayPrecision} 位</span>
        </span>
        <span className={styles.summaryItem}>
          计算精度
          <span className={styles.summaryValue}>
            {fmt(result.magnitude_exact)} N
          </span>
          <span className={styles.summaryTag}>计算精度 · {computePrecision} 位</span>
        </span>
        <span className={styles.summaryItem}>
          方向
          <span className={styles.summaryValue}>
            {result.direction_defined && result.direction_rounded !== null
              ? `${fmt(result.direction_rounded)}°`
              : '未定义'}
          </span>
        </span>
        <span className={styles.summaryItem}>
          Fx <span className={styles.summaryValue}>{fmt(result.fx)} N</span>
        </span>
        <span className={styles.summaryItem}>
          Fy <span className={styles.summaryValue}>{fmt(result.fy)} N</span>
        </span>
      </div>

      <p className={styles.precisionNote} id={precisionNoteId}>
        <strong>两个精度的区别：</strong>
        <span className={styles.mono}>{fmt(result.magnitude_rounded)}</span> 是 <em>展示精度</em>
        （display_precision={displayPrecision}）舍入后的显示值；
        <span className={styles.mono}>{fmt(result.magnitude_exact)}</span> 是 <em>计算精度</em>
        （compute_precision={computePrecision}）下的未舍入值。
        {precisionClamped
          ? `（config 中 display_precision=${configuredDisplay}、compute_precision=${configuredCompute}，内核按防御上限实际使用 ${displayPrecision} / ${computePrecision} 位；本页文案以生效值为准。）`
          : null}
        {roundingDelta === null
          ? null
          : `两者相差 ${formatNumber(roundingDelta, computePrecision)} N——展示精度只用于阅读，任何比较与校验都以计算精度为准。`}
        {result.cancel ? '（当前合力为零，方向未定义：界面显示「未定义」，不会给出 0° 或任何非数值结果。）' : ''}
      </p>

      <div className={styles.mainGrid}>
        <section className={styles.card} aria-label="共点力矢量图">
          <h3 className={styles.cardTitle}>矢量图（箭头长度按比例，角度按度）</h3>
          <ForceCanvas result={result} reducedMotion={reducedMotion} />
        </section>

        <aside className={styles.side}>
          <section className={styles.card} aria-label="力的参数控件">
            <h3 className={styles.cardTitle}>
              {forceParameter.name}
              <span className={styles.cardTitleMeta}>
                当前 {forces.length} 个（允许 {FORCE_COUNT_MIN} ~ {FORCE_COUNT_MAX} 个）
              </span>
            </h3>

            <p className={styles.fieldsetHint}>
              每个力的大小允许 {FORCE_MIN} ~ {FORCE_MAX} N，方向允许 [0, 360) 度；
              滑块与数字输入共用同一个写入出口，越界不写入并显示中文原因。
            </p>

            {forces.map((force, index) => {
              const magnitudeParameter = scalarParameter(
                forceParameter,
                `f${index}-magnitude`,
                `第 ${index + 1} 个力的大小`,
                'decimal',
                'N',
                { min: FORCE_MIN, max: FORCE_MAX, step: 1 },
                force.magnitude,
              );
              const angleParameter = scalarParameter(
                forceParameter,
                `f${index}-angle`,
                `第 ${index + 1} 个力的方向`,
                'decimal',
                'deg',
                { min: ANGLE_MIN, max: ANGLE_SLIDER_MAX, step: 1 },
                force.angle_deg,
              );
              return (
                <fieldset key={`force-${index}`} className={styles.fieldset}>
                  <legend className={styles.legendTitle}>
                    <span className={styles.legendIndex}>{index + 1}</span>
                    力 F{index + 1}
                    <span className={styles.legendValue}>
                      {fmt(force.magnitude)} N ∠ {fmt(force.angle_deg)}°
                    </span>
                  </legend>

                  <ParamControl
                    parameter={magnitudeParameter}
                    value={force.magnitude}
                    error={fieldErrors[`f${index}-magnitude`] ?? null}
                    disabled={!forceParameter.editable}
                    onChange={(next: unknown) => handleMagnitude(index, next)}
                  />
                  <ParamControl
                    parameter={angleParameter}
                    value={force.angle_deg}
                    error={fieldErrors[`f${index}-angle`] ?? null}
                    disabled={!forceParameter.editable}
                    onChange={(next: unknown) => handleAngle(index, next)}
                  />

                  <button
                    type="button"
                    className={`${styles.button} ${styles.removeButton}`}
                    onClick={() => handleRemoveForce(index)}
                    disabled={!forceParameter.editable}
                  >
                    删除力 F{index + 1}
                  </button>
                </fieldset>
              );
            })}

            <div className={styles.addRow}>
              <button
                type="button"
                className={styles.button}
                onClick={handleAddForce}
                disabled={!forceParameter.editable || forces.length >= FORCE_COUNT_MAX}
              >
                添加一个力
              </button>
              <span className={styles.addHint}>
                {forces.length >= FORCE_COUNT_MAX
                  ? `已达上限 ${FORCE_COUNT_MAX} 个`
                  : `最多 ${FORCE_COUNT_MAX} 个、最少 ${FORCE_COUNT_MIN} 个共点力`}
              </span>
            </div>
          </section>

          <ForceTable result={result} allZero={allZero} />
        </aside>
      </div>

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

/**
 * 从内核输出的十进制字符串反推**实际生效**的小数位数：
 * `"14.142136"` → 6、`"10"` / `"0"` → 0、非数字（如 `"—"`）→ fallback。
 * domain 对 config 的精度有防御上限（display ≤ 8、compute ≤ 12），
 * 所以文案不能直接用 config 原值，否则会出现位数不一致。
 *
 * 该反推对宿主传入的 `RunSnapshot.result` 同样成立（字段名与格式一致），
 * 并且天然规避了"回放时该用快照 config 还是当前 config"的歧义——位数直接来自结果本身，
 * 不依赖当前对象的 config。
 */
function effectiveDigits(text: string | null, fallback: number): number {
  const trimmed = (text ?? '').trim();
  if (trimmed === '') return fallback;
  const match = /^-?\d+\.(\d+)$/.exec(trimmed);
  if (match === null) return /^-?\d+$/.test(trimmed) ? 0 : fallback;
  return match[1]?.length ?? fallback;
}

/** 读取 config 中的精度原值（仅用于提示被截断的情况；实际位数由 `effectiveDigits` 反推）。 */
function readPrecision(raw: unknown, fallback: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback;
  const digits = Math.floor(raw);
  return digits < 0 ? fallback : digits;
}