/**
 * iframe support unit tests
 * Tests frame lifecycle events, frame tagging, AI export Frames section,
 * bridge handler frame-lifecycle mapping, and DebugSession.addExternalEvents.
 */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '..');
async function moduleAt(relativePath) {
  return import(`${pathToFileURL(resolve(root, relativePath)).href}?t=${Date.now()}-${Math.random()}`);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function mainFrameInfo() {
  return { frameId: 0, url: 'https://example.test/app', origin: 'https://example.test', isMainFrame: true };
}

function iframeInfo(url = 'https://pay.example.test/checkout') {
  return { frameId: 1, parentFrameId: 0, url, origin: new URL(url).origin, isMainFrame: false, isCrossOrigin: true };
}

function frameLifecycleEvent(kind = 'frame-added', frame = iframeInfo()) {
  return {
    id: `frame-${kind}-42-1-1000`,
    timestamp: '2026-08-29T00:00:00.000Z',
    performanceMs: 0,
    kind,
    frame,
    summary: `${kind}: ${frame.url}`,
    toUrl: frame.url,
  };
}

function installNetworkApi() {
  const originalChrome = globalThis.chrome;
  globalThis.chrome = { devtools: { network: { onRequestFinished: { addListener() {}, removeListener() {} } } } };
  return { restore: () => { globalThis.chrome = originalChrome; } };
}

// ── Bridge handler: eventType maps frame lifecycle kinds ──────────────────────

test('bridge-handler eventType maps frame-added/navigated/removed to frame-lifecycle', async () => {
  const { handleBridgeRequest } = await moduleAt('build/bridge/bridge-handler.js');

  const frameEvents = [
    { id: 'fa', timestamp: '2026-08-29T00:00:00.000Z', performanceMs: 0, kind: 'frame-added', frame: mainFrameInfo(), summary: 'frame-added: https://example.test' },
    { id: 'fn', timestamp: '2026-08-29T00:00:01.000Z', performanceMs: 0, kind: 'frame-navigated', frame: mainFrameInfo(), summary: 'frame-navigated: https://example.test/page2' },
    { id: 'fr', timestamp: '2026-08-29T00:00:02.000Z', performanceMs: 0, kind: 'frame-removed', frame: iframeInfo(), summary: 'frame-removed: https://pay.example.test/checkout' },
  ];

  const source = {
    getStatus: () => ({ active: true, startedAt: '2026-08-29T00:00:00.000Z', eventCount: 3, networkCount: 0, errorCount: 0, userActionCount: 0, routeChangeCount: 0 }),
    getUrl: () => 'https://example.test',
    getErrors: () => [],
    getNetwork: () => [],
    getTimeline: () => frameEvents,
    getStorageChanges: async () => [],
    getSnapshotCount: () => 0,
  };

  // getTimeline with frame-lifecycle filter should return all 3 frame events.
  const request = { source: 'web-state-inspector-page', type: 'request', requestId: 'r1', method: 'getTimeline', params: { eventTypes: ['frame-lifecycle'] } };
  const response = await handleBridgeRequest(request, source);
  assert.equal(response.success, true, 'Response should succeed');
  assert.equal(response.data.length, 3, 'All 3 frame lifecycle events should match the filter');
  assert.equal(response.data[0].kind, 'frame-added');
  assert.equal(response.data[1].kind, 'frame-navigated');
  assert.equal(response.data[2].kind, 'frame-removed');
});

test('bridge-handler rejects unknown eventType but accepts frame-lifecycle', async () => {
  const { handleBridgeRequest } = await moduleAt('build/bridge/bridge-handler.js');
  const source = {
    getStatus: () => ({ active: true, startedAt: '2026-08-29T00:00:00.000Z', eventCount: 0, networkCount: 0, errorCount: 0, userActionCount: 0, routeChangeCount: 0 }),
    getUrl: () => 'https://example.test',
    getErrors: () => [],
    getNetwork: () => [],
    getTimeline: () => [],
    getStorageChanges: async () => [],
    getSnapshotCount: () => 0,
  };
  // Valid
  const valid = await handleBridgeRequest({ source: 'web-state-inspector-page', type: 'request', requestId: 'r1', method: 'getTimeline', params: { eventTypes: ['frame-lifecycle'] } }, source);
  assert.equal(valid.success, true);
  // Invalid
  const invalid = await handleBridgeRequest({ source: 'web-state-inspector-page', type: 'request', requestId: 'r2', method: 'getTimeline', params: { eventTypes: ['not-a-type'] } }, source);
  assert.equal(invalid.success, false);
  assert.equal(invalid.error.code, 'INVALID_REQUEST');
});

// ── AI export: Frames section appears when frame events present ───────────────

test('AI export includes ## Frames section when timeline has frame events', async () => {
  const { createAiDebugContext, formatAiContextMarkdown } = await moduleAt('build/panel/ai-export.js');

  const frameEvent = frameLifecycleEvent('frame-added');
  const mainAction = {
    id: 'action-1', timestamp: '2026-08-29T00:00:00.500Z', performanceMs: 5,
    kind: 'user-action', actionType: 'click',
    target: { tagName: 'BUTTON', selector: 'button#pay' },
    summary: 'CLICK button#pay',
    frame: mainFrameInfo(),
  };

  const context = createAiDebugContext({
    network: [],
    errors: [],
    storageChanges: [],
    timeline: [frameEvent, mainAction],
    userActions: [],
    routeChanges: [],
    session: { active: false, eventCount: 2, networkCount: 0, errorCount: 0, userActionCount: 1, routeChangeCount: 0 },
  });

  const markdown = formatAiContextMarkdown(context);
  assert.match(markdown, /## Frames/, 'Should include ## Frames section');
  assert.match(markdown, /iframe.*pay\.example\.test/, 'Should list iframe URL');
  assert.match(markdown, /cross-origin/i, 'Should note cross-origin iframe');
  assert.match(markdown, /\[Main\]/, 'Main frame events should have [Main] label');
  assert.match(markdown, /\[iframe/, 'Iframe events should have [iframe ...] label');
});

test('AI export omits ## Frames section when no frame events exist', async () => {
  const { createAiDebugContext, formatAiContextMarkdown } = await moduleAt('build/panel/ai-export.js');
  const context = createAiDebugContext({
    network: [], errors: [], storageChanges: [], timeline: [],
    userActions: [], routeChanges: [],
    session: { active: false, eventCount: 0, networkCount: 0, errorCount: 0, userActionCount: 0, routeChangeCount: 0 },
  });
  const markdown = formatAiContextMarkdown(context);
  assert.doesNotMatch(markdown, /## Frames/, 'Should NOT include ## Frames section when no frame events');
});

// ── AI export: frame label prefix on timeline lines ──────────────────────────

test('AI export prefixes timeline lines with frame label', async () => {
  const { createAiDebugContext, formatAiContextMarkdown } = await moduleAt('build/panel/ai-export.js');

  const storageEvent = {
    id: 'storage-1', timestamp: '2026-08-29T00:00:01.000Z', performanceMs: 10,
    kind: 'storage', summary: 'localStorage.cart: null → {"id":1}',
    frame: iframeInfo('https://pay.example.test/cart'),
    storage: { id: 1, timestamp: '2026-08-29T00:00:01.000Z', performanceMs: 10, storageArea: 'localStorage', operation: 'setItem', key: 'cart', oldValue: null, newValue: '{"id":1}', stack: [], outcome: 'changed' },
  };

  const context = createAiDebugContext({
    network: [], errors: [], storageChanges: [storageEvent.storage],
    timeline: [storageEvent], userActions: [], routeChanges: [],
    session: { active: false, eventCount: 1, networkCount: 0, errorCount: 0, userActionCount: 0, routeChangeCount: 0 },
  });

  const markdown = formatAiContextMarkdown(context);
  // Timeline section should have frame-prefixed line
  assert.match(markdown, /\[iframe \/cart\].*STORAGE/s, 'Timeline line for iframe storage should include iframe label');
});

// ── DebugSession.addExternalEvents ──────────────────────────────────────────

test('DebugSession.addExternalEvents adds frame lifecycle events to timeline', async () => {
  const { DebugSession } = await moduleAt('build/panel/debug-session.js');
  const api = installNetworkApi();
  const originalWindow = globalThis.window;
  globalThis.window = { setInterval: () => 1, clearInterval: () => {} };

  const storageTracker = { clear: async () => ({ ok: true }), start: async () => ({ ok: true }), stop: async () => ({ ok: true }), getSnapshot: async () => ({ ok: true, data: { events: [] } }) };
  const errorCollector = { clear: async () => ({ ok: true }), start: async () => ({ ok: true }), stop: async () => ({ ok: true }), getErrors: async () => ({ ok: true, data: [] }) };

  try {
    const session = new DebugSession(storageTracker, errorCollector, () => 0);
    await session.start();

    const event = frameLifecycleEvent('frame-added');
    session.addExternalEvents([event]);

    const timeline = session.getTimeline();
    assert.equal(timeline.length, 1, 'Frame lifecycle event should be in timeline');
    assert.equal(timeline[0].kind, 'frame-added');
    assert.equal(timeline[0].frame.url, iframeInfo().url);
    await session.stop();
  } finally {
    globalThis.window = originalWindow;
    api.restore();
  }
});

test('DebugSession.addExternalEvents is a no-op when session is not active', async () => {
  const { DebugSession } = await moduleAt('build/panel/debug-session.js');
  const api = installNetworkApi();
  const originalWindow = globalThis.window;
  globalThis.window = { setInterval: () => 1, clearInterval: () => {} };

  const storageTracker = { clear: async () => ({ ok: true }), start: async () => ({ ok: true }), stop: async () => ({ ok: true }), getSnapshot: async () => ({ ok: true, data: { events: [] } }) };
  const errorCollector = { clear: async () => ({ ok: true }), start: async () => ({ ok: true }), stop: async () => ({ ok: true }), getErrors: async () => ({ ok: true, data: [] }) };

  try {
    const session = new DebugSession(storageTracker, errorCollector, () => 0);
    // Do NOT start the session
    session.addExternalEvents([frameLifecycleEvent()]);
    assert.equal(session.getTimeline().length, 0, 'Events should not be added when session is inactive');
  } finally {
    globalThis.window = originalWindow;
    api.restore();
  }
});

// ── FrameInfo on TimelineEventBase ────────────────────────────────────────────

test('TimelineEvent frame field is optional and does not break existing event creation', async () => {
  const { DebugSession } = await moduleAt('build/panel/debug-session.js');
  const api = installNetworkApi();
  const originalWindow = globalThis.window;
  globalThis.window = { setInterval: () => 1, clearInterval: () => {} };

  const storageEvent = {
    id: 1, timestamp: '2026-08-29T00:00:01.000Z', performanceMs: 1,
    storageArea: 'localStorage', operation: 'setItem', key: 'x', oldValue: null, newValue: '1',
    stack: [], outcome: 'changed',
  };
  const storageTracker = { clear: async () => ({ ok: true }), start: async () => ({ ok: true }), stop: async () => ({ ok: true }), getSnapshot: async () => ({ ok: true, data: { events: [storageEvent] } }) };
  const errorCollector = { clear: async () => ({ ok: true }), start: async () => ({ ok: true }), stop: async () => ({ ok: true }), getErrors: async () => ({ ok: true, data: [] }) };

  try {
    const session = new DebugSession(storageTracker, errorCollector, () => 0);
    await session.start();
    await session.refresh();
    const timeline = session.getTimeline();
    assert.equal(timeline.length, 1);
    assert.equal(timeline[0].kind, 'storage');
    // frame is optional — should be undefined for main-frame events (no explicit tagging yet)
    assert.equal(timeline[0].frame, undefined, 'Existing events without frame field should remain compatible');
    await session.stop();
  } finally {
    globalThis.window = originalWindow;
    api.restore();
  }
});
