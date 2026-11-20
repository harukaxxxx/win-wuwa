import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Miniflare, convertV4MiniflareOptions} from 'miniflare';

test('themed production Worker can register, draw once and settle using shared rules', async () => {
  const origin = 'http://localhost';
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true, scriptPath: 'dist/index.js', compatibilityDate: '2026-07-30', d1Databases: ['DB'],
    bindings: {ORIGIN: origin},
    outboundService: () => {throw Error('Unexpected outbound in synthetic test');}
  }));
  try {
    const db = await mf.getD1Database('DB');
    for (const file of (await readdir('migrations')).sort()) {
      for (const sql of (await readFile('migrations/' + file, 'utf8')).split(/;\s*(?=(?:CREATE|ALTER|INSERT|UPDATE|DROP|$))/i).map(x => x.trim()).filter(Boolean)) await db.prepare(sql).run();
    }
    const digest = value => createHash('sha256').update(value).digest('hex');
    const identity = async (id, letter) => {
      const sid = letter.repeat(64), csrf = 'f'.repeat(64);
      await db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').bind(digest(sid), id, digest(csrf), Math.floor(Date.now()/1000) + 3600).run();
      return {Cookie: `__Host-session=${sid}; __Host-csrf=${csrf}`, Origin: origin, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json'};
    };
    const owner = await identity('123', 'a'), viewer = await identity('300', 'b');
    const request = (path, headers, method = 'GET', body) => mf.dispatchFetch(origin + path, {method, headers, body: body === undefined ? undefined : JSON.stringify(body)});
    assert.equal((await request('/api/session', {})).status, 401);
    await db.prepare("INSERT INTO approved_streamers(user_id) VALUES ('123')").run();
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    assert.equal((await request('/api/activities/' + id, owner, 'PUT', {rule_version: 1, guild_id: null, expected_generation: 0})).status, 201);
    assert.equal((await request('/api/viewer/123/register', viewer, 'POST', {activity_id: id, rule_version: 1})).status, 200);
    const path = `/api/activities/${id}/draws/theme-smoke`;
    const draw = await request(path, owner, 'PUT', {rule_version: 1});
    assert.equal(draw.status, 200);
    const result = await draw.json();
    assert.equal(result.draw.winner_ordinal, 1);
    assert.deepEqual(await (await request(path, owner, 'PUT', {rule_version: 1})).json(), result);
    assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM draws').first()).count, 1);
    for (let page = 0; page < 5; page++) {
      const response = await request(`/api/activities/${id}/settlements/theme-finish`, owner, 'PUT', {rule_version: 1});
      assert.ok([200, 202].includes(response.status));
      const state = await db.prepare('SELECT status FROM activities WHERE id=?').bind(id).first();
      if (state.status === 'settled') break;
    }
    assert.equal((await db.prepare('SELECT status FROM activities WHERE id=?').bind(id).first()).status, 'settled');
    assert.equal((await (await request('/api/activities/current', owner)).json()).activity, null);
  } finally {
    await mf.dispose();
  }
});
