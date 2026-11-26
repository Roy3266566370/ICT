import { useEffect, useMemo, useState } from 'react';
import { errorMessage } from '@/api/client';
import {
  detectRelationCycles,
  evaluatePageRelations,
  RELATION_TARGET_PROPERTIES,
  validateRelation,
} from '@/document/relations';
import type {
  GuideAnchor,
  RelationSuggestion,
  RelationTargetProperty,
  SceneNode,
  SceneRelation,
  ViewerParameter,
} from '@/document/types';
import styles from './FreeDeckEditor.module.css';

interface Props {
  pageNodes: SceneNode[];
  relations?: SceneRelation[];
  selectedNode?: SceneNode | null;
  disabled?: boolean;
  onChange?: (relations: SceneRelation[], key?: string) => void;
  onSuggestRelations?: (instruction: string) => Promise<RelationSuggestion>;
  onApplySuggestion?: (suggestion: RelationSuggestion) => string | null;
}

const VIEWER_PARAM_LABELS: Record<ViewerParameter, string> = {
  geometry: '几何拖动',
  style: '外观样式',
  flow: '流动动画',
  start: '拖动起点',
  end: '拖动终点',
  length: '调节线长',
  angle: '调节角度',
  color: '修改颜色',
  line_style: '修改线型',
  stroke_width: '修改线宽',
};

const TARGET_PROP_LABELS: Record<RelationTargetProperty, string> = {
  text: '文字内容 (text)',
  length: '线长 (length)',
  angle: '线条角度 (angle)',
  x: '横坐标 X',
  y: '纵坐标 Y',
  width: '宽度 (width)',
  height: '高度 (height)',
  rotation: '旋转角 (rotation)',
  opacity: '不透明度 (0~1)',
  x1: '起点 X (x1)',
  y1: '起点 Y (y1)',
  x2: '终点 X (x2)',
  y2: '终点 Y (y2)',
};

const ANCHOR_LABELS: Record<GuideAnchor, string> = {
  start: '起点',
  end: '终点',
  center: '中点',
};

function parseCoeffInput(raw: string): number | string {
  const trimmed = raw.trim();
  if (!trimmed) return 1;
  const num = Number(trimmed);
  return Number.isFinite(num) && /^-?\d+(?:\.\d+)?$/.test(trimmed) ? num : trimmed;
}

