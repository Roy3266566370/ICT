import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage } from '@/api/client';
import { fetchSession } from '@/api/hooks';
import { useScopedQueryKeys } from '@/api/queryKeys';
import { readEmbeddedSpecs } from '@/components/reader/specData';
import { DeckPlayer } from '@/components/presentation/DeckPlayer';
import { getPptAiActive } from '@/api/pptAI';
import { fromActive } from '@/ppt-ai/runtime/snapshot';

const STAGE_TEXT: Record<string, string> = {
  queued: '正在排队准备转换…',
  parsing: '正在解析课件页面与图文结构…',
  rendering: '正在高清渲染幻灯片底图…',
  extracting: '底图已就绪，正在识别公式、图表与交互区域…',
};

export default function MaterialDeckPage() {
  const {materialId = ''} = useParams();
  const [previewEarly, setPreviewEarly] = useState(false);
  // 与 useMaterial / FreeDeckEditor 共用同一个带 scope 的键，避免命中旧账号缓存
  const keys = useScopedQueryKeys();
  const query = useQuery({queryKey: keys.material(materialId), queryFn: async () => {
    await fetchSession();
    return api.getMaterial(materialId);
  }, enabled: !!materialId, refetchOnMount: 'always', refetchInterval: state => {
    const detail = state.state.data;
    return detail && (detail.material.status === 'processing' ||
      (detail.job && !['awaiting_confirmation', 'ready', 'failed'].includes(detail.job.stage))) ? 2000 : false;
  }});
  const aiQuery = useQuery({
    queryKey: ['ppt-ai-active', materialId],
    queryFn: () => getPptAiActive(materialId),
    enabled: !!materialId && api.mode === 'http' && query.isSuccess,
    retry: false,
    staleTime: 15000,
  });
  if (query.isPending) return <div className="page-container" role="status">正在打开演示文稿…</div>;
  if (query.isError) return <div className="page-container" role="alert"><h1>演示文稿暂时无法打开</h1>
    <p>{errorMessage(query.error)}</p><button onClick={() => void query.refetch()}>重新载入</button> <Link to="/">返回首页</Link></div>;
  const detail = query.data;
  const hasRenderedSlides = detail.slides.length > 0 && detail.slides.some(s => Boolean(s.image_url));
  const isInDeckEdit = (detail.edit_revision ?? 0) > 0 && hasRenderedSlides;
  if (detail.material.status === 'processing' && !isInDeckEdit && !(previewEarly && hasRenderedSlides)) {
    const stage = detail.job?.stage ?? 'queued';
    const stageLabel = STAGE_TEXT[stage] ?? '正在转换演示文稿…';
    const pct = detail.job?.progress_pct ?? (stage === 'extracting' ? 65 : stage === 'rendering' ? 35 : 15);
    const renderedCount = detail.slides.filter(s => s.image_url).length;
    const totalCount = detail.material.page_count || detail.slides.length;
    return <div className="page-container" role="status">
      <h1>正在转换 PPTX</h1>
      <p>{stageLabel}</p>
      <div style={{maxWidth: 420, margin: '12px 0'}}>
        <div style={{height: 8, borderRadius: 999, background: '#e2e8f0', overflow: 'hidden'}}>
          <div style={{width: `${Math.min(100, Math.max(8, pct))}%`, height: '100%', background: '#c4622d', transition: 'width .35s ease'}} />
        </div>
        <p style={{fontSize: 13, color: '#64748b', marginTop: 6}}>
          当前阶段：{stage}（约 {pct}%）{totalCount > 0 ? ` · 已准备 ${renderedCount} / ${totalCount} 页` : ''}
        </p>
      </div>
      <p>原页和对象准备就绪后会自动打开演示文稿。</p>
      {hasRenderedSlides && <p style={{marginTop: 12}}>
        <button type="button" onClick={() => setPreviewEarly(true)}>
          底图已就绪，先进入阅读（后台继续识别交互）
        </button>
      </p>}
    </div>;
  }
  if (detail.material.status === 'failed') return <div className="page-container" role="alert">
    <h1>演示文稿转换失败</h1>
    <Link to="/living">返回上传</Link>
  </div>;
  const specs = readEmbeddedSpecs(detail);
  const pages = Array.from({length: detail.material.page_count}, (_, index) => detail.slides.find(p => p.page_no === index + 1) ??
    {page_no: index + 1, title: `第 ${index + 1} 页`, image_url: null});
  return <DeckPlayer key={materialId} title={detail.material.title} pages={pages} specs={specs}
    identity={`${materialId}.r${detail.edit_revision ?? 0}`} materialId={materialId} fidelity={detail.render?.fidelity}
    onRefresh={() => query.refetch()}
    sceneDocument={detail.scene_document}
    formulaReviews={detail.formula_reviews}
    aiSnapshot={aiQuery.isSuccess ? fromActive(aiQuery.data) : null}/>;
}
