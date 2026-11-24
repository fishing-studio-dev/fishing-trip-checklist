// Item 11: the first-time guide follows the voyage step by step, a method's
// first-time note comes once, and it only reads the voyage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GUIDE_STEPS, METHOD_TIPS, guideNow, guideView, loadGuide, saveGuide, GUIDE_KEY } from '../src/ui/guide.js';
import { createProfile, markDeparture } from '../src/core/profile.js';
import { createVoyage, advanceVoyage, setHelm, setMethod } from '../src/core/voyage.js';
import { PORT } from '../src/core/data.js';

const NOW = '2026-11-23T00:00:00.000Z';
const fresh = () => ({ off: false, done: [], tips: [] });
const base = { distFromPort: 0, echo: false, stopped: false, operating: false, landed: 0, returning: false, docked: false, method: 'handline', usedMethods: [] };

test('the voyage guide goes out → search → stop → start → fish → home as the player does each thing', () => {
  const seen = [];
  const g = fresh();
  const states = [
    base,
    { ...base, distFromPort: 600 },
    { ...base, distFromPort: 900, echo: true },
    { ...base, distFromPort: 900, echo: true, stopped: true },
    { ...base, distFromPort: 900, operating: true },
    { ...base, distFromPort: 900, landed: 12 },
    { ...base, distFromPort: 900, landed: 12, returning: true },
  ];
  for (const s of states) {
    const r = guideNow(s, g);
    g.done.push(...r.passed.filter((id) => !g.done.includes(id)));
    seen.push(r.note ? r.note.id : null);
  }
  assert.deepEqual(seen, ['out', 'search', 'stop', 'start', 'fish', 'home', null]);
  assert.equal(GUIDE_STEPS.length, 6);
});

test('a step the player dismissed is not shown again; turned off shows nothing; after a fished voyage only method notes remain', () => {
  const g = { ...fresh(), done: ['out'] };
  assert.equal(guideNow({ ...base, distFromPort: 10 }, g).note.id, 'search');
  assert.equal(guideNow(base, { ...fresh(), off: true }).note, null);
  assert.equal(guideNow(base, fresh(), { everFished: true }).note, null);
  const tip = guideNow({ ...base, method: 'negyo' }, fresh(), { everFished: true }).note;
  assert.equal(tip.kind, 'tip');
  assert.equal(tip.text, METHOD_TIPS.negyo);
  // already noted, or already used on this voyage: no note
  assert.equal(guideNow({ ...base, method: 'negyo' }, { ...fresh(), tips: ['negyo'] }, { everFished: true }).note, null);
  assert.equal(guideNow({ ...base, method: 'negyo', usedMethods: ['negyo'] }, fresh(), { everFished: true }).note, null);
});

test('the guide state is kept per browser and survives damaged data', () => {
  const mem = new Map();
  const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, v) };
  assert.deepEqual(loadGuide(storage), fresh());
  saveGuide(storage, { off: false, done: ['out'], tips: ['ika'] });
  assert.ok(GUIDE_KEY.startsWith('ryoshi-game:'));
  assert.deepEqual(loadGuide(storage).done, ['out']);
  mem.set(GUIDE_KEY, '{broken');
  assert.deepEqual(loadGuide(storage), fresh());
  assert.deepEqual(loadGuide({ getItem: () => { throw new Error('blocked'); } }), fresh());
});

test('reading the voyage for the guide changes nothing in it', () => {
  const p = createProfile({ worldSeed: 77, now: NOW });
  const v = createVoyage(markDeparture(p, NOW), { radio: [] });
  setHelm(v, { throttle: 5 });
  setMethod(v, 'negyo');
  advanceVoyage(v, 120);
  const before = JSON.stringify({ boat: v.boat, rng: v.world.rng, hold: v.hold, obs: v.obs.cols.length });
  const view = guideView(v, { portX: PORT.dock.x, portY: PORT.dock.y });
  guideNow(view, fresh());
  assert.equal(JSON.stringify({ boat: v.boat, rng: v.world.rng, hold: v.hold, obs: v.obs.cols.length }), before);
  assert.ok(view.distFromPort > 0);
});
