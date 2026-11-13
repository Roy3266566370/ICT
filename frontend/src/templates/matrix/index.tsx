/**
 * index.tsx —— matrix_2d 模板入口（C-REG@1 用 import.meta.glob 自动发现）
 *
 * 职责边界（plan §2.1.2 / §2.2.11 约束 4）：
 *  - 本组件是**纯展示 + 事件上抛**：不直接 fetch，不读全局 store，
 *    参数一律经 `TemplateProps.onParameterChange` 提交，派生数值优先用宿主传入的 `result`。
 *  - 宿主没给出合法 `result` 时才调用 `calcMatrix2d`（§2.2.11 P1 澄清的前端纯函数）兜底，
 *    保证"同一份对象在任意宿主里看到同样的数字"。
 *  - 三模式（原始/变换后/叠加）只影响本模板的绘制集合；`TemplateProps.display` 是只读的，
 *    因此切换状态保存在模板内，并跟随宿主传入的 display 同步（R10-AC2：切视图不重建 store）。
 */
import { useEffect, useId, useMemo, useState } from 'react';
import { SourcePanel } from '@/components/ui';
import type {
  KnowledgeObject,
  Matrix2,
  Matrix2dResult,
  Parameter,
  SourceRef,
  TemplateProps,
  Vector2,
} from '@/api/types';
import { isMatrix2, isVector2 } from '@/api/types';
import { calcMatrix2d } from '@/domain/matrix';
import ComposeCompare from './ComposeCompare';
import MatrixCanvas, { type DisplayMode } from './MatrixCanvas';
import MatrixControls from './MatrixControls';
import MatrixNumericTable, { formatMat, formatValue, formatVec } from './MatrixNumericTable';
import MatrixSteps from './MatrixSteps';
import styles from './matrix.module.css';

const DISPLAY_MODES: readonly { value: DisplayMode; label: string }[] = [
  { value: 'original', label: '原始' },
  { value: 'transformed', label: '变换后' },
  { value: 'overlay', label: '叠加' },
];

/**
 * 课程材料（C-MAT@1）的五个页级来源。
 * 页号 → 摘要文案取自 §2.2.10 的 source_refs 表；`src_s{page}` 是契约规定的来源 id。
 */
const COURSE_PAGES: readonly { page: number; topic: string }[] = [
  { page: 6, topic: '三条向量，各去哪了' },
  { page: 9, topic: '矩阵的每一列是一个基向量的去向' },
  { page: 10, topic: '为什么换个顺序结果就不一样' },
  { page: 14, topic: '圆变成椭圆：SVD 的三步' },
  { page: 18, topic: '一块小方格怎样改变' },
];

/* -------------------------------------------------------------------------- */
/* 参数解析                                                                   */
/* -------------------------------------------------------------------------- */

type ParameterResolution =
  | {
      ok: true;
      matrixParameter: Parameter;
      vectorParameter: Parameter;
      secondMatrixParameter: Parameter | null;
      matrix: Matrix2;
      vector: Vector2;
      secondMatrix: Matrix2 | null;
    }
  | { ok: false; error: string };

