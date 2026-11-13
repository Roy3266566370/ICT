import type { ParameterType, Provenance } from '@/api/types';
import { formatProvenance, formatUnit } from './format';
import styles from './CandidateTable.module.css';

const PARAMETER_TYPE_LABELS: Record<ParameterType, string> = {
  matrix2: '矩阵 2×2',
  vector2: '向量 2 维',
  force_list: '共点力列表',
  graph: '图',
  integer: '整数',
  decimal: '十进制金额',
  enum: '枚举',
  text: '文本',
};

export type CandidateFieldStatus = 'present' | 'missing' | 'inferred';

/** 候选参数行：由准备页从 `CandidateObject.fields` + 对应 `KnowledgeObject.parameters` 归并而来。 */
export interface CandidateParameterRow {
  /** `${candidateId}:${parameterId}`，行内唯一。 */
  key: string;
  candidateId: string;
  parameterId: string;
  name: string;
  type: ParameterType;
  /** 可直接编辑的文本形态，回写时由 `parseParameterValueText` 还原。 */
  valueText: string;
  unit: string;
  rangeText: string;
  sourcePage: number | null;
  provenance: Provenance | null;
  fieldStatus: CandidateFieldStatus;
  confirmed: boolean;
  error: string | null;
  editable: boolean;
}

/** 候选关系行：契约缺口 C-2（`CandidateObject` 无 relations 字段），由参数绑定与 config 推导展示。 */
export interface CandidateRelationRow {
  key: string;
  candidateId: string;
  label: string;
  detail: string;
  confirmed: boolean;
}

export interface CandidateTableProps {
  templateName: string;
  confidenceHint: 'low' | 'medium';
  rows: CandidateParameterRow[];
  relations: CandidateRelationRow[];
  allConfirmed: boolean;
  missingCount: number;
  disabled?: boolean;
  onToggleAll: (checked: boolean) => void;
  onToggleRow: (key: string) => void;
  onEditValue: (key: string, valueText: string) => void;
  onToggleRelation: (key: string) => void;
  onFocusSource: (page: number) => void;
}

function statusChip(status: CandidateFieldStatus): { text: string; tone: 'ok' | 'warn' | 'info' } {
  if (status === 'missing') return { text: '缺字段', tone: 'warn' };
  if (status === 'inferred') return { text: '系统推断', tone: 'info' };
  return { text: '原文字段', tone: 'ok' };
}

/**
 * 候选对象与字段确认表（准备页中部）。
 * 纯受控组件：不持有状态，勾选/编辑/确认全部上抛给页面，便于一次性提交 #13。
 */
