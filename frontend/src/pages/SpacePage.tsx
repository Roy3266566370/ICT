import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { UseQueryResult } from '@tanstack/react-query';
import type { MaterialStatus, MaterialSummary, MaterialsListResponse } from '@/api/types';
import { useDeleteMaterial, useMaterials } from '@/api/hooks';
import { worksApi, type WorkSummary } from '@/api/works';
import { SUBJECT_LABELS } from '@/labs/types';
import { StatusBadge } from '@/components/ui';
import { SiteNav } from '@/components/home/SiteNav';
import { SpaceIntroBanner } from '@/components/intros/SpaceIntroBanner';
import { AccountAvatar } from '@/components/account/AccountAvatar';
import { ErrorNotice } from '@/components/upload/ErrorNotice';
import { readApiError, type NoticeState } from '@/components/upload/errorCopy';
import { importProjectPackage } from '@/api/projectPackage';
import { useEnsureAccountProfile } from '@/hooks/useAccountBootstrap';
import {
  useAccountProfile,
  useAccountStatus,
  useAccountUser,
} from '@/state/accountSession';
import styles from './SpacePage.module.css';

/** 活页课件状态标签 */
const STATUS_LABELS: Record<MaterialStatus, string> = {
  processing: '转换中',
  awaiting_confirmation: '可交互',
  ready: '已就绪',
  failed: '转换失败',
};

type StudioIconName = 'upload' | 'workshop' | 'clock' | 'arrow' | 'edit' | 'layers' | 'plus';