export function PageRelationsPanel({
  pageNodes,
  relations = [],
  selectedNode,
  disabled = false,
  onChange,
  onSuggestRelations,
  onApplySuggestion,
}: Props) {
  const visibleNodes = useMemo(
    () => pageNodes.filter((n) => !n.deleted && !n.hidden),
    [pageNodes],
  );
  const vectors = useMemo(
    () => visibleNodes.filter((n) => n.type === 'vector'),
    [visibleNodes],
  );
  const textNodes = useMemo(
    () => visibleNodes.filter((n) => n.type === 'text'),
    [visibleNodes],
  );

  const evaluation = useMemo(
    () => evaluatePageRelations(visibleNodes, relations),
    [visibleNodes, relations],
  );

  const nodeLabel = (id: string) => {
    const found = visibleNodes.find((n) => n.id === id);
    if (!found) return id;
    const textPreview = found.type === 'text' && found.text ? `「${found.text.slice(0, 12)}」` : '';
    return `${found.name}${textPreview} (${found.id})`;
  };

  const summarizeRelation = (rel: SceneRelation): string => {
    if (rel.kind === 'basis_decompose') {
      return `换基分解：(${nodeLabel(rel.firstId)}, ${nodeLabel(rel.secondId)}) → ${nodeLabel(rel.resultId)}`;
    }
    if (rel.kind === 'linear_combo') {
      return `线性组合：${rel.a}·${nodeLabel(rel.firstId)} + ${rel.b}·${nodeLabel(rel.secondId)} → ${nodeLabel(rel.targetId)}`;
    }
    if (rel.kind === 'guide_bind') {
      return `辅助线跟随：${nodeLabel(rel.from.nodeId)}.${ANCHOR_LABELS[rel.from.anchor]} → ${nodeLabel(rel.to.nodeId)}.${ANCHOR_LABELS[rel.to.anchor]} ⇒ ${nodeLabel(rel.targetId)}`;
    }
    return `表达式：${nodeLabel(rel.targetId)}.${rel.targetProperty} = ${rel.expression}`;
  };

  const [editingId, setEditingId] = useState<string | null>(null);
  const [kind, setKind] = useState<SceneRelation['kind']>('expr');
  const [targetId, setTargetId] = useState<string>(() => selectedNode?.id ?? textNodes[0]?.id ?? visibleNodes[0]?.id ?? '');
  const [targetProperty, setTargetProperty] = useState<RelationTargetProperty>('text');
  const [expression, setExpression] = useState<string>('');
  const [formatTemplate, setFormatTemplate] = useState<string>('{value}');
  const [precision, setPrecision] = useState<number>(2);

  const [firstId, setFirstId] = useState<string>(() => vectors[0]?.id ?? '');
  const [secondId, setSecondId] = useState<string>(() => vectors[1]?.id ?? vectors[0]?.id ?? '');
  const [resultId, setResultId] = useState<string>(() => vectors[2]?.id ?? vectors[0]?.id ?? '');
  const [labelId, setLabelId] = useState<string>('');
  const [labelTemplate, setLabelTemplate] = useState<string>('斜基：坐标 ({a}, {b})');
  const [coeffA, setCoeffA] = useState<string>('1');
  const [coeffB, setCoeffB] = useState<string>('1');

  const [fromNodeId, setFromNodeId] = useState<string>(() => vectors[0]?.id ?? '');
  const [fromAnchor, setFromAnchor] = useState<GuideAnchor>('end');
  const [toNodeId, setToNodeId] = useState<string>(() => vectors[1]?.id ?? vectors[0]?.id ?? '');
  const [toAnchor, setToAnchor] = useState<GuideAnchor>('end');

  const [formError, setFormError] = useState<string>('');
  const [manualOpen, setManualOpen] = useState<boolean>(false);
  const [nlInput, setNlInput] = useState<string>('');
  const [nlBusy, setNlBusy] = useState<boolean>(false);
  const [nlError, setNlError] = useState<string>('');
  const [proposal, setProposal] = useState<RelationSuggestion | null>(null);

  const proposalCheck = useMemo(() => {
    if (!proposal) return null;
    const proposedIds = new Set(proposal.relations.map((r) => r.id));
    const merged = [
      ...relations.filter((r) => !proposedIds.has(r.id)),
      ...proposal.relations,
    ];
    const cycles = detectRelationCycles(merged);
    const previewEval = evaluatePageRelations(visibleNodes, merged);
    const errors: string[] = [];
    for (const rel of proposal.relations) {
      const err = validateRelation(rel, visibleNodes);
      if (err) errors.push(`${rel.id}：${err}`);
      else if (cycles.has(rel.id)) errors.push(`${rel.id}：存在循环依赖`);
    }
    return { merged, previewEval, errors };
  }, [proposal, relations, visibleNodes]);

  const requestSuggestion = async () => {
    if (!onSuggestRelations || !nlInput.trim() || nlBusy) return;
    setNlBusy(true);
    setNlError('');
    setProposal(null);
    try {
      const next = await onSuggestRelations(nlInput.trim());
      setProposal(next);
    } catch (cause) {
      setNlError(errorMessage(cause));
    } finally {
      setNlBusy(false);
    }
  };

  const confirmProposal = () => {
    if (!proposal || !onApplySuggestion || proposalCheck?.errors.length) return;
    const applyError = onApplySuggestion(proposal);
    if (applyError) {
      setNlError(applyError);
      return;
    }
    setProposal(null);
    setNlInput('');
    setNlError('');
  };

  useEffect(() => {
    if (!editingId && selectedNode && !visibleNodes.some((n) => n.id === targetId)) {
      setTargetId(selectedNode.id);
    }
  }, [editingId, selectedNode, targetId, visibleNodes]);

  const startEdit = (rel: SceneRelation) => {
    setEditingId(rel.id);
    setKind(rel.kind);
    setFormError('');
    setManualOpen(true);
    if (rel.kind === 'expr') {
      setTargetId(rel.targetId);
      setTargetProperty(rel.targetProperty);
      setExpression(rel.expression);
      setFormatTemplate(rel.formatTemplate ?? '{value}');
      setPrecision(rel.precision ?? 2);
    } else if (rel.kind === 'basis_decompose') {
      setFirstId(rel.firstId);
      setSecondId(rel.secondId);
      setResultId(rel.resultId);
      setLabelId(rel.labelId ?? '');
      setLabelTemplate(rel.labelTemplate ?? '斜基：坐标 ({a}, {b})');
    } else if (rel.kind === 'linear_combo') {
      setFirstId(rel.firstId);
      setSecondId(rel.secondId);
      setTargetId(rel.targetId);
      setCoeffA(String(rel.a));
      setCoeffB(String(rel.b));
    } else if (rel.kind === 'guide_bind') {
      setTargetId(rel.targetId);
      setFromNodeId(rel.from.nodeId);
      setFromAnchor(rel.from.anchor);
      setToNodeId(rel.to.nodeId);
      setToAnchor(rel.to.anchor);
    }
  };

  const resetForm = () => {
    setEditingId(null);
    setFormError('');
  };

  const toggleEnabled = (id: string, enabled: boolean) => {
    if (!onChange) return;
    const next = relations.map((r) => (r.id === id ? { ...r, enabled } : r));
    onChange(next, `relations.toggle.${id}`);
  };

  const removeRelation = (id: string) => {
    if (!onChange) return;
    const next = relations.filter((r) => r.id !== id);
    if (editingId === id) resetForm();
    onChange(next, `relations.delete.${id}`);
  };

  const buildCandidate = (): SceneRelation => {
    const id = editingId ?? `rel_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    if (kind === 'basis_decompose') {
      return {
        id,
        kind: 'basis_decompose',
        enabled: true,
        provenance: 'user',
        firstId,
        secondId,
        resultId,
        ...(labelId ? { labelId } : {}),
        ...(labelTemplate.trim() ? { labelTemplate: labelTemplate.trim() } : {}),
      };
    }
    if (kind === 'linear_combo') {
      return {
        id,
        kind: 'linear_combo',
        enabled: true,
        provenance: 'user',
        firstId,
        secondId,
        targetId,
        a: parseCoeffInput(coeffA),
        b: parseCoeffInput(coeffB),
      };
    }
    if (kind === 'guide_bind') {
      return {
        id,
        kind: 'guide_bind',
        enabled: true,
        provenance: 'user',
        targetId,
        from: { nodeId: fromNodeId, anchor: fromAnchor },
        to: { nodeId: toNodeId, anchor: toAnchor },
      };
    }
    return {
      id,
      kind: 'expr',
      enabled: true,
      provenance: 'user',
      targetId,
      targetProperty,
      expression: expression.trim(),
      ...(targetProperty === 'text' && formatTemplate.trim() ? { formatTemplate: formatTemplate.trim() } : {}),
      precision,
    };
  };

  const submitForm = () => {
    if (!onChange) return;
    const candidate = buildCandidate();
    const validationErr = validateRelation(candidate, visibleNodes);
    if (validationErr) {
      setFormError(validationErr);
      return;
    }
    const next = editingId
      ? relations.map((r) => (r.id === editingId ? candidate : r))
      : [...relations, candidate];
    const cycles = detectRelationCycles(next);
    if (cycles.has(candidate.id) || cycles.size > 0) {
      setFormError('关系之间存在循环依赖，请检查引用链');
      return;
    }
    setFormError('');
    setEditingId(null);
    onChange(next, `relations.save.${candidate.id}`);
  };

  return (
    <section aria-label="页面动态关系">
      <h3>动态关系 ({relations.length})</h3>
      <p className={styles.hint}>
        让对象之间产生联动：拖动一个对象，另一个对象实时跟随更新，分享页与离线网页中同样生效。
      </p>

      {onSuggestRelations && (
        <div
          aria-label="自然语言生成动态关系"
          style={{
            border: '1px solid #d5ccb9',
            borderRadius: 6,
            padding: 8,
            margin: '8px 0',
            background: '#fdfbf7',
          }}
        >
          <label className={styles.fullField}>
            用一句话添加动态关系
            <textarea
              aria-label="自然语言关系指令"
              rows={2}
              placeholder="例如：让 b2 可拖动终点并实时显示 v 的坐标，或让文字显示向量长度"
              value={nlInput}
              disabled={disabled || nlBusy}
              onChange={(e) => {
                setNlInput(e.target.value);
                setNlError('');
              }}
            />
          </label>
          <div className={styles.objectButtons} style={{ marginTop: 6 }}>
            <button
              type="button"
              disabled={disabled || nlBusy}
              onClick={() => setNlInput('让斜基向量终点可拖动，并实时显示合向量在当前基下的坐标')}
            >
              示例：换基拖动联动
            </button>
            <button
              type="button"
              disabled={disabled || nlBusy}
              onClick={() => setNlInput('让文字节点实时显示选中向量的长度（四舍五入）')}
            >
              示例：文字显示线长
            </button>
          </div>
          <div className={styles.interactionActions} style={{ marginTop: 6 }}>
            <button
              type="button"
              className={styles.applyButton}
              disabled={disabled || nlBusy || !nlInput.trim()}
              onClick={() => void requestSuggestion()}
            >
              {nlBusy ? '正在生成关系预览…' : '生成关系预览'}
            </button>
          </div>
          {nlError && (
            <p role="alert" style={{ color: '#b42318', fontSize: 12, margin: '6px 0 0' }}>
              {nlError}
            </p>
          )}

          {proposal && proposalCheck && (
            <div
              aria-label="动态关系预览确认"
              data-nl-relation-preview
              style={{
                marginTop: 8,
                padding: 8,
                borderRadius: 6,
                border: '1px solid #9ec5e8',
                background: '#f2f8fd',
                fontSize: 12,
              }}
            >
              <strong>提案预览：{proposal.summary}</strong>
              <ul style={{ margin: '6px 0', paddingLeft: 16 }}>
                {proposal.relations.map((rel) => {
                  const diag = proposalCheck.previewEval.diagnostics[rel.id];
                  const statusLabel =
                    diag?.status === 'ok'
                      ? '试算正常'
                      : diag?.status === 'degenerate'
                        ? '斜基退化'
                        : '校验异常';
                  return (
                    <li key={rel.id} data-preview-relation-id={rel.id}>
                      <span>{summarizeRelation(rel)}</span>{' '}
                      <strong data-preview-relation-status={diag?.status ?? 'error'}>
                        [{statusLabel}]
                      </strong>
                    </li>
                  );
                })}
              </ul>
              {proposal.viewer_updates.length > 0 && (
                <div style={{ margin: '6px 0', color: '#2f3a49' }}>
                  <span>观众权限调整：</span>
                  {proposal.viewer_updates.map((u) => (
                    <div key={u.nodeId} data-preview-viewer-update={u.nodeId}>
                      {nodeLabel(u.nodeId)}：
                      {u.viewer_editable === false ? '只读' : '允许观众操作'}
                      {u.viewer_parameters?.length
                        ? `（${u.viewer_parameters.map((p) => VIEWER_PARAM_LABELS[p] ?? p).join('、')}）`
                        : ''}
                    </div>
                  ))}
                </div>
              )}
              {proposalCheck.errors.length > 0 && (
                <p role="alert" style={{ color: '#b42318', margin: '4px 0' }}>
                  {proposalCheck.errors.join('；')}
                </p>
              )}
              <div className={styles.interactionActions} style={{ marginTop: 6 }}>
                <button
                  type="button"
                  className={styles.applyButton}
                  disabled={disabled || !onApplySuggestion || proposalCheck.errors.length > 0}
                  onClick={confirmProposal}
                >
                  确认应用
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    setProposal(null);
                    setNlError('');
                  }}
                >
                  取消预览
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {relations.length > 0 ? (
        <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0', display: 'grid', gap: 6 }}>
          {relations.map((rel) => {
            const diag = evaluation.diagnostics[rel.id];
            const statusText =
              rel.enabled === false
                ? '已停用'
                : diag?.status === 'ok'
                  ? '联动正常'
                  : diag?.status === 'degenerate'
                    ? '斜基退化'
                    : diag?.status === 'cycle'
                      ? '循环依赖'
                      : '配置错误';
            return (
              <li
                key={rel.id}
                data-relation-id={rel.id}
                style={{
                  border: '1px solid #d5ccb9',
                  borderRadius: 6,
                  padding: '6px 8px',
                  background: '#faf8f5',
                  fontSize: 12,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontWeight: 600 }}>
                    <input
                      type="checkbox"
                      aria-label={`启用关系 ${rel.id}`}
                      checked={rel.enabled !== false}
                      disabled={disabled}
                      onChange={(e) => toggleEnabled(rel.id, e.target.checked)}
                    />
                    <span>{rel.provenance === 'auto' ? '自动识别' : '自定义'}</span>
                  </label>
                  <span data-relation-status={diag?.status ?? 'ok'}>{statusText}</span>
                </div>
                <div style={{ margin: '4px 0', color: '#2f3a49', wordBreak: 'break-all' }}>
                  {summarizeRelation(rel)}
                </div>
                {diag?.message && (
                  <p role="status" style={{ margin: '2px 0', color: '#b42318', fontSize: 11 }}>
                    {diag.message}
                  </p>
                )}
                <div className={styles.objectButtons} style={{ marginTop: 4 }}>
                  <button type="button" disabled={disabled} onClick={() => startEdit(rel)}>
                    编辑
                  </button>
                  <button
                    type="button"
                    className={styles.danger}
                    aria-label={`删除关系 ${rel.id}`}
                    disabled={disabled}
                    onClick={() => removeRelation(rel.id)}
                  >
                    删除
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className={styles.hint}>当前页面暂无动态关系。</p>
      )}

      <details
        aria-label="新增或编辑动态关系"
        open={manualOpen}
        onToggle={(e) => setManualOpen(e.currentTarget.open)}
        style={{ borderTop: '1px solid #e6dfd3', paddingTop: 8, marginTop: 8 }}
      >
        <summary style={{ cursor: 'pointer', color: '#7f7691', fontSize: 11, padding: '2px 0' }}>
          {editingId ? `编辑关系 (${editingId})` : '高级：手动绑定表达式'}
        </summary>
        <div className={styles.numberGrid}>
          <label className={styles.fullField}>
            关系类型
            <select
              aria-label="关系类型"
              value={kind}
              disabled={disabled}
              onChange={(e) => {
                setKind(e.target.value as SceneRelation['kind']);
                setFormError('');
              }}
            >
              <option value="expr">属性表达式绑定 (expr)</option>
              <option value="basis_decompose">换基坐标分解 (basis_decompose)</option>
              <option value="linear_combo">向量线性组合 (linear_combo)</option>
              <option value="guide_bind">辅助线端点跟随 (guide_bind)</option>
            </select>
          </label>

          {kind === 'expr' && (
            <>
              <label>
                目标对象
                <select
                  aria-label="关系目标对象"
                  value={targetId}
                  disabled={disabled}
                  onChange={(e) => setTargetId(e.target.value)}
                >
                  <option value="">请选择对象</option>
                  {visibleNodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {nodeLabel(n.id)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                目标属性
                <select
                  aria-label="关系目标属性"
                  value={targetProperty}
                  disabled={disabled}
                  onChange={(e) => setTargetProperty(e.target.value as RelationTargetProperty)}
                >
                  {RELATION_TARGET_PROPERTIES.map((prop) => (
                    <option key={prop} value={prop}>
                      {TARGET_PROP_LABELS[prop]}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.fullField}>
                计算表达式
                <input
                  type="text"
                  aria-label="关系计算表达式"
                  placeholder="例如：round(b2.length * 2)"
                  value={expression}
                  disabled={disabled}
                  onChange={(e) => {
                    setExpression(e.target.value);
                    setFormError('');
                  }}
                />
              </label>
              {targetProperty === 'text' && (
                <>
                  <label>
                    文字格式模板
                    <input
                      type="text"
                      aria-label="文字格式模板"
                      placeholder="例如：长度：{value}"
                      value={formatTemplate}
                      disabled={disabled}
                      onChange={(e) => setFormatTemplate(e.target.value)}
                    />
                  </label>
                  <label>
                    小数位数
                    <input
                      type="number"
                      aria-label="小数位数"
                      min={0}
                      max={6}
                      value={precision}
                      disabled={disabled}
                      onChange={(e) => setPrecision(Math.max(0, Math.min(6, Number(e.target.value) || 0)))}
                    />
                  </label>
                </>
              )}
            </>
          )}

          {kind === 'basis_decompose' && (
            <>
              <label>
                基向量 b₁
                <select
                  aria-label="关系基向量 b₁"
                  value={firstId}
                  disabled={disabled}
                  onChange={(e) => setFirstId(e.target.value)}
                >
                  <option value="">请选择向量</option>
                  {vectors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {nodeLabel(v.id)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                可动基向量 b₂
                <select
                  aria-label="关系可动基向量 b₂"
                  value={secondId}
                  disabled={disabled}
                  onChange={(e) => setSecondId(e.target.value)}
                >
                  <option value="">请选择向量</option>
                  {vectors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {nodeLabel(v.id)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                合向量 v
                <select
                  aria-label="关系合向量 v"
                  value={resultId}
                  disabled={disabled}
                  onChange={(e) => setResultId(e.target.value)}
                >
                  <option value="">请选择向量</option>
                  {vectors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {nodeLabel(v.id)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                绑定坐标文字
                <select
                  aria-label="绑定坐标文字节点"
                  value={labelId}
                  disabled={disabled}
                  onChange={(e) => setLabelId(e.target.value)}
                >
                  <option value="">悬浮标签（默认）</option>
                  {textNodes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {nodeLabel(t.id)}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.fullField}>
                坐标文案模板
                <input
                  type="text"
                  aria-label="坐标文案模板"
                  value={labelTemplate}
                  disabled={disabled}
                  onChange={(e) => setLabelTemplate(e.target.value)}
                />
              </label>
            </>
          )}

          {kind === 'linear_combo' && (
            <>
              <label>
                基向量 b₁
                <select
                  aria-label="线性组合基向量 b₁"
                  value={firstId}
                  disabled={disabled}
                  onChange={(e) => setFirstId(e.target.value)}
                >
                  <option value="">请选择向量</option>
                  {vectors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {nodeLabel(v.id)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                基向量 b₂
                <select
                  aria-label="线性组合基向量 b₂"
                  value={secondId}
                  disabled={disabled}
                  onChange={(e) => setSecondId(e.target.value)}
                >
                  <option value="">请选择向量</option>
                  {vectors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {nodeLabel(v.id)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                合成目标向量
                <select
                  aria-label="线性组合目标向量"
                  value={targetId}
                  disabled={disabled}
                  onChange={(e) => setTargetId(e.target.value)}
                >
                  <option value="">请选择向量</option>
                  {vectors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {nodeLabel(v.id)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                系数 a
                <input
                  type="text"
                  aria-label="线性组合系数 a"
                  value={coeffA}
                  disabled={disabled}
                  onChange={(e) => setCoeffA(e.target.value)}
                />
              </label>
              <label>
                系数 b
                <input
                  type="text"
                  aria-label="线性组合系数 b"
                  value={coeffB}
                  disabled={disabled}
                  onChange={(e) => setCoeffB(e.target.value)}
                />
              </label>
            </>
          )}

          {kind === 'guide_bind' && (
            <>
              <label className={styles.fullField}>
                目标辅助线
                <select
                  aria-label="目标辅助线"
                  value={targetId}
                  disabled={disabled}
                  onChange={(e) => setTargetId(e.target.value)}
                >
                  <option value="">请选择线条</option>
                  {vectors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {nodeLabel(v.id)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                起点跟随对象
                <select
                  aria-label="起点跟随对象"
                  value={fromNodeId}
                  disabled={disabled}
                  onChange={(e) => setFromNodeId(e.target.value)}
                >
                  <option value="">请选择对象</option>
                  {vectors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {nodeLabel(v.id)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                起点锚点
                <select
                  aria-label="起点锚点"
                  value={fromAnchor}
                  disabled={disabled}
                  onChange={(e) => setFromAnchor(e.target.value as GuideAnchor)}
                >
                  {(['start', 'end', 'center'] as const).map((a) => (
                    <option key={a} value={a}>
                      {ANCHOR_LABELS[a]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                终点跟随对象
                <select
                  aria-label="终点跟随对象"
                  value={toNodeId}
                  disabled={disabled}
                  onChange={(e) => setToNodeId(e.target.value)}
                >
                  <option value="">请选择对象</option>
                  {vectors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {nodeLabel(v.id)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                终点锚点
                <select
                  aria-label="终点锚点"
                  value={toAnchor}
                  disabled={disabled}
                  onChange={(e) => setToAnchor(e.target.value as GuideAnchor)}
                >
                  {(['start', 'end', 'center'] as const).map((a) => (
                    <option key={a} value={a}>
                      {ANCHOR_LABELS[a]}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
        </div>

        {formError && (
          <p role="alert" style={{ color: '#b42318', fontSize: 12, margin: '6px 0' }}>
            {formError}
          </p>
        )}

        <div className={styles.interactionActions} style={{ marginTop: 8 }}>
          <button
            type="button"
            className={styles.applyButton}
            disabled={disabled || !onChange}
            onClick={submitForm}
          >
            {editingId ? '保存关系' : '添加关系'}
          </button>
          {editingId && (
            <button type="button" disabled={disabled} onClick={resetForm}>
              取消编辑
            </button>
          )}
        </div>
      </details>
    </section>
  );
}
