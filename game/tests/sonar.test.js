// Item 4: the scanning sonar finds schools and structures around the boat.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProfile, markDeparture, validateProfile } from '../src/core/profile.js';
import { createVoyage, advanceVoyage } from '../src/core/voyage.js';
import { SONAR_BEAMS, SONAR_BINS, sonarToWorld } from '../src/core/sonar.js';
import { STRUCTURES } from '../src/core/sea.js';
import { CALM, denseSchool, simHash } from './helpers.js';

const NOW = '2026-11-23T00:00:00.000Z';

function cruiser(sonar = true) {
  const p = createProfile({ worldSeed: 5, now: NOW });
  p.boat.model = 'cruiser_2';
  p.boat.slots = { helm_sounder: { uid: 'x1', itemId: 'sounder_es2' }, starboard_reel: { uid: 'x2', itemId: 'reel_hand' }, port_reel: null, stern_troll: null, deck_longline: null, starboard_hauler: null, hull_sonar: sonar ? { uid: 'x3', itemId: 'sonar_cs1' } : null, roof_lights: null };
  assert.deepEqual(validateProfile(p), []);
  return p;
}

function voyage(p, schools, start) {
  const v = createVoyage(markDeparture(p, NOW), { scenario: { conditions: CALM, schools }, start });
  v.world.time = 8 * 3600;
  return v;
}

/** The strongest cell of the sonar picture, as a world position. */
function strongest(v) {
  let best = 0;
  let at = null;
  for (let b = 0; b < SONAR_BEAMS; b++) {
    for (let k = 0; k < SONAR_BINS; k++) {
      const val = v.sonar.data[b * SONAR_BINS + k];
      if (val > best) {
        best = val;
        at = sonarToWorld(v.boat, (b / SONAR_BEAMS) * Math.PI * 2, ((k + 0.5) / SONAR_BINS) * v.sonar.range);
      }
    }
  }
  return { best, at };
}

test('a school 220 m away shows on the sonar where it really is; the down-looking sounder sees nothing', () => {
  const school = denseSchool({ a: { x: 1500 + 150, y: 1500 + 160 }, fixedOffBottom: 8 });
  const v = voyage(cruiser(), [school], { x: 1500, y: 1500, heading: 0.4 });
  advanceVoyage(v, 8); // one full turn
  const s = strongest(v);
  assert.ok(s.best > 120, `echo ${s.best}`);
  assert.ok(Math.hypot(s.at.x - 1650, s.at.y - 1660) < 30, `at ${Math.round(s.at.x)},${Math.round(s.at.y)}`);
  assert.ok(v.obs.cols.every((c) => c.maxFish < 0.05));
});

test('a 漁礁 shows as a hard return at its place; open water is dark', () => {
  const g = STRUCTURES.find((x) => x.id === 'g2');
  const v = voyage(cruiser(), [], { x: g.x - 120, y: g.y - 60, heading: 0 });
  v.sonar.range = 300;
  advanceVoyage(v, 8);
  const s = strongest(v);
  assert.ok(s.best > 80);
  assert.ok(Math.hypot(s.at.x - g.x, s.at.y - g.y) < g.r + 12, `at ${Math.round(s.at.x)},${Math.round(s.at.y)}`);
  const empty = voyage(cruiser(), [], { x: 1500, y: 2900, heading: 0 });
  advanceVoyage(empty, 8);
  assert.ok(strongest(empty).best < 40);
});

test('the sonar only looks: the sea, catch and random draws are the same with or without it', () => {
  const run = (sonar) => {
    const v = voyage(cruiser(sonar), [denseSchool()], { x: 1500, y: 1500, heading: 0 });
    advanceVoyage(v, 300);
    return simHash(v);
  };
  assert.equal(run(true), run(false));
});
