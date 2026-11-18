import { useMemo, useState, type ReactNode } from 'react';
import { LabFormula as Formula } from './ProblemText';
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
import { MathText } from './ProblemText';

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
  if (problem.model.engine === 'generic_v1') {
    return { field: 'ai_solution', label: '原题条件下的完整答案', placeholder: '请按原题条件填写全部结果；可先点击恢复原题' };
  }
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
    if (kind === 'page_replace') {
      if (!(problem.model.reference?.length)) {
        return { field: 'text', label: '缺页处理/工作集结论', placeholder: '例如 缺页需调页、工作集过大导致抖动' };
      }
      return { field: 'numeric', label: '缺页次数', placeholder: '例如 15' };
    }
    if (kind === 'disk_schedule') return { field: 'numeric', label: '磁头总移动距离', placeholder: '例如 640' };
    if (kind === 'banker') return { field: 'order', label: '安全序列（按完成顺序，任意合法序列均可）', placeholder: '例如 P1 → P3 → P4 → P0 → P2' };
    if (kind === 'sync') return { field: 'text', label: '信号量值或同步结论', placeholder: '例如 S=0，等待 1 个' };
    if (kind === 'deadlock') return { field: 'text', label: '死锁判断或必要条件', placeholder: '例如 存在环、可能死锁' };
    if (kind === 'memory_alloc') return { field: 'text', label: '分配结果或内存利用率', placeholder: '例如 选择 500，剩余 380' };
    if (kind === 'tlb') {
      return problem.solution.answer_value === null || problem.solution.answer_value === undefined
        ? { field: 'text', label: 'TLB 命中/页表访问结论', placeholder: '例如 命中直接得到页框号，缺失访问 1 次页表' }
        : { field: 'numeric', label: '有效访问时间（ns）', placeholder: '例如 120' };
    }
    if (kind === 'file_dir') return { field: 'text', label: '权限、路径或 inode 结论', placeholder: '例如 文件主 rwx；目录读取 4 次' };
    if (kind === 'file_alloc') {
      return problem.solution.answer_value === null || problem.solution.answer_value === undefined
        ? { field: 'text', label: '块链、空闲块或最大文件结论', placeholder: '例如 5→9→2；首个空闲块 2' }
        : { field: 'numeric', label: '块数或访盘次数', placeholder: '例如 13 或 3' };
    }
    if (kind === 'device_mgmt') {
      return problem.solution.answer_value === null || problem.solution.answer_value === undefined
        ? { field: 'text', label: '设备管理结论', placeholder: '例如 假脱机把独占设备虚拟成共享设备' }
        : { field: 'numeric', label: '磁盘访问时间（ms）', placeholder: '例如 10.4' };
    }
    if (kind === 'process_thread' || kind === 'os_basics') return { field: 'text', label: '状态/结论', placeholder: '例如 合法、内核态、PCB 保存…' };
    return { field: 'numeric', label: '平均等待时间', placeholder: '例如 4.75 或 19/4' };
  }
  if (problem.subject === 'computer_organization') {
    const kind = problem.model.co_kind;
    if (kind === 'performance') return { field: 'numeric', label: 'CPU 执行时间或加速比', placeholder: '例如 0.002 或 4' };
    if (kind === 'data_repr') return { field: 'text', label: '编码位串或数值', placeholder: '例如 11011010、101101 或 -37' };
    if (kind === 'fixed_point') return { field: 'numeric', label: '运算结果（数值）', placeholder: '例如 2 或 -128' };
    if (kind === 'floating') return { field: 'text', label: 'IEEE 754 编码或十进制真值', placeholder: '例如 0xC1460000 或 -12.375' };
    if (kind === 'memory') return { field: 'text', label: '芯片数、容量或地址范围', placeholder: '例如 8、64KB 或 0000H–FFFFH' };
    if (kind === 'cache' || kind === 'virtual_memory') return { field: 'text', label: '地址字段、AMAT 或物理地址', placeholder: '例如 tag=18、2.5ns 或 5010H' };
    if (kind === 'instruction') return { field: 'text', label: '指令编码、有效地址或 C 表达式', placeholder: '例如 0010...、8208 或 R1=R2+R3' };
    if (kind === 'pipeline') return { field: 'numeric', label: '总周期数或加速比', placeholder: '例如 104 或 4.81' };
    if (kind === 'bus_io') return { field: 'numeric', label: '带宽或 CPU 时间开销', placeholder: '例如 400 或 100' };
    return { field: 'text', label: '控制器周期或寄存器结果', placeholder: '例如 5、1000ns 或 R3=8' };
  }
  if (problem.subject === 'physics') {
    return { field: 'numeric', label: '主要结果（可填任一关键结果）', placeholder: '例如速度、时间、力、能量或周期' };
  }
  if (problem.subject === 'computer_network') {
    const kind = problem.model.net_kind;
    const hasValue = problem.solution.answer_value !== null && problem.solution.answer_value !== undefined;
    if (kind === 'architecture') return { field: 'text', label: '分层、封装或设备层次结论', placeholder: '例如 路由器工作在网络层' };
    if (kind === 'performance') return hasValue
      ? { field: 'numeric', label: '时延、时延带宽积或吞吐量数值', placeholder: '例如 5.08 或 200000' }
      : { field: 'text', label: '性能与交换结论', placeholder: '例如 分组交换通常比报文交换时延小' };
    if (kind === 'physical') return hasValue
      ? { field: 'numeric', label: '数据率或比特率', placeholder: '例如 32000' }
      : { field: 'text', label: '编码、复用或公式结论', placeholder: '例如 波特率 = 2×比特率' };
    if (kind === 'error_control') return { field: 'text', label: '校验位、码字或综合因子', placeholder: '例如 1010、10110011010 或 S=5' };
    if (kind === 'sliding_window') return hasValue
      ? { field: 'numeric', label: '窗口、利用率或重传帧数', placeholder: '例如 4、29.63 或 1' }
      : { field: 'text', label: '窗口变化与重传结论', placeholder: '例如 GBN 回退重传，SR 只重传丢失帧' };
    if (kind === 'mac') return hasValue
      ? { field: 'numeric', label: '帧长、吞吐率或退避时隙', placeholder: '例如 512 或 18.39' }
      : { field: 'text', label: '介质访问控制结论', placeholder: '例如 CSMA/CD 边发边听并检测冲突' };
    if (kind === 'ethernet') return { field: 'text', label: '转发表、泛洪或冲突域结论', placeholder: '例如 目的未知，向端口 2、3 泛洪' };
    if (kind === 'ip') return { field: 'text', label: '网络地址、分片或 IPv6 地址', placeholder: '例如 192.168.1.0/26、偏移 185 或 2001:db8::1' };
    if (kind === 'network_layer') return { field: 'text', label: '路由更新或协议结论', placeholder: '例如 N2 距离 2，下一跳 R2' };
    if (kind === 'transport') return hasValue
      ? { field: 'numeric', label: '序号、确认号或端口结果', placeholder: '例如 1500 或 80' }
      : { field: 'text', label: '端口、首部或握手结论', placeholder: '例如 SYN、SYN+ACK、ACK' };
    if (kind === 'tcp_control') return hasValue
      ? { field: 'numeric', label: 'cwnd、ssthresh 或发送窗口', placeholder: '例如 4 或 8' }
      : { field: 'text', label: '拥塞控制结论', placeholder: '例如 超时后 cwnd=1，ssthresh=cwnd/2' };
    if (kind === 'application') return hasValue
      ? { field: 'numeric', label: '网页获取时间或查询次数', placeholder: '例如 80' }
      : { field: 'text', label: '应用层流程结论', placeholder: '例如 DNS → TCP → HTTP' };
    return { field: 'text', label: '计算机网络结论', placeholder: '例如 先封装后解封装' };
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
  if (problem.model.modeling_task === 'parameter_limit') {
    const parameter = problem.model.parameter ?? 'a';
    return { field: 'parameter', label: `参数 ${parameter} 的值`, placeholder: '例如 6' };
  }
  if (problem.model.kind === 'limit') {
    return { field: 'limit', label: '该点的极限值（不存在写“不存在”）', placeholder: '例如 1 或 不存在' };
  }
  if (problem.model.kind === 'antiderivative') {
    return { field: 'antiderivative', label: '原函数（答案可带 +C）', placeholder: '例如 x^3/3+C' };
  }
  if (problem.model.kind === 'derivative') {
    return { field: 'slope', label: '该点的切线斜率', placeholder: '例如 1' };
  }
  if (problem.model.kind === 'ode') {
    return { field: 'ode_solution', label: '微分方程的解（可写 y=... 或隐式方程）', placeholder: '例如 y=x^2 或 y-atan(x+y)=-pi/4' };
  }
  if (problem.model.kind === 'multivariable_extrema') {
    return { field: 'extrema_value', label: '极值点或极值（数值核对）', placeholder: '例如 -e, 0 或 -e^2/2' };
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
            <dt><MathText text={item.label} /></dt>
            <dd><MathText text={String(item.value)} /></dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function PredictionPrompt({ result, step, onRecord }: { result: BfsResult; step: number; onRecord: (text: string) => void }): ReactNode {
  const [guess, setGuess] = useState<string | null>(null);
  const isDfs = result.algorithm === 'dfs';
  const orderWord = isDfs ? '访问' : '出队';
  const nextFrame = result.frames.slice(step + 1).find((frame) => frame.action === (isDfs ? 'visit' : 'dequeue'));
  if (!nextFrame) {
    return <p className={styles.smallNote}>当前已经是最后一步，没有下一个{orderWord}节点。</p>;
  }
  const nodes = Array.from(
    new Set([...result.nodes.map((node) => node.id), ...(isDfs ? (nextFrame.stack ?? []) : nextFrame.queue)]),
  ).sort();
  const correct = guess === nextFrame.current;
  return (
    <div className={styles.prediction}>
      <span className={styles.stateTitle}>先预测：下一个{orderWord}节点是谁？</span>
      <div className={styles.chipRow}>
        {nodes.map((node) => (
          <button
            key={node}
            type="button"
            className={styles.predictionChip}
            aria-pressed={guess === node}
            onClick={() => {
              setGuess(node);
              onRecord(`预测下一个${orderWord}节点为 ${node}；实际为 ${nextFrame.current}。`);
            }}
          >
            {node}
          </button>
        ))}
      </div>
      {guess ? (
        <p className={correct ? styles.feedbackGood : styles.feedbackWarn}>
          {correct ? `正确：下一步${orderWord} ${nextFrame.current}。` : `再看一下${isDfs ? '栈' : '队列'}：下一步会${orderWord} ${nextFrame.current}，你选的是 ${guess}。`}
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
          <span>正在追问：<MathText text={selected.label} /></span>
          <button type="button" onClick={() => onSelect(null)} aria-label="取消选择">
            ×
          </button>
        </div>
      ) : null}

      {mode === 'solution' ? (
        <div className={styles.solutionList}>
          <p className={styles.solutionSummary}><MathText text={problem.solution.summary} /></p>
          {problem.solution.answer ? (
            <div className={styles.answerBox}>
              <span>原题结论</span>
              <strong><MathText text={problem.solution.answer} /></strong>
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
                <strong><MathText text={item.title} /></strong>
                {item.latex ? <Formula tex={item.latex} block /> : null}
                <small><MathText text={item.detail} /></small>
              </span>
            </button>
          ))}
          {problem.solution.global_note ? <p className={styles.smallNote}><MathText text={problem.solution.global_note} /></p> : null}
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
              <p><MathText text={message.text} /></p>
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
                  {(problem.model.engine === 'generic_v1'
                    ? ['原题结果是什么？', '每一步用到了哪些条件？', '结果如何核验？']
                    : result.subject === 'optimization'
                    ? ['为什么往这个方向移动？', '下一步是什么？', '当前结果说明了什么？']
                    : problem.model.task === 'implicit_normal'
                      ? ['法线斜率如何求得？', '原题结果是什么？', '研究点为何需要核对？']
                    : result.subject === 'calculus'
                      ? problem.model.kind === 'derivative'
                        ? ['切线为什么在这个位置？', '差商怎样趋近导数？', '下一步是什么？']
                        : problem.model.modeling_task === 'parameter_limit'
                          ? [`参数 ${problem.model.parameter ?? 'a'}=${problem.model.parameter_value ?? ''} 是怎么解出的？`, '左右极限为什么都要看？', '下一步是什么？']
                        : problem.model.kind === 'limit'
                          ? ['左右极限为什么都要看？', '数值逼近和符号极限差在哪？', '下一步是什么？']
                        : problem.model.kind === 'antiderivative'
                          ? ['为什么答案要加 C？', '原函数求导怎么核对？', '下一步是什么？']
                          : problem.model.kind === 'ode'
                            ? ['解曲线为什么这样变化？', '如何代回原方程核验？', '下一步是什么？']
                            : problem.model.kind === 'multivariable_extrema'
                              ? ['为什么这个点是极小值？', '鞍点与极小值怎么区分？', '下一步是什么？']
                          : ['为什么误差随 n 变化？', '黎曼和与解析值差在哪？', '下一步是什么？']
                      : result.subject === 'algorithm' && result.algorithm === 'heap'
                        ? ['为什么需要向下筛选？', '下一步是什么？', '当前结果说明了什么？']
                      : result.subject === 'algorithm'
                        ? ['下一个出队的是谁？', '为什么跳过这个节点？', '当前结果说明了什么？']
                      : result.subject === 'operating_system'
                        ? result.osKind === 'page_replace'
                          ? ('concept' in result.stats
                            ? ['缺页处理要经过哪些步骤？', '工作集为什么会导致抖动？', 'Clock 如何给第二次机会？']
                            : ['为什么这次缺页？', '被置换的是哪个页面？', '为什么 FIFO 会有 Belady 异常？'])
                          : result.osKind === 'disk_schedule'
                            ? ['磁头下一步去哪？', '为什么 SCAN 要走到末端？', '当前结果说明了什么？']
                            : result.osKind === 'banker'
                              ? ['为什么这个进程可以先完成？', '下一步是什么？', '什么情况下是不安全状态？']
                              : result.osKind === 'tlb'
                                ? ['为什么 TLB 命中不用查页表？', '页表访问次数怎么数？', '有效访问时间怎么算？']
                                : result.osKind === 'file_dir'
                                  ? ['权限位怎么读？', '为什么要逐级查目录？', 'inode 和 FCB 有什么区别？']
                                  : result.osKind === 'file_alloc'
                                    ? ['最大文件长度怎么算？', '为什么索引分配支持随机访问？', '位示图 0 和 1 各表示什么？']
                                    : result.osKind === 'device_mgmt'
                                      ? ['旋转延迟为什么取半圈？', '单缓冲和双缓冲差在哪？', '假脱机怎么共享打印机？']
                                      : ['为什么选这个进程？', '下一步是什么？', '当前结果说明了什么？']
                      : result.subject === 'linear_algebra'
                        ? result.laKind === 'matmul'
                          ? ['为什么 A·B 和 B·A 不一样？', '下一步是什么？', '当前结果说明了什么？']
                          : ['为什么要交换这两行？', '下一步是什么？', '当前结果说明了什么？']
                        : result.subject === 'physics'
                          ? ['参数变化如何影响结果？', '这一步用了什么公式？', '当前结果说明了什么？']
                        : result.subject === 'computer_organization'
                          ? ['这一步用了什么公式？', '位宽/码制是怎样约定的？', '下一步是什么？']
                        : result.subject === 'computer_network'
                          ? result.netKind === 'ethernet'
                            ? ['交换机为什么要泛洪？', '转发表什么时候更新？', '冲突域和广播域怎么分？']
                            : result.netKind === 'ip'
                              ? ['网络地址怎么算？', '为什么按 8 字节对齐？', 'IPv6 的 :: 怎么压缩？']
                              : result.netKind === 'transport'
                                ? ['SYN 为什么消耗序号？', 'TIME_WAIT 为什么要等待？', '端口怎么分类？']
                                : result.netKind === 'tcp_control'
                                  ? ['这一轮是慢启动还是拥塞避免？', '超时后 cwnd 怎么变？', '发送窗口取哪个值？']
                                  : result.netKind === 'application'
                                    ? ['为什么要几次 RTT？', '持久连接省在哪？', 'DNS 和 HTTP 谁先？']
                                    : ['这一步用了什么公式？', '单位是怎么换算的？', '窗口/校验位为什么这样变？']
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
                <p><MathText text={message.text} /></p>
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

          {result.subject === 'algorithm' && result.algorithm !== 'heap' && !('dsKind' in result) ? (
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
              {problem.subject !== 'algorithm' && problem.subject !== 'linear_algebra' && problem.subject !== 'operating_system' && problem.subject !== 'computer_organization' && problem.subject !== 'computer_network' ? <AttemptMathInput
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
              <p className={feedback.correct ? styles.feedbackGood : styles.feedbackWarn}><MathText text={feedback.text} /></p>
            ) : (
              <p className={styles.smallNote}>{field.label}。检查只对照确定性结果，不读取模型生成答案。</p>
            )}
            {attempts.length ? (
              <details className={styles.attemptHistory}>
                <summary>我的尝试记录（{attempts.length}）</summary>
                {attempts.slice(-4).reverse().map((item) => (
                  <div key={item.id} data-correct={item.correct}>
                    <strong>{item.correct ? '正确' : '待核对'}</strong>
                    <span><MathText text={item.answer} /></span>
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
              <p key={item.id}><MathText text={item.text} /></p>
            ))}
          </details>
        ) : null}
      </div>
    </aside>
  );
}

export default AssistantPanel;
