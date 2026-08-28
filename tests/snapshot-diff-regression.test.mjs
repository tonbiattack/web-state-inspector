import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const { diffSnapshots } = await import(`${pathToFileURL(resolve(root, 'build/panel/snapshot-service.js')).href}?repro=${Date.now()}`);

function snapshot({ id, url, title, cookieValue }) {
  return {
    id,
    label: id,
    timestamp: '2026-08-28T00:00:00.000Z',
    page: { url, origin: 'https://example.test', title },
    environment: { userAgent: 'test', viewport: { width: 100, height: 100, devicePixelRatio: 1 }, readyState: 'complete' },
    localStorage: [],
    sessionStorage: [],
    cookies: [{ name: 'session', value: cookieValue, domain: 'example.test', path: '/', expires: 'Session', secure: true, httpOnly: true, sameSite: 'lax' }],
    indexedDb: [],
    cacheStorage: [],
    pinia: { detected: false, message: 'not available' },
    tanstackQuery: { detected: false, message: 'not available' },
  };
}

const before = snapshot({ id: 'before', url: 'https://example.test/sign-in', title: 'Sign in', cookieValue: 'before-cookie' });
const after = snapshot({ id: 'after', url: 'https://example.test/dashboard', title: 'Dashboard', cookieValue: 'after-cookie' });
const diff = diffSnapshots(before, after);
console.log(JSON.stringify(diff, null, 2));
assert.ok(diff.entries.some((entry) => entry.path.startsWith('cookies')), 'Cookie値の変化をDiffに含める必要がある');
assert.ok(diff.entries.some((entry) => entry.path.startsWith('page.')), 'Page URL・titleの変化をDiffに含める必要がある');
