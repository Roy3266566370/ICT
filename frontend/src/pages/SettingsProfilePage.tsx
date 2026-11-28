import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';

import { useDeleteAvatar, useUpdateMe, useUploadAvatar } from '@/api/accountHooks';
import { SiteNav } from '@/components/home/SiteNav';
import { AccountAvatar } from '@/components/account/AccountAvatar';
import { AvatarCropper } from '@/components/account/AvatarCropper';
import { readApiError } from '@/components/upload/errorCopy';
import { useEnsureAccountProfile } from '@/hooks/useAccountBootstrap';
import {
  useAccountProfile,
  useAccountStatus,
  useAccountUser,
} from '@/state/accountSession';
import styles from './SettingsProfilePage.module.css';

/** 与后端 `UpdateMeRequest` 的长度上限保持一致。 */
const DISPLAY_NAME_MAX = 64;
const BIO_MAX = 200;
const PROFILE_TEXT_MAX = 64;
const INTEREST_MAX = 24;
const INTEREST_COUNT_MAX = 8;
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const SUGGESTED_INTERESTS = ['高等数学', '线性代数', '大学物理', '408 专题', '深度学习', '办公决策', '可视化教学'];

/** 中国大陆手机号：11 位、1 开头、第二位 3–9（与后端 `PHONE_PATTERN` 一致）。 */
const PHONE_PATTERN = /^1[3-9]\d{9}$/;
const PHONE_ERROR = '手机号格式不正确，请输入 11 位中国大陆手机号';

/** 允许 +86 / 86 前缀与空格、短横线；返回规范化号码，非法返回 null。 */
function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === '') return '';
  let digits = trimmed.replace(/[\s-]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (digits.length === 13 && digits.startsWith('86')) digits = digits.slice(2);
  return PHONE_PATTERN.test(digits) ? digits : null;
}

interface PageNotice {
  kind: 'success' | 'error';
  text: string;
}

function formatDate(iso: string): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return iso;
  return new Date(parsed).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * 个人设置 `/settings/profile`。
 *
 * 管理个人资料与头像。
 */
