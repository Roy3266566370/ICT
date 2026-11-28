import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { RouteLink } from '@/components/navigation/RouteLink';
import markUrl from '@/assets/brand/wanxiang-mark.png';
import { AccountAvatar } from '@/components/account/AccountAvatar';
import { useAccountSessionActions } from '@/hooks/useAccountBootstrap';
import { useAccountStatus, useAccountUser } from '@/state/accountSession';
import { navAccountEntries } from './navAccountItems';
import type { NavAccountEntry } from './navAccountItems';
import styles from './SiteNav.module.css';

export type NavSection = 'home' | 'canvas' | 'workspace' | 'examples' | 'labs' | 'living' | 'plaza';

interface NavItem {
  section: NavSection;
  label: string;
  to: string;
}

/** 主站导航：使用指南已并入首页底部，不再占用独立入口。 */
const NAV_ITEMS: readonly NavItem[] = [
  { section: 'home', label: '首页', to: '/' },
  { section: 'canvas', label: '定象坊', to: '/workshop' },
  { section: 'living', label: '通文册', to: '/living' },
  { section: 'plaza', label: '广场', to: '/plaza' },
  { section: 'workspace', label: '个人主页', to: '/space' },
];

/** 账号菜单的两种宿主：桌面顶栏与移动端展开面板。 */
type AccountMenuVariant = 'desktop' | 'mobile';

const DESKTOP_ACCOUNT_MENU_ID = 'site-account-menu';
const MOBILE_ACCOUNT_MENU_ID = 'site-mobile-account-menu';

const NOTICE_SIGNED_OUT: '已退出登录' = '已退出登录';
const NOTICE_SIGN_OUT_FAILED: '退出未能完成，请稍后重试' = '退出未能完成，请稍后重试';

export interface SiteNavProps {
  /** 两个主页共用的纸面工作室外观；默认主题兼容其他页面。 */
  appearance?: 'default' | 'studio';
  /** 需要高亮的栏目；首页传 `'home'`，其它无对应栏目的页面传 `null`。 */
  current: NavSection | null;
  /** 首页等场景可提供一个上传入口；不传时保持原三栏导航。 */
  onUpload?: () => void;
}

/**
 * 三个 T3 页面共用的顶栏（80px，与 §2.1 的导航高度一致）。
 * `<768px` 收起为汉堡菜单；`aria-expanded` / `aria-controls` 与 Escape 关闭均已实现。
 *
 * 账号入口（契约 `C-NAV-ACCOUNT@1`）：
 *  - 桌面区与移动端菜单消费**同一个** `navAccountEntries(status, user)` 结果；
 *  - `restoring` 不渲染任何账号入口，`unavailable` 只保留带提示的「登录」；
 *  - 账号按钮是 `<button type="button">`，展开菜单含「个人空间」与「退出登录」，
 *    支持 Escape 关闭与路由变化自动关闭。
 */
