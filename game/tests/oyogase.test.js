// Item 7: 青物（ブリ・ヒラマサ） around the reefs and under bait schools, and
// 泳がせ釣り with a live アジ taken from the hold.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProfile, markDeparture, validateProfile } from '../src/core/profile.js';
import { createVoyage, advanceVoyage, startOperation, stopOperation, isOperating, setMethod, summarizeVoyage, returnToPort, baitInHold } from '../src/core/voyage.js';
import { settleVoyage } from '../src/core/economy.js';
import { blueSchools } from '../src/core/season.js';
import { createWorld, schoolCenter, schoolPose, densityAt } from '../src/core/world.js';
import { PROGRESSION, SPECIES } from '../src/core/data.js';
import { CALM, denseSchool } from './helpers.js';

const NOW = '2026-11-23T00:00:00.000Z';

function blue(extra = {}) {
  return { id: 'B', species: 'buri', a: { x: 1500, y: 1500 }, counts: { s: 6, m: 8, l: 4 }, sigmaH: 60, sigmaZ: 8, depthFrac: 0.6, activityOverride: 1, orbitR: 0, ...extra };
}

/** A stopped boat at (x, y), with `aji` small アジ in the hold as live bait. */
function voyage({ schools = [blue()], aji = 10, level = 1, x = 1500, y = 1500 } = {}) {
  const p = createProfile({ worldSeed: 42, now: NOW });
  p.methods.oyogase.xp = PROGRESSION.xpTable[level - 1];
  const dep = markDeparture(p, NOW);
  const v = createVoyage(dep, { scenario: { conditions: CALM, schools }, start: { x, y, heading: 0 }, radio: [] });
  v.world.time = 7 * 3600;
  v.hold.counts.aji.s = aji;
  v.hold.count = aji;
  v.hold.kg = aji * SPECIES.aji.sizes.s.kg;
  assert.ok(setMethod(v, 'oyogase').ok);
  advanceVoyage(v, 3);
  return { dep, v };
}

function fish(v, secs) {
  const r = startOperation(v);
  assert.ok(r.ok, r.reason);
  advanceVoyage(v, secs);
  stopOperation(v, 'player');
  while (isOperating(v)) advanceVoyage(v, 1);
  return v.logs[v.logs.length - 1];
}

test('青物 follow the bait: a school under a bait school moves with it, a few metres below; others roam a reef in mid water', () => {
  let checked = 0;
  for (let d = 1; d <= 30 && checked < 3; d++) {
    const w = createWorld(77, d, 9 * 3600);
    for (const s of w.schools.filter((x) => x.baitDepth)) {
      const bait = w.schools.find((x) => x.id === s.follows);
      for (const t of [7 * 3600, 9 * 3600, 13 * 3600]) {
        const cb = schoolCenter(bait, t);
        const cs = schoolCenter(s, t);
        assert.ok(Math.hypot(cb.x - cs.x, cb.y - cs.y) < 60 + (s.orbitR || 0), `together (${s.id})`);
        assert.ok(schoolPose(s, t, w).z > schoolPose(bait, t, w).z, 'below the bait');
      }
      checked++;
    }
  }
  assert.ok(checked >= 3, `${checked} bait-following schools in 30 days`);
  // the reef roamers are in mid water, not on the bottom
  const w = createWorld(77, 5, 9 * 3600);
  for (const s of w.schools.filter((x) => (x.species === 'buri' || x.species === 'hiramasa') && !x.baitDepth)) {
    const p = schoolPose(s, w.time);
    assert.ok(p.z > 3 && p.z < p.bottom - 2, `${s.id} at ${p.z.toFixed(1)} of ${p.bottom.toFixed(1)}`);
  }
  // both species turn up over a season (ブリ cooler days, ヒラマサ warmer days)
  const seen = new Set();
  for (let d = 1; d <= 40; d++) for (const s of blueSchools(77, d)) seen.add(s.species);
  assert.ok(seen.has('buri') && seen.has('hiramasa') && seen.has('iwashi'));
});

