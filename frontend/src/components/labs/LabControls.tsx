import { useEffect, useId, useState, type ReactNode } from 'react';
import type { LabModel } from '@/labs/types';
import { formatNumber } from '@/labs/expr';
import styles from './labs.module.css';
import { MathText } from './ProblemText';

interface Props {
  model: LabModel;
  params: Record<string, unknown>;
  onChange: (key: string, value: number | string) => void;
  onResetOriginal: () => void;
  onSaveScenario: () => void;
  onOpenReview: () => void;
  onApplyGraph?: (source: string) => Promise<void> | void;
  readOnly?: boolean;
}

function readNumeric(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const LINALG_OPTION_LABELS: Record<string, string> = {
  gauss: '高斯消元（回代）',
  jordan: '高斯-若尔当（行最简形）',
  partial: '部分主元',
  none: '不选主元',
  ab: 'A·B',
  ba: 'B·A',
};

const OS_OPTION_LABELS: Record<string, string> = {
  fcfs: '先来先服务 FCFS',
  sjf: '短作业优先 SJF（非抢占）',
  srtf: '最短剩余时间优先 SRTF（抢占）',
  rr: '时间片轮转 RR',
  priority: '优先级（非抢占，数小优先）',
  hrrn: '高响应比优先 HRRN（非抢占）',
  fifo: '先进先出 FIFO',
  lru: '最近最久未使用 LRU',
  opt: '最佳置换 OPT',
  clock: '时钟置换 Clock（二次机会）',
  sstf: '最短寻道时间优先 SSTF',
  scan: 'SCAN（电梯）',
  cscan: 'C-SCAN（循环扫描）',
  look: 'LOOK',
  clook: 'C-LOOK',
  up: '磁道号增大方向',
  down: '磁道号减小方向',
  count: '回扫距离计入总移动',
  skip: '回扫距离不计入',
  apply: '先判断请求能否满足，再试分配',
  ignore: '只检查当前状态',
};

function Control({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
  disabled,
  note,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (value: number) => void;
  disabled?: boolean;
  note?: string;
}): ReactNode {
  const id = useId();
  const decimals = step < 0.01 ? 4 : step < 1 ? 2 : 0;
  return (
    <label className={styles.control} htmlFor={id}>
      <span className={styles.controlHead}>
        <span><MathText text={label} /></span>
        <output htmlFor={id}>
          {formatNumber(value, decimals)}
          {unit ? <small>{unit}</small> : null}
        </output>
      </span>
      <span className={styles.controlRow}>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={Math.max(min, Math.min(max, value))}
          disabled={disabled}
          aria-label={`${label} 滑块`}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <input
          id={id}
          className={styles.numberInput}
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          aria-label={`${label} 数值`}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isFinite(next)) onChange(Math.max(min, Math.min(max, next)));
          }}
        />
      </span>
      {note ? <span className={styles.controlNote}><MathText text={note} /></span> : null}
    </label>
  );
}

