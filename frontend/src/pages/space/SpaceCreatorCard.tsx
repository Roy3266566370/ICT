import { Link } from 'react-router-dom';
import type { Creator } from '@/api/plazaTypes';
import type { AuthUser } from '@/api/types';
import { AccountAvatar } from '@/components/account/AccountAvatar';
import type { AccountStatus } from '@/state/accountSession';
import type { SpaceCoverTheme } from '@/state/spacePreferences';
import styles from '../SpacePage.module.css';

export interface ProfileDraftView {
  displayName: string;
  bio: string;
  occupation: string;
  school: string;
  interests: readonly string[];
}

interface Props {
  status: AccountStatus;
  user: AuthUser | null;
  draft: ProfileDraftView;
  coverTheme: SpaceCoverTheme;
  coverImage: string | null;
  completion: number;
  inSettings: boolean;
  avatarBusy: boolean;
  earliestExpiry: string | null;
  materialCount: number;
  blockCount: number;
  now: number;
  onPickAvatar: () => void;
  onOpenPoster: () => void;
  onEditProfile: () => void;
}

const LOGIN_PATH = '/login?returnTo=%2Fspace';

function formatJoined(iso: string): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return '';
  return new Date(parsed).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' });
}

function remainingTime(milliseconds: number): string {
  const minutes = Math.ceil(milliseconds / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  if (days > 0) return `${days} 天 ${hours} 小时`;
  if (hours > 0) return `${hours} 小时 ${rest} 分钟`;
  return `${minutes} 分钟`;
}

export function CoverPattern(): JSX.Element {
  return (
    <svg className={styles.coverPattern} viewBox="0 0 600 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <pattern id="wxSpaceGridDots" width="24" height="24" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="1" fill="currentColor" opacity="0.45" />
        </pattern>
      </defs>
      <rect width="600" height="200" fill="url(#wxSpaceGridDots)" />
      <path d="M-20 140 Q 140 50, 300 120 T 620 75" fill="none" stroke="currentColor" strokeWidth="1.4" opacity="0.55" />
      <path d="M-20 165 Q 170 90, 330 145 T 620 110" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="4 5" opacity="0.4" />
      <circle cx="485" cy="68" r="34" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.35" />
      <circle cx="485" cy="68" r="14" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.45" />
    </svg>
  );
}

export function SpaceCreatorCard(props: Props | { readOnly: true; creator: Creator }): JSX.Element {
  if (!('readOnly' in props)) return <EditableCreatorCard {...props} />;
  const { creator } = props;
  return <section className={`${styles.card} ${styles.bentoProfile}`} aria-label="创作者名片">
    <div className={`${styles.bentoProfileBanner} ${styles.coverSurface}`} data-theme="ivory-gold"><CoverPattern /></div>
    <div className={styles.bentoProfileBody}>
      <div className={styles.bentoAvatarRow}>
        <div className={styles.bentoAvatarRing}>
          <AccountAvatar size="xl" label={creator.display_name} avatarUrl={creator.avatar_url} />
        </div>
      </div>
      <h2 className={styles.profileName}>{creator.display_name}</h2>
      <div className={styles.profileMetaLine}>
        {creator.occupation && <span className={styles.metaPill}>{creator.occupation}</span>}
        {creator.school && <span>{creator.school}</span>}
      </div>
      {creator.bio && <p className={styles.profileBio}>{creator.bio}</p>}
      {creator.interests.length > 0 && <div className={styles.tagList} aria-label="学科兴趣标签">
        {creator.interests.map(tag => <span key={tag} className={styles.tag}># {tag}</span>)}
      </div>}
      <div className={styles.metricRow}>
        <div className={styles.metricBox}><strong>{creator.stats.count}</strong><span>公开作品</span></div>
        <div className={styles.metricBox}><strong>{creator.stats.likes}</strong><span>获赞</span></div>
        <div className={styles.metricBox}><strong>{creator.stats.forks}</strong><span>被复刻</span></div>
      </div>
    </div>
  </section>;
}

function EditableCreatorCard({
  status,
  user,
  draft,
  coverTheme,
  coverImage,
  completion,
  inSettings,
  avatarBusy,
  earliestExpiry,
  materialCount,
  blockCount,
  now,
  onPickAvatar,
  onOpenPoster,
  onEditProfile,
}: Props): JSX.Element {
  if (status !== 'authenticated' || user === null) {
    const remaining = earliestExpiry ? Date.parse(earliestExpiry) - now : 0;
    return (
      <section className={`${styles.card} ${styles.bentoProfile}`} aria-label="访客档案">
        <div className={`${styles.bentoProfileBanner} ${styles.coverSurface}`} data-theme={coverTheme}>
          <CoverPattern />
        </div>
        <div className={styles.bentoProfileBody} style={{ marginTop: -26 }}>
          <div className={styles.guestBox}>
            <h3>访客模式</h3>
            <p>
              {status === 'unavailable' ? (
                '账号服务暂时不可用。当前浏览器中的本机积木与本地画布仍可正常使用。'
              ) : (
                <>
                  当前浏览器会话中已有{' '}<strong>{materialCount} 份课件</strong>与{' '}<strong className="keep-together">{blockCount} 块本机积木</strong>。
                  {earliestExpiry ? (
                    <>
                      {' '}
                      {remaining > 0 ? (
                        <>最早一份访客课件将在 <b>{remainingTime(remaining)}</b> 后自动清理。</>
                      ) : (
                        '有访客活页已到期，将自动清理。'
                      )}
                    </>
                  ) : null}
                </>
              )}
            </p>
            {status !== 'unavailable' ? (
              <div className={styles.inlineRow}>
                <Link className={`${styles.btn} ${styles.btnPrimary}`} to={LOGIN_PATH}>登录管理资料</Link>
                <Link className={`${styles.btn} ${styles.btnGhost}`} to="/register">免费注册</Link>
              </div>
            ) : null}
          </div>
          <p className={styles.guestHint}>
            登录后可自定义头像、个人名片、主页氛围主题，并同步通文册默认 PPT 主题与创作偏好。
          </p>
        </div>
      </section>
    );
  }

  const label = draft.displayName.trim() || user.username || user.email;
  const occupation = draft.occupation.trim();
  const school = draft.school.trim();
  const bio = draft.bio.trim();
  const joined = formatJoined(user.created_at);

  return (
    <section className={`${styles.card} ${styles.bentoProfile}`} aria-label="创作者名片">
      <div className={`${styles.bentoProfileBanner} ${styles.coverSurface}`} data-theme={coverTheme}>
        {coverImage ? <img className={styles.customCardCover} src={coverImage} alt="" /> : <CoverPattern />}
        {inSettings ? <span className={styles.livePreviewBadge}>实时预览中</span> : null}
      </div>
      <div className={styles.bentoProfileBody}>
        <div className={styles.bentoAvatarRow}>
          <div className={styles.bentoAvatarRing}>
            <button
              type="button"
              className={styles.avatarEditable}
              aria-label="更换头像"
              title="点击更换头像"
              disabled={avatarBusy}
              onClick={onPickAvatar}
            >
              <AccountAvatar size="xl" label={label} avatarUrl={user.avatar_url ?? null} />
              <span className={styles.avatarMask} aria-hidden="true">
                {avatarBusy ? '上传中…' : '更换头像'}
              </span>
            </button>
          </div>
          <div className={styles.inlineRow}>
            <button type="button" className={`${styles.btn} ${styles.btnSm} ${styles.btnGhost}`} onClick={onOpenPoster}>
              名片图
            </button>
            {!inSettings ? (
              <button type="button" className={`${styles.btn} ${styles.btnSm} ${styles.btnPrimary}`} onClick={onEditProfile}>
                ✎ 编辑资料
              </button>
            ) : null}
          </div>
        </div>

        <h2 className={styles.profileName}>{label}</h2>
        <p className={styles.profileHandle}>@{user.username}</p>

        {occupation || school ? (
          <div className={styles.profileMetaLine}>
            {occupation ? <span className={styles.metaPill}>{occupation}</span> : null}
            {school ? <span>{school}</span> : null}
          </div>
        ) : null}

        <p className={styles.profileBio}>
          {bio || <span className={styles.bioPlaceholder}>还没有填写简介，介绍一下你的教学与创作方向吧。</span>}
        </p>

        {draft.interests.length > 0 ? (
          <div className={styles.tagList} aria-label="学科兴趣标签">
            {draft.interests.map((tag) => (
              <span className={styles.tag} key={tag}># {tag}</span>
            ))}
          </div>
        ) : null}

        <div className={styles.profileFooter}>
          <span className={styles.profileJoined}>
            {user.email}{joined ? ` · 加入于 ${joined}` : ''}
          </span>
          {completion < 5 ? (
            <span className={styles.completionChipWarn}>完整度 {completion * 20}%</span>
          ) : (
            <span className={styles.completionChipOk}>✓ 档案已完善</span>
          )}
        </div>
      </div>
    </section>
  );
}
