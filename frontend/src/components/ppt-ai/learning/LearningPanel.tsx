import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  createLearningExplanation,
  createLearningPractice,
  createLearningQuestion,
  executeLearningAction,
  getLearningPractices,
  prepareLearning,
  waitForPptAiTask,
} from '@/api/pptAI';
import type { InteractionBundle } from '@/ppt-ai/types';
import type {
  LearningActionDraft,
  LearningPage,
  LearningPractice,
  LearningReply,
  LearningResultCard as LearningCard,
  LearningSourceRef,
} from '@/ppt-ai/learning/types';
import {
  createLearningController,
  type LearningController,
  type LearningValue,
} from '@/ppt-ai/learning/controller';
import { LearningDraftPersistence } from '@/ppt-ai/learning/draftPersistence';
import { useBundleEvaluation } from '@/ppt-ai/runtime/useBundleEvaluation';
import { adaptLearningScene } from '@/ppt-ai/learning/sceneAdapter';
import { PptAiInteraction } from '@/components/ppt-ai/PptAiInteraction';
import { LearningResultCard } from './LearningResultCard';
import { MatrixLearningScene } from './MatrixLearningScene';
import { SourceEvidence } from './SourceEvidence';
import styles from './LearningPanel.module.css';

type Mode = 'explain' | 'explore' | 'ask';

interface Props {
  materialId: string | null;
  page: LearningPage;
  bundle: InteractionBundle | null;
  pageImageUrl?: string;
  readOnly?: boolean;
  onClose: () => void;
  onLocate?: (source: LearningSourceRef) => void;
  onRefresh?: () => Promise<unknown>;
  onPracticeSaved?: () => void;
}

