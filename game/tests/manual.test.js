// 手引き（R10）: every chapter renders, every method has its chapter, the
// figures are the game's own examples, and the right chapter opens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MANUAL_CHAPTERS, manualHtml, chapterFor } from '../src/ui/manual.js';
import { ECHO_EXAMPLES } from '../src/ui/echoExamples.js';
import { METHODS, SEASONALITY, SPECIES } from '../src/core/data.js';

test('every chapter renders without gaps, with the chapter list and the way to the next chapter', () => {
  const ids = new Set();
  for (const ch of MANUAL_CHAPTERS) {
    assert.ok(!ids.has(ch.id), `duplicate ${ch.id}`);
    ids.add(ch.id);
    const html = manualHtml(ch.id);
    assert.ok(!/undefined|NaN|\[object/.test(html), ch.id);
    assert.ok(html.includes(`data-chapter="${ch.id}"`));
    assert.equal((html.match(/class="toc-item/g) || []).length, MANUAL_CHAPTERS.length);
  }
  for (const m of Object.keys(METHODS)) assert.ok(ids.has(m), `a chapter for ${m}`);
});

test('the sounder chapter shows every echo example; the season chapter lists every fish', () => {
  const s = manualHtml('sounder');
  for (const ex of ECHO_EXAMPLES) assert.ok(s.includes(`data-echo="${ex.id}"`), ex.id);
  const season = manualHtml('season');
  for (const sp of Object.keys(SEASONALITY)) if (!SPECIES[sp].bait) assert.ok(season.includes(SPECIES[sp].name), sp);
  assert.match(manualHtml('oyogase'), /まず一本釣りでアジを釣る/);
  assert.match(manualHtml('tide'), /通説どおりにいかない日もあります/);
});

test('the manual opens at the chapter that fits: the method at sea, the start in port', () => {
  assert.equal(chapterFor({ atSea: true, method: 'jigging' }), 'jigging');
  assert.equal(chapterFor({ atSea: true, method: null }), 'sounder');
  assert.equal(chapterFor({ atSea: false }), 'start');
  assert.match(manualHtml('nope'), /はじめに/); // an unknown chapter falls back to the first
});
