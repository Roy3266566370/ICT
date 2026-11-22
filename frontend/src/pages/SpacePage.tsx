import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { UseQueryResult } from '@tanstack/react-query';
import type { MaterialStatus, MaterialSummary, MaterialsListResponse } from '@/api/types';
import { useDeleteMaterial, useLabs, useMaterials } from '@/api/hooks';
import { SUBJECT_LABELS, type LabSummary } from '@/labs/types';
import { MathText } from '@/components/labs/ProblemText';
import { StatusBadge } from '@/components/ui';
import { SiteNav } from '@/components/home/SiteNav';
import { SCENARIOS } from '@/components/home/scenarios';
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

/** 材料状态标签：与 StatusBadge 的配色互补，保证状态不只靠颜色传达。 */
const STATUS_LABELS: Record<MaterialStatus, string> = {
  processing: '处理中',
  awaiting_confirmation: '等待确认',
  ready: '可用于交互',
  failed: '失败',
};

function labStatusLabel(status: LabSummary['status'], aiVerification?: string | null): string {
  if (status === 'reference') return '参考解答';
  if (aiVerification === 'kernel') return '内核已计算';
  if (aiVerification === 'ai_reference') return 'AI 参考解答';
  if (aiVerification === 'needs_review') return 'AI 解答待核对';
  if (status === 'ready') return '可推演';
  if (status === 'pending_ai') return '等待 AI 理解';
  if (status === 'needs_review') return '待核对';
  if (status === 'unsupported') return '暂不支持';
  return '需修正';
}

type StudioIconName = 'upload' | 'lab' | 'document' | 'clock' | 'arrow' | 'edit' | 'browser' | 'layers';