function operationId(prefix: string): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${random.replace(/-/g, '').slice(0, 24)}`;
}

function CardView({ card, stale }: { card: LearningCard; stale?: boolean }) {
  return <LearningResultCard card={card} stale={stale} />;
}

function DraftView({ draft, busy, onExecute, onCancel }: {
  draft: LearningActionDraft;
  busy: boolean;
  onExecute: () => void;
  onCancel: () => void;
}) {
  return (
    <section className={styles.draft} aria-label="待确认草案">
      <h4>执行前请核对条件</h4>
      <p>{draft.summary}</p>
      <dl>
        {[...draft.conditions, ...draft.added_conditions].slice(0, 12).map((condition) => (
          <div key={`${condition.concept_id}-${condition.label}`}>
            <dt>{condition.label}</dt>
            <dd>
              {Array.isArray(condition.value) ? `[${condition.value.join(', ')}]` : String(condition.value)}
              <small>{condition.origin_type === 'teaching' ? ' · 教学条件' : ''}{condition.note ? ` · ${condition.note}` : ''}</small>
            </dd>
          </div>
        ))}
      </dl>
      <div className={styles.draftActions}>
        <button type="button" className={styles.primary} onClick={onExecute} disabled={busy}>
          {busy ? '执行中…' : draft.kind === 'solve_target' ? '确认并求解' : '确认并创建实验'}
        </button>
        <button type="button" className={styles.ghost} onClick={onCancel} disabled={busy}>取消草案</button>
      </div>
    </section>
  );
}

export function LearningPanel({
  materialId,
  page,
  bundle,
  pageImageUrl,
  readOnly,
  onClose,
  onLocate,
  onRefresh,
  onPracticeSaved,
}: Props) {
  const [itemId, setItemId] = useState(page.items[0]?.item_id ?? '');
  const item = page.items.find((entry) => entry.item_id === itemId) ?? page.items[0] ?? null;
  const node = useMemo(
    () => bundle?.compiled.nodes.find((entry) => entry.node_id === item?.node_id) ?? null,
    [bundle, item?.node_id],
  );
  const closeRef = useRef<HTMLButtonElement>(null);
  const [mode, setMode] = useState<Mode>('explain');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [card, setCard] = useState<LearningCard | null>(null);
  const [cardStale, setCardStale] = useState(false);
  const [reply, setReply] = useState<LearningReply | null>(null);
  const [draft, setDraft] = useState<LearningActionDraft | null>(null);
  const [question, setQuestion] = useState('');
  const [notice, setNotice] = useState('');
  const [practiceTitle, setPracticeTitle] = useState('');
  const [practices, setPractices] = useState<LearningPractice[]>([]);
  const [practiceId, setPracticeId] = useState('');

  const loadPractices = useCallback(async () => {
    if (!materialId) return;
    try {
      const result = await getLearningPractices(materialId, page.bundle_id ?? undefined);
      setPractices(result.items);
    } catch {
      setPractices([]);
    }
  }, [materialId, page.bundle_id]);

  useEffect(() => {
    void loadPractices();
  }, [loadPractices]);

  const persistence = useMemo(() => {
    if (!item || !materialId) return null;
    return new LearningDraftPersistence({
      viewerKey: materialId,
      materialKey: materialId,
      sourceHash: page.source_hash,
      nodeId: item.node_id,
      pageNo: page.page_no,
    });
  }, [item, materialId, page.page_no, page.source_hash]);

  const controller = useMemo<LearningController | null>(() => {
    if (!item || !page.branch_id || !page.branch_revision) return null;
    const stored = persistence?.load() ?? null;
    const allowed = [
      ...new Set([
        ...item.descriptor.controls.map((control) => control.concept_id),
        ...Object.keys(item.baseline_values),
      ]),
    ];
    const allowedSet = new Set(allowed);
    const savedValues = stored
      ? Object.fromEntries(Object.entries(stored.values).filter(([key]) => allowedSet.has(key)))
      : {};
    const providerVector = Array.isArray(node?.provider.vector) ? (node!.provider.vector as number[]) : [];
    const teachingDefaults: Record<string, LearningValue> = {};
    item.descriptor.controls.forEach((control) => {
      if (!control.concept_id.startsWith('teaching.')) return;
      const index = Math.max(0, Number(control.concept_id.split('.').pop() ?? 1) - 1);
      const fallback = typeof providerVector[index] === 'number' ? providerVector[index]! : 0;
      teachingDefaults[control.concept_id] = fallback;
    });
    return createLearningController({
      documentRevision: page.document_revision,
      sourceHash: page.source_hash,
      bundleId: page.bundle_id ?? '',
      bundleRevision: page.bundle_revision ?? 1,
      pageNo: page.page_no,
      nodeId: item.node_id,
      regionId: item.region_id,
      branchId: page.branch_id,
      branchRevision: page.branch_revision,
      baselineValues: { ...item.baseline_values, ...teachingDefaults },
      values: { ...item.baseline_values, ...teachingDefaults, ...savedValues },
      draftRevision: stored?.draftRevision ?? 0,
      allowedValueKeys: allowed,
    });
  }, [item, node, page, persistence]);

  const state = useSyncExternalStore(
    controller?.subscribe ?? (() => () => undefined),
    controller?.getSnapshot ?? (() => null),
    controller?.getSnapshot ?? (() => null),
  );
  const linkedEvaluation = useBundleEvaluation(bundle, state?.values ?? {});

  useEffect(() => {
    if (!persistence || !controller) return undefined;
    const timer = window.setTimeout(() => {
      const snapshot = controller.getSnapshot();
      persistence.save(snapshot.values, snapshot.draftRevision);
    }, 260);
    return () => window.clearTimeout(timer);
  }, [persistence, controller, state?.draftRevision, state?.values]);

  useEffect(() => {
    setCard(null);
    setReply(null);
    setDraft(null);
    setCardStale(false);
    setNotice('');
    setError('');
  }, [itemId]);

  const openPractice = useCallback((practice: LearningPractice) => {
    if (!controller) return;
    const branch = practice.branch_state as Record<string, unknown>;
    const values = branch.canonical_values;
    if (typeof values !== 'object' || values === null) return;
    controller.loadBranch({
      branch_id: String(branch.branch_id ?? practice.branch_id),
      revision: Number(branch.revision ?? practice.revision),
      kind: typeof branch.kind === 'string' ? branch.kind : 'practice',
      canonical_values: values as Record<string, LearningValue>,
    }, { keepCourseBaseline: true });
    setPracticeId(practice.practice_id);
    persistence?.clear();
    setNotice(`已打开探索「${practice.title}」；课件基准不变。`);
  }, [controller, persistence]);

  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const run = useCallback(async <T,>(starter: () => Promise<{ task_id: string }>, apply: (task: Awaited<ReturnType<typeof waitForPptAiTask>>) => T | null): Promise<T | null> => {
    if (!materialId) return null;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const started = await starter();
      const task = await waitForPptAiTask(materialId, started.task_id);
      if (task.status === 'failed' || task.status === 'superseded') {
        setError(task.error_message || String(task.result?.reason ?? '任务未完成'));
        return null;
      }
      return apply(task);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '任务未完成');
      return null;
    } finally {
      setBusy(false);
    }
  }, [materialId]);

  const askForExplanation = useCallback(async (change = false) => {
    if (!controller || !materialId) return;
    const requestId = operationId('learn_explain');
    const ticket = { clientRequestId: requestId, draftRevision: controller.getSnapshot().draftRevision, nodeId: controller.getSnapshot().nodeId, pageNo: controller.getSnapshot().pageNo };
    const context = controller.beginRequest(requestId);
    await run(
      () => createLearningExplanation(materialId, {
        context,
        mode: change ? 'change' : 'concept',
        operation_id: requestId,
      }),
      (task) => {
        const next = task.result?.card;
        if (typeof next !== 'object' || next === null) return null;
        if (!controller.acceptTaskResult({ input_hash: String((next as LearningCard).input_hash ?? '') }, ticket)) {
          setCardStale(true);
          setError('条件已改变，本次讲解未覆盖当前页。');
          return null;
        }
        const typed = next as unknown as LearningCard;
        setCard(typed);
        setCardStale(typed.input_hash !== context.input_hash && context.input_hash !== null);
        return typed;
      },
    );
  }, [controller, materialId, run]);

  const submitQuestion = useCallback(async (text: string, suggested?: string) => {
    if (!controller || !materialId) return;
    const trimmed = text.trim();
    if (!trimmed) {
      setError('请输入一个问题，或使用上面的建议问题。');
      return;
    }
    const requestId = operationId('learn_question');
    const ticket = { clientRequestId: requestId, draftRevision: controller.getSnapshot().draftRevision, nodeId: controller.getSnapshot().nodeId, pageNo: controller.getSnapshot().pageNo };
    const context = controller.beginRequest(requestId);
    await run(
      () => createLearningQuestion(materialId, {
        context,
        question: trimmed,
        suggested_action: suggested as 'explain' | 'run_experiment' | 'solve_target' | 'compare' | 'counterexample' | null,
        operation_id: requestId,
      }),
      (task) => {
        const next = task.result?.reply;
        if (typeof next !== 'object' || next === null) return null;
        if (!controller.acceptTaskResult(next as LearningReply, ticket)) {
          setError('条件或页面已变化，旧回答未覆盖当前内容。');
          return null;
        }
        const typed = next as unknown as LearningReply;
        setReply(typed);
        setCard(typed.answer_card);
        setDraft(typed.action_draft);
        setCardStale(typed.state === 'stale');
        return typed;
      },
    );
  }, [controller, materialId, run]);

  const executeDraft = useCallback(async () => {
    if (!draft || !controller || !materialId) return;
    const requestId = operationId('learn_execute');
    const ticket = { clientRequestId: requestId, draftRevision: controller.getSnapshot().draftRevision, nodeId: controller.getSnapshot().nodeId, pageNo: controller.getSnapshot().pageNo };
    const context = controller.beginRequest(requestId);
    await run(
      () => executeLearningAction(materialId, draft.action_id, {
        context,
        operation_id: requestId,
      }),
      (task) => {
        if (task.result?.state === 'stale') {
          setError(String(task.result.reason ?? '条件已改变，请重新提问'));
          setDraft(null);
          return null;
        }
        const next = task.result?.card;
        if (typeof next !== 'object' || next === null) return null;
        const typed = next as unknown as LearningCard;
        if (!controller.acceptTaskResult({ input_hash: typed.input_hash }, ticket)) {
          setError('条件或页面已变化，旧结果未覆盖当前内容。');
          return null;
        }
        setCard(typed);
        setDraft(null);
        setCardStale(false);
        setNotice(typed.result_kind === 'target' ? '求解完成；原课件基准未改变。' : '实验完成；已创建独立候选分支。');
        return typed;
      },
    );
  }, [controller, draft, materialId, run]);

  const savePractice = useCallback(async () => {
    if (!controller || !materialId) return;
    const requestId = operationId('learn_practice');
    const context = controller.beginRequest(requestId);
    controller.markSaving();
    setBusy(true);
    setError('');
    try {
      const started = await createLearningPractice(materialId, {
        context,
        title: practiceTitle.trim(),
        operation_id: requestId,
      });
      const task = await waitForPptAiTask(materialId, started.task_id);
      const branch = task.result?.branch;
      if (task.status === 'succeeded' && typeof branch === 'object' && branch !== null) {
        controller.acceptSavedBranch(branch as { branch_id: string; revision: number; canonical_values: Record<string, LearningValue>; kind?: string });
        setNotice('已保存为个人探索；课件基准不变。');
        persistence?.clear();
        await loadPractices();
        onPracticeSaved?.();
      } else {
        controller.markConflict(task.error_message || String(task.result?.reason ?? '保存未完成'));
        setError(task.error_message || String(task.result?.reason ?? '保存未完成'));
      }
    } catch (caught) {
      controller.markConflict(caught instanceof Error ? caught.message : '保存未完成');
      setError(caught instanceof Error ? caught.message : '保存未完成');
    } finally {
      setBusy(false);
    }
  }, [controller, loadPractices, materialId, onPracticeSaved, persistence, practiceTitle]);

  const prepare = useCallback(async () => {
    if (!materialId) return;
    await run(
      () => prepareLearning(materialId, {
        expected_document_revision: page.document_revision,
        operation_id: operationId('learn_prepare'),
      }),
      () => {
        setNotice('本页学习内容已准备；正在刷新。');
        void onRefresh?.();
        return true;
      },
    );
  }, [materialId, onRefresh, page.document_revision, run]);

  if (!item) {
    return (
      <aside className={styles.panel} aria-label="本页学习">
        <header className={styles.head}>
          <div><span className={styles.eyebrow}>本页学习</span><h2>第 {page.page_no} 页</h2></div>
          <button ref={closeRef} type="button" className={styles.close} onClick={onClose} aria-label="关闭本页学习">×</button>
        </header>
        <div className={styles.body}>
          <p className={styles.empty}>
            {!page.capabilities.can_explore_locally
              ? '学习入口当前未开启；原稿阅读、编辑与高级管理仍可使用。'
              : page.state === 'preparing'
                ? '正在整理公式与实验，完成后会自动出现。'
                : page.note || '本页没有可执行的学习内容；原稿继续可读。'}
          </p>
          {materialId && page.capabilities.can_explore_locally && page.state === 'unprepared' ? (
            <button type="button" className={styles.primary} onClick={() => void prepare()} disabled={busy}>
              {busy ? '准备中…' : '准备本页学习'}
            </button>
          ) : null}
          {error ? <p className={styles.error} role="alert">{error}</p> : null}
        </div>
      </aside>
    );
  }

  if (!controller || !state) {
    return (
      <aside className={styles.panel} aria-label="本页学习">
        <header className={styles.head}>
          <div><span className={styles.eyebrow}>本页学习</span><h2>{item.title}</h2></div>
          <button ref={closeRef} type="button" className={styles.close} onClick={onClose} aria-label="关闭本页学习">×</button>
        </header>
        <div className={styles.body}><p className={styles.empty}>当前学习内容缺少可用的分支条件；请重新准备本页。</p></div>
      </aside>
    );
  }

  const scene = node ? adaptLearningScene(item, node, state.values) : null;
  const packagedCard = readOnly ? item.packaged_explanation ?? null : null;
  const controls = item.descriptor.controls;
  const editable = controls.filter((control) => control.role === 'editable');
  const fixed = controls.filter((control) => control.role !== 'editable');
  const canAsk = !readOnly && page.capabilities.can_ask_online && Boolean(materialId);
  const canSave = !readOnly && page.capabilities.can_save_cloud && Boolean(materialId);

  return (
    <aside className={styles.panel} aria-label="本页学习">
      <header className={styles.head}>
        <div>
          <span className={styles.eyebrow}>本页学习 · 第 {page.page_no} 页</span>
          <h2>{item.title}</h2>
          <p>{item.descriptor.objective}</p>
        </div>
        <button ref={closeRef} type="button" className={styles.close} onClick={onClose} aria-label="关闭本页学习">×</button>
      </header>

      {page.items.length > 1 ? (
        <div className={styles.itemTabs} role="tablist" aria-label="本页学习对象">
          {page.items.map((entry) => (
            <button key={entry.item_id} type="button" role="tab" aria-selected={entry.item_id === item.item_id}
              onClick={() => setItemId(entry.item_id)}>{entry.title}</button>
          ))}
        </div>
      ) : null}

      <nav className={styles.modes} aria-label="学习方式">
        <button type="button" aria-pressed={mode === 'explain'} onClick={() => setMode('explain')}>讲懂这里</button>
        <button type="button" aria-pressed={mode === 'explore'} onClick={() => setMode('explore')}>动手试试</button>
        <button type="button" aria-pressed={mode === 'ask'} onClick={() => setMode('ask')} disabled={!canAsk}>问一个问题</button>
      </nav>

      <div className={styles.body}>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
        {readOnly ? (
          <p className={styles.readOnlyNote}>这是已分享/离线内容：可阅读已打包讲解与操作实验；不发起联网问答，也不保存到作者空间。</p>
        ) : null}

        {mode === 'explain' ? (
          <section className={styles.section} aria-label="讲懂这里">
            <div className={styles.sectionActions}>
              <button type="button" className={styles.primary} onClick={() => void askForExplanation(false)} disabled={busy || readOnly}>
                {busy ? '整理中…' : '开始讲解'}
              </button>
              <button type="button" className={styles.ghost} onClick={() => void askForExplanation(true)} disabled={busy || readOnly || state.status === 'clean'}>
                解释这次变化
              </button>
            </div>
            {!readOnly && state.status === 'dirty' ? (
              <p className={styles.hint}>当前有未保存条件；讲解会绑定这组条件，而不是服务器旧值。</p>
            ) : null}
            {card ? <CardView card={card} stale={cardStale}/> : packagedCard ? (
              <CardView card={packagedCard}/>
            ) : (
              <p className={styles.empty}>先看核心意思，再展开原稿依据与关键一步。讲解只解释当前有效来源。</p>
            )}
            <SourceEvidence refs={item.descriptor.source_refs} pageImageUrl={pageImageUrl} onLocate={onLocate}/>
          </section>
        ) : null}

        {mode === 'explore' ? (
          <section className={styles.section} aria-label="动手试试">
            <p className={styles.observation}>这次观察什么：{item.descriptor.objective}</p>
            <p className={styles.hint}>
              固定的条件：{fixed.map((control) => control.label).join('、') || '无'}；
              可改变：{editable.map((control) => control.label).join('、') || '无'}。
            </p>
            {editable.length ? (
              <div className={styles.controls}>
                {editable.map((control) => (
                  <label key={control.concept_id} className={styles.control}>
                    <span>{control.label}{control.unit ? `（${control.unit}）` : ''}</span>
                    <span className={styles.controlRow}>
                      <input type="range"
                        min={control.min ?? -5} max={control.max ?? 5}
                        step={control.step ?? 0.1}
                        value={Number(state.values[control.concept_id] ?? 0)}
                        onChange={(event) => controller.setValue(control.concept_id, Number(event.target.value))}/>
                      <input type="number"
                        min={control.min ?? undefined} max={control.max ?? undefined}
                        step={control.step ?? 0.1}
                        value={Number(state.values[control.concept_id] ?? 0)}
                        aria-label={`${control.label}精确数值`}
                        onChange={(event) => {
                          const next = Number(event.target.value);
                          if (event.target.value !== '' && Number.isFinite(next)) controller.setValue(control.concept_id, next);
                        }}/>
                    </span>
                    {control.reason ? <small>{control.reason}</small> : null}
                  </label>
                ))}
              </div>
            ) : null}
            {fixed.length ? (
              <details className={styles.fixedControls}>
                <summary>完整参数（{fixed.length} 项，默认固定）</summary>
                <ul>{fixed.map((control) => (
                  <li key={control.concept_id}>{control.label} = {String(state.values[control.concept_id] ?? '—')} {control.unit}</li>
                ))}</ul>
              </details>
            ) : null}
            {(() => {
              if (!scene) {
                return <p className={styles.empty}>当前 bundle 与学习内容版本不一致；请刷新页面后重试。</p>;
              }
              if (scene.kind === 'generic') {
                return node ? (
                  <PptAiInteraction node={node} values={state.values}
                    derivedValues={linkedEvaluation?.derivedValues} readOnly={readOnly}
                    onChange={(conceptId, value) => {
                      if (!Array.isArray(value)) controller.setValue(conceptId, value);
                    }}/>
                ) : <p className={styles.empty}>当前 bundle 与学习内容版本不一致；请刷新页面后重试。</p>;
              }
              return <MatrixLearningScene scene={scene}/>;
            })()}
            <div className={styles.sectionActions}>
              <button type="button" className={styles.ghost} onClick={() => controller.resetToBaseline()}>
                恢复课件条件
              </button>
              {canSave ? (
                <>
                  <input className={styles.titleInput} value={practiceTitle} maxLength={200}
                    onChange={(event) => setPracticeTitle(event.target.value)}
                    placeholder="给这次探索起个名字（可选）" aria-label="探索名称"/>
                  <button type="button" className={styles.primary} onClick={() => void savePractice()} disabled={busy}>
                    {busy ? '保存中…' : '保存这次探索'}
                  </button>
                </>
              ) : null}
            </div>
            {!canSave ? (
              <p className={styles.hint}>{readOnly ? '分享/离线内容只保存到本机，不能写入作者空间。' : '保存功能当前不可用。'}</p>
            ) : null}
            {practices.length ? (
              <div className={styles.practices}>
                <label>
                  已保存探索
                  <select value={practiceId} onChange={(event) => setPracticeId(event.target.value)}>
                    <option value="">选择一份探索</option>
                    {practices.map((practice) => (
                      <option key={practice.practice_id} value={practice.practice_id}>
                        {practice.title} · r{practice.revision}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" className={styles.ghost} disabled={!practiceId}
                  onClick={() => {
                    const practice = practices.find((entry) => entry.practice_id === practiceId);
                    if (practice) openPractice(practice);
                  }}>重开</button>
              </div>
            ) : null}
            <p className={styles.statusLine}>
              条件状态：{state.status === 'dirty' ? '有未保存修改' : state.status === 'saving' ? '保存中' : state.status === 'conflict' ? '版本冲突' : state.status === 'stale' ? '条件已过期' : '与服务器一致'}
              {state.error ? ` · ${state.error}` : ''}
            </p>
          </section>
        ) : null}

        {mode === 'ask' ? (
          <section className={styles.section} aria-label="问一个问题">
            <p className={styles.scope}>提问范围：第 {page.page_no} 页 · {item.title} · {state.status === 'dirty' ? '当前未保存练习条件' : '当前练习条件'}</p>
            {!readOnly ? (
              <div className={styles.suggestions}>
                {item.descriptor.suggested_actions.map((suggestion) => (
                  <button key={suggestion.label} type="button"
                    onClick={() => { setQuestion(suggestion.question); void submitQuestion(suggestion.question, suggestion.action_type); }}
                    disabled={busy}>{suggestion.label}</button>
                ))}
              </div>
            ) : null}
            <label className={styles.question}>
              <span>你的问题</span>
              <textarea value={question} maxLength={2000} rows={3}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="例如：把向量换成 (1,0)，Av 与 v 还共线吗？"
                disabled={busy || readOnly}/>
            </label>
            <div className={styles.sectionActions}>
              <button type="button" className={styles.primary} disabled={busy || readOnly || !question.trim()}
                onClick={() => void submitQuestion(question)}>{busy ? '思考中…' : '提问'}</button>
              <small>问题会携带当前页、区域和练习条件；不会直接修改原稿或画布。</small>
            </div>
            {reply?.state === 'needs_clarification' ? <p className={styles.clarification}>{reply.clarification}</p> : null}
            {reply?.state === 'unsupported' ? <p className={styles.error}>{reply.clarification}</p> : null}
            {draft ? <DraftView draft={draft} busy={busy} onExecute={() => void executeDraft()} onCancel={() => setDraft(null)}/> : null}
            {card ? <CardView card={card} stale={cardStale}/> : null}
          </section>
        ) : null}
      </div>
    </aside>
  );
}

export default LearningPanel;
