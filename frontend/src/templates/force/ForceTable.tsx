/**
 * ForceTable.tsx —— force_2d 的数值表（R7-AC4）
 *
 * 逐力列出「大小 / 方向 / Fx / Fy」，末行为合力；合力方向未定义时显示"未定义"，
 * 绝不显示 0° 或 NaN（R7-AC3）。全零力时给出"没有可合成的力"提示。
 */
import type { Force2dResult } from '@/api/types';
import { formatNumber, trimDecimalString } from '@/domain/format';
import styles from './force.module.css';

export interface ForceTableProps {
  result: Force2dResult;
  /** 所有力的大小均为 0：此时合力没有方向，表格下方给出提示 */
  allZero: boolean;
}

/** 去掉尾随零的两位小数展示："10.00" → "10"。 */
function num(value: number, digits = 2): string {
  return trimDecimalString(formatNumber(value, digits));
}

/** 方向列：未定义时写"未定义"，不输出 0°。 */
function directionText(value: number | null): string {
  return value === null ? '未定义' : `${num(value, 2)}°`;
}

export default function ForceTable({ result, allZero }: ForceTableProps) {
  return (
    <section className={styles.card} aria-label="力的数值表">
      <h3 className={styles.cardTitle}>
        数值表
        <span className={styles.cardTitleMeta}>分解到 x / y 两个方向</span>
      </h3>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <caption className={styles.tableCaption}>
            各力的分量与合力分量（单位 N；方向单位 deg）
          </caption>
          <thead>
            <tr>
              <th scope="col">力</th>
              <th scope="col">大小 (N)</th>
              <th scope="col">方向 (°)</th>
              <th scope="col">Fx (N)</th>
              <th scope="col">Fy (N)</th>
            </tr>
          </thead>
          <tbody>
            {result.forces.map((force, index) => (
              <tr key={`row-${index}`}>
                <th scope="row">F{index + 1}</th>
                <td>{trimDecimalString(force.magnitude)}</td>
                <td>{directionText(force.angle_deg)}</td>
                <td>{num(force.fx)}</td>
                <td>{num(force.fy)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className={styles.totalRow}>
              <th scope="row">合力 R</th>
              <td>{trimDecimalString(result.magnitude_rounded)}</td>
              <td>{directionText(result.direction_deg)}</td>
              <td>{num(result.fx)}</td>
              <td>{num(result.fy)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <dl className={styles.miniTable}>
        <div className={styles.miniRow}>
          <dt>合力大小（舍入显示）</dt>
          <dd>
            {trimDecimalString(result.magnitude_rounded)} N
            <span className={styles.miniHint}>按展示精度（display_precision）舍入</span>
          </dd>
        </div>
        <div className={styles.miniRow}>
          <dt>合力大小（计算精度）</dt>
          <dd>
            {trimDecimalString(result.magnitude_exact)} N
            <span className={styles.miniHint}>按计算精度（compute_precision）保留，用于比较与校验</span>
          </dd>
        </div>
        <div className={styles.miniRow}>
          <dt>合力方向</dt>
          <dd>
            {result.direction_defined && result.direction_rounded !== null
              ? `${trimDecimalString(result.direction_rounded)}°`
              : '未定义（合力为零，方向没有意义）'}
          </dd>
        </div>
      </dl>

      {allZero ? (
        <p className={styles.emptyNote} role="status">
          没有可合成的力：所有力的大小都是 0N，合力为 0，方向未定义。
        </p>
      ) : null}

      <p className={styles.tableNote}>
        求和方式：Fx = Σ m·cos(θ)、Fy = Σ m·sin(θ)、合力大小 = √(Fx² + Fy²)；
        数值容差 {result.tolerance}（小于该值即视为合力为零）。{result.note}
      </p>
    </section>
  );
}