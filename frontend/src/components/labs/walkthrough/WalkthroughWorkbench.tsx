import { useEffect, useRef, useState, type ReactNode } from 'react';
import { errorMessage } from '@/api/client';
import type { LabProblem } from '@/labs/types';
import { WalkthroughPlayer } from './WalkthroughPlayer';
import styles from './WalkthroughWorkbench.module.css';

interface Props {
  problem: LabProblem;
  configured: boolean;
  ready: boolean;
  onGenerate: (force: boolean) => Promise<void>;
  children: ReactNode;
}

export function WalkthroughWorkbench({ problem, configured, ready, onGenerate, children }: Props): JSX.Element {
  if (!problem.walkthrough_eligible && !problem.walkthrough) return <>{children}</>;
  return <SurfaceWorkbench problem={problem} configured={configured} ready={ready} onGenerate={onGenerate}>{children}</SurfaceWorkbench>;
}

function SurfaceWorkbench({ problem, configured, ready, onGenerate, children }: Props): JSX.Element {
  const [tab, setTab] = useState<'process' | 'result'>(configured || problem.walkthrough ? 'process' : 'result');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const attempted = useRef(false);
  const walkthrough = problem.walkthrough;
  const generate = async (force: boolean): Promise<void> => {
    attempted.current = true;
    setError('');
    setPending(true);
    try {
      await onGenerate(force);
    } catch (cause) {
      setError(errorMessage(cause));
      setTab('result');
    } finally {
      setPending(false);
    }
  };

  useEffect(() => {
    if (configured && ready && tab === 'process' && !walkthrough && !attempted.current) void generate(false);
  });

  return (
    <>
      <div className={styles.tabs} role="group" aria-label="实验视图">
        <button type="button" aria-pressed={tab === 'process'} onClick={() => setTab('process')}>过程</button>
        <button type="button" aria-pressed={tab === 'result'} onClick={() => setTab('result')}>结果</button>
      </div>
      {tab === 'process' && walkthrough ? (
        <>
          <WalkthroughPlayer key={walkthrough.input_hash} walkthrough={walkthrough} />
          {walkthrough.verification.status === 'unverified' && configured ? (
            <button type="button" className={styles.retry} disabled={pending || !ready} onClick={() => void generate(true)}>
              {pending ? '正在重新验算…' : '重新生成并验算'}
            </button>
          ) : null}
        </>
      ) : tab === 'process' ? (
        <div className={styles.feedback} role="status">
          {pending ? '正在生成并验算曲面积分过程…' : !configured ? '未配置文本模型，可查看原题结果。' :
            error || '正在同步题目条件…'}
          {configured && error ? <button type="button" disabled={!ready} onClick={() => void generate(false)}>重试</button> : null}
        </div>
      ) : (
        <>
          {pending ? <p className={styles.feedback} role="status">正在后台生成并验算过程…</p> : null}
          {error || !configured && !walkthrough ? (
            <div className={styles.feedback} role="status">
              {error || '未配置文本模型，已显示原题结果。'}
              {configured ? <button type="button" disabled={!ready || pending} onClick={() => {
                setTab('process');
                void generate(false);
              }}>重新生成过程</button> : null}
            </div>
          ) : null}
          {children}
        </>
      )}
    </>
  );
}
