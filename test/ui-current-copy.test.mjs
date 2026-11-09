import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('streamer page does not claim implemented cancellation recovery is unavailable', async () => {
  const html = await readFile('public/index.html', 'utf8');
  assert.doesNotMatch(html, /取消恢復尚未實作/);
});
