/** 通文册主入口：统一导入静态 PPTX / PDF / 图片到横向动态 PPT 工作台，并管理已有课件。 */

import { useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { errorMessage } from '@/api/client';
import { useDeleteMaterial, useMaterials } from '@/api/hooks';
import { importProjectPackage } from '@/api/projectPackage';
import { uploadTeachingMaterial, WORKBENCH_UPLOAD_ACCEPT } from '@/api/teachingUpload';
import type { MaterialSummary } from '@/api/types';
import { MainSiteNav } from '@/components/home/MainSiteNav';
import { LivingIntroBanner, type TurnDirection } from '@/components/intros/LivingIntroBanner';
import { DeleteContentDialog } from '@/components/ui/DeleteContentDialog';
import { NewDeckModal } from '@/components/editor/NewDeckModal';
import { SpaceCover } from './space/SpaceCard';
import { materialItem, relativeAssetTime } from './space/spaceItems';
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

export default function LivingPagesPage(): ReactNode {
  const navigate = useNavigate();
  const now = Date.now();
  const materialsQuery = useMaterials(50);
  const materials = materialsQuery.data?.items ?? null;
  const deleteMaterial = useDeleteMaterial();
  const [pendingDelete, setPendingDelete] = useState<MaterialSummary | null>(null);
  const [busy, setBusy] = useState<'upload' | 'import' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const listTitle = useRef<HTMLHeadingElement>(null);
  const [turnDir, setTurnDir] = useState<TurnDirection | null>(null);
  const [newDeckOpen, setNewDeckOpen] = useState(false);

  const totalSlides = materials === null ? null : materials.reduce((sum, item) => sum + item.page_count, 0);
  const totalObjects = materials === null ? null : materials.reduce((sum, item) => sum + item.object_count, 0);

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

  return <>
    <MainSiteNav current="living" />
    <div className={`${styles.listRoot} studio-scope atelier-paper`}>
      <main className={styles.listPage}>
        <header className={styles.pageHead}>
          <div className={styles.headText}>
            <div className={styles.eyebrow}><i aria-hidden="true" /> TONGWEN ATLAS · 通文册</div>
            <h1 className={styles.pageTitle}>一本<span className={styles.titleHighlight}>会呼吸的册。</span></h1>
          </div>
          <p>用<span className="keep-together">定象坊插件</span>把积木嵌进课件任意一页。读者打开就能调参，也能把交互课件带走。</p>
        </header>

        <div className={styles.book} data-turning={turnDir ?? undefined}>
          <section className={styles.bookCopy} aria-label="制作通文册">
            <h2>把静态课件，<br />装订成<em>会动的册。</em></h2>
            <p>上传 PPTX、PDF 或图片，保留原稿排版，再把定象坊的公式、曲线和参数滑块嵌进任意一页。</p>
            <div className={styles.bookActions}>
              <button type="button" className={styles.generateBtn} onClick={()=>setNewDeckOpen(true)}>＋ 新建课件</button>
              <button type="button" className={styles.generateBtn} disabled={busy === 'upload'}
                onClick={() => fileRef.current?.click()}>上传原稿 ↗</button>
              <button type="button" className={styles.bookLink} disabled={busy==='import'}
                onClick={()=>importRef.current?.click()}>导入离线课件</button>
              <a className={styles.bookLink} href="#living-mine-title">查看我的册</a>
            </div>
            <div className={styles.headMeta}>
              <div className={styles.headMetric}><b>{materials?.length ?? '—'}</b><span>我的课件</span></div>
              <div className={styles.headMetric}><b>{totalSlides ?? '—'}</b><span>页幻灯片</span></div>
              <div className={styles.headMetric}><b>{totalObjects ?? '—'}</b><span>个交互对象</span></div>
            </div>
          </section>
          <div className={styles.bookPage}><LivingIntroBanner onTurnChange={setTurnDir} /></div>
        </div>

        <section className={styles.createSection} aria-labelledby="living-create-title">
          <div className={styles.sectionHead}>
            <div>
              <p className={styles.sectionEyebrow}><span className={styles.secNo}>§ 01</span> BINDING / 开始装订</p>
              <h2 id="living-create-title" className={styles.sectionTitle}>导入原稿或恢复工程</h2>
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
              <span className={styles.dropHint}>拖入或点击选择 1 份文件，导入为通文册课件</span>
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
                从本地恢复之前导出的工程包或单文件交互 HTML，完整保留所有原位矢量图形、<span className="keep-together">定象坊插件</span>、数学画布与流程图，导入后立即回到工作台继续编辑。
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

        {materialsQuery.isError ? <p className={styles.uploadError} role="alert">课件列表加载失败，请重试。 <button type="button" onClick={() => void materialsQuery.refetch()}>重试</button></p> : null}
        {error ? <p className={styles.uploadError} role="alert">{error}</p> : null}

        <section className={styles.listSection} aria-labelledby="living-mine-title">
          <div className={styles.sectionHead}>
            <div>
              <p className={styles.sectionEyebrow}><span className={styles.secNo}>§ 02</span> LIBRARY / 我的书架</p>
              <h2 id="living-mine-title" className={styles.sectionTitle} ref={listTitle} tabIndex={-1}>我的通文册</h2>
            </div>
            <span className={styles.countPill}>{materials === null ? '载入中' : `${materials.length} 份`}</span>
          </div>
          {materials === null ? (
            <SkeletonList />
          ) : materials.length === 0 ? (
            <div className={styles.empty}>
              <span className={styles.emptyIcon} aria-hidden="true"><PagesGlyph /></span>
              <p className={styles.emptyTitle}>还没有课件</p>
              <p className={styles.emptyLead}>上传一份 PPTX、PDF 或图片，会直接在这里打开横向幻灯片工作台。</p>
              <button type="button" className={styles.emptyAction} onClick={() => fileRef.current?.click()}>
                上传文件
              </button>
            </div>
          ) : (
            <ul className={styles.pageList}>
              {materials.map(record => {
                const item = materialItem(record);
                const time = relativeAssetTime(item.time, now);
                return <li key={item.id} className={styles.libraryCard}>
                  <Link to={`/materials/${encodeURIComponent(item.id)}/work?page=1`} className={styles.libraryLink}>
                    <SpaceCover item={item}/>
                    <div className={styles.libraryCopy}>
                      <h3>{item.title}</h3>
                      <p>{time}</p>
                      <p>{record.page_count} 页{record.object_count > 0 ? ` · ${record.object_count} 个交互对象` : ''}</p>
                    </div>
                  </Link>
                  <button type="button" className={styles.pageDelete} aria-label={`删除「${item.title}」`}
                    onClick={() => setPendingDelete(record)}>删除</button>
                </li>;
              })}
            </ul>
          )}
          {pendingDelete && <DeleteContentDialog label="课件" title={pendingDelete.title}
            onDelete={() => deleteMaterial.mutateAsync(pendingDelete.material_id)}
            onDismiss={deleted => {
              setPendingDelete(null);
              if (deleted) listTitle.current?.focus({ preventScroll: true });
            }}/>}
        </section>

      </main>
      {newDeckOpen&&<NewDeckModal onClose={()=>setNewDeckOpen(false)} onCreated={id=>{
        void materialsQuery.refetch();
        navigate(`/materials/${encodeURIComponent(id)}/work?mode=edit&page=1`);
      }}/>}
    </div>
  </>;
}
