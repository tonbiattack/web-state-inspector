import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '..');

test('export safety notice tells users that data stays local and must be reviewed before sharing', async () => {
  const noticeUrl = `${pathToFileURL(resolve(root, 'build/shared/export-safety-notice.js')).href}?test=${Date.now()}`;
  const { getExportSafetyNotice } = await import(noticeUrl);

  const notice = getExportSafetyNotice();

  assert.match(notice, /does not call an AI service/i);
  assert.match(notice, /locally/i);
  assert.match(notice, /cookies/i);
  assert.match(notice, /authorization headers/i);
  assert.match(notice, /request\/response bodies/i);
  assert.match(notice, /Review.*before sharing/i);
  assert.match(notice, /外部送信/i);
});
