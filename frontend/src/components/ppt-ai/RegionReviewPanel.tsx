import type { InteractionPlan } from '@/ppt-ai/types';
import styles from './PptAiPanels.module.css';

interface Props {
  plan: InteractionPlan;
  onRetryRegion: (regionId: string, label: string) => void;
  busy: boolean;
}

const STATE_LABEL: Record<string, string> = {
  native: '原生已读取',
  ocr: 'OCR 已读取',
  visual: '需视觉理解',
  manual_review: '需人工核对',
  skipped: '已跳过',
};

const CATEGORY_LABEL: Record<string, string> = {
  chart: '原生图表',
  table: '原生表格',
  formula: '公式',
  matrix: '矩阵',
  algorithm: '算法流程',
  optimization: '优化过程',
  network: '网络结构',
  image: '图片',
  diagram: '图形',
  text: '文字',
};

export function RegionReviewPanel({ plan, onRetryRegion, busy }: Props) {
  const byPage = new Map<number, typeof plan.options>();
  plan.options.forEach((option) => {
    const list = byPage.get(option.source.page) ?? [];
    list.push(option);
    byPage.set(option.source.page, list);
  });
  return (
    <section className={styles.panel} aria-labelledby="ppt-ai-region-title">
      <header className={styles.panelHead}>
        <div>
          <h2 id="ppt-ai-region-title">区域核对</h2>
          <p>原生、OCR、视觉与人工核对分别登记；同页已有交互不会让其他区域被跳过。只重试一个区域不会重算整份材料。</p>
        </div>
        <span className={styles.badge}>{plan.options.length} 个区域</span>
      </header>
      <div className={styles.panelBody}>
        {plan.issues.map((issue) => (
          <p key={issue.code} className={styles.empty}>{issue.message}</p>
        ))}
        {[...byPage.entries()].sort(([a], [b]) => a - b).map(([page, options]) => (
          <div key={page}>
            <h3 className={styles.groupTitle}>第 {page} 页</h3>
            <ul className={styles.list}>
              {options.map((option) => (
                <li key={option.option_id} className={styles.listItem}>
                  <div>
                    <b>{option.title}</b>
                    <small>
                      {CATEGORY_LABEL[(option.provider as Record<string, unknown>).kind as string] ?? option.operator_id}
                      {' · '}{option.source.excerpt.slice(0, 80) || '无摘录'}
                    </small>
                    <small>
                      bbox {option.source.bbox.x.toFixed(3)}, {option.source.bbox.y.toFixed(3)} · {option.source.bbox.w.toFixed(3)}×{option.source.bbox.h.toFixed(3)}
                    </small>
                  </div>
                  <div className={styles.candidateActions}>
                    <button type="button" className={styles.button} disabled={busy}
                      onClick={() => onRetryRegion(option.region_id, option.title)}>重试</button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {plan.options.length === 0 ? (
          <p className={styles.empty}>当前没有区域方案。若材料已有原生图表/表格/公式，请确认上传解析是否完成。</p>
        ) : null}
        {plan.coverage.length > 0 ? (
          <details>
            <summary className={styles.groupTitle}>查看覆盖明细</summary>
            <ul className={styles.list} style={{ marginTop: 8 }}>
              {plan.coverage.map((entry) => (
                <li key={entry.page_no} className={styles.listItem}>
                  <div>
                    <b>第 {entry.page_no} 页</b>
                    <small>原生 {entry.native.length} · OCR {entry.ocr.length} · 视觉 {entry.visual.length} · 人工 {entry.manual_review.length} · 跳过 {entry.skipped.length}</small>
                  </div>
                  <span className={styles.badge}>{STATE_LABEL[entry.visual.length ? 'visual' : entry.ocr.length ? 'ocr' : 'native']}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </section>
  );
}

export default RegionReviewPanel;
