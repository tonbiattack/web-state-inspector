import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '..');

test('Network更新を一時停止しても収集済み表示だけが固定され、再開時に追従する', async () => {
  const modulePath = pathToFileURL(resolve(root, 'build/panel/network-update-state.js')).href;
  const { NetworkUpdateState } = await import(`${modulePath}?test=${Date.now()}`);
  const updates = new NetworkUpdateState();
  const first = { id: 'one' };
  const second = { id: 'two' };
  const third = { id: 'three' };

  updates.pause([first]);
  assert.equal(updates.paused, true);
  assert.deepEqual(updates.entries([first, second, third]), [first]);
  assert.equal(updates.pendingCount([first, second, third]), 2);

  updates.resume();
  assert.equal(updates.paused, false);
  assert.deepEqual(updates.entries([first, second, third]), [first, second, third]);
  assert.equal(updates.pendingCount([first, second, third]), 0);
});
