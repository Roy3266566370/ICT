import test from 'node:test';
import assert from 'node:assert/strict';
import {newNode,diffDocuments,patchNodes} from './model.ts';
import {defaultDiagram} from './inlineSystems.ts';
import type {SceneDocument} from './types.ts';

test('inline nodes preserve diagram edits, demo placeholders and audience switches',()=>{
 const page={page_no:2,width:960,height:540,nodes:[]};
 const diagram=newNode(page,'u_diagram','diagram'),demo=newNode(page,'u_demo','demo');
 assert.deepEqual(diagram.diagram,defaultDiagram()); assert.equal(demo.demo,null);
 const base:SceneDocument={schema_version:'1',revision:0,title:'',pages:[page]};
 const created={...base,pages:[{...page,nodes:[diagram,demo]}]};
 assert.ok(diffDocuments(base,created)[0]?.create?.diagram);
 assert.equal(diffDocuments(base,created)[1]?.create?.demo,null);
 const doc=defaultDiagram();doc.nodes[0]!.label='新文字';
 const changes=diffDocuments(created,patchNodes(created,2,[diagram.id],{diagram:doc,viewer_editable:false}));
 assert.equal(changes[0]?.patch?.diagram?.nodes[0]?.label,'新文字');
 assert.equal(changes[0]?.patch?.viewer_editable,false);
});