test('泳がせ needs live アジ: without them it does not start', () => {
  const { v } = voyage({ aji: 0 });
  const r = startOperation(v);
  assert.ok(!r.ok);
  assert.match(r.reason, /活きエサ/);
});

test('each bait takes one アジ from the hold; over 青物 a fish is played (hands busy) and landed', () => {
  const { v } = voyage({ aji: 10 });
  const r = startOperation(v);
  assert.ok(r.ok, r.reason);
  let fought = false;
  for (let i = 0; i < 30 * 60; i++) {
    advanceVoyage(v, 1);
    if (v.op && v.op.lines[0].phase === 'fight') {
      fought = true;
      assert.deepEqual(v.op.busy, [0], 'the fisher is playing the fish');
    }
  }
  stopOperation(v, 'player');
  while (isOperating(v)) advanceVoyage(v, 1);
  const log = v.logs.at(-1);
  assert.ok(fought, 'a fish was played');
  assert.ok(log.count >= 1, `landed ${log.count}`);
  assert.ok(log.bySpecies.buri);
  assert.equal(baitInHold(v, 'aji'), 10 - log.baits);
  assert.equal(v.baitUsed.aji.s, log.baits);
});

test('with no 青物 around nothing bites; a tired bait is changed every 10 minutes (one アジ each)', () => {
  const { v } = voyage({ schools: [], aji: 10 });
  const log = fish(v, 35 * 60);
  assert.equal(log.count, 0);
  assert.ok(log.baits >= 3 && log.baits <= 5, `${log.baits} baits in 35 min`);
});

test('when the アジ run out the operation ends by itself', () => {
  const { v } = voyage({ schools: [], aji: 2 });
  assert.ok(startOperation(v).ok);
  for (let i = 0; i < 60 * 60 && isOperating(v); i++) advanceVoyage(v, 1);
  assert.ok(!isOperating(v));
  assert.equal(v.logs.at(-1).endReason, 'no_bait');
  assert.equal(baitInHold(v, 'aji'), 0);
});

test('settlement: the アジ used as bait are not sold, 青物 are; landed ≤ what the school held', () => {
  // first the アジ on the handline, then they go on the 泳がせ hook
  const school = blue({ counts: { s: 1, m: 1, l: 1 } });
  const { dep, v } = voyage({ schools: [denseSchool(), school], aji: 0 });
  assert.ok(setMethod(v, 'handline').ok);
  fish(v, 8 * 60);
  const caughtAji = baitInHold(v, 'aji');
  assert.ok(caughtAji >= 6, `${caughtAji} アジ`);
  assert.ok(setMethod(v, 'oyogase').ok);
  const log = fish(v, 90 * 60);
  assert.ok(log.count <= 3);
  const blueLeft = v.world.schools[1].counts;
  assert.equal(log.count + blueLeft.s + blueLeft.m + blueLeft.l, 3);
  returnToPort(v);
  for (let i = 0; i < 6000 && v.phase !== 'docked'; i++) advanceVoyage(v, 1);
  const s = settleVoyage(dep, summarizeVoyage(v));
  assert.ok(s.ok, s.reason);
  const sold = s.receipt.lines.filter((l) => l.species === 'aji').reduce((a, l) => a + l.count, 0);
  const used = Object.values(s.receipt.baitUsed.aji || {}).reduce((a, n) => a + n, 0);
  assert.equal(used, log.baits);
  assert.equal(sold + used, caughtAji);
  assert.ok(s.profile.methods.oyogase.xp > 0 || log.count === 0);
  assert.deepEqual(validateProfile(s.profile), []);
});

test('the hold limits a big fish: with less room than the biggest 青物 nothing more is hooked', () => {
  const { v } = voyage({ aji: 10 });
  v.capacityKg = v.hold.kg + 5; // less than a 10 kg fish
  const log = fish(v, 20 * 60);
  assert.equal(log.count, 0);
  void densityAt;
});
