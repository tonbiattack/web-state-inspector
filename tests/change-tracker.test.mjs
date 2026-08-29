import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '..');

class FakeStorage {
  #data = new Map();

  get length() { return this.#data.size; }
  key(index) { return [...this.#data.keys()][index] ?? null; }
  getItem(key) { return this.#data.has(String(key)) ? this.#data.get(String(key)) : null; }
  setItem(key, value) { this.#data.set(String(key), String(value)); }
  removeItem(key) { this.#data.delete(String(key)); }
  clear() { this.#data.clear(); }
}

function createTrackerEnvironment() {
  const listeners = new Map();
  const localStorage = new FakeStorage();
  const sessionStorage = new FakeStorage();
  const window = {
    localStorage,
    sessionStorage,
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) { listeners.delete(type, listener); },
  };
  let performanceMs = 100;
  const context = vm.createContext({
    window,
    Storage: FakeStorage,
    performance: { now: () => ++performanceMs },
  });
  const evaluator = {
    async evaluate(expression) {
      try {
        return { ok: true, data: new vm.Script(expression).runInContext(context) };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  };
  return { evaluator, listeners, localStorage, sessionStorage };
}

async function loadChangeTracker() {
  const url = `${pathToFileURL(resolve(root, 'build/panel/change-tracker.js')).href}?test=${Date.now()}-${Math.random()}`;
  return import(url);
}

test('Storage変更計測はAPI操作、変更前後、実行箇所、外部イベントを記録する', async () => {
  const { ChangeTracker } = await loadChangeTracker();
  const { evaluator, listeners, localStorage, sessionStorage } = createTrackerEnvironment();
  localStorage.setItem('before-recording', 'ignored');
  sessionStorage.setItem('session-seed', 'present');
  const originalSetItem = FakeStorage.prototype.setItem;
  const tracker = new ChangeTracker(evaluator);

  const started = await tracker.start(20);
  assert.equal(started.ok, true);
  assert.equal(started.data.active, true);
  assert.equal(started.data.capacity, 20);
  assert.equal(started.data.eventCount, 0);
  localStorage.setItem('profile', 'v1');
  localStorage.setItem('profile', 'v1');
  localStorage.removeItem('profile');
  sessionStorage.clear();
  listeners.get('storage')({ storageArea: localStorage, key: 'shared', oldValue: 'old', newValue: 'new', url: 'https://example.test/other' });

  const snapshot = await tracker.getSnapshot();
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.data.active, true);
  assert.equal(snapshot.data.eventCount, 5);
  assert.deepEqual(Array.from(snapshot.data.events, (event) => event.operation), ['setItem', 'setItem', 'removeItem', 'clear', 'external-storage-event']);
  assert.deepEqual(Array.from(snapshot.data.events, (event) => event.outcome), ['changed', 'unchanged', 'changed', 'changed', 'changed']);
  assert.deepEqual(snapshot.data.events[0].key, 'profile');
  assert.deepEqual(snapshot.data.events[0].oldValue, null);
  assert.deepEqual(snapshot.data.events[0].newValue, 'v1');
  assert.deepEqual(snapshot.data.events[2].newValue, null);
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot.data.events[3].clearedEntries)), [{ key: 'session-seed', value: 'present' }]);
  assert.equal(snapshot.data.events[4].externalUrl, 'https://example.test/other');
  assert.ok(snapshot.data.events[0].stack.length > 0);

  const stopped = await tracker.stop();
  assert.equal(stopped.ok, true);
  assert.equal(stopped.data.active, false);
  assert.equal(stopped.data.capacity, 20);
  assert.equal(stopped.data.eventCount, 5);
  assert.equal(FakeStorage.prototype.setItem, originalSetItem, 'Stopで元のStorageメソッドを復元する');
  localStorage.setItem('after-stop', 'not-recorded');
  assert.equal((await tracker.getSnapshot()).data.eventCount, 5);
});

test('Storage変更計測は上限を超えた古いイベントを破棄する', async () => {
  const { ChangeTracker } = await loadChangeTracker();
  const { evaluator, localStorage } = createTrackerEnvironment();
  const tracker = new ChangeTracker(evaluator);
  await tracker.start(20);
  for (let index = 0; index < 24; index += 1) localStorage.setItem(`key-${index}`, String(index));

  const snapshot = await tracker.getSnapshot();
  assert.equal(snapshot.data.capacity, 20);
  assert.equal(snapshot.data.eventCount, 20);
  assert.equal(snapshot.data.events[0].key, 'key-4');
  assert.equal(snapshot.data.events.at(-1).key, 'key-23');
});

test('Storage変更は独立画面ではなくDebug Timelineへ統合されている', async () => {
  const panel = await readFile(resolve(root, 'src/panel/main.ts'), 'utf8');
  const sample = await readFile(resolve(root, 'sample/index.html'), 'utf8');
  const nav = panel.slice(panel.indexOf('const navItems'), panel.indexOf('const labels'));
  for (const label of ['Timeline', 'Storage']) {
    assert.match(panel, new RegExp(`'${label.replace(/[→]/g, '\\$&')}'`));
  }
  assert.doesNotMatch(nav, /State Change Timeline/);
  assert.match(panel, /setInterval/);
  assert.match(panel, /changeTracker\.start/);
  assert.match(sample, /localStorage\.setItem/);
  assert.match(sample, /localStorage\.removeItem/);
  assert.match(sample, /sessionStorage\.clear/);
});
