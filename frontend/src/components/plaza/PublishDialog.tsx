import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { errorMessage } from '@/api/client';
import { SUBJECTS, type ListingOptions } from '@/api/plazaTypes';
import { useAccountUser } from '@/state/accountSession';
import styles from './Plaza.module.css';

export function PublishDialog({ onClose, onPublish, children, listingOnly = false }: {
  onClose: () => void;
  onPublish: (options?: ListingOptions) => Promise<void>;
  children?: ReactNode;
  listingOnly?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const user = useAccountUser();
  const location = useLocation();
  const [listed, setListed] = useState(listingOnly);
  const [subject, setSubject] = useState<ListingOptions['subject'] | ''>('');
  const [summary, setSummary] = useState('');
  const [allowFork, setAllowFork] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { ref.current?.showModal(); }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || (listed && (!subject || !user))) return;
    setError('');
    setBusy(true);
    try {
      await onPublish(listed && subject ? { subject, summary, allow_fork: allowFork } : undefined);
      onClose();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return <dialog ref={ref} className={styles.dialog} aria-label={listingOnly ? '发布我的作品' : '发布与分享'}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={submit}>
      <h2>{listingOnly ? '发布我的作品' : '发布与分享'}</h2>
      <fieldset disabled={busy}>
        {children}
        {!listingOnly && <label className={styles.check}>
          <input type="checkbox" checked={listed} onChange={event => setListed(event.target.checked)} />
          同时公开到广场，允许他人在线试用
        </label>}
        {!listed && <p>任何持有分享链接的人都可以打开作品。</p>}
        {listed && <>
          {!user && <p><Link to={'/login?returnTo=' + encodeURIComponent(location.pathname + location.search)}>登录后上架广场</Link></p>}
          <label>学科分类
            <select required value={subject} onChange={event => setSubject(event.target.value as typeof subject)}>
              <option value="">选择学科</option>
              {Object.entries(SUBJECTS).map(([id, name]) => <option value={id} key={id}>{name}</option>)}
            </select>
          </label>
          <label>一句话简介（选填）
            <textarea rows={2} maxLength={120} value={summary} onChange={event => setSummary(event.target.value)} />
          </label>
          <label className={styles.check}>
            <input type="checkbox" checked={allowFork} onChange={event => setAllowFork(event.target.checked)} /> 允许他人复刻
          </label>
        </>}
      </fieldset>
      {error && <p role="alert">{error}</p>}
      <div className={styles.actions}>
        <button type="button" onClick={onClose} disabled={busy}>取消</button>
        <button type="submit" className={styles.primary} disabled={busy || (listed && !user)}>
          {busy ? '发布中…' : listed ? '发布到广场' : '生成分享链接'}
        </button>
      </div>
    </form>
  </dialog>;
}
