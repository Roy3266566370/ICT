/**
 * MatrixSteps.tsx —— 两步步骤视图（R6-AC9 / T5 验收 2、5）
 *
 * 语义（§2.2.3 规则 + fixtures/golden/matrix_2d.json 的 mx_basic 注释）：
 *  Step 1「取输入坐标当倍数」：x1、x2 分别是两列的倍数；
 *  Step 2「组合各列」：partial 是"累加完第一项之后的部分和"，再与第二项相加得到 Ax。
 *
 * 全部用具体数值呈现（`1 × [1, 0] + 1 × [1, 1]`），不写抽象的 Σ 符号，
 * 并显式对照数值表的 Ax，验证"步骤与数值表一致"。
 */
import { useId } from 'react';
import type { MatrixStep1, MatrixStep2, Vector2 } from '@/api/types';
import { EPSILON, round } from '@/domain/format';
import { formatValue, formatVec } from './MatrixNumericTable';
import styles from './matrix.module.css';

/** 列向量用方括号展示，与输入/结果的圆括号区分，避免"列还是点"的歧义。 */
function bracket(vector: Vector2): string {
  return `[${formatValue(vector[0])}, ${formatValue(vector[1])}]`;
}

/** 倍数 × 列向量；用 domain 的 round 消除 0.1 × 3 = 0.30000000000000004 这类尾差。 */
function scaledVector(factor: number, vector: Vector2): Vector2 {
  return [round(factor * vector[0]), round(factor * vector[1])];
}

function nearlySame(a: Vector2, b: Vector2): boolean {
  return Math.abs(a[0] - b[0]) <= EPSILON && Math.abs(a[1] - b[1]) <= EPSILON;
}

export interface MatrixStepsProps {
  steps: [MatrixStep1, MatrixStep2];
  vector: Vector2;
  ax: Vector2;
}

export default function MatrixSteps({ steps, vector, ax }: MatrixStepsProps) {
  const uid = useId();
  const titleId = `${uid}-title`;
  const [firstStep, secondStep] = steps;
  const [firstTerm, secondTerm] = firstStep.terms;

  if (firstTerm === undefined || secondTerm === undefined) {
    return (
      <section className={styles.card} aria-labelledby={titleId}>
        <h3 id={titleId} className={styles.cardTitle}>
          两步步骤
        </h3>
        <p className={styles.note} role="note">
          步骤数据缺少列项（terms 不足 2 项），公式已停止渲染。请检查 domain 派生结果。
        </p>
      </section>
    );
  }

  const firstProduct = scaledVector(firstTerm.coefficient, firstTerm.column);
  const secondProduct = scaledVector(secondTerm.coefficient, secondTerm.column);
  const isZeroVector = Math.abs(vector[0]) <= EPSILON && Math.abs(vector[1]) <= EPSILON;
  const resultMatches = nearlySame(secondStep.result, ax);

  return (
    <section className={styles.card} aria-labelledby={titleId}>
      <h3 id={titleId} className={styles.cardTitle}>
        两步步骤
      </h3>

      <div className={styles.stepList}>
        <div className={styles.stepBlock}>
          <div className={styles.stepHeader}>
            <h4 className={styles.stepTitle}>第 1 步 · {firstStep.title}</h4>
            <span className={styles.stepBadge}>x 的坐标当倍数</span>
          </div>

          <div className={styles.formulaBlock}>
            <div className={styles.formulaLine}>
              <span className={styles.formulaKey}>输入</span>
              <span>x = {formatVec(vector)}</span>
            </div>
            <div className={styles.formulaLine}>
              <span>
                {formatValue(firstTerm.coefficient)} × {bracket(firstTerm.column)}
              </span>
              <span className={styles.formulaOp}>+</span>
              <span>
                {formatValue(secondTerm.coefficient)} × {bracket(secondTerm.column)}
              </span>
            </div>
            <div className={styles.formulaLine}>
              <span className={styles.formulaKey}>各项先乘倍数</span>
              <span>
                {bracket(firstProduct)} + {bracket(secondProduct)}
              </span>
            </div>
          </div>

          <div className={styles.termGrid}>
            <div className={styles.termCard}>
              <span className={styles.termHead}>第 1 项</span>
              <span className={styles.termBody}>
                {formatValue(firstTerm.coefficient)} × 第 {firstTerm.column_index + 1} 列{' '}
                {bracket(firstTerm.column)} = {bracket(firstProduct)}
              </span>
            </div>
            <div className={styles.termCard}>
              <span className={styles.termHead}>第 2 项</span>
              <span className={styles.termBody}>
                {formatValue(secondTerm.coefficient)} × 第 {secondTerm.column_index + 1} 列{' '}
                {bracket(secondTerm.column)} = {bracket(secondProduct)}
              </span>
            </div>
          </div>
        </div>

        <div className={styles.stepBlock}>
          <div className={styles.stepHeader}>
            <h4 className={styles.stepTitle}>第 2 步 · {secondStep.title}</h4>
            <span className={resultMatches ? styles.stepBadge : styles.stepBadgeWarn}>
              {resultMatches ? '与 Ax 一致' : '与 Ax 不一致'}
            </span>
          </div>

          <div className={styles.formulaBlock}>
            <div className={styles.formulaLine}>
              <span className={styles.formulaKey}>部分和（累加完第一项）</span>
              <span>{bracket(secondStep.partial)}</span>
            </div>
            <div className={styles.formulaLine}>
              <span className={styles.formulaKey}>再加第二项</span>
              <span>{bracket(secondProduct)}</span>
            </div>
            <div className={styles.formulaLine}>
              <span className={styles.formulaKey}>结果</span>
              <span>
                {bracket(secondStep.partial)} + {bracket(secondProduct)} ={' '}
                {bracket(secondStep.result)}
              </span>
            </div>
            <div className={styles.formulaLine}>
              <span className={styles.formulaKey}>对照数值表</span>
              <span>Ax = {formatVec(ax)}</span>
            </div>
          </div>

          <p className={styles.note}>
            {isZeroVector
              ? '输入的 x 是零向量，两个倍数都是 0，各列贡献都是 [0, 0]，所以 Ax = (0, 0)；此时方向未定义。'
              : '先把第一项整体算出来作为部分和，再把第二项加上去；两步累加的结果与数值表的 Ax 相同。'}
          </p>
        </div>
      </div>
    </section>
  );
}