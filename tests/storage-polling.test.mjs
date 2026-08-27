import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '..');

async function loadController() {
  const url = `${pathToFileURL(resolve(root, 'build/panel/storage-polling.js')).href}?test=${Date.now()}-${Math.random()}`;
  return import(url);
}

function createHarness(overrides = {}) {
  const state = {
    selected: 'local-storage',
    autoRefreshEnabled: false,
    autoRefreshIntervalMs: 1000,
    changeTrackingActive: false,
    loading: false,
    ...overrides,
  };
  const scheduled = [];
  const cancelled = [];
  let refreshCount = 0;
  return {
    state,
    scheduled,
    cancelled,
    refreshCount: () => refreshCount,
    scheduler: (callback, milliseconds) => {
      scheduled.push({ callback, milliseconds, id: scheduled.length + 1 });
      return scheduled.length;
    },
    canceller: (id) => { cancelled.push(id); },
    refresh: () => { refreshCount += 1; },
  };
}

test('Auto Refreshが有効なStorage一覧を指定した更新間隔で再取得する', async () => {
  const { StoragePollingController } = await loadController();
  const harness = createHarness({ autoRefreshEnabled: true, autoRefreshIntervalMs: 2000 });
  const controller = new StoragePollingController(() => harness.state, harness.refresh, harness.scheduler, harness.canceller);

  controller.sync();
  assert.deepEqual(harness.scheduled.map((entry) => entry.milliseconds), [2000]);
  harness.scheduled[0].callback();
  assert.equal(harness.refreshCount(), 1);

  harness.state.loading = true;
  harness.scheduled[0].callback();
  assert.equal(harness.refreshCount(), 1, '取得中は重ねて再取得しない');

  harness.state.loading = false;
  harness.state.selected = 'cookies';
  harness.scheduled[0].callback();
  assert.equal(harness.refreshCount(), 1, 'Storage一覧以外に移動後は再取得しない');
});

test('Timeline記録中はAuto RefreshがオフでもStorage一覧を700msで追従する', async () => {
  const { StoragePollingController } = await loadController();
  const harness = createHarness({ changeTrackingActive: true, autoRefreshEnabled: false });
  const controller = new StoragePollingController(() => harness.state, harness.refresh, harness.scheduler, harness.canceller);

  controller.sync();
  assert.deepEqual(harness.scheduled.map((entry) => entry.milliseconds), [700]);
  harness.scheduled[0].callback();
  assert.equal(harness.refreshCount(), 1);
});

test('Auto RefreshもTimeline記録もない場合はポーリングせず、再同期時は前のタイマーを停止する', async () => {
  const { StoragePollingController } = await loadController();
  const harness = createHarness();
  const controller = new StoragePollingController(() => harness.state, harness.refresh, harness.scheduler, harness.canceller);

  controller.sync();
  assert.equal(harness.scheduled.length, 0);
  harness.state.autoRefreshEnabled = true;
  controller.sync();
  assert.equal(harness.scheduled.length, 1);
  controller.sync();
  assert.deepEqual(harness.cancelled, [1]);
  assert.equal(harness.scheduled.length, 2);
  controller.stop();
  assert.deepEqual(harness.cancelled, [1, 2]);
});

test('パネルはAuto Refreshのオン・オフ、更新間隔、Timeline連動を実装している', async () => {
  const panel = await readFile(resolve(root, 'src/panel/main.ts'), 'utf8');
  const polling = await readFile(resolve(root, 'src/panel/storage-polling.ts'), 'utf8');
  assert.match(panel, /'Auto Refresh'/);
  assert.match(panel, /'Interval'/);
  assert.match(panel, /\[500, 1000, 2000, 5000\]/);
  assert.match(panel, /syncStoragePolling\(\)/);
  assert.match(panel, /changeTrackingActive/);
  assert.match(polling, /Timelineの記録中は一覧を700ms間隔/);
  assert.match(polling, /!current\.loading/);
});
