import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '..');
const moduleAt = () => import(`${pathToFileURL(resolve(root, 'build/panel/recording-analysis.js')).href}?test=${Date.now()}`);
const base = (name, overrides = {}) => ({ id: name, name, createdAt: '2026-08-28T12:00:00.000Z', session: { active: false, eventCount: 0, networkCount: 0, errorCount: 0, userActionCount: 0, routeChangeCount: 0 }, timeline: [], network: [], errors: [], storageChanges: [], userActions: [], routeChanges: [], snapshots: [], selectedElements: [], ...overrides });
const network = (status, body, timestamp = '2026-08-28T12:00:01.000Z') => ({ id: `network-${status}`, timestamp, performanceMs: 1, method: 'GET', url: 'https://example.test/api/customer/123?view=full', status, statusText: status === 200 ? 'OK' : 'Internal Server Error', durationMs: 30, requestHeaders: [{ name: 'authorization', value: status === 200 ? 'Bearer normal' : 'Bearer broken' }], requestBody: { available: false }, responseHeaders: [{ name: 'content-type', value: 'application/json' }], responseBody: { available: true, text: body } });

test('Recording comparison finds the first storage divergence and JSON/header/network differences', async () => {
  const { compareRecordings } = await moduleAt();
  const normal = base('Normal', { storageChanges: [{ id: 1, timestamp: '2026-08-28T12:00:01.000Z', performanceMs: 1, storageArea: 'sessionStorage', operation: 'setItem', key: 'customerId', oldValue: null, newValue: '123', stack: [], outcome: 'changed' }], network: [network(200, '{"customerId":"123"}')], timeline: [{ id: 'click-normal', timestamp: '2026-08-28T12:00:00.900Z', performanceMs: 1, kind: 'user-action', actionType: 'click', target: { tagName: 'BUTTON', selector: 'button.detail' }, summary: 'CLICK button.detail' }, { id: 'request', timestamp: '2026-08-28T12:00:01.000Z', performanceMs: 1, kind: 'network-response', requestId: 'a', method: 'GET', url: 'https://example.test/api/customer/123', status: 200, durationMs: 30, summary: '200 GET customer' }] });
  const broken = base('Broken', { storageChanges: [{ id: 1, timestamp: '2026-08-28T12:00:01.000Z', performanceMs: 1, storageArea: 'sessionStorage', operation: 'setItem', key: 'customerId', oldValue: null, newValue: null, stack: [], outcome: 'changed' }], network: [network(500, '{"customerId":null}')], timeline: [{ id: 'click', timestamp: '2026-08-28T12:00:00.900Z', performanceMs: 1, kind: 'user-action', actionType: 'click', target: { tagName: 'BUTTON', selector: 'button.detail' }, summary: 'CLICK button.detail' }, { id: 'response', timestamp: '2026-08-28T12:00:01.000Z', performanceMs: 2, kind: 'network-response', requestId: 'b', method: 'GET', url: 'https://example.test/api/customer/123', status: 500, durationMs: 30, summary: '500 GET customer' }, { id: 'error', timestamp: '2026-08-28T12:00:01.010Z', performanceMs: 3, kind: 'console-error', error: { id: 'e', timestamp: '2026-08-28T12:00:01.010Z', performanceMs: 3, kind: 'console-error', message: 'Failed', stack: [], duplicateCount: 1 }, summary: 'Failed' }] });
  const result = compareRecordings(normal, broken);
  assert.equal(result.firstDivergence.key, 'sessionStorage.customerId');
  assert.equal(result.firstDivergence.broken, null);
  assert.ok(result.networkDifferences[0].differences.some((item) => item.path === 'status'));
  assert.ok(result.networkDifferences[0].differences.some((item) => item.path === 'responseBody.customerId'));
  assert.equal(result.eventChains.length, 1);
  assert.ok(result.suspiciousEvents.some((item) => item.reason === 'First HTTP 5xx'));
  assert.ok(result.suspiciousEvents.some((item) => item.reason === 'First JavaScript or console error'));
});
