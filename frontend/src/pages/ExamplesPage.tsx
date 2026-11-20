import { Navigate, useSearchParams } from 'react-router-dom';

/** 交互示例已迁入题目实验室的通用示例区（并移除办公示例）；保留旧入口自动跳转。 */
export function ExamplesPage(): JSX.Element {
  const [searchParams] = useSearchParams();
  const raw = searchParams.get('lab');
  const query = raw === 'math' || raw === 'computer' || raw === 'physics' ? `?example=${raw}` : '';
  return <Navigate to={`/labs${query}#lab-samples-title`} replace />;
}

export default ExamplesPage;
