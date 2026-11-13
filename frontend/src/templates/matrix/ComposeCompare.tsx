/**
 * ComposeCompare.tsx —— 组合顺序对比（R6-AC2 / R6-AC3 / T5 验收 7）
 *
 * §2.3.6 的记法约定：`AB = A·B` 表示"先执行 B，再执行 A"，即 `(AB)x = A(Bx)`。
 * 因此界面上必须写清"先执行哪个"，并同时给出中间量（Bx / Ax）与最终量（ABx / BAx），
 * 不允许只摆 `AB`、`BA` 两个符号让用户自己猜顺序。
 *
 * 数据来源优先级：
 *  1. `Matrix2dResult.composition`（对象为 matrix_compose 且绑定了 matrix_B 时由 domain 给出）；
 *  2. 对象未绑定第二个矩阵时，用与本仓库示例一致的演示对照矩阵 B=[[1, 0], [1, 1]]，
 *     并在界面上明确标注"演示对照矩阵"，不伪造"对象自带的 B"。
 */
import { useId } from 'react';
import type { Matrix2, MatrixComposition, Vector2 } from '@/api/types';
import { applyMatrix, multiplyMatrices } from '@/domain/matrix';
import { EPSILON } from '@/domain/format';
import { formatMat, formatVec } from './MatrixNumericTable';
import styles from './matrix.module.css';

/** 对象未绑定 matrix_B 时使用的演示对照矩阵（与 fixtures/examples/matrix_2d.json 的 B 一致）。 */
const DEMO_SECOND_MATRIX: Matrix2 = [
  [1, 0],
  [1, 1],
];

export interface ComposeCompareProps {
  matrix: Matrix2;
  secondMatrix: Matrix2 | null;
  vector: Vector2;
  composition: MatrixComposition | null;
}

export default function ComposeCompare({
  matrix,
  secondMatrix,
  vector,
  composition,
}: ComposeCompareProps) {
  const uid = useId();
  const titleId = `${uid}-title`;
  const isDemoSecondMatrix = secondMatrix === null;
  const b = secondMatrix ?? DEMO_SECOND_MATRIX;

  const ab = composition?.ab ?? multiplyMatrices(matrix, b);
  const ba = composition?.ba ?? multiplyMatrices(b, matrix);
  const abx = composition?.abx ?? applyMatrix(ab, vector);
  const bax = composition?.bax ?? applyMatrix(ba, vector);
  const commutes = composition?.commutes ?? sameVector(abx, bax);

  // 中间量：先执行的那一步
  const bx = applyMatrix(b, vector);
  const axFirst = applyMatrix(matrix, vector);

  return (
    <section className={styles.card} aria-labelledby={titleId}>
      <h3 id={titleId} className={styles.cardTitle}>
        组合顺序对比
      </h3>

      {isDemoSecondMatrix ? (
        <p className={styles.note} role="note">
          当前对象没有绑定第二个矩阵参数 matrix_B，下面用演示对照矩阵 B = {formatMat(DEMO_SECOND_MATRIX)}{' '}
          做对比；这不是材料里的原始数据。
        </p>
      ) : (
        <p className={styles.sourceNote}>
          离输入最近的矩阵先执行：A(Bx) 表示先做 B、再做 A；(AB)x 是同一件事的矩阵写法。
        </p>
      )}

      <div className={styles.composeGrid}>
        <div className={styles.composeCard}>
          <span className={styles.composeOrderBadge}>先执行 B，再执行 A</span>
          <div className={styles.composeFlow}>
            <div className={styles.flowRow}>
              <span className={styles.flowValue}>x = {formatVec(vector)}</span>
            </div>
            <div className={styles.flowRow}>
              <span className={styles.flowValue}>Bx = {formatVec(bx)}</span>
              <span className={styles.flowStep}>① 先做 B</span>
            </div>
            <div className={styles.flowRow}>
              <span className={styles.flowValue}>
                A(Bx) = {formatVec(abx)}
              </span>
              <span className={styles.flowStep}>② 再做 A</span>
            </div>
          </div>
          <p className={styles.composeMatrix}>
            等价的矩阵写法：(AB)x = {formatVec(abx)}
            <br />
            AB = {formatMat(ab)}
          </p>
        </div>

        <div className={styles.composeCard}>
          <span className={styles.composeOrderBadge}>先执行 A，再执行 B</span>
          <div className={styles.composeFlow}>
            <div className={styles.flowRow}>
              <span className={styles.flowValue}>x = {formatVec(vector)}</span>
            </div>
            <div className={styles.flowRow}>
              <span className={styles.flowValue}>Ax = {formatVec(axFirst)}</span>
              <span className={styles.flowStep}>① 先做 A</span>
            </div>
            <div className={styles.flowRow}>
              <span className={styles.flowValue}>
                B(Ax) = {formatVec(bax)}
              </span>
              <span className={styles.flowStep}>② 再做 B</span>
            </div>
          </div>
          <p className={styles.composeMatrix}>
            等价的矩阵写法：(BA)x = {formatVec(bax)}
            <br />
            BA = {formatMat(ba)}
          </p>
        </div>
      </div>

      <p
        className={commutes ? styles.verdict : `${styles.verdict} ${styles.verdictDiffer}`}
        role="status"
      >
        {commutes
          ? `两种顺序都得到 ${formatVec(abx)}，这两个矩阵恰好可交换；但一般情况下 AB ≠ BA。`
          : `两种顺序结果不同：A(Bx) = ${formatVec(abx)}，B(Ax) = ${formatVec(
              bax,
            )}。所以"先乘哪个"必须写清楚，不能只写 AB。`}
      </p>
    </section>
  );
}

function sameVector(a: Vector2, b: Vector2): boolean {
  return Math.abs(a[0] - b[0]) <= EPSILON && Math.abs(a[1] - b[1]) <= EPSILON;
}