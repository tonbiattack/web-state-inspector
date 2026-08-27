import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '..');

async function moduleAt(relativePath) {
  return import(`${pathToFileURL(resolve(root, relativePath)).href}?test=${Date.now()}-${Math.random()}`);
}

test('JSON展開状態はStorage値の更新をまたいでキー単位に保持できる', async () => {
  const { JsonExpansionState } = await moduleAt('build/panel/json-expansion-state.js');
  const state = new JsonExpansionState();
  const firstKey = 'storage-json:local-storage:local-memo-diff:notes:v1';
  const secondKey = 'storage-json:local-storage:other';

  assert.equal(state.isExpanded(firstKey), false);
  state.setExpanded(firstKey, true);
  assert.equal(state.isExpanded(firstKey), true, '再描画時に同じStorage keyを使えば展開状態を復元できる');
  assert.equal(state.isExpanded(secondKey), false, '別のStorage keyには状態を引き継がない');
  state.setExpanded(firstKey, false);
  assert.equal(state.isExpanded(firstKey), false);
});

test('Storage JSONビューは開閉イベントを状態管理へ同期し、再描画時にdetails.openを復元する', async () => {
  const source = await readFile(resolve(root, 'src/panel/main.ts'), 'utf8');
  assert.match(source, /new JsonExpansionState\(\)/);
  assert.match(source, /details\.open = jsonExpansionState\.isExpanded\(expansionKey\)/);
  assert.match(source, /summary\.addEventListener\('click'/);
  assert.match(source, /jsonExpansionState\.setExpanded\(expansionKey, !details\.open\)/);
  assert.match(source, /details\.addEventListener\('toggle'/);
  assert.match(source, /jsonExpansionState\.setExpanded\(expansionKey, details\.open\)/);
  assert.match(source, /jsonView\(entry\.parsedValue, true, `storage-json:\$\{state\.selected\}:\$\{entry\.key\}`\)/);
});
