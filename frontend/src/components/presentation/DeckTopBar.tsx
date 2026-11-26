import { useEffect, useRef, type ReactNode, type Ref } from 'react';
import styles from './DeckPlayer.module.css';

export function DeckTopBar({ title, home, status, modes, children }: {
  title: string; home?: ReactNode; status?: { text: string; tone: 'saved' | 'pending' | 'error' };
  modes?: ReactNode; children?: ReactNode;
}) {
  return <header className={styles.stageTopbar} data-deck-topbar>
    <div className={styles.stageIdentity}>
      <span className={styles.stageBrand}>{home ?? '万象'}</span>
      <h1 title={title}>{title}</h1>
      {status && <span className={styles.saveDot} data-tone={status.tone} title={status.text}
        role="status" aria-label={status.text} />}
    </div>
    {modes}
    <div className={styles.stageActions}>{children}</div>
  </header>;
}

export function DeckPopover({ label, children, ariaLabel, triggerRef, above = false }: {
  label: ReactNode; children: ReactNode; ariaLabel?: string; triggerRef?: Ref<HTMLElement>; above?: boolean;
}) {
  const disclosure = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      const element = disclosure.current;
      if (element?.open && !element.contains(event.target as Node)) element.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      const element = disclosure.current;
      if (!element?.open || event.key !== 'Escape' || event.isComposing) return;
      element.open = false;
      element.querySelector('summary')?.focus();
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', escape, true);
    };
  }, []);

  return <details className={styles.deckPopover} ref={disclosure} data-above={above || undefined}>
    <summary ref={triggerRef} aria-label={ariaLabel}>{label}</summary>
    <div className={styles.deckPopoverContent} onClick={(event) => {
      if ((event.target as Element).closest('button, a') && disclosure.current) disclosure.current.open = false;
    }}>{children}</div>
  </details>;
}