function StudioIcon({ name }: { name: StudioIconName }): JSX.Element {
  const paths: Record<StudioIconName, JSX.Element> = {
    upload: (
      <>
        <path d="M12 16V4m-4 4 4-4 4 4" />
        <path d="M5 14v5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5" />
      </>
    ),
    workshop: (
      <>
        <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
        <circle cx="8.5" cy="9.5" r="1.6" fill="currentColor" stroke="none" />
        <circle cx="15.5" cy="14.5" r="1.6" fill="currentColor" stroke="none" />
        <path d="M8.5 9.5 15.5 14.5" strokeDasharray="2 2" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    edit: (
      <>
        <path d="m15 4 5 5M4 20l5-1L20 8a2.1 2.1 0 0 0-3-3L6 16Z" />
        <path d="M13 20h7" />
      </>
    ),
    layers: (
      <>
        <path d="m12 3 9 4.5-9 4.5-9-4.5L12 3Z" />
        <path d="m3 12 9 4.5 9-4.5" />
        <path d="m3 16.5 9 4.5 9-4.5" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
  };
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

/** 到期倒计时每 30 秒刷新一次 */
function useTicker(intervalMs: number): number {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

interface Remaining {
  text: string;
  expired: boolean;
}

function describeRemaining(expiresAt: string, nowMs: number): Remaining {
  const target = Date.parse(expiresAt);
  if (Number.isNaN(target)) return { text: '到期时间未知', expired: false };
  const delta = target - nowMs;
  if (delta <= 0) return { text: '已到期', expired: true };
  const totalMinutes = Math.floor(delta / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return {
    text: hours >= 1 ? `剩余 ${hours} 小时 ${minutes} 分` : `剩余 ${minutes} 分钟`,
    expired: false,
  };
}

function formatDateTime(iso: string): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return iso;
  return new Date(parsed).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

interface LivingMaterialsSectionProps {
  query: UseQueryResult<MaterialsListResponse>;
  now: number;
  removedIds: readonly string[];
  confirmingId: string | null;
  deletingId: string | undefined;
  notice: NoticeState | null;
  importing: boolean;
  importError: string;
  onDismissNotice: () => void;
  onDelete: (item: MaterialSummary) => void;
  onConfirm: (materialId: string) => void;
  onCancel: () => void;
  onGoLiving: () => void;
  onTriggerImport: () => void;
}

/** 万象活页课件列表 */
function LivingMaterialsSection({
  query,
  now,
  removedIds,
  confirmingId,
  deletingId,
  notice,
  importing,
  importError,
  onDismissNotice,
  onDelete,
  onConfirm,
  onCancel,
  onGoLiving,
  onTriggerImport,
}: LivingMaterialsSectionProps): JSX.Element {
  const items = useMemo(
    () => (query.data?.items ?? []).filter((item) => !removedIds.includes(item.material_id)),
    [query.data?.items, removedIds],
  );
  const retentionExpiresAt = query.data?.retention_expires_at ?? null;

  return (
    <div className={styles.panelBody}>
      <div className={styles.metaBar}>
        <div className={styles.metaStats}>
          <span>
            {query.isLoading ? '正在读取活页课件…' : query.isError ? '数量暂不可用' : <>共 <strong>{items.length}</strong> 份动态活页</>}
          </span>
          <span>
            {retentionExpiresAt ? (
              <>
                保留至 <time dateTime={retentionExpiresAt}>{formatDateTime(retentionExpiresAt)}</time>
              </>
            ) : (
              '支持随时导出 .xsproj 工程包与离线 HTML'
            )}
          </span>
        </div>
        <div className={styles.metaActions}>
          <button
            type="button"
            className={styles.toolbarBtn}
            disabled={importing}
            onClick={onTriggerImport}
          >
            {importing ? '导入中…' : '导入 .xsproj / .html'}
          </button>
          <button type="button" className={styles.toolbarBtnPrimary} onClick={onGoLiving}>
            + 上传课件转活页
          </button>
        </div>
      </div>

      {importError ? (
        <p className={styles.inlineAlert} role="alert">
          {importError}
        </p>
      ) : null}

      {notice ? (
        <div className={styles.noticeWrap}>
          <ErrorNotice
            code={notice.code}
            message={notice.message}
            retryable={notice.retryable}
            onDismiss={onDismissNotice}
          />
        </div>
      ) : null}

      {query.isError ? (
        <div className={styles.noticeWrap}>
          <ErrorNotice
            {...readApiError(query.error)}
            title="活页课件暂时无法读取"
            onRetry={() => {
              void query.refetch();
            }}
          />
        </div>
      ) : null}

      {query.isLoading ? (
        <div className={styles.loading} aria-busy="true" aria-live="polite">
          <p>正在恢复当前浏览器上的活页课件…</p>
          <div className={styles.skeleton} aria-hidden="true" />
          <div className={styles.skeleton} aria-hidden="true" />
        </div>
      ) : items.length === 0 && !query.isError ? (
        <div className={styles.emptyBox} aria-labelledby="space-empty-title">
          <div className={styles.emptyContent}>
            <span className={styles.emptyBadge}>LIVING PAGES</span>
            <h3 className={styles.emptyTitle} id="space-empty-title">
              还没有万象活页课件
            </h3>
            <p className={styles.emptyLead}>
              前往万象活页上传 PPTX、PDF 或讲义图片，或直接导入本地 .xsproj 工程包与单文件 .html，即可在横向工作台原位编辑并挂载工坊插件。
            </p>
          </div>
          <div className={styles.emptyActions}>
            <button type="button" className={styles.primaryBtn} onClick={onGoLiving}>
              前往万象活页上传 <StudioIcon name="arrow" />
            </button>
            <button
              type="button"
              className={styles.secondaryBtn}
              disabled={importing}
              onClick={onTriggerImport}
            >
              {importing ? '导入中…' : '导入工程包 / HTML'}
            </button>
          </div>
        </div>
      ) : items.length > 0 ? (
        <>
          <div className={styles.listHead} aria-hidden="true">
            <span>课件名称</span>
            <span>状态</span>
            <span>保留倒计时</span>
            <span>交互对象</span>
            <span>操作</span>
          </div>

          <ul className={styles.list} aria-label="万象活页课件列表">
            {items.map((item, idx) => {
              const remaining = describeRemaining(item.expires_at, now);
              const deleting = deletingId === item.material_id;
              return (
                <li className={styles.row} key={item.material_id}>
                  <div className={styles.cellName}>
                    <span className={styles.rowIndex}>{String(idx + 1).padStart(2, '0')}</span>
                    <div className={styles.itemNameText}>
                      <Link className={styles.nameLink} to={`/materials/${item.material_id}/work?page=1`}>
                        {item.title}
                      </Link>
                      <span className={styles.pageCount}>{item.page_count} 页幻灯片</span>
                    </div>
                  </div>

                  <div className={styles.cell}>
                    <span className={styles.cellLabel}>状态</span>
                    <StatusBadge status={item.status} label={STATUS_LABELS[item.status]} />
                  </div>

                  <div className={styles.cell}>
                    <span className={styles.cellLabel}>到期</span>
                    <time
                      className={remaining.expired ? styles.expired : styles.remaining}
                      dateTime={item.expires_at}
                      title={`到期时间 ${formatDateTime(item.expires_at)}`}
                    >
                      <StudioIcon name="clock" />
                      {remaining.text}
                    </time>
                  </div>

                  <div className={styles.cell}>
                    <span className={styles.cellLabel}>交互对象</span>
                    <span className={styles.cellValue}>{item.object_count} 个对象</span>
                  </div>

                  <div className={styles.cellActions}>
                    <Link className={styles.openLink} to={`/materials/${item.material_id}/work?page=1`}>
                      打开活页
                    </Link>
                    {confirmingId === item.material_id ? (
                      <>
                        <button
                          type="button"
                          className={styles.danger}
                          onClick={() => onDelete(item)}
                          disabled={deleting}
                        >
                          {deleting ? '删除中…' : '确认删除'}
                        </button>
                        <button type="button" className={styles.cancel} onClick={onCancel}>
                          取消
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className={styles.remove}
                        onClick={() => onConfirm(item.material_id)}
                        aria-label={`删除课件：${item.title}`}
                      >
                        删除
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          <p className={styles.listFootnote}>
            删除课件后，原始文件与派生交互对象将一并清理，建议提前在工作台导出 .xsproj 工程包存档。
          </p>
        </>
      ) : null}
    </div>
  );
}

interface WorkshopWorksSectionProps {
  works: WorkSummary[] | null;
  loading: boolean;
  error: string;
  confirmingWorkId: string | null;
  deletingWorkId: string | null;
  onRetry: () => void;
  onConfirmDelete: (workId: string) => void;
  onCancelDelete: () => void;
  onDeleteWork: (workId: string) => void;
  onCreateBlank: () => void;
}

/** 万象工坊作品列表（来自真实的 worksApi.list()） */
function WorkshopWorksSection({
  works,
  loading,
  error,
  confirmingWorkId,
  deletingWorkId,
  onRetry,
  onConfirmDelete,
  onCancelDelete,
  onDeleteWork,
  onCreateBlank,
}: WorkshopWorksSectionProps): JSX.Element {
  if (loading) {
    return (
      <div className={styles.loading} aria-busy="true" aria-live="polite">
        <p>正在读取万象工坊作品…</p>
        <div className={styles.skeleton} aria-hidden="true" />
        <div className={styles.skeleton} aria-hidden="true" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.panelBody}>
        <p className={styles.inlineAlert} role="alert">
          {error}{' '}
          <button type="button" className={styles.toolbarBtn} onClick={onRetry}>
            重试
          </button>
        </p>
      </div>
    );
  }

  const list = works ?? [];
  if (list.length === 0) {
    return (
      <div className={styles.emptyBox} aria-labelledby="space-works-empty-title">
        <div className={styles.emptyContent}>
          <span className={styles.emptyBadge}>WORKSHOP WORKS</span>
          <h3 className={styles.emptyTitle} id="space-works-empty-title">
            还没有保存的工坊作品
          </h3>
          <p className={styles.emptyLead}>
            去万象工坊挑选学科模板或新建空白画布，连线调参后点击保存，作品就会出现在这里，并可随时嵌入万象活页。
          </p>
        </div>
        <div className={styles.emptyActions}>
          <Link className={styles.primaryBtn} to="/workshop">
            浏览万象工坊 <StudioIcon name="arrow" />
          </Link>
          <button type="button" className={styles.secondaryBtn} onClick={onCreateBlank}>
            ＋ 新建空白画布
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.panelBody}>
      <div className={styles.metaBar}>
        <div className={styles.metaStats}>
          <span>
            共 <strong>{list.length}</strong> 件已保存的工坊作品
          </span>
          <span>打开画布即可继续编辑或封装为活页插件</span>
        </div>
        <div className={styles.metaActions}>
          <Link className={styles.toolbarBtn} to="/workshop">
            浏览模板库
          </Link>
          <button type="button" className={styles.toolbarBtnPrimary} onClick={onCreateBlank}>
            + 新建空白画布
          </button>
        </div>
      </div>

      <div className={styles.labsGrid} aria-label="万象工坊作品列表">
        {list.map((work, idx) => {
          const deleting = deletingWorkId === work.work_id;
          return (
            <article key={work.work_id} className={styles.labCard}>
              <div className={styles.labCardTop}>
                <span className={styles.labCardIdx}>#{String(idx + 1).padStart(2, '0')}</span>
                <span className={styles.labCardSubject}>
                  {work.node_count} 个积木 · v{work.revision}
                </span>
                {work.forked_from_share ? (
                  <em className={styles.labCardStatus} data-status="ready">改造自画廊</em>
                ) : null}
              </div>

              <Link to={`/canvas?work=${encodeURIComponent(work.work_id)}`} className={styles.labCardTitle}>
                {work.title || '未命名工坊作品'}
              </Link>

              <div className={styles.labCardFoot}>
                <span>更新于 {formatDateTime(work.updated_at)}</span>
                <div className={styles.cellActions}>
                  <Link className={styles.openLink} to={`/canvas?work=${encodeURIComponent(work.work_id)}`}>
                    打开画布 →
                  </Link>
                  {confirmingWorkId === work.work_id ? (
                    <>
                      <button
                        type="button"
                        className={styles.danger}
                        disabled={deleting}
                        onClick={() => onDeleteWork(work.work_id)}
                      >
                        {deleting ? '删除中…' : '确认'}
                      </button>
                      <button type="button" className={styles.cancel} onClick={onCancelDelete}>
                        取消
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className={styles.remove}
                      onClick={() => onConfirmDelete(work.work_id)}
                      aria-label={`删除作品：${work.title || '未命名工坊作品'}`}
                    >
                      删除
                    </button>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

/**
 * 个人主页 `/space`。
 *
 * 围绕当前项目真实资产（万象活页课件 + 万象工坊作品 + 账号资料）组织，
 * 与首页、万象工坊、万象活页保持统一的纸面视觉语言。
 */
export function SpacePage(): JSX.Element {
  const navigate = useNavigate();
  const now = useTicker(30_000);
  const status = useAccountStatus();
  const user = useAccountUser();
  const profile = useAccountProfile();
  useEnsureAccountProfile();

  const authenticated = status === 'authenticated' && user !== null;
  const materialsQuery = useMaterials(50);
  const deleteMaterial = useDeleteMaterial();

  // 万象工坊作品（真实后端 worksApi）
  const [works, setWorks] = useState<WorkSummary[] | null>(null);
  const [worksLoading, setWorksLoading] = useState(true);
  const [worksError, setWorksError] = useState('');
  const [confirmingWorkId, setConfirmingWorkId] = useState<string | null>(null);
  const [deletingWorkId, setDeletingWorkId] = useState<string | null>(null);

  const loadWorks = useCallback(() => {
    setWorksLoading(true);
    setWorksError('');
    worksApi
      .list()
      .then((res) => setWorks(res.works))
      .catch(() => setWorksError('工坊作品暂时无法读取，请稍后重试。'))
      .finally(() => setWorksLoading(false));
  }, []);

  useEffect(() => {
    if (status !== 'restoring') loadWorks();
  }, [status, loadWorks]);

  const projectInput = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [tab, setTab] = useState<'materials' | 'works'>('materials');
  const [removedIds, setRemovedIds] = useState<readonly string[]>([]);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<NoticeState | null>(null);

  const importProject = async (file: File): Promise<void> => {
    setImporting(true);
    setImportError('');
    try {
      const result = await importProjectPackage(file);
      navigate(`/materials/${result.material_id}/work?page=1`);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : '工程包导入失败');
    } finally {
      setImporting(false);
    }
  };

  const triggerImport = (): void => {
    projectInput.current?.click();
  };

  const goLiving = (): void => {
    navigate('/living');
  };

  const createBlankCanvas = (): void => {
    navigate('/canvas', { state: { blank: true } });
  };

  const materials = useMemo(
    () =>
      (materialsQuery.data?.items ?? []).filter(
        (item) => !removedIds.includes(item.material_id),
      ),
    [materialsQuery.data?.items, removedIds],
  );
  const latestMaterial = materials[0] ?? null;
  const objectCount = materials.reduce((sum, item) => sum + item.object_count, 0);
  const materialCountLabel = materialsQuery.isLoading
    ? '—'
    : materialsQuery.isError ? '未读取' : materials.length;
  const workCountLabel = worksLoading
    ? '—'
    : worksError ? '未读取' : works?.length ?? 0;

  const handleTabKeys = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const nextTab = event.key === 'Home'
      ? 'materials'
      : event.key === 'End' ? 'works' : tab === 'materials' ? 'works' : 'materials';
    setTab(nextTab);
    document.getElementById(`space-tab-${nextTab}`)?.focus();
  };

  const handleDeleteMaterial = (item: MaterialSummary): void => {
    setNotice(null);
    deleteMaterial.mutate(item.material_id, {
      onSuccess: () => {
        setRemovedIds((previous) => [...previous, item.material_id]);
        setConfirmingId(null);
      },
      onError: (error) => {
        setNotice(readApiError(error));
        setConfirmingId(null);
      },
    });
  };

  const handleDeleteWork = async (workId: string): Promise<void> => {
    setDeletingWorkId(workId);
    try {
      await worksApi.remove(workId);
      setWorks((prev) => (prev ?? []).filter((w) => w.work_id !== workId));
      setConfirmingWorkId(null);
    } catch {
      setWorksError('删除作品失败，请稍后重试。');
      setConfirmingWorkId(null);
    } finally {
      setDeletingWorkId(null);
    }
  };

  const hiddenProjectInput = (
    <input
      ref={projectInput}
      type="file"
      accept=".xsproj,.html,.htm,application/zip,text/html"
      hidden
      onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (file) void importProject(file);
      }}
    />
  );

  if (status === 'restoring') {
    return (
      <div className={`${styles.page} studio-scope`}>
        <SiteNav current="workspace" appearance="studio" />
        <main id="main" className={styles.main}>
          <div className={styles.loading} aria-busy="true" aria-live="polite">
            <p>正在恢复账号状态…</p>
            <div className={styles.skeleton} aria-hidden="true" />
            <div className={styles.skeleton} aria-hidden="true" />
          </div>
        </main>
      </div>
    );
  }

  /* ════════════════════════════════════════════════════════════════
     状态 A：访客态（未登录 / 账号服务不可用）
  ════════════════════════════════════════════════════════════════ */
  if (!authenticated) {
    return (
      <div className={`${styles.page} studio-scope`}>
        <SiteNav current="workspace" appearance="studio" />
        {hiddenProjectInput}
        <main id="main" className={styles.main}>
          <div className={styles.studioMeta}>
            <span className={styles.eyebrow}>
              <span className={styles.cross}>+</span> PERSONAL STUDIO · 个人主页
            </span>
            <span className={styles.metaCode}>
              {status === 'unavailable' ? 'LOCAL MODE · 账号服务暂不可用' : 'GUEST SESSION · 当前浏览器工作区'}
            </span>
          </div>

          <SpaceIntroBanner
            displayName="访客"
            worksCount={(works ?? []).length}
            materialsCount={materials.length}
            interactiveObjectsCount={objectCount}
          />

          <section className={styles.guestHero} aria-labelledby="space-guest-title">
            <div className={styles.guestMain}>
              <h1 id="space-guest-title" className={styles.heroTitle}>
                每一份活页与积木，<br />都沉淀为<em>个人工作集</em>。
              </h1>
              <p className={styles.heroLead}>
                当前浏览器中的万象活页课件与万象工坊作品已自动留存；登录账号后可统一管理头像、昵称、简介与常用学科偏好。
              </p>
              <div className={styles.heroActions}>
                <Link className={styles.primaryBtn} to="/login?returnTo=%2Fspace">
                  登录我的主页 <StudioIcon name="arrow" />
                </Link>
                <Link className={styles.secondaryBtn} to="/register">
                  免费注册
                </Link>
                <Link className={styles.ghostLink} to="/workshop">
                  先去万象工坊 →
                </Link>
              </div>
              <p className={styles.statusHint}>
                {status === 'unavailable'
                  ? '账号服务暂时不可用，但不影响继续查看或操作本浏览器内保存的活页课件与工坊作品。'
                  : '本机保存的活页课件与工坊作品不受登录状态切换影响，登录后可随时继续。'}
              </p>
            </div>

            <aside className={styles.matrixCard} aria-label="工作区快捷入口">
              <div className={styles.matrixHead}>
                <span>WORKSPACE ACCESS · 生态通道</span>
                <span>4 个常用入口</span>
              </div>
              <div className={styles.matrixGrid}>
                <Link className={styles.matrixCell} to="/workshop">
                  <span className={styles.matrixIdx}>01</span>
                  <div className={styles.matrixBody}>
                    <strong>万象工坊 ↗</strong>
                    <span>50+ 学科真内核实验与积木编排</span>
                  </div>
                </Link>
                <button type="button" className={styles.matrixCellBtn} onClick={createBlankCanvas}>
                  <span className={styles.matrixIdx}>02</span>
                  <div className={styles.matrixBody}>
                    <strong>新建空白画布 ↗</strong>
                    <span>从零拖拽积木、封装活页插件</span>
                  </div>
                </button>
                <Link className={styles.matrixCell} to="/living">
                  <span className={styles.matrixIdx}>03</span>
                  <div className={styles.matrixBody}>
                    <strong>万象活页 ↗</strong>
                    <span>上传 PPT / PDF，原位挂载工坊仪器</span>
                  </div>
                </Link>
                <button
                  type="button"
                  className={styles.matrixCellBtn}
                  disabled={importing}
                  onClick={triggerImport}
                >
                  <span className={styles.matrixIdx}>04</span>
                  <div className={styles.matrixBody}>
                    <strong>{importing ? '正在导入…' : '导入工程 / HTML ↗'}</strong>
                    <span>恢复本地 .xsproj 或单文件 .html</span>
                  </div>
                </button>
              </div>
            </aside>
          </section>

          {/* § 01 当前会话资产库：万象活页课件 + 万象工坊作品 */}
          <section className={styles.sectionBlock} aria-labelledby="space-guest-collection-title">
            <div className={styles.sectionHead}>
              <div className={styles.sectionTitleGroup}>
                <span className={styles.sectionIndex}>§ 01 / BROWSER WORKSPACE</span>
                <h2 className={styles.sectionTitle} id="space-guest-collection-title">
                  当前浏览器上的工作档案
                </h2>
                <p>正在展示本浏览器会话内保存的万象活页课件（{materialCountLabel}）与万象工坊作品（{workCountLabel}）。</p>
              </div>

              <div className={styles.tabs} role="tablist" aria-label="内容分类">
                <button
                  type="button"
                  role="tab"
                  id="space-tab-materials"
                  aria-controls="space-panel-materials"
                  aria-selected={tab === 'materials'}
                  tabIndex={tab === 'materials' ? 0 : -1}
                  className={tab === 'materials' ? styles.tabActive : styles.tab}
                  onClick={() => setTab('materials')}
                  onKeyDown={handleTabKeys}
                >
                  万象活页课件 <span className={styles.tabCount}>{materialCountLabel}</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  id="space-tab-works"
                  aria-controls="space-panel-works"
                  aria-selected={tab === 'works'}
                  tabIndex={tab === 'works' ? 0 : -1}
                  className={tab === 'works' ? styles.tabActive : styles.tab}
                  onClick={() => setTab('works')}
                  onKeyDown={handleTabKeys}
                >
                  万象工坊作品 <span className={styles.tabCount}>{workCountLabel}</span>
                </button>
              </div>
            </div>

            {tab === 'materials' ? (
              <div role="tabpanel" id="space-panel-materials" aria-labelledby="space-tab-materials" tabIndex={0}>
                <LivingMaterialsSection
                  query={materialsQuery}
                  now={now}
                  removedIds={removedIds}
                  confirmingId={confirmingId}
                  deletingId={deleteMaterial.variables}
                  notice={notice}
                  importing={importing}
                  importError={importError}
                  onDismissNotice={() => setNotice(null)}
                  onDelete={handleDeleteMaterial}
                  onConfirm={setConfirmingId}
                  onCancel={() => setConfirmingId(null)}
                  onGoLiving={goLiving}
                  onTriggerImport={triggerImport}
                />
              </div>
            ) : (
              <div role="tabpanel" id="space-panel-works" aria-labelledby="space-tab-works" tabIndex={0}>
                <WorkshopWorksSection
                  works={works}
                  loading={worksLoading}
                  error={worksError}
                  confirmingWorkId={confirmingWorkId}
                  deletingWorkId={deletingWorkId}
                  onRetry={loadWorks}
                  onConfirmDelete={setConfirmingWorkId}
                  onCancelDelete={() => setConfirmingWorkId(null)}
                  onDeleteWork={(id) => void handleDeleteWork(id)}
                  onCreateBlank={createBlankCanvas}
                />
              </div>
            )}
          </section>

          {/* § 02 存储与同步边界 */}
          <section className={styles.sectionBlock} aria-label="资产保留与同步说明">
            <div className={styles.specLedger}>
              <div className={styles.specItem}>
                <span>01 / 会话归属</span>
                <strong>跟随当前浏览器保留</strong>
                <p>活页课件与工坊作品按当前浏览器会话留存，无需登录即可体验；跨设备使用建议导出 .xsproj 工程包或单文件 HTML。</p>
              </div>
              <div className={styles.specItem}>
                <span>02 / 离线存档</span>
                <strong>支持工程包随时导回</strong>
                <p>在万象活页中导出的 .xsproj 或单文件 .html 可随时在上方导入恢复，保留全部原位图形与工坊交互插件。</p>
              </div>
              <div className={styles.specItem}>
                <span>03 / 账号范围</span>
                <strong>个人资料与偏好随账号保存</strong>
                <p>登录后可在设置中自定义头像、昵称、简介与主攻学科，个人资料将在下次登录时完整恢复。</p>
              </div>
            </div>
          </section>
        </main>
      </div>
    );
  }

  /* ════════════════════════════════════════════════════════════════
     状态 B：已登录态（个人档案首页）
  ════════════════════════════════════════════════════════════════ */
  const displayName = user.display_name.trim() === '' ? user.email : user.display_name;
  const username = user.username.trim();
  const bio = profile?.bio.trim() ?? '';
  const preferredSubjectLabel =
    profile?.preferred_subject
      ? SUBJECT_LABELS[profile.preferred_subject as keyof typeof SUBJECT_LABELS] ?? profile.preferred_subject
      : '';
  const defaultEntryLabel = profile?.default_entry === 'labs' ? '万象工坊' : '个人主页';
  const chips = [
    profile?.occupation ?? '',
    profile?.school ?? '',
    preferredSubjectLabel ? `主攻：${preferredSubjectLabel}` : '',
    ...(profile?.interests ?? []),
  ]
    .map((item) => item.trim())
    .filter((item) => item !== '');

  return (
    <div className={`${styles.page} studio-scope`}>
      <SiteNav current="workspace" appearance="studio" />
      {hiddenProjectInput}

      <main id="main" className={styles.main}>
        <div className={styles.studioMeta}>
          <span className={styles.eyebrow}>
            <span className={styles.cross}>+</span> PERSONAL STUDIO · 个人主页
          </span>
          <span className={styles.metaCode}>
            ACCOUNT · {username ? `@${username}` : user.email} · 默认入口：{defaultEntryLabel}
          </span>
        </div>

        <SpaceIntroBanner
          displayName={displayName}
          worksCount={(works ?? []).length}
          materialsCount={materials.length}
          interactiveObjectsCount={objectCount}
        />

        {/* 个人档案卡片 */}
        <section className={styles.dossierCard} aria-labelledby="space-profile-title">
          <div className={styles.identity}>
            <Link
              className={styles.avatarFrame}
              to="/settings/profile"
              aria-label="编辑头像与个人资料"
            >
              <AccountAvatar
                size="xl"
                label={displayName}
                avatarUrl={user.avatar_url ?? null}
                className={styles.profileAvatar}
              />
            </Link>
            <div className={styles.identityText}>
              <div className={styles.nameRow}>
                <h1 className={styles.profileName} id="space-profile-title">
                  {displayName}
                </h1>
                {username === '' ? null : <span className={styles.handle}>@{username}</span>}
              </div>
              <p className={bio === '' ? styles.bioEmpty : styles.bio}>
                {bio === '' ? '尚未填写个人简介，去“编辑资料”写下一句话描述你的教学或研究方向。' : bio}
              </p>
              {chips.length > 0 ? (
                <div className={styles.chips}>
                  {chips.map((chip) => (
                    <span className={styles.chip} key={chip}>
                      {chip}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          <div className={styles.profileActions}>
            <Link className={styles.primaryBtn} to="/settings/profile">
              <StudioIcon name="edit" />
              编辑资料
            </Link>
            <button type="button" className={styles.secondaryBtn} onClick={createBlankCanvas}>
              <StudioIcon name="plus" />
              新建空白画布
            </button>
          </div>
        </section>

        {/* § 01 实时统计与快捷通道 */}
        <section className={styles.sectionBlock} aria-label="统计概况与快捷入口">
          <div className={styles.telemetryStrip}>
            <div className={styles.statGrid}>
              <div className={styles.statCell}>
                <span className={styles.statIndex}>01 / LIVING PAGES</span>
                <strong className={materialsQuery.isError ? styles.statUnavailable : styles.statValue}>
                  {materialCountLabel}
                </strong>
                <span className={styles.statLabel}>份动态活页课件</span>
              </div>
              <div className={styles.statCell}>
                <span className={styles.statIndex}>02 / WORKSHOP</span>
                <strong className={worksError ? styles.statUnavailable : styles.statValue}>
                  {workCountLabel}
                </strong>
                <span className={styles.statLabel}>件万象工坊作品</span>
              </div>
              <div className={styles.statCell}>
                <span className={styles.statIndex}>03 / INTERACTIVE</span>
                <strong className={materialsQuery.isError ? styles.statUnavailable : styles.statValue}>
                  {materialsQuery.isLoading ? '—' : materialsQuery.isError ? '未读取' : objectCount}
                </strong>
                <span className={styles.statLabel}>个活页交互对象</span>
              </div>
            </div>

            <div className={styles.quickDock} aria-label="快捷操作">
              <Link className={styles.quickTile} to="/workshop">
                <span className={styles.quickIcon} aria-hidden="true">
                  <StudioIcon name="workshop" />
                </span>
                <div className={styles.quickCopy}>
                  <strong>万象工坊 ↗</strong>
                  <span>学科实验模板与积木编排</span>
                </div>
              </Link>

              <Link className={styles.quickTile} to="/living">
                <span className={styles.quickIcon} aria-hidden="true">
                  <StudioIcon name="layers" />
                </span>
                <div className={styles.quickCopy}>
                  <strong>万象活页 ↗</strong>
                  <span>动态 PPT 演示与插件挂载</span>
                </div>
              </Link>

              {latestMaterial === null ? (
                <button type="button" className={styles.quickTile} onClick={triggerImport} disabled={importing}>
                  <span className={styles.quickIcon} aria-hidden="true">
                    <StudioIcon name="upload" />
                  </span>
                  <div className={styles.quickCopy}>
                    <strong>{importing ? '导入中…' : '导入工程包 ↗'}</strong>
                    <span>恢复 .xsproj 或单文件 HTML</span>
                  </div>
                </button>
              ) : (
                <Link
                  className={styles.quickTile}
                  to={`/materials/${latestMaterial.material_id}/work?page=1`}
                >
                  <span className={styles.quickIcon} aria-hidden="true">
                    <StudioIcon name="clock" />
                  </span>
                  <div className={styles.quickCopy}>
                    <strong>继续最近活页 ↗</strong>
                    <span>{latestMaterial.title}</span>
                  </div>
                </Link>
              )}
            </div>
          </div>
        </section>

        {/* § 02 我的内容档案 */}
        <section className={styles.sectionBlock} aria-labelledby="space-content-title">
          <div className={styles.sectionHead}>
            <div className={styles.sectionTitleGroup}>
              <span className={styles.sectionIndex}>§ 02 / MY COLLECTION</span>
              <h2 className={styles.sectionTitle} id="space-content-title">
                我的资产档案
              </h2>
              <p>统一管理当前保存的万象活页课件与万象工坊作品。</p>
            </div>
            <div className={styles.tabs} role="tablist" aria-label="内容分类">
              <button
                type="button"
                role="tab"
                id="space-tab-materials"
                aria-controls="space-panel-materials"
                aria-selected={tab === 'materials'}
                tabIndex={tab === 'materials' ? 0 : -1}
                className={tab === 'materials' ? styles.tabActive : styles.tab}
                onClick={() => setTab('materials')}
                onKeyDown={handleTabKeys}
              >
                万象活页课件 <span className={styles.tabCount}>{materialCountLabel}</span>
              </button>
              <button
                type="button"
                role="tab"
                id="space-tab-works"
                aria-controls="space-panel-works"
                aria-selected={tab === 'works'}
                tabIndex={tab === 'works' ? 0 : -1}
                className={tab === 'works' ? styles.tabActive : styles.tab}
                onClick={() => setTab('works')}
                onKeyDown={handleTabKeys}
              >
                万象工坊作品 <span className={styles.tabCount}>{workCountLabel}</span>
              </button>
            </div>
          </div>

          {tab === 'materials' ? (
            <div role="tabpanel" id="space-panel-materials" aria-labelledby="space-tab-materials" tabIndex={0}>
              <LivingMaterialsSection
                query={materialsQuery}
                now={now}
                removedIds={removedIds}
                confirmingId={confirmingId}
                deletingId={deleteMaterial.variables}
                notice={notice}
                importing={importing}
                importError={importError}
                onDismissNotice={() => setNotice(null)}
                onDelete={handleDeleteMaterial}
                onConfirm={setConfirmingId}
                onCancel={() => setConfirmingId(null)}
                onGoLiving={goLiving}
                onTriggerImport={triggerImport}
              />
            </div>
          ) : (
            <div role="tabpanel" id="space-panel-works" aria-labelledby="space-tab-works" tabIndex={0}>
              <WorkshopWorksSection
                works={works}
                loading={worksLoading}
                error={worksError}
                confirmingWorkId={confirmingWorkId}
                deletingWorkId={deletingWorkId}
                onRetry={loadWorks}
                onConfirmDelete={setConfirmingWorkId}
                onCancelDelete={() => setConfirmingWorkId(null)}
                onDeleteWork={(id) => void handleDeleteWork(id)}
                onCreateBlank={createBlankCanvas}
              />
            </div>
          )}
        </section>

        <footer className={styles.syncFooter}>
          <span className={styles.cross}>+</span>
          <span>
            资产说明：活页课件与工坊作品支持导出为 .xsproj 工程包或单文件 HTML 离线保存；头像、昵称、简介及学科偏好随账号永久保存。
          </span>
        </footer>
      </main>
    </div>
  );
}

export default SpacePage;
