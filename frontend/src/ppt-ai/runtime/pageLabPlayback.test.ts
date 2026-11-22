import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advancePlayback, nextStop, playbackStep, publicParams, labDefaults, playbackInput } from './pageLabPlayback.ts';
const timeline = { duration_s: 2, stops: [{t:0,label:'开始'},{t:0.4,label:'中间'},{t:1,label:'结束'}] };
test('playback stops exactly at the next checkpoint even after a long frame', () => {
  assert.deepEqual(advancePlayback(timeline, 0.2, 800), {t:0.4, playing:false});
  assert.deepEqual(advancePlayback(timeline, 0.4, 100), {t:0.45, playing:true});
});
test('next step and index are normalized and old labs remain static', () => {
  assert.equal(nextStop(timeline, 0.4), 1);
  assert.equal(playbackStep(timeline, 0.39), 0);
  assert.equal(playbackStep(timeline, 0.4), 1);
  assert.deepEqual(advancePlayback(undefined, 0, 200), {t:0, playing:false});
  assert.deepEqual(advancePlayback(timeline, 1, 200), {t:1, playing:false});
});
test('only whitelisted ordinary parameters are exposed; t and step stay reserved', () => {
  const params = [{id:'x'},{id:'t'},{id:'step'},{id:'hidden'}];
  assert.deepEqual(publicParams({params,timeline,public_params:['x','t','step']}), [{id:'x'}]);
  assert.deepEqual(publicParams({params,timeline}), [{id:'x'},{id:'hidden'}]);
});

test('legacy labs retain ordinary t and step defaults, controls and inputs', () => {
  const params = [{id:'t',default:5},{id:'step',default:2},{id:'x',default:3}];
  assert.deepEqual(labDefaults({params}), {t:5,step:2,x:3});
  assert.deepEqual(publicParams({params}), params);
  assert.deepEqual(playbackInput({t:5,step:2,x:3}, undefined, 0), {t:5,step:2,x:3});
  assert.deepEqual(labDefaults({params,timeline}), {x:3});
  assert.deepEqual(playbackInput({x:3}, timeline, .4), {x:3,t:.4,step:1});
});
