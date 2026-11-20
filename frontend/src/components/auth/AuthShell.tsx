import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import markUrl from '@/assets/brand/wanxiang-mark.png';
import styles from './AuthShell.module.css';

export type AuthVariant = 'login' | 'register';

export interface AuthShellProps {
  variant: AuthVariant;
  /** 品牌区上方的小标签（英文/中文均可） */
  eyebrow: string;
  /** 两行大标题；用 `|` 标出第二行需要朱砂下划线的部分 */
  headline: readonly [string, string];
  lead: string;
  /** 通行证上实时显示的登记名（来自表单 values） */
  passName?: string;
  /** 一次性提示（如注册成功，请登录） */
  notice?: string | null;
  /** 账号状态占位文案；有值时替代 children */
  statusText?: string | null;
  children?: ReactNode;
}

const VARIANT_COPY: Readonly<
  Record<
    AuthVariant,
    {
      readonly roleEn: string;
      readonly roleCn: string;
      readonly entry: string;
      readonly status: string;
      readonly stamp: string;
      readonly docTitle: string;
      readonly tabText: string;
    }
  >
> = {
  login: {
    roleEn: 'RETURNING MEMBER',
    roleCn: '回访者',
    entry: '个人空间（可设）',
    status: '回访',
    stamp: '再次入场',
    docTitle: '登录 · 万象题目实验室',
    tabText: '已有档案',
  },
  register: {
    roleEn: 'NEW RECORD',
    roleCn: '新档案',
    entry: '建立后可设置',
    status: '待建档',
    stamp: '新档案',
    docTitle: '注册 · 万象题目实验室',
    tabText: '新建档案',
  },
};

function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function serialFor(name: string): string {
  if (name === '') return 'NO. WX-2026-••••';
  const number = (hashString(name.toLowerCase()) % 9000) + 1000;
  return `NO. WX-2026-${number}`;
}

type BarcodeBar = { width: number; height: number };

function barcodeFor(name: string): BarcodeBar[] {
  let value = hashString(name || 'wanxiang') || 1;
  const bars: BarcodeBar[] = [];
  for (let i = 0; i < 32; i++) {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    bars.push({
      width: 1 + (value % 3),
      height: 72 + ((value >>> 9) % 29),
    });
  }
  return bars;
}

function renderHeadline(line: string, accentClassName: string): ReactNode {
  const parts = line.split('|');
  if (parts.length !== 2) return line;
  return (
    <>
      {parts[0]}
      <em className={accentClassName}>{parts[1]}</em>
    </>
  );
}

/**
 * 登录 / 注册共享准入登记台：
 * 左列是真正的表单 children，右列是随输入更新、可翻面的实验通行证。
 * 页面状态与提交逻辑仍由 LoginPage / RegisterPage 持有，本组件只负责外观与版式。
 */
