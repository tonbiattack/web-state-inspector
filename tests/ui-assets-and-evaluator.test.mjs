import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '..');
const read = (relativePath) => readFile(resolve(root, relativePath), 'utf8');

async function pngDimensions(relativePath) {
  const contents = await readFile(resolve(root, relativePath));
  const signature = contents.subarray(0, 8).toString('hex');
  assert.equal(signature, '89504e470d0a1a0a', `${relativePath} must be a PNG`);
  return {
    width: contents.readUInt32BE(16),
    height: contents.readUInt32BE(20),
  };
}

test('Manifestのアイコン指定と配布物の各PNGサイズが一致する', async () => {
  const sourceManifest = JSON.parse(await read('static/manifest.json'));
  const distManifest = JSON.parse(await read('dist/manifest.json'));
  const expectedIcons = {
    '16': 'icons/icon-16.png',
    '32': 'icons/icon-32.png',
    '48': 'icons/icon-48.png',
    '128': 'icons/icon-128.png',
  };
  assert.deepEqual(sourceManifest.icons, expectedIcons);
  assert.deepEqual(distManifest.icons, expectedIcons);

  for (const [size, iconPath] of Object.entries(expectedIcons)) {
    assert.deepEqual(await pngDimensions(`static/${iconPath}`), { width: Number(size), height: Number(size) });
    assert.deepEqual(await pngDimensions(`dist/${iconPath}`), { width: Number(size), height: Number(size) });
  }
  await stat(resolve(root, 'static/icons/icon-master.png'));
  await assert.rejects(stat(resolve(root, 'dist/icons/icon-master.png')));
});

test('パネルUIは要求されたナビゲーション、検索、Refresh、JSONコピーを持つ', async () => {
  const source = await read('src/panel/main.ts');
  const navigation = source.slice(source.indexOf('const navItems'), source.indexOf('const labels'));
  for (const label of ['Timeline', 'Network', 'AI Export', 'Storage', 'Cookies', 'Framework State']) {
    assert.match(navigation, new RegExp(`label: '${label}'`));
  }
  for (const removed of ['State Change Timeline', 'Errors', 'Recordings', 'Compare', 'Snapshots', 'IndexedDB', 'Cache Storage', 'Pinia', 'TanStack Query']) assert.doesNotMatch(navigation, new RegExp(`label: '${removed}'`));
  assert.match(source, /'Refresh'/);
  assert.match(source, /Search key \/ value/);
  assert.match(source, /navigator\.clipboard\.writeText/);
  assert.match(source, /JSON を表示/);
  assert.match(source, /experimental: true/);
  assert.match(source, /Start Recording/);
  assert.match(source, /Copy for AI/);
  assert.match(source, /Fetch\/XHR/);
  assert.match(source, /User Action/);
  assert.match(source, /Route Change/);
  assert.match(source, /console\.error \/ warn/);
  assert.match(source, /Capture Selected Element/);
  assert.match(source, /Before label/);
  assert.match(source, /After label/);
  assert.match(source, /Reproduction Notes/);
  assert.match(source, /Expected Result/);
  assert.match(source, /Actual Result/);
  assert.match(source, /Reproduction Steps/);
  assert.match(source, /Export around event/);
  assert.match(source, /Export context around a failure/);
  assert.match(source, /Failure event/);
  assert.match(source, /Seconds before/);
  assert.match(source, /Seconds after/);
  assert.match(source, /Copy focused context/);
  assert.match(source, /Copy event context/);
  assert.match(source, /前5秒・後2秒の関連データ/);
  assert.match(source, /Pause updates/);
  assert.match(source, /Resume updates/);
  assert.match(source, /Show related events/);
  assert.match(source, /scrollIntoView\(\{ block: 'center', behavior: 'smooth' \}\)/);
  assert.match(source, /timelineFocusEventId/);
  assert.match(source, /timelineTypeLabel/);
  assert.match(source, /networkUpdateState/);
  assert.match(source, /event\.key !== 'F5'/);
  assert.match(source, /chrome\.devtools\.inspectedWindow\.reload\(\)/);
  assert.match(source, /isEditableShortcutTarget/);
  assert.match(source, /network-url-cell/);
  assert.match(source, /Copy URL/);
  const styles = await read('static/panel/styles.css');
  assert.match(styles, /\.network-table/);
  assert.match(styles, /\.network-url-cell/);
  assert.match(styles, /overflow-wrap: anywhere/);
  assert.doesNotMatch(source, /'Copy Context'/);
  assert.doesNotMatch(source, /\.innerHTML\s*=/);
});

