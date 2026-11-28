import {useEffect,useRef,useState} from 'react';
import {createBlankMaterial} from '@/api/documents';
import {fetchSession} from '@/api/hooks';
import {errorMessage} from '@/api/client';
import {THEMES} from '@/document/themes';
import {useAccountScope} from '@/state/accountSession';
import {readSpacePreferences} from '@/state/spacePreferences';
import styles from './NewDeckModal.module.css';

const templates = [
  ['blank','空白画布','#faf7ee','#233a63'],
  ['lecture','高校数理讲义','#faf7ee','#a44929'],
  ['business','商务汇报蓝图','#edf2f6','#087d72'],
  ['technology','科技深色演讲','#151b36','#83e8ea'],
  ['defense','论文答辩框架','#ffffff','#345add'],
  ['lab','实验课交互沙盘册','#193831','#f2c96f'],
] as const;
export function NewDeckModal({onClose,onCreated}:{onClose:()=>void;onCreated:(id:string)=>void}) {
  const scope=useAccountScope();
  const initialPrefs=readSpacePreferences(scope);
  const dialog=useRef<HTMLDialogElement>(null);
  const pending=useRef(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [title,setTitle]=useState('');
  const [ratio,setRatio]=useState<'16:9'|'4:3'>(initialPrefs.defaultRatio);
  const [template,setTemplate]=useState<string>('blank');
  const [theme,setTheme]=useState(initialPrefs.defaultPptTheme);
  const [outlineMode,setOutlineMode]=useState(false);
  const [outline,setOutline]=useState('');
  useEffect(()=>{dialog.current?.showModal();},[]);

  async function create() {
    if(pending.current||outlineMode&&!outline.trim())return;
    pending.current=true;
    setBusy(true);setError('');
    try {
      await fetchSession();
      const deck=await createBlankMaterial({title:title.trim()||'未命名课件',aspect_ratio:ratio,
        template_id:outlineMode?'blank':template,theme_id:theme||undefined,outline:outlineMode?outline.trim():undefined});
      onCreated(deck.material_id);
    } catch(error) {
      setError(errorMessage(error));
    } finally {
      pending.current=false;setBusy(false);
    }
  }

  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="new-deck-title"
    onCancel={event=>{event.preventDefault();if(!pending.current)onClose();}}>
    <form onSubmit={event=>{event.preventDefault();void create();}}>
      <header><h2 id="new-deck-title">新建课件</h2>
        <button type="button" disabled={busy} aria-label="关闭" onClick={onClose}>×</button></header>
      <div className={styles.modes} role="group" aria-label="创建方式">
        <button type="button" disabled={busy} aria-pressed={!outlineMode} onClick={()=>{setOutlineMode(false);setError('');}}>从模板创建</button>
        <button type="button" disabled={busy} aria-pressed={outlineMode} onClick={()=>{setOutlineMode(true);setError('');}}>AI 大纲生成</button>
      </div>
      <fieldset disabled={busy}>
        <legend>{outlineMode?'整理讲义大纲':'选择起点'}</legend>
        {outlineMode?<label>课程主题或讲义大纲
          <textarea rows={7} maxLength={10000} value={outline} onChange={event=>setOutline(event.target.value)}
            placeholder="例如：线性代数第一讲，包含矩阵变换、基向量与课堂练习。"/>
        </label>:<div className={styles.templates}>
          {templates.map(([id,name,paper,ink])=><label key={id}>
            <input type="radio" name="deck-template" checked={template===id} onChange={()=>setTemplate(id)}/>
            <span aria-hidden="true" className={styles.thumbnail} style={{background:paper,color:ink}}
              data-blank={id==='blank'}/>
            {name}
          </label>)}
        </div>}
        <label>课件标题<input type="text" value={title} maxLength={255} placeholder="未命名课件"
          onChange={event=>setTitle(event.target.value)}/></label>
        <div className={styles.options}>
          <label>画布比例<select value={ratio} onChange={event=>setRatio(event.target.value==='4:3'?'4:3':'16:9')}>
            <option>16:9</option><option>4:3</option>
          </select></label>
          <label>主题<select value={theme} onChange={event=>setTheme(event.target.value)}>
            <option value="">模板默认</option>
            {THEMES.map(([id,name])=><option key={id} value={id}>{name}</option>)}
          </select></label>
        </div>
      </fieldset>
      {error&&<p role="alert">{error}</p>}
      <footer><button type="button" onClick={onClose} disabled={busy}>取消</button>
        <button type="submit" disabled={busy||(outlineMode&&!outline.trim())}>
          {busy?(outlineMode?'正在生成大纲…':'正在创建…'):(outlineMode?'生成并编辑':'创建并编辑')}
        </button></footer>
    </form>
  </dialog>;
}
