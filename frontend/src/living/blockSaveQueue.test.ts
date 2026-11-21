import assert from 'node:assert/strict';
import test from 'node:test';
import { BlockSaveQueue } from './blockSaveQueue.ts';

test('serializes commits and uses the last confirmed revision', async () => {
  const queue = new BlockSaveQueue();
  const seen: number[] = [];
  const send = async (revision: number) => {
    seen.push(revision);
    return { revision: revision + 1 };
  };
  assert.deepEqual(await Promise.all([queue.commit(1, send), queue.commit(1, send)]),
    [{ revision: 2 }, { revision: 3 }]);
  assert.deepEqual(seen, [1, 2]);
});

test('a conflict stops queued writes until a fresh document is loaded', async () => {
  const queue = new BlockSaveQueue();
  const failed = queue.commit(3, async () => { throw new Error('conflict'); });
  const queued = queue.commit(3, async () => assert.fail('stale write sent'));
  await assert.rejects(failed, /conflict/);
  await assert.rejects(queued, /conflict/);
  assert.deepEqual(await new BlockSaveQueue().commit(9, async revision => ({ revision: revision + 1 })),
    { revision: 10 });
});