export function CandidateTable({
  templateName,
  confidenceHint,
  rows,
  relations,
  allConfirmed,
  missingCount,
  disabled = false,
  onToggleAll,
  onToggleRow,
  onEditValue,
  onToggleRelation,
  onFocusSource,
}: CandidateTableProps) {
  const toggleAllId = 'candidate-toggle-all';

  return (
    <section className={styles.wrap} aria-label="候选对象与字段确认">
      <header className={styles.head}>
        <div>
          <h2 className={styles.title}>候选对象与字段确认</h2>
          <p className={styles.subtitle}>
            模板：<strong>{templateName}</strong>
            <span className={styles.sep} aria-hidden="true">
              ·
            </span>
            匹配置信度：{confidenceHint === 'medium' ? '中' : '低'}
          </p>
        </div>
        <label className={styles.toggleAll} htmlFor={toggleAllId}>
          <input
            id={toggleAllId}
            type="checkbox"
            checked={allConfirmed && rows.length > 0}
            disabled={disabled || rows.length === 0 || missingCount > 0}
            onChange={(event) => onToggleAll(event.target.checked)}
          />
          全选确认
        </label>
      </header>

      <p className={styles.notice} role="note">
        同名符号或相似图形<strong>不能自动合并</strong>：必须主题、定义、单位与来源页一致才可绑定；
        仅凭名称相同或图形相似一律视作不同对象。
      </p>

      {missingCount > 0 && (
        <p className={styles.alert} role="alert">
          仍有 {missingCount} 个候选字段缺失，补齐并确认后才能编译。
        </p>
      )}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <caption className={styles.caption}>
            确认勾选后，该参数将以 <code>user_confirmed</code> 来源状态写入对象；未勾选的保持原状态。
          </caption>
          <thead>
            <tr>
              <th scope="col" className={styles.colCheck}>
                确认
              </th>
              <th scope="col">名称</th>
              <th scope="col">类型</th>
              <th scope="col" className={styles.colValue}>
                值
              </th>
              <th scope="col">单位</th>
              <th scope="col">范围</th>
              <th scope="col">来源页</th>
              <th scope="col">来源状态</th>
              <th scope="col">字段情况</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const chip = statusChip(row.fieldStatus);
              const sourceId = `source-${row.key}`;
              return (
                <tr key={row.key} data-confirmed={row.confirmed ? 'true' : undefined}>
                  <td className={styles.colCheck}>
                    <input
                      type="checkbox"
                      checked={row.confirmed}
                      disabled={disabled}
                      aria-label={`确认参数 ${row.name}`}
                      onChange={() => onToggleRow(row.key)}
                    />
                  </td>
                  <th scope="row" className={styles.nameCell}>
                    <span className={styles.paramName}>{row.name}</span>
                    <code className={styles.paramId}>{row.parameterId}</code>
                  </th>
                  <td className={styles.mono}>{PARAMETER_TYPE_LABELS[row.type] ?? row.type}</td>
                  <td className={styles.colValue}>
                    <input
                      className={styles.valueInput}
                      type="text"
                      value={row.valueText}
                      disabled={disabled || !row.editable}
                      aria-label={`${row.name} 的值`}
                      aria-invalid={row.error !== null}
                      aria-describedby={row.error !== null ? `${row.key}-error` : undefined}
                      onChange={(event) => onEditValue(row.key, event.target.value)}
                    />
                    {row.error !== null && (
                      <p className={styles.fieldError} id={`${row.key}-error`}>
                        {row.error}
                      </p>
                    )}
                  </td>
                  <td>{formatUnit(row.unit)}</td>
                  <td className={styles.mono}>{row.rangeText}</td>
                  <td>
                    {row.sourcePage === null ? (
                      <span className={styles.muted}>无页码</span>
                    ) : (
                      <button
                        type="button"
                        className={styles.linkButton}
                        id={sourceId}
                        onClick={() => onFocusSource(row.sourcePage as number)}
                      >
                        第 {row.sourcePage} 页
                      </button>
                    )}
                  </td>
                  <td>
                    <span className={styles.prov} data-tone={row.provenance ?? 'unknown'}>
                      {formatProvenance(row.provenance)}
                    </span>
                  </td>
                  <td>
                    <span className={styles.status} data-tone={chip.tone}>
                      {chip.text}
                    </span>
                    {row.confirmed && <span className={styles.confirmedMark}>已确认</span>}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td className={styles.empty} colSpan={9}>
                  后端未返回候选字段，可直接进入工作台阅读原材料，或补齐材料后重新解析。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h3 className={styles.relationTitle}>候选关系</h3>
      <p className={styles.relationHint}>
        关系由对象的参数绑定（`bindings`）与模板配置推导，仅用于核对语义，不参与数值计算。
      </p>
      <ul className={styles.relations}>
        {relations.map((relation) => (
          <li key={relation.key} className={styles.relation} data-confirmed={relation.confirmed ? 'true' : undefined}>
            <label className={styles.relationLabel}>
              <input
                type="checkbox"
                checked={relation.confirmed}
                disabled={disabled}
                onChange={() => onToggleRelation(relation.key)}
              />
              <span className={styles.relationText}>{relation.label}</span>
            </label>
            <span className={styles.relationDetail}>{relation.detail}</span>
            {relation.confirmed && <span className={styles.confirmedMark}>已确认</span>}
          </li>
        ))}
        {relations.length === 0 && (
          <li className={styles.muted}>当前候选对象未声明参数间关系，无需确认。</li>
        )}
      </ul>
    </section>
  );
}

export default CandidateTable;