import assert from 'node:assert/strict';
import {test} from 'node:test';
import {groupResize, rotatedBounds, rotateSelection, snapAxis} from './canvasGestures.ts';

const node = (x:number,y=0,rotation=0) => ({x,y,width:20,height:10,rotation});

test('rotating a group moves each center around the shared center', () => {
  const a=node(0),b=node(40);
  const box=rotatedBounds([a,b]);
  assert.deepEqual(rotateSelection(a,box,90), {x:20,y:-20,rotation:90});
  assert.deepEqual(rotateSelection(b,box,90), {x:20,y:20,rotation:90});
});

test('group resize scales local geometry and keeps the opposite corner fixed', () => {
  const a=node(0),b=node(40,20,90);
  const box=rotatedBounds([a,b]);
  const resized=groupResize([a,b],box,'se',box.width,box.height*2,false);
  assert.deepEqual(resized,[{x:0,y:0,width:40,height:30},{x:70,y:65,width:60,height:20}]);
  const rotated=node(0,0,45);
  const mixed=rotatedBounds([rotated,b]);
  const proportionate=groupResize([rotated,b],mixed,'e',mixed.width,0,false);
  assert.equal(proportionate[0]?.width,40);
  assert.equal(proportionate[0]?.height,20);
});

test('snap finds equal in-between and repeated gaps in the active lane', () => {
  const start=node(39),left=node(4),right=node(76);
  const snap=snapAxis('x',start,0,0,[left,right],200,4);
  assert.equal(snap.offset,1);
  assert.deepEqual(snap.gaps?.map(({from,to})=>[from,to]),[[24,40],[60,76]]);
  const trailing=snapAxis('x',node(111),0,0,[left,right],200,4);
  assert.equal(trailing.offset,0);
  assert.equal(trailing.gaps,undefined);
  const repeated=snapAxis('x',node(151),0,0,[left,right],200,4);
  assert.equal(repeated.offset,-3);
  assert.deepEqual(repeated.gaps?.map(({from,to})=>[from,to]),[[24,76],[96,148]]);
});
