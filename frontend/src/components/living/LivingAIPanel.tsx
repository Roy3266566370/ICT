import { useEffect, useMemo, useRef, useState } from 'react';
import { getLivingAIStatus, type LivingAIRecommendations } from '@/api/living';
import { errorMessage } from '@/api/client';
import type { LivingPageDoc } from '@/living/types';
import { recommendationContentKey } from '@/living/recommendations';
import styles from './LivingBlocks.module.css';

interface Props {
  document: LivingPageDoc;
  initialBlockId?: string;
  onGenerate: (ids: string[], instruction: string, force: boolean, progress: (message: string) => void,
    designGoals?: Record<string, string>) => Promise<void>;
  onRecommend: (force: boolean) => Promise<LivingAIRecommendations>;
  onClose: () => void;
  onBusy: (busy: boolean) => void;
}

export function LivingAIPanel({ document, initialBlockId, onGenerate, onRecommend, onClose, onBusy }: Props) {
  const candidates = useMemo(() => {
    let heading = '';
    return document.blocks.flatMap((b) => {
      if (b.type === 'section') heading = b.data.heading;
      if (b.type !== 'text' || b.data.md.trim().length < 8) return [];
      const existing = document.blocks.find((model) => model.type === 'canvas' && model.data.doc.anchor_id === b.id);
      return [{ id: b.id, title: heading || b.data.md.slice(0, 40), text: b.data.md, existing }];
    });
  }, [document.blocks]);
  const [selected, setSelected] = useState<string[]>(initialBlockId ? [initialBlockId] : []);
  const existing = candidates.find((c) => c.id === initialBlockId)?.existing;
  const [instruction, setInstruction] = useState(String(existing?.type === 'canvas' ? existing.data.doc.instruction ?? '' : ''));
  const [search, setSearch] = useState('');
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState<{ available: boolean; model: string } | null>(null);
  const [analysis, setAnalysis] = useState<LivingAIRecommendations | null>(null);
  const [analysisContent, setAnalysisContent] = useState('');
  const content = useMemo(() => recommendationContentKey(document),
    [document.title, document.blocks]);
  const autoAnalyzed = useRef(false);
  useEffect(() => { let alive = true; getLivingAIStatus().then((s) => alive && setStatus(s)).catch((e) => alive && setError(errorMessage(e))); return () => { alive = false; }; }, []);
  const run = async () => {
    setBusy(true); onBusy(true); setError('');
    try { await onGenerate(selected, instruction, force, setProgress,
      Object.fromEntries((analysis?.recommendations ?? []).map((r) => [r.block_id, r.design_goal]))); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); onBusy(false); }
  };
  const recommend = async (refresh = false) => {
    setBusy(true); onBusy(true); setError('');
    setProgress('AI 正在浏览整份材料，挑选适合交互的知识点…');
    try {
      const result = await onRecommend(refresh);
      setAnalysis(result);
      setAnalysisContent(content);
      setSelected(result.recommendations.slice(0, 3).map((r) => r.block_id));
      setProgress(`已分析 ${result.reviewed_blocks} 段待激活内容，推荐 ${result.recommendations.length} 项，已选前 ${Math.min(3, result.recommendations.length)} 项。`);
    } catch (e) { setError(errorMessage(e)); setProgress('筛选未完成，可以重新分析。'); }
    finally { setBusy(false); onBusy(false); }
  };
  useEffect(() => {
    if (!initialBlockId && status?.available && !autoAnalyzed.current) {
      autoAnalyzed.current = true;
      void recommend();
    }
  }, [initialBlockId, status?.available]);
  useEffect(() => {
    if (analysis && analysisContent !== content) {
      setAnalysis(null); setSelected(initialBlockId ? [initialBlockId] : []);
      setProgress('材料内容已修改，请让 AI 重新挑选交互内容。');
    }
  }, [analysis, analysisContent, content, initialBlockId]);
  const toggle = (id: string, checked: boolean) => setSelected((current) => checked ? [...current, id] : current.filter((s) => s !== id));
  return <section className={styles.aiPanel} aria-label="AI 设计交互面板">
    <header><h2>让知识点变成可以操作的模型</h2><button type="button" disabled={busy} onClick={onClose}>收起</button></header>
    <p>先让 AI 从整份材料里挑选适合交互的知识点，再自主设计参数、图形和观察指标。</p>
    {status && !status.available ? <p role="alert">后端尚未配置可用模型，请设置 LLM_PROVIDER、LLM_BASE_URL、LLM_MODEL 和 LLM_API_KEY 后重启后端。</p> : null}
    <div className={styles.aiActions}><button type="button" disabled={busy || !status?.available} onClick={() => void recommend()}>
      {analysis ? 'AI 继续挑选未覆盖的内容' : 'AI 帮我挑选交互内容'}</button>
      {analysis ? <button type="button" disabled={busy} onClick={() => void recommend(true)}>重新分析</button> : null}</div>
    {analysis ? <div className={styles.aiRecommendations} aria-label="AI 推荐的交互内容">
      <p>{analysis.summary}</p>
      <p className={styles.aiMeta}>已有 {document.blocks.filter((b) => b.type === 'canvas' && b.data.doc.template === 'ai_model').length} 个 AI 模型 · {analysis.truncated_blocks ? `${analysis.truncated_blocks} 个长段按首尾摘要分析` : '已浏览全部候选文字段落'}</p>
      {analysis.recommendations.map((r, index) => <label key={r.block_id} className={styles.aiRecommendation}>
        <input type="checkbox" checked={selected.includes(r.block_id)} disabled={busy || (!selected.includes(r.block_id) && selected.length >= 3)}
          onChange={(e) => toggle(r.block_id, e.target.checked)} />
        <span><strong>{index + 1}. {r.title}{r.page ? ` · 第 ${r.page} 页` : ''}
          {candidates.find((c) => c.id === r.block_id)?.existing ? ' · 已生成' : ''}</strong>
          <small>{r.reason}</small><small><b>操作：</b>{r.interaction}</small><small><b>观察：</b>{r.observation}</small></span>
      </label>)}
      {!analysis.recommendations.length ? <p>AI 没有发现值得新增交互的内容。你仍可手动选择文字并描述设计目标。</p> : null}
    </div> : null}
    <details open={initialBlockId ? true : undefined}>
    <summary>手动选择其他内容（{candidates.length} 段）</summary>
    <label>查找知识点<input type="search" value={search} disabled={busy} onChange={(e) => setSearch(e.target.value)} placeholder="按小节、页码或内容查找" /></label>
    <div className={styles.aiChoices}>
      {candidates.filter((c) => `${c.title} ${c.text}`.toLowerCase().includes(search.toLowerCase())).map((c) => <label key={c.id}>
        <input type="checkbox" checked={selected.includes(c.id)} disabled={busy || (!selected.includes(c.id) && selected.length >= 3)}
          onChange={(e) => toggle(c.id, e.target.checked)} />
        <span><strong>{c.title}{c.existing ? ' · 已有 AI 模型' : ''}</strong><small>{c.text.replace(/\s+/g, ' ').slice(0, 150)}</small></span>
      </label>)}
      {!candidates.length ? <p>尚无可读取的文字，请先添加或修订文字内容。</p> : null}
    </div>
    </details>
    <label>希望怎样交互（可选）<textarea maxLength={1000} rows={3} disabled={busy} value={instruction}
      onChange={(e) => setInstruction(e.target.value)} placeholder="例如：用三个词的小例子，拖动温度比较注意力权重；或设计位置编码的频率对比实验。留空由 AI 决定。" /></label>
    <label className={styles.aiInline}><input type="checkbox" checked={force} disabled={busy} onChange={(e) => setForce(e.target.checked)} />重新设计已有模型</label>
    <div className={styles.aiActions}><button type="button" disabled={busy || !selected.length || !status?.available} onClick={() => void run()}>
      {busy ? 'AI 正在设计…' : selected.length ? `生成 ${selected.length} 个交互模型` : '选择内容后生成交互'}</button><span>已选 {selected.length}/3 · {status?.model || '正在检查模型服务…'}</span></div>
    {progress ? <p role="status">{progress}</p> : null}
    {error ? <p className={styles.aiError} role="alert">{error}</p> : null}
    <p className={styles.aiMeta}>筛选时发送各段文字摘要，生成时发送所选文字及相邻内容给已配置的模型服务。模型逐个保存，生成时请保持页面打开。</p>
  </section>;
}
