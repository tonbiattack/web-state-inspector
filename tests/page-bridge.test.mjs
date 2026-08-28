import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '..');
async function moduleAt() { return import(`${pathToFileURL(resolve(root, 'build/bridge/page-bridge.js')).href}?test=${Date.now()}-${Math.random()}`); }

function fakeWindow() {
  const listeners = new Set(); const sent = [];
  const target = { crypto: { randomUUID: (() => { let id = 0; return () => `request-${++id}`; })() }, location: { origin: 'https://example.test' }, setTimeout, clearTimeout,
    addEventListener: (_type, listener) => listeners.add(listener), removeEventListener: (_type, listener) => listeners.delete(listener), postMessage: (message) => sent.push(message), emit: (data) => { for (const listener of listeners) listener({ source: target, data }); } };
  return { target, sent, listeners };
}

test('page bridge pairs responses by request ID, preserves an existing diagnostic bridge, and cleans listeners', async () => {
  const originalWindow = globalThis.window; globalThis.window = fakeWindow().target;
  try {
    const { installPageBridge } = await moduleAt(); const { target, sent, listeners } = fakeWindow();
    target.__WEB_STATE_INSPECTOR__ = { getPinia: () => ({ existing: true }) };
    installPageBridge(target, 50);
    const pending = target.__WEB_STATE_INSPECTOR__.getSummary();
    assert.equal(sent[0].requestId, 'request-1');
    target.emit({ source: 'web-state-inspector-extension', type: 'response', requestId: 'wrong-id', success: true, data: { ignored: true } });
    assert.equal(listeners.size, 1);
    target.emit({ source: 'web-state-inspector-extension', type: 'response', requestId: 'request-1', success: true, data: { recording: true } });
    assert.deepEqual(await pending, { recording: true }); assert.equal(listeners.size, 0); assert.equal(typeof target.__WEB_STATE_INSPECTOR__.getPinia, 'function');
  } finally { globalThis.window = originalWindow; }
});

test('page bridge rejects a request that receives no extension response', async () => {
  const originalWindow = globalThis.window; globalThis.window = fakeWindow().target;
  try {
    const { installPageBridge } = await moduleAt(); const { target, listeners } = fakeWindow(); installPageBridge(target, 5);
    await assert.rejects(target.__WEB_STATE_INSPECTOR__.getErrors(), (error) => error.code === 'WEB_STATE_INSPECTOR_TIMEOUT');
    assert.equal(listeners.size, 0);
  } finally { globalThis.window = originalWindow; }
});
