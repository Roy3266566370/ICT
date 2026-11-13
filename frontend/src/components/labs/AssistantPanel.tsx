import { useMemo, useState, type ReactNode } from 'react';
import { Formula } from '@/components/showcase/Formula';
import { currentMetrics } from '@/labs/compute';
import {
  MODE_LABELS,
  type BfsResult,
  type LabAssistantResponse,
  type LabAttemptRecord,
  type LabMode,
  type LabProblem,
  type LabResult,
} from '@/labs/types';
import type { LabSelection } from './LabCanvas';
import styles from './labs.module.css';
import { AttemptMathInput } from './AttemptMathInput';

interface Props {
  problem: LabProblem;
  result: LabResult;
  step: number;
  mode: LabMode;
  selected: LabSelection | null;
  aiConfigured: boolean;
  useAi: boolean;
  notes: string;
  attempts: LabAttemptRecord[];
  observations: { id: string; text: string }[];
  draftText: string;
  onModeChange: (mode: LabMode) => void;
  onUseAi: (value: boolean) => void;
  onAsk: (question: string, hintLevel?: number) => Promise<LabAssistantResponse>;
  onAttempt: (answer: string, field: string, kind?: string) => Promise<string | null>;
  onNotes: (notes: string) => void;
  onRecordObservation: (text?: string) => void;
  onSelect: (selection: LabSelection | null) => void;
  readOnly?: boolean;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  local?: boolean;
  notice?: string;
}

let messageSeed = 0;

function nextMessageId(): string {
  messageSeed += 1;
  return `msg_${messageSeed}`;
}

function attemptField(problem: LabProblem): { field: string; label: string; placeholder: string } {
  if (problem.model.engine === 'heap_v1') {
    return { field: 'heap', label: '删除后的堆数组或选项', placeholder: '例如 20,19,15,5,8,12 或 B' };
  }
  if (problem.model.task === 'area_volume' && (problem.model.requested_quantities?.length ?? 0) > 1) {
    return { field: 'quantities', label: '按顺序填写面积、体积', placeholder: '例如 ln(1+sqrt(2)), pi*(1-pi/4)' };
  }
  if (problem.model.task === 'implicit_normal') {
    return { field: 'normal', label: '该点的法线斜率', placeholder: '例如 -11/9；垂直法线可填不存在' };
  }
  if (problem.model.task === 'geometric_area') {
    return { field: 'area', label: '图形的几何面积', placeholder: '例如 37/12' };
  }
  if (problem.subject === 'algorithm') {
    return { field: 'order', label: '写出 BFS 出队顺序', placeholder: '例如 A → B → C' };
  }
  if (problem.subject === 'deep_learning') {
    return { field: 'loss', label: '当前训练轮结束后的 MSE', placeholder: '例如 0.024' };
  }
  if (problem.subject === 'operating_system') {
    const kind = problem.model.os_kind;
    if (kind === 'page_replace') return { field: 'numeric', label: '缺页次数', placeholder: '例如 15' };
    if (kind === 'disk_schedule') return { field: 'numeric', label: '磁头总移动距离', placeholder: '例如 640' };
    if (kind === 'banker') return { field: 'order', label: '安全序列（按完成顺序，任意合法序列均可）', placeholder: '例如 P1 → P3 → P4 → P0 → P2' };
    return { field: 'numeric', label: '平均等待时间', placeholder: '例如 4.75 或 19/4' };
  }
  if (problem.subject === 'linear_algebra') {
    const kind = problem.model.la_kind;
    if (kind === 'determinant') {
      return { field: 'scalar', label: '行列式 det(A) 的值', placeholder: '例如 -2 或 5/3' };
    }
    if (kind === 'inverse') {
      return { field: 'matrix', label: '逆矩阵（按行展开，逐行分号分隔）', placeholder: '例如 -2,1; 1.5,-0.5' };
    }
    if (kind === 'matmul') {
      return { field: 'matrix', label: '结果矩阵（按行展开，逐行分号分隔）', placeholder: '例如 19,22; 43,50' };
    }
    return { field: 'vector', label: '方程组的解向量（按变量顺序）', placeholder: '例如 2, 3, -1' };
  }
  if (problem.subject === 'optimization') {
    if (problem.solution.stationary_points?.length) {
      return { field: 'stationary_minimum', label: '一个极小值点坐标（数值核对）', placeholder: '例如 -e, 0；全部分类见完整讲解' };
    }
    return { field: 'point', label: '目标函数最优点的坐标', placeholder: '例如 3 或 1, 2' };
  }
  if (problem.model.kind === 'antiderivative') {
    return { field: 'antiderivative', label: '原函数（答案可带 +C）', placeholder: '例如 x^3/3+C' };
  }
  if (problem.model.kind === 'derivative') {
    return { field: 'slope', label: '该点的切线斜率', placeholder: '例如 1' };
  }
  return { field: 'integral', label: '定积分的值', placeholder: '例如 8/3 或 2.6667' };
}

