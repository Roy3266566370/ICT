import type {SceneDocument} from './types';
import {diffDocuments} from './model';
import {draftStorageKey,matchesFingerprint,type DraftFingerprint,type DraftScope} from '@/state/draftScope';

/**
 * 本地自由编辑草稿。
 *
 * 存储键由契约 `C-DRAFT-SCOPE@1` 生成：`xiangsheng.free-document.v1.<scope>.<id>.<writer>`。
 * 旧格式键（无 scope 段，如 `xiangsheng.free-document.v1.<id>.<writer>`）不再参与读取，
 * 因此任何账号都不会恢复历史遗留的跨账号草稿（R5-AC3 / D-03）。
 */
export interface DocumentDraft {base:SceneDocument;document:SceneDocument;time:number;
  /** 写入时的账号 scope；读取时与当前 scope 不符即丢弃。 */
  scope:DraftScope;
  /** 写入时的作品版本指纹；与当前 `source_key` + `revision` 不符即丢弃（R5-AC4）。 */
  fingerprint:DraftFingerprint;}

/** 读取中间形状：存储内容可能来自旧版本，`scope`/`fingerprint` 一律按 unknown 校验。 */
interface StoredDraft {base:SceneDocument;document:SceneDocument;time:number;scope:unknown;fingerprint:unknown;}

const queues=new Map<string,Promise<void>>();
const DATABASE_NAME='xiangsheng-edit-drafts';
const STORE_NAME='drafts';

const draftKey=(id:string,scope:DraftScope,writer='')=>draftStorageKey('free-document',scope,[id,writer]);
// "本标签页上次写入者"标记同样带 scope：账号切换后互不覆盖，也能被 clearDraftsForScope 一并清理。
const writerKey=(id:string,scope:DraftScope)=>draftStorageKey('free-document',scope,['writer',id]);

function database():Promise<IDBDatabase|null>{
  if(typeof indexedDB==='undefined')return Promise.resolve(null);
  return new Promise((resolve,reject)=>{const request=indexedDB.open(DATABASE_NAME,1);
    request.onupgradeneeded=()=>request.result.createObjectStore(STORE_NAME);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
}

function isFingerprint(value:unknown):value is DraftFingerprint{
  if(value===null||typeof value!=='object')return false;
  const record=value as Record<string,unknown>;
  return typeof record.sourceKey==='string'&&typeof record.revision==='number'&&Number.isInteger(record.revision);
}

function parseStored(value:unknown):StoredDraft|null{
  if(value===null||typeof value!=='object')return null;
  const record=value as Record<string,unknown>;
  const {base,document,time}=record;
  if(base===null||typeof base!=='object')return null;
  if(document===null||typeof document!=='object')return null;
  if(typeof time!=='number')return null;
  return {base:base as SceneDocument,document:document as SceneDocument,time,scope:record.scope,fingerprint:record.fingerprint};
}

/** scope 与指纹同时匹配才可恢复；任一不符返回 null，且不回写旧草稿（R5-AC3 / R5-AC4）。 */
function recoverable(stored:StoredDraft|null,scope:DraftScope,expected:DraftFingerprint):DocumentDraft|null{
  if(stored===null||stored.scope!==scope)return null;
  if(!isFingerprint(stored.fingerprint)||!matchesFingerprint(stored.fingerprint,expected))return null;
  return {base:stored.base,document:stored.document,time:stored.time,scope,fingerprint:stored.fingerprint};
}

function newest(first:DocumentDraft|null,second:DocumentDraft|null):DocumentDraft|null{
  if(!first)return second;
  if(!second)return first;
  return second.time>first.time?second:first;
}

export async function readDraft(id:string,scope:DraftScope,expected:DraftFingerprint,writer=''):Promise<DocumentDraft|null>{
  const key=draftKey(id,scope,writer);await queues.get(key)?.catch(()=>{});
  let local:DocumentDraft|null=null;
  try{local=recoverable(parseStored(JSON.parse(localStorage.getItem(key)??'null') as unknown),scope,expected);}catch{ /* unavailable storage */ }
  let remote:DocumentDraft|null=null;
  try{
    const db=await database();if(!db)return local;
    const record=await new Promise<unknown>((resolve,reject)=>{const request=db.transaction(STORE_NAME).objectStore(STORE_NAME).get(key);
      request.onsuccess=()=>resolve((request.result as unknown)??null);request.onerror=()=>reject(request.error);});db.close();
    remote=recoverable(parseStored(record),scope,expected);
  }catch{ /* IndexedDB 不可用：只保留 localStorage 副本 */ }
  return newest(local,remote);
}

export function writeDraft(id:string,scope:DraftScope,fingerprint:DraftFingerprint,base:SceneDocument,document:SceneDocument,writer=''):Promise<void>{
  const key=draftKey(id,scope,writer);const dirty=diffDocuments(base,document).length>0;
  const draft:DocumentDraft={base,document,time:Date.now(),scope,fingerprint};let localSaved=false;
  try{
    if(!dirty){localStorage.removeItem(key);localSaved=true;}
    else{const serialized=JSON.stringify(draft);if(serialized.length<2_500_000){localStorage.setItem(key,serialized);localSaved=true;}
      else localStorage.removeItem(key);}
  }catch{ /* larger drafts use IndexedDB */ }
  // Serialize transactions so a late write cannot resurrect an older draft.
  const task=(queues.get(key)??Promise.resolve()).catch(()=>{}).then(async()=>{
    try{
      const db=await database();if(!db){if(!localSaved)throw new Error('草稿存储不可用');return;}
      await new Promise<void>((resolve,reject)=>{const tx=db.transaction(STORE_NAME,'readwrite');
        if(dirty)tx.objectStore(STORE_NAME).put(draft,key);else tx.objectStore(STORE_NAME).delete(key);
        tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});db.close();
    }catch(error){if(!localSaved)throw error;}
  });
  queues.set(key,task);void task.finally(()=>{if(queues.get(key)===task)queues.delete(key);}).catch(()=>{});return task;
}

/** 版本指纹由文档自身派生：`source_key` 缺省时退化为空串（契约约定）。 */
function fingerprintOf(document:SceneDocument):DraftFingerprint{
  return {sourceKey:document.source_key??'',revision:document.revision};
}

export function createDraftSession(id:string,scope:DraftScope){
  // Each editor owns a record; a reload reads this tab's previous writer.
  // A clean save cannot delete another editor's outstanding draft.
  const writer=`${Date.now()}_${Math.random().toString(36).slice(2)}`;let previous='';
  try{previous=sessionStorage.getItem(writerKey(id,scope))??'';}catch{ /* unavailable storage */ }
  return {read:(expected:DraftFingerprint)=>readDraft(id,scope,expected,previous),
    write:(base:SceneDocument,document:SceneDocument)=>{
      try{sessionStorage.setItem(writerKey(id,scope),writer);}catch{ /* unavailable storage */ }
      return writeDraft(id,scope,fingerprintOf(document),base,document,writer);
    }};
}