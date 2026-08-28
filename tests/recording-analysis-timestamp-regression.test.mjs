import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '..');

async function moduleAt(relativePath) {
  return import(`${pathToFileURL(resolve(root, relativePath)).href}?test=${Date.now()}-${Math.random()}`);
}

function event(id, timestamp, kind = 'network-response') {
  return {
    id,
    timestamp,
    performanceMs: 0,
    kind,
    summary: `${kind}:${id}`,
    requestId: id,
    method: 'GET',
    url: 'https://example.test/api',
    status: 500,
    durationMs: 1,
  };
}

test('不審イベントの発散時刻判定は異なるタイムゾーン表記でも実時刻で比較する', async () => {
  const { findSuspiciousEvents } = await moduleAt('build/panel/recording-analysis.js');
  const afterDivergence = event('after-divergence', '2026-08-27T15:00:11.000Z');
  afterDivergence.status = 200;
  const divergence = {
    timestamp: '2026-08-28T00:00:10.000+09:00',
    category: 'event',
    key: 'network-response[0]',
    normal: '200',
    broken: '500',
  };

  const suspicious = findSuspiciousEvents({
    id: 'broken',
    createdAt: '2026-08-27T15:00:00.000Z',
    timeline: [afterDivergence],
    network: [],
    storageChanges: [],
  }, divergence);

  assert.deepEqual(suspicious.map(({ reason, event: found }) => ({ reason, id: found.id })), [
    { reason: 'First difference from normal recording', id: 'after-divergence' },
  ]);
});
