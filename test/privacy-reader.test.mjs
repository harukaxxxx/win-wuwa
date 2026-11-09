import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// This is deliberately a reader for this static disclosure, not an HTML parser.
// Reject unsupported markup/entities rather than silently skipping reader-visible text.
function readPrivacy(html) {
  const openings = [...html.matchAll(/<details\b[^>]*>/gi)]
    .filter(([tag]) => (tag.match(/\bclass="([^"]*)"/)?.[1] ?? '').split(/\s+/).includes('privacy'));
  assert.equal(openings.length, 1, 'exactly one privacy details is required');
  const start = openings[0].index + openings[0][0].length;
  const end = html.indexOf('</details>', start);
  assert.notEqual(end, -1, 'privacy details must close');
  const content = html.slice(start, end);
  const disclosure = { summary: '', paragraphs: [], links: [] };
  const stack = [];
  let text = '';
  let summaries = 0;
  let position = 0;
  while (position < content.length) {
    const tagStart = content.indexOf('<', position);
    const textEnd = tagStart === -1 ? content.length : tagStart;
    const chunk = content.slice(position, textEnd);
    assert.ok(!chunk.includes('&'), 'HTML entities are unsupported in this static reader');
    if (stack.length) text += chunk;
    else assert.equal(chunk.trim(), '', 'text must be inside summary or paragraph');
    if (tagStart === -1) break;
    const tagEnd = content.indexOf('>', tagStart);
    assert.notEqual(tagEnd, -1, 'tag must close');
    const tag = content.slice(tagStart, tagEnd + 1);
    if (tag === '<summary>' || tag === '<p>') {
      assert.equal(stack.length, 0, 'summary and paragraphs must be direct children');
      if (tag === '<summary>') {
        assert.equal(disclosure.paragraphs.length, 0, 'summary precedes paragraphs');
        summaries++;
      } else assert.equal(summaries, 1, 'paragraphs follow a single summary');
      stack.push(tag.slice(1, -1));
      text = '';
    } else if (tag.startsWith('<a ')) {
      assert.deepEqual(stack, ['p'], 'links must be directly inside a paragraph');
      const link = /^<a href="([^"]+)">$/.exec(tag);
      assert.ok(link, 'link must have one quoted href');
      disclosure.links.push(link[1]);
      stack.push('a');
    } else if (tag === '</a>') {
      assert.equal(stack.pop(), 'a', 'link must close in order');
    } else if (tag === '</summary>' || tag === '</p>') {
      const name = tag.slice(2, -1);
      assert.deepEqual(stack, [name], 'summary or paragraph must close in order');
      stack.pop();
      const normalized = text.trim().replace(/\s+/g, ' ');
      if (name === 'summary') disclosure.summary = normalized;
      else disclosure.paragraphs.push(normalized);
    } else {
      assert.fail(`unsupported disclosure tag: ${tag}`);
    }
    position = tagEnd + 1;
  }
  assert.deepEqual(stack, [], 'all disclosure elements must close');
  assert.equal(summaries, 1, 'exactly one summary is required');
  return disclosure;
}

test('privacy disclosure presents current use, manual retention and human contact to a reader', () => {
  const disclosure = readPrivacy(readFileSync(new URL('../public/viewer.html', import.meta.url), 'utf8'));
  assert.equal(disclosure.summary, '隱私與資料使用');
  assert.deepEqual(disclosure.paragraphs, [
    '登入要求 Discord identify 身分；限定群組的場次另要求 guilds.members.read 以確認該群成員資格。存取權杖不保存。不收 email、遊戲 UID、伺服器或角色。報名及抽選所需紀錄依主播環境隔離，分數也各自獨立；公開資訊僅人數、規則及中獎者顯示名稱，不公開報名名單。',
    '正常結算全部完成或取消恢復全部完成後超過 90 天的詳細歷史，管理員可手動逐批清理；沒有固定排程或完成期限，超過 90 天不代表已刪除。完成時間不明的歷史不會依此清理。',
    '清理詳細歷史後，共用的身分與登入 session、分數，以及防止重複處理所需的最小場次 tombstone 仍會保留。',
    '資料權利請求請聯絡 contact@makinoworks.com，由人工處理；上線前仍需確認適用法律及告知內容，並非已完成法律審查。'
  ]);
  assert.deepEqual(disclosure.links, ['mailto:contact@makinoworks.com']);
});
