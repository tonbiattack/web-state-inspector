import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '..');

test('Copy event context は選択イベント、関連イベント、要約だけを短く出力する', async () => {
  const { createAiDebugContext, formatEventContextMarkdown } = await import(`${pathToFileURL(resolve(root, 'build/panel/ai-export.js')).href}?test=${Date.now()}`);
  const request = { id: 'request', timestamp: '2026-08-29T14:00:00.000Z', performanceMs: 1, kind: 'network-request', requestId: 'network', method: 'GET', url: 'https://example.test/api/workflow/log?customer=1', summary: 'GET workflow log' };
  const response = { id: 'response', timestamp: '2026-08-29T14:00:00.110Z', performanceMs: 111, kind: 'network-response', requestId: 'network', method: 'GET', url: 'https://example.test/api/workflow/log?customer=1', status: 200, durationMs: 110.4159999958938, summary: '200 workflow log' };
  const unchangedRoute = { id: 'route', timestamp: '2026-08-29T14:00:00.050Z', performanceMs: 50, kind: 'route-change', routeType: 'replaceState', from: 'https://example.test/search', to: 'https://example.test/search', summary: 'replaceState route' };
  const context = createAiDebugContext({ network: [], errors: [], storageChanges: [], timeline: [request, unchangedRoute, response], session: { active: true, eventCount: 3, networkCount: 1, errorCount: 0, userActionCount: 0, routeChangeCount: 1 }, userActions: [], routeChanges: [unchangedRoute], eventContext: { anchor: response, beforeMs: 5000, afterMs: 2000, startTimestamp: '2026-08-29T13:59:55.110Z', endTimestamp: '2026-08-29T14:00:02.110Z' } });
  const markdown = formatEventContextMarkdown(context);
  assert.match(markdown, /^# Web Event Context\n\n## Selected Event/m);
  assert.match(markdown, /RESPONSE 200 GET \/api\/workflow\/log\?customer=1 \(110 ms\)/);
  assert.match(markdown, /## Relevant Events/);
  assert.match(markdown, /## Summary/);
  assert.doesNotMatch(markdown, /replaceState/);
  assert.doesNotMatch(markdown, /Current State|Request headers|Response body/);
});
