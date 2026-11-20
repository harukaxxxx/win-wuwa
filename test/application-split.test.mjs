import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';

const core = new URL('../../who-is-next/', import.meta.url);

test('Who Is Next owns a runnable app, default interface and its own test suite', async () => {
  const pkg = JSON.parse(await readFile(new URL('package.json', core), 'utf8'));
  assert.ok(pkg.scripts?.dev);
  assert.ok(pkg.scripts?.test);
  const html = await readFile(new URL('public/index.html', core), 'utf8');
  assert.match(html, /Who Is Next/);
  assert.doesNotMatch(html, /Wuwa Draw/);
  assert.match(html, /id="open-activity"/);
  assert.match(html, /id="draw-result"/);
  assert.ok((await readdir(new URL('test/', core))).includes('settlement.test.mjs'));
});

test('Wuwa theme uses the same interaction scripts with distinct branding and palette', async () => {
  for (const name of ['app.js', 'viewer.js']) {
    assert.deepEqual(await readFile('.generated/public/' + name), await readFile(new URL('public/' + name, core)));
  }
  const html = await readFile('.generated/public/index.html', 'utf8');
  const viewer = await readFile('.generated/public/viewer.html', 'utf8');
  assert.match(html, /Wuwa Draw/);
  assert.match(html, /href="\/theme.css"/);
  assert.match(viewer, /WUWA DRAW/);
  assert.match(await readFile('.generated/public/theme.css', 'utf8'), /--win-accent/);
});
