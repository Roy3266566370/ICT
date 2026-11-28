import {requestJson} from './client';
import type {NodeChange,SceneDocument} from '@/document/types';
export const createBlankMaterial=(body:{title:string;aspect_ratio:'16:9'|'4:3';template_id:string;theme_id?:string;outline?:string})=>
  requestJson<{material_id:string;title:string;page_count:number}>('/api/v1/materials/blank',{method:'POST',body:JSON.stringify(body)});
export const renameMaterial=(id:string,title:string)=>requestJson<{title:string}>(`/api/v1/materials/${encodeURIComponent(id)}`,{
  method:'PATCH',body:JSON.stringify({title}),
});
export const getDocument=(id:string)=>requestJson<SceneDocument>(`/api/v1/materials/${encodeURIComponent(id)}/document`);
export const createSceneDiagram=(id:string,page:number,text:string,ai=false)=>requestJson<{diagram:import('@/living/diagram').DiagramDoc}>(
  `/api/v1/materials/${encodeURIComponent(id)}/document/pages/${page}/diagram`,{method:'POST',body:JSON.stringify({text,ai})});
export const getDocumentCapabilities=(id:string)=>requestJson<{free_editing:boolean;engine:string;reason:string|null}>(
  `/api/v1/materials/${encodeURIComponent(id)}/document/capabilities`);
export const patchDocument=(id:string,revision:number,operation:string,changes:NodeChange[])=>
  requestJson<{revision:number}>(`/api/v1/materials/${encodeURIComponent(id)}/document`,{method:'PATCH',body:JSON.stringify({expected_revision:revision,operation_id:operation,changes})});
export const prepareDocumentPage=(id:string,page:number)=>requestJson<{status:string}>(`/api/v1/materials/${encodeURIComponent(id)}/document/pages/${page}/prepare`,{method:'POST'});
export const reinteractDocumentPage=(id:string,page:number,revision:number)=>requestJson<{revision:number;page_no:number;refreshed_user_interactions:number;reinteraction_revision:number}>(
  `/api/v1/materials/${encodeURIComponent(id)}/document/pages/${page}/reinteract`,
  {method:'POST',body:JSON.stringify({expected_revision:revision})});
