import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { AuthUser, MaterialsListResponse, UserProfile } from '@/api/types';
import { useDeleteAvatar, useUpdateMe, useUploadAvatar } from '@/api/accountHooks';
import { errorMessage } from '@/api/client';
import { useMaterials } from '@/api/hooks';
import { importProjectPackage } from '@/api/projectPackage';
import { useScopedQueryKeys } from '@/api/queryKeys';
import { worksApi, type WorkSummary } from '@/api/works';
import { CUSTOM_BLOCKS_KEY, listCustomBlocks, type CustomBlockRecord } from '@/canvas/customBlocks';
import { AvatarCropper } from '@/components/account/AvatarCropper';
import { NewDeckModal } from '@/components/editor/NewDeckModal';
import { MainSiteNav } from '@/components/home/MainSiteNav';
import { readApiError } from '@/components/upload/errorCopy';
import { THEMES } from '@/document/themes';
import { useAccountSessionActions, useEnsureAccountProfile } from '@/hooks/useAccountBootstrap';
import {
  useAccountProfile,
  useAccountScope,
  useAccountStatus,
  useAccountUser,
  type AccountStatus,
} from '@/state/accountSession';
import {
  applyReducedMotionPreference,
  readSpacePreferences,
  writeSpacePreferences,
  type SpacePreferences,
} from '@/state/spacePreferences';
import { SpaceCover } from './space/SpaceCard';
import { SpacePublicWorks } from './space/SpacePublicWorks';
import { SpaceCreatorCard } from './space/SpaceCreatorCard';
import {
  buildSpaceItems,
  findEarliestExpiry,
  relativeAssetTime,
  SPACE_KIND_LABEL,
  spaceItemHref,
  type SpaceItem,
} from './space/spaceItems';
import { CreatorPosterModal, PinShowcaseModal, spaceItemKey } from './space/SpaceModals';
import {
  normalizePhone,
  PHONE_ERROR,
  SpaceSettingsPanel,
  type ProfileFormState,
} from './space/SpaceSettingsPanel';
import { SpaceShowcaseHero } from './space/SpaceShowcaseHero';
import styles from './SpacePage.module.css';

const EMPTY_MATERIALS: MaterialsListResponse['items'] = [];
const EMPTY_WORKS: WorkSummary[] = [];
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

function useTime(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

function useLocalBlocks(): [CustomBlockRecord[], () => void] {
  const [blocks, setBlocks] = useState(() => listCustomBlocks());
  const refresh = useCallback(() => setBlocks(listCustomBlocks()), []);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === CUSTOM_BLOCKS_KEY || event.key === null) refresh();
    };
    window.addEventListener('storage', sync);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener('focus', refresh);
    };
  }, [refresh]);
  return [blocks, refresh];
}

function remainingShort(expiry: string, now: number): string {
  const ms = Date.parse(expiry) - now;
  if (!Number.isFinite(ms) || ms <= 0) return '即将清理';
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 24) return `${Math.floor(hours / 24)} 天后清理`;
  if (hours >= 1) return `${hours} 小时后清理`;
  return `${Math.max(1, Math.ceil(ms / 60_000))} 分钟后清理`;
}

