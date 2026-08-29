import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { test } from 'node:test';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (relativePath) => readFile(resolve(root, relativePath), 'utf8');

test('配布物はManifest V3のDevTools拡張として組み立てられる', async () => {
  const manifest = JSON.parse(await read('dist/manifest.json'));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.devtools_page, 'devtools.html');
  assert.equal(manifest.background.service_worker, 'background/service-worker.js');
  assert.deepEqual(manifest.permissions, ['cookies', 'webNavigation']);
  assert.deepEqual(manifest.host_permissions, ['<all_urls>']);
  assert.deepEqual(manifest.content_scripts, [{ matches: ['<all_urls>'], js: ['bridge/content-bridge.js'], run_at: 'document_start', all_frames: true }]);
  assert.deepEqual(manifest.web_accessible_resources, [{ resources: ['bridge/page-bridge.js'], matches: ['<all_urls>'] }]);
  await stat(resolve(root, 'dist/panel/main.js'));
  await stat(resolve(root, 'dist/panel/page-evaluator.js'));
});

test('拡張コードはStorageを読み取り専用で扱い、外部通信を含まない', async () => {
  const source = await read('src/panel/page-evaluator.ts');
  const background = await read('src/background/service-worker.ts');
  const allSource = `${source}\n${background}`;
  assert.match(source, /getStorage\(kind: 'localStorage' \| 'sessionStorage'\)/);
  assert.match(source, /const storage = window\.\$\{kind\}/);
  assert.match(source, /indexedDB\.databases/);
  assert.match(source, /caches\.keys/);
  assert.match(background, /chrome\.cookies\s*\.getAll/);
  assert.doesNotMatch(allSource, /chrome\.cookies\s*\.set/);
  assert.doesNotMatch(allSource, /chrome\.cookies\s*\.remove/);
  assert.doesNotMatch(allSource, /fetch\s*\(/);
  assert.doesNotMatch(allSource, /XMLHttpRequest/);
});

test('大量データ対策と明示的Framework診断ブリッジが実装されている', async () => {
  const source = await read('src/panel/page-evaluator.ts');
  assert.match(source, /Math\.min\(Math\.max\(limit, 1\), 100\)/);
  assert.match(source, /__WEB_STATE_INSPECTOR__/);
  assert.match(source, /getPinia/);
  assert.match(source, /getTanStackQuery/);
  assert.doesNotMatch(source, /Object\.getOwnPropertyNames\(window\)/);
  assert.doesNotMatch(source, /for\s*\([^)]*in\s+window\)/);
});

test('AI Bridgeは要求時だけ応答し、ページへデバッグデータを常駐コピーしない', async () => {
  const pageBridge = await read('src/bridge/page-bridge.ts');
  const contentBridge = await read('src/bridge/content-bridge.ts');
  assert.match(pageBridge, /AI_BRIDGE_TIMEOUT_MS/);
  assert.match(pageBridge, /requestId/);
  assert.match(contentBridge, /WEB_STATE_INSPECTOR_BRIDGE_REQUEST/);
  assert.match(contentBridge, /script\.addEventListener\('load'/);
  assert.doesNotMatch(pageBridge, /__WEB_STATE_INSPECTOR_DATA__/);
  assert.doesNotMatch(pageBridge, /timeline:\s*\[\.\.\./);
});
