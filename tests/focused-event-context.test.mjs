import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '..');

async function moduleAt(relativePath) {
  return import(`${pathToFileURL(resolve(root, relativePath)).href}?test=${Date.now()}-${Math.random()}`);
}

function timelineEvent(id, timestamp, kind = 'user-action', extras = {}) {
  return { id, timestamp, performanceMs: 0, kind, summary: `${kind}:${id}`, ...extras };
}

test('失敗イベント中心の時間窓はISO timestampで前後のTimelineを切り出す', async () => {
  const { createFocusedEventWindow, filterTimelineAroundEvent, isFailureTimelineEvent } = await moduleAt('build/panel/focused-event-context.js');
  const anchor = timelineEvent('response-500', '2026-08-28T00:00:10.000Z', 'network-response', { requestId: 'network-1', method: 'POST', url: 'https://example.test/api/customer', status: 500, durationMs: 80 });
  const window = createFocusedEventWindow(anchor, 5000, 2000);

  assert.deepEqual({ beforeMs: window.beforeMs, afterMs: window.afterMs, startTimestamp: window.startTimestamp, endTimestamp: window.endTimestamp }, {
    beforeMs: 5000,
    afterMs: 2000,
    startTimestamp: '2026-08-28T00:00:05.000Z',
    endTimestamp: '2026-08-28T00:00:12.000Z',
  });
  const events = [
    timelineEvent('too-early', '2026-08-28T00:00:04.999Z'),
    timelineEvent('click', '2026-08-28T00:00:05.100Z'),
    timelineEvent('storage', '2026-08-28T00:00:09.900Z', 'storage', { storage: {} }),
    anchor,
    timelineEvent('error', '2026-08-28T00:00:11.100Z', 'console-error', { error: { message: 'failed' } }),
    timelineEvent('too-late', '2026-08-28T00:00:12.001Z'),
    timelineEvent('invalid', 'not-a-date'),
  ];
  assert.deepEqual(filterTimelineAroundEvent(events, window).map((event) => event.id), ['click', 'storage', 'response-500', 'error']);
  assert.equal(isFailureTimelineEvent(anchor), true);
  assert.equal(isFailureTimelineEvent(timelineEvent('warn', '2026-08-28T00:00:10.000Z', 'console-warn', { error: { message: 'warn' } })), false);
  assert.equal(isFailureTimelineEvent(timelineEvent('request', '2026-08-28T00:00:10.000Z', 'network-request', { requestId: 'network-1', method: 'POST', url: 'https://example.test/api/customer' })), false);
});

test('限定Exportは時間窓と重なるNetworkを完全なRequest情報として保持する', async () => {
  const { createFocusedEventWindow, filterActionsAroundEvent, filterErrorsAroundEvent, filterNetworkAroundEvent, filterRoutesAroundEvent, filterSelectedElementsAroundEvent, filterStorageAroundEvent } = await moduleAt('build/panel/focused-event-context.js');
  const anchor = timelineEvent('error-1', '2026-08-28T00:00:10.000Z', 'console-error', { error: { message: 'Customer detail failed' } });
  const window = createFocusedEventWindow(anchor, 2000, 1000);
  const network = [
    { id: 'starts-before-window', timestamp: '2026-08-28T00:00:07.500Z', durationMs: 700, method: 'GET', url: '/overlap', status: 500 },
    { id: 'inside', timestamp: '2026-08-28T00:00:09.000Z', durationMs: 50, method: 'POST', url: '/customer', status: 500 },
    { id: 'outside', timestamp: '2026-08-28T00:00:11.100Z', durationMs: 10, method: 'GET', url: '/outside', status: 200 },
  ];
  assert.deepEqual(filterNetworkAroundEvent(network, window).map((entry) => entry.id), ['starts-before-window', 'inside']);
  const timed = [
    { id: 'before', timestamp: '2026-08-28T00:00:07.999Z' },
    { id: 'inside', timestamp: '2026-08-28T00:00:09.500Z' },
    { id: 'after', timestamp: '2026-08-28T00:00:11.001Z' },
  ];
  assert.deepEqual(filterErrorsAroundEvent(timed, window).map((entry) => entry.id), ['inside']);
  assert.deepEqual(filterStorageAroundEvent(timed, window).map((entry) => entry.id), ['inside']);
  assert.deepEqual(filterActionsAroundEvent(timed, window).map((entry) => entry.id), ['inside']);
  assert.deepEqual(filterRoutesAroundEvent(timed, window).map((entry) => entry.id), ['inside']);
  assert.deepEqual(filterSelectedElementsAroundEvent(timed, window).map((entry) => entry.id), ['inside']);
});

test('失敗イベントでない選択と解釈不能な時刻は限定Exportの起点にしない', async () => {
  const { createFocusedEventWindow } = await moduleAt('build/panel/focused-event-context.js');
  const action = timelineEvent('click', '2026-08-28T00:00:10.000Z');
  const invalidFailure = timelineEvent('error', 'not-a-date', 'console-error', { error: { message: 'failed' } });
  assert.equal(createFocusedEventWindow(action), undefined);
  assert.equal(createFocusedEventWindow(invalidFailure), undefined);
});

test('Timeline contextは任意イベントを中心にし、Importantは失敗直前の操作を残す', async () => {
  const { createEventContextWindow, filterTimelineAroundEvent, isImportantTimelineEvent } = await moduleAt('build/panel/focused-event-context.js');
  const click = timelineEvent('click', '2026-08-28T00:00:08.700Z', 'user-action', { actionType: 'click', target: { selector: 'button.detail' } });
  const storage = timelineEvent('storage', '2026-08-28T00:00:09.000Z', 'storage', { storage: {} });
  const failure = timelineEvent('failure', '2026-08-28T00:00:10.000Z', 'network-response', { requestId: 'n', method: 'GET', url: '/api', status: 500, durationMs: 1 });
  const normal = timelineEvent('normal', '2026-08-28T00:00:12.500Z');
  const timeline = [click, storage, failure, normal];
  const window = createEventContextWindow(click, 0, 2000);
  assert.deepEqual(filterTimelineAroundEvent(timeline, window).map((event) => event.id), ['click', 'storage', 'failure']);
  assert.equal(isImportantTimelineEvent(click, timeline), true);
  assert.equal(isImportantTimelineEvent(storage, timeline), true);
  assert.equal(isImportantTimelineEvent(failure, timeline), true);
  assert.equal(isImportantTimelineEvent(normal, timeline), false);
});
