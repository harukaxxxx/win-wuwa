import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdtemp, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';

const workflow = await readFile('.github/workflows/ci.yml', 'utf8');

test('CI pins a public core commit and never deploys the application', async () => {
  const pin = JSON.parse(await readFile('core-ref.json', 'utf8'));
  assert.equal(pin.repository, 'harukaxxxx/who-is-next');
  assert.equal(pin.commit.length, 40);
  assert.match(pin.commit, /^[a-f0-9]{40}$/);
  assert.match(workflow, /repository: harukaxxxx\/who-is-next/);
  assert.match(workflow, /ref: \$\{\{ steps\.core\.outputs\.commit \}\}/);
  assert.match(workflow, /contents: read/);
  assert.doesNotMatch(workflow, /secrets\.|pull_request_target|wrangler (?:deploy|publish)/);
});

test('the actual workflow validator rejects malformed and cross-repository pins', async () => {
  const match = workflow.match(/node --input-type=module <<'NODE'\n([\s\S]*?)          NODE/);
  assert.ok(match, 'workflow validation block must remain executable');
  const script = match[1].replace(/^          /gm, '');
  const root = await mkdtemp(join(tmpdir(), 'win-pin-validator-'));
  try {
    const pin = JSON.parse(await readFile('core-ref.json', 'utf8'));
    for (const [candidate, valid] of [
      [pin, true],
      [{...pin, commit: 'dev'}, false],
      [{...pin, commit: pin.commit + '\n'}, false],
      [{...pin, commit: null}, false],
      [{...pin, repository: 'other/core'}, false]
    ]) {
      await writeFile(join(root, 'core-ref.json'), JSON.stringify(candidate));
      const output = join(root, 'output');
      await writeFile(output, '');
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
        cwd: root, encoding: 'utf8', env: {...process.env, GITHUB_OUTPUT: output}
      });
      assert.ifError(result.error);
      assert.equal(result.status === 0, valid, result.stderr);
      assert.equal(await readFile(output, 'utf8'), valid ? `commit=${pin.commit}\n` : '');
    }
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});
