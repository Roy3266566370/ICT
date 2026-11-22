import assert from 'node:assert/strict';
import test from 'node:test';
import { newNode, patchNodes, diffDocuments } from './model.ts';
import { transformPoint } from './mathScene.ts';
import type { SceneDocument, ScenePage } from './types.ts';

test('matrix interpolation preserves endpoints and permits singular transforms', () => {
  assert.deepEqual(transformPoint([[2, 1], [0, 0]], [2, 3], 0), [2, 3]);
  assert.deepEqual(transformPoint([[2, 1], [0, 0]], [2, 3], 1), [7, 0]);
  assert.deepEqual(transformPoint([[2, 1], [0, 0]], [2, 3], .5), [4.5, 1.5]);
});

test('math scenes, flow and audience permissions survive create and edit payloads', () => {
  const page: ScenePage = {page_no: 1, width: 960, height: 540, nodes: []};
  const base: SceneDocument = {schema_version: '1.0', revision: 0, title: 'test', pages: [page]};
  const node = newNode(page, 'u_math', 'math_scene');
  assert.ok(node.math_scene);
  const created = {...base, pages: [{...page, nodes: [node]}]};
  assert.deepEqual(diffDocuments(base, created)[0]?.create?.math_scene, node.math_scene);
  const config = {...node.math_scene!, matrix: [[2, 0], [0, 1]] as [[number, number], [number, number]]};
  const changed = patchNodes(created, 1, [node.id], {math_scene: config,
    flow: {enabled: true, speed: 2}, viewer_editable: false});
  const patch = diffDocuments(created, changed)[0]?.patch;
  assert.deepEqual(patch?.math_scene, config);
  assert.deepEqual(patch?.flow, {enabled: true, speed: 2});
  assert.equal(patch?.viewer_editable, false);
});

import { sceneMatrix, changeBasis, matrixInvariants, updateMatrixCell, resolveMatrixSource } from './mathScene.ts';
test('step interpolation preserves rotations and cumulative endpoints',()=>{
 const scene={...newNode({page_no:1,width:960,height:540,nodes:[]},'m','math_scene').math_scene!, steps:[{label:'stretch',matrix:[[2,0],[0,1]] as [[number,number],[number,number]]},{label:'rotate',matrix:[[0,-1],[2,0]] as [[number,number],[number,number]]}]};
 assert.deepEqual(sceneMatrix({...scene,progress:.5}),[[2,0],[0,1]]);
 const m=sceneMatrix({...scene,progress:.75});
 assert.ok(Math.abs(Math.hypot(m[0][0],m[1][0])-2)<1e-8);
 assert.ok(Math.abs(Math.hypot(m[0][1],m[1][1])-1)<1e-8);
});
test('change of basis preserves trace and determinant',()=>{
 const q=Math.SQRT1_2; const next=changeBasis([[2,0],[0,3]],[[q,q],[-q,q]])!;
 assert.ok(Math.abs(next[0][0]-2.5)<1e-8); assert.ok(Math.abs(next[0][1]+.5)<1e-8);
 assert.deepEqual(matrixInvariants(next),{trace:5,determinant:6});
 assert.equal(changeBasis([[2,0],[0,3]],[[1,1],[1,1]]),null);
});
test('OCR edits recompute rectangular addition and resolve bound 2x2 scenes',()=>{
 const ocr={matrices:[{values:[[1,2,3],[4,5,6]],cells:[]},{values:[[2,3,4],[5,6,7]],cells:[]},{values:[[0,0,0],[0,0,0]],cells:[]}],operation:'add' as const,operands:[0,1] as [number,number],result:2};
 const next=updateMatrixCell(ocr,0,0,1,8);
 assert.deepEqual(next.matrices[2]!.values,[[3,11,7],[9,11,13]]);
 assert.deepEqual(updateMatrixCell(next,2,0,0,99),next);
 const page={page_no:1,width:960,height:540,nodes:[]}; const source={...newNode(page,'source','image'),matrix_ocr:{matrices:[{values:[[2,1],[1,2]],cells:[]}]}};
 const scene={...newNode(page,'m','math_scene').math_scene!,matrix_source:{node_id:'source',matrix_index:0}};
 assert.deepEqual(resolveMatrixSource(scene,[source]).matrix,[[2,1],[1,2]]);
 const base={schema_version:'1',revision:0,title:'',pages:[{...page,nodes:[source]}]};
 assert.ok(diffDocuments(base,patchNodes(base,1,['source'],{matrix_ocr:{...source.matrix_ocr,matrices:[]}}))[0]?.patch?.matrix_ocr);
});

test('OCR operands and computed results stay within the persistence bounds',()=>{
 const ocr={matrices:[{values:[[40]],cells:[]},{values:[[50]],cells:[]},{values:[[90]],cells:[]}],operation:'add' as const,operands:[0,1] as [number,number],result:2};
 assert.equal(updateMatrixCell(ocr,0,0,0,80),ocr);
 assert.equal(updateMatrixCell(ocr,0,0,0,101),ocr);
 assert.equal(updateMatrixCell(ocr,0,0,0,-101),ocr);
 assert.equal(updateMatrixCell(ocr,0,0,0,49).matrices[2]!.values[0]![0],99);
});
