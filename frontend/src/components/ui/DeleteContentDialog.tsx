import { useEffect, useId, useRef, useState } from 'react';
import { errorMessage } from '@/api/client';
import styles from './DeleteContentDialog.module.css';

export function DeleteContentDialog({ label, title, onDismiss, onDelete }: {
  label: string;
  title: string;
  onDismiss: (deleted: boolean) => void;
  onDelete: () => Promise<void>;
}): JSX.Element {
  const headingId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); }, []);

  const dismiss = (deleted: boolean): void => {
    dialog.current?.close();
    onDismiss(deleted);
  };

  const confirm = async (): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      await onDelete();
      dismiss(true);
    } catch (cause) {
      setError(errorMessage(cause));
      setBusy(false);
      inFlight.current = false;
    }
  };

  return <dialog className={styles.dialog} ref={dialog} aria-labelledby={headingId}
    onCancel={event => { event.preventDefault(); if (!inFlight.current) dismiss(false); }}>
    <h2 id={headingId}>删除{label}？</h2>
    <p>将删除「{title}」。删除后无法恢复。</p>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <div>
      <button autoFocus type="button" disabled={busy} onClick={() => { if (!inFlight.current) dismiss(false); }}>取消</button>
      <button type="button" className={styles.danger} disabled={busy} onClick={() => void confirm()}>
        {busy ? '删除中…' : '确认删除'}
      </button>
    </div>
  </dialog>;
}
