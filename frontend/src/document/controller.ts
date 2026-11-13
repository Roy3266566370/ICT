import type {SceneDocument,SceneNode,NodePatch,NodeChange} from './types';
import {diffDocuments,patchNodes,rebaseDocument,same} from './model';
export {diffDocuments,rebaseDocument} from './model';
interface Options {
  save:(revision:number,operationId:string,changes:NodeChange[])=>Promise<{revision:number}>;
  persist?:(base:SceneDocument,document:SceneDocument)=>void|Promise<void>;
  autosaveDelay?:number;
}
interface Snapshot {document:SceneDocument;dirty:boolean;saving:boolean;canUndo:boolean;canRedo:boolean;error:string;conflict:boolean;}
export class DocumentController {
  private base:SceneDocument;private current:SceneDocument;private past:SceneDocument[]=[];private future:SceneDocument[]=[];
  private key='';private lastAt=0;private timer:ReturnType<typeof setTimeout>|undefined;private maxTimer:ReturnType<typeof setTimeout>|undefined;
  private persistTimer:ReturnType<typeof setTimeout>|undefined;private persistPending=false;
  private listeners=new Set<()=>void>();private flight:Promise<boolean>|null=null;private error='';private conflict=false;private disposed=false;
  private state:Snapshot;private operation=0;private paused=false;
  constructor(document:SceneDocument,private options:Options) {
    this.base=document;this.current=document;this.state={document,dirty:false,saving:false,canUndo:false,canRedo:false,error:'',conflict:false};
  }
  getSnapshot=()=>this.state;
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>this.listeners.delete(listener);};
  private emit(saving=this.state.saving) {
    this.state={document:this.current,dirty:!!diffDocuments(this.base,this.current).length,saving,canUndo:!!this.past.length,canRedo:!!this.future.length,error:this.error,conflict:this.conflict};
    if(!this.disposed)this.listeners.forEach(listener=>listener());
  }
  /** Local drafts are merged: rapid typing/dragging writes only the latest state. */
  private persist() {if(this.disposed)return;this.persistPending=true;clearTimeout(this.persistTimer);
    this.persistTimer=setTimeout(()=>this.flushPersist(),220);}
  private flushPersist() {
    clearTimeout(this.persistTimer);this.persistTimer=undefined;
    if(!this.persistPending||this.disposed)return;this.persistPending=false;
    try{void Promise.resolve(this.options.persist?.(this.base,this.current)).catch(()=>{this.error='本机草稿保存失败，请尽快同步到服务端';this.emit();});}
    catch{this.error='本机草稿保存失败，请尽快同步到服务端';this.emit();}
  }
  private schedule() {
    clearTimeout(this.timer);
    if(this.paused||this.conflict||this.disposed)return;
    this.timer=setTimeout(()=>void this.save(),this.options.autosaveDelay??700);
    if(!this.maxTimer)this.maxTimer=setTimeout(()=>{this.maxTimer=undefined;void this.save();},Math.max(2000,this.options.autosaveDelay??700));
  }
  setComposing(paused:boolean){this.paused=paused;if(paused){clearTimeout(this.timer);clearTimeout(this.maxTimer);this.maxTimer=undefined;}else this.schedule();}
  replace(next:SceneDocument,key='') {
    if(!diffDocuments(this.current,next).length&&!diffDocuments(next,this.current).length)return;
    const now=Date.now();
    if(!key||key!==this.key||now-this.lastAt>800||this.future.length)this.past=[...this.past,this.current].slice(-60);
    this.future=[];this.current={...next,revision:this.base.revision};this.key=key;this.lastAt=now;
    this.emit();this.persist();this.schedule();
  }
  patch(pageNo:number,ids:string[],patch:NodePatch,key=''){this.replace(patchNodes(this.current,pageNo,ids,patch),key);}
  add(pageNo:number,node:SceneNode){this.replace({...this.current,pages:this.current.pages.map(p=>p.page_no===pageNo?{...p,modified:true,nodes:[...p.nodes,node]}:p)});}
  undo(){const previous=this.past.at(-1);if(!previous)return;this.past=this.past.slice(0,-1);this.future=[this.current,...this.future];this.current={...previous,revision:this.base.revision};this.key='';this.emit();this.persist();this.schedule();}
  redo(){const next=this.future[0];if(!next)return;this.future=this.future.slice(1);this.past=[...this.past,this.current];this.current={...next,revision:this.base.revision};this.key='';this.emit();this.persist();this.schedule();}
  save=async():Promise<boolean>=>{
    if(this.flight){await this.flight;return this.conflict||this.error?false:this.save();}
    clearTimeout(this.timer);clearTimeout(this.maxTimer);this.maxTimer=undefined;
    if(this.conflict)return false;
    this.flushPersist();
    const run=async()=>{
      this.error='';this.emit(true);
      try {
        while(true) {
          const captured=this.current;const changes=diffDocuments(this.base,captured);
          if(!changes.length)break;
          const id=`op_${Date.now()}_${++this.operation}_${Math.random().toString(36).slice(2,9)}`;
          const result=await this.options.save(this.base.revision,id,changes);
          this.base={...captured,revision:result.revision};this.current={...this.current,revision:result.revision};this.persist();this.emit(true);
        }
        return true;
      }catch(error){
        this.conflict=!!error&&typeof error==='object'&&'code' in error&&error.code==='VERSION_CONFLICT';
        this.error=error instanceof Error?error.message:'同步失败，本机修改已保留';this.persist();return false;
      }finally{this.emit(false);}
    };
    this.flight=run();const result=await this.flight;this.flight=null;return result;
  };
  recoverDraft(base:SceneDocument,draft:SceneDocument){
    const merged=rebaseDocument(base,draft,this.base);
    this.current=merged.document;this.conflict=merged.conflicts.length>0;
    this.error=this.conflict?'本机草稿与服务端修改了同一字段，请选择恢复方式':'';
    this.emit();this.persist();if(!this.conflict)this.schedule();
  }
  mergeServer(server:SceneDocument,overwrite=false){
    const merged=rebaseDocument(this.base,this.current,server);
    if(merged.conflicts.length&&!overwrite){this.conflict=true;this.error='检测到其他窗口的修改。本机草稿已保留';this.emit();return false;}
    // Old full-document history cannot be replayed across another editor's changes.
    this.past=[];this.future=[];this.key='';
    this.base=server;this.current={...merged.document,revision:server.revision};this.conflict=false;this.error='';this.emit();this.persist();this.schedule();return true;
  }
  loadServer(server:SceneDocument){this.base=server;this.current=server;this.past=[];this.future=[];this.error='';this.conflict=false;this.emit();this.persist();}
  updateAssets(document:SceneDocument){
    const merge=(doc:SceneDocument):SceneDocument=>({...doc,pages:doc.pages.map(page=>{
      const remote=document.pages.find(p=>p.page_no===page.page_no);if(!remote)return page;
      return {...page,preparation:remote.preparation,background_url:remote.background_url,nodes:page.nodes.map(node=>{
        const original=remote.nodes.find(n=>n.id===node.id);if(!original)return node;
        const before=this.base.pages.find(p=>p.page_no===page.page_no)?.nodes.find(n=>n.id===node.id);
        const style={...node.style};
        for(const key of Object.keys(original.style) as Array<keyof SceneNode['style']>)if(same(node.style[key],before?.style[key]))Object.assign(style,{[key]:original.style[key]});
        return {...node,image_url:original.image_url,background_url:original.background_url,base_style:original.base_style,style};
      })};
    })});
    const current=merge(this.current);this.past=this.past.map(merge);this.future=this.future.map(merge);this.base=merge(this.base);this.current=current;this.emit();
  }
  dispose(){this.flushPersist();this.disposed=true;clearTimeout(this.timer);clearTimeout(this.maxTimer);this.listeners.clear();}
}
