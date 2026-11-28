import { useEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { errorMessage } from '@/api/client';
import styles from './DeckPlayer.module.css';

export function DeckTopBar({ title, onRename, home, status, modes, children }: {
  title: string; home?: ReactNode; status?: { text: string; tone: 'saved' | 'pending' | 'error' };
  onRename?: (title: string) => Promise<void>;
  modes?: ReactNode; children?: ReactNode;
}) {
  const [draft,setDraft]=useState<string|null>(null);
  const [renaming,setRenaming]=useState(false);
  const [error,setError]=useState('');
  const rename=async()=>{
    if(draft===null||renaming||!onRename)return;
    const name=draft.trim();
    if(!name){setError('请输入课件标题');return;}
    if(name===title){setDraft(null);return;}
    setRenaming(true);setError('');
    try{await onRename(name);setDraft(null);}
    catch(error){setError(errorMessage(error));}
    finally{setRenaming(false);}
  };
  return <header className={styles.stageTopbar} data-deck-topbar>
    <div className={styles.stageIdentity}>
      <span className={styles.stageBrand}>{home ?? '万象'}</span>
      {draft===null?<h1 title={title}>{onRename?<button className={styles.deckTitleButton} type="button"
        aria-label={`重命名课件：${title}`} onClick={()=>{setDraft(title);setError('');}}>{title}</button>:title}</h1>:
        <form className={styles.deckTitleForm} onSubmit={event=>{event.preventDefault();void rename();}}>
          <input aria-label="课件标题" autoFocus onFocus={event=>event.currentTarget.select()} value={draft}
            disabled={renaming} maxLength={255} onChange={event=>{setDraft(event.target.value);setError('');}}
            onKeyDown={event=>{if(event.key==='Escape'&&!renaming){event.stopPropagation();setDraft(null);setError('');}}}/>
          <button type="submit" disabled={renaming} aria-label="保存课件标题">✓</button>
          {error&&<span role="alert">{error}</span>}
        </form>}
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
