/**
 * AiComposeModal.tsx —— 「✨ AI 搭实验 / 连线」编排工作台弹窗
 *
 * 支持双模式：
 *  - 一句话搭整套实验（compose）：自动挑选真内核内置积木并全部连好线；
 *  - 帮当前画布积木连线（wire_existing）：读取画布已有散落积木，按端口类型自动连成完整实验。
 */
import { useEffect, useMemo, useState } from 'react';
import { composeWorkshopCanvas } from '@/api/workshopAi';
import { errorMessage } from '@/api/client';
import {
  applyComposePlan,
  buildComposeCatalog,
  summarizeCanvasForCompose,
  type AiComposeMode,
  type AiComposePlan,
} from './aiCompose.ts';
import { createCanvasNode } from './createCanvasNode.ts';
import { NODE_DEFS, nodePorts } from './nodes.tsx';
import type { CanvasDoc, NodeType } from './types.ts';
import styles from './aiComposeModal.module.css';

interface AiComposeModalProps {
  open: boolean;
  doc: CanvasDoc;
  onClose: () => void;
  onApply: (nextDoc: CanvasDoc, summary: string) => void;
}

const COMPOSE_EXAMPLES = [
  { label: '弹簧振子 + 能量守恒', prompt: '搭一个弹簧振子实验，同时连接轨迹仪和能量表观察动能与势能转换' },
  { label: '微积分三连实验', prompt: '创建一个函数源 f(x)=sin(x)+0.3*x^2，分别连接函数图像、导数和定积分视图' },
  { label: '旋转矩阵向量场', prompt: '用时间源驱动旋转矩阵器，再连接到向量场和单位正方形视图观察实时旋转' },
  { label: '抛体运动监控台', prompt: '创建一个抛体实验，连接轨迹仪和能量表观察抛物线运动轨迹与能量变化' },
];

