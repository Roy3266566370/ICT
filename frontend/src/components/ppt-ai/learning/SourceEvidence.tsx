import type { LearningSourceRef } from '@/ppt-ai/learning/types';
import styles from './LearningPanel.module.css';

interface Props {
  refs: LearningSourceRef[];
  pageImageUrl?: string;
  onLocate?: (source: LearningSourceRef) => void;
}

const ORIGIN_LABEL: Record<string, string> = {
  native: '原稿直接提取',
  ocr: 'OCR 识别',
  model_inference: '系统推断，请核对',
  user_input: '用户输入',
  supplement: '补充条件',
  teaching: '教学探针',
};

export function SourceEvidence({ refs, pageImageUrl, onLocate }: Props) {
  if (!refs.length) return null;
  return (
    <section className={styles.evidence} aria-label="原稿依据">
      <h4>原稿依据</h4>
      {refs.slice(0, 6).map((source, index) => (
        <div className={styles.evidenceItem} key={`${source.page_no}-${source.element_id ?? index}`}>
          {pageImageUrl ? (
            <button type="button" className={styles.sourceThumb} onClick={() => onLocate?.(source)}
              aria-label={`定位第 ${source.page_no} 页的原稿区域`}>
              <img src={pageImageUrl} alt="" draggable={false}/>
              <span style={{
                left: `${source.bbox.x * 100}%`,
                top: `${source.bbox.y * 100}%`,
                width: `${source.bbox.w * 100}%`,
                height: `${source.bbox.h * 100}%`,
              }}/>
            </button>
          ) : null}
          <div className={styles.evidenceText}>
            <span className={styles.originTag} data-origin={source.origin_type}>
              {ORIGIN_LABEL[source.origin_type] ?? source.origin_type}
            </span>
            <blockquote>{source.excerpt || `第 ${source.page_no} 页区域`}</blockquote>
            {onLocate ? (
              <button type="button" className={styles.linkButton} onClick={() => onLocate(source)}>
                在原页定位 ↗
              </button>
            ) : null}
          </div>
        </div>
      ))}
    </section>
  );
}

export default SourceEvidence;
