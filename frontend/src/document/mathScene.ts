import type { MathScene } from './types';

export const defaultMathScene = (): MathScene => ({
  view_box: {x: [-4, 4], y: [-3, 3]}, matrix: [[1, 1], [0, 1]], vector: [1, 1],
  show_grid: true, show_circle: true, radius: 1, progress: 1, animation_step: .02,
  viewer_parameters: ['vector', 'progress'],
});

export function transformPoint(matrix: MathScene['matrix'], [x, y]: [number, number], t: number): [number, number] {
  return [(1-t)*x+t*(matrix[0][0]*x+matrix[0][1]*y),
    (1-t)*y+t*(matrix[1][0]*x+matrix[1][1]*y)];
}

export type Matrix2 = MathScene['matrix'];
const identity: Matrix2 = [[1,0],[0,1]];
export function multiply(a:Matrix2,b:Matrix2):Matrix2 {
  return a.map(row=>[row[0]*b[0][0]+row[1]*b[1][0],row[0]*b[0][1]+row[1]*b[1][1]]) as Matrix2;
}
export function matrixInvariants(m:Matrix2) {
  return {trace:Number((m[0][0]+m[1][1]).toFixed(9)),determinant:Number((m[0][0]*m[1][1]-m[0][1]*m[1][0]).toFixed(9))};
}
function inverse(m:Matrix2):Matrix2|null {
  const d=m[0][0]*m[1][1]-m[0][1]*m[1][0];
  return Math.abs(d)<1e-10?null:[[m[1][1]/d,-m[0][1]/d],[-m[1][0]/d,m[0][0]/d]];
}
export function changeBasis(a:Matrix2,p:Matrix2):Matrix2|null {
 const inv=inverse(p);return inv?multiply(multiply(inv,a),p):null;
}
export function interpolateMatrix(a:Matrix2,b:Matrix2,t:number):Matrix2 {
  if(t<=0)return a;if(t>=1)return b;
  const inv=inverse(a); const relative=inv?multiply(b,inv):null;
  // A pure rotation between cumulative steps must preserve lengths throughout playback.
  if(relative&&Math.abs(relative[0][0]-relative[1][1])<1e-7&&Math.abs(relative[0][1]+relative[1][0])<1e-7&&Math.abs(Math.hypot(relative[0][0],relative[1][0])-1)<1e-7){
    const angle=Math.atan2(relative[1][0],relative[0][0])*t,c=Math.cos(angle),s=Math.sin(angle);
    return multiply([[c,-s],[s,c]],a);
  }
  return a.map((row,i)=>row.map((v,j)=>v+(b[i]![j]!-v)*t)) as Matrix2;
}
export function sceneMatrix(scene:MathScene):Matrix2 {
  const steps=scene.steps;
  if(!steps?.length)return interpolateMatrix(identity,scene.matrix,scene.progress);
  const position=Math.max(0,Math.min(1,scene.progress))*steps.length;
  const index=Math.min(steps.length-1,Math.floor(position));
  return interpolateMatrix(index?steps[index-1]!.matrix:identity,steps[index]!.matrix,position-index);
}
export function polygonArea(points:[number,number][]):number {
 return Math.abs(points.reduce((sum,[x,y],i)=>{const next=points[(i+1)%points.length]!;return sum+x*next[1]-y*next[0];},0))/2;
}
export function resolveMatrixSource(scene:MathScene,nodes:import('./types').SceneNode[]):MathScene {
 const source=scene.matrix_source; if(!source)return scene;
 const values=nodes.find(n=>n.id===source.node_id)?.matrix_ocr?.matrices[source.matrix_index]?.values;
 return values?.length===2&&values.every(row=>row.length===2&&row.every(Number.isFinite))?{...scene,matrix:values as Matrix2}:scene;
}
export function updateMatrixCell(ocr:import('./types').MatrixOCR,index:number,row:number,col:number,value:number):import('./types').MatrixOCR {
 if(!Number.isFinite(value)||Math.abs(value)>100||ocr.operation==='add'&&ocr.result===index||ocr.matrices[index]?.values[row]?.[col]===undefined)return ocr;
 const matrices=ocr.matrices.map(m=>({...m,values:m.values.map(r=>[...r])}));
 matrices[index]!.values[row]![col]=value;
 if(ocr.operation==='add'&&ocr.operands&&ocr.result!==undefined){
  const a=matrices[ocr.operands[0]],b=matrices[ocr.operands[1]],result=matrices[ocr.result];
  if(a&&b&&result&&a.values.length===b.values.length&&a.values.every((r,i)=>r.length===b.values[i]?.length))
   result.values=a.values.map((r,i)=>r.map((v,j)=>v+b.values[i]![j]!));
 }
 if(matrices.some(m=>m.values.some(r=>r.some(v=>!Number.isFinite(v)||Math.abs(v)>100))))return ocr;
 return {...ocr,matrices};
}