test('動作確認ページは明示的なPiniaとTanStack Queryの診断ブリッジを公開する', async () => {
  const sample = await read('sample/index.html');
  assert.match(sample, /createPinia/);
  assert.match(sample, /defineStore\('userStore'/);
  assert.match(sample, /new QueryClient\(\)/);
  assert.match(sample, /queryClient\.getQueryCache\(\)\.getAll\(\)/);
  assert.match(sample, /window\.__WEB_STATE_INSPECTOR__\s*=\s*Object\.freeze/);
  assert.match(sample, /getPinia:/);
  assert.match(sample, /getTanStackQuery:/);
  for (const id of ['debug-fetch-ok', 'debug-fetch-fail', 'debug-xhr-post', 'debug-console-error', 'debug-rejection']) assert.match(sample, new RegExp(`id="${id}"`));
  assert.match(sample, /api\/debug-context\/fail/);
  assert.match(sample, /console\.error\(error\)/);
  assert.match(sample, /Promise\.reject\(/);
  assert.match(sample, /customer-password/);
  assert.match(sample, /history\.pushState/);
  assert.match(sample, /history\.replaceState/);
  assert.match(sample, /console\.warn/);
  assert.match(sample, /Action → State → Network → Error/);
});

test('ブリッジなしのサンプルはフレームワーク状態を公開しない', async () => {
  const sample = await read('sample/no-framework-bridge.html');
  assert.doesNotMatch(sample, /window\.__WEB_STATE_INSPECTOR__\s*=/);
  assert.doesNotMatch(sample, /createPinia/);
  assert.doesNotMatch(sample, /new QueryClient\(/);
});

test('PageEvaluatorはChrome DevToolsコンテキストで明示的Piniaブリッジの非同期結果を回収する', async () => {
  const calls = [];
  const originalChrome = globalThis.chrome;
  const originalWindow = globalThis.window;
  globalThis.window = { setTimeout: (callback) => { callback(); return 1; } };
  globalThis.chrome = {
    devtools: {
      inspectedWindow: {
        eval(expression, callback) {
          calls.push(expression);
          if (expression.includes('registry[') && expression.includes("status: 'pending'")) {
            callback(true, undefined);
            return;
          }
          if (expression.includes('return registry && registry[')) {
            callback({
              status: 'success',
              data: {
                detected: true,
                message: 'State supplied by this page through the explicit diagnostic bridge.',
                data: { userStore: { userId: 123, name: 'Taro' } },
              },
            }, undefined);
            return;
          }
          callback(true, undefined);
        },
      },
    },
  };

  try {
    const evaluatorUrl = `${pathToFileURL(resolve(root, 'build/panel/page-evaluator.js')).href}?test=${Date.now()}`;
    const { PageEvaluator } = await import(evaluatorUrl);
    const evaluator = new PageEvaluator();
    const result = await evaluator.getFrameworkState('pinia');
    assert.deepEqual(result, {
      ok: true,
      data: {
        detected: true,
        message: 'State supplied by this page through the explicit diagnostic bridge.',
        data: { userStore: { userId: 123, name: 'Taro' } },
      },
    });
    assert.match(calls[0], /getPinia/);
    assert.equal(calls.length, 3, '開始・ポーリング・クリーンアップを行う');
  } finally {
    globalThis.chrome = originalChrome;
    globalThis.window = originalWindow;
  }
});

test('PageEvaluatorはページ例外を失敗結果として返す', async () => {
  const originalChrome = globalThis.chrome;
  globalThis.chrome = {
    devtools: {
      inspectedWindow: {
        eval(_expression, callback) {
          callback(undefined, { isException: true, value: 'Blocked by page policy' });
        },
      },
    },
  };

  try {
    const evaluatorUrl = `${pathToFileURL(resolve(root, 'build/panel/page-evaluator.js')).href}?test-error=${Date.now()}`;
    const { PageEvaluator } = await import(evaluatorUrl);
    const result = await new PageEvaluator().getPageInfo();
    assert.deepEqual(result, { ok: false, error: 'Blocked by page policy' });
  } finally {
    globalThis.chrome = originalChrome;
  }
});
