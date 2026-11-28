import {useRef,useState,type PointerEvent as ReactPointerEvent} from 'react';
import type {SceneNode} from '@/document/types';
import styles from './FreeDeckEditor.module.css';

const uncropped={left:0,right:0,top:0,bottom:0};
type Crop=NonNullable<SceneNode['crop']>;

export function ImageCropOverlay({node,scale,onCancel,onConfirm}:{node:SceneNode;scale:number;onCancel:()=>void;onConfirm:(crop:Crop)=>void}){
  const [crop,setCrop]=useState(node.crop??uncropped);
  const drag=useRef<{side:keyof Crop;x:number;y:number;initial:Crop}|null>(null);
  const start=(event:ReactPointerEvent<HTMLButtonElement>,side:keyof Crop)=>{
    event.stopPropagation();event.currentTarget.setPointerCapture(event.pointerId);
    drag.current={side,x:event.clientX,y:event.clientY,initial:crop};
  };
  const move=(event:ReactPointerEvent<HTMLButtonElement>)=>{
    const active=drag.current;if(!active)return;
    const angle=-node.rotation*Math.PI/180;
    const dx=(event.clientX-active.x)/scale,dy=(event.clientY-active.y)/scale;
    const localX=dx*Math.cos(angle)-dy*Math.sin(angle),localY=dx*Math.sin(angle)+dy*Math.cos(angle);
    const {side,initial}=active;
    const opposite={left:'right',right:'left',top:'bottom',bottom:'top'} as const;
    const change=side==='left'?localX/node.width:side==='right'?-localX/node.width:
      side==='top'?localY/node.height:-localY/node.height;
    setCrop({...initial,[side]:Math.max(0,Math.min(.94-initial[opposite[side]],initial[side]+change))});
  };
  return <div className={styles.cropOverlay} data-editor-control data-no-pan
    style={{left:node.x,top:node.y,width:node.width,height:node.height,transform:`rotate(${node.rotation}deg)`}}
    onPointerDown={event=>event.stopPropagation()}
    onKeyDown={event=>{
      if(event.key==='Escape'){event.stopPropagation();onCancel();}
      if(event.key==='Enter'&&event.target===event.currentTarget){event.stopPropagation();onConfirm(crop);}
    }} tabIndex={0} ref={element=>{if(element&&!element.contains(document.activeElement))element.focus({preventScroll:true});}}>
    <img src={node.image_data??node.cleaned_url??node.image_url??undefined} alt="" draggable={false}/>
    <div className={styles.cropBox} style={{left:`${crop.left*100}%`,right:`${crop.right*100}%`,
      top:`${crop.top*100}%`,bottom:`${crop.bottom*100}%`}}>
      {(['left','right','top','bottom'] as const).map((side,index)=><button type="button" key={side}
        className={styles.cropHandle} data-side={side} aria-label={`调整${['左','右','上','下'][index]}侧裁剪`}
        onPointerDown={event=>start(event,side)} onPointerMove={move}
        onLostPointerCapture={()=>{drag.current=null;}}/>)}
    </div>
    <div className={styles.cropActions}><button type="button" onClick={onCancel}>取消</button>
      <button type="button" onClick={()=>onConfirm(crop)}>确认裁剪</button></div>
  </div>;
}