export function SiteNav({ current, onUpload, appearance = 'default' }: SiteNavProps): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const [openAccountMenu, setOpenAccountMenu] = useState<AccountMenuVariant | null>(null);
  const [accountNotice, setAccountNotice] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const location = useLocation();

  const status = useAccountStatus();
  const user = useAccountUser();
  const { signOut } = useAccountSessionActions();
  const accountEntries = useMemo(() => navAccountEntries(status, user), [status, user]);

  const desktopAccountAreaRef = useRef<HTMLDivElement>(null);
  const mobileAccountAreaRef = useRef<HTMLDivElement>(null);
  const desktopAccountButtonRef = useRef<HTMLButtonElement>(null);
  const mobileAccountButtonRef = useRef<HTMLButtonElement>(null);
  const firstMenuItemRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    setMenuOpen(false);
    setOpenAccountMenu(null);
    setAccountNotice(null);
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!menuOpen && openAccountMenu === null) return undefined;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      // 账号菜单优先级更高：先收起它并把焦点还给触发按钮，再管移动端面板。
      if (openAccountMenu !== null) {
        const button = openAccountMenu === 'desktop'
          ? desktopAccountButtonRef.current
          : mobileAccountButtonRef.current;
        setOpenAccountMenu(null);
        button?.focus({ preventScroll: true });
        return;
      }
      setMenuOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [menuOpen, openAccountMenu]);

  // 菜单展开后把焦点移到第一个菜单项，键盘用户不必再 Tab 一次。
  useEffect(() => {
    if (openAccountMenu === null) return;
    firstMenuItemRef.current?.focus({ preventScroll: true });
  }, [openAccountMenu]);

  // 点击账号区之外收起菜单；点内部元素不打断操作。
  useEffect(() => {
    if (openAccountMenu === null) return undefined;
    const handlePointerDown = (event: MouseEvent): void => {
      const target: EventTarget | null = event.target;
      if (!(target instanceof Node)) return;
      if (desktopAccountAreaRef.current?.contains(target)) return;
      if (mobileAccountAreaRef.current?.contains(target)) return;
      setOpenAccountMenu(null);
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [openAccountMenu]);

  // 退出结果提示只保留几秒，避免顶栏长期挂一条状态。
  useEffect(() => {
    if (accountNotice === null) return undefined;
    const timer = window.setTimeout(() => setAccountNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [accountNotice]);

  /**
   * 退出登录（R4-AC5 的 UI 触发点，D-05：停留在当前页）。
   * `signed-out` → 关闭菜单并提示「已退出登录」；其余结果保留菜单与登录态可重试。
   */
  const handleSignOut = useCallback((): void => {
    void (async (): Promise<void> => {
      setSigningOut(true);
      setAccountNotice(null);
      try {
        const result = await signOut();
        if (result === 'signed-out') {
          setOpenAccountMenu(null);
          setAccountNotice(NOTICE_SIGNED_OUT);
          return;
        }
        setAccountNotice(NOTICE_SIGN_OUT_FAILED);
      } catch {
        // 契约保证 signOut 不抛错；兜底避免未处理的 rejection，并保持登录态可重试。
        setAccountNotice(NOTICE_SIGN_OUT_FAILED);
      } finally {
        setSigningOut(false);
      }
    })();
  }, [signOut]);

  const renderAccountEntry = (
    entry: NavAccountEntry,
    variant: AccountMenuVariant,
    isMobile: boolean,
  ): JSX.Element | null => {
    switch (entry.kind) {
      case 'loading':
        return null;
      case 'login':
        return (
          <Link
            key="login"
            className={isMobile ? styles.panelAccountLink : styles.accountLoginLink}
            to={entry.to}
            title={entry.hint ?? undefined}
            aria-description={entry.hint ?? undefined}
          >
            {entry.label}
          </Link>
        );
      case 'register':
        return (
          <Link
            key="register"
            className={isMobile ? styles.panelAccountRegister : styles.accountRegisterLink}
            to={entry.to}
          >
            {entry.label}
          </Link>
        );
      case 'account': {
        const expanded = openAccountMenu === variant;
        const menuId = isMobile ? MOBILE_ACCOUNT_MENU_ID : DESKTOP_ACCOUNT_MENU_ID;
        return (
          <div key="account" className={isMobile ? styles.panelAccountGroup : styles.accountGroup}>
            <button
              ref={isMobile ? mobileAccountButtonRef : desktopAccountButtonRef}
              type="button"
              className={styles.accountButton}
              aria-haspopup="menu"
              aria-expanded={expanded}
              aria-controls={menuId}
              onClick={() => {
                setAccountNotice(null);
                setOpenAccountMenu(expanded ? null : variant);
              }}
            >
              <AccountAvatar
                size="sm"
                label={entry.label}
                avatarUrl={entry.avatarUrl}
              />
              <span className={styles.accountName}>{entry.label}</span>
              <span className={styles.accountCaret} aria-hidden="true">▾</span>
            </button>
            {expanded ? (
              <div
                className={isMobile ? styles.panelAccountMenu : styles.accountMenu}
                id={menuId}
                role="menu"
                aria-label="账号菜单"
              >
                <p className={styles.accountEmail} title={entry.username === null ? entry.email : `${entry.username} · ${entry.email}`}>
                  {entry.username === null ? null : (
                    <span className={styles.accountHandle}>@{entry.username}</span>
                  )}
                  <span className={styles.accountEmailText}>{entry.email}</span>
                </p>
                <Link
                  ref={firstMenuItemRef}
                  className={styles.accountMenuItem}
                  role="menuitem"
                  to={entry.to}
                  onClick={() => setOpenAccountMenu(null)}
                >
                  个人主页
                </Link>
                <Link
                  className={styles.accountMenuItem}
                  role="menuitem"
                  to="/space?tab=settings"
                  onClick={() => setOpenAccountMenu(null)}
                >
                  个人设置
                </Link>
                <button
                  type="button"
                  className={styles.accountMenuItem}
                  role="menuitem"
                  onClick={handleSignOut}
                  disabled={signingOut}
                >
                  {signingOut ? '正在退出…' : '退出登录'}
                </button>
                {/* 失败时菜单保持展开，提示放在菜单内部才不会被下拉层遮住 */}
                {accountNotice !== null ? (
                  <p className={styles.accountMenuNotice} role="status">
                    {accountNotice}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      }
      default:
        return null;
    }
  };

  /** 桌面区与移动端菜单的唯一渲染入口：两者都消费同一个 `accountEntries`。 */
  const renderAccountEntries = (variant: AccountMenuVariant): JSX.Element | null => {
    if (accountEntries.length === 0) return null;
    const isMobile = variant === 'mobile';
    return (
      <div
        ref={isMobile ? mobileAccountAreaRef : desktopAccountAreaRef}
        className={isMobile ? styles.panelAccount : styles.accountArea}
      >
        {accountEntries.map((entry) => renderAccountEntry(entry, variant, isMobile))}
        {/* 菜单展开时提示在菜单内显示，避免与本浮层重叠；这里只处理菜单已关闭的结果 */}
        {accountNotice !== null && openAccountMenu !== variant ? (
          <p
            className={isMobile ? styles.panelAccountNotice : styles.accountNotice}
            role="status"
          >
            {accountNotice}
          </p>
        ) : null}
      </div>
    );
  };

  return (
    <header className={styles.header} data-appearance={appearance}>
      <div className={styles.inner}>
        <Link className={styles.brand} to="/" aria-label="万象 WANXIANG 首页">
          <span className={styles.mark} aria-hidden="true">
            <img src={markUrl} width="30" height="30" alt="" />
          </span>
          <span className={styles.brandText}>
            <span className={styles.brandName}>万象</span>
            <span className={styles.brandLatin}>WANXIANG</span>
          </span>
        </Link>

        <div className={styles.right}>
          <nav className={styles.nav} aria-label="主导航">
            {NAV_ITEMS.map((item) => (
              <RouteLink
                key={item.section}
                className={styles.link}
                to={item.to}
                aria-current={current === item.section ? 'page' : undefined}
              >
                {item.label}
              </RouteLink>
            ))}
          </nav>

          {onUpload ? (
            <button type="button" className={styles.uploadButton} onClick={onUpload}>
              <svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true" focusable="false">
                <path d="M10 13V3.5M6.4 6.8 10 3.2l3.6 3.6M4 12.5v3.2c0 .7.6 1.3 1.3 1.3h9.4c.7 0 1.3-.6 1.3-1.3v-3.2"
                  fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              上传 PPT
            </button>
          ) : null}

          {renderAccountEntries('desktop')}

          <button
            type="button"
            className={styles.menuButton}
            aria-expanded={menuOpen}
            aria-controls="site-mobile-nav"
            aria-label={menuOpen ? '关闭导航菜单' : '打开导航菜单'}
            onClick={() => {
              setOpenAccountMenu(null);
              setMenuOpen((open) => !open);
            }}
          >
            <span className={styles.menuIcon} aria-hidden="true">
              {menuOpen ? '✕' : '☰'}
            </span>
          </button>
        </div>
      </div>

      {menuOpen ? (
        <div className={styles.panel} id="site-mobile-nav">
          <nav className={styles.panelNav} aria-label="主导航（移动端）">
            {NAV_ITEMS.map((item) => (
              <RouteLink
                key={item.section}
                className={styles.panelLink}
                to={item.to}
                aria-current={current === item.section ? 'page' : undefined}
              >
                {item.label}
              </RouteLink>
            ))}
            {onUpload ? (
              <button type="button" className={styles.panelUpload}
                onClick={() => { setMenuOpen(false); onUpload(); }}>
                上传 PPT
              </button>
            ) : null}
          </nav>
          {renderAccountEntries('mobile')}
        </div>
      ) : null}
    </header>
  );
}

export default SiteNav;
