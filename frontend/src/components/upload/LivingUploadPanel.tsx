/** 首页材料上传：统一进入横向动态 PPT 工作台。 */

import { useRef, useState, type DragEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { uploadTeachingMaterial, WORKBENCH_UPLOAD_ACCEPT } from '@/api/teachingUpload';
import { errorMessage } from '@/api/client';
import styles from './UploadPanel.module.css';

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
      navigate(await uploadTeachingMaterial(list));
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
            上传动态 PPT 材料
          </h2>
          <p className={styles.lead}>
            上传 PPTX、PDF 或图片，直接进入横向 PPT 工作台，原位编辑图形、调参演示与分享导出。
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
            {busy ? '正在解析并生成工作台…' : '点击选择或拖入 PPTX / PDF / 图片'}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept={WORKBENCH_UPLOAD_ACCEPT}
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
                <strong>直接展开横向幻灯片</strong>
                <span>原页版式保真呈现，自动准备可操作对象。</span>
              </span>
            </li>
            <li>
              <span className={styles.railIndex}>02</span>
              <span className={styles.railBody}>
                <strong>原位调节与自由编辑</strong>
                <span>直接拖动线段、调线长/线型/颜色或嵌入交互模型。</span>
              </span>
            </li>
            <li>
              <span className={styles.railIndex}>03</span>
              <span className={styles.railBody}>
                <strong>导出与分享</strong>
                <span>一键生成只读分享链接、离线 HTML 或工程包。</span>
              </span>
            </li>
          </ol>
        </aside>
      </div>

      <p className={styles.retention}>课件与「当前浏览器」的访客会话绑定，默认保留 24 小时。</p>
    </section>
  );
}

export default LivingUploadPanel;
