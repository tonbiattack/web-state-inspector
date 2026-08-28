import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const { SnapshotService } = await import(`${pathToFileURL(resolve(root, 'build/panel/snapshot-service.js')).href}?repro=${Date.now()}`);

const failure = (error) => ({ ok: false, error });
const evaluator = {
  async getPageDetails() {
    return {
      ok: true,
      data: {
        page: { url: 'https://example.test/', origin: 'https://example.test', title: 'Example' },
        environment: { userAgent: 'test', viewport: { width: 1, height: 1, devicePixelRatio: 1 }, readyState: 'complete' },
      },
    };
  },
  async getStorage(kind) { return failure(`${kind} is blocked`); },
  async getIndexedDatabases() { return failure('IndexedDB is blocked'); },
  async getCacheNames() { return failure('Cache Storage is blocked'); },
  async getFrameworkState(kind) { return failure(`${kind} bridge failed`); },
};
const service = new SnapshotService(evaluator, async () => failure('Cookie API is blocked'));
const result = await service.capture('Before');
console.log(JSON.stringify(result, null, 2));
assert.equal(result.ok, false, '取得対象の全コレクタが失敗した場合、Snapshotの成功として扱ってはならない');
