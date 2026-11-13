import {useEffect,useState} from 'react';
import {useParams,Link} from 'react-router-dom';
import {api,errorMessage} from '@/api/client';
import type {MaterialDetail} from '@/api/types';
import {getDocument,getDocumentCapabilities,patchDocument} from '@/api/documents';
import {DocumentController} from '@/document/controller';
import {createDraftSession} from '@/document/drafts';

import {useAccountScope} from '@/state/accountSession';
import {FreeDeckEditor} from '@/components/editor/FreeDeckEditor';

export default function FreeEditPage(){
  const {materialId=''}=useParams();
  // 账号 scope 的唯一来源（C-SESSION@1）：草稿键按它隔离，切换账号后旧草稿不会被恢复。
  const scope=useAccountScope();
  const [loaded,setLoaded]=useState<{controller:DocumentController;material:MaterialDetail}|null>(null);
  const [error,setError]=useState('');
  const [unavailable,setUnavailable]=useState('');
  useEffect(()=>{
    let alive=true;let controller:DocumentController|undefined;
    const drafts=createDraftSession(materialId,scope);
    void Promise.all([getDocumentCapabilities(materialId),getDocument(materialId),api.getMaterial(materialId)]).then(async([capability,document,material])=>{
      if(!alive)return;
      if(!capability.free_editing){setUnavailable(capability.reason??'当前部署环境没有可用的对象分离引擎');return;}
      // 恢复前核对作品版本：source_key + revision 任一不符，readDraft 返回 null 并回落服务端文档（R5-AC4）。
      const draft=await drafts.read({sourceKey:document.source_key??'',revision:document.revision});
      if(!alive)return;
      controller=new DocumentController(document,{save:(revision,operation,changes)=>patchDocument(materialId,revision,operation,changes),
        persist:(base,current)=>drafts.write(base,current)});
      if(draft)controller.recoverDraft(draft.base,draft.document);
      setLoaded({controller,material});
    }).catch(reason=>{if(alive)setError(errorMessage(reason));});
    return()=>{alive=false;controller?.dispose();};
  },[materialId,scope]);
  if(unavailable)return <div className="page-container" role="alert"><h1>当前环境暂不支持自由编辑</h1><p>{unavailable}</p>
    <p>演示、调参和导出不受影响；请在这台服务器安装 PowerPoint，或为后端配置 Windows 转换服务（LAYER_EXPORT_SERVICE_URL）。</p>
    <Link to={`/materials/${materialId}/work`}>返回演示文稿</Link></div>;
  if(error)return <div className="page-container" role="alert"><h1>自由编辑暂时无法打开</h1><p>{error}</p><Link to={`/materials/${materialId}/work`}>返回演示文稿</Link></div>;
  if(!loaded)return <div className="page-container" role="status">正在载入可编辑文档…</div>;
  return <FreeDeckEditor materialId={materialId} controller={loaded.controller} material={loaded.material}/>;
}