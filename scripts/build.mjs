import { cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '..');
const buildDir = resolve(root, 'build');
const staticDir = resolve(root, 'static');
const distDir = resolve(root, 'dist');

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });
await cp(staticDir, distDir, { recursive: true });
// 元画像は再生成用にソース側だけ保持し、配布物にはManifestが参照するサイズだけ含める。
await rm(resolve(distDir, 'icons', 'icon-master.png'), { force: true });
await cp(buildDir, distDir, { recursive: true });
// Chrome loads manifest content scripts and dynamically inserted scripts as
// classic scripts. Bundle the bridge modules so TypeScript's ESM syntax does
// not reach those classic-script contexts.
for (const name of ['content-bridge', 'page-bridge']) {
  await build({
    entryPoints: [resolve(buildDir, 'bridge', `${name}.js`)],
    outfile: resolve(distDir, 'bridge', `${name}.js`),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
  });
}
console.log(`Extension assembled at ${distDir}`);
