import { useParams } from 'react-router-dom';
import { PptAiWorkspace } from './PptAiWorkspace';

export default function PptAiPage() {
  const { materialId = '' } = useParams();
  if (!materialId) return <main className="page-container" role="alert">缺少材料编号。</main>;
  return <main className="page-container"><PptAiWorkspace materialId={materialId} /></main>;
}