function ContextCard({ result, step }: { result: LabResult; step: number }): ReactNode {
  const metrics = currentMetrics(result, step);
  return (
    <details className={styles.contextCard}>
      <summary>查看当前数值与检验</summary>
      <div className={styles.contextHead}>
        <span>当前这一步</span>
        <small>模型状态与讲解读取同一份记录</small>
      </div>
      <dl className={styles.contextGrid}>
        {metrics.map((item) => (
          <div key={item.id}>
            <dt>{item.label}</dt>
            <dd>{item.value}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function PredictionPrompt({ result, step, onRecord }: { result: BfsResult; step: number; onRecord: (text: string) => void }): ReactNode {
  const [guess, setGuess] = useState<string | null>(null);
  const nextDequeue = result.frames.slice(step + 1).find((frame) => frame.action === 'dequeue');
  if (!nextDequeue) {
    return <p className={styles.smallNote}>当前已经是最后一步，没有下一个出队节点。</p>;
  }
  const nodes = Array.from(
    new Set([...result.nodes.map((node) => node.id), ...nextDequeue.queue]),
  ).sort();
  const correct = guess === nextDequeue.current;
  return (
    <div className={styles.prediction}>
      <span className={styles.stateTitle}>先预测：下一个出队节点是谁？</span>
      <div className={styles.chipRow}>
        {nodes.map((node) => (
          <button
            key={node}
            type="button"
            className={styles.predictionChip}
            aria-pressed={guess === node}
            onClick={() => {
              setGuess(node);
              onRecord(`预测下一个出队节点为 ${node}；实际为 ${nextDequeue.current}。`);
            }}
          >
            {node}
          </button>
        ))}
      </div>
      {guess ? (
        <p className={correct ? styles.feedbackGood : styles.feedbackWarn}>
          {correct ? `正确：下一步出队 ${nextDequeue.current}。` : `再看一下队列：下一步会出队 ${nextDequeue.current}，你选的是 ${guess}。`}
        </p>
      ) : (
        <p className={styles.smallNote}>先写出判断，再点“下一步”核对，不直接看答案。</p>
      )}
    </div>
  );
}

export function AssistantPanel({
  problem,
  result,
  step,
  mode,
  selected,
  aiConfigured,
  useAi,
  notes,
  attempts,
  observations,
  draftText,
  onModeChange,
  onUseAi,
  onAsk,
  onAttempt,
  onNotes,
  onRecordObservation,
  onSelect,
  readOnly = false,
}: Props): ReactNode {
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState('');
  const [attemptBusy, setAttemptBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ correct: boolean; text: string } | null>(null);
  const field = useMemo(() => attemptField(problem), [problem]);
  const solutions = problem.solution.steps ?? [];

  const send = async (text: string, hintLevel?: number): Promise<void> => {
    const trimmed = text.trim();
    if (!trimmed && !hintLevel) return;
    const label = hintLevel ? `请给我第 ${hintLevel} 级提示` : trimmed;
    setMessages((current) => [...current, { id: nextMessageId(), role: 'user', text: label }]);
    setQuestion('');
    setBusy(true);
    try {
      const response = await onAsk(trimmed, hintLevel);
      setMessages((current) => [
        ...current,
        {
          id: nextMessageId(),
          role: 'assistant',
          text: response.answer,
          local: response.local,
          notice: response.notice,
        },
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: nextMessageId(),
          role: 'assistant',
          text: `暂时无法获得讲解：${error instanceof Error ? error.message : '请求失败'}。图形与计算结果仍可继续使用。`,
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const checkValue = async (value: string, kind: 'numeric' | 'draft'): Promise<void> => {
    if (!value.trim() || attemptBusy) return;
    setAttemptBusy(true);
    try {
      const message = await onAttempt(value.trim(), field.field, kind);
      if (message !== null) {
        setFeedback({ correct: message.startsWith('判断：正确'), text: message });
        if (kind === 'numeric') setAttempt('');
      }
    } finally {
      setAttemptBusy(false);
    }
  };

  const submitAttempt = (): Promise<void> => checkValue(attempt, 'numeric');

  return (
    <aside className={styles.assistantPanel} aria-label="学习助手">
      <div className={styles.assistantHead}>
        <div>
          <span className={styles.eyebrow}>STUDY COMPANION</span>
          <h2>学习助手</h2>
        </div>
        <span className={styles.localBadge}>{aiConfigured ? '本地导师 · 可选增强' : '本地导师'}</span>
      </div>

      <div className={styles.modeTabs} role="tablist" aria-label="学习方式">
        {(Object.keys(MODE_LABELS) as LabMode[]).map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={mode === item}
            onClick={() => onModeChange(item)}
          >
            <strong>{MODE_LABELS[item].title}</strong>
            <span>{MODE_LABELS[item].hint}</span>
          </button>
        ))}
      </div>

      <p className={styles.modeHintLine}>{MODE_LABELS[mode].hint}</p>

      <ContextCard result={result} step={step} />

      {selected ? (
        <div className={styles.selectedChip}>
          <span>正在追问：{selected.label}</span>
          <button type="button" onClick={() => onSelect(null)} aria-label="取消选择">
            ×
          </button>
        </div>
      ) : null}

      {mode === 'solution' ? (
        <div className={styles.solutionList}>
          <p className={styles.solutionSummary}>{problem.solution.summary}</p>
          {problem.solution.answer ? (
            <div className={styles.answerBox}>
              <span>原题结论</span>
              <strong>{problem.solution.answer}</strong>
            </div>
          ) : null}
          {solutions.map((item, index) => (
            <button
              key={item.id}
              type="button"
              className={styles.solutionStep}
              aria-pressed={selected?.id === item.id}
              onClick={() => onSelect({ id: item.id, label: item.title, kind: 'solution-step' })}
            >
              <i>{String(index + 1).padStart(2, '0')}</i>
              <span>
                <strong>{item.title}</strong>
                {item.latex ? <Formula tex={item.latex} block /> : null}
                <small>{item.detail}</small>
              </span>
            </button>
          ))}
          {problem.solution.global_note ? <p className={styles.smallNote}>{problem.solution.global_note}</p> : null}
          <div className={styles.askRow}>
            <input
              value={question}
              placeholder="对某一步追问，例如“为什么这里取负号？”"
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) void send(question);
              }}
            />
            <button type="button" onClick={() => void send(question)} disabled={busy || !question.trim()}>
              追问
            </button>
          </div>
          {messages.slice(-4).map((message) => (
            <div key={message.id} className={styles.message} data-role={message.role}>
              <span>{message.role === 'user' ? '你' : '导师'}</span>
              <p>{message.text}</p>
              {message.notice ? <small>{message.notice}</small> : null}
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className={styles.chatBox}>
            {messages.length === 0 ? (
              <div className={styles.greeting}>
                <p>
                  {mode === 'guided'
                    ? '我会根据你当前停下的这一步给提示，不直接替你完成。'
                    : '自己操作模型；需要时再问我图形、公式或当前数值的含义。'}
                </p>
                <div className={styles.suggestions}>
                  {(result.subject === 'optimization'
                    ? ['为什么往这个方向移动？', '下一步是什么？', '当前结果说明了什么？']
                    : problem.model.task === 'implicit_normal'
                      ? ['法线斜率如何求得？', '原题结果是什么？', '研究点为何需要核对？']
                    : result.subject === 'calculus'
                      ? problem.model.kind === 'derivative'
                        ? ['切线为什么在这个位置？', '差商怎样趋近导数？', '下一步是什么？']
                        : problem.model.kind === 'antiderivative'
                          ? ['为什么答案要加 C？', '原函数求导怎么核对？', '下一步是什么？']
                          : ['为什么误差随 n 变化？', '黎曼和与解析值差在哪？', '下一步是什么？']
                      : result.subject === 'algorithm' && result.algorithm === 'heap'
                        ? ['为什么需要向下筛选？', '下一步是什么？', '当前结果说明了什么？']
                      : result.subject === 'algorithm'
                        ? ['下一个出队的是谁？', '为什么跳过这个节点？', '当前结果说明了什么？']
                      : result.subject === 'operating_system'
                        ? result.osKind === 'page_replace'
                          ? ['为什么这次缺页？', '被置换的是哪个页面？', '为什么 FIFO 会有 Belady 异常？']
                          : result.osKind === 'disk_schedule'
                            ? ['磁头下一步去哪？', '为什么 SCAN 要走到末端？', '当前结果说明了什么？']
                            : result.osKind === 'banker'
                              ? ['为什么这个进程可以先完成？', '下一步是什么？', '什么情况下是不安全状态？']
                              : ['为什么选这个进程？', '下一步是什么？', '当前结果说明了什么？']
                      : result.subject === 'linear_algebra'
                        ? result.laKind === 'matmul'
                          ? ['为什么 A·B 和 B·A 不一样？', '下一步是什么？', '当前结果说明了什么？']
                          : ['为什么要交换这两行？', '下一步是什么？', '当前结果说明了什么？']
                        : ['损失为什么下降？', '梯度是怎么算的？', '下一步是什么？']
                  ).map((suggestion) => (
                    <button key={suggestion} type="button" onClick={() => void send(suggestion)} disabled={busy}>
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {messages.slice(-8).map((message) => (
              <div key={message.id} className={styles.message} data-role={message.role}>
                <span>{message.role === 'user' ? '你' : '导师'}</span>
                <p>{message.text}</p>
                <small>{message.local ? '本地导师 · 由计算记录生成' : message.notice ? '模型增强回答 · 数值以执行记录为准' : ''}</small>
              </div>
            ))}
            {busy ? <p className={styles.thinking}>正在读取当前参数与执行记录…</p> : null}
          </div>

          <div className={styles.askRow}>
            <input
              value={question}
              placeholder={selected ? `追问“${selected.label}”的含义` : '问当前这一步，或输入操作指令'}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) void send(question);
              }}
              disabled={readOnly}
            />
            <button type="button" onClick={() => void send(question)} disabled={busy || !question.trim() || readOnly}>
              发送
            </button>
          </div>

          {mode === 'guided' ? (
            <div className={styles.hints}>
              <span className={styles.stateTitle}>分层提示</span>
              <div className={styles.hintButtons}>
                {[1, 2, 3].map((level) => (
                  <button key={level} type="button" onClick={() => void send('', level)} disabled={busy}>
                    {level === 1 ? '观察方向' : level === 2 ? '相关知识' : '具体步骤'}
                  </button>
                ))}
              </div>
              <p>从观察开始；只有在需要时才展开具体步骤。</p>
            </div>
          ) : null}

          {result.subject === 'algorithm' && result.algorithm !== 'heap' ? (
            <PredictionPrompt result={result} step={step} onRecord={onRecordObservation} />
          ) : null}

          <div className={styles.attemptBox}>
            <span className={styles.stateTitle}>提交我的尝试</span>
            {draftText.trim() ? (
              <div className={styles.draftBox}>
                <div className={styles.draftHead}>
                  <strong>已上传的解答草稿</strong>
                  <small>{draftText.trim().length} 字 · 由文件识别得到</small>
                </div>
                <p>{draftText.trim().slice(0, 240)}{draftText.trim().length > 240 ? '…' : ''}</p>
                <div className={styles.draftActions}>
                  <button type="button" onClick={() => setAttempt(draftText.trim().slice(0, 2000))} disabled={attemptBusy}>
                    填入检查框
                  </button>
                  <button type="button" onClick={() => void checkValue(draftText, 'draft')} disabled={attemptBusy}>
                    检查草稿中的答案
                  </button>
                </div>
              </div>
            ) : null}
            <div className={styles.attemptRow}>
              {problem.subject !== 'algorithm' && problem.subject !== 'linear_algebra' && problem.subject !== 'operating_system' ? <AttemptMathInput
                key={`${problem.problem_id}-${field.field}`}
                label={field.label}
                placeholder={field.placeholder}
                value={attempt}
                variables={field.field === 'antiderivative' ? [problem.model.variable ?? 'x', 'C']
                  : problem.model.variables ?? [problem.model.variable ?? 'x']}
                disabled={attemptBusy || readOnly}
                onChange={setAttempt}
                onSubmit={() => void submitAttempt()}
              /> : <input
                value={attempt}
                placeholder={field.placeholder}
                aria-label={field.label}
                onChange={(event) => setAttempt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.nativeEvent.isComposing) void submitAttempt();
                }}
              />}
              <button type="button" onClick={() => void submitAttempt()} disabled={attemptBusy || !attempt.trim() || readOnly}>
                检查
              </button>
            </div>
            {feedback ? (
              <p className={feedback.correct ? styles.feedbackGood : styles.feedbackWarn}>{feedback.text}</p>
            ) : (
              <p className={styles.smallNote}>{field.label}。检查只对照确定性结果，不读取模型生成答案。</p>
            )}
            {attempts.length ? (
              <details className={styles.attemptHistory}>
                <summary>我的尝试记录（{attempts.length}）</summary>
                {attempts.slice(-4).reverse().map((item) => (
                  <div key={item.id} data-correct={item.correct}>
                    <strong>{item.correct ? '正确' : '待核对'}</strong>
                    <span>{item.answer}</span>
                  </div>
                ))}
              </details>
            ) : null}
          </div>
        </>
      )}

      {aiConfigured ? (
        <label className={styles.aiToggle}>
          <input type="checkbox" checked={useAi} onChange={(event) => onUseAi(event.target.checked)} />
          <span>本次提问使用模型增强</span>
          <small>需在后端显式启用，可能产生 API 费用；默认关闭，数值仍以执行记录为准。</small>
        </label>
      ) : null}

      <div className={styles.notesBox}>
        <div className={styles.notesHead}>
          <span>学习记录</span>
          <button type="button" onClick={() => onRecordObservation()} disabled={readOnly}>
            记录当前观察
          </button>
        </div>
        <textarea
          value={notes}
          placeholder="写下你的预测、观察或疑问；会随学习成果一起保存。"
          rows={3}
          onChange={(event) => onNotes(event.target.value)}
          disabled={readOnly}
        />
        <div className={styles.notesMeta}>
          <span>{notes.trim().length} 字</span>
          <span>{observations.length} 条自动观察</span>
        </div>
        {observations.length ? (
          <details className={styles.observationList}>
            <summary>已记录观察（{observations.length}）</summary>
            {observations.slice(-5).reverse().map((item) => (
              <p key={item.id}>{item.text}</p>
            ))}
          </details>
        ) : null}
      </div>
    </aside>
  );
}

export default AssistantPanel;
