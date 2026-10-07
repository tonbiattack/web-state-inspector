import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '..');

test('frame lifecycle tracking retains URLs only while the inspected tab is recording', async () => {
  const moduleUrl = `${pathToFileURL(resolve(root, 'build/background/frame-tracking.js')).href}?test=${Date.now()}`;
  const { FrameTrackingRegistry } = await import(moduleUrl);
  const tracking = new FrameTrackingRegistry();

  assert.equal(tracking.isActive(7), false);
  tracking.start(7);
  assert.equal(tracking.isActive(7), true);
  assert.equal(tracking.isActive(8), false);

  tracking.stop(7);
  assert.equal(tracking.isActive(7), false);
});
