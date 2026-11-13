/**
 * MatrixNumericTable.tsx —— matrix_2d 实时数值表（R6-AC7、R6-AC10）
 *
 * 同时导出本目录统一的数值格式化工具，供画布标签、步骤视图、组合对比复用：
 * 同一份 `Matrix2dResult` 在三处显示的数字必须逐字一致，否则用户会怀疑
 * "同一个结果为什么出现两种写法"。
 *
 * 精度策略：契约里的 `formatNumber(value, digits)` 是"固定小数位"（2.00），
 * 适合展示舍入值与精度说明；矩阵/向量的元素是精确的小数（参数步长 0.1），
 * 这里统一按 2 位小数格式化后去掉无意义的尾随零，得到 `(2, 1)` 而不是 `(2.00, 1.00)`。
 * 非有限数一律显示 "—"，绝不把 NaN / Infinity 打印给用户。
 */
import { useId, useState } from 'react';
import type { Matrix2, Matrix2dResult, Vector2 } from '@/api/types';
import styles from './matrix.module.css';

/** 展示精度（小数位）。 */
const DISPLAY_DIGITS = 2;

/** 舍入容差：Ax 方向是否"未定义"的判定阈值（与契约 rank 容差同量级）。 */
const ZERO_LENGTH_EPSILON = 1e-9;

/** 数值展示："2.00" → "2"，"1.20" → "1.2"，"-0.00" → "0"。 */
export function formatValue(value: number, digits = DISPLAY_DIGITS): string {
  if (!Number.isFinite(value)) return '—';
  const text = value.toFixed(digits);
  // 只有带小数点时才裁尾随零，否则 "100" 会被裁成 "1"（digits=0 的刻度标签会踩到）
  const trimmed = text.includes('.') ? text.replace(/\.?0+$/, '') : text;
  if (trimmed === '' || trimmed === '-' || trimmed === '-0') return '0';
  return trimmed;
}

/** 向量展示："(2, 1)"。 */
export function formatVec(vector: Vector2, digits = DISPLAY_DIGITS): string {
  return `(${formatValue(vector[0], digits)}, ${formatValue(vector[1], digits)})`;
}

/** 矩阵展示："[[1, 1], [0, 1]]"。 */
export function formatMat(matrix: Matrix2, digits = DISPLAY_DIGITS): string {
  return `[[${formatValue(matrix[0][0], digits)}, ${formatValue(matrix[0][1], digits)}], [${formatValue(
    matrix[1][0],
    digits,
  )}, ${formatValue(matrix[1][1], digits)}]]`;
}

/**
 * `Ax` 的方向角（从 +x 轴逆时针，0°~360°）。
 * R6-AC11：`Ax=(0,0)` 时方向未定义——必须显示中文说明，不能显示 0° 或 NaN。
 */
export function directionOf(vector: Vector2): string {
  if (Math.hypot(vector[0], vector[1]) <= ZERO_LENGTH_EPSILON) return '方向未定义';
  const raw = (Math.atan2(vector[1], vector[0]) * 180) / Math.PI;
  const normalized = (raw + 360) % 360;
  return `${formatValue(normalized, 2)}°`;
}

export interface MatrixNumericTableProps {
  result: Matrix2dResult;
}

export default function MatrixNumericTable({ result }: MatrixNumericTableProps) {
  const uid = useId();
  const [showInverse, setShowInverse] = useState(false);
  const titleId = `${uid}-title`;
  const singularReasonId = `${uid}-singular`;
  const eigenvalues = result.eigenvalues;

  return (
    <section className={styles.card} aria-labelledby={titleId}>
      <h3 id={titleId} className={styles.cardTitle}>
        数值表
      </h3>

      <p className={styles.axHeadline}>
        <span className={styles.tag}>Ax</span>
        <span className={`${styles.numeric} ${styles.numericStrong}`}>{formatVec(result.ax)}</span>
      </p>

      <table className={styles.table}>
        <caption className={styles.srOnly}>矩阵 A 作用于输入向量 x 的实时派生量</caption>
        <tbody>
          <tr>
            <th scope="row">两列去向</th>
            <td className={styles.numeric}>
              <span className={styles.stack}>
                A·e1 = {formatVec(result.columns[0])}（第 1 列）
              </span>
              <span className={styles.stack}>
                A·e2 = {formatVec(result.columns[1])}（第 2 列）
              </span>
            </td>
          </tr>
          <tr>
            <th scope="row">det / trace</th>
            <td className={styles.numeric}>
              det = {formatValue(result.det)}，trace = {formatValue(result.trace)}
            </td>
          </tr>
          <tr>
            <th scope="row">rank</th>
            <td className={styles.numeric}>{result.rank}</td>
          </tr>
          <tr>
            <th scope="row">特征值</th>
            <td className={styles.numeric}>
              {eigenvalues.real ? (
                <span>
                  λ1 = {formatValue(eigenvalues.values[0])}，λ2 ={' '}
                  {formatValue(eigenvalues.values[1])}
                </span>
              ) : (
                <>
                  <span>该矩阵没有实特征向量（旋转型），特征值在复数域</span>
                  <span className={styles.subtle}>{eigenvalues.reason}</span>
                </>
              )}
            </td>
          </tr>
          <tr>
            <th scope="row">Ax 方向</th>
            <td className={styles.numeric}>{directionOf(result.ax)}</td>
          </tr>
        </tbody>
      </table>

      {result.rank < 2 ? (
        <p className={styles.note} role="note">
          {result.rank === 1
            ? 'rank=1：矩阵把平面压成一条线，单位圆的像不再是椭圆，画布因此不绘制椭圆。'
            : 'rank=0：矩阵把平面压成一个点（零矩阵），画布因此不绘制椭圆。'}
        </p>
      ) : null}

      <div className={styles.inverseBlock}>
        <button
          type="button"
          className={styles.button}
          onClick={() => setShowInverse((previous) => !previous)}
          disabled={!result.invertible}
          aria-describedby={result.invertible ? undefined : singularReasonId}
        >
          {result.invertible
            ? showInverse
              ? '隐藏逆矩阵 A⁻¹'
              : '显示逆矩阵 A⁻¹'
            : '求逆不可用（矩阵奇异）'}
        </button>
        {!result.invertible && result.singular_reason !== null ? (
          <p id={singularReasonId} className={styles.errorText} role="note">
            {result.singular_reason}；本视图拒绝求逆，不返回伪造的逆矩阵。
          </p>
        ) : null}
        {result.invertible && showInverse && result.inverse !== null ? (
          <p className={`${styles.numeric} ${styles.inverseValue}`}>
            A⁻¹ = {formatMat(result.inverse)}
          </p>
        ) : null}
      </div>
    </section>
  );
}