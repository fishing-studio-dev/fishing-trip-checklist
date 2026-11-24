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

import { liveBaitSteps, reefFace } from '../src/core/voyage.js';
import { TIDE_PERIOD } from '../src/core/data.js';
import { HOLDS as H } from '../src/core/season.js';

test('青物の手順: the panel says whether the boat is on the reef face the stream meets and whether the stream runs', () => {
  const p = createProfile({ worldSeed: 77, now: NOW });
  p.day = 30;
  const kita = H.kita;
  const at = (x, y, phase) => {
    const dep = markDeparture(p, NOW);
    const t = 9 * 3600;
    // phase 0.25: the flood at its strongest (toward NE); 0: slack
    const v = createVoyage(dep, { scenario: { conditions: { ...CALM, tideAmp: 0.3, highWater: t - TIDE_PERIOD * phase }, schools: [] }, start: { x, y, heading: 0 }, radio: [] });
    v.world.time = t;
    v.hold.counts.aji.m = 5;
    assert.ok(setMethod(v, 'oyogase').ok);
    return v;
  };
  // flood toward NE: the SW face is the 潮表
  const sw = at(kita.x - 120, kita.y - 120, 0.25);
  const ne = at(kita.x + 120, kita.y + 120, 0.25);
  const step = (v, id) => liveBaitSteps(v).steps.find((x) => x.id === id);
  assert.equal(step(sw, 'face').ok, true, step(sw, 'face').text);
  assert.match(step(sw, 'face').text, /北の瀬の潮表（潮が当たる南西側）/);
  assert.equal(step(ne, 'face').ok, false);
  assert.match(step(ne, 'face').text, /南西側へ回る/);
  assert.equal(step(sw, 'tide').ok, true);
  // slack: the stream does not run, the panel says so; it never blocks the start
  const slack = at(kita.x - 120, kita.y - 120, 0);
  assert.equal(step(slack, 'tide').ok, false);
  assert.match(step(slack, 'tide').text, /潮止まり/);
  assert.equal(liveBaitSteps(slack).ready, true, 'bait aboard and stopped: ready');
  // far from any reef: no face to speak of
  assert.equal(reefFace(at(1200, 900, 0.25)), null);
});

import { BOATS, EQUIPMENT } from '../src/core/data.js';
import { validateProfile, migrateProfile10to11, PROFILE_SCHEMA } from '../src/core/profile.js';
import { purchaseEquipment } from '../src/core/economy.js';

function cruiserWith(bow) {
  const p = createProfile({ worldSeed: 77, now: NOW });
  p.funds = 2000000;
  p.boat.model = 'cruiser_2';
  p.boat.slots = Object.fromEntries(BOATS.cruiser_2.slots.map((sl) => [sl.id, null]));
  p.boat.slots.helm_sounder = { uid: 'c1', itemId: 'sounder_es1' };
  p.boat.slots.starboard_reel = { uid: 'c2', itemId: 'reel_electric' };
  p.boat.slots.port_reel = { uid: 'c3', itemId: 'reel_electric' };
  let q = p;
  for (const [slot, item] of Object.entries(bow)) {
    const r = purchaseEquipment(q, item, slot);
    assert.ok(r.ok, r.reason);
    q = r.profile;
  }
  assert.deepEqual(validateProfile(q), []);
  return q;
}

function ajiRun(p, method = 'handline', secs = 1800) {
  const dep = markDeparture(p, NOW);
  const aji = { id: 'A', species: 'aji', a: { x: 1500, y: 1500 }, counts: { s: 300, m: 900, l: 300 }, sigmaH: 40, sigmaZ: 4, fixedOffBottom: 3, activityOverride: 1.5, orbitR: 0 };
  const v = createVoyage(dep, { scenario: { conditions: { ...CALM, tideAmp: 0 }, schools: [aji] }, start: { x: 1500, y: 1500, heading: 0 }, radio: [], method });
  v.world.time = 7 * 3600;
  advanceVoyage(v, 3);
  assert.ok(startOperation(v).ok);
  const lines = v.op.lines.map((l) => l.label);
  advanceVoyage(v, secs);
  const waits = v.op.lines.map((l) => l.machine);
  stopOperation(v, 'player');
  while (isOperating(v)) advanceVoyage(v, 1);
  return { v, lines, waits, n: v.hold.count };
}

test('中型漁船: two more rod holders at the bow — four rigs; an automatic machine works without hands (一本釣り・イカ), not on 根魚・泳がせ', () => {
  const bowSlots = BOATS.cruiser_2.slots.filter((sl) => sl.id.startsWith('bow_'));
  assert.equal(bowSlots.length, 2);
  assert.ok(bowSlots.every((sl) => sl.accepts.includes('reel') && sl.accepts.includes('machine') && sl.rig));
  assert.ok(!BOATS.skiff_1.slots.some((sl) => sl.id.startsWith('bow_')), 'the small boat stays with one rod');
  // four electric reels: four lines, all needing the one pair of hands in turn
  const reels = ajiRun(cruiserWith({ bow_starboard_reel: 'reel_electric', bow_port_reel: 'reel_electric' }));
  assert.deepEqual(reels.lines, ['右舷', '左舷', '船首右', '船首左']);
  // two machines at the bow: they need no hands, so with the same hands more fish come aboard
  const mach = ajiRun(cruiserWith({ bow_starboard_reel: 'machine_af1', bow_port_reel: 'machine_af1' }));
  assert.deepEqual(mach.lines, ['右舷', '左舷', '船首右（自動）', '船首左（自動）']);
  const two = ajiRun(cruiserWith({}));
  assert.equal(two.lines.length, 2);
  assert.ok(mach.n > two.n * 1.3, `machines add fish: ${two.n} → ${mach.n}`);
  assert.ok(reels.n > two.n, `four reels add fish: ${two.n} → ${reels.n}`);
  // machines are not used where hands are needed (根魚の根掛かり, 泳がせのやり取り)
  const p = cruiserWith({ bow_starboard_reel: 'machine_af1' });
  const dep = markDeparture(p, NOW);
  const v = createVoyage(dep, { scenario: { conditions: CALM, schools: [] }, start: { x: 1500, y: 1500, heading: 0 }, radio: [] });
  v.world.time = 7 * 3600;
  assert.ok(setMethod(v, 'negyo').ok);
  advanceVoyage(v, 3);
  assert.ok(startOperation(v).ok);
  assert.ok(v.op.lines.every((l) => !l.machine), 'no machine on 根魚');
  assert.ok(EQUIPMENT.machine_af1.machine.methods.includes('ika'));
  // a machine does not fit the side holders
  assert.equal(purchaseEquipment(cruiserWith({}), 'machine_af1', 'port_reel').ok, false);
});

test('format 11: a medium boat from an older save gets the two bow holders, empty; nothing else changes', () => {
  const p = cruiserWith({});
  const p10 = JSON.parse(JSON.stringify(p));
  p10.schema = 10;
  delete p10.boat.slots.bow_starboard_reel;
  delete p10.boat.slots.bow_port_reel;
  const q = migrateProfile10to11(p10);
  assert.equal(q.schema, PROFILE_SCHEMA);
  assert.equal(q.boat.slots.bow_starboard_reel, null);
  assert.equal(q.boat.slots.bow_port_reel, null);
  assert.deepEqual({ ...q, schema: 0 }, { ...p, schema: 0 });
  assert.deepEqual(validateProfile(q), []);
});
