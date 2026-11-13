import type { ISpec, SpecEvaluation } from '@/ispec/types';
import { formatNumberSmart } from '@/ispec/format';
import { TextSpecView } from '@/components/ispec/views/TextSpecView';
import styles from './ExperimentStage.module.css';

interface Props {
  spec: ISpec;
  values: Record<string, number | boolean | string>;
  evaluation: SpecEvaluation;
  pageNo: number;
  pageTitle?: string;
  originalImageUrl?: string;
  onClose: () => void;
}

function valueText(value: number | boolean | string | undefined, parameterId?: string): string {
  if (typeof value === 'number') return formatNumberSmart(value);
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (value === undefined) return '—';
  if (parameterId === 'steps_order') return value === 'A' ? '先转后拉' : value === 'B' ? '先拉后转' : String(value);
  if (parameterId === 'steps_shape') return value === 'rectangle' ? '矩形' : value === 'basis' ? '基向量' : String(value);
  const labels: Record<string, Record<string, string>> = {
    rank_case: {embed_3x2: '3×2 嵌入三维', project_2x3: '2×3 压成平面', plane_to_line: '压成直线'},
    det_case: {unit: '单位方格', scale: '横向纵向伸缩', shear: '剪切', projection: '压到横轴'},
    relation_case: {equivalent: '等价', similar: '相似', congruent: '合同'},
  };
  return labels[parameterId ?? '']?.[String(value)] ?? String(value);
}

export function OriginalComparison({ spec, values, evaluation, pageNo, pageTitle, originalImageUrl, onClose }: Props) {
  const sources = [...new Map(spec.parameters
    .filter(parameter => parameter.source.excerpt)
    .map(parameter => [parameter.source.excerpt, parameter.source])).values()];
  return <div className={styles.comparisonBackdrop} role="dialog" aria-modal="true" aria-label="原稿与当前条件对照" onClick={onClose}>
    <div className={styles.comparisonPanel} onClick={event => event.stopPropagation()}>
      <header><div><b>原稿对照</b><span>第 {pageNo} 页 · 原文条件与当前实验条件分栏显示</span></div>
        <button onClick={onClose} aria-label="关闭原稿对照">×</button></header>
      <div className={styles.comparisonGrid}>
        <section className={styles.comparisonColumn} aria-label="原稿条件">
          <h3>原稿</h3>
          {originalImageUrl ? <img src={originalImageUrl} alt={`第 ${pageNo} 页原稿`}/> : <p className={styles.railHint}>原页图片暂不可用。</p>}
          <p className={styles.comparisonCaption}>{pageTitle ?? `第 ${pageNo} 页`}</p>
          {sources.map((source, index) => <blockquote key={index}>
            <span>{source.status === 'original' ? '原文提取' : source.status === 'inferred' ? '系统推断，请核对' : source.status === 'confirmed' ? '用户确认' : '手工示例'}</span>
            <p>{source.excerpt}</p>
          </blockquote>)}
          {spec.scene?.condition_note && <p className={styles.railHint}>{String(spec.scene.condition_note)}</p>}
        </section>
        <section className={styles.comparisonColumn} aria-label="当前实验条件">
          <h3>当前实验</h3>
          <dl className={styles.currentGrid}>{spec.parameters.map(parameter => <div key={parameter.id}>
            <dt>{parameter.label}</dt><dd>{valueText(values[parameter.id] ?? parameter.default, parameter.id)}</dd>
          </div>)}</dl>
          {Object.keys(evaluation.derived).length > 0 && <div className={styles.derivedBox}><h4>当前结果</h4>
            <dl className={styles.currentGrid}>{Object.entries(evaluation.derived).map(([key, value]) => <div key={key}>
              <dt>{spec.expressions?.find(expression => expression.id === key)?.label ?? key}</dt><dd>{valueText(value)}</dd>
            </div>)}</dl>
          </div>}
          {spec.views.filter(view => view.type === 'text').map((view, index) => view.type === 'text'
            ? <TextSpecView key={index} view={view} evaluation={evaluation} changed={false}/> : null)}
          {evaluation.violations.length > 0 && <div className={styles.errorBox}>{evaluation.violations.map((item, index) => <p key={index}>{item.message}</p>)}</div>}
          <p className={styles.railHint}>右侧为实时计算的当前条件；左侧原稿文字不会叠加到当前图形上。</p>
        </section>
      </div>
    </div>
  </div>;
}
