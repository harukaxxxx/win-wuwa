import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, realpath, readdir} from 'node:fs/promises';

test('production host resolves shared core and migrations from the sibling package', async () => {
  const host = JSON.parse(await readFile('package.json', 'utf8'));
  assert.equal(host.dependencies?.['who-is-next'], 'file:../who-is-next');
  const pkg = JSON.parse(await readFile('../who-is-next/package.json', 'utf8'));
  assert.equal(pkg.exports['.'], './src/index.ts');
  assert.equal(await realpath('node_modules/who-is-next'), await realpath('../who-is-next'));
  assert.equal(await realpath('migrations'), await realpath('../who-is-next/migrations'));
  assert.match(await readFile('src/index.ts', 'utf8'), /from ['"]who-is-next['"]/);
});

test('host has no duplicate core implementation and resolves the shared schema', async () => {
  assert.deepEqual(await readdir('src'), ['index.ts']);
  assert.equal((await readdir('migrations')).filter(x => x.endsWith('.sql')).length, 19);
  assert.equal(await realpath(new URL(import.meta.resolve('who-is-next/draw-formula'))), await realpath('../who-is-next/src/draw-formula.ts'));
  const config = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
  assert.equal(await realpath(config.d1_databases[0].migrations_dir), await realpath('../who-is-next/migrations'));
});
