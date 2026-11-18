import type { ReactNode } from 'react';
import { MathText, ProblemText } from './ProblemText';
import { conditionValueText } from '@/labs/mathText';
import {
  PROVENANCE_LABELS,
  type LabCondition,
  type LabDocument,
  type LabProblem,
} from '@/labs/types';
import type { LabSelection } from './LabCanvas';
import styles from './labs.module.css';

export type SourceTab = 'problem' | 'conditions' | 'source';

interface Props {
  lab: LabDocument;
  problem: LabProblem;
  tab: SourceTab;
  selected: LabSelection | null;
  currentParams: Record<string, unknown>;
  previewUrl: (key: string) => string;
  onTab: (tab: SourceTab) => void;
  onOpenReview: () => void;
  onOpenCompare: (pageKey?: string) => void;
  onConfirmTranscription?: () => void;
  onSelect: (selection: LabSelection | null) => void;
}

function Provenance({ value }: { value: LabCondition['provenance'] }): ReactNode {
  return (
    <span className={styles.provenance} data-provenance={value}>
      {PROVENANCE_LABELS[value] ?? value}
    </span>
  );
}

function ConditionCard({
  condition,
  activeValue,
  selected,
  onSelect,
}: {
  condition: LabCondition;
  activeValue: unknown;
  selected: boolean;
  onSelect: (selection: LabSelection) => void;
}): ReactNode {
  return (
    <button
      type="button"
      className={styles.conditionCard}
      data-selected={selected || undefined}
      onClick={() => onSelect({ id: condition.id, label: condition.label, kind: 'condition' })}
    >
      <span className={styles.conditionTop}>
        <strong><MathText text={condition.label} /></strong>
        <Provenance value={condition.provenance} />
      </span>
      <span className={styles.conditionValue}>
        <MathText text={conditionValueText(activeValue)} />
        {condition.unit ? <small>{condition.unit}</small> : null}
      </span>
      {condition.note ? <small className={styles.conditionNote}><MathText text={condition.note} /></small> : null}
      {condition.source.excerpt ? (
        <span className={styles.conditionSource} title={condition.source.excerpt}>
          {condition.source.page ? `第 ${condition.source.page} 页 · ` : ''}
          “<MathText text={condition.source.excerpt} />”
        </span>
      ) : null}
    </button>
  );
}

