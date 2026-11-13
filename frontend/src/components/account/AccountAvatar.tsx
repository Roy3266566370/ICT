/**
 * 账号头像：优先显示服务端头像，加载失败或未上传时回退昵称首字。
 *
 * `avatarUrl` 变化后重新尝试加载（失败记录的是具体的 URL，而不是一个布尔值）。
 */
import { useState } from 'react';

import { resolveApiAssetUrl } from '@/api/client';
import styles from './AccountAvatar.module.css';

export type AccountAvatarSize = 'sm' | 'md' | 'lg' | 'xl';

export interface AccountAvatarProps {
  /** 用于回退首字的展示名 */
  label: string;
  /** 后端相对路径（或 mock 的 blob URL）；null 表示未上传 */
  avatarUrl: string | null;
  size?: AccountAvatarSize;
  className?: string;
}

function initialOf(label: string): string {
  const first = Array.from(label.trim())[0];
  return first === undefined ? '?' : first.toUpperCase();
}

export function AccountAvatar({
  label,
  avatarUrl,
  size = 'md',
  className,
}: AccountAvatarProps): JSX.Element {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const src = avatarUrl !== null && failedUrl !== avatarUrl ? resolveApiAssetUrl(avatarUrl) : null;

  const classes = [styles.avatar, styles[size], className].filter(Boolean).join(' ');

  return (
    <span className={classes} aria-hidden="true">
      {src === null ? (
        <span className={styles.initial}>{initialOf(label)}</span>
      ) : (
        <img
          className={styles.image}
          src={src}
          alt=""
          decoding="async"
          onError={() => setFailedUrl(avatarUrl)}
        />
      )}
    </span>
  );
}

export default AccountAvatar;
