import {useEffect, useRef, useState, type FormEvent} from 'react';
import Markdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import {errorMessage} from '@/api/client';
import {askPageQuestion, preparePageQuestion, type PageQuestionAnswer, type PageQuestionContext} from '@/api/pptAI';
import styles from './LearningPanel.module.css';

interface Props {
  materialId: string;
  pageNo: number;
  onClose: () => void;
}

export function PageQuestionPanel({materialId, pageNo, onClose}: Props) {
  const [context, setContext] = useState<PageQuestionContext | null>(null);
  const [prepareError, setPrepareError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<Array<PageQuestionAnswer & {question: string}>>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const answerRequest = useRef<AbortController | null>(null);
  const latest = useRef<HTMLDivElement>(null);
  const hasImage = context?.pages.some(page => page.has_image);
  const fillQuestion = (text: string) => {
    setQuestion(text);
    input.current?.focus();
  };
  const retry = () => {
    setContext(null);
    setPrepareError('');
    setAttempt(previous => previous + 1);
  };

  useEffect(() => {
    const request = new AbortController();
    preparePageQuestion(materialId, pageNo, request.signal).then(
      value => { if (!request.signal.aborted) setContext(value); },
      reason => { if (!request.signal.aborted) setPrepareError(errorMessage(reason)); },
    );
    return () => request.abort();
  }, [materialId, pageNo, attempt]);
  useEffect(() => () => answerRequest.current?.abort(), []);
  useEffect(() => { latest.current?.scrollIntoView({block: 'nearest'}); }, [turns, busy]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const text = question.trim();
    if (!hasImage || !text || answerRequest.current) return;
    const request = new AbortController();
    answerRequest.current = request;
    setError('');
    setBusy(true);
    try {
      const answer = await askPageQuestion(materialId, pageNo, text,
        turns.slice(-4).map(turn => ({question: turn.question, answer: turn.answer})), request.signal);
      if (request.signal.aborted) return;
      setTurns(previous => [...previous, {...answer, question: text}]);
      setQuestion('');
    } catch (reason) {
      if (!request.signal.aborted) setError(errorMessage(reason));
    } finally {
      answerRequest.current = null;
      if (!request.signal.aborted) setBusy(false);
    }
  };

  return <div className={`${styles.panel} ${styles.pageQuestion}`}>
    <header className={styles.head}>
      <div>
        <span className={styles.pageMarker}>第 {pageNo} 页</span>
        <h2>本页学习</h2>
        <p role="status">{prepareError ? '课件上下文读取失败' : context
          ? `已读取${context.pages.map(page => `第 ${page.page_no} 页`).join('、')}`
          : '正在读取本页和相邻页…'}</p>
      </div>
      <button type="button" className={styles.close} onClick={onClose} aria-label="关闭本页学习">×</button>
    </header>
    <div className={styles.body}>
      {prepareError && <div>
        <p className={styles.error} role="alert">{prepareError}</p>
        <button type="button" className={styles.ghost} onClick={retry}>重新读取</button>
      </div>}
      {context && !hasImage && <div>
        <p className={styles.hint}>课件底图尚未生成，请稍后重新读取。</p>
        <button type="button" className={styles.ghost} onClick={retry}>重新读取</button>
      </div>}
      {context && hasImage && context.pages.some(page => !page.has_image) &&
        <p className={styles.hint}>第 {context.pages.filter(page => !page.has_image).map(page => page.page_no).join('、')} 页暂无底图，可参考该页文字。</p>}
      {hasImage && !turns.length && !busy && <section className={styles.questionStarter}>
        <h3>从这页开始</h3>
        <p>选一个问题，或在下方输入你想弄懂的内容。</p>
        {['这页最重要的知识点是什么？', '这页的图或公式该怎么理解？'].map(prompt =>
          <button type="button" key={prompt} onClick={() => fillQuestion(prompt)}>
            {prompt}<span aria-hidden="true">↗</span>
          </button>
        )}
      </section>}
      <div aria-live="polite">
        {turns.map((turn, index) => <section className={`${styles.section} ${styles.questionTurn}`} key={index}>
          <h3>{turn.question}</h3>
          <div className={styles.qaAnswer}>
            <Markdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]} skipHtml disallowedElements={['img']}>
              {turn.answer}
            </Markdown>
          </div>
          <p className={styles.hint}>{turn.pages.length
            ? `依据页码 ${turn.pages.map(page => `第 ${page} 页`).join('、')}`
            : '此回答未引用课件页码'}</p>
        </section>)}
        {busy && <p className={styles.hint}>视觉模型正在回答…</p>}
        <div ref={latest}/>
      </div>
    </div>
    <form className={styles.qaForm} onSubmit={submit}>
      <label className={styles.question}>你的问题
        <textarea ref={input} rows={3} maxLength={2000} value={question} disabled={busy}
          onChange={event => setQuestion(event.target.value)} placeholder="例如：右边的图想说明什么？"/>
      </label>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.sectionActions}>
        <button type="submit" className={styles.primary}
          disabled={!hasImage || !question.trim() || busy}>提交问题</button>
      </div>
    </form>
  </div>;
}