export function LabSourcePanel({
  lab,
  problem,
  tab,
  selected,
  currentParams,
  previewUrl,
  onTab,
  onOpenReview,
  onOpenCompare,
  onConfirmTranscription,
  onSelect,
}: Props): ReactNode {
  const blocking = problem.recognition.ambiguities.filter((item) => item.severity === 'blocking' && !item.resolved);
  const notices = problem.recognition.ambiguities.filter((item) => item !== undefined && !blocking.includes(item));
  const pages = lab.source.pages.filter((page) => problem.source_pages.some((item) => item.file_id === page.file_id && item.page === page.page));
  const uploaded = lab.source.files
    .filter((file) => file.role === 'attempt' || file.role === 'reference')
    .map((file) => ({
      ...file,
      text: lab.source.pages
        .filter((page) => page.file_id === file.file_id)
        .map((page) => page.text.trim())
        .filter(Boolean)
        .join('\n\n'),
    }));

  return (
    <aside className={styles.sourcePanel} aria-label="题目与来源">
      <div className={styles.sourcePanelHead}>
        <span className={styles.eyebrow}>PROBLEM DOSSIER</span>
        <div>
          <h2>题目与条件</h2>
          <span className={styles.statusPill} data-status={problem.status}>
            {problem.status === 'reference' ? '参考解答'
              : problem.status === 'pending_ai' ? '等待 AI 理解'
              : problem.ai_solution ? problem.ai_solution.verification === 'kernel' ? problem.ai_solution.source_review_required ? '待核对原图' : '可操作' : '待补充'
              : problem.status === 'ready' ? '可求解' : problem.status === 'needs_review' ? '待核对' : '暂不支持'}
          </span>
        </div>

      </div>

      <div className={styles.sourceTabs} role="tablist" aria-label="题目资料">
        {[
          { id: 'problem' as const, label: '原题' },
          { id: 'conditions' as const, label: '条件' },
          { id: 'source' as const, label: '来源' },
        ].map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => onTab(item.id)}
          >
            {item.label}
            {item.id === 'conditions' && blocking.length ? <i>{blocking.length}</i> : null}
          </button>
        ))}
      </div>

      <div className={styles.sourceBody}>
        {tab === 'problem' ? (
          <div className={styles.problemSheet}>
            <div className={styles.problemMeta}>
              <span>{problem.number ? `第 ${problem.number} 题` : '完整题目'}</span>
              <span>{problem.source.label}</span>
            </div>
            {problem.recognition.quality?.untrusted ? (
              <div className={styles.blockingNotice} role="alert">
                <strong>识别文字质量不可信，已跳过本地建模</strong>
                <p>{problem.recognition.quality.issues.join('；')}。请以原图和 AI 转写为准核对。</p>
              </div>
            ) : null}
            {pages.some(page => page.image_key) ? <>
              {pages.filter(page => page.image_key).map(page => <button type="button" key={page.image_key}
                onClick={() => onOpenCompare()} style={{ width: '100%', padding: 8, border: '1px solid var(--hairline)', borderRadius: 10, background: 'white', cursor: 'zoom-in' }}>
                <img src={previewUrl(page.image_key!)} alt={`第 ${page.page} 页原题，点击放大`} style={{ width: '100%', height: 'auto' }} />
              </button>)}
              <details><summary>查看识别文字 / 修正</summary><ProblemText text={problem.text} className={styles.problemText} />
                <button type="button" onClick={onOpenReview}>修正题目</button></details>
            </> : <ProblemText text={problem.text} className={styles.problemText} />}
            {problem.recognition.ai_transcription?.text ? (
              <div className={styles.aiTranscription}>
                <span>AI 按原图转写</span>
                <ProblemText text={problem.recognition.ai_transcription.text} className={styles.problemText} />
                {!problem.recognition.ai_transcription.confirmed && onConfirmTranscription ? (
                  <button type="button" onClick={onConfirmTranscription}>转写正确，按此建模</button>
                ) : <small>已确认</small>}
              </div>
            ) : null}
            {problem.recognition.reference_answer_text ? <details><summary>上传的参考答案</summary><ProblemText text={problem.recognition.reference_answer_text} /></details> : null}
            <button type="button" className={styles.inlineLink} onClick={() => onOpenCompare()}>
              打开原稿对照 →
            </button>
          </div>
        ) : null}

        {tab === 'conditions' ? (
          <div className={styles.conditionsSheet}>
            <div className={styles.conditionsHead}>
              <p>来源标记：原题 / 推断 / 学生核对 / 补充 / 教学示例。修改关键条件会重新编译模型。</p>
              <button type="button" onClick={onOpenReview}>
                核对与修正
              </button>
            </div>
            {blocking.length ? (
              <div className={styles.blockingNotice} role="alert">
                <strong>{blocking.length} 个关键条件需要先确认</strong>
                <p><MathText text={blocking.map((item) => item.question).join(' ')} /></p>
              </div>
            ) : null}
            <div className={styles.conditionList}>
              {problem.recognition.conditions.map((condition) => (
                <ConditionCard
                  key={condition.id}
                  condition={condition}
                  activeValue={currentParams[condition.id] ?? condition.value}
                  selected={selected?.id === condition.id}
                  onSelect={onSelect}
                />
              ))}
            </div>
            {notices.length ? (
              <div className={styles.noticeList}>
                <span>提示与保留项</span>
                {notices.map((item) => (
                  <p key={item.id} data-severity={item.severity}>
                    {item.resolved ? '✓ ' : '• '}
                    <MathText text={item.question} />
                  </p>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {tab === 'source' ? (
          <div className={styles.sourceSheet}>
            <div className={styles.sourceMethod}>
              <span>识别方式</span>
              <strong>{lab.source.method || problem.recognition.method}</strong>
              <p>原页保留；公式与数据可从条件卡片回到来源摘录。未启用模型增强时不会外发文件。</p>
            </div>
            <div className={styles.fileList}>
              {lab.source.files.map((file) => (
                <div key={file.file_id} className={styles.fileRow}>
                  <span className={styles.fileRole} data-role={file.role}>
                    {file.role_label}
                  </span>
                  <span>
                    <strong>{file.name}</strong>
                    <small>
                      {file.kind.toUpperCase()} · {file.pages} 页 · {file.chars} 字
                    </small>
                  </span>
                </div>
              ))}
            </div>
            {uploaded.length ? (
              <div className={styles.uploadedDocs}>
                <span>学生上传的解答与参考答案</span>
                {uploaded.map((item) => (
                  <details key={item.file_id}>
                    <summary>
                      {item.role_label} · {item.name}
                    </summary>
                    <ProblemText text={item.text || '这份文件没有可提取的文字。'} className={styles.problemText} />
                  </details>
                ))}
              </div>
            ) : null}
            <div className={styles.pageList}>
              {pages.map((page) => (
                <button
                  key={`${page.file_id}-${page.page}`}
                  type="button"
                  className={styles.pageCard}
                  onClick={() => onOpenCompare()}
                >
                  {page.image_key ? (
                    <img src={previewUrl(page.image_key)} alt={`第 ${page.page} 页原稿`} loading="lazy" />
                  ) : (
                    <span className={styles.pageTextIcon}>文</span>
                  )}
                  <span>
                    <strong>第 {page.page} 页</strong>
                    <small>{page.method}</small>
                  </span>
                </button>
              ))}
            </div>
            <div className={styles.citation}>
              <span>来源引用</span>
              <p>{lab.source.citation}</p>
            </div>
          </div>
        ) : null}
      </div>

      <button type="button" className={styles.compareButton} onClick={() => onOpenCompare()}>
        <span aria-hidden="true">◫</span> 原稿对照
      </button>
    </aside>
  );
}

export default LabSourcePanel;
