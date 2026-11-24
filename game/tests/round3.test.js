// Third round: fish on the up-current face of the reefs (潮表), クエ, the 青物
// steps, four rods on the medium boat, later squid trips.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, schoolCenter, schoolPose, holdOffset } from '../src/core/world.js';
import { currentAt } from '../src/core/sea.js';
import { HOLDS } from '../src/core/season.js';

const upCurrentShare = (w, s, t) => {
  // >0: the school stands on the side the stream comes from
  const c = currentAt(w.cond, t);
  const sp = Math.hypot(c.x, c.y) || 1;
  const p = schoolCenter(s, t);
  return -((p.x - s.holdTo.x) * c.x + (p.y - s.holdTo.y) * c.y) / sp;
};

test('潮表: fish tied to a reef sit on the face the stream meets, cross at slack and change face when the tide turns', () => {
  let checked = 0;
  for (let d = 10; d <= 40 && checked < 6; d += 3) {
    const w = createWorld(77, d, 5 * 3600);
    for (const s of w.schools.filter((x) => x.holdTo && (x.species === 'aji' || x.species === 'iwashi'))) {
      // sample the running stream on both tides of the day
      let flood = null;
      let ebb = null;
      for (let t = 6 * 3600; t < 18 * 3600; t += 600) {
        const c = currentAt(w.cond, t);
        const sp = Math.hypot(c.x, c.y);
        if (sp < 0.15) continue;
        if (c.y > 0 && !flood) flood = t;
        if (c.y < 0 && !ebb) ebb = t;
      }
      if (!flood || !ebb) continue;
      assert.ok(upCurrentShare(w, s, flood) > s.holdTo.face * 0.6, `${s.id} on the up-current face at the flood`);
      assert.ok(upCurrentShare(w, s, ebb) > s.holdTo.face * 0.6, `${s.id} on the (other) up-current face at the ebb`);
      const pf = schoolCenter(s, flood);
      const pe = schoolCenter(s, ebb);
      assert.ok(Math.hypot(pf.x - pe.x, pf.y - pe.y) > s.holdTo.face, `${s.id} moved across the reef with the turn`);
      checked++;
    }
  }
  assert.ok(checked >= 6, `${checked} reef schools checked`);
  // the offset is a pure function of time: smooth (no jumps) and zero without a tie
  const w = createWorld(77, 20, 5 * 3600);
  const s = w.schools.find((x) => x.holdTo);
  for (let t = 5 * 3600; t < 18 * 3600; t += 60) {
    const a = holdOffset(s, t);
    const b = holdOffset(s, t + 60);
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 12, 'moves at most a few metres a minute');
  }
  assert.deepEqual(holdOffset({ a: { x: 0, y: 0 } }, 3600), { x: 0, y: 0 });
});

test('bait gathers over the reefs in its season, and the reef 青物 stay under it on the same face', () => {
  let pairs = 0;
  for (let d = 1; d <= 60; d++) {
    const w = createWorld(77, d, 5 * 3600);
    for (const s of w.schools.filter((x) => x.follows && x.holdTo)) {
      const bait = w.schools.find((x) => x.id === s.follows);
      assert.equal(bait.holdTo.id, s.holdTo.id);
      assert.ok(HOLDS[s.holdTo.id]);
      for (const t of [7 * 3600, 12 * 3600]) assert.ok(schoolPose(s, t, w).z > schoolPose(bait, t, w).z);
      pairs++;
    }
  }
  assert.ok(pairs >= 3, `${pairs} reef bait with 青物 in a year`);
});

import { createProfile, markDeparture } from '../src/core/profile.js';
import { createVoyage, advanceVoyage, startOperation, stopOperation, isOperating, setMethod } from '../src/core/voyage.js';
import { reefSchools } from '../src/core/season.js';
import { STRUCTURES } from '../src/core/sea.js';
import { SPECIES, METHODS } from '../src/core/data.js';
import { CALM } from './helpers.js';

const NOW = '2026-11-24T00:00:00.000Z';
const n2 = STRUCTURES.find((s) => s.id === 'n2');

function kueVoyage(method, { aji = 0 } = {}) {
  const p = createProfile({ worldSeed: 77, now: NOW });
  p.day = 40;
  const dep = markDeparture(p, NOW);
  const kue = { id: 'KUE', species: 'kue', a: { x: n2.x, y: n2.y }, counts: { s: 6, m: 10, l: 4 }, sigmaH: 25, sigmaZ: 4, activityOverride: 2, orbitR: 0 };
  const v = createVoyage(dep, { scenario: { conditions: { ...CALM, tideAmp: 0 }, schools: [kue] }, start: { x: n2.x, y: n2.y, heading: 0 }, radio: [] });
  v.world.time = 16 * 3600;
  if (aji) v.hold.counts.aji.m = aji;
  assert.ok(setMethod(v, method).ok);
  advanceVoyage(v, 3);
  return { dep, v };
}

test('クエ: in the holes of the big rocks; takes a live アジ (泳がせ) and a 根魚 rig, and often dives into the rocks and breaks the 根魚 rig', () => {
  // where it lives: the big pinnacles and the far reef, a few at most
  let seen = 0;
  for (let d = 1; d <= 60; d++) for (const s of reefSchools(77, d).filter((x) => x.species === 'kue')) {
    seen++;
    assert.ok(s.counts.s + s.counts.m + s.counts.l <= 3, 'a few at most');
    assert.ok(/ne|n\d|okise|kita/.test(s.habitat), s.habitat);
  }
  assert.ok(seen > 10, `${seen} クエ in a year`);
  assert.ok(METHODS.oyogase.targets.includes('kue') && METHODS.negyo.targets.includes('kue'));
  assert.ok(SPECIES.kue.sizes.l.kg >= 15);
  // 根魚釣り: bites, and loses many to the rocks
  const ng = kueVoyage('negyo');
  assert.ok(startOperation(ng.v).ok);
  advanceVoyage(ng.v, 3600);
  stopOperation(ng.v, 'player');
  while (isOperating(ng.v)) advanceVoyage(ng.v, 1);
  const lg = ng.v.logs.at(-1);
  assert.ok(lg.lostFish > 0, `lost to the rocks: ${lg.lostFish}`);
  assert.ok(ng.v.messages.some((m) => /根に潜られて/.test(m.text)));
  // 泳がせ: live アジ near the rocks; lands クエ, and what it lands settles like any fish
  const oy = kueVoyage('oyogase', { aji: 20 });
  assert.ok(startOperation(oy.v).ok);
  advanceVoyage(oy.v, 2 * 3600);
  stopOperation(oy.v, 'player');
  while (isOperating(oy.v)) advanceVoyage(oy.v, 1);
  const kueN = Object.values(oy.v.hold.counts.kue).reduce((a, b) => a + b, 0) + Object.values(ng.v.hold.counts.kue).reduce((a, b) => a + b, 0);
  assert.ok(kueN > 0, 'some クエ landed');
  assert.ok((oy.v.best || {}).kue || (ng.v.best || {}).kue, 'the biggest クエ is noted for the records');
});
