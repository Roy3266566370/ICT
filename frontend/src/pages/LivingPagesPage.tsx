/** 万象活页主入口：统一导入静态 PPTX / PDF / 图片到横向动态 PPT 工作台，并管理已有课件。 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, errorMessage } from '@/api/client';
import { importProjectPackage } from '@/api/projectPackage';
import { uploadTeachingMaterial, WORKBENCH_UPLOAD_ACCEPT } from '@/api/teachingUpload';
import type { MaterialSummary } from '@/api/types';
import { SiteNav } from '@/components/home/SiteNav';
import { LivingIntroBanner } from '@/components/intros/LivingIntroBanner';
import styles from './LivingPage.module.css';

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

function statusLabel(status: MaterialSummary['status'] | 'readable'): string {
  switch (status) {
    case 'ready':
      return '已就绪';
    case 'awaiting_confirmation':
      return '可交互';
    case 'readable':
      return '底图已就绪';
    case 'processing':
      return '转换中';
    case 'failed':
      return '转换失败';
    default:
      return status;
  }
}

export default function LivingPagesPage(): ReactNode {
  const navigate = useNavigate();
  const [materials, setMaterials] = useState<MaterialSummary[] | null>(null);
  const [busy, setBusy] = useState<'upload' | 'import' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const totalSlides = materials === null ? null : materials.reduce((sum, item) => sum + item.page_count, 0);
  const totalObjects = materials === null ? null : materials.reduce((sum, item) => sum + item.object_count, 0);

  const [loadError, setLoadError] = useState('');
  const loadData = (): void => {
    setLoadError('');
    api.listMaterials(50)
      .then((res) => setMaterials(res.items))
      .catch(() => setLoadError('课件列表加载失败，请重试。'));
  };
  useEffect(loadData, []);

  const upload = async (files: FileList | null): Promise<void> => {
    if (!files?.length) return;
    setBusy('upload');
    setError(null);
    try {
      navigate(await uploadTeachingMaterial([...files]));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleImportPackage = async (files: FileList | null): Promise<void> => {
    const file = files?.[0];
    if (!file) return;
    setBusy('import');
    setError(null);
    try {
      const imported = await importProjectPackage(file);
      navigate(`/materials/${encodeURIComponent(imported.material_id)}/work?page=1`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
      if (importRef.current) importRef.current.value = '';
    }
  };

  return (
    <div className={`${styles.listRoot} studio-scope`}>
      <SiteNav current="living" appearance="studio" />
      <main className={styles.listPage}>
        <header className={styles.pageHead}>
          <div className={styles.headText}>
            <div className={styles.eyebrow}>
              <i aria-hidden="true" /> WANXIANG LIVING PAGES · 动态课件与工坊插件演播舞台
            </div>
            <h1 className={styles.pageTitle}>
              万象<span className={styles.titleHighlight}>活页</span>
            </h1>
            <p className={styles.lead}>
              上传静态 PPTX、PDF 或图片，直接进入高保真横向幻灯片工作台。
              保留原稿排版的同时，在任意一页原地嵌入「万象工坊」50+ 学科交互插件，并可打包为单文件 HTML 断网演播。
            </p>
            <div className={styles.headMeta}>
              <div className={styles.headMetric}>
                <b>{materials === null ? '—' : materials.length}</b>
                <span>份动态课件</span>
              </div>
              <div className={styles.headMetric}>
                <b>{totalSlides === null ? '—' : totalSlides}</b>
                <span>页幻灯片</span>
              </div>
              <div className={styles.headMetric}>
                <b>{totalObjects === null ? '—' : totalObjects}</b>
                <span>个交互对象</span>
              </div>
            </div>
          </div>

          <aside className={styles.headNote}>
            <span className={styles.headNoteTag}>ECOSYSTEM · 双向贯通</span>
            <strong>与万象工坊无缝联动</strong>
            <p>所有 PPTX、PDF 与图片均进入横向幻灯片舞台，默认开启原位交互；随时把工坊里搭好的活仪器装进任意页面。</p>
            <Link to="/workshop" className={styles.headNoteLink}>去万象工坊挑仪器 ↗</Link>
          </aside>
        </header>

        <LivingIntroBanner />

        <section className={styles.createSection} aria-labelledby="living-create-title">
          <div className={styles.sectionHead}>
            <div>
              <p className={styles.sectionEyebrow}><span className={styles.secNo}>§ 01</span> NEW OR IMPORT / 开始制作</p>
              <h2 id="living-create-title" className={styles.sectionTitle}>新建或导入动态 PPT</h2>
            </div>
            <p className={styles.sectionNote}>上传即入工作台 · 原位编辑与现场演播</p>
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
              <strong>{busy === 'upload' ? '正在解析并打开幻灯片工作台，请稍候…' : '上传 PPTX / PDF / 图片'}</strong>
              <span className={styles.dropHint}>拖入或点击选择 1 份文件，直接生成横向动态 PPT</span>
              <span className={styles.dropFormats} aria-hidden="true">
                <i>PPTX</i><i>PDF</i><i>PNG</i><i>JPG</i>
              </span>
              <input
                ref={fileRef}
                type="file"
                accept={WORKBENCH_UPLOAD_ACCEPT}
                hidden
                onChange={(e) => void upload(e.target.files)}
              />
            </div>

            <div className={styles.pasteCard}>
              <div className={styles.pasteHead}>
                <span className={styles.pasteLabel}>OFFLINE & PROJECT · 资产恢复</span>
                <span className={styles.charCount}>.xsproj / .html</span>
              </div>
              <h3 className={styles.pasteTitle}>导入已有工程包或离线网页</h3>
              <p className={styles.pasteLead}>
                从本地恢复之前导出的工程包或单文件交互 HTML，完整保留所有原位矢量图形、工坊插件、数学画布与流程图，导入后立即回到工作台继续编辑。
              </p>
              <div className={styles.pasteFoot}>
                <span className={styles.pasteHint}>支持 .xsproj 工程存档与万象单文件 .html 直接导回</span>
                <button
                  type="button"
                  className={styles.generateBtn}
                  disabled={busy === 'import'}
                  onClick={() => importRef.current?.click()}
                >
                  {busy === 'import' ? '导入中…' : '选择文件导入 ↗'}
                </button>
                <input
                  ref={importRef}
                  type="file"
                  accept=".xsproj,.html,.htm,application/zip,text/html"
                  hidden
                  onChange={(e) => void handleImportPackage(e.target.files)}
                />
              </div>
            </div>
          </div>
        </section>

        {loadError ? <p className={styles.uploadError} role="alert">{loadError} <button type="button" onClick={loadData}>重试</button></p> : null}
        {error ? <p className={styles.uploadError} role="alert">{error}</p> : null}

        <section className={styles.listSection} aria-labelledby="living-mine-title">
          <div className={styles.sectionHead}>
            <div>
              <p className={styles.sectionEyebrow}><span className={styles.secNo}>§ 02</span> LIBRARY / 个人活课件库</p>
              <h2 id="living-mine-title" className={styles.sectionTitle}>我的动态 PPT</h2>
            </div>
            <span className={styles.countPill}>{materials === null ? '载入中' : `${materials.length} 份`}</span>
          </div>
          {materials === null ? (
            <SkeletonList />
          ) : materials.length === 0 ? (
            <div className={styles.empty}>
              <span className={styles.emptyIcon} aria-hidden="true"><PagesGlyph /></span>
              <p className={styles.emptyTitle}>还没有动态 PPT</p>
              <p className={styles.emptyLead}>上传一份 PPTX、PDF 或图片，会直接在这里打开横向幻灯片工作台。</p>
              <button type="button" className={styles.emptyAction} onClick={() => fileRef.current?.click()}>
                上传文件
              </button>
            </div>
          ) : (
            <ul className={styles.pageList}>
              {materials.map((item, index) => (
                <li key={item.material_id} className={styles.pageRow}>
                  <Link to={`/materials/${item.material_id}/work?page=1`} className={styles.pageItem}>
                    <span className={styles.pageIndex}>{String(index + 1).padStart(2, '0')}</span>
                    <span className={styles.pageMain}>
                      <span className={styles.pageItemTitle}>{item.title}</span>
                      <span className={styles.pageItemMeta}>
                        <span>{item.page_count} 页 · {statusLabel(item.status)}</span>
                        {item.object_count > 0 ? (
                          <em className={styles.pendingBadge}>{item.object_count} 个交互对象</em>
                        ) : null}
                      </span>
                    </span>
                    <span className={styles.pageItemTime}>{formatTime(item.created_at)}</span>
                    <span className={styles.pageArrow} aria-hidden="true">→</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={styles.tips} aria-label="工作台能力说明">
          <div>
            <strong>01 · IMPORT</strong>
            <h3>原稿保真导入</h3>
            <p>上传静态 PPTX、PDF 或图片直接进入横向工作台，保留原有排版结构，无需重做整套课件。</p>
          </div>
          <div>
            <strong>02 · LIVE STAGE</strong>
            <h3>原位交互与工坊插件</h3>
            <p>在幻灯片原位插入万象工坊交互仪器，现场调参、切换情景预设，告别讲课来回切软件。</p>
          </div>
          <div>
            <strong>03 · OFFLINE</strong>
            <h3>离线演播与无损导回</h3>
            <p>导出独立单文件 HTML，教室断网照常跑真实计算；也可打包工程随时导回继续修订。</p>
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
