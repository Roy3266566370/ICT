import type {NodePatch,SceneNode} from '@/document/types';
import {updateMatrixCell} from '@/document/mathScene';

/** Small opaque inputs cover only recognized glyphs, keeping the original image intact. */
export function MatrixImageLayer({node,interactive,onPatch}:{node:SceneNode;interactive?:boolean;onPatch:(patch:NodePatch,key?:string)=>void}) {
 const ocr=node.matrix_ocr;if(!ocr)return null;
 const enabled=interactive&&!node.locked&&node.viewer_editable!==false;
 return <div data-matrix-image={node.id} data-no-pan style={{position:'absolute',left:node.x,top:node.y,width:node.width,height:node.height,
  transform:`rotate(${node.rotation}deg)`,zIndex:node.z+10002,opacity:node.opacity,pointerEvents:'none'}}>
  {ocr.matrices.flatMap((matrix,index)=>matrix.cells.map((cell,ci)=>{
   const value=matrix.values[cell.row]?.[cell.col];if(value===undefined)return null;
   const readonly=ocr.operation==='add'&&ocr.result===index;
   const [x,y,w,h]=cell.bbox;
   const fontSize=Math.max(11,Math.min(h*node.height*.95,24));
   const width=Math.max(w*node.width,14,String(value).length*fontSize*.62+4),height=Math.max(h*node.height,14);
   return <input className="matrixImageCell" key={`${index}:${ci}`} data-matrix-cell={`${index}:${cell.row}:${cell.col}`}
    aria-label={`矩阵${index+1} 第${cell.row+1}行 第${cell.col+1}列`} type="number" min="-100" max="100" step="0.1" value={value} readOnly={!enabled||readonly}
    tabIndex={interactive?0:-1} aria-hidden={!interactive||undefined}
    style={{position:'absolute',left:x*node.width+(w*node.width-width)/2,top:y*node.height+(h*node.height-height)/2,width,height,
     padding:0,border:enabled&&!readonly?'1px solid #b8cbd6':'0',borderRadius:2,background:'#fff',color:readonly?'#176a89':'#18233d',
     fontSize,lineHeight:1,fontFamily:node.style.font_family,textAlign:'center',boxSizing:'border-box',pointerEvents:enabled?'auto':'none'}}
    onPointerDown={event=>event.stopPropagation()} onKeyDown={event=>event.stopPropagation()}
    onChange={event=>{const v=event.target.valueAsNumber;if(enabled&&!readonly&&Number.isFinite(v))onPatch({matrix_ocr:updateMatrixCell(ocr,index,cell.row,cell.col,v)},`ocr.${index}.${cell.row}.${cell.col}`);}}/>;
  }))}
 </div>;
}