export default function SettingsProfilePage(): JSX.Element {
  const status = useAccountStatus();
  const user = useAccountUser();
  const profile = useAccountProfile();
  useEnsureAccountProfile();

  const updateMe = useUpdateMe();
  const uploadAvatar = useUploadAvatar();
  const deleteAvatar = useDeleteAvatar();

  const authenticated = status === 'authenticated' && user !== null;

  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [occupation, setOccupation] = useState('');
  const [school, setSchool] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [interests, setInterests] = useState<readonly string[]>([]);
  const [interestDraft, setInterestDraft] = useState('');
  const [interestError, setInterestError] = useState('');

  const restoreFields = useCallback((name: string, saved: NonNullable<typeof profile>): void => {
    setDisplayName(name);
    setBio(saved.bio);
    setOccupation(saved.occupation);
    setSchool(saved.school);
    setPhone(saved.phone);
    setPhoneError(null);
    setInterests(saved.interests);
    setInterestDraft('');
    setInterestError('');
  }, []);

  const hydratedUserIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (user === null || profile === null) return;
    if (hydratedUserIdRef.current === user.user_id) return;
    hydratedUserIdRef.current = user.user_id;
    restoreFields(user.display_name, profile);
  }, [profile, restoreFields, user]);

  const [pageNotice, setPageNotice] = useState<PageNotice | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [avatarStatus, setAvatarStatus] = useState('');
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const phoneInputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLElement>(null);

  if (status === 'restoring') {
    return (
      <div className={`${styles.page} studio-scope`}>
        <SiteNav current={null} appearance="studio" />
        <main id="main" className={styles.main}>
          <div className={styles.loading} aria-busy="true" aria-live="polite">
            正在恢复账号状态…
          </div>
        </main>
      </div>
    );
  }

  if (!authenticated || user === null) {
    return (
      <div className={`${styles.page} studio-scope`}>
        <SiteNav current={null} appearance="studio" />
        <main id="main" className={styles.main}>
          <header className={styles.head}>
            <p className={styles.eyebrow}>个人设置</p>
            <h1 className={styles.title}>登录后管理你的账号</h1>
            <p className={styles.lead}>
              登录后可以设置头像、昵称和简介。
              {status === 'unavailable' ? '账号服务暂时不可用，请稍后重试。' : ''}
            </p>
            <div className={styles.headActions}>
              <Link className={styles.primary} to="/login?returnTo=%2Fsettings%2Fprofile">
                登录
              </Link>
              <Link className={styles.ghost} to="/space">
                返回个人主页
              </Link>
            </div>
          </header>
        </main>
      </div>
    );
  }

  if (profile === null) {
    // 资料未到达前不渲染表单：避免用空值覆盖已有简介与偏好。
    return (
      <div className={`${styles.page} studio-scope`}>
        <SiteNav current={null} appearance="studio" />
        <main id="main" className={styles.main}>
          <div className={styles.loading} aria-busy="true" aria-live="polite">
            正在读取账号资料… 若长时间未加载，可刷新页面重试。
          </div>
        </main>
      </div>
    );
  }

  const name = displayName.trim();
  const label = name || user.username;
  const normalizedPhone = normalizePhone(phone);
  const isDirty = hydratedUserIdRef.current === user.user_id && (
    name !== user.display_name || bio.trim() !== profile.bio ||
    occupation.trim() !== profile.occupation || school.trim() !== profile.school ||
    normalizedPhone !== profile.phone || interests.length !== profile.interests.length ||
    interests.some((interest, index) => interest !== profile.interests[index])
  );
  const completion = [
    user.avatar_url, name, bio.trim(), occupation.trim() || school.trim(), interests.length,
  ].filter(Boolean).length;

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = '';
    setAvatarError(null);
    setAvatarStatus('');
    if (file === null) return;
    if (!(AVATAR_TYPES as readonly string[]).includes(file.type)) {
      setAvatarError('头像仅支持 JPG、PNG 或 WebP');
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      setAvatarError('头像图片不能超过 2MB');
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
        setConfirmReset(false);
        setAvatarStatus('已恢复默认头像。');
      },
      onError: (error) => {
        setConfirmReset(false);
        setAvatarError(readApiError(error).message);
      },
    });
  };

  const addInterest = (value: string): void => {
    const text = value.trim();
    if (text === '') return;
    if (Array.from(text).length > INTEREST_MAX) {
      setInterestError(`单个兴趣标签最多 ${INTEREST_MAX} 个字符`);
      return;
    }
    if (interests.includes(text)) {
      if (value === interestDraft) setInterestDraft('');
      return;
    }
    if (interests.length >= INTEREST_COUNT_MAX) {
      setInterestError(`兴趣标签最多 ${INTEREST_COUNT_MAX} 个`);
      return;
    }
    setInterests([...interests, text]);
    if (value === interestDraft) setInterestDraft('');
    setInterestError('');
  };

  const removeInterest = (value: string): void => {
    setInterests(interests.filter((item) => item !== value));
    setInterestError('');
  };

  const handleSave = (): void => {
    if (!isDirty || updateMe.isPending) return;
    if (name === '') {
      setPageNotice({ kind: 'error', text: '昵称不能为空' });
      return;
    }
    if (normalizedPhone === null) {
      setPhoneError(PHONE_ERROR);
      setPageNotice(null);
      phoneInputRef.current?.focus();
      return;
    }
    setPhoneError(null);
    setPageNotice(null);
    updateMe.mutate(
      {
        display_name: name,
        bio: bio.trim(),
        occupation: occupation.trim(),
        school: school.trim(),
        phone: normalizedPhone,
        interests: [...interests],
      },
      {
        onSuccess: () => {
          setPageNotice({ kind: 'success', text: '资料已保存。' });
        },
        onError: (error) => {
          setPageNotice({ kind: 'error', text: readApiError(error).message });
        },
      },
    );
  };

  return (
    <div className={`${styles.page} studio-scope`}>
      <SiteNav current={null} appearance="studio" />

      <main id="main" className={styles.main}>
        <header className={styles.head}>
          <div>
            <p className={styles.eyebrow}>ACCOUNT · PROFILE</p>
            <h1 className={styles.title}>个人设置</h1>
            <p className={styles.lead}>
              编辑个人主页资料。
            </p>
          </div>
          <div className={styles.headActions}>
            <button type="button" className={`${styles.ghost} ${styles.previewLink}`} onClick={() => {
              previewRef.current?.focus({ preventScroll: true });
              previewRef.current?.scrollIntoView();
            }}>名片预览</button>
            <Link className={styles.ghost} to="/space">
              查看个人主页 <span aria-hidden="true">↗</span>
            </Link>
          </div>
        </header>

        <div className={`${styles.layout} ${isDirty || updateMe.isPending ? styles.withSaveBar : ''}`}>
          <div className={styles.column}>
            <section className={styles.card} aria-labelledby="settings-basic-title">
              <div className={styles.cardHead}>
                <h2 className={styles.cardTitle} id="settings-basic-title">
                  基本资料
                </h2>
              </div>

              <div className={styles.avatarRow}>
                <button type="button" className={styles.avatarButton} aria-label="更换头像"
                  disabled={uploadAvatar.isPending || deleteAvatar.isPending}
                  onClick={() => fileInputRef.current?.click()}>
                  <AccountAvatar size="xl" label={label} avatarUrl={user.avatar_url ?? null} />
                  <span className={styles.avatarOverlay} aria-hidden="true">更换头像</span>
                </button>
                <div className={styles.avatarInfo}>
                  <p className={styles.previewName}>{label}</p>
                  <p className={styles.avatarHint}>
                    JPG、PNG 或 WebP，最大 2 MB
                  </p>
                  <div className={styles.avatarActions}>
                    <button
                      type="button"
                      className={styles.ghost}
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploadAvatar.isPending}
                    >
                      {uploadAvatar.isPending ? '正在上传…' : '上传图片'}
                    </button>
                    {user.avatar_url ? (
                      confirmReset ? (
                        <>
                          <button
                            type="button"
                            className={styles.danger}
                            onClick={handleResetAvatar}
                            disabled={deleteAvatar.isPending}
                          >
                            {deleteAvatar.isPending ? '恢复中…' : '确认恢复'}
                          </button>
                          <button
                            type="button"
                            className={styles.cancel}
                            onClick={() => setConfirmReset(false)}
                            disabled={deleteAvatar.isPending}
                          >
                            取消
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className={styles.ghost}
                          onClick={() => setConfirmReset(true)}
                        >
                          恢复默认
                        </button>
                      )
                    ) : null}
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className={styles.fileInput}
                    onChange={handleFileChange}
                    tabIndex={-1}
                    aria-hidden="true"
                  />
                  {avatarError === null ? null : (
                    <p className={styles.fieldError} role="alert">
                      {avatarError}
                    </p>
                  )}
                  {avatarStatus && <p className={styles.avatarHint} role="status">{avatarStatus}</p>}
                </div>
              </div>

              <div className={styles.fieldGrid}>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>昵称</span>
                  <input
                    className={styles.input}
                    value={displayName}
                    maxLength={DISPLAY_NAME_MAX}
                    onChange={(event) => setDisplayName(event.target.value)}
                    placeholder="用于展示的名字"
                  />
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>手机号（选填）</span>
                  <input
                    ref={phoneInputRef}
                    className={styles.input}
                    value={phone}
                    maxLength={20}
                    inputMode="tel"
                    autoComplete="tel"
                    onChange={(event) => {
                      setPhone(event.target.value);
                      setPhoneError(null);
                    }}
                    onBlur={() =>
                      setPhoneError(normalizePhone(phone) === null ? PHONE_ERROR : null)
                    }
                    placeholder="如 13812345678，可带 +86"
                    aria-invalid={phoneError !== null}
                    aria-describedby="settings-phone-hint"
                  />
                  {phoneError === null ? (
                    <p className={styles.fieldHint} id="settings-phone-hint">
                      仅用于账号联系。
                    </p>
                  ) : (
                    <p className={styles.fieldError} id="settings-phone-hint" role="alert">
                      {phoneError}
                    </p>
                  )}
                </label>
                <label className={`${styles.field} ${styles.fieldWide}`}>
                  <span className={styles.fieldLabel}>个人简介</span>
                  <textarea
                    className={styles.textarea}
                    value={bio}
                    maxLength={BIO_MAX}
                    rows={3}
                    onChange={(event) => setBio(event.target.value)}
                    placeholder="一句话介绍你自己，比如正在教什么、在做什么"
                  />
                  <span className={styles.counter}>
                    {bio.length} / {BIO_MAX}
                  </span>
                </label>
              </div>
            </section>
            <section className={styles.card} aria-labelledby="settings-interests-title">
              <div className={styles.cardHead}>
                <h2 className={styles.cardTitle} id="settings-interests-title">身份与学科兴趣</h2>
              </div>
              <div className={styles.fieldGrid}>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>职业（选填）</span>
                  <input
                    className={styles.input}
                    value={occupation}
                    maxLength={PROFILE_TEXT_MAX}
                    onChange={(event) => setOccupation(event.target.value)}
                    placeholder="如：教师、学生、研究者"
                  />
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>学校 / 单位（选填）</span>
                  <input
                    className={styles.input}
                    value={school}
                    maxLength={PROFILE_TEXT_MAX}
                    onChange={(event) => setSchool(event.target.value)}
                    placeholder="如：中国石油大学"
                  />
                </label>
                <div className={`${styles.field} ${styles.fieldWide}`}>
                  <span className={styles.fieldLabel}>兴趣标签（选填，最多 {INTEREST_COUNT_MAX} 个）</span>
                  <div className={styles.tagRow}>
                    {interests.map((item) => (
                      <span className={styles.tag} key={item}>
                        {item}
                        <button
                          type="button"
                          className={styles.tagRemove}
                          onClick={() => removeInterest(item)}
                          aria-label={`删除标签：${item}`}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                    <input
                      className={styles.tagInput}
                      value={interestDraft}
                      maxLength={INTEREST_MAX}
                      onChange={(event) => {
                        setInterestDraft(event.target.value);
                        setInterestError('');
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                          event.preventDefault();
                          addInterest(interestDraft);
                        }
                      }}
                      placeholder="输入后回车添加"
                      aria-label="新增兴趣标签"
                    />
                    <button type="button" className={styles.tagAdd} onClick={() => addInterest(interestDraft)}>
                      添加
                    </button>
                  </div>
                  {interestError && <p className={styles.fieldError} role="alert">{interestError}</p>}
                  <div className={styles.suggestions} role="group" aria-label="推荐兴趣标签">
                    {SUGGESTED_INTERESTS.map((interest) => (
                      <button type="button" key={interest} disabled={interests.includes(interest)}
                        onClick={() => addInterest(interest)}>
                        <span aria-hidden="true">{interests.includes(interest) ? '✓' : '+'}</span> {interest}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </section>
            {!isDirty && pageNotice?.kind === 'success' &&
              <p className={styles.success} role="status">{pageNotice.text}</p>}
          </div>

          <aside className={styles.sideColumn}>
            <section className={styles.preview} id="settings-preview" ref={previewRef} tabIndex={-1}
              aria-labelledby="settings-preview-title">
              <div className={styles.previewCover}>
                <h2 id="settings-preview-title">名片预览</h2>
              </div>
              <div className={styles.previewBody}>
                <div className={styles.previewAvatar}>
                  <AccountAvatar size="xl" label={label} avatarUrl={user.avatar_url ?? null} />
                </div>
                <p className={styles.previewName}>{label}</p>
                <p className={styles.username}>@{user.username}</p>
                {(occupation.trim() || school.trim()) && <div className={styles.identity}>
                  {occupation.trim() && <span>{occupation.trim()}</span>}
                  {school.trim() && <span>{school.trim()}</span>}
                </div>}
                {bio.trim() && <p className={styles.previewBio}>{bio.trim()}</p>}
                {interests.length > 0 && <ul className={styles.previewTags} aria-label="兴趣标签">
                  {interests.map((interest) => <li className={styles.tag} key={interest}>{interest}</li>)}
                </ul>}
                <div className={styles.completion}>
                  <div>
                    <label htmlFor="profile-completion">{completion === 5 ? '资料已填完整' : '资料完整度'}</label>
                    <span>{completion * 20}%</span>
                  </div>
                  <progress id="profile-completion" value={completion} max={5} />
                </div>
                <dl className={styles.accountList}>
                  <div className={styles.accountRow}>
                    <dt>邮箱</dt>
                    <dd>{user.email}</dd>
                  </div>
                  <div className={styles.accountRow}>
                    <dt>注册时间</dt>
                    <dd>{formatDate(user.created_at)}</dd>
                  </div>
                </dl>
              </div>
            </section>
          </aside>
        </div>
      </main>

      {(isDirty || updateMe.isPending) && <div className={styles.saveBar}>
        <div className={styles.saveRow}>
          <div className={styles.saveMessage}>
            <p role="status">{updateMe.isPending ? '正在保存资料…' : '有未保存的修改'}</p>
            {pageNotice?.kind === 'error' && <p className={styles.errorNotice} role="alert">{pageNotice.text}</p>}
          </div>
          <div className={styles.saveActions}>
            <button type="button" className={styles.ghost} disabled={updateMe.isPending} onClick={() => {
              restoreFields(user.display_name, profile);
              setPageNotice(null);
            }}>重置</button>
            <button type="button" className={styles.primary} disabled={updateMe.isPending}
              onClick={handleSave}>保存修改</button>
          </div>
        </div>
      </div>}

      {cropFile === null ? null : (
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
      )}
    </div>
  );
}
