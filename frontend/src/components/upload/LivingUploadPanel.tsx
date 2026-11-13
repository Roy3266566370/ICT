/** 首页上传对话框的活页版：文件 → POST /pages → 活页编辑器。
 *
 * 与原 UploadPanel（PPT 管线）解耦：活页上传是同步接口，无需任务轮询。
 */

import { useRef, useState, type DragEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { createLivingPage } from '@/api/living';
import { errorMessage } from '@/api/client';
import styles from './UploadPanel.module.css';

const ACCEPT = '.pdf,.pptx,.png,.jpg,.jpeg,.webp,.txt,.md,.csv';
const MAX_BYTES = 70 * 1024 * 1024;

export function LivingUploadPanel(): JSX.Element {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (files: FileList | File[] | null): Promise<void> => {
    const list = files ? [...files] : [];
    if (!list.length) return;
    const oversize = list.find((f) => f.size > MAX_BYTES);
    if (oversize) {
      setError(`「${oversize.name}」超过 70MB 上限`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const doc = await createLivingPage({ files: list });
      navigate(`/living/${doc.page_id}`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  const onDrop = (event: DragEvent): void => {
    event.preventDefault();
    setDragging(false);
    void submit(event.dataTransfer.files);
  };

  return (
    <section className={`${styles.panel} studio-scope`} aria-labelledby="living-upload-title">
      <header className={styles.head}>
        <div className={styles.headText}>
          <h2 className={styles.title} id="living-upload-title">
            上传材料，生成活页
          </h2>
          <p className={styles.lead}>
            PDF / PPTX / 图片 / 文本——PDF 最多 100 页，保留原页图示与公式，确认建议后再激活交互。
          </p>
        </div>
      </header>

      <div
        className={styles.body}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <div className={styles.dropArea}>
          <button
            type="button"
            className={styles.railTitle}
            style={{
              display: 'block',
              width: '100%',
              padding: '2.5rem 1rem',
              border: `2px dashed ${dragging ? 'var(--color-coral)' : 'var(--hairline-strong)'}`,
              borderRadius: 'var(--radius-xl)',
              background: 'var(--paper-1)',
              cursor: 'pointer',
              fontSize: '1rem',
            }}
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? '正在解析…' : '点击选择或拖入文件'}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            multiple
            hidden
            onChange={(e) => {
              void submit(e.target.files);
              e.target.value = '';
            }}
          />
          {error ? (
            <p role="alert" style={{ color: 'var(--color-coral-ink)', marginTop: '0.75rem' }}>
              {error}
            </p>
          ) : null}
        </div>

        <aside className={styles.rail} aria-label="上传后的处理说明">
          <p className={styles.railTitle}>放进来之后</p>
          <ol className={styles.railList}>
            <li>
              <span className={styles.railIndex}>01</span>
              <span className={styles.railBody}>
                <strong>原页照原样保留</strong>
                <span>识别不出的内容留在页图里，不会丢。</span>
              </span>
            </li>
            <li>
              <span className={styles.railIndex}>02</span>
              <span className={styles.railBody}>
                <strong>公式与题目可激活</strong>
                <span>建议卡片逐条确认，点「激活」才变活。</span>
              </span>
            </li>
            <li>
              <span className={styles.railIndex}>03</span>
              <span className={styles.railBody}>
                <strong>一键发布给学生</strong>
                <span>只读链接 + 竞猜与判分数据回流。</span>
              </span>
            </li>
          </ol>
        </aside>
      </div>

      <p className={styles.retention}>活页与「当前浏览器」的访客会话绑定，默认保留 24 小时。</p>
    </section>
  );
}

export default LivingUploadPanel;
