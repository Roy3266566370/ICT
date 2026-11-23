import {requestJson} from './client';
import type {FigureVectorization,NodeChange,SceneDocument} from '@/document/types';
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

export const vectorizeFigure=(id:string,page:number,nodeId:string,revision:number,stage:'pixel'|'vision',signal:AbortSignal,previewId?:string)=>
  requestJson<FigureVectorization>(`/api/v1/materials/${encodeURIComponent(id)}/pages/${page}/figures/${encodeURIComponent(nodeId)}/vectorize`,
    {method:'POST',signal,body:JSON.stringify({stage,expected_revision:revision,preview_id:previewId})});
