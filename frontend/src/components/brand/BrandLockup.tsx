import { Link } from 'react-router-dom';

import markUrl from '../../assets/brand/wanxiang-mark.png';
import styles from './BrandLockup.module.css';

/** 拼接局部类名：过滤掉 `undefined`，避免把字符串 "undefined" 写进 class 属性。 */
function joinClassNames(...names: ReadonlyArray<string | undefined>): string {
  return names.filter((name): name is string => Boolean(name)).join(' ');
}

export interface BrandLockupProps {
  /** nav：30px 标志 + 小字；hero：36px 标志 + 更大字重。默认 'nav' */
  size?: 'nav' | 'hero';
  /** 是否显示 WANXIANG 拉丁名（默认 true） */
  showLatin?: boolean;
  /** 是否为链接（默认 true，指向 "/"） */
  asLink?: boolean;
  /** 深色底上使用浅色文字（默认 'dark' 文字，'light' 用于深色品牌区） */
  tone?: 'dark' | 'light';
}

/** 两档标志边长（px），与 `C-LOGINUI@1` 逐值一致。 */
const MARK_SIZE: Readonly<Record<'nav' | 'hero', number>> = {
  nav: 30,
  hero: 36,
};

/**
 * 万象品牌组合：紫色「万」形标志 + 珊瑚圆点，搭配「万象 / WANXIANG」文字。
 */
export function BrandLockup({
  size = 'nav',
  showLatin = true,
  asLink = true,
  tone = 'dark',
}: BrandLockupProps): JSX.Element {
  const markSize = MARK_SIZE[size];
  const lockupClassName = joinClassNames(
    styles.lockup,
    size === 'hero' ? styles.hero : styles.nav,
    tone === 'light' ? styles.light : undefined,
  );

  const content = (
    <>
      <span className={styles.mark} aria-hidden="true">
        <img src={markUrl} width={markSize} height={markSize} alt="" />
      </span>
      <span className={styles.text}>
        <span className={styles.name}>万象</span>
        {showLatin ? <span className={styles.latin}>WANXIANG</span> : null}
      </span>
    </>
  );

  if (!asLink) {
    return (
      <span className={lockupClassName} role="img" aria-label="万象">
        {content}
      </span>
    );
  }

  return (
    <Link className={lockupClassName} to="/" aria-label="万象 WANXIANG 首页">
      {content}
    </Link>
  );
}

export default BrandLockup;