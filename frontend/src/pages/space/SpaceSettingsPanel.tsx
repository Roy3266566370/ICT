import { useState, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import type { AuthUser } from '@/api/types';
import { AccountAvatar } from '@/components/account/AccountAvatar';
import { THEMES } from '@/document/themes';
import type { AccountStatus } from '@/state/accountSession';
import {
  COVER_THEMES,
  DEFAULT_SUBJECT_OPTIONS,
  type SpaceCoverTheme,
  type SpacePreferences,
} from '@/state/spacePreferences';
import styles from '../SpacePage.module.css';

export const DISPLAY_NAME_MAX = 64;
export const BIO_MAX = 200;
export const PROFILE_TEXT_MAX = 64;
export const INTEREST_MAX = 24;
export const INTEREST_COUNT_MAX = 8;
export const PHONE_PATTERN = /^1[3-9]\d{9}$/;
export const PHONE_ERROR = '手机号格式不正确，请输入 11 位中国大陆手机号';
const SUGGESTED_INTERESTS = ['高等数学', '线性代数', '大学物理', '408 专题', '深度学习', '办公决策', '可视化教学'];

export function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === '') return '';
  let digits = trimmed.replace(/[\s-]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (digits.length === 13 && digits.startsWith('86')) digits = digits.slice(2);
  return PHONE_PATTERN.test(digits) ? digits : null;
}

function formatDate(iso: string): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return iso;
  return new Date(parsed).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
}

export interface ProfileFormState {
  displayName: string;
  bio: string;
  occupation: string;
  school: string;
  phone: string;
  interests: readonly string[];
}

interface Props {
  status: AccountStatus;
  user: AuthUser | null;
  profileReady: boolean;
  form: ProfileFormState;
  prefs: SpacePreferences;
  phoneError: string | null;
  phoneInputRef: RefObject<HTMLInputElement>;
  avatarBusy: boolean;
  deleteAvatarPending: boolean;
  avatarError: string | null;
  avatarStatus: string;
  signingOut: boolean;
  onFormChange: (patch: Partial<ProfileFormState>) => void;
  onPhoneError: (error: string | null) => void;
  onPrefsChange: (patch: Partial<SpacePreferences>) => void;
  onPickAvatar: () => void;
  onResetAvatar: () => void;
  onSignOut: () => void;
}

