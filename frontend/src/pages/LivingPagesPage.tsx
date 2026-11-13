/** 活页入口：材料列表 + 两种创建方式（上传文件 / 粘贴文字）。 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createLivingPage, createLivingPageFromText, listLivingPages } from '@/api/living';
import { errorMessage } from '@/api/client';
import { SiteNav } from '@/components/home/SiteNav';
import type { LivingPageSummary } from '@/living/types';
import styles from './LivingPage.module.css';

const ACCEPT = '.pdf,.pptx,.png,.jpg,.jpeg,.webp,.txt,.md,.csv';

function UploadGlyph(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 16V4m0 0 4 4m-4-4L8 8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 15v3.2A1.8 1.8 0 0 0 5.8 20h12.4a1.8 1.8 0 0 0 1.8-1.8V15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function PagesGlyph(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
      <rect x="4.5" y="3.5" width="11.5" height="14.5" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8.5 20.5h9a2 2 0 0 0 2-2V8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function SkeletonList(): JSX.Element {
  return (
    <div aria-hidden="true">
      <div className={styles.skeletonList}>
        {[0, 1, 2].map((i) => <span key={i} className={styles.skeletonRow} />)}
      </div>
      <span className="visually-hidden" role="status">载入中…</span>
    </div>
  );
}

export default function LivingPagesPage(): ReactNode {
  const navigate = useNavigate();
  const [pages, setPages] = useState<LivingPageSummary[] | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<'upload' | 'text' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const totalBlocks = pages === null ? null : pages.reduce((sum, p) => sum + p.block_count, 0);
  const pendingSuggestions = pages === null ? null : pages.reduce((sum, p) => sum + p.suggestions_pending, 0);

  useEffect(() => {
    listLivingPages()
      .then(setPages)
      .catch(() => setPages([]));
  }, []);

  const upload = async (files: FileList | null): Promise<void> => {
    if (!files?.length) return;
    setBusy('upload');
    setError(null);
    try {
      const doc = await createLivingPage({ files: [...files] });
      navigate(`/living/${doc.page_id}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const fromText = async (): Promise<void> => {
    if (!text.trim()) return;
    setBusy('text');
    setError(null);
    try {
      const doc = await createLivingPageFromText({ title: '', text: text.trim() });
      navigate(`/living/${doc.page_id}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={`${styles.listRoot} studio-scope`}>
      <SiteNav current="living" appearance="studio" />
      <main className={styles.listPage}>
        <header className={styles.pageHead}>
          <div className={styles.headText}>
            <p className={styles.eyebrow}>万象活页 · Living Pages</p>
            <h1 className={styles.pageTitle}>把讲义变成活页</h1>
            <p className={styles.lead}>
              把任何文件变成“活的”讲义：文字、公式、题目、实验都长在页面上。
              上传后自动解析成块，之后可以继续在编辑器里补题目、公式和实验。
            </p>
            <p className={styles.headMeta}>
              <span><b>{pages === null ? '—' : pages.length}</b> 份活页</span>
              <span><b>{totalBlocks === null ? '—' : totalBlocks}</b> 个内容块</span>
              <span><b>{pendingSuggestions === null ? '—' : pendingSuggestions}</b> 条待激活</span>
            </p>
          </div>
          <aside className={styles.headNote}>
            <span>支持的文件</span>
            <p>PDF / PPTX / 图片 / 文本；PDF 最多 100 页，保留原页图示与公式，也可以直接粘贴讲义原文。</p>
          </aside>
        </header>

        <section className={styles.createSection} aria-labelledby="living-create-title">
          <div className={styles.sectionHead}>
            <div>
              <p className={styles.sectionEyebrow}>01 · New</p>
              <h2 id="living-create-title" className={styles.sectionTitle}>新建活页</h2>
            </div>
            <p className={styles.sectionNote}>上传即解析 · 文字直接生成</p>
          </div>

          <div className={styles.createRow}>
            <div
              className={styles.dropCard}
              data-dragging={dragging ? 'true' : undefined}
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                void upload(e.dataTransfer.files);
              }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  fileRef.current?.click();
                }
              }}
            >
              <span className={styles.dropIcon} aria-hidden="true"><UploadGlyph /></span>
              <strong>{busy === 'upload' ? '正在解析并生成原页预览，大文件请稍候…' : '上传文件'}</strong>
              <span className={styles.dropHint}>PDF / PPTX / 图片 / 文本 — 拖进来也行</span>
              <span className={styles.dropFormats} aria-hidden="true">
                <i>PDF</i><i>PPTX</i><i>PNG</i><i>TXT</i><i>MD</i>
              </span>
              <input
                ref={fileRef}
                type="file"
                accept={ACCEPT}
                multiple
                hidden
                onChange={(e) => void upload(e.target.files)}
              />
            </div>

            <div className={styles.pasteCard}>
              <div className={styles.pasteHead}>
                <span className={styles.pasteLabel}>或者粘贴一段讲义文字</span>
                {text.length > 0 ? <span className={styles.charCount}>{text.length} 字</span> : null}
              </div>
              <textarea
                placeholder="支持标题、段落与公式；粘贴后直接生成…"
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={5}
              />
              <div className={styles.pasteFoot}>
                <span className={styles.pasteHint}>生成后仍可在编辑器里改块、插入题目与实验。</span>
                <button
                  type="button"
                  className={styles.generateBtn}
                  disabled={busy === 'text' || !text.trim()}
                  onClick={() => void fromText()}
                >
                  {busy === 'text' ? '生成中…' : '生成活页'}
                </button>
              </div>
            </div>
          </div>
        </section>

        {error ? <p className={styles.uploadError} role="alert">{error}</p> : null}

        <section className={styles.listSection} aria-labelledby="living-mine-title">
          <div className={styles.sectionHead}>
            <div>
              <p className={styles.sectionEyebrow}>02 · Library</p>
              <h2 id="living-mine-title" className={styles.sectionTitle}>我的活页</h2>
            </div>
            <span className={styles.countPill}>{pages === null ? '载入中' : `${pages.length} 份`}</span>
          </div>
          {pages === null ? (
            <SkeletonList />
          ) : pages.length === 0 ? (
            <div className={styles.empty}>
              <span className={styles.emptyIcon} aria-hidden="true"><PagesGlyph /></span>
              <p className={styles.emptyTitle}>还没有活页</p>
              <p className={styles.emptyLead}>上传一份讲义或粘贴一段文字，生成的活页会出现在这里。</p>
              <button type="button" className={styles.emptyAction} onClick={() => fileRef.current?.click()}>
                上传文件
              </button>
            </div>
          ) : (
            <ul className={styles.pageList}>
              {pages.map((p, index) => (
                <li key={p.page_id} className={styles.pageRow}>
                  <Link to={`/living/${p.page_id}`} className={styles.pageItem}>
                    <span className={styles.pageIndex}>{String(index + 1).padStart(2, '0')}</span>
                    <span className={styles.pageMain}>
                      <span className={styles.pageItemTitle}>{p.title}</span>
                      <span className={styles.pageItemMeta}>
                        <span>
                          {p.pages_total ? `${p.pages_total} 页 · ` : ''}{p.block_count} 块
                        </span>
                        {p.suggestions_pending > 0 ? (
                          <em className={styles.pendingBadge}>{p.suggestions_pending} 条待激活</em>
                        ) : null}
                      </span>
                    </span>
                    <span className={styles.pageItemTime}>{formatTime(p.updated_at)}</span>
                    <span className={styles.pageArrow} aria-hidden="true">→</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={styles.tips} aria-label="活页怎么用">
          <div>
            <strong>01 导入</strong>
            <p>PDF、PPTX、图片或一段文字，上传后保留原稿，逐条确认激活建议。</p>
          </div>
          <div>
            <strong>02 激活</strong>
            <p>在编辑器里为段落插入公式、题目或实验，让纸面内容动起来。</p>
          </div>
          <div>
            <strong>03 分享</strong>
            <p>发布生成学生链接，浏览与作答情况汇总在「学情」里。</p>
          </div>
        </section>
      </main>
    </div>
  );
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}.${month}.${day}`;
}
