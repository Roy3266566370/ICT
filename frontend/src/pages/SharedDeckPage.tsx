import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { api, errorMessage } from '@/api/client';
import { DeckPlayer } from '@/components/presentation/DeckPlayer';
import { validateISpecLite, type ISpec } from '@/ispec/types';
import { fromFrozen } from '@/ppt-ai/runtime/snapshot';

export default function SharedDeckPage() {
  const {shareId = ''} = useParams();
  const query = useQuery({queryKey: ['public-deck', shareId], queryFn: () => api.getShare(shareId), retry: false});
  if (query.isPending) return <div className="page-container" role="status">正在打开交互演示网页…</div>;
  if (query.isError) return <div className="page-container" role="alert"><h1>无法打开演示网页</h1><p>{errorMessage(query.error)}</p></div>;
  const snapshot = query.data;
  const specs = snapshot.ispecs.filter((spec): spec is ISpec => validateISpecLite(spec).length === 0);
  const pages = snapshot.pages.length === snapshot.page_count ? snapshot.pages :
    Array.from({length: snapshot.page_count}, (_, index) => snapshot.pages.find(p => p.page_no === index + 1) ??
      {page_no: index + 1, image_url: null});
  return <DeckPlayer title={snapshot.title} pages={pages} specs={specs} identity={`share.${shareId}`}
    sceneDocument={snapshot.scene_document} aiSnapshot={fromFrozen(snapshot.ppt_ai)}/>;
}
