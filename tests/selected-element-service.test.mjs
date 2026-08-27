import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '..');

test('SelectedElementServiceはDevTools選択要素$0だけを最小スナップショットとして収集する', async () => {
  const calls = [];
  const expected = {
    id: 'selected-element-1', timestamp: '2026-08-28T10:21:01.000Z',
    summary: { tagName: 'BUTTON', selector: 'button#customer-detail', id: 'customer-detail', text: '詳細', dataTestId: 'submit-button' },
    textContent: '詳細', attributes: { id: 'customer-detail', 'data-testid': 'submit-button' }, dataset: { testid: 'submit-button' },
    disabled: false, hidden: false, aria: {}, boundingClientRect: { x: 10, y: 20, width: 100, height: 32, top: 20, right: 110, bottom: 52, left: 10 },
    computedStyle: { display: 'block', visibility: 'visible', opacity: '1', position: 'static', zIndex: 'auto', width: '100px', height: '32px', pointerEvents: 'auto', overflow: 'visible' },
  };
  const evaluator = { evaluate: async (expression) => { calls.push(expression); return { ok: true, data: expected }; } };
  const { SelectedElementService } = await import(`${pathToFileURL(resolve(root, 'build/panel/selected-element-service.js')).href}?test=${Date.now()}`);
  const result = await new SelectedElementService(evaluator).captureSelected();
  assert.deepEqual(result, { ok: true, data: expected });
  assert.match(calls[0], /typeof \$0/);
  assert.match(calls[0], /getBoundingClientRect/);
  assert.match(calls[0], /pointerEvents/);
  assert.doesNotMatch(calls[0], /document\.documentElement\.outerHTML/);
  assert.doesNotMatch(calls[0], /outerHTML/);
});
