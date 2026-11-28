import type {SceneNode,TextStyle} from '@/document/types';
import type {Box} from './canvasGestures';
import styles from './FreeDeckEditor.module.css';

export function FloatingFormatBar({node,box,scale,pageWidth,onStyle,onAlign,onGroup,onCrop,onReplace,onDelete}:{
  node:SceneNode|null;box:Box;scale:number;pageWidth:number;onStyle:(style:Partial<TextStyle>)=>void;
  onAlign:(mode:string)=>void;onGroup:()=>void;onCrop?:()=>void;onReplace?:()=>void;onDelete:()=>void;
}){
  const width=260;
  const left=Math.max(0,Math.min(box.x,pageWidth-width/scale));
  const top=box.y<36/scale?box.y+box.height+6/scale:box.y-34/scale;
  return <div className={styles.formatBar} data-editor-control role="toolbar" aria-label="对象快捷格式"
    onPointerDown={event=>event.stopPropagation()} style={{left,top,transform:`scale(${1/scale})`}}>
    {node?.type==='text'||node?.type==='shape'?<>
      <button type="button" aria-label="快捷缩小字号" onClick={()=>onStyle({font_size:Math.max(1,(node.style.font_size??24)-2)})}>A−</button>
      <button type="button" aria-label="快捷放大字号" onClick={()=>onStyle({font_size:Math.min(500,(node.style.font_size??24)+2)})}>A+</button>
      {(['bold','italic','underline'] as const).map((key,index)=><button key={key} type="button"
        aria-label={['快捷加粗','快捷斜体','快捷下划线'][index]} aria-pressed={!!node.style[key]}
        onClick={()=>onStyle({[key]:!node.style[key]})}>{['B','I','U'][index]}</button>)}
      <input type="color" aria-label="快捷文字色" value={node.style.color?.startsWith('#')?node.style.color:'#18233d'}
        onChange={event=>onStyle({color:event.target.value})}/>
    </>:node?.type==='image'?<>
      <button type="button" onClick={onCrop}>裁剪</button><button type="button" onClick={onReplace}>替换</button>
    </>:!node&&<>
      <button type="button" onClick={()=>onAlign('left')}>左对齐</button>
      <button type="button" onClick={()=>onAlign('center')}>居中</button>
      <button type="button" onClick={()=>onAlign('right')}>右对齐</button>
      <button type="button" onClick={onGroup}>组合</button>
    </>}
    <button type="button" aria-label="快捷删除对象" onClick={onDelete}>删除</button>
  </div>;
}