function StudioIcon({ name }: { name: StudioIconName }): JSX.Element {
  const paths: Record<StudioIconName, JSX.Element> = {
    upload: (
      <>
        <path d="M12 16V4m-4 4 4-4 4 4" />
        <path d="M5 14v5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5" />
      </>
    ),
    lab: (
      <>
        <path d="M9 3h6m-5 0v6l-5.5 9.5A2.3 2.3 0 0 0 6.5 22h11a2.3 2.3 0 0 0 2-3.5L14 9V3" />
        <path d="M8 15h8m-6 3h.01M14 18h.01" />
      </>
    ),
    document: (
      <>
        <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8Z" />
        <path d="M14 3v5h5M9 12h6m-6 4h6" />
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
    browser: (
      <>
        <rect x="3" y="5" width="18" height="15" rx="1" />
        <path d="M3 9h18M7 7h.01M10 7h.01" />
      </>
    ),
    layers: (
      <>
        <path d="m12 3 9 4.5-9 4.5-9-4.5L12 3Z" />
        <path d="m3 12 9 4.5 9-4.5" />
        <path d="m3 16.5 9 4.5 9-4.5" />
      </>
    ),
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

/** 到期倒计时每 30 秒刷新一次，兼顾准确度与渲染开销。 */
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

function readOptionalString(source: unknown, keys: readonly string[]): string | null {
  if (typeof source !== 'object' || source === null) return null;
  const bag = source as Record<string, unknown>;
  for (const key of keys) {
    const value = bag[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}

function readOptionalNumber(source: unknown, keys: readonly string[]): number | null {
  if (typeof source !== 'object' || source === null) return null;
  const bag = source as Record<string, unknown>;
  for (const key of keys) {
    const value = bag[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

function resolveTemplateLabel(item: MaterialSummary): string {
  const templateId = readOptionalString(item, ['template_id', 'templateId']);
  if (templateId === null) return '未标注';
  const scenario = SCENARIOS.find((entry) => entry.templateId === templateId);
  return scenario ? scenario.name : templateId;
}

function TemplateCell({ label }: { label: string }): JSX.Element {
  if (label !== '未标注') {
    return <span className={styles.cellValue}>{label}</span>;
  }
  return (
    <span
      className={styles.cellValueMuted}
      title="当前材料没有模板标记，进入工作台可查看对象模板"
    >
      未标注
    </span>
  );
}

interface MaterialsSectionProps {
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
  onUpload: () => void;
  onTriggerImport: () => void;
}

/** 材料列表：已登录态「我的材料」与访客会话共用。 */
function MaterialsSection({
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
  onUpload,
  onTriggerImport,
}: MaterialsSectionProps): JSX.Element {
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
            {query.isLoading ? '正在读取材料…' : query.isError ? '数量暂不可用' : <>共 <strong>{items.length}</strong> 份材料</>}
          </span>
          <span>
            {retentionExpiresAt ? (
              <>
                保留至 <time dateTime={retentionExpiresAt}>{formatDateTime(retentionExpiresAt)}</time>
              </>
            ) : (
              '创建后保留 24 小时'
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
            {importing ? '导入中…' : '导入工程 / HTML'}
          </button>
          <button type="button" className={styles.toolbarBtnPrimary} onClick={onUpload}>
            + 上传新材料
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
            title="材料暂时无法读取"
            onRetry={() => {
              void query.refetch();
            }}
          />
        </div>
      ) : null}

      {query.isLoading ? (
        <div className={styles.loading} aria-busy="true" aria-live="polite">
          <p>正在恢复当前浏览器上的材料…</p>
          <div className={styles.skeleton} aria-hidden="true" />
          <div className={styles.skeleton} aria-hidden="true" />
        </div>
      ) : items.length === 0 && !query.isError ? (
        <div className={styles.emptyBox} aria-labelledby="space-empty-title">
          <div className={styles.emptyContent}>
            <span className={styles.emptyBadge}>EMPTY ARCHIVE</span>
            <h3 className={styles.emptyTitle} id="space-empty-title">
              当前会话尚无课件材料
            </h3>
            <p className={styles.emptyLead}>
              上传一份 PPT 课件或导入本地 .xsproj 工程包 / 单文件 .html 交互网页，即可恢复为可调参的交互工作台。
            </p>
          </div>
          <div className={styles.emptyActions}>
            <button type="button" className={styles.primaryBtn} onClick={onUpload}>
              上传 PPT 材料 <StudioIcon name="arrow" />
            </button>
            <button
              type="button"
              className={styles.secondaryBtn}
              disabled={importing}
              onClick={onTriggerImport}
            >
              {importing ? '导入中…' : '导入工程包'}
            </button>
            <Link className={styles.ghostLink} to="/labs#lab-samples-title">
              浏览交互示例 →
            </Link>
          </div>
        </div>
      ) : items.length > 0 ? (
        <>
          <div className={styles.listHead} aria-hidden="true">
            <span>材料名称</span>
            <span>对象模板</span>
            <span>状态</span>
            <span>保留倒计时</span>
            <span>对象 / 运行</span>
            <span>操作</span>
          </div>

          <ul className={styles.list} aria-label="材料列表">
            {items.map((item, idx) => {
              const remaining = describeRemaining(item.expires_at, now);
              const runCount = readOptionalNumber(item, ['run_count', 'runs_count']);
              const deleting = deletingId === item.material_id;
              return (
                <li className={styles.row} key={item.material_id}>
                  <div className={styles.cellName}>
                    <span className={styles.rowIndex}>{String(idx + 1).padStart(2, '0')}</span>
                    <div className={styles.itemNameText}>
                      <Link className={styles.nameLink} to={`/materials/${item.material_id}/work`}>
                        {item.title}
                      </Link>
                      <span className={styles.pageCount}>{item.page_count} 页</span>
                    </div>
                  </div>

                  <div className={styles.cell}>
                    <span className={styles.cellLabel}>模板</span>
                    <TemplateCell label={resolveTemplateLabel(item)} />
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
                    <span className={styles.cellLabel}>对象 / 运行</span>
                    <span className={styles.cellValue}>
                      {item.object_count} 个对象
                      {runCount === null ? '' : ` · ${runCount} 次运行`}
                    </span>
                  </div>

                  <div className={styles.cellActions}>
                    <Link className={styles.openLink} to={`/materials/${item.material_id}/work`}>
                      打开工作台
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
                        aria-label={`删除材料：${item.title}`}
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
            删除材料后，原始文件与派生知识对象将一并清理，无法恢复。
          </p>
        </>
      ) : null}
    </div>
  );
}

interface LabsSectionProps {
  query: UseQueryResult<LabSummary[]>;
}

/** 题目实验列表：采用档案卡片网格展示当前会话下的建模与推演记录。 */
function LabsSection({ query }: LabsSectionProps): JSX.Element {
  if (query.isLoading) {
    return (
      <div className={styles.loading} aria-busy="true" aria-live="polite">
        <p>正在读取题目实验…</p>
        <div className={styles.skeleton} aria-hidden="true" />
        <div className={styles.skeleton} aria-hidden="true" />
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className={styles.noticeWrap}>
        <ErrorNotice
          {...readApiError(query.error)}
          title="题目实验暂时无法读取"
          onRetry={() => {
            void query.refetch();
          }}
        />
      </div>
    );
  }

  const labs = query.data ?? [];
  if (labs.length === 0) {
    return (
      <div className={styles.emptyBox} aria-labelledby="space-labs-empty-title">
        <div className={styles.emptyContent}>
          <span className={styles.emptyBadge}>EMPTY LABS</span>
          <h3 className={styles.emptyTitle} id="space-labs-empty-title">
            还没有题目实验记录
          </h3>
          <p className={styles.emptyLead}>
            前往题目实验室按学科题型输入公式，或上传题目截图，即可生成可调参的交互实验台。
          </p>
        </div>
        <div className={styles.emptyActions}>
          <Link className={styles.primaryBtn} to="/labs">
            进入题目实验室 <StudioIcon name="arrow" />
          </Link>
          <Link className={styles.ghostLink} to="/labs#lab-samples-title">
            先体验通用示例 →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.labsGrid} aria-label="题目实验列表">
      {labs.map((lab, idx) => (
        <Link key={lab.lab_id} to={`/labs/${lab.lab_id}`} className={styles.labCard}>
          <div className={styles.labCardTop}>
            <span className={styles.labCardIdx}>#{String(idx + 1).padStart(2, '0')}</span>
            <span className={styles.labCardSubject}>
              {lab.subject_label} · {lab.problem_count} 题
            </span>
            <em className={styles.labCardStatus} data-status={lab.status}>
              {labStatusLabel(lab.status, lab.ai_verification)}
            </em>
          </div>
          <strong className={styles.labCardTitle}>
            <MathText text={lab.title} />
          </strong>
          <div className={styles.labCardFoot}>
            <span>更新于 {formatDateTime(lab.updated_at)}</span>
            <span className={styles.labCardArrow}>进入实验台 →</span>
          </div>
        </Link>
      ))}
    </div>
  );
}

/**
 * 个人主页 `/space`。
 *
 * 采用纸面、墨线、群青与朱砂的工作室档案排版：
 * - 登录态：个人档案卡（头像/昵称/@用户名/简介/标签）+ 实时统计与快捷通道 + 我的内容档案库；
 * - 访客态：清晰的工作区导览卡 + 当前浏览器会话的材料与题目实验切换栏 + 诚实存储边界说明。
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
  const labsQuery = useLabs(status !== 'restoring');
  const deleteMaterial = useDeleteMaterial();

  const projectInput = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [tab, setTab] = useState<'materials' | 'labs'>('materials');
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

  const materials = useMemo(
    () =>
      (materialsQuery.data?.items ?? []).filter(
        (item) => !removedIds.includes(item.material_id),
      ),
    [materialsQuery.data?.items, removedIds],
  );
  const latestMaterial = materials[0] ?? null;
  const objectCount = materials.reduce((sum, item) => sum + item.object_count, 0);
  const labCount = labsQuery.data?.length ?? null;
  const materialCountLabel = materialsQuery.isLoading
    ? '—'
    : materialsQuery.isError ? '未读取' : materials.length;
  const labCountLabel = labsQuery.isLoading
    ? '—'
    : labsQuery.isError ? '未读取' : labCount ?? '—';

  const handleTabKeys = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const nextTab = event.key === 'Home'
      ? 'materials'
      : event.key === 'End' ? 'labs' : tab === 'materials' ? 'labs' : 'materials';
    setTab(nextTab);
    document.getElementById(`space-tab-${nextTab}`)?.focus();
  };

  const handleDelete = (item: MaterialSummary): void => {
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

  const goUpload = (): void => {
    navigate('/#upload');
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
          {/* 顶部元数据栏 */}
          <div className={styles.studioMeta}>
            <span className={styles.eyebrow}>
              <span className={styles.cross}>+</span> PERSONAL STUDIO · 个人主页
            </span>
            <span className={styles.metaCode}>
              {status === 'unavailable' ? 'LOCAL MODE · 账号服务暂不可用' : 'GUEST SESSION · 当前浏览器工作区'}
            </span>
          </div>

          {/* Hero 双栏：左叙事与登录引导 · 右 2x2 工作区矩阵 */}
          <section className={styles.guestHero} aria-labelledby="space-guest-title">
            <div className={styles.guestMain}>
              <h1 id="space-guest-title" className={styles.heroTitle}>
                每一次探索，<br />都沉淀为<em>个人工作集</em>。
              </h1>
              <p className={styles.heroLead}>
                当前浏览器中的课件材料与题目实验已自动留存；登录账号后可统一管理头像、昵称、简介与学科偏好。
              </p>
              <div className={styles.heroActions}>
                <Link className={styles.primaryBtn} to="/login?returnTo=%2Fspace">
                  登录我的主页 <StudioIcon name="arrow" />
                </Link>
                <Link className={styles.secondaryBtn} to="/register">
                  免费注册
                </Link>
                <Link className={styles.ghostLink} to="/labs">
                  先去题目实验室 →
                </Link>
              </div>
              <p className={styles.statusHint}>
                {status === 'unavailable'
                  ? '账号服务暂时不可用，但不影响继续查看或操作本浏览器内保存的材料与实验。'
                  : '本机保存的材料与题目实验不受登录状态切换影响，登录后可随时继续。'}
              </p>
            </div>

            <aside className={styles.matrixCard} aria-label="工作区快捷入口">
              <div className={styles.matrixHead}>
                <span>WORKSPACE ACCESS · 工作室通道</span>
                <span>4 个常用入口</span>
              </div>
              <div className={styles.matrixGrid}>
                <Link className={styles.matrixCell} to="/labs">
                  <span className={styles.matrixIdx}>01</span>
                  <div className={styles.matrixBody}>
                    <strong>题目实验室 ↗</strong>
                    <span>按高数/408/大物题型直接建模</span>
                  </div>
                </Link>
                <Link className={styles.matrixCell} to="/living">
                  <span className={styles.matrixIdx}>02</span>
                  <div className={styles.matrixBody}>
                    <strong>万象活页 ↗</strong>
                    <span>动态 PPT 工作台与原位交互编辑</span>
                  </div>
                </Link>
                <Link className={styles.matrixCell} to="/workshop">
                  <span className={styles.matrixIdx}>03</span>
                  <div className={styles.matrixBody}>
                    <strong>万象工坊 ↗</strong>
                    <span>积木拼接与数值仿真实验</span>
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

          {/* § 01 当前会话工作区：支持材料与题目实验双 Tab */}
          <section className={styles.sectionBlock} aria-labelledby="space-guest-collection-title">
            <div className={styles.sectionHead}>
              <div className={styles.sectionTitleGroup}>
                <span className={styles.sectionIndex}>§ 01 / BROWSER WORKSPACE</span>
                <h2 className={styles.sectionTitle} id="space-guest-collection-title">
                  当前浏览器上的工作档案
                </h2>
                <p>正在展示本浏览器会话内保存的材料（{materialCountLabel}）与题目实验（{labCountLabel}）。</p>
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
                  我的材料 <span className={styles.tabCount}>{materialCountLabel}</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  id="space-tab-labs"
                  aria-controls="space-panel-labs"
                  aria-selected={tab === 'labs'}
                  tabIndex={tab === 'labs' ? 0 : -1}
                  className={tab === 'labs' ? styles.tabActive : styles.tab}
                  onClick={() => setTab('labs')}
                  onKeyDown={handleTabKeys}
                >
                  题目实验 <span className={styles.tabCount}>{labCountLabel}</span>
                </button>
              </div>
            </div>

            {tab === 'materials' ? (
              <div role="tabpanel" id="space-panel-materials" aria-labelledby="space-tab-materials" tabIndex={0}>
                <MaterialsSection
                  query={materialsQuery}
                  now={now}
                  removedIds={removedIds}
                  confirmingId={confirmingId}
                  deletingId={deleteMaterial.variables}
                  notice={notice}
                  importing={importing}
                  importError={importError}
                  onDismissNotice={() => setNotice(null)}
                  onDelete={handleDelete}
                  onConfirm={setConfirmingId}
                  onCancel={() => setConfirmingId(null)}
                  onUpload={goUpload}
                  onTriggerImport={triggerImport}
                />
              </div>
            ) : (
              <div role="tabpanel" id="space-panel-labs" aria-labelledby="space-tab-labs" tabIndex={0}>
                <LabsSection query={labsQuery} />
              </div>
            )}
          </section>

          {/* § 02 存储与同步边界 */}
          <section className={styles.sectionBlock} aria-label="材料保留与同步说明">
            <div className={styles.specLedger}>
              <div className={styles.specItem}>
                <span>01 / 会话归属</span>
                <strong>跟随当前浏览器保留</strong>
                <p>材料与题目实验暂按浏览器访客会话存放，无需登录即可使用；更换设备后需重新上传或导入工程包。</p>
              </div>
              <div className={styles.specItem}>
                <span>02 / 清理周期</span>
                <strong>24 小时自动清理材料</strong>
                <p>课件材料到期后连同派生知识对象一并清理，你也可以在列表中随时手动删除。</p>
              </div>
              <div className={styles.specItem}>
                <span>03 / 账号范围</span>
                <strong>个人资料与偏好随账号保存</strong>
                <p>登录后可在设置中自定义头像、昵称、简介与常用学科，个人资料将在下次登录时完整恢复。</p>
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
  const defaultEntryLabel = profile?.default_entry === 'labs' ? '题目实验室' : '个人主页';
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
        {/* 顶部元数据栏 */}
        <div className={styles.studioMeta}>
          <span className={styles.eyebrow}>
            <span className={styles.cross}>+</span> PERSONAL STUDIO · 个人主页
          </span>
          <span className={styles.metaCode}>
            ACCOUNT · {username ? `@${username}` : user.email} · 默认入口：{defaultEntryLabel}
          </span>
        </div>

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
                {bio === '' ? '尚未填写个人简介，去“编辑资料”写下一句话描述你的研究方向。' : bio}
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
            <Link className={styles.secondaryBtn} to="/settings/profile">
              偏好设置
            </Link>
          </div>
        </section>

        {/* § 01 统计仪表与快捷工作台 */}
        <section className={styles.sectionBlock} aria-label="统计概况与快捷入口">
          <div className={styles.telemetryStrip}>
            <div className={styles.statGrid}>
              <div className={styles.statCell}>
                <span className={styles.statIndex}>01 / MATERIALS</span>
                <strong className={materialsQuery.isError ? styles.statUnavailable : styles.statValue}>
                  {materialCountLabel}
                </strong>
                <span className={styles.statLabel}>份浏览器材料</span>
              </div>
              <div className={styles.statCell}>
                <span className={styles.statIndex}>02 / QUESTION LABS</span>
                <strong className={labsQuery.isError ? styles.statUnavailable : styles.statValue}>
                  {labCountLabel}
                </strong>
                <span className={styles.statLabel}>个题目实验</span>
              </div>
              <div className={styles.statCell}>
                <span className={styles.statIndex}>03 / OBJECTS</span>
                <strong className={materialsQuery.isError ? styles.statUnavailable : styles.statValue}>
                  {materialsQuery.isLoading ? '—' : materialsQuery.isError ? '未读取' : objectCount}
                </strong>
                <span className={styles.statLabel}>个知识对象</span>
              </div>
            </div>

            <div className={styles.quickDock} aria-label="快捷操作">
              <Link className={styles.quickTile} to="/labs">
                <span className={styles.quickIcon} aria-hidden="true">
                  <StudioIcon name="lab" />
                </span>
                <div className={styles.quickCopy}>
                  <strong>题目实验室 ↗</strong>
                  <span>结构化输入公式或原图建模</span>
                </div>
              </Link>

              <Link className={styles.quickTile} to="/living">
                <span className={styles.quickIcon} aria-hidden="true">
                  <StudioIcon name="layers" />
                </span>
                <div className={styles.quickCopy}>
                  <strong>万象活页 ↗</strong>
                  <span>动态 PPT 演示与原位交互编辑</span>
                </div>
              </Link>

              {latestMaterial === null ? (
                <button type="button" className={styles.quickTile} onClick={goUpload}>
                  <span className={styles.quickIcon} aria-hidden="true">
                    <StudioIcon name="upload" />
                  </span>
                  <div className={styles.quickCopy}>
                    <strong>上传 PPT 材料 ↗</strong>
                    <span>转化为可调参的交互对象</span>
                  </div>
                </button>
              ) : (
                <Link
                  className={styles.quickTile}
                  to={`/materials/${latestMaterial.material_id}/work`}
                >
                  <span className={styles.quickIcon} aria-hidden="true">
                    <StudioIcon name="clock" />
                  </span>
                  <div className={styles.quickCopy}>
                    <strong>继续最近作品 ↗</strong>
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
                我的学习档案
              </h2>
              <p>切换查看当前浏览器会话内保存的课件材料与题目实验。</p>
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
                我的材料 <span className={styles.tabCount}>{materialCountLabel}</span>
              </button>
              <button
                type="button"
                role="tab"
                id="space-tab-labs"
                aria-controls="space-panel-labs"
                aria-selected={tab === 'labs'}
                tabIndex={tab === 'labs' ? 0 : -1}
                className={tab === 'labs' ? styles.tabActive : styles.tab}
                onClick={() => setTab('labs')}
                onKeyDown={handleTabKeys}
              >
                题目实验 <span className={styles.tabCount}>{labCountLabel}</span>
              </button>
            </div>
          </div>

          {tab === 'materials' ? (
            <div role="tabpanel" id="space-panel-materials" aria-labelledby="space-tab-materials" tabIndex={0}>
              <MaterialsSection
                query={materialsQuery}
                now={now}
                removedIds={removedIds}
                confirmingId={confirmingId}
                deletingId={deleteMaterial.variables}
                notice={notice}
                importing={importing}
                importError={importError}
                onDismissNotice={() => setNotice(null)}
                onDelete={handleDelete}
                onConfirm={setConfirmingId}
                onCancel={() => setConfirmingId(null)}
                onUpload={goUpload}
                onTriggerImport={triggerImport}
              />
            </div>
          ) : (
            <div role="tabpanel" id="space-panel-labs" aria-labelledby="space-tab-labs" tabIndex={0}>
              <LabsSection query={labsQuery} />
            </div>
          )}
        </section>

        {/* 底栏存储边界注记 */}
        <footer className={styles.syncFooter}>
          <span className={styles.cross}>+</span>
          <span>
            诚实边界说明：材料与题目实验当前按浏览器访客会话保存（暂不跨设备云端同步）；头像、昵称、简介及学科偏好随账号永久保存。
          </span>
        </footer>
      </main>
    </div>
  );
}

export default SpacePage;