function SpaceStudio({
  scope,
  status,
  user,
  profile,
}: {
  scope: string;
  status: AccountStatus;
  user: AuthUser | null;
  profile: UserProfile | null;
}): JSX.Element {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab: 'showcase' | 'settings' = searchParams.get('tab') === 'settings' ? 'settings' : 'showcase';

  const keys = useScopedQueryKeys();
  const queryClient = useQueryClient();
  const now = useTime();
  const { signOut } = useAccountSessionActions();

  const materialsQuery = useMaterials(50);
  const worksQuery = useQuery({ queryKey: keys.works(), queryFn: worksApi.list, refetchOnMount: 'always' });
  const [blocks] = useLocalBlocks();

  const materials = materialsQuery.data?.items ?? EMPTY_MATERIALS;
  const works = worksQuery.data?.works ?? EMPTY_WORKS;
  const items = useMemo(() => buildSpaceItems(materials, works, blocks), [materials, works, blocks]);

  const totalSlides = useMemo(
    () => materials.reduce((sum, item) => sum + Math.max(0, item.page_count), 0),
    [materials],
  );
  const earliestExpiry = useMemo(() => findEarliestExpiry(materials), [materials]);

  // 偏好状态（本地持久化，按账号 scope 隔离）
  const coverKey = `wanxiang:profile-cover:v1:${scope}`;
  const [coverImage, setCoverImage] = useState<string | null>(() => {
    try { return localStorage.getItem(coverKey); } catch { return null; }
  });
  const saveCoverImage = (image: string | null): void => {
    if (image) localStorage.setItem(coverKey, image);
    else localStorage.removeItem(coverKey);
    setCoverImage(image);
  };
  const [savedPrefs, setSavedPrefs] = useState<SpacePreferences>(() => readSpacePreferences(scope));
  const [prefsDraft, setPrefsDraft] = useState<SpacePreferences>(() => readSpacePreferences(scope));

  useEffect(() => {
    applyReducedMotionPreference(savedPrefs.reducedMotion);
  }, [savedPrefs.reducedMotion]);

  // 个人资料表单状态（与后端 /me 同步）
  const authenticated = status === 'authenticated' && user !== null;
  const [form, setForm] = useState<ProfileFormState>({
    displayName: user?.display_name ?? '',
    bio: profile?.bio ?? '',
    occupation: profile?.occupation ?? '',
    school: profile?.school ?? '',
    phone: profile?.phone ?? '',
    interests: profile?.interests ?? [],
  });
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const phoneInputRef = useRef<HTMLInputElement>(null);

  const hydratedUserIdRef = useRef<string | null>(null);
  const restoreProfileForm = useCallback((name: string, savedProfile: UserProfile): void => {
    setForm({
      displayName: name,
      bio: savedProfile.bio,
      occupation: savedProfile.occupation,
      school: savedProfile.school,
      phone: savedProfile.phone,
      interests: savedProfile.interests,
    });
    setPhoneError(null);
  }, []);

  useEffect(() => {
    if (user === null || profile === null) return;
    if (hydratedUserIdRef.current === user.user_id) return;
    hydratedUserIdRef.current = user.user_id;
    restoreProfileForm(user.display_name, profile);
  }, [profile, restoreProfileForm, user]);

  // 头像上传与裁剪
  const updateMe = useUpdateMe();
  const uploadAvatar = useUploadAvatar();
  const deleteAvatar = useDeleteAvatar();
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [avatarStatus, setAvatarStatus] = useState('');

  // 导入工程包
  const importInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');

  // 弹窗与提示
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [posterModalOpen, setPosterModalOpen] = useState(false);
  const [newDeckOpen, setNewDeckOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const toastTimer = useRef<number>();

  const showToast = useCallback((text: string) => {
    setToast(text);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 2800);
  }, []);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const switchTab = useCallback((tab: 'showcase' | 'settings') => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (tab === 'settings') next.set('tab', 'settings');
      else next.delete('tab');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // 脏状态判断
  const normalizedPhone = normalizePhone(form.phone);
  const profileDirty = Boolean(
    authenticated &&
    profile !== null &&
    hydratedUserIdRef.current === user.user_id &&
    (form.displayName.trim() !== user.display_name ||
      form.bio.trim() !== profile.bio ||
      form.occupation.trim() !== profile.occupation ||
      form.school.trim() !== profile.school ||
      normalizedPhone !== profile.phone ||
      form.interests.length !== profile.interests.length ||
      form.interests.some((item, index) => item !== profile.interests[index])),
  );

  const prefsDirty =
    prefsDraft.coverTheme !== savedPrefs.coverTheme ||
    prefsDraft.defaultPptTheme !== savedPrefs.defaultPptTheme ||
    prefsDraft.defaultRatio !== savedPrefs.defaultRatio ||
    prefsDraft.defaultSubject !== savedPrefs.defaultSubject ||
    prefsDraft.reducedMotion !== savedPrefs.reducedMotion;

  const isDirty = profileDirty || prefsDirty;

  const completion = useMemo(() => {
    if (!authenticated) return 0;
    return [
      user.avatar_url,
      form.displayName.trim(),
      form.bio.trim(),
      form.occupation.trim() || form.school.trim(),
      form.interests.length > 0,
    ].filter(Boolean).length;
  }, [authenticated, user?.avatar_url, form.displayName, form.bio, form.occupation, form.school, form.interests.length]);

  // 置顶展品解析（优先使用用户手动置顶，不足 3 项自动补足最新作品）
  const pinnedItems = useMemo<SpaceItem[]>(() => {
    const byKey = new Map(items.map((item) => [spaceItemKey(item), item]));
    const picked: SpaceItem[] = [];
    for (const key of savedPrefs.pinnedKeys) {
      const found = byKey.get(key);
      if (found) picked.push(found);
    }
    if (picked.length < 3) {
      for (const item of items) {
        if (picked.length >= 3) break;
        if (!picked.includes(item)) picked.push(item);
      }
    }
    return picked;
  }, [items, savedPrefs.pinnedKeys]);

  const heroItem = pinnedItems[0] ?? null;
  const secondaryPins = pinnedItems.slice(1, 3);
  const recentItems = items.slice(0, 3);

  // 内容分布比例
  const distribution = useMemo(() => {
    const total = materials.length + works.length + blocks.length;
    if (total === 0) return null;
    const pct = (n: number) => Math.round((n / total) * 100);
    return [
      { label: '通文册课件', count: materials.length, pct: pct(materials.length), color: '#b84423' },
      { label: '定象坊沙盘', count: works.length, pct: pct(works.length), color: '#2e457a' },
      { label: '自研积木', count: blocks.length, pct: pct(blocks.length), color: '#116f68' },
    ].filter((seg) => seg.count > 0);
  }, [materials.length, works.length, blocks.length]);

  const activePptTheme = useMemo(
    () => THEMES.find(([id]) => id === prefsDraft.defaultPptTheme) ?? THEMES[0],
    [prefsDraft.defaultPptTheme],
  );

  // 头像事件
  const handleAvatarFileChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = '';
    setAvatarError(null);
    setAvatarStatus('');
    if (!file) return;
    if (!(AVATAR_TYPES as readonly string[]).includes(file.type)) {
      setAvatarError('头像仅支持 JPG、PNG 或 WebP');
      showToast('头像仅支持 JPG、PNG 或 WebP');
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      setAvatarError('头像图片不能超过 2 MB');
      showToast('头像图片不能超过 2 MB');
      return;
    }
    setCropFile(file);
  };

  const handleAvatarConfirm = (blob: Blob): void => {
    setAvatarError(null);
    uploadAvatar.mutate(
      { file: blob, fileName: 'avatar.jpg' },
      {
        onSuccess: () => {
          setCropFile(null);
          setAvatarStatus('头像已更新。');
          showToast('✓ 头像已更新');
        },
        onError: (error) => {
          setAvatarError(readApiError(error).message);
        },
      },
    );
  };

  const handleResetAvatar = (): void => {
    setAvatarError(null);
    setAvatarStatus('');
    deleteAvatar.mutate(undefined, {
      onSuccess: () => {
        setAvatarStatus('已恢复默认头像。');
        showToast('已恢复默认头像');
      },
      onError: (error) => {
        setAvatarError(readApiError(error).message);
      },
    });
  };

  // 保存资料与偏好
  const handleSaveAll = (): void => {
    if (!isDirty || updateMe.isPending) return;
    setSaveError(null);

    if (profileDirty) {
      const name = form.displayName.trim();
      if (!name) {
        setSaveError('昵称不能为空');
        return;
      }
      if (normalizedPhone === null) {
        setPhoneError(PHONE_ERROR);
        phoneInputRef.current?.focus();
        return;
      }
      setPhoneError(null);
      updateMe.mutate(
        {
          display_name: name,
          bio: form.bio.trim(),
          occupation: form.occupation.trim(),
          school: form.school.trim(),
          phone: normalizedPhone,
          interests: [...form.interests],
        },
        {
          onSuccess: () => {
            if (prefsDirty) {
              const nextPrefs = { ...prefsDraft, pinnedKeys: savedPrefs.pinnedKeys };
              writeSpacePreferences(scope, nextPrefs);
              setSavedPrefs(nextPrefs);
              setPrefsDraft(nextPrefs);
            }
            showToast('✓ 个人资料与创作偏好已保存');
          },
          onError: (error) => {
            setSaveError(readApiError(error).message);
          },
        },
      );
      return;
    }

    // 仅偏好改动（访客或已登录均适用）
    const nextPrefs = { ...prefsDraft, pinnedKeys: savedPrefs.pinnedKeys };
    writeSpacePreferences(scope, nextPrefs);
    setSavedPrefs(nextPrefs);
    setPrefsDraft(nextPrefs);
    showToast('✓ 创作偏好已保存');
  };

  const handleResetAll = (): void => {
    if (authenticated && user && profile) {
      restoreProfileForm(user.display_name, profile);
    }
    setPrefsDraft(savedPrefs);
    setSaveError(null);
    showToast('已重置未保存的修改');
  };

  // 保存置顶（立即落盘）
  const handleSavePins = (pinnedKeys: string[]): void => {
    const nextSaved = { ...savedPrefs, pinnedKeys };
    writeSpacePreferences(scope, nextSaved);
    setSavedPrefs(nextSaved);
    setPrefsDraft((prev) => ({ ...prev, pinnedKeys }));
    setPinModalOpen(false);
    showToast(pinnedKeys.length ? `✓ 已更新 ${pinnedKeys.length} 项置顶代表作` : '已恢复自动推荐展品');
  };

  // 导出本机积木备份
  const handleExportBlocks = (): void => {
    if (blocks.length === 0) {
      showToast('当前浏览器还没有自定义积木可导出');
      return;
    }
    const payload = {
      schema: 'wanxiang-custom-blocks-v1',
      exported_at: new Date().toISOString(),
      blocks,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `wanxiang-blocks-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    showToast(`✓ 已导出 ${blocks.length} 块本机积木备份`);
  };

  // 导入 .xsproj / .html
  const handleImportProject = async (file: File): Promise<void> => {
    setImporting(true);
    setImportError('');
    try {
      const result = await importProjectPackage(file);
      void queryClient.invalidateQueries({ queryKey: keys.materialsRoot() });
      navigate(`/materials/${encodeURIComponent(result.material_id)}/work?page=1`);
    } catch (error) {
      setImportError(errorMessage(error));
    } finally {
      setImporting(false);
    }
  };

  const handleSignOut = async (): Promise<void> => {
    setSigningOut(true);
    try {
      const result = await signOut();
      if (result === 'signed-out') {
        showToast('已退出登录');
        switchTab('showcase');
      } else {
        showToast('退出未能完成，请稍后重试');
      }
    } catch {
      showToast('退出未能完成，请稍后重试');
    } finally {
      setSigningOut(false);
    }
  };

  const prefsSummaryCard = (
    <section className={`${styles.card} ${styles.bentoPrefs}`} aria-label="全站创作偏好">
      <div className={styles.cardPad}>
        <div className={styles.cardHead}>
          <div>
            <p className={`${styles.kicker} ${styles.kickerMuted}`}>PREFERENCES · 全站偏好</p>
            <h3 className={styles.cardTitle}>创作默认设置</h3>
          </div>
          {activeTab === 'showcase' ? (
            <button type="button" className={styles.textLink} onClick={() => switchTab('settings')}>
              修改 →
            </button>
          ) : null}
        </div>
        <div className={styles.prefSummary}>
          <div className={styles.prefRow}>
            <span>新建 PPT 主题</span>
            <strong>
              <i
                className={styles.swatchDot}
                style={{ background: activePptTheme[2], borderColor: activePptTheme[3] }}
              />
              {activePptTheme[1]}
            </strong>
          </div>
          <div className={styles.prefRow}>
            <span>默认画布比例</span>
            <strong>{prefsDraft.defaultRatio}</strong>
          </div>
          <div className={styles.prefRow}>
            <span>优先展示学科</span>
            <strong>{prefsDraft.defaultSubject}</strong>
          </div>
          <div className={styles.prefRow}>
            <span>界面动效</span>
            <strong>{prefsDraft.reducedMotion ? '精简动效' : '标准平滑'}</strong>
          </div>
        </div>
      </div>
    </section>
  );

  return (
    <>
      <input
        ref={avatarInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={handleAvatarFileChange}
      />
      <input
        ref={importInputRef}
        type="file"
        accept=".xsproj,.html,.htm,application/zip,text/html"
        hidden
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) void handleImportProject(file);
        }}
      />

      <header className={styles.schemeHeader}>
        <div>
          <p className={styles.kicker}>PERSONAL STUDIO · 个人主页</p>
          <h1>{activeTab === 'showcase' ? '个人主页' : '资料与全站偏好设置'}</h1>
        </div>
        <div className={styles.schemeTabs} role="tablist" aria-label="个人主页视图切换">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'showcase'}
            className={activeTab === 'showcase' ? styles.tabActive : undefined}
            onClick={() => switchTab('showcase')}
          >
            个人主页
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'settings'}
            className={activeTab === 'settings' ? styles.tabActive : undefined}
            onClick={() => switchTab('settings')}
          >
            资料与偏好设置
            {isDirty ? <i className={styles.dirtyDot} aria-label="有未保存修改" /> : null}
          </button>
        </div>
      </header>

      {activeTab === 'showcase' ? (
        <div className={styles.bentoGrid}>
          <SpaceCreatorCard
            status={status}
            user={user}
            draft={form}
            coverTheme={prefsDraft.coverTheme}
            coverImage={coverImage}
            completion={completion}
            inSettings={false}
            avatarBusy={uploadAvatar.isPending || deleteAvatar.isPending}
            earliestExpiry={earliestExpiry}
            materialCount={materials.length}
            blockCount={blocks.length}
            now={now}
            onPickAvatar={() => avatarInputRef.current?.click()}
            onOpenPoster={() => setPosterModalOpen(true)}
            onEditProfile={() => switchTab('settings')}
          />

          <SpaceShowcaseHero
            heroItem={heroItem}
            totalItems={items.length}
            now={now}
            reducedMotion={prefsDraft.reducedMotion}
            onManagePins={() => setPinModalOpen(true)}
            onCreateDeck={() => setNewDeckOpen(true)}
            onCreateCanvas={() => navigate('/canvas', { state: { blank: true } })}
          />

          <section className={`${styles.card} ${styles.bentoStats}`} aria-label="教学资产画像">
            <div className={styles.cardPad}>
              <div className={styles.cardHead}>
                <div>
                  <p className={`${styles.kicker} ${styles.kickerMuted}`}>CREATOR PROFILE · 教学资产画像</p>
                  <h3 className={styles.cardTitle}>创作沉淀</h3>
                </div>
              </div>
              <div className={styles.metricRow}>
                <div className={styles.metricBox}>
                  <strong>{totalSlides}</strong>
                  <span>课件页数</span>
                </div>
                <div className={styles.metricBox}>
                  <strong>{works.length}</strong>
                  <span>交互沙盘</span>
                </div>
                <div className={styles.metricBox}>
                  <strong>{blocks.length}</strong>
                  <span>自研积木</span>
                </div>
              </div>
              <p className={styles.subLabel}>创作类型构成</p>
              {distribution ? (
                <>
                  <div className={styles.distBar} aria-label="创作类型分布">
                    {distribution.map((seg) => (
                      <span
                        key={seg.label}
                        style={{ width: `${Math.max(seg.pct, 6)}%`, background: seg.color }}
                        title={`${seg.label} ${seg.count} 项 (${seg.pct}%)`}
                      />
                    ))}
                  </div>
                  <div className={styles.distLegend}>
                    {distribution.map((seg) => (
                      <span key={seg.label}>
                        <i style={{ background: seg.color }} />
                        {seg.label} {seg.pct}%
                      </span>
                    ))}
                  </div>
                </>
              ) : (
                <p className={styles.emptySmall}>开始制作第一份课件或交互沙盘后，这里会自动汇总你的创作画像。</p>
              )}
            </div>
          </section>

          <section className={`${styles.card} ${styles.bentoRecent}`} aria-label="最近足迹">
            <div className={styles.cardPad}>
              <div className={styles.cardHead}>
                <div>
                  <p className={`${styles.kicker} ${styles.kickerMuted}`}>RECENTS · 最近足迹</p>
                  <h3 className={styles.cardTitle}>继续上次</h3>
                </div>
              </div>
              {recentItems.length > 0 ? (
                <div className={styles.recentList}>
                  {recentItems.map((item) => (
                    <Link className={styles.recentItem} key={spaceItemKey(item)} to={spaceItemHref(item)}>
                      <span className={styles.recentIcon} data-kind={item.kind} aria-hidden="true">
                        {item.kind === 'material' ? '冊' : item.kind === 'work' ? '象' : '积'}
                      </span>
                      <div className={styles.recentMain}>
                        <strong>{item.title}</strong>
                        <small>
                          {SPACE_KIND_LABEL[item.kind]}
                          {relativeAssetTime(item.time, now) ? ` · ${relativeAssetTime(item.time, now)}` : ''}
                        </small>
                      </div>
                      <span className={styles.recentArrow} aria-hidden="true">↗</span>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className={styles.emptySmall} style={{ flex: 1 }}>
                  {materialsQuery.isLoading || worksQuery.isLoading ? '正在读取最近足迹…' : '暂无最近打开记录。'}
                </p>
              )}
              <div className={styles.recentFoot}>
                <Link className={styles.textLink} to="/living">全部通文册 →</Link>
                <Link className={styles.textLink} to="/workshop">全部定象坊 →</Link>
              </div>
            </div>
          </section>

          {user && <SpacePublicWorks userId={user.user_id} />}

          {prefsSummaryCard}

          <section className={`${styles.card} ${styles.bentoMorePins}`} aria-label="橱窗展品">
            <div className={styles.cardPad}>
              <div className={styles.cardHead}>
                <div>
                  <p className={`${styles.kicker} ${styles.kickerMuted}`}>CURATED · 更多精选</p>
                  <h3 className={styles.cardTitle}>橱窗展品</h3>
                </div>
                <div className={styles.inlineRow}>
                  <button
                    type="button"
                    className={`${styles.btn} ${styles.btnSm} ${styles.btnSoft}`}
                    onClick={() => setNewDeckOpen(true)}
                  >
                    ＋ 新建 PPT
                  </button>
                  {items.length > 1 ? (
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.btnSm} ${styles.btnGhost}`}
                      onClick={() => setPinModalOpen(true)}
                    >
                      替换精选
                    </button>
                  ) : null}
                </div>
              </div>
              {secondaryPins.length > 0 ? (
                <div className={styles.pinPair}>
                  {secondaryPins.map((item) => (
                    <Link key={spaceItemKey(item)} className={styles.pinMini} to={spaceItemHref(item)}>
                      <div className={styles.pinMiniCover}>
                        <SpaceCover item={item} />
                      </div>
                      <div className={styles.pinMiniBody}>
                        <h4 title={item.title}>{item.title}</h4>
                        <div className={styles.pinMiniFoot}>
                          <span>
                            {item.kind === 'material'
                              ? `${item.record.page_count} 页`
                              : item.kind === 'work'
                                ? `${item.record.node_count} 个积木`
                                : '本机积木'}
                            {relativeAssetTime(item.time, now) ? ` · ${relativeAssetTime(item.time, now)}` : ''}
                          </span>
                          <span className={styles.textLink}>进入 ↗</span>
                        </div>
                      </div>
                    </Link>
                  ))}
                  {secondaryPins.length === 1 ? (
                    <div className={styles.pinSlotEmpty}>
                      <strong>添置下一件展品</strong>
                      <p>在通文册新建课件 或在定象坊拼装沙盘，丰富你的个人橱窗。</p>
                      <div className={styles.inlineRow}>
                        <button type="button" className={`${styles.btn} ${styles.btnSm} ${styles.btnPrimary}`} onClick={() => setNewDeckOpen(true)}>
                          ＋ 新建 PPT
                        </button>
                        <button
                          type="button"
                          className={`${styles.btn} ${styles.btnSm} ${styles.btnGhost}`}
                          onClick={() => navigate('/canvas', { state: { blank: true } })}
                        >
                          ＋ 新建画布
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className={styles.pinPair}>
                  <div className={styles.pinSlotEmpty}>
                    <strong>在通文册从零制作 PPT</strong>
                    <p>使用你设定的默认主题「{activePptTheme[1]}」与 {prefsDraft.defaultRatio} 比例开箱创作。</p>
                    <button type="button" className={`${styles.btn} ${styles.btnSm} ${styles.btnPrimary}`} onClick={() => setNewDeckOpen(true)}>
                      ＋ 新建课件
                    </button>
                  </div>
                  <div className={styles.pinSlotEmpty}>
                    <strong>在定象坊拼装交互沙盘</strong>
                    <p>用可视化积木搭建公式曲线与物理/数学模型，随时嵌进课件任意一页。</p>
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.btnSm} ${styles.btnGhost}`}
                      onClick={() => navigate('/canvas', { state: { blank: true } })}
                    >
                      ＋ 新建空白画布
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>

          <section className={`${styles.card} ${styles.bentoAssets}`} aria-label="个人资产与备份管家">
            <div className={styles.cardPad}>
              <div className={styles.cardHead}>
                <div>
                  <p className={`${styles.kicker} ${styles.kickerMuted}`}>ASSETS & BACKUP · 资产管家</p>
                  <h3 className={styles.cardTitle}>数据与备份</h3>
                </div>
              </div>
              <div className={styles.assetRows}>
                <div className={styles.assetRow}>
                  <span>☁ 云端通文册与沙盘</span>
                  <span className={`${styles.assetStatus} ${authenticated ? styles.assetOk : styles.assetWarn}`}>
                    {authenticated
                      ? `${materials.length + works.length} 份 · 已同步`
                      : earliestExpiry
                        ? `访客会话 · ${remainingShort(earliestExpiry, now)}`
                        : '访客会话 · 建议登录'}
                  </span>
                </div>
                <div className={styles.assetRow}>
                  <span>🧩 <span className="keep-together">本机积木</span></span>
                  <span className={`${styles.assetStatus} ${blocks.length > 0 ? styles.assetWarn : styles.assetOk}`}>
                    {blocks.length > 0 ? `${blocks.length} 块 · 建议定期导出` : '0 块'}
                  </span>
                </div>
              </div>
              <div className={styles.assetActions}>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnSm} ${styles.btnGhost}`}
                  onClick={handleExportBlocks}
                >
                  ↓ 导出积木备份 (.json)
                </button>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnSm} ${styles.btnGhost}`}
                  disabled={importing}
                  onClick={() => importInputRef.current?.click()}
                >
                  {importing ? '正在导入…' : '↑ 导入工程 / HTML'}
                </button>
              </div>
              {importError ? <p className={styles.fieldError} role="alert" style={{ marginTop: 8 }}>{importError}</p> : null}
            </div>
          </section>
        </div>
      ) : (
        <div className={`${styles.settingsSplit} ${isDirty || updateMe.isPending ? styles.withSaveBar : ''}`}>
          <aside className={styles.stickySide}>
            <SpaceCreatorCard
              status={status}
              user={user}
              draft={form}
              coverTheme={prefsDraft.coverTheme}
              coverImage={coverImage}
              completion={completion}
              inSettings={true}
              avatarBusy={uploadAvatar.isPending || deleteAvatar.isPending}
              earliestExpiry={earliestExpiry}
              materialCount={materials.length}
              blockCount={blocks.length}
              now={now}
              onPickAvatar={() => avatarInputRef.current?.click()}
              onOpenPoster={() => setPosterModalOpen(true)}
              onEditProfile={() => switchTab('settings')}
            />
            {authenticated ? (
              <div className={styles.completionBox}>
                <div className={styles.completionHead}>
                  <span>{completion === 5 ? '✓ 创作者档案已填写完整' : '创作者档案完整度'}</span>
                  <span>{completion * 20}%</span>
                </div>
                <div className={styles.completionTrack}>
                  <div className={styles.completionFill} style={{ width: `${completion * 20}%` }} />
                </div>
              </div>
            ) : null}
            {prefsSummaryCard}
          </aside>

          <SpaceSettingsPanel
            status={status}
            user={user}
            profileReady={profile !== null}
            form={form}
            prefs={prefsDraft}
            phoneError={phoneError}
            phoneInputRef={phoneInputRef}
            avatarBusy={uploadAvatar.isPending}
            deleteAvatarPending={deleteAvatar.isPending}
            avatarError={avatarError}
            avatarStatus={avatarStatus}
            signingOut={signingOut}
            onFormChange={(patch) => {
              setForm((prev) => ({ ...prev, ...patch }));
              setSaveError(null);
            }}
            onPhoneError={setPhoneError}
            onPrefsChange={(patch) => {
              setPrefsDraft((prev) => ({ ...prev, ...patch }));
              setSaveError(null);
            }}
            onPickAvatar={() => avatarInputRef.current?.click()}
            onResetAvatar={handleResetAvatar}
            onSignOut={() => void handleSignOut()}
          />
        </div>
      )}

      {(isDirty || updateMe.isPending) ? (
        <div className={styles.saveBar} role="status">
          <div className={styles.saveBarText}>
            <span>{updateMe.isPending ? '正在保存修改…' : '有未保存的资料或偏好修改'}</span>
            {saveError ? <strong className={styles.saveBarError} role="alert">{saveError}</strong> : null}
          </div>
          <div className={styles.inlineRow}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnSm} ${styles.saveBarReset}`}
              disabled={updateMe.isPending}
              onClick={handleResetAll}
            >
              重置
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnSm} ${styles.btnAccent}`}
              disabled={updateMe.isPending}
              onClick={handleSaveAll}
            >
              保存修改
            </button>
          </div>
        </div>
      ) : null}

      {toast ? <div className={styles.toast} role="status">{toast}</div> : null}

      {cropFile !== null ? (
        <AvatarCropper
          file={cropFile}
          saving={uploadAvatar.isPending}
          error={avatarError}
          onCancel={() => {
            if (uploadAvatar.isPending) return;
            setCropFile(null);
            setAvatarError(null);
          }}
          onConfirm={handleAvatarConfirm}
        />
      ) : null}

      {pinModalOpen ? (
        <PinShowcaseModal
          items={items}
          pinnedKeys={savedPrefs.pinnedKeys}
          now={now}
          onClose={() => setPinModalOpen(false)}
          onSave={handleSavePins}
        />
      ) : null}

      {posterModalOpen && authenticated && user ? (
        <CreatorPosterModal
          draft={form}
          username={user.username}
          avatarUrl={user.avatar_url ?? null}
          coverTheme={prefsDraft.coverTheme}
          coverImage={coverImage}
          totalSlides={totalSlides}
          workCount={works.length}
          blockCount={blocks.length}
          onClose={() => setPosterModalOpen(false)}
          onCoverChange={saveCoverImage}
          onDownloaded={() => showToast('✓ 已下载高清 PNG 创作者名片')}
        />
      ) : null}

      {newDeckOpen ? (
        <NewDeckModal
          onClose={() => setNewDeckOpen(false)}
          onCreated={(id) => {
            setNewDeckOpen(false);
            void queryClient.invalidateQueries({ queryKey: keys.materialsRoot() });
            navigate(`/materials/${encodeURIComponent(id)}/work?mode=edit&page=1`);
          }}
        />
      ) : null}
    </>
  );
}

export function SpacePage(): JSX.Element {
  const scope = useAccountScope();
  const status = useAccountStatus();
  const user = useAccountUser();
  const profile = useAccountProfile();
  useEnsureAccountProfile();

  return (
    <>
      <MainSiteNav current="workspace" />
      <div className={`${styles.page} studio-scope atelier-paper`}>
        <main id="main" className={styles.main}>
          {status === 'restoring' ? (
            <p className={styles.listState} role="status">正在恢复账号状态…</p>
          ) : (
            <SpaceStudio key={scope} scope={scope} status={status} user={user} profile={profile} />
          )}
        </main>
      </div>
    </>
  );
}

export default SpacePage;
