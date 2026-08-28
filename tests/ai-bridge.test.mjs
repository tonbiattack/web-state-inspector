import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '..');
async function handler() { return import(`${pathToFileURL(resolve(root, 'build/bridge/bridge-handler.js')).href}?test=${Date.now()}-${Math.random()}`); }
const event = (kind, id) => kind === 'network-response' ? { id, timestamp: '2026-08-28T00:00:00.000Z', performanceMs: 1, kind, requestId: id, method: 'GET', url: 'https://example.test/api', status: 500, durationMs: 3, summary: '500 GET /api' } : kind === 'user-action' ? { id, timestamp: '2026-08-28T00:00:00.000Z', performanceMs: 1, kind, actionType: 'click', target: { tagName: 'BUTTON', selector: 'button' }, summary: 'CLICK button' } : { id, timestamp: '2026-08-28T00:00:00.000Z', performanceMs: 1, kind, error: { id: 'e', timestamp: '2026-08-28T00:00:00.000Z', performanceMs: 1, kind: 'console-error', message: 'boom', stack: [], duplicateCount: 1 }, summary: 'boom' };
function source(active = true) { const timeline = [event('user-action', 'action'), event('network-response', 'network'), event('console-error', 'error')]; return { getStatus: () => ({ active, startedAt: '2026-08-28T00:00:00.000Z', eventCount: 3, networkCount: 2, errorCount: 2, userActionCount: 1, routeChangeCount: 1 }), getUrl: () => 'https://example.test/customer/123', getErrors: () => [timeline[2], timeline[2], timeline[2]].map((item, index) => ({ ...item.error, id: `e${index}` })), getNetwork: () => [{ id: 'n1', timestamp: '2026-08-28T00:00:00.000Z', performanceMs: 1, method: 'GET', url: 'https://example.test/api', status: 500, statusText: 'Error', durationMs: 3, requestHeaders: [], requestBody: { available: false }, responseHeaders: [], responseBody: { available: true, text: 'bad' } }, { id: 'n2', timestamp: '2026-08-28T00:00:00.000Z', performanceMs: 1, method: 'GET', url: 'https://example.test/ok', status: 200, statusText: 'OK', durationMs: 3, requestHeaders: [], requestBody: { available: false }, responseHeaders: [], responseBody: { available: true, text: 'ok' } }], getTimeline: () => timeline, getStorageChanges: async () => [{ id: 1 }], getSnapshotCount: () => 2 }; }
const request = (method, params) => ({ source: 'web-state-inspector-page', type: 'request', requestId: 'request-1', method, params });

test('AI bridge summary, limits, filters, and invalid methods are handled without page state', async () => {
  const { handleBridgeRequest } = await handler(); const state = source();
  const summary = await handleBridgeRequest(request('getSummary'), state); assert.equal(summary.data.networkErrors, 1); assert.equal(summary.data.storageChanges, 1); assert.equal(summary.data.firstNetworkError.kind, 'network-response'); assert.equal(summary.data.firstJavaScriptError.kind, 'console-error'); assert.equal(summary.data.firstSuspiciousEvent.kind, 'network-response');
  const errors = await handleBridgeRequest(request('getErrors', { limit: 2 }), state); assert.equal(errors.data.length, 2);
  const network = await handleBridgeRequest(request('getNetworkErrors', { limit: 20 }), state); assert.equal(network.data.length, 1); assert.equal(network.data[0].status, 500);
  const timeline = await handleBridgeRequest(request('getTimeline', { limit: 1, eventTypes: ['network'] }), state); assert.equal(timeline.data.length, 1); assert.equal(timeline.data[0].kind, 'network-response');
  const invalid = await handleBridgeRequest(request('nope'), state); assert.equal(invalid.error.code, 'UNKNOWN_METHOD');
  const badFilter = await handleBridgeRequest(request('getTimeline', { eventTypes: ['nope'] }), state); assert.equal(badFilter.error.code, 'INVALID_REQUEST');
  const stopped = await handleBridgeRequest(request('getSummary'), source(false)); assert.equal(stopped.error.code, 'NOT_RECORDING'); assert.match(stopped.error.message, /start recording/i);
});
