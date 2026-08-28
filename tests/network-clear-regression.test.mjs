import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

let requestFinishedListener;
globalThis.chrome = {
  devtools: {
    network: {
      onRequestFinished: {
        addListener(listener) { requestFinishedListener = listener; },
        removeListener() {},
      },
    },
  },
};

const root = resolve(import.meta.dirname, '..');
const { NetworkCollector } = await import(`${pathToFileURL(resolve(root, 'build/panel/network-collector.js')).href}?repro=${Date.now()}`);
let resolveBody;
const body = new Promise((resolve) => { resolveBody = resolve; });
const emitted = [];
const collector = new NetworkCollector((entry, events) => emitted.push({ entry, events }));
collector.start();
requestFinishedListener({
  startedDateTime: '2026-08-28T00:00:00.000Z',
  time: 50,
  request: { method: 'GET', url: 'https://example.test/slow', headers: [] },
  response: { status: 200, statusText: 'OK', headers: [] },
  getContent() { return body; },
});
await Promise.resolve();
collector.clear();
resolveBody('completed after Clear');
await new Promise((resolve) => setTimeout(resolve, 0));
const entries = collector.getEntries();
console.log(JSON.stringify({ entries, emittedCount: emitted.length }, null, 2));
assert.equal(entries.length, 0, 'Clearより前に完了済みだった通信が、Clear後に新しい記録として追加されてはならない');
