// Item 8: signs on the surface (鳥山・ナブラ・潮目) come from the shared sea,
// read it without changing it, and the lookout calls them out once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProfile, markDeparture } from '../src/core/profile.js';
import { createVoyage, advanceVoyage } from '../src/core/voyage.js';
import { createWorld } from '../src/core/world.js';
import { surfaceCues, visibleCues } from '../src/core/surface.js';
import { CALM } from './helpers.js';

const NOW = '2026-11-23T00:00:00.000Z';
const bait = (extra = {}) => ({ id: 'BAIT', species: 'iwashi', a: { x: 1500, y: 1500 }, counts: { s: 2000, m: 2000, l: 1000 }, sigmaH: 50, sigmaZ: 2, fixedDepth: 4, orbitR: 0, ...extra });
const buri = (extra = {}) => ({ id: 'BURI', species: 'buri', a: { x: 1510, y: 1500 }, counts: { s: 5, m: 5, l: 5 }, sigmaH: 50, sigmaZ: 6, baitDepth: { depthBias: 0, noiseSeed: 3 }, below: 4, activityOverride: 1, orbitR: 0, ...extra });

function world(schools, { tide = 0, hour = 6 } = {}) {
  return createWorld(1, 9, hour * 3600, { conditions: { ...CALM, tideAmp: tide }, schools });
}

test('鳥山 over shallow bait; ナブラ only when predators feed under it; nothing over deep bait or in the dark', () => {
  const alone = surfaceCues(world([bait()]));
  assert.ok(alone.some((c) => c.kind === 'birds'));
  assert.ok(!alone.some((c) => c.kind === 'nabura'), 'no predators, no ナブラ');
  const hunted = surfaceCues(world([bait(), buri()]));
  const b = hunted.find((c) => c.kind === 'birds');
  assert.ok(hunted.some((c) => c.kind === 'nabura'));
  assert.ok(b.strength > alone.find((c) => c.kind === 'birds').strength, 'more birds when 青物 push the bait');
  assert.equal(surfaceCues(world([bait({ fixedDepth: 14 }), buri()])).length, 0, 'deep bait: nothing to see');
  assert.equal(surfaceCues(world([bait(), buri()], { hour: 3 })).length, 0, 'too dark');
});

test('潮目 only when the tide runs hard', () => {
  const slack = surfaceCues(world([], { tide: 0 }));
  assert.ok(!slack.some((c) => c.kind === 'shiome'));
  let found = false;
  for (let h = 5; h < 18 && !found; h += 0.5) found = surfaceCues(world([], { tide: 0.34, hour: h })).some((c) => c.kind === 'shiome');
  assert.ok(found, 'a strong tide makes 潮目 at some hour');
});

test('reading the surface changes nothing in the sea (no random draws, no fish moved)', () => {
  const w = world([bait(), buri()]);
  const before = JSON.stringify({ rng: w.rng, schools: w.schools });
  for (let i = 0; i < 5; i++) surfaceCues(w);
  assert.equal(JSON.stringify({ rng: w.rng, schools: w.schools }), before);
});

test('the lookout calls a sign out once when it comes into sight (within range), not again soon after', () => {
  const p = createProfile({ worldSeed: 1, now: NOW });
  const dep = markDeparture(p, NOW);
  const v = createVoyage(dep, { scenario: { conditions: CALM, schools: [bait(), buri()] }, start: { x: 1500, y: 2400, heading: 0 }, radio: [] });
  v.world.time = 6 * 3600;
  advanceVoyage(v, 30);
  // 900 m away: the birds are seen, the ナブラ (small splashes) not yet
  const far = v.messages.filter((m) => m.level === 'sight');
  assert.ok(far.some((m) => /鳥山/.test(m.text)) && !far.some((m) => /ナブラ/.test(m.text)), far.map((m) => m.text).join(' / '));
  v.boat.x = 1500;
  v.boat.y = 1700;
  advanceVoyage(v, 30);
  const near = v.messages.filter((m) => m.level === 'sight');
  assert.ok(near.some((m) => /ナブラ/.test(m.text)));
  assert.equal(near.filter((m) => /鳥山/.test(m.text)).length, 1, 'birds called out only once');
  assert.ok(visibleCues(surfaceCues(v.world), v.boat.x, v.boat.y).length >= 2);
});
