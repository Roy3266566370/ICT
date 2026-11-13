/**
 * 登录 / 注册页共享骨架：明亮纸感底色 + 浅色表单卡片。
 *
 * 职责边界：
 *  - 只负责版式、品牌文案与顶部账号切换，不持有任何表单状态；
 *  - `children` 是页面传入的表单（或状态占位）；
 *  - 登录页通过 `scene` 传入三维场景，注册页通过 `highlights` 传入权益清单；
 *  - `notice` 用于「注册成功，请登录」这类一次性提示，`statusText` 用于账号状态
 *    尚未判定完成时的占位，两者互斥。
 */
import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { BrandLockup } from '@/components/brand/BrandLockup';
import backdropUrl from '../../assets/auth/auth-math-backdrop-light.webp';
import neuralNetUrl from '../../assets/auth/auth-neural-net.svg';

import styles from './AuthShell.module.css';

export type AuthVariant = 'login' | 'register';

export interface AuthShellProps {
  variant: AuthVariant;
  /** 品牌区上方的小标签（英文/中文均可） */
  eyebrow: string;
  /** 两行大标题；第二行使用渐变强调色 */
  headline: readonly [string, string];
  lead: string;
  /** 登录页的三维场景（已带尺寸约束） */
  scene?: ReactNode;
  sceneCaption?: string;
  highlightsTitle?: string;
  highlights?: readonly string[];
  /** 卡片内的一次性提示（成功后置色） */
  notice?: string | null;
  /** 账号状态占位文案；有值时替代 `children` */
  statusText?: string | null;
  children?: ReactNode;
}

const VARIANT_COPY: Readonly<
  Record<AuthVariant, { readonly switchText: string; readonly switchLabel: string; readonly switchTo: string }>
> = {
  login: { switchText: '还没有账号？', switchLabel: '免费注册', switchTo: '/register' },
  register: { switchText: '已有账号？', switchLabel: '直接登录', switchTo: '/login' },
};

export function AuthShell({
  variant,
  eyebrow,
  headline,
  lead,
  scene,
  sceneCaption,
  highlightsTitle,
  highlights,
  notice = null,
  statusText = null,
  children,
}: AuthShellProps): JSX.Element {
  const copy = VARIANT_COPY[variant];

  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('auth-no-scrollbar');
    const previousTitle = document.title;
    document.title = `${variant === 'login' ? '登录' : '注册'} · 万象`;
    return () => {
      root.classList.remove('auth-no-scrollbar');
      document.title = previousTitle;
    };
  }, [variant]);
  const hasHighlights = highlights !== undefined && highlights.length > 0;

  return (
    <div className={styles.page}>
      <img className={styles.artwork} src={backdropUrl} alt="" aria-hidden="true" />
      <div className={styles.artScrim} aria-hidden="true" />
      <div className={styles.aura} aria-hidden="true" />
      <div className={styles.grid} aria-hidden="true" />

      <div className={styles.networkMotif} aria-hidden="true">
        <img className={styles.networkSvg} src={neuralNetUrl} alt="" />
      </div>

      <div className={styles.shell}>
        <header className={styles.topbar}>
          <BrandLockup />
          <nav className={styles.topActions} aria-label="账号导航">
            <Link className={styles.homeLink} to="/">
              返回首页
            </Link>
            <span className={styles.topDivider} aria-hidden="true" />
            <span className={styles.switchText}>{copy.switchText}</span>
            <Link className={styles.switchButton} to={copy.switchTo}>
              {copy.switchLabel}
            </Link>
          </nav>
        </header>

        <main className={styles.main}>
          <section className={styles.brandColumn} aria-label="万象介绍">
            <p className={styles.eyebrow}>
              <span className={styles.eyebrowDot} aria-hidden="true" />
              {eyebrow}
            </p>
            <p className={styles.headline}>
              <span>{headline[0]}</span>
              <span className={styles.headlineAccent}>{headline[1]}</span>
            </p>
            <p className={styles.lead}>{lead}</p>

            {scene !== undefined ? (
              <figure className={styles.stage}>
                <div className={styles.stageBar}>
                  <span className={styles.stageDots} aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                  <figcaption className={styles.stageCaption}>{sceneCaption}</figcaption>
                </div>
                <div className={styles.stageBody}>{scene}</div>
              </figure>
            ) : null}

            {hasHighlights ? (
              <div className={styles.highlights}>
                {highlightsTitle !== undefined ? (
                  <h2 className={styles.highlightsTitle}>{highlightsTitle}</h2>
                ) : null}
                <ul className={styles.highlightList}>
                  {highlights.map((item) => (
                    <li key={item} className={styles.highlightItem}>
                      <span className={styles.check} aria-hidden="true">
                        <svg viewBox="0 0 12 12" width="11" height="11" focusable="false">
                          <path
                            d="M2 6.2 4.8 9 10 3.4"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>

          <section
            className={
              variant === 'register'
                ? `${styles.formColumn} ${styles.formColumnWide}`
                : styles.formColumn
            }
          >
            <div className={styles.formCard}>
              {notice !== null && notice.trim() !== '' ? (
                <p className={styles.notice} role="status">
                  <span className={styles.noticeIcon} aria-hidden="true">
                    ✓
                  </span>
                  {notice}
                </p>
              ) : null}

              {statusText !== null && statusText.trim() !== '' ? (
                <p className={styles.statusNote} role="status" aria-live="polite">
                  <span className={styles.statusDot} aria-hidden="true" />
                  {statusText}
                </p>
              ) : (
                children
              )}
            </div>

            <p className={styles.securityNote}>
              <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">
                <path
                  d="M8 1.8 13.2 4v3.6c0 3.1-2.1 5.5-5.2 6.6-3.1-1.1-5.2-3.5-5.2-6.6V4L8 1.8Z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinejoin="round"
                />
                <path
                  d="m5.9 8 1.5 1.5 2.8-2.8"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              密码不会写入本地存储，登录会话由 HttpOnly Cookie 保护
            </p>
          </section>
        </main>

        <footer className={styles.footer}>
          <span>© 2026 万象 WANXIANG</span>
          <span className={styles.footerDivider} aria-hidden="true" />
          <span>把课堂材料变成可推演的交互对象</span>
        </footer>
      </div>
    </div>
  );
}

export default AuthShell;
