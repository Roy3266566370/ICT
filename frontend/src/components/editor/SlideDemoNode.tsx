import {useEffect,useRef,useState} from 'react';
import type {PageLab} from '@/api/pptAI';
import {PageLabPlayer,labDefaults} from '@/components/ppt-ai/PageLabPlayer';
import {richNodeStyle,type SlideRichNodeProps} from './SlideDiagramNode';
import './slideRichNodes.css';

export function StandaloneDemoDialog({nodes, initialId, editing=false, onPatch, onClose}: {
  nodes: SlideRichNodeProps['node'][];
  initialId?: string;
  editing?: boolean;
  onPatch?: (id: string, ...args: Parameters<SlideRichNodeProps['onPatch']>) => void;
  onClose: () => void;
}) {
 const dialog=useRef<HTMLDialogElement>(null);
 const [selected,setSelected]=useState(initialId);
 const node=nodes.find(item=>item.id===selected)??nodes[0];
 const lab=node?.demo;
 useEffect(()=>{
   const element=dialog.current;
   if (element && !element.open) element.showModal();
   return ()=>{if(element?.open)element.close();};
 },[]);
 if(!node||!lab)return null;
 return <dialog ref={dialog} className="standaloneSlideDemo" aria-label="独立演示" data-standalone-demo data-no-pan
   onClick={event=>event.stopPropagation()}
   onCancel={event=>{event.preventDefault();onClose();}}>
   <header>
     <h2>{lab.title}</h2>
     {nodes.length>1&&<select aria-label="选择演示" value={node.id} onChange={event=>setSelected(event.currentTarget.value)}>
       {nodes.map(item=><option key={item.id} value={item.id}>{item.demo?.title||item.name}</option>)}
     </select>}
     <button type="button" onClick={onClose}>返回幻灯片</button>
   </header>
   <div className="standaloneSlideDemoBody">
     <DemoContent key={`${node.id}-${lab.content_hash}`} node={node} lab={lab} editing={editing} standalone
       onPatch={(patch,key)=>onPatch?.(node.id,patch,key)}/>
   </div>
 </dialog>;
}
function DemoContent({lab,node,editing,onPatch,standalone}:{lab:PageLab;standalone?:boolean}&Pick<SlideRichNodeProps,'node'|'editing'|'onPatch'>) {
 const [values,setValues]=useState(()=>labDefaults(lab));
 const defaultsKey=JSON.stringify(labDefaults(lab));
 useEffect(()=>{setValues(JSON.parse(defaultsKey) as Record<string,number>);},[defaultsKey]);
 return <PageLabPlayer lab={lab} identity={`slide-demo-${node.id}`} values={values} standalone={standalone} editable={!node.locked&&(editing||node.viewer_editable!==false)} onValues={next=>{setValues(next);if(editing&&!node.locked)onPatch({demo:{...lab,params:lab.params.map(p=>({...p,default:next[p.id]!==values[p.id]?next[p.id]??p.default:p.default}))}},'demo-params');}}/>;
}
export function SlideDemoNode({node,editing,interactive,onPatch,onGenerate,generating}:SlideRichNodeProps&{onGenerate?:()=>void;generating?:boolean}) {
 const lab=node.demo;
 return <div className="slideRichNode slideDemoNode" data-no-pan data-scene-demo={node.id} data-presentation-snapshot={node.id} style={richNodeStyle(node,interactive||editing)}>
 {editing&&interactive&&!node.locked&&<div className="slideRichGrip" title="拖动整个演示框">⠿ 演示</div>}
 <div className="slideRichContent" onPointerDown={e=>{if(interactive)e.stopPropagation();}} onKeyDown={e=>{if(interactive)e.stopPropagation();}}>
 {lab?interactive?<DemoContent key={`${node.id}-${lab.content_hash}`} lab={lab} node={node} editing={editing} onPatch={onPatch}/>:<div className="slideDemoPreview"><strong>{lab.title}</strong><p>{lab.summary}</p><span>▶ 交互演示</span></div>:<div className="slideDemoPreview"><strong>本页交互演示</strong><p>根据页面内容生成可播放、可调节的演示。</p></div>}
 {editing&&interactive&&!node.locked&&onGenerate&&<button className="slideDemoGenerate" type="button" disabled={generating} onClick={onGenerate}>{generating?'正在生成演示…':lab?'重新生成演示':'AI 根据本页生成演示'}</button>}
 </div></div>;
}
export default SlideDemoNode;
