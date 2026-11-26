import {Component,lazy,Suspense,useState,type ReactNode} from 'react';
import type {NodePatch,SceneNode} from '@/document/types';
import type {DiagramDoc} from '@/living/diagram';
import './slideRichNodes.css';
const DiagramCanvas = lazy(() => import('@/components/living/DiagramCanvas'));
export interface SlideRichNodeProps {node:SceneNode;editing:boolean;interactive:boolean;onPatch:(patch:NodePatch,key?:string)=>void}
export function richNodeStyle(node:SceneNode,interactive:boolean) {return {position:'absolute' as const,left:node.x,top:node.y,width:node.width,height:node.height,transform:`rotate(${node.rotation}deg)`,opacity:node.opacity,zIndex:node.z+10001,pointerEvents:interactive?'auto' as const:'none' as const};}
export function DiagramPreview({doc}:{doc:DiagramDoc}) {
 return <svg className="slideDiagramPreview" viewBox="0 0 1000 620" role="img" aria-label="流程图预览">
 {doc.edges.map((edge,i)=>{const a=doc.nodes.find(n=>n.id===edge.from),b=doc.nodes.find(n=>n.id===edge.to);return a&&b?<line key={i} x1={a.x*850+75} y1={a.y*520+32} x2={b.x*850+75} y2={b.y*520+32} stroke="#64748b" strokeWidth={3}/>:null;})}
 {doc.nodes.map(n=><g key={n.id} transform={`translate(${n.x*850},${n.y*520})`}><rect width={150} height={65} rx={n.shape==='oval'?32:n.shape==='rounded'?12:2} fill="white" stroke="#64748b" strokeWidth={2}/><text x={75} y={38} textAnchor="middle" fontSize={17} fill="#334155">{n.label.slice(0,14)}</text></g>)}</svg>;
}
class DiagramErrorBoundary extends Component<{fallback:ReactNode;onRetry:()=>void;children:ReactNode},{failed:boolean}> {
  override state = {failed:false};
  static getDerivedStateFromError() { return {failed:true}; }
  override render() {
    if (!this.state.failed) return this.props.children;
    return <div style={{position:'relative',width:'100%',height:'100%'}}>
      {this.props.fallback}
      <button type="button" onClick={()=>{this.setState({failed:false});this.props.onRetry();}}
        style={{position:'absolute',right:8,bottom:8,padding:'4px 8px',fontSize:11,borderRadius:5,border:'1px solid #cbd5e1',background:'#fff',color:'#334155',cursor:'pointer'}}>
        重新加载流程图
      </button>
    </div>;
  }
}
export function SlideDiagramNode({node,editing,interactive,onPatch}:SlideRichNodeProps) {
 const [retryKey,setRetryKey]=useState(0);
 if(!node.diagram)return null;
 return <div className="slideRichNode" data-no-pan data-scene-diagram={node.id} data-presentation-snapshot={node.id} style={richNodeStyle(node,interactive||editing)}>
 {editing&&interactive&&!node.locked&&<div className="slideRichGrip" title="拖动整个流程图">⠿ 流程图</div>}
 <div className="slideRichContent" onPointerDown={e=>{if(interactive)e.stopPropagation();}} onKeyDown={e=>{if(interactive)e.stopPropagation();}}>
 {interactive?<DiagramErrorBoundary key={retryKey} fallback={<DiagramPreview doc={node.diagram}/>} onRetry={()=>setRetryKey(k=>k+1)}>
   <Suspense fallback={<DiagramPreview doc={node.diagram}/>}><DiagramCanvas doc={node.diagram} embedded flow={node.flow} edgeStyle={{color:node.style.stroke,lineStyle:node.style.line_style,width:node.style.stroke_width}} height={Math.max(60,node.height-(editing&&!node.locked?24:0))} readOnly={node.locked||!editing} onDocChange={doc=>onPatch({diagram:doc},'diagram')}/></Suspense>
 </DiagramErrorBoundary>:<DiagramPreview doc={node.diagram}/>}
 </div></div>;
}
export default SlideDiagramNode;
