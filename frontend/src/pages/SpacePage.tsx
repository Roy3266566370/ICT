import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { UseQueryResult } from '@tanstack/react-query';
import type { MaterialStatus, MaterialSummary, MaterialsListResponse } from '@/api/types';
import { useDeleteMaterial, useLabs, useMaterials } from '@/api/hooks';
import type { LabSummary } from '@/labs/types';
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

/** 材料状态的中文名：与 StatusBadge 的配色互补，保证"不只靠颜色"（R14-AC5）。 */
const STATUS_LABELS: Record<MaterialStatus, string> = {
  processing: '处理中',
  awaiting_confirmation: '等待确认',
  ready: '可用于交互',
  failed: '失败',
};

const LAB_STATUS_LABELS: Record<LabSummary['status'], string> = {
  ready: '可推演',
  needs_review: '待核对',
  unsupported: '暂不支持',
  pending_ai: '等待 AI 理解',
  reference: '参考解答',
};

type StudioIconName = 'upload' | 'lab' | 'document' | 'clock' | 'arrow' | 'edit' | 'browser';

function StudioIcon({ name }: { name: StudioIconName }): JSX.Element {
  const paths: Record<StudioIconName, JSX.Element> = {
    upload: (
      <><path d="M12 16V4m-4 4 4-4 4 4" /><path d="M5 14v5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5" /></>
    ),
    lab: (
      <><path d="M9 3h6m-5 0v6l-5.5 9.5A2.3 2.3 0 0 0 6.5 22h11a2.3 2.3 0 0 0 2-3.5L14 9V3" /><path d="M8 15h8m-6 3h.01M14 18h.01" /></>
    ),
    document: (
      <><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8Z" /><path d="M14 3v5h5M9 12h6m-6 4h6" /></>
    ),
    clock: <><circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2" /></>,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    edit: <><path d="m15 4 5 5M4 20l5-1L20 8a2.1 2.1 0 0 0-3-3L6 16Z" /><path d="M13 20h7" /></>,
    browser: <><rect x="3" y="5" width="18" height="15" rx="2" /><path d="M3 9h18M7 7h.01M10 7h.01" /></>,
  };
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

/** Local vector illustration keeps the studio light and independent of external assets. */
function StudioIllustration(): JSX.Element {
  return (
    <svg className={styles.studioIllustration} viewBox="0 0 400 280" fill="none" aria-hidden="true">
      <circle cx="218" cy="132" r="112" stroke="currentColor" strokeOpacity=".13" />
      <ellipse cx="218" cy="132" rx="154" ry="58" transform="rotate(-29 218 132)" stroke="currentColor" strokeOpacity=".16" />
      <path d="M47 231h310M218 7v250" stroke="currentColor" strokeOpacity=".09" strokeDasharray="3 6" />
      <g transform="rotate(-12 201 140)">
        <rect x="115" y="51" width="149" height="179" rx="9" fill="#ede9df" stroke="#d9d5ca" />
      </g>
      <g transform="rotate(7 217 135)">
        <rect x="143" y="39" width="146" height="181" rx="9" fill="#fbfaf7" stroke="#d4d1c7" />
        <path d="M164 65h48m-48 9h27M165 185h103m-103 11h69" stroke="#aaa99e" strokeWidth="2" strokeLinecap="round" />
        <path d="M174 158v-55m0 55h88" stroke="#bbb9ad" />
        <path d="m174 145 24-21 24 11 36-43" stroke="#b65a3c" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="222" cy="135" r="4" fill="#fbfaf7" stroke="#b65a3c" strokeWidth="2" />
      </g>
      <circle cx="321" cy="84" r="6" fill="#b65a3c" />
      <path d="M89 120h12m-6-6v12M308 219h8m-4-4v8" stroke="#a6a89b" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** 到期倒计时每 30 秒刷新一次：足够精确，又不会让页面每秒重渲染。 */
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

/**
 * `MaterialSummary` 的契约（§2.2.7）没有 `template_id` / 运行数。
 * 这里做"可选字段"容错读取：接到就展示，接不到如实显示"未标注"，
 * 不修改 T2 的类型、也不猜测材料模板。
 */
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

/**
 * 模板列：`MaterialSummary` 不携带 `template_id`（§2.2.7），
 * 拿到可选字段就显示中文模板名，拿不到就如实显示"未标注"并说明去准备页查看，
 * 不根据标题猜测模板。
 */
function TemplateCell({ label }: { label: string }): JSX.Element {
  if (label !== '未标注') {
    return <span className={styles.cellValue}>{label}</span>;
  }
  return (
    <span
      className={styles.cellValueMuted}
      title="当前材料没有模板标记，进入准备页可查看对象模板"
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
  onDismissNotice: () => void;
  onDelete: (item: MaterialSummary) => void;
  onConfirm: (materialId: string) => void;
  onCancel: () => void;
  onUpload: () => void;
}

/** 材料列表：个人主页「我的材料」与访客态共用。 */
function MaterialsSection({
  query,
  now,
  removedIds,
  confirmingId,
  deletingId,
  notice,
  onDismissNotice,
  onDelete,
  onConfirm,
  onCancel,
  onUpload,
}: MaterialsSectionProps): JSX.Element {
  const navigate = useNavigate();
  const projectInput = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const importProject = async (file: File) => {
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
  const items = useMemo(
    () => (query.data?.items ?? []).filter((item) => !removedIds.includes(item.material_id)),
    [query.data?.items, removedIds],
  );
  const retentionExpiresAt = query.data?.retention_expires_at ?? null;

  return (
    <>
      <input ref={projectInput} type="file" accept=".xsproj,application/zip" hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void importProject(file);
        }}/>
      <div className={styles.metaLine}>
        <span>
          {query.isLoading ? '正在读取材料' : query.isError ? '材料数量暂不可用' : <>共 <strong>{items.length}</strong> 份材料</>}
        </span>
        {retentionExpiresAt ? (
          <span>
            会话材料统一保留至{' '}
            <time dateTime={retentionExpiresAt}>{formatDateTime(retentionExpiresAt)}</time>
          </span>
        ) : (
          <span>保留期限：自创建起 24 小时</span>
        )}
        <button type="button" className={styles.ghost} disabled={importing} onClick={() => projectInput.current?.click()}>
          {importing ? '导入中…' : '导入工程包'}
        </button>
      </div>
      {importError ? <p className={styles.noticeWrap} role="alert">{importError}</p> : null}

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
          <p>正在恢复这个浏览器上的材料…</p>
          <div className={styles.skeleton} aria-hidden="true" />
          <div className={styles.skeleton} aria-hidden="true" />
          <div className={styles.skeleton} aria-hidden="true" />
        </div>
      ) : items.length === 0 && !query.isError ? (
        <section className={styles.empty} aria-labelledby="space-empty-title">
          <p className={styles.emptyIcon} aria-hidden="true">
            <StudioIcon name="document" />
          </p>
          <h2 className={styles.emptyTitle} id="space-empty-title">
            从一份材料，开始新的探索
          </h2>
          <p className={styles.emptyLead}>
            上传一份 PPT，或先打开一个场景示例看看效果。材料跟着当前浏览器的访客会话走，保留 24
            小时。
          </p>
          <div className={styles.emptyActions}>
            <button type="button" className={styles.primary} onClick={onUpload}>
              上传 PPT
              <StudioIcon name="arrow" />
            </button>
            <Link className={styles.ghost} to="/examples">
              探索示例
            </Link>
            <button type="button" className={styles.ghost} disabled={importing} onClick={() => projectInput.current?.click()}>
              {importing ? '导入中…' : '导入工程包'}
            </button>
          </div>
        </section>
      ) : items.length > 0 ? (
        <>
          <div className={styles.listHead} aria-hidden="true">
            <span>名称</span>
            <span>模板</span>
            <span>状态</span>
            <span>到期</span>
            <span>对象 / 运行</span>
            <span>操作</span>
          </div>

          <ul className={styles.list} aria-label="材料列表">
            {items.map((item) => {
              const remaining = describeRemaining(item.expires_at, now);
              const runCount = readOptionalNumber(item, ['run_count', 'runs_count']);
              const deleting = deletingId === item.material_id;
              return (
                <li className={styles.row} key={item.material_id}>
                  <div className={styles.cellName}>
                    <span className={styles.fileIcon}>
                      <StudioIcon name="document" />
                    </span>
                    <div className={styles.itemNameText}>
                      <Link
                        className={styles.nameLink}
                        to={`/materials/${item.material_id}/work`}
                      >
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
                      打开网页
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
            删除材料后，原始文件与派生的知识对象会一并清理，无法再次访问。
          </p>
        </>
      ) : null}
    </>
  );
}

interface LabsSectionProps {
  query: UseQueryResult<LabSummary[]>;
}

/** 题目实验列表：只读展示当前浏览器会话下的实验。 */
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
      <section className={styles.empty} aria-labelledby="space-labs-empty-title">
        <p className={styles.emptyIcon} aria-hidden="true">
          <StudioIcon name="lab" />
        </p>
        <h2 className={styles.emptyTitle} id="space-labs-empty-title">
          还没有题目实验
        </h2>
        <p className={styles.emptyLead}>
          在题目实验室上传题目或粘贴文字，万象会把它整理成可推演的模型与分步实验。
        </p>
        <div className={styles.emptyActions}>
          <Link className={styles.primary} to="/labs">
            进入题目实验室
            <StudioIcon name="arrow" />
          </Link>
        </div>
      </section>
    );
  }

  return (
    <ul className={styles.labsList} aria-label="题目实验列表">
      {labs.map((lab) => (
        <li className={styles.labRow} key={lab.lab_id}>
          <span className={styles.fileIcon}><StudioIcon name="lab" /></span>
          <div className={styles.labMain}>
            <Link className={styles.labTitle} to={`/labs/${lab.lab_id}`}>
              {lab.title}
            </Link>
            <p className={styles.labMeta}>
              <span>{lab.subject_label}</span>
              <span>{lab.problem_count} 道题目</span>
              <span>{LAB_STATUS_LABELS[lab.status]}</span>
              <span>更新于 {formatDateTime(lab.updated_at)}</span>
            </p>
          </div>
          <Link className={styles.openLink} to={`/labs/${lab.lab_id}`}>
            打开实验
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * 个人主页 `/space`。
 *
 * 登录用户：资料区（头像/昵称/@用户名/简介）+ 快捷操作 + 使用概况
 * + 「我的材料 / 题目实验」切换；
 * 访客/账号服务不可用：保留当前浏览器会话的材料列表，并引导登录。
 *
 * 诚实边界：材料与题目实验仍按访客会话（浏览器）保存，尚未与账号长期绑定；
 * 页面不宣称跨设备同步，只说明头像、昵称、简介与偏好随账号保存。
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
  const labsQuery = useLabs(authenticated);
  const deleteMaterial = useDeleteMaterial();

  const [tab, setTab] = useState<'materials' | 'labs'>('materials');
  const [removedIds, setRemovedIds] = useState<readonly string[]>([]);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<NoticeState | null>(null);

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
  const labCountLabel = labsQuery.isError ? '未读取' : labCount ?? '—';

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

  if (status === 'restoring') {
    return (
      <div className={styles.page}>
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

  if (!authenticated) {
    return (
      <div className={styles.page}>
        <SiteNav current="workspace" appearance="studio" />
        <main id="main" className={styles.main}>
          <div className={styles.workspaceIntro}>
            <span>万象 / 个人主页</span>
            <span className={styles.workspaceCaption}>A SPACE FOR YOUR IDEAS</span>
          </div>
          <header className={styles.head}>
            <div className={styles.headText}>
              <p className={styles.eyebrow}>YOUR PERSONAL STUDIO</p>
              <h1 className={styles.title}>每一次探索，<br />都从这里继续。</h1>
              <p className={styles.lead}>
                登录后，这里就是你的主页。设置头像、昵称与简介，<br className={styles.desktopBreak} />在同一处查看材料与题目实验。
              </p>
              <div className={styles.headActions}>
                <Link className={styles.primary} to="/login?returnTo=%2Fspace">
                  登录我的主页 <StudioIcon name="arrow" />
                </Link>
                <Link className={styles.ghost} to="/register">
                  免费注册
                </Link>
              </div>
              <p className={styles.guestNote}>
                {status === 'unavailable'
                  ? '账号服务暂时不可用，公开内容仍可浏览；可以稍后重试登录。'
                  : '当前浏览器上的材料不受影响，登录后也能继续查看。'}
              </p>
            </div>
            <div className={styles.guestVisual}>
              <StudioIllustration />
              <span>把想法变成可以探索的世界</span>
            </div>
          </header>

          <div className={styles.guestSectionHead}>
            <h2 className={styles.sectionTitle}>这个浏览器上的材料</h2>
            <span className={styles.sessionLabel}><StudioIcon name="browser" /> 当前浏览器会话</span>
          </div>
          <MaterialsSection
            query={materialsQuery}
            now={now}
            removedIds={removedIds}
            confirmingId={confirmingId}
            deletingId={deleteMaterial.variables}
            notice={notice}
            onDismissNotice={() => setNotice(null)}
            onDelete={handleDelete}
            onConfirm={setConfirmingId}
            onCancel={() => setConfirmingId(null)}
            onUpload={goUpload}
          />

          <section className={styles.tips} aria-label="材料保留与清理规则">
            <div>
              <strong>跟着浏览器走</strong>
              <p>材料与当前浏览器的访客会话绑定，不需要注册账号；换设备就看不到。</p>
            </div>
            <div>
              <strong>24 小时自动清理</strong>
              <p>到期后原始文件与派生对象一起删除，期间可以随时手动删除。</p>
            </div>
            <div>
              <strong>登录后仍有这一页</strong>
              <p>登录后可设置头像与简介；材料与实验仍按浏览器会话展示，暂不跨设备同步。</p>
            </div>
          </section>
        </main>
      </div>
    );
  }

  const displayName = user.display_name.trim() === '' ? user.email : user.display_name;
  const username = user.username.trim();
  const bio = profile?.bio.trim() ?? '';
  const chips = [profile?.occupation ?? '', profile?.school ?? '', ...(profile?.interests ?? [])]
    .map((item) => item.trim())
    .filter((item) => item !== '');

  return (
    <div className={styles.page}>
      <SiteNav current="workspace" appearance="studio" />

      <main id="main" className={styles.main}>
        <div className={styles.workspaceIntro}>
          <span>万象 / 个人主页</span>
          <span className={styles.workspaceCaption}>YOUR PERSONAL STUDIO</span>
        </div>
        <section className={styles.profileHero} aria-labelledby="space-profile-title">
          <div className={styles.identity}>
            <Link className={styles.avatarFrame} to="/settings/profile" aria-label="编辑头像与个人资料">
              <AccountAvatar
                size="xl"
                label={displayName}
                avatarUrl={user.avatar_url ?? null}
                className={styles.profileAvatar}
              />
            </Link>
            <div className={styles.identityText}>
              <p className={styles.eyebrow}>每一次探索，都是新的可能</p>
              <h1 className={styles.profileName} id="space-profile-title">
                {displayName}
              </h1>
              {username === '' ? null : <p className={styles.handle}>@{username}</p>}
              <p className={bio === '' ? styles.bioEmpty : styles.bio}>
                {bio === '' ? '还没有填写简介。写一句话，让这份主页更像你。' : bio}
              </p>
              {chips.length === 0 ? null : (
                <p className={styles.chips}>
                  {chips.map((chip) => (
                    <span className={styles.chip} key={chip}>
                      {chip}
                    </span>
                  ))}
                </p>
              )}
            </div>
          </div>
          <div className={styles.profileActions}>
            <Link className={styles.primary} to="/settings/profile">
              <StudioIcon name="edit" />
              编辑资料
            </Link>
            <Link className={styles.ghost} to="/settings/profile">
              个人设置
            </Link>
          </div>
        </section>

        <section className={styles.quickGrid} aria-label="快捷操作">
          <button type="button" className={styles.quickCard} onClick={goUpload}>
            <span className={styles.quickIcon} aria-hidden="true">
              <StudioIcon name="upload" />
            </span>
            <span className={styles.quickBody}>
              <span className={styles.quickTitle}>上传 PPT</span>
              <span className={styles.quickDesc}>把一页课件变成可调参的知识对象</span>
            </span>
            <span className={styles.quickArrow} aria-hidden="true">
              <StudioIcon name="arrow" />
            </span>
          </button>
          <Link className={styles.quickCard} to="/labs">
            <span className={styles.quickIcon} aria-hidden="true">
              <StudioIcon name="lab" />
            </span>
            <span className={styles.quickBody}>
              <span className={styles.quickTitle}>进入题目实验室</span>
              <span className={styles.quickDesc}>从题目开始，搭一个可推演的分步实验</span>
            </span>
            <span className={styles.quickArrow} aria-hidden="true">
              <StudioIcon name="arrow" />
            </span>
          </Link>
          {latestMaterial === null ? (
            <Link className={styles.quickCard} to="/examples">
              <span className={styles.quickIcon} aria-hidden="true">
                <StudioIcon name="document" />
              </span>
              <span className={styles.quickBody}>
                <span className={styles.quickTitle}>从一个示例开始</span>
                <span className={styles.quickDesc}>还没有作品，先看看可交互示例</span>
              </span>
              <span className={styles.quickArrow} aria-hidden="true">
                <StudioIcon name="arrow" />
              </span>
            </Link>
          ) : (
            <Link
              className={styles.quickCard}
              to={`/materials/${latestMaterial.material_id}/work`}
            >
              <span className={styles.quickIcon} aria-hidden="true">
                <StudioIcon name="clock" />
              </span>
              <span className={styles.quickBody}>
                <span className={styles.quickTitle}>继续最近的作品</span>
                <span className={styles.quickMeta}>{latestMaterial.title}</span>
              </span>
              <span className={styles.quickArrow} aria-hidden="true">
                <StudioIcon name="arrow" />
              </span>
            </Link>
          )}
        </section>

        <section className={styles.statsRow} aria-label="使用概况">
          <div className={styles.statCard}>
            <span className={materialsQuery.isError ? styles.statUnavailable : styles.statValue}>
              {materialCountLabel}
            </span>
            <span className={styles.statLabel}>份材料</span>
          </div>
          <div className={styles.statCard}>
            <span className={labsQuery.isError ? styles.statUnavailable : styles.statValue}>
              {labCountLabel}
            </span>
            <span className={styles.statLabel}>个题目实验</span>
          </div>
          <div className={styles.statCard}>
            <span className={materialsQuery.isError ? styles.statUnavailable : styles.statValue}>
              {materialsQuery.isLoading ? '—' : materialsQuery.isError ? '未读取' : objectCount}
            </span>
            <span className={styles.statLabel}>个知识对象</span>
          </div>
          <p className={styles.statsNote}>
            <span className={styles.sessionLabel}><StudioIcon name="browser" /> 当前浏览器会话</span>
            统计来自当前浏览器会话中的真实数据；材料与实验暂未与账号长期绑定。
          </p>
        </section>

        <section className={styles.contentSection} aria-labelledby="space-content-title">
          <div className={styles.sectionHead}>
            <div>
              <p className={styles.sectionEyebrow}>MY COLLECTION</p>
              <h2 className={styles.sectionTitle} id="space-content-title">
                我的内容
              </h2>
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
                我的材料
                <span className={styles.tabCount}>{materialCountLabel}</span>
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
                题目实验
                <span className={styles.tabCount}>{labCountLabel}</span>
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
                onDismissNotice={() => setNotice(null)}
                onDelete={handleDelete}
                onConfirm={setConfirmingId}
                onCancel={() => setConfirmingId(null)}
                onUpload={goUpload}
              />
            </div>
          ) : (
            <div role="tabpanel" id="space-panel-labs" aria-labelledby="space-tab-labs" tabIndex={0}>
              <LabsSection query={labsQuery} />
            </div>
          )}
        </section>

        <p className={styles.syncNote}>
          材料与题目实验目前仍按浏览器访客会话保存，尚未与账号长期绑定，换设备登录不会自动同步；
          头像、昵称、简介与使用偏好随账号保存。
        </p>
      </main>
    </div>
  );
}

export default SpacePage;
