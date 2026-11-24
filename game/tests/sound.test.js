// Item 12: sound settings (the audio itself needs a browser; checked in the e2e).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SOUND_LEVELS, SOUND_KEY, loadSoundLevel, saveSoundLevel, nextSoundLevel } from '../src/ui/sound.js';

test('the sound button steps 中 → 大 → なし → 小 → 中', () => {
  const order = [];
  let i = 2;
  for (let k = 0; k < 4; k++) {
    i = nextSoundLevel(i);
    order.push(SOUND_LEVELS[i].label);
  }
  assert.deepEqual(order, ['音：大', '音：なし', '音：小', '音：中']);
  assert.equal(SOUND_LEVELS[0].gain, 0);
});

test('the level is kept per browser under ryoshi-game:, defaulting to 中 when missing or unreadable', () => {
  const mem = new Map();
  const st = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, v) };
  assert.equal(loadSoundLevel(st), 2);
  saveSoundLevel(st, 0);
  assert.ok(SOUND_KEY.startsWith('ryoshi-game:'));
  assert.equal(loadSoundLevel(st), 0);
  mem.set(SOUND_KEY, 'weird');
  assert.equal(loadSoundLevel(st), 2);
  assert.equal(loadSoundLevel({ getItem: () => { throw new Error('blocked'); } }), 2);
});