function readConfigId(object: KnowledgeObject, key: string): string | null {
  const raw = object.config[key];
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

function findParameter(
  object: KnowledgeObject,
  explicitId: string | null,
  fallbackIds: readonly string[],
  types: readonly Parameter['type'][],
): Parameter | null {
  if (explicitId !== null) {
    const explicit = object.parameters.find((parameter) => parameter.id === explicitId);
    if (explicit !== undefined) return explicit;
  }
  for (const id of fallbackIds) {
    const candidate = object.parameters.find((parameter) => parameter.id === id);
    if (candidate !== undefined && types.includes(candidate.type)) return candidate;
  }
  return object.parameters.find((parameter) => types.includes(parameter.type)) ?? null;
}

/**
 * 按 `config.matrix_parameter_id` / `second_matrix_parameter_id` 定位参数，
 * 缺失时回退到 matrix_A / matrix_B / vector_x（与 domain/calcMatrix2d 的选参规则一致）。
 */
function resolveParameters(object: KnowledgeObject): ParameterResolution {
  const matrixParameter = findParameter(
    object,
    readConfigId(object, 'matrix_parameter_id'),
    ['matrix_A', 'matrix_a', 'A', 'matrix'],
    ['matrix2'],
  );
  if (matrixParameter === null) return { ok: false, error: '缺少矩阵参数（type="matrix2"）。' };
  const matrixValue = matrixParameter.value;
  if (!isMatrix2(matrixValue)) {
    return { ok: false, error: `参数 ${matrixParameter.name} 不是合法的 2×2 矩阵。` };
  }

  const vectorParameter = findParameter(object, null, ['vector_x', 'vector', 'x'], ['vector2']);
  if (vectorParameter === null) return { ok: false, error: '缺少输入向量参数（type="vector2"）。' };
  const vectorValue = vectorParameter.value;
  if (!isVector2(vectorValue)) {
    return { ok: false, error: `参数 ${vectorParameter.name} 不是合法的二维向量。` };
  }

  const secondMatrixParameter = findParameter(
    object,
    readConfigId(object, 'second_matrix_parameter_id'),
    ['matrix_B', 'matrix_b', 'B'],
    ['matrix2'],
  );
  const secondValue = secondMatrixParameter === null ? null : secondMatrixParameter.value;
  const secondMatrix =
    secondMatrixParameter !== null &&
    secondMatrixParameter.id !== matrixParameter.id &&
    isMatrix2(secondValue)
      ? secondValue
      : null;

  return {
    ok: true,
    matrixParameter,
    vectorParameter,
    secondMatrixParameter: secondMatrix === null ? null : secondMatrixParameter,
    matrix: matrixValue,
    vector: vectorValue,
    secondMatrix,
  };
}

/* -------------------------------------------------------------------------- */
/* 结果收窄                                                                   */
/* -------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 把宿主传入的 `unknown` 结果按 C-MX@1 形状收窄；不合法返回 null 交给兜底路径。 */
function asMatrix2dResult(value: unknown): Matrix2dResult | null {
  if (!isRecord(value)) return null;
  if (!isVector2(value['ax'])) return null;
  if (typeof value['det'] !== 'number' || typeof value['trace'] !== 'number') return null;

  const rank = value['rank'];
  if (rank !== 0 && rank !== 1 && rank !== 2) return null;
  if (typeof value['invertible'] !== 'boolean') return null;

  const singularReason = value['singular_reason'];
  if (singularReason !== null && typeof singularReason !== 'string') return null;

  const inverse = value['inverse'];
  if (inverse !== null && !isMatrix2(inverse)) return null;

  const columns = value['columns'];
  if (!Array.isArray(columns) || columns.length !== 2) return null;
  if (!isVector2(columns[0]) || !isVector2(columns[1])) return null;

  const eigenvalues = value['eigenvalues'];
  if (!isRecord(eigenvalues) || typeof eigenvalues['real'] !== 'boolean') return null;
  if (eigenvalues['real'] === true) {
    const values = eigenvalues['values'];
    if (!Array.isArray(values) || values.length !== 2) return null;
    if (typeof values[0] !== 'number' || typeof values[1] !== 'number') return null;
  } else if (typeof eigenvalues['reason'] !== 'string') {
    return null;
  }

  const steps = value['steps'];
  if (!Array.isArray(steps) || steps.length !== 2) return null;
  const firstStep = steps[0];
  const secondStep = steps[1];
  if (!isRecord(firstStep) || !Array.isArray(firstStep['terms'])) return null;
  if (!isRecord(secondStep)) return null;
  if (!isVector2(secondStep['partial']) || !isVector2(secondStep['result'])) return null;

  const ellipse = value['ellipse'];
  if (ellipse !== null) {
    if (!isRecord(ellipse)) return null;
    if (typeof ellipse['a'] !== 'number' || typeof ellipse['b'] !== 'number') return null;
  }

  const composition = value['composition'];
  if (composition !== null) {
    if (!isRecord(composition)) return null;
    if (composition['order'] !== 'A_then_B' && composition['order'] !== 'B_then_A') return null;
    if (!isMatrix2(composition['ab']) || !isMatrix2(composition['ba'])) return null;
    if (!isVector2(composition['abx']) || !isVector2(composition['bax'])) return null;
    if (typeof composition['commutes'] !== 'boolean') return null;
  }

  return value as unknown as Matrix2dResult;
}

function resolveResult(
  rawResult: unknown,
  object: KnowledgeObject,
): { result: Matrix2dResult; error: string | null } {
  const parsed = asMatrix2dResult(rawResult);
  if (parsed !== null) return { result: parsed, error: null };
  // 宿主未提供合法结果（独立挂载、mock 缺字段）时用契约纯函数兜底
  return calcMatrix2d(object);
}

/* -------------------------------------------------------------------------- */
/* 视图                                                                       */
/* -------------------------------------------------------------------------- */

export default function MatrixTemplate(props: TemplateProps) {
  const {
    object,
    result: rawResult,
    resultError,
    onParameterChange,
    onReset,
    onFocusSource,
    reducedMotion,
    display,
  } = props;

  const uid = useId();
  const canvasTitleId = `${uid}-canvas-title`;
  const sourceTitleId = `${uid}-source-title`;
  const [mode, setMode] = useState<DisplayMode>(display);
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);

  // 宿主若提供自己的模式开关，模板跟随同步（本地切换不回写宿主，避免越权改视图状态）
  useEffect(() => {
    setMode(display);
  }, [display]);

  const resolution = useMemo(() => resolveParameters(object), [object]);
  const outcome = useMemo(() => resolveResult(rawResult, object), [rawResult, object]);

  if (!resolution.ok) {
    return (
      <div className={styles.root} data-reduced-motion={reducedMotion ? 'true' : 'false'}>
        <section className={styles.card} role="alert">
          <h2 className={styles.title}>矩阵视图暂时不可用</h2>
          <p className={styles.lead}>{resolution.error}</p>
        </section>
      </div>
    );
  }

  const { matrix, vector, secondMatrix, matrixParameter, vectorParameter } = resolution;
  const { result } = outcome;
  const errorMessage = resultError ?? outcome.error;
  const sources: SourceRef[] = object.source_refs;

  const handleFocusSource = (sourceRefId: string): void => {
    setActiveSourceId(sourceRefId);
    onFocusSource(sourceRefId);
  };

  return (
    <div className={styles.root} data-reduced-motion={reducedMotion ? 'true' : 'false'}>
      <header className={styles.header}>
        <div>
          <h2 className={styles.title}>{object.title}</h2>
          <p className={styles.lead}>
            离输入最近的矩阵先执行：A(Bx) 表示先做 B、再做 A。拖动画布上的端点即可改动输入向量。
          </p>
        </div>
        <div className={styles.headerActions}>
          <div className={styles.modeGroup} role="group" aria-label="几何显示模式">
            {DISPLAY_MODES.map((option) => (
              <button
                key={option.value}
                type="button"
                className={
                  option.value === mode
                    ? `${styles.modeButton} ${styles.modeButtonActive}`
                    : styles.modeButton
                }
                aria-pressed={option.value === mode}
                onClick={() => setMode(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
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
          A = <span className={styles.summaryValue}>{formatMat(matrix)}</span>
        </span>
        <span className={styles.summaryItem}>
          x = <span className={styles.summaryValue}>{formatVec(vector)}</span>
        </span>
        <span className={styles.summaryItem}>
          Ax = <span className={styles.summaryValue}>{formatVec(result.ax)}</span>
        </span>
        <span className={styles.summaryItem}>
          det = <span className={styles.summaryValue}>{formatValue(result.det)}</span>
        </span>
        <span className={styles.summaryItem}>
          rank = <span className={styles.summaryValue}>{result.rank}</span>
        </span>
      </div>

      <div className={styles.mainGrid}>
        <section className={`${styles.card} ${styles.canvasCard}`} aria-labelledby={canvasTitleId}>
          <h3 id={canvasTitleId} className={styles.cardTitle}>
            平面上的像
          </h3>
          <MatrixCanvas
            matrix={matrix}
            vector={vector}
            rank={result.rank}
            ellipse={result.ellipse}
            display={mode}
            reducedMotion={reducedMotion}
            onVectorChange={(next) => onParameterChange(vectorParameter.id, next)}
          />
        </section>

        <aside className={styles.side}>
          <MatrixControls
            matrixParameter={matrixParameter}
            vectorParameter={vectorParameter}
            matrix={matrix}
            vector={vector}
            onChange={onParameterChange}
          />
          <MatrixNumericTable result={result} />
        </aside>
      </div>

      <div className={styles.lowerGrid}>
        <MatrixSteps steps={result.steps} vector={vector} ax={result.ax} />
        <ComposeCompare
          matrix={matrix}
          secondMatrix={secondMatrix}
          vector={vector}
          composition={result.composition}
        />
      </div>

      <section className={`${styles.card} ${styles.sourceSection}`} aria-labelledby={sourceTitleId}>
        <h3 id={sourceTitleId} className={styles.cardTitle}>
          来源
        </h3>

        <div className={styles.coursePages}>
          {COURSE_PAGES.map(({ page, topic }) => {
            const matched = sources.find((source) => source.page === page) ?? null;
            // 页级来源：契约固定 id 为 src_s{page}；示例对象没有这些来源时按页号通知工作台定位
            const sourceRefId = matched === null ? `src_s${page}` : matched.id;
            return (
              <button
                key={page}
                type="button"
                className={`${styles.button} ${styles.coursePageButton}`}
                onClick={() => handleFocusSource(sourceRefId)}
                aria-label={`定位到课程材料第 ${page} 页：${topic}`}
                title={
                  matched === null
                    ? `当前对象未绑定第 ${page} 页来源，点击将按页号通知工作台定位`
                    : matched.label
                }
              >
                <span className={styles.coursePageLabel}>第 {page} 页</span>
                <span className={styles.coursePageMeta}>
                  {topic} · {matched === null ? '按页号定位' : '页级来源'}
                </span>
              </button>
            );
          })}
        </div>

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
          页级来源只定位到页码并高亮该页，不绘制元素框（bbox 为 null，禁止伪造元素级来源）。
        </p>
      </section>
    </div>
  );
}