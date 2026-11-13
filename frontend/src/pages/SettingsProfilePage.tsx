import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';

import { useDeleteAvatar, useUpdateMe, useUploadAvatar } from '@/api/accountHooks';
import type { AccountDefaultEntry } from '@/api/types';
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

const SUBJECT_OPTIONS: readonly { value: string; label: string }[] = [
  { value: '', label: '未设置' },
  { value: 'calculus', label: '微积分' },
  { value: 'optimization', label: '最优化' },
  { value: 'algorithm', label: '数据结构与算法' },
  { value: 'deep_learning', label: '深度学习' },
];

const DEFAULT_ENTRY_OPTIONS: readonly { value: AccountDefaultEntry; label: string; hint: string }[] = [
  { value: 'space', label: '个人主页', hint: '登录后先看到资料与材料' },
  { value: 'labs', label: '题目实验室', hint: '登录后直接开始做题' },
];

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
 * 第一版：头像（上传/裁剪/恢复默认）、昵称、简介、职业、学校、兴趣标签、
 * 常用学科与登录默认入口；账号信息只读展示用户名、邮箱与注册时间。
 * 修改密码与换绑邮箱需要额外的验证流程，界面上明确标注"后续开放"。
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
  const [subject, setSubject] = useState('');
  const [defaultEntry, setDefaultEntry] = useState<AccountDefaultEntry>('space');

  const hydratedUserIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (user === null || profile === null) return;
    if (hydratedUserIdRef.current === user.user_id) return;
    hydratedUserIdRef.current = user.user_id;
    setDisplayName(user.display_name);
    setBio(profile.bio);
    setOccupation(profile.occupation);
    setSchool(profile.school);
    setPhone(profile.phone);
    setPhoneError(null);
    setInterests(profile.interests);
    setSubject(profile.preferred_subject);
    setDefaultEntry(profile.default_entry);
  }, [profile, user]);

  const [pageNotice, setPageNotice] = useState<PageNotice | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
              登录后可以设置头像、昵称、简介与使用偏好。
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

  const label = displayName.trim() === '' ? user.email : displayName.trim();

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = '';
    setAvatarError(null);
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
          setPageNotice({ kind: 'success', text: '头像已更新，顶栏与个人主页会同步显示。' });
        },
        onError: (error) => {
          setAvatarError(readApiError(error).message);
        },
      },
    );
  };

  const handleResetAvatar = (): void => {
    setAvatarError(null);
    deleteAvatar.mutate(undefined, {
      onSuccess: () => {
        setConfirmReset(false);
        setPageNotice({ kind: 'success', text: '已恢复默认头像。' });
      },
      onError: (error) => {
        setConfirmReset(false);
        setAvatarError(readApiError(error).message);
      },
    });
  };

  const addInterest = (): void => {
    const text = interestDraft.trim();
    if (text === '') return;
    if (Array.from(text).length > INTEREST_MAX) {
      setPageNotice({ kind: 'error', text: `单个兴趣标签最多 ${INTEREST_MAX} 个字符` });
      return;
    }
    if (interests.includes(text)) {
      setInterestDraft('');
      return;
    }
    if (interests.length >= INTEREST_COUNT_MAX) {
      setPageNotice({ kind: 'error', text: `兴趣标签最多 ${INTEREST_COUNT_MAX} 个` });
      return;
    }
    setInterests([...interests, text]);
    setInterestDraft('');
  };

  const removeInterest = (value: string): void => {
    setInterests(interests.filter((item) => item !== value));
  };

  const handleSave = (): void => {
    const name = displayName.trim();
    if (name === '') {
      setPageNotice({ kind: 'error', text: '昵称不能为空' });
      return;
    }
    const normalizedPhone = normalizePhone(phone);
    if (normalizedPhone === null) {
      setPhoneError(PHONE_ERROR);
      setPageNotice(null);
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
        preferred_subject: subject,
        default_entry: defaultEntry,
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
            <p className={styles.eyebrow}>个人设置</p>
            <h1 className={styles.title}>个人设置</h1>
            <p className={styles.lead}>
              管理头像、昵称与简介，设置常用学科和登录后的默认入口。
            </p>
          </div>
          <Link className={styles.ghost} to="/space">
            返回个人主页
          </Link>
        </header>

        {pageNotice === null ? null : (
          <p
            className={pageNotice.kind === 'success' ? styles.success : styles.errorNotice}
            role="status"
          >
            {pageNotice.text}
          </p>
        )}

        <div className={styles.layout}>
          <div className={styles.column}>
            <section className={styles.card} aria-labelledby="settings-basic-title">
              <div className={styles.cardHead}>
                <h2 className={styles.cardTitle} id="settings-basic-title">
                  基本资料
                </h2>
                <p className={styles.cardHint}>昵称用于展示，用户名用于登录，两者分开。</p>
              </div>

              <div className={styles.avatarRow}>
                <AccountAvatar size="xl" label={label} avatarUrl={user.avatar_url ?? null} />
                <div className={styles.avatarInfo}>
                  <p className={styles.avatarHint}>
                    JPG / PNG / WebP，不超过 2MB。保存前可以拖动裁剪为正方形，界面显示为圆形。
                  </p>
                  <div className={styles.avatarActions}>
                    <button
                      type="button"
                      className={styles.primary}
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploadAvatar.isPending}
                    >
                      {uploadAvatar.isPending ? '正在上传…' : '更换头像'}
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
                      中国大陆 11 位手机号；仅用于账号联系，不展示在个人主页。
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
                      onChange={(event) => setInterestDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          addInterest();
                        }
                      }}
                      placeholder="输入后回车添加"
                      aria-label="新增兴趣标签"
                    />
                    <button type="button" className={styles.tagAdd} onClick={addInterest}>
                      添加
                    </button>
                  </div>
                  <p className={styles.fieldHint}>兴趣标签只用于展示，不参与权限判断。</p>
                </div>
              </div>
            </section>

            <section className={styles.card} aria-labelledby="settings-pref-title">
              <div className={styles.cardHead}>
                <h2 className={styles.cardTitle} id="settings-pref-title">
                  使用偏好
                </h2>
                <p className={styles.cardHint}>偏好只影响展示与登录后的落地页，不作为权限依据。</p>
              </div>

              <label className={styles.field}>
                <span className={styles.fieldLabel}>常用学科</span>
                <select
                  className={styles.select}
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                >
                  {SUBJECT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <fieldset className={styles.radioGroup}>
                <legend className={styles.fieldLabel}>登录后默认进入</legend>
                {DEFAULT_ENTRY_OPTIONS.map((option) => (
                  <label className={styles.radioOption} key={option.value}>
                    <input
                      type="radio"
                      name="default-entry"
                      value={option.value}
                      checked={defaultEntry === option.value}
                      onChange={() => setDefaultEntry(option.value)}
                    />
                    <span>
                      <span className={styles.radioLabel}>{option.label}</span>
                      <span className={styles.radioHint}>{option.hint}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
            </section>

            <div className={styles.saveRow}>
              <button
                type="button"
                className={styles.primary}
                onClick={handleSave}
                disabled={updateMe.isPending}
              >
                {updateMe.isPending ? '正在保存…' : '保存修改'}
              </button>
              <span className={styles.saveHint}>
                保存后，顶栏昵称与头像会立即更新；默认入口在下次登录时生效。
              </span>
            </div>
          </div>

          <aside className={styles.sideColumn}>
            <section className={styles.card} aria-labelledby="settings-account-title">
              <div className={styles.cardHead}>
                <h2 className={styles.cardTitle} id="settings-account-title">
                  账号信息
                </h2>
              </div>
              <dl className={styles.accountList}>
                <div className={styles.accountRow}>
                  <dt>用户名</dt>
                  <dd>@{user.username}</dd>
                </div>
                <div className={styles.accountRow}>
                  <dt>邮箱</dt>
                  <dd>{user.email}</dd>
                </div>
                <div className={styles.accountRow}>
                  <dt>注册时间</dt>
                  <dd>{formatDate(user.created_at)}</dd>
                </div>
              </dl>
              <p className={styles.accountNote}>
                修改密码与换绑邮箱需要额外的验证流程，后续版本开放。
              </p>
            </section>
          </aside>
        </div>
      </main>

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
