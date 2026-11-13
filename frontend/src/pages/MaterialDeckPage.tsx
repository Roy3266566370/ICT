import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage } from '@/api/client';
import { fetchSession } from '@/api/hooks';
import { useScopedQueryKeys } from '@/api/queryKeys';
import { readEmbeddedSpecs } from '@/components/reader/specData';
import { DeckPlayer } from '@/components/presentation/DeckPlayer';
import { getPptAiActive } from '@/api/pptAI';
import { fromActive } from '@/ppt-ai/runtime/snapshot';

export default function MaterialDeckPage() {
  const {materialId = ''} = useParams();
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
  const specs = readEmbeddedSpecs(detail);
  const pages = Array.from({length: detail.material.page_count}, (_, index) => detail.slides.find(p => p.page_no === index + 1) ??
    {page_no: index + 1, title: `第 ${index + 1} 页`, image_url: null});
  return <DeckPlayer key={materialId} title={detail.material.title} pages={pages} specs={specs}
    identity={`${materialId}.r${detail.edit_revision ?? 0}`} materialId={materialId} fidelity={detail.render?.fidelity}
    onRefresh={() => query.refetch()}
    sceneDocument={detail.scene_document}
    aiSnapshot={aiQuery.isSuccess ? fromActive(aiQuery.data) : null}/>;
}