export function SpaceSettingsPanel({
  status,
  user,
  profileReady,
  form,
  prefs,
  phoneError,
  phoneInputRef,
  avatarBusy,
  deleteAvatarPending,
  avatarError,
  avatarStatus,
  signingOut,
  onFormChange,
  onPhoneError,
  onPrefsChange,
  onPickAvatar,
  onResetAvatar,
  onSignOut,
}: Props): JSX.Element {
  const [interestDraft, setInterestDraft] = useState('');
  const [interestError, setInterestError] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);

  const authenticated = status === 'authenticated' && user !== null;

  const addInterest = (value: string): void => {
    const text = value.trim();
    if (!text) return;
    if (Array.from(text).length > INTEREST_MAX) {
      setInterestError(`单个兴趣标签最多 ${INTEREST_MAX} 个字符`);
      return;
    }
    if (form.interests.includes(text)) {
      if (value === interestDraft) setInterestDraft('');
      return;
    }
    if (form.interests.length >= INTEREST_COUNT_MAX) {
      setInterestError(`兴趣标签最多 ${INTEREST_COUNT_MAX} 个`);
      return;
    }
    onFormChange({ interests: [...form.interests, text] });
    if (value === interestDraft) setInterestDraft('');
    setInterestError('');
  };

  const removeInterest = (value: string): void => {
    onFormChange({ interests: form.interests.filter((item) => item !== value) });
    setInterestError('');
  };

  return (
    <div className={styles.settingsStack}>
      {!authenticated ? (
        <section className={`${styles.card} ${styles.formCard}`}>
          <div className={styles.guestBox}>
            <h3>登录后管理个人资料与账号信息</h3>
            <p>
              访客模式下，你依然可以在下方调整本机的主页氛围与新建 PPT 默认偏好；登录后可自定义头像、个人名片与学科标签。
              {status === 'unavailable' ? '（账号服务暂时不可用，请稍后重试。）' : ''}
            </p>
            {status !== 'unavailable' ? (
              <div className={styles.inlineRow}>
                <Link className={`${styles.btn} ${styles.btnPrimary}`} to="/login?returnTo=%2Fspace%3Ftab%3Dsettings">
                  立即登录
                </Link>
                <Link className={`${styles.btn} ${styles.btnGhost}`} to="/register">
                  免费注册
                </Link>
              </div>
            ) : null}
          </div>
        </section>
      ) : !profileReady ? (
        <section className={`${styles.card} ${styles.formCard}`} aria-busy="true">
          <p className={styles.listState} style={{ margin: 0 }}>正在读取账号资料… 若长时间未加载，可刷新页面重试。</p>
        </section>
      ) : (
        <>
          <section className={`${styles.card} ${styles.formCard}`} aria-labelledby="settings-basic-title">
            <div className={styles.formCardHead}>
              <h3 id="settings-basic-title">基本资料与头像</h3>
              <span>左侧名片实时同步预览</span>
            </div>

            <div className={styles.avatarSettingRow}>
              <button
                type="button"
                className={styles.avatarEditable}
                aria-label="更换头像"
                disabled={avatarBusy || deleteAvatarPending}
                onClick={onPickAvatar}
              >
                <AccountAvatar
                  size="xl"
                  label={form.displayName.trim() || user.username}
                  avatarUrl={user.avatar_url ?? null}
                />
                <span className={styles.avatarMask} aria-hidden="true">更换头像</span>
              </button>
              <div className={styles.avatarSettingInfo}>
                <div className={styles.inlineRow}>
                  <button
                    type="button"
                    className={`${styles.btn} ${styles.btnSm} ${styles.btnGhost}`}
                    disabled={avatarBusy}
                    onClick={onPickAvatar}
                  >
                    {avatarBusy ? '正在上传…' : '上传新头像'}
                  </button>
                  {user.avatar_url ? (
                    confirmReset ? (
                      <>
                        <button
                          type="button"
                          className={`${styles.btn} ${styles.btnSm} ${styles.btnDangerGhost}`}
                          disabled={deleteAvatarPending}
                          onClick={() => {
                            onResetAvatar();
                            setConfirmReset(false);
                          }}
                        >
                          {deleteAvatarPending ? '恢复中…' : '确认恢复默认'}
                        </button>
                        <button
                          type="button"
                          className={`${styles.btn} ${styles.btnSm} ${styles.btnSoft}`}
                          disabled={deleteAvatarPending}
                          onClick={() => setConfirmReset(false)}
                        >
                          取消
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className={`${styles.btn} ${styles.btnSm} ${styles.btnGhost}`}
                        onClick={() => setConfirmReset(true)}
                      >
                        恢复默认头像
                      </button>
                    )
                  ) : null}
                </div>
                <p className={styles.fieldHintText}>JPG、PNG 或 WebP，最大 2 MB</p>
                {avatarError ? <p className={styles.fieldError} role="alert">{avatarError}</p> : null}
                {avatarStatus ? <p className={styles.fieldSuccess} role="status">{avatarStatus}</p> : null}
              </div>
            </div>

            <div className={styles.formGrid}>
              <div className={styles.field}>
                <label htmlFor="space-display-name">昵称</label>
                <input
                  id="space-display-name"
                  type="text"
                  maxLength={DISPLAY_NAME_MAX}
                  value={form.displayName}
                  onChange={(e) => onFormChange({ displayName: e.target.value })}
                  placeholder="用于主页展示的名字"
                />
              </div>
              <div className={styles.field}>
                <label htmlFor="space-phone">手机号（选填）</label>
                <input
                  ref={phoneInputRef}
                  id="space-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  maxLength={20}
                  value={form.phone}
                  onChange={(e) => {
                    onFormChange({ phone: e.target.value });
                    onPhoneError(null);
                  }}
                  onBlur={() => onPhoneError(normalizePhone(form.phone) === null ? PHONE_ERROR : null)}
                  placeholder="如 13812345678，可带 +86"
                  aria-invalid={phoneError !== null}
                />
                {phoneError ? (
                  <span className={styles.fieldError} role="alert">{phoneError}</span>
                ) : (
                  <span className={styles.fieldHintText}>仅用于账号联系，不在名片公开显示</span>
                )}
              </div>
              <div className={`${styles.field} ${styles.fieldWide}`}>
                <label htmlFor="space-bio">个人简介</label>
                <textarea
                  id="space-bio"
                  rows={3}
                  maxLength={BIO_MAX}
                  value={form.bio}
                  onChange={(e) => onFormChange({ bio: e.target.value })}
                  placeholder="一句话介绍你自己，比如正在教什么、在做什么"
                />
                <div className={styles.fieldHintRow}>
                  <span>展示在个人名片与导出的创作者名片图中</span>
                  <span>{form.bio.length} / {BIO_MAX}</span>
                </div>
              </div>
            </div>
          </section>

          <section className={`${styles.card} ${styles.formCard}`} aria-labelledby="settings-identity-title">
            <div className={styles.formCardHead}>
              <h3 id="settings-identity-title">身份与学科兴趣</h3>
              <span>展示在个人名片与创作者档案中</span>
            </div>
            <div className={styles.formGrid}>
              <div className={styles.field}>
                <label htmlFor="space-occupation">职业（选填）</label>
                <input
                  id="space-occupation"
                  type="text"
                  maxLength={PROFILE_TEXT_MAX}
                  value={form.occupation}
                  onChange={(e) => onFormChange({ occupation: e.target.value })}
                  placeholder="如：教师、学生、研究者"
                />
              </div>
              <div className={styles.field}>
                <label htmlFor="space-school">学校 / 单位（选填）</label>
                <input
                  id="space-school"
                  type="text"
                  maxLength={PROFILE_TEXT_MAX}
                  value={form.school}
                  onChange={(e) => onFormChange({ school: e.target.value })}
                  placeholder="如：中国石油大学"
                />
              </div>
              <div className={`${styles.field} ${styles.fieldWide}`}>
                <label htmlFor="space-interest-input">兴趣标签（选填，最多 {INTEREST_COUNT_MAX} 个）</label>
                <div className={styles.tagEditor}>
                  {form.interests.map((item) => (
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
                    id="space-interest-input"
                    type="text"
                    maxLength={INTEREST_MAX}
                    value={interestDraft}
                    onChange={(e) => {
                      setInterestDraft(e.target.value);
                      setInterestError('');
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        addInterest(interestDraft);
                      }
                    }}
                    placeholder="输入后回车添加"
                  />
                  <button
                    type="button"
                    className={`${styles.btn} ${styles.btnSm} ${styles.btnSoft}`}
                    onClick={() => addInterest(interestDraft)}
                  >
                    添加
                  </button>
                </div>
                {interestError ? <p className={styles.fieldError} role="alert">{interestError}</p> : null}
                <div className={styles.suggestRow} role="group" aria-label="推荐兴趣标签">
                  {SUGGESTED_INTERESTS.map((interest) => (
                    <button
                      type="button"
                      key={interest}
                      className={styles.suggestBtn}
                      disabled={form.interests.includes(interest)}
                      onClick={() => addInterest(interest)}
                    >
                      {form.interests.includes(interest) ? '✓' : '+'} {interest}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>
        </>
      )}

      <section className={`${styles.card} ${styles.formCard}`} aria-labelledby="settings-prefs-title">
        <div className={styles.formCardHead}>
          <h3 id="settings-prefs-title">主页氛围与全站创作偏好</h3>
          <span>新建通文册 PPT 时自动套用默认主题与比例</span>
        </div>
        <div className={styles.formGrid}>
          <div className={`${styles.field} ${styles.fieldWide}`}>
            <label>个人名片氛围主题</label>
            <div className={styles.themeCardGrid}>
              {COVER_THEMES.map((theme) => (
                <button
                  key={theme.id}
                  type="button"
                  className={styles.themePick}
                  data-active={prefs.coverTheme === theme.id || undefined}
                  onClick={() => onPrefsChange({ coverTheme: theme.id as SpaceCoverTheme })}
                >
                  <div className={`${styles.themePickPreview} ${styles.coverSurface}`} data-theme={theme.id} />
                  <span>{theme.name}</span>
                </button>
              ))}
            </div>
          </div>

          <div className={`${styles.field} ${styles.fieldWide}`}>
            <label>通文册新建 PPT 默认主题</label>
            <div className={styles.pptThemeGrid}>
              {THEMES.map(([id, name, background, primary]) => (
                <button
                  key={id}
                  type="button"
                  className={styles.pptThemeBtn}
                  data-active={prefs.defaultPptTheme === id || undefined}
                  onClick={() => onPrefsChange({ defaultPptTheme: id })}
                >
                  <i className={styles.swatchDot} style={{ background, borderColor: primary }} />
                  <span>{name}</span>
                </button>
              ))}
            </div>
          </div>

          <div className={styles.field}>
            <label htmlFor="space-default-ratio">通文册默认画布比例</label>
            <select
              id="space-default-ratio"
              value={prefs.defaultRatio}
              onChange={(e) => onPrefsChange({ defaultRatio: e.target.value === '4:3' ? '4:3' : '16:9' })}
            >
              <option value="16:9">16:9 宽屏演示（推荐）</option>
              <option value="4:3">4:3 传统投影</option>
            </select>
          </div>

          <div className={styles.field}>
            <label htmlFor="space-default-subject">定象坊优先学科</label>
            <select
              id="space-default-subject"
              value={prefs.defaultSubject}
              onChange={(e) => onPrefsChange({ defaultSubject: e.target.value })}
            >
              {DEFAULT_SUBJECT_OPTIONS.map((subject) => (
                <option key={subject} value={subject}>{subject}</option>
              ))}
            </select>
          </div>

          <div className={`${styles.field} ${styles.fieldWide}`}>
            <label className={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={prefs.reducedMotion}
                onChange={(e) => onPrefsChange({ reducedMotion: e.target.checked })}
              />
              <span>偏好精简动效（减少主页波形动画与页面过渡效果）</span>
            </label>
          </div>
        </div>
      </section>

      {authenticated ? (
        <section className={`${styles.card} ${styles.formCard}`} aria-labelledby="settings-account-title">
          <div className={styles.formCardHead}>
            <h3 id="settings-account-title">账号信息与数据说明</h3>
            <span>只读账号凭据</span>
          </div>
          <div className={styles.prefSummary} style={{ marginBottom: 14 }}>
            <div className={styles.prefRow}><span>登录邮箱</span><strong>{user.email}</strong></div>
            <div className={styles.prefRow}><span>用户名</span><strong className={styles.monoText}>@{user.username}</strong></div>
            <div className={styles.prefRow}><span>注册时间</span><strong>{formatDate(user.created_at)}</strong></div>
          </div>
          <div className={styles.accountFoot}>
            <span className={styles.fieldHintText}>自定义积木保存在当前浏览器，建议在「个人主页 → 资产管家」定期导出 JSON 备份。</span>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnSm} ${styles.btnDangerGhost}`}
              disabled={signingOut}
              onClick={onSignOut}
            >
              {signingOut ? '正在退出…' : '退出登录'}
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