export function AiComposeModal({ open, doc, onClose, onApply }: AiComposeModalProps): JSX.Element | null {
  const canWireExisting = doc.nodes.filter((n) => n.type !== 'portIn' && n.type !== 'portOut').length >= 2;
  const [mode, setMode] = useState<AiComposeMode>(canWireExisting ? 'wire_existing' : 'compose');
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [plan, setPlan] = useState<AiComposePlan | null>(null);

  useEffect(() => {
    if (!open) return;
    setError('');
    setPlan(null);
    setMode(canWireExisting && doc.wires.length === 0 ? 'wire_existing' : 'compose');
  }, [open, canWireExisting, doc.wires.length]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !loading) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, loading, onClose]);

  const catalog = useMemo(() => buildComposeCatalog(NODE_DEFS), []);

  if (!open) return null;

  const previewResult = plan
    ? applyComposePlan(doc, plan, NODE_DEFS, nodePorts, createCanvasNode)
    : null;

  const handleGenerate = async (): Promise<void> => {
    const cleanPrompt = prompt.trim();
    if (mode === 'compose' && cleanPrompt.length < 2) {
      setError('请先描述你想搭建的实验（或点击下方示例）');
      return;
    }
    if (mode === 'wire_existing' && !canWireExisting) {
      setError('当前画布至少需要 2 个积木才能自动连线，请先切到「一句话搭整套实验」');
      return;
    }
    setLoading(true);
    setError('');
    setPlan(null);
    try {
      const { existing_nodes, existing_wires } = summarizeCanvasForCompose(doc, NODE_DEFS, nodePorts);
      const nextPlan = await composeWorkshopCanvas({
        prompt: cleanPrompt || '将当前画布上尚未连接的积木按端口类型合理连接成完整可运行的实验',
        mode,
        catalog,
        existing_nodes,
        existing_wires,
      });
      setPlan(nextPlan);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleApply = (): void => {
    if (!plan || !previewResult) return;
    if (previewResult.addedNodeIds.length === 0 && previewResult.addedWireCount === 0) {
      setError('该方案未产生可兼容的新增积木或新连线，请调整描述后重新生成');
      return;
    }
    onApply(previewResult.doc, `${plan.title}（+${previewResult.addedNodeIds.length} 积木，+${previewResult.addedWireCount} 连线）`);
    onClose();
  };

  const resolvePlanNodeLabel = (refOrId: string): string => {
    const added = plan?.add_nodes.find((n) => n.ref === refOrId);
    if (added) {
      return added.label || NODE_DEFS[added.type as NodeType]?.title || added.type;
    }
    const existing = doc.nodes.find((n) => n.id === refOrId);
    if (existing) {
      return (existing.text && !existing.text.includes('\n') ? existing.text.trim().slice(0, 20) : '')
        || NODE_DEFS[existing.type]?.title
        || existing.type;
    }
    return refOrId;
  };

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-labelledby="ai-compose-title">
      <div className={styles.modal}>
        <header className={styles.head}>
          <div>
            <h2 id="ai-compose-title" className={styles.title}>✨ AI 自动搭实验 &amp; 智能连线</h2>
            <p className={styles.sub}>AI 根据端口类型自动挑选内置真内核积木并完成连线，应用后支持 Ctrl+Z 一键撤销。</p>
          </div>
          <button type="button" className={styles.closeBtn} aria-label="关闭" onClick={onClose} disabled={loading}>×</button>
        </header>

        <div className={styles.modeRow} role="tablist" aria-label="编排模式">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'compose'}
            className={styles.modeBtn}
            onClick={() => { setMode('compose'); setError(''); }}
          >
            ✨ 一句话搭整套实验
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'wire_existing'}
            className={styles.modeBtn}
            onClick={() => { setMode('wire_existing'); setError(''); }}
          >
            🔗 帮当前画布积木连线（现有 {doc.nodes.length} 块）
          </button>
        </div>

        <div className={styles.body}>
          <label className={styles.field}>
            <span className={styles.label}>
              {mode === 'compose' ? '想搭什么实验？' : '连线目标补充说明（选填，留空则自动按端口连接）'}
            </span>
            <textarea
              className={styles.textarea}
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={mode === 'compose'
                ? '例如：帮我搭一个弹簧振子实验，同时连接轨迹仪和能量表观察机械能守恒'
                : '例如：把滑杆接到旋转矩阵器，再输出到向量场视图'}
            />
          </label>

          {mode === 'compose' ? (
            <div className={styles.examples}>
              <span className={styles.exampleLabel}>试试直接点：</span>
              {COMPOSE_EXAMPLES.map((ex) => (
                <button
                  key={ex.label}
                  type="button"
                  className={styles.exampleChip}
                  onClick={() => { setPrompt(ex.prompt); setError(''); }}
                >
                  {ex.label}
                </button>
              ))}
            </div>
          ) : null}

          {error ? <p className={styles.error} role="alert">{error}</p> : null}

          {plan && previewResult ? (
            <section className={styles.preview} aria-label="编排方案预览">
              <div className={styles.previewHead}>
                <strong>{plan.title}</strong>
                <span className={styles.badge}>
                  +{previewResult.addedNodeIds.length} 积木 · +{previewResult.addedWireCount} 连线
                  {previewResult.skippedWireCount > 0 ? `（已过滤 ${previewResult.skippedWireCount} 条不兼容线）` : ''}
                </span>
              </div>
              <p className={styles.previewSummary}>{plan.summary}</p>
              {plan.add_nodes.length > 0 ? (
                <div className={styles.previewList}>
                  <span className={styles.previewTag}>新增积木：</span>
                  {plan.add_nodes.map((n) => (
                    <span key={n.ref} className={styles.nodePill}>
                      {n.label || NODE_DEFS[n.type as NodeType]?.title || n.type}
                    </span>
                  ))}
                </div>
              ) : null}
              {plan.wires.length > 0 ? (
                <ul className={styles.wireList}>
                  {plan.wires.map((w, idx) => (
                    <li key={`${w.from}-${w.to}-${idx}`}>
                      {resolvePlanNodeLabel(w.from)} <code>.{w.fromPort}</code> → {resolvePlanNodeLabel(w.to)} <code>.{w.toPort}</code>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}
        </div>

        <footer className={styles.foot}>
          <button type="button" className={styles.ghostBtn} onClick={onClose} disabled={loading}>
            取消
          </button>
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={() => void handleGenerate()}
            disabled={loading}
          >
            {loading ? 'AI 正在规划积木与连线…' : (plan ? '重新生成方案' : '✨ 生成编排方案')}
          </button>
          <button
            type="button"
            className={styles.primaryBtn}
            onClick={handleApply}
            disabled={loading || !plan}
          >
            一键应用到画布
          </button>
        </footer>
      </div>
    </div>
  );
}