export function LabControls({
  model,
  params,
  onChange,
  onResetOriginal,
  onSaveScenario,
  onOpenReview,
  onApplyGraph,
  readOnly = false,
}: Props): ReactNode {
  const [graphOpen, setGraphOpen] = useState(false);
  const [graphDraft, setGraphDraft] = useState(
    (model.edges ?? []).map((edge) => `${edge.from}-${edge.to}`).join('\n'),
  );
  const [graphBusy, setGraphBusy] = useState(false);

  useEffect(() => {
    setGraphDraft((model.edges ?? []).map((edge) => `${edge.from}-${edge.to}`).join('\n'));
  }, [model.edges]);

  const visible = model.params.filter((parameter) => {
    if (parameter.id === 'start') return false;
    return true;
  });

  return (
    <section className={styles.controlsPanel} aria-label="关键控制">
      <div className={styles.controlsHead}>
        <div>
          <span className={styles.eyebrow}>LIVE MODEL</span>
          <h3>关键控制</h3>
        </div>
        <div className={styles.controlsActions}>
          <button type="button" className={styles.textButton} onClick={onOpenReview} disabled={readOnly}>
            核对识别条件
          </button>
          <button type="button" className={styles.textButton} onClick={onResetOriginal} disabled={readOnly}>
            恢复原题
          </button>
          <button type="button" className={styles.secondaryButton} onClick={onSaveScenario} disabled={readOnly}>
            保存为情景
          </button>
        </div>
      </div>

      <div className={styles.controlGrid}>
        {visible.map((parameter) => {
          if (parameter.kind === 'enum') {
            const value = String(params[parameter.id] ?? model.defaults[parameter.id] ?? '');
            const optionLabel = (option: string) =>
              (model.subject === 'linear_algebra' ? LINALG_OPTION_LABELS[option] ?? option
                : model.subject === 'operating_system' ? OS_OPTION_LABELS[option] ?? option
                  : model.subject === 'calculus' && parameter.id === 'side'
                    ? ({ both: '双侧', left: '左极限', right: '右极限' } as Record<string, string>)[option] ?? option
                    : option);
            return (
              <label key={parameter.id} className={styles.control}>
                <span className={styles.controlHead}>
                  <span>{parameter.label}</span>
                  <output>{optionLabel(value)}</output>
                </span>
                <select
                  className={styles.select}
                  value={value}
                  disabled={readOnly}
                  onChange={(event) => onChange(parameter.id, event.target.value)}
                >
                  {(parameter.options ?? []).map((option) => (
                    <option key={option} value={option}>
                      {optionLabel(option)}
                    </option>
                  ))}
                </select>
              </label>
            );
          }
          const fallback = readNumeric(model.defaults[parameter.id], 0);
          const value = readNumeric(params[parameter.id], fallback);
          const positionLike = parameter.id === 'lower' || parameter.id === 'upper' || parameter.id === 'point' || /0$/.test(parameter.id);
          const min = parameter.min ?? (positionLike ? -50 : 0);
          const max = parameter.max ?? (positionLike ? 50 : Math.max(1, Math.abs(fallback) * 4 || 10));
          const step = parameter.step ?? (parameter.kind === 'integer' ? 1 : 0.01);
          return (
            <Control
              key={parameter.id}
              label={parameter.label}
              value={value}
              min={min}
              max={max}
              step={step}
              onChange={(next) => onChange(parameter.id, next)}
              disabled={readOnly}
              note={parameter.note}
            />
          );
        })}
        {model.subject === 'algorithm' && model.params.some((parameter) => parameter.id === 'start') ? (
          <label className={styles.control}>
            <span className={styles.controlHead}>
              <span>BFS 起点</span>
              <output>{String(params.start ?? model.start ?? '')}</output>
            </span>
            <select
              className={styles.select}
              value={String(params.start ?? model.start ?? '')}
              disabled={readOnly}
              onChange={(event) => onChange('start', event.target.value)}
            >
              {(model.nodes ?? []).map((node) => (
                <option key={node.id} value={node.id}>
                  从 {node.label} 开始
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {model.subject === 'algorithm' && model.engine !== 'heap_v1' && !String(model.engine ?? '').startsWith('ds_') && onApplyGraph && !readOnly ? (
        <div className={styles.graphEditor}>
          <button
            type="button"
            className={styles.graphToggle}
            aria-expanded={graphOpen}
            onClick={() => setGraphOpen((open) => !open)}
          >
            {graphOpen ? '收起图数据' : '修改图数据'}
            <span>这会把当前图保存为新的核对条件</span>
          </button>
          {graphOpen ? (
            <div className={styles.graphBody}>
              <label htmlFor="lab-graph-editor">每行一条边，例如 A-B；有向图使用 A→B</label>
              <textarea
                id="lab-graph-editor"
                value={graphDraft}
                onChange={(event) => setGraphDraft(event.target.value)}
                rows={5}
                spellCheck={false}
              />
              <div className={styles.graphActions}>
                <button
                  type="button"
                  className={styles.primarySmall}
                  disabled={graphBusy}
                  onClick={async () => {
                    setGraphBusy(true);
                    try {
                      await onApplyGraph(graphDraft);
                    } finally {
                      setGraphBusy(false);
                    }
                  }}
                >
                  {graphBusy ? '正在重建…' : '应用图数据'}
                </button>
                <span>修改后原题图仍保留在来源中，可随时恢复。</span>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export default LabControls;