export function AuthShell({
  variant,
  eyebrow,
  headline,
  lead,
  passName = '',
  notice = null,
  statusText = null,
  children,
}: AuthShellProps): JSX.Element {
  const [flipped, setFlipped] = useState(false);
  const copy = VARIANT_COPY[variant];
  const name = passName.trim();
  const hasName = name.length > 0;
  const displayedName = hasName ? name : '待填写';
  const firstChar = hasName ? Array.from(name)[0] ?? '万' : '万';
  const monogram = /[a-z]/i.test(firstChar) ? firstChar.toUpperCase() : firstChar;
  const serial = serialFor(name);
  const bars = useMemo(() => barcodeFor(name), [name]);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = copy.docTitle;
    return () => {
      document.title = previousTitle;
    };
  }, [copy.docTitle]);

  useEffect(() => {
    setFlipped(false);
  }, [variant]);

  return (
    <div className={styles.page} data-auth-variant={variant}>
      <header className={styles.topbar}>
        <Link className={styles.brand} to="/" aria-label="万象 WANXIANG 首页">
          <img className={styles.brandMark} src={markUrl} width={26} height={26} alt="" />
          <span className={styles.brandName}>万象</span>
          <span className={styles.brandLatin}>WANXIANG</span>
          <span className={styles.brandRule} aria-hidden="true" />
          <span className={styles.brandProduct}>准入登记</span>
        </Link>
        <div className={styles.topRight}>
          <span className={styles.topMeta}>DESK 02 · 2026</span>
          <Link className={styles.homeLink} to="/">
            返回首页 <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </header>

      <main className={styles.layout}>
        <section className={styles.paper} aria-labelledby="auth-title">
          <div className={styles.meta}>
            <p className={styles.eyebrow}>
              <i className={styles.cross} aria-hidden="true" />
              {eyebrow}
            </p>
            <span className={styles.metaNo}>IDENTITY &amp; RECORD</span>
          </div>

          <div className={styles.mainColumn}>
            <div className={styles.copy}>
              <h1 className={styles.headline} id="auth-title">
                <span>{renderHeadline(headline[0] ?? '', styles.accent ?? '')}</span>
                <span>{renderHeadline(headline[1] ?? '', styles.accent ?? '')}</span>
              </h1>
              <p className={styles.lead}>{lead}</p>
            </div>

            <nav className={styles.modeSwitch} aria-label="选择登录或注册">
              <Link
                className={`${styles.modeTab} ${variant === 'login' ? styles.modeTabActive : ''}`}
                to="/login"
                aria-current={variant === 'login' ? 'page' : undefined}
              >
                <span className={styles.modeTabNo}>01</span>
                <span className={styles.modeTabBody}>
                  <b>已有档案</b>
                  <em>SIGN IN / 登录</em>
                </span>
              </Link>
              <Link
                className={`${styles.modeTab} ${variant === 'register' ? styles.modeTabActive : ''}`}
                to="/register"
                aria-current={variant === 'register' ? 'page' : undefined}
              >
                <span className={styles.modeTabNo}>02</span>
                <span className={styles.modeTabBody}>
                  <b>新建档案</b>
                  <em>REGISTER / 注册</em>
                </span>
              </Link>
            </nav>

            <div className={styles.formArea}>
              {notice !== null && notice.trim() !== '' ? (
                <p className={styles.notice} role="status">
                  <span className={styles.noticeMark} aria-hidden="true">✓</span>
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

              {statusText === null || statusText.trim() === '' ? (
                <p className={styles.securityNote}>
                  密码不会写入本地存储，登录会话由 HttpOnly Cookie 保护
                </p>
              ) : null}
            </div>
          </div>

          <div className={styles.deskFoot}>
            <p className={styles.boundaryNote}>
              <i aria-hidden="true" />
              材料与实验仍按当前浏览器会话保存；跨设备同步与永久保存尚未开放。
            </p>
            <Link className={styles.guestLink} to="/labs#lab-samples-title">
              以访客身份体验题目实验室与示例 <span aria-hidden="true">→</span>
            </Link>
          </div>
        </section>

        <aside className={styles.access} aria-labelledby="access-title">
          <div className={styles.accessMeta}>
            <h2 id="access-title">LAB ACCESS / 通行证</h2>
            <span className={styles.accessLive}>
              <i aria-hidden="true" />LIVE · 随输入更新
            </span>
          </div>

          <figure className={styles.passScene}>
            <span className={styles.ghost} aria-hidden="true">入</span>
            <div className={styles.lanyard} aria-hidden="true"><span /></div>

            <div className={styles.pass} id="auth-pass">
              <div className={`${styles.passInner} ${flipped ? styles.passInnerFlipped : ''}`}>
                <div className={`${styles.passFace} ${styles.passFront}`} aria-hidden={flipped}>
                  <div className={styles.passTop}>
                    <span>WANXIANG / ACCESS PASS</span>
                    <span className={styles.passHole} aria-hidden="true" />
                    <span>DESK 02 · 2026</span>
                  </div>

                  <div className={styles.passHead}>
                    <div className={styles.monogram} aria-hidden="true">{monogram}</div>
                    <div className={styles.role}>
                      <span>{copy.roleEn}</span>
                      <b>{copy.roleCn}</b>
                    </div>
                  </div>

                  <div className={styles.nameBlock}>
                    <span className={styles.label}>
                      DISPLAY NAME / 登记名 <i className={styles.liveDot} aria-hidden="true" />
                    </span>
                    <strong
                      className={`${styles.passName} ${hasName ? '' : styles.passNameEmpty}`}
                      title={hasName ? name : '登记名会随输入更新'}
                    >
                      {displayedName}
                    </strong>
                  </div>

                  <div className={styles.facts}>
                    <div><span>SCOPE / 范围</span><b>个人空间 · 题目实验室</b></div>
                    <div><span>ENTRY / 入口</span><b>{copy.entry}</b></div>
                    <div><span>STATUS / 状态</span><b>{copy.status}</b></div>
                    <div><span>ISSUED / 签发</span><b>2026.11</b></div>
                  </div>

                  <div className={styles.perf} aria-hidden="true" />
                  <div className={styles.code}>
                    <div className={styles.barcode} aria-hidden="true">
                      {bars.map((bar, index) => (
                        <i
                          key={index}
                          style={{ width: `${bar.width}px`, height: `${bar.height}%` }}
                        />
                      ))}
                    </div>
                    <span className={styles.serial}>{serial}</span>
                  </div>

                  <div className={styles.stamp}>{copy.stamp}</div>
                  <p className={styles.fine}>仅限万象实验台 / NON-TRANSFERABLE</p>
                </div>

                <div className={`${styles.passFace} ${styles.passBack}`} aria-hidden={!flipped}>
                  <div className={styles.passTop}>
                    <span>WANXIANG / ACCESS NOTES</span>
                    <span className={styles.passHole} aria-hidden="true" />
                    <span>BACK · 02</span>
                  </div>

                  <div className={styles.backHead}>
                    <span className={styles.label}>READ BEFORE ENTRY</span>
                    <h3>这张证，<br />现在能做什么。</h3>
                  </div>

                  <ol className={styles.notes}>
                    <li>
                      <span>01</span>
                      <div><b>能进入</b><p>个人空间与题目实验室；保存显示名、默认入口与账号资料。</p></div>
                    </li>
                    <li>
                      <span>02</span>
                      <div><b>还不能带走</b><p>材料、实验与分享记录仍随当前浏览器会话保存；跨设备同步与永久保存尚未开放。</p></div>
                    </li>
                    <li>
                      <span>03</span>
                      <div><b>忘记密码</b><p>联系课程管理员重置；也可以建立一份新档案。</p></div>
                    </li>
                    <li>
                      <span>04</span>
                      <div><b>不想登记</b><p>以访客身份浏览交互示例；换设备或清理会话后不会保留。</p></div>
                    </li>
                  </ol>

                  <div className={styles.backFoot}>
                    <span>{serial}</span>
                  </div>
                  <div className={`${styles.stamp} ${styles.stampBack}`}>边界</div>
                  <p className={styles.fine}>仅限万象实验台 / NON-TRANSFERABLE</p>
                </div>
              </div>
            </div>
            <figcaption className="visually-hidden">
              一张会随表单输入更新登记名与编号的实验通行证，可翻面查看账号使用边界。
            </figcaption>
          </figure>

          <div className={styles.accessControls}>
            <button
              className={styles.flipBtn}
              type="button"
              aria-pressed={flipped}
              aria-controls="auth-pass"
              onClick={() => setFlipped((current) => !current)}
            >
              {flipped ? '翻回正面' : '翻到背面 · 使用边界'}
              <span aria-hidden="true">{flipped ? '↺' : '↻'}</span>
            </button>
            <span className={styles.accessHint}>名字与编号会跟着输入更新</span>
          </div>

          <p className={styles.quote}>登记不是门槛，<br />是给好奇心留一个座位。</p>

          <div className={styles.accessFoot}>
            <span><i aria-hidden="true" />材料与实验仍按浏览器会话保存</span>
            <span>跨设备同步尚未开放</span>
          </div>
        </aside>
      </main>
    </div>
  );
}

export default AuthShell;
