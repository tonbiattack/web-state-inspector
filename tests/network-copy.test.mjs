import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '..');
const moduleAt = () => import(`${pathToFileURL(resolve(root, 'build/panel/network-copy.js')).href}?test=${Date.now()}-${Math.random()}`);

const entry = {
  id: 'request-1', timestamp: '2026-08-29T05:00:00.000Z', performanceMs: 1,
  method: 'POST', url: 'https://example.test/api/orders', status: 201, statusText: 'Created', durationMs: 42,
  resourceType: 'fetch', requestHeaders: [{ name: 'authorization', value: 'Bearer raw-token' }],
  requestBody: { available: true, text: '{"sku":"book"}' },
  responseHeaders: [{ name: 'set-cookie', value: 'session=raw-value' }],
  responseBody: { available: true, text: '{"id":"order-1","secret":"raw-response"}' },
};

test('Network copy retains the full recorded exchange without masking', async () => {
  const { formatNetworkExchange, networkBodyText } = await moduleAt();
  const output = formatNetworkExchange(entry);

  assert.match(output, /POST https:\/\/example\.test\/api\/orders/);
  assert.match(output, /Bearer raw-token/);
  assert.match(output, /session=raw-value/);
  assert.match(output, /raw-response/);
  assert.equal(networkBodyText({ available: false, reason: 'HAR omitted it.' }), 'Not available: HAR omitted it.');
});
