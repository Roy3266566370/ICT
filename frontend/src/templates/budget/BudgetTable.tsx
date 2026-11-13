/**
 * BudgetTable.tsx —— budget_compare 的对比表（R9-AC1 / R9-AC2 / R9-AC4 / R9-AC5）
 *
 *  - 固定成本 / 人均成本 / 总额 / 差额 / 余量一律取内核输出（C-BUD@1 的十进制字符串），
 *    只用 `formatMoney` 加千分位，单元格 `title` 保留原始值（如 "9400.00"）；
 *    本组件不做任何 `number` 金额运算。
 *  - 差额 = plan_a − plan_b；`equal=true` 明确标「相等」。
 *  - 只有设置上限时才渲染「余量 / 预算状态」两列；未设上限（remaining=null）整列不渲染（R9-AC5）。
 *  - 盈亏平衡提示：金额比较全部走定点十进制（decCompare）；仅交叉点人数是浮点换算值（文案带「约」）。
 */
import type { BudgetCompareResult } from '@/api/types';
import { decCompare, decFromString, PEOPLE_MAX } from '@/domain/budget';
import { formatMoney, formatNumber, trimDecimalString } from '@/domain/format';
import styles from './budget.module.css';

export interface BudgetTableProps {
  result: BudgetCompareResult;
  names: [string, string];
}

/**
 * 盈亏平衡点提示：用内核输出的 fixed / per_person 做定点十进制比较，
 * 交叉点人数由两点式直线解出（仅提示用，带「约」字）。
 */
function breakevenNote(result: BudgetCompareResult, names: [string, string]): string {
  const scenarioA = result.scenarios[0];
  const scenarioB = result.scenarios[1];
  const fixedA = decFromString(scenarioA.fixed);
  const fixedB = decFromString(scenarioB.fixed);
  const slopeA = decFromString(scenarioA.per_person);
  const slopeB = decFromString(scenarioB.per_person);
  if (fixedA === null || fixedB === null || slopeA === null || slopeB === null) {
    return '固定成本或人均成本不是合法的十进制数，无法判断盈亏平衡点。';
  }

  const sameFixed = decCompare(fixedA, fixedB) === 0;
  const sameSlope = decCompare(slopeA, slopeB) === 0;

  if (sameFixed && sameSlope) {
    return '两方案完全相同（固定成本与人均成本都相同），任何人数下总额都相等。';
  }
  if (sameSlope) {
    return decCompare(fixedA, fixedB) < 0
      ? `两方案人均成本相同，${names[0]} 的固定成本更低，因此任何人数下 ${names[0]} 都更省。`
      : `两方案人均成本相同，${names[1]} 的固定成本更低，因此任何人数下 ${names[1]} 都更省。`;
  }

  // 两点式直线交点：n* = (fixedB − fixedA) / (perA − perB)。浮点只用于「约 n」的提示文案。
  const crossPeople =
    (Number(scenarioB.fixed) - Number(scenarioA.fixed)) /
    (Number(scenarioA.per_person) - Number(scenarioB.per_person));
  if (!Number.isFinite(crossPeople)) {
    return '无法解出两方案的交叉点（人均成本差为 0 或数值异常）。';
  }
  if (crossPeople < 0 || crossPeople > PEOPLE_MAX) {
    return `在 0 ~ ${PEOPLE_MAX} 人的区间内两条直线没有交叉点：${
      decCompare(fixedA, fixedB) < 0 ? names[0] : names[1]
    } 始终更省。`;
  }
  const cheaperAtZero = decCompare(fixedA, fixedB) < 0 ? names[0] : names[1];
  const cheaperLater = cheaperAtZero === names[0] ? names[1] : names[0];
  return `盈亏平衡点约 n = ${trimDecimalString(formatNumber(crossPeople, 1))} 人：少于该人数时 ${cheaperAtZero} 更省，超过后 ${cheaperLater} 更省。`;
}

export default function BudgetTable({ result, names }: BudgetTableProps) {
  const remaining = result.remaining;
  const overBudget = result.over_budget;
  const hasLimit = remaining !== null && overBudget !== null;
  const columnCount = hasLimit ? 6 : 4;

  const differenceAbs = result.difference.startsWith('-')
    ? result.difference.slice(1)
    : result.difference;
  const differenceText = result.equal
    ? '两方案总额相等'
    : `${names[0]} 比 ${names[1]} ${result.difference.startsWith('-') ? '少' : '多'} ${formatMoney(
        differenceAbs,
      )} 元`;

  return (
    <div className={styles.tableBlock}>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <caption className={styles.tableCaption}>
            两方案成本对比（单位：元；总额 = 固定成本 + 人均成本 × n，金额均为十进制字符串）
          </caption>
          <thead>
            <tr>
              <th scope="col">方案</th>
              <th scope="col">固定成本（元）</th>
              <th scope="col">人均成本（元/人）</th>
              <th scope="col">n = {result.inputs.people} 总额（元）</th>
              {hasLimit ? (
                <>
                  <th scope="col">余量（元）</th>
                  <th scope="col">预算状态</th>
                </>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {result.scenarios.map((scenario, index) => {
              const name = names[index] ?? scenario.name;
              const remainingValue = hasLimit ? remaining[index] : null;
              const over = hasLimit && overBudget[index] === true;
              return (
                <tr key={scenario.scenario_id}>
                  <th scope="row">
                    <span
                      className={`${styles.colorChip} ${index === 0 ? styles.colorChipA : styles.colorChipB}`}
                      aria-hidden="true"
                    />
                    {name}
                  </th>
                  <td title={scenario.fixed}>{formatMoney(scenario.fixed)}</td>
                  <td title={scenario.per_person}>{formatMoney(scenario.per_person)}</td>
                  <td className={styles.totalCell} title={scenario.total}>
                    {formatMoney(scenario.total)}
                  </td>
                  {hasLimit && typeof remainingValue === 'string' ? (
                    <>
                      <td className={over ? styles.negative : styles.positive} title={remainingValue}>
                        {formatMoney(remainingValue)}
                      </td>
                      <td>
                        {over ? (
                          <span className={styles.badgeOver}>⚠ 超预算</span>
                        ) : (
                          <span className={styles.badgeOk}>✓ 在预算内</span>
                        )}
                      </td>
                    </>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className={styles.diffRow}>
              <th scope="row">差额（A − B）</th>
              <td colSpan={columnCount - 1}>
                <span className={styles.diffValue} title={result.difference}>
                  {formatMoney(result.difference)} 元
                </span>
                {result.equal ? (
                  <span className={styles.equalBadge}>相等</span>
                ) : (
                  <span className={styles.diffText}>{differenceText}</span>
                )}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className={styles.breakeven} role="note">
        <strong>盈亏平衡：</strong>
        {breakevenNote(result, names)}
      </p>

      {hasLimit ? (
        <p className={styles.tableNote}>
          余量 = 上限 − 总额（十进制字符串）；余量为负即标「超预算」。余量为 0 表示刚好用完预算。
        </p>
      ) : (
        <p className={styles.tableNote}>
          未设置预算上限：本表不渲染余量与预算状态列，曲线也不绘制预算水平线。
        </p>
      )}

      <p className={styles.tableNote}>
        金额精度：采用十进制计算，避免二进制浮点误差——固定成本、人均成本、总额、差额与余量全部取内核输出的
        十进制字符串（表格 {'`title`'} 中保留如 {'"9400.00"'} 的原始值），本视图不做任何 {'`number`'} 金额运算。
      </p>
    </div>
  );
}