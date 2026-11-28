import assert from 'node:assert/strict';
import test from 'node:test';
import type { SceneNode } from '../../document/types.ts';
import { isInteractiveSlide } from './deckPresentation.ts';

const node = (type: string, fields = {}) => ({ type, ...fields }) as SceneNode;

test('交互筛选仅包含可见交互和可动画线条', () => {
  for (const type of ['workshop_plugin', 'math_scene', 'diagram', 'vector']) {
    assert.equal(isInteractiveSlide([node(type)]), true);
    assert.equal(isInteractiveSlide([node(type, { hidden: true })]), false);
    assert.equal(isInteractiveSlide([node(type, { deleted: true })]), false);
  }
  assert.equal(isInteractiveSlide([node('text'), node('image'), node('vector', { locked: true })]), false);
  assert.equal(isInteractiveSlide([node('vector', { locked: true, style: { anim_step: 1 } })]), true);
});
