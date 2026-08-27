import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '..');

async function moduleAt(relativePath) {
  return import(`${pathToFileURL(resolve(root, relativePath)).href}?test=${Date.now()}-${Math.random()}`);
}

function installNetworkApi() {
  const listeners = new Set();
  const originalChrome = globalThis.chrome;
  globalThis.chrome = {
    devtools: {
      network: {
        onRequestFinished: {
          addListener(listener) { listeners.add(listener); },
          removeListener(listener) { listeners.delete(listener); },
        },
      },
    },
  };
  return { listeners, restore: () => { globalThis.chrome = originalChrome; } };
}

function request({ status = 200, type = 'fetch', body = '{"ok":true}', url = 'https://example.test/api/customers/123' } = {}) {
  return {
    startedDateTime: '2026-08-27T10:21:01.180Z',
    time: 64,
    _resourceType: type,
    request: {
      method: 'POST',
      url,
      headers: [{ name: 'content-type', value: 'application/json' }],
      postData: { text: '{"customerId":123}' },
    },
    response: {
      status,
      statusText: status >= 400 ? 'Internal Server Error' : 'OK',
      headers: [{ name: 'content-type', value: 'application/json' }],
    },
    getContent(callback) { callback(body); },
  };
}

test('NetworkCollectorはHARを正規化し、Request/Responseの統合Timelineイベントを生成する', async () => {
  const { NetworkCollector } = await moduleAt('build/panel/network-collector.js');
  const api = installNetworkApi();
  const received = [];
  try {
    const collector = new NetworkCollector((entry, events) => received.push({ entry, events }), () => 1234);
    collector.start();
    for (const listener of api.listeners) listener(request({ status: 500 }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(collector.getEntries().length, 1);
    const entry = collector.getEntries()[0];
    assert.equal(entry.method, 'POST');
    assert.equal(entry.status, 500);
    assert.equal(entry.durationMs, 64);
    assert.deepEqual(entry.requestHeaders, [{ name: 'content-type', value: 'application/json' }]);
    assert.equal(entry.responseBody.available, true);
    assert.equal(entry.responseBody.text, '{"ok":true}');
    assert.equal(received[0].events[0].kind, 'network-request');
    assert.equal(received[0].events[1].kind, 'network-response');
    assert.equal(received[0].events[1].status, 500);
    collector.stop();
    assert.equal(api.listeners.size, 0);
  } finally {
    api.restore();
  }
});

test('Networkフィルタとresponse body上限が意図どおり動作する', async () => {
  const { NetworkCollector, matchesNetworkFilter, MAX_NETWORK_ENTRIES, MAX_RESPONSE_BODY_BYTES } = await moduleAt('build/panel/network-collector.js');
  const api = installNetworkApi();
  try {
    const collector = new NetworkCollector(() => {});
    collector.start();
    for (const listener of api.listeners) listener(request({ status: 500, body: 'x'.repeat(MAX_RESPONSE_BODY_BYTES + 10), type: 'xhr' }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const entry = collector.getEntries()[0];
    assert.equal(entry.responseBody.truncated, true);
    assert.match(entry.responseBody.text, /\[truncated\]$/);
    assert.equal(matchesNetworkFilter(entry, 'all'), true);
    assert.equal(matchesNetworkFilter(entry, 'fetch-xhr'), true);
    assert.equal(matchesNetworkFilter(entry, 'error-only'), true);
    assert.equal(matchesNetworkFilter(entry, 'http-error'), true);
    assert.equal(matchesNetworkFilter({ ...entry, status: 200, error: undefined, resourceType: 'document' }, 'fetch-xhr'), false);
    for (let index = 0; index < MAX_NETWORK_ENTRIES + 3; index += 1) {
      for (const listener of api.listeners) listener(request({ url: `https://example.test/api/${index}` }));
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(collector.getEntries().length, MAX_NETWORK_ENTRIES, 'Network記録は固定長リングバッファに制限する');
    assert.match(collector.getEntries()[0].url, /api\/3$/);
    collector.stop();
  } finally {
    api.restore();
  }
});

test('DebugSessionはStorage・Error・Networkを同じTimelineへ集約し、上限まで保持する', async () => {
  const { DebugSession, MAX_TIMELINE_EVENTS } = await moduleAt('build/panel/debug-session.js');
  const api = installNetworkApi();
  const originalWindow = globalThis.window;
  globalThis.window = { setInterval: () => 1, clearInterval: () => {} };
  let storageEvents = [{ id: 1, timestamp: '2026-08-27T10:21:01.120Z', performanceMs: 1, storageArea: 'localStorage', operation: 'setItem', key: 'selectedCustomerId', oldValue: '100', newValue: '123', stack: ['CustomerDetail.vue:142'], outcome: 'changed' }];
  const storageTracker = {
    clear: async () => ({ ok: true, data: {} }),
    start: async () => ({ ok: true, data: {} }),
    stop: async () => ({ ok: true, data: {} }),
    getSnapshot: async () => ({ ok: true, data: { events: storageEvents } }),
  };
  const errors = [{ id: 'error-1', timestamp: '2026-08-27T10:21:01.315Z', performanceMs: 3, kind: 'javascript-error', message: 'TypeError: undefined', stack: ['CustomerDetail.vue:142'], duplicateCount: 1 }];
  const errorCollector = {
    clear: async () => ({ ok: true, data: {} }),
    start: async () => ({ ok: true, data: {} }),
    stop: async () => ({ ok: true, data: {} }),
    getErrors: async () => ({ ok: true, data: errors }),
  };
  try {
    const session = new DebugSession(storageTracker, errorCollector, () => 2);
    assert.equal((await session.start()).ok, true);
    for (const listener of api.listeners) listener(request({ status: 500 }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await session.refresh();
    const kinds = session.getTimeline().map((event) => event.kind);
    assert.ok(kinds.includes('storage'));
    assert.ok(kinds.includes('javascript-error'));
    assert.ok(kinds.includes('network-request'));
    assert.ok(kinds.includes('network-response'));

    storageEvents = Array.from({ length: MAX_TIMELINE_EVENTS + 10 }, (_, index) => ({ id: index + 2, timestamp: `2026-08-27T10:22:${String(index % 60).padStart(2, '0')}.000Z`, performanceMs: index + 10, storageArea: 'localStorage', operation: 'setItem', key: `key-${index}`, oldValue: null, newValue: String(index), stack: [], outcome: 'changed' }));
    await session.refresh();
    assert.ok(session.getTimeline().length <= MAX_TIMELINE_EVENTS);
    await session.stop();
  } finally {
    globalThis.window = originalWindow;
    api.restore();
  }
});

test('SnapshotServiceはページ・環境・Storage・Cookie・メタデータ・明示的Framework Stateを収集する', async () => {
  const { SnapshotService } = await moduleAt('build/panel/snapshot-service.js');
  const evaluator = {
    getPageDetails: async () => ({ ok: true, data: { page: { url: 'https://example.test/customers/123', origin: 'https://example.test', title: 'Customer Detail' }, environment: { userAgent: 'Test Browser', viewport: { width: 1920, height: 1080, devicePixelRatio: 1 }, readyState: 'complete' } } }),
    getStorage: async (kind) => ({ ok: true, data: [{ key: `${kind}-key`, value: 'value', isJson: false }] }),
    getIndexedDatabases: async () => ({ ok: true, data: [{ name: 'app', stores: [] }] }),
    getCacheNames: async () => ({ ok: true, data: ['assets'] }),
    getCacheEntries: async () => ({ ok: true, data: { name: 'assets', totalEntries: 4, truncated: true } }),
    getFrameworkState: async (kind) => ({ ok: true, data: { detected: kind === 'pinia', message: 'bridge', data: kind === 'pinia' ? { selectedCustomerId: 123 } : undefined } }),
  };
  const service = new SnapshotService(evaluator, async () => ({ ok: true, data: [{ name: 'sid', value: 'secret', domain: 'example.test', path: '/', expires: 'Session', secure: true, httpOnly: true, sameSite: 'lax' }] }));
  const result = await service.capture('before customer select');
  assert.equal(result.ok, true);
  assert.equal(result.data.label, 'before customer select');
  assert.equal(result.data.page.title, 'Customer Detail');
  assert.equal(result.data.environment.viewport.width, 1920);
  assert.equal(result.data.localStorage[0].key, 'localStorage-key');
  assert.equal(result.data.cookies[0].name, 'sid');
  assert.equal(result.data.cacheStorage[0].totalEntries, 4);
  assert.equal(result.data.pinia.detected, true);
  assert.equal(result.data.tanstackQuery.detected, false);
});

test('Snapshot diffとAI向けMarkdown / JSONは差分と優先情報を構造化する', async () => {
  const { diffSnapshots } = await moduleAt('build/panel/snapshot-service.js');
  const { createAiDebugContext, formatAiContextJson, formatAiContextMarkdown } = await moduleAt('build/panel/ai-export.js');
  const base = {
    page: { url: 'https://example.test/customers/100', origin: 'https://example.test', title: 'Customer Detail' },
    environment: { userAgent: 'Test Browser', viewport: { width: 1280, height: 720, devicePixelRatio: 1 }, readyState: 'complete' },
    sessionStorage: [], cookies: [], indexedDb: [], cacheStorage: [],
    pinia: { detected: true, message: 'bridge', data: { selectedCustomer: { id: 100 } } },
    tanstackQuery: { detected: false, message: 'Not detected' },
  };
  const before = { ...base, id: 'before', label: 'before customer select', timestamp: '2026-08-27T10:21:00.000Z', localStorage: [{ key: 'selectedCustomerId', value: '100', isJson: false }] };
  const after = { ...base, id: 'after', label: 'after error', timestamp: '2026-08-27T10:21:02.000Z', localStorage: [{ key: 'selectedCustomerId', value: '123', isJson: false }], pinia: { detected: true, message: 'bridge', data: { selectedCustomer: { id: 123 } } } };
  const diff = diffSnapshots(before, after);
  assert.ok(diff.entries.some((entry) => entry.path === 'localStorage.selectedCustomerId' && entry.kind === 'changed'));
  assert.ok(diff.entries.some((entry) => entry.path === 'pinia.selectedCustomer.id' && entry.kind === 'changed'));
  const context = createAiDebugContext({ before, after, diff, network: [{ id: 'network-1', timestamp: '2026-08-27T10:21:01.244Z', performanceMs: 2, method: 'GET', url: 'https://example.test/api/contracts/123', status: 500, statusText: 'Internal Server Error', durationMs: 61, requestHeaders: [], requestBody: { available: false, reason: 'Unavailable' }, responseHeaders: [], responseBody: { available: true, text: '{"code":"INTERNAL_ERROR"}' } }], errors: [{ id: 'error-1', timestamp: '2026-08-27T10:21:01.315Z', performanceMs: 3, kind: 'javascript-error', message: 'TypeError', stack: ['CustomerDetail.vue:142'], duplicateCount: 1 }], storageChanges: [{ id: 1, timestamp: '2026-08-27T10:21:01.120Z', performanceMs: 1, storageArea: 'localStorage', operation: 'setItem', key: 'selectedCustomerId', oldValue: '100', newValue: '123', stack: ['CustomerDetail.vue:142'], outcome: 'changed' }], timeline: [
    { id: 'action-1', timestamp: '2026-08-27T10:21:01.100Z', performanceMs: 10000, kind: 'user-action', actionType: 'click', summary: 'CLICK button#customer-detail', target: { tagName: 'BUTTON', selector: 'button#customer-detail', text: '詳細' } },
    { id: 'route-1', timestamp: '2026-08-27T10:21:01.150Z', performanceMs: 0.8, kind: 'route-change', routeType: 'pushState', from: 'https://example.test/customers', to: 'https://example.test/customers/123', summary: 'pushState route' },
  ], userActions: [{ id: 'action-1', timestamp: '2026-08-27T10:21:01.100Z', performanceMs: 10000, kind: 'user-action', actionType: 'click', summary: 'CLICK button#customer-detail', target: { tagName: 'BUTTON', selector: 'button#customer-detail', text: '詳細' } }], routeChanges: [{ id: 'route-1', timestamp: '2026-08-27T10:21:01.150Z', performanceMs: 0.8, kind: 'route-change', routeType: 'pushState', from: 'https://example.test/customers', to: 'https://example.test/customers/123', summary: 'pushState route' }], selectedElements: [{ id: 'selected-1', timestamp: '2026-08-27T10:21:01.100Z', summary: { tagName: 'BUTTON', selector: 'button#customer-detail', text: '詳細' }, textContent: '詳細', attributes: { id: 'customer-detail' }, dataset: {}, disabled: false, hidden: false, aria: {}, boundingClientRect: { x: 1, y: 2, width: 3, height: 4, top: 2, right: 4, bottom: 6, left: 1 }, computedStyle: { display: 'block' } }], reproductionNotes: { expectedResult: '契約情報画面へ遷移する', actualResult: '不正な遷移エラーになる', reproductionSteps: '1. 顧客検索\n2. 詳細を押す', additionalNotes: '再試行すると成功する' }, session: { active: false, eventCount: 5, networkCount: 1, errorCount: 1, userActionCount: 1, routeChangeCount: 1 } });
  const markdown = formatAiContextMarkdown(context);
  assert.match(markdown, /# Web Debug Context/);
  assert.match(markdown, /## Reproduction Notes/);
  assert.match(markdown, /Expected Result/);
  assert.match(markdown, /契約情報画面へ遷移する/);
  assert.match(markdown, /User Actions/);
  assert.match(markdown, /button#customer-detail/);
  assert.match(markdown, /Route Changes/);
  assert.match(markdown, /Network Errors/);
  assert.match(markdown, /500/);
  assert.match(markdown, /selectedCustomerId/);
  assert.match(markdown, /before customer select vs after error/);
  assert.match(markdown, /Selected DOM Snapshots/);
  assert.match(markdown, /## Current State/);
  assert.match(markdown, /Review this exported context for secrets/);
  assert.ok(markdown.indexOf('## Reproduction Notes') < markdown.indexOf('## JavaScript and Console Events'));
  assert.ok(markdown.indexOf('## JavaScript and Console Events') < markdown.indexOf('## Network Errors'));
  assert.ok(markdown.indexOf('## Network Errors') < markdown.indexOf('## User Actions'));
  assert.ok(markdown.indexOf('## User Actions') < markdown.indexOf('## Route Changes'));
  assert.ok(markdown.indexOf('## Route Changes') < markdown.indexOf('## Storage Changes'));
  assert.ok(markdown.indexOf('## Storage Changes') < markdown.indexOf('## Unified Timeline'));
  assert.ok(markdown.indexOf('## Unified Timeline') < markdown.indexOf('## Snapshot Diff'));
  assert.ok(markdown.indexOf('## Snapshot Diff') < markdown.indexOf('## Current State'));
  assert.ok(markdown.indexOf('possibly related to click button#customer-detail') >= 0);
  const json = formatAiContextJson(context);
  assert.equal(JSON.parse(json).snapshots.diff.entries.length, diff.entries.length);
});


test('DebugSessionはUser ActionとRoute Changeを他のDebugイベントと同一Timelineへ統合する', async () => {
  const { DebugSession } = await moduleAt('build/panel/debug-session.js');
  const api = installNetworkApi();
  const originalWindow = globalThis.window;
  globalThis.window = { setInterval: () => 1, clearInterval: () => {} };
  const storageTracker = { clear: async () => ({ ok: true }), start: async () => ({ ok: true }), stop: async () => ({ ok: true }), getSnapshot: async () => ({ ok: true, data: { events: [] } }) };
  const errorCollector = { clear: async () => ({ ok: true }), start: async () => ({ ok: true }), stop: async () => ({ ok: true }), getErrors: async () => ({ ok: true, data: [] }) };
  const interactions = {
    clear: async () => ({ ok: true }),
    start: async () => ({ ok: true }),
    stop: async () => ({ ok: true }),
    getSnapshot: async () => ({ ok: true, data: {
      actions: [{ id: 'action-1', timestamp: '2026-08-27T10:21:01.120Z', performanceMs: 10000, kind: 'user-action', actionType: 'click', summary: 'CLICK button#custom-id', target: { tagName: 'BUTTON', selector: 'button#custom-id', text: '詳細' } }],
      routes: [{ id: 'route-1', timestamp: '2026-08-27T10:21:01.150Z', performanceMs: 1, kind: 'route-change', routeType: 'pushState', from: 'https://example.test/customers', to: 'https://example.test/customers/123', summary: 'pushState route' }],
    } }),
  };
  try {
    const session = new DebugSession(storageTracker, errorCollector, () => 2, interactions);
    await session.start();
    await session.refresh();
    const timeline = session.getTimeline();
    assert.deepEqual(timeline.map((event) => event.kind), ['user-action', 'route-change']);
    assert.equal(timeline[0].timestamp, '2026-08-27T10:21:01.120Z', 'performance.nowの基準差ではなくISO timestampで時系列化する');
    assert.equal(session.getStatus().userActionCount, 1);
    assert.equal(session.getStatus().routeChangeCount, 1);
    assert.equal((await session.getUserActions())[0].target.selector, 'button#custom-id');
    assert.equal((await session.getRouteChanges())[0].to, 'https://example.test/customers/123');
    await session.stop();
  } finally {
    globalThis.window = originalWindow;
    api.restore();
  }
});


test('AI Exportは限定コンテキストの選択イベント・時間窓・件数を明示する', async () => {
  const { createAiDebugContext, formatAiContextJson, formatAiContextMarkdown } = await moduleAt('build/panel/ai-export.js');
  const anchor = {
    id: 'network-1-response', timestamp: '2026-08-28T00:00:10.080Z', performanceMs: 90, kind: 'network-response', requestId: 'network-1', method: 'POST', url: 'https://example.test/api/customer/123', status: 500, durationMs: 80, summary: '500 POST https://example.test/api/customer/123 (80 ms)',
  };
  const context = createAiDebugContext({
    generatedAt: '2026-08-28T00:01:00.000Z',
    network: [{ id: 'network-1', timestamp: '2026-08-28T00:00:10.000Z', performanceMs: 10, method: 'POST', url: 'https://example.test/api/customer/123', status: 500, statusText: 'Internal Server Error', durationMs: 80, requestHeaders: [], requestBody: { available: false }, responseHeaders: [], responseBody: { available: true, text: '{"code":"FAILED"}' } }],
    errors: [],
    storageChanges: [],
    timeline: [anchor],
    userActions: [],
    routeChanges: [],
    session: { active: false, eventCount: 1, networkCount: 1, errorCount: 0, userActionCount: 0, routeChangeCount: 0 },
    focusedEvent: { anchor, beforeMs: 5000, afterMs: 2000, startTimestamp: '2026-08-28T00:00:05.080Z', endTimestamp: '2026-08-28T00:00:12.080Z' },
  });
  const markdown = formatAiContextMarkdown(context);
  assert.match(markdown, /## Focused Failure Window/);
  assert.match(markdown, /Selected event: network-response/);
  assert.match(markdown, /5s before/);
  assert.match(markdown, /2s after/);
  assert.match(markdown, /Included: 1 timeline event\(s\), 0 error\(s\), 1 network request\(s\)/);
  assert.match(markdown, /Captured snapshot: Omitted from focused export/);
  assert.equal(JSON.parse(formatAiContextJson(context)).focusedEvent.anchor.id, 'network-1-response');
});
