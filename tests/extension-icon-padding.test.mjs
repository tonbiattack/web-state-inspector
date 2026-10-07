import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '..');

function pixel(path, coordinate) {
  const script = [
    'Add-Type -AssemblyName System.Drawing',
    `$bitmap = [System.Drawing.Bitmap]::new('${path.replaceAll("'", "''")}')`,
    `$pixel = $bitmap.GetPixel(${coordinate}, ${coordinate})`,
    '$bitmap.Dispose()',
    '"$($pixel.A),$($pixel.R),$($pixel.G),$($pixel.B)"',
  ].join('; ');
  return execFileSync('powershell', ['-NoProfile', '-Command', script], { cwd: root, encoding: 'utf8' }).trim();
}

test('配布アイコンは白い18px外側余白を持つ', () => {
  for (const relativePath of ['static/icons/icon-128.png', 'dist/icons/icon-128.png']) {
    const absolutePath = resolve(root, relativePath);
    assert.equal(pixel(absolutePath, 0), '255,255,255,255', `${relativePath} の角は白である`);
    assert.equal(pixel(absolutePath, 17), '255,255,255,255', `${relativePath} は18pxの白い余白を持つ`);
  }
});
