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
  const result = await service.capture();
  assert.equal(result.ok, true);
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
  const before = { ...base, id: 'before', timestamp: '2026-08-27T10:21:00.000Z', localStorage: [{ key: 'selectedCustomerId', value: '100', isJson: false }] };
  const after = { ...base, id: 'after', timestamp: '2026-08-27T10:21:02.000Z', localStorage: [{ key: 'selectedCustomerId', value: '123', isJson: false }], pinia: { detected: true, message: 'bridge', data: { selectedCustomer: { id: 123 } } } };
  const diff = diffSnapshots(before, after);
  assert.ok(diff.entries.some((entry) => entry.path === 'localStorage.selectedCustomerId' && entry.kind === 'changed'));
  assert.ok(diff.entries.some((entry) => entry.path === 'pinia.selectedCustomer.id' && entry.kind === 'changed'));
  const context = createAiDebugContext({ before, after, diff, network: [{ id: 'network-1', timestamp: '2026-08-27T10:21:01.244Z', performanceMs: 2, method: 'GET', url: 'https://example.test/api/contracts/123', status: 500, statusText: 'Internal Server Error', durationMs: 61, requestHeaders: [], requestBody: { available: false, reason: 'Unavailable' }, responseHeaders: [], responseBody: { available: true, text: '{"code":"INTERNAL_ERROR"}' } }], errors: [{ id: 'error-1', timestamp: '2026-08-27T10:21:01.315Z', performanceMs: 3, kind: 'javascript-error', message: 'TypeError', stack: ['CustomerDetail.vue:142'], duplicateCount: 1 }], storageChanges: [{ id: 1, timestamp: '2026-08-27T10:21:01.120Z', performanceMs: 1, storageArea: 'localStorage', operation: 'setItem', key: 'selectedCustomerId', oldValue: '100', newValue: '123', stack: ['CustomerDetail.vue:142'], outcome: 'changed' }], timeline: [], session: { active: false, eventCount: 3, networkCount: 1, errorCount: 1 } });
  const markdown = formatAiContextMarkdown(context);
  assert.match(markdown, /# Web Debug Context/);
  assert.match(markdown, /Network Errors/);
  assert.match(markdown, /500/);
  assert.match(markdown, /selectedCustomerId/);
  assert.match(markdown, /Review this exported context for secrets/);
  const json = formatAiContextJson(context);
  assert.equal(JSON.parse(json).snapshots.diff.entries.length, diff.entries.length);
});
