// Second round, stage 2: ジギング, the 泳がせ checklist, the "bait but no bite
// on the troll" hint, and up to three longlines (R07, R08), with save format 9.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProfile, markDeparture, validateProfile, migrateProfile8to9, migrateProfile9to10, migrateProfile10to11, PROFILE_SCHEMA } from '../src/core/profile.js';
import {
  createVoyage, advanceVoyage, startOperation, stopOperation, setMethod, isOperating, haulLongline, lineInWater, linesInWater, freeLines, soakingLines, lineNo,
  returnToPort, summarizeVoyage, liveBaitSteps, canStartOperation, routeTo,
} from '../src/core/voyage.js';
import { settleVoyage, purchaseExtraLine } from '../src/core/economy.js';
import { snapshotVoyage, restoreVoyage } from '../src/core/voyageSnapshot.js';
import { loadSave, memoryStorage, makeEnvelope, KEYS, SAVE_SCHEMA } from '../src/core/save.js';
import { briefingReports } from '../src/core/reports.js';
import { STRUCTURES } from '../src/core/sea.js';
import { PEERS, LONGLINE_LINES, EQUIPMENT } from '../src/core/data.js';
import { CALM } from './helpers.js';

const NOW = '2026-11-24T00:00:00.000Z';
const n1 = STRUCTURES.find((s) => s.id === 'n1');

function voyageWith(p, schools, start, method) {
  const v = createVoyage(markDeparture(p, NOW), { scenario: { conditions: CALM, schools }, start: { heading: 0, ...start }, radio: [], method });
  v.world.time = 7 * 3600;
  return v;
}

function fishFor(v, secs) {
  advanceVoyage(v, 20);
  const r = startOperation(v);
  assert.ok(r.ok, r.reason);
  advanceVoyage(v, secs);
  stopOperation(v, 'player');
  while (isOperating(v)) advanceVoyage(v, 1);
  return v.logs.at(-1);
}

function landAndSettle(dep, v) {
  returnToPort(v);
  for (let i = 0; i < 20000 && v.phase !== 'docked'; i++) advanceVoyage(v, 1);
  return settleVoyage(dep, summarizeVoyage(v));
}

const jigProfile = () => {
  const p = createProfile({ worldSeed: 5, now: NOW });
  p.day = 12;
  p.boat.slots.rod_rack = { uid: 'r1', itemId: 'rod_jg1' };
  assert.deepEqual(validateProfile(p), []);
  return p;
};
const blueOnReef = (extra = {}) => ({ id: 'B', species: 'hiramasa', a: { x: n1.x, y: n1.y }, counts: { s: 4, m: 8, l: 3 }, sigmaH: 40, sigmaZ: 6, depthFrac: 0.6, activityOverride: 1, orbitR: 0, ...extra });

test('format 9: an older save gets ジギング at 0, an empty rod rack and no extra lines; nothing else changes', () => {
  const p8 = createProfile({ worldSeed: 3, now: NOW });
  p8.schema = 8;
  delete p8.methods.jigging;
  delete p8.boat.slots.rod_rack;
  delete p8.extraLines;
  p8.funds = 4321;
  const p9 = migrateProfile8to9(p8);
  assert.equal(p9.schema, 9);
  assert.deepEqual(p9.methods.jigging, { xp: 0 });
  assert.equal(p9.boat.slots.rod_rack, null);
  assert.equal(p9.extraLines, 0);
  assert.equal(p9.funds, 4321);
  assert.deepEqual(validateProfile(migrateProfile10to11(migrateProfile9to10(p9))), []);
  // through the loader: a format-8 envelope opens in the current format, the original kept aside
  const st = memoryStorage();
  const env8 = { ...makeEnvelope(p8, 3, NOW), schemaVersion: 8, app: 'M8' };
  st.setItem(KEYS.main, JSON.stringify(env8));
  const r = loadSave(st);
  assert.equal(r.status, 'ok', r.error);
  assert.equal(r.migratedFrom, 8);
  assert.deepEqual(r.profile.methods.jigging, { xp: 0 });
  assert.equal(r.profile.funds, 4321);
  assert.equal(st.getItem(r.preMigrationKey), JSON.stringify(env8));
  assert.ok(SAVE_SCHEMA >= 9 && PROFILE_SCHEMA >= 9);
});

test('ジギング needs the rod; with it, the jig sweeps from the bottom up and takes the 青物 around the reef', () => {
  const plain = createProfile({ worldSeed: 5, now: NOW });
  plain.day = 12;
  const v0 = voyageWith(plain, [blueOnReef()], { x: n1.x, y: n1.y });
  assert.ok(!setMethod(v0, 'jigging').ok);
  const v = voyageWith(jigProfile(), [blueOnReef()], { x: n1.x, y: n1.y });
  assert.ok(setMethod(v, 'jigging').ok);
  advanceVoyage(v, 20);
  assert.ok(startOperation(v).ok);
  // watch the jig move: it reaches the bottom and comes back up by at least 10 m
  let deepest = 0;
  let shallowest = 999;
  for (let i = 0; i < 600; i++) {
    advanceVoyage(v, 0.5);
    const line = v.op.lines[0];
    if (line.phase === 'jig') {
      deepest = Math.max(deepest, line.depth);
      shallowest = Math.min(shallowest, line.depth);
    }
  }
  assert.ok(deepest - shallowest >= 10, `${shallowest}..${deepest}`);
  advanceVoyage(v, 40 * 60);
  stopOperation(v, 'player');
  while (isOperating(v)) advanceVoyage(v, 1);
  const log = v.logs.at(-1);
  assert.equal(log.methodId, 'jigging');
  assert.ok(log.bySpecies && log.bySpecies.hiramasa && log.count >= 1, JSON.stringify(log.bySpecies));
});

test('ジギング on empty water catches nothing; jigs touching rock are lost and paid for at landing', () => {
  const empty = voyageWith(jigProfile(), [], { x: 1300, y: 1700 });
  assert.ok(setMethod(empty, 'jigging').ok);
  assert.equal(fishFor(empty, 20 * 60).count, 0);
  // the wide rocky top of 西の根: an hour of touching rock
  const p = jigProfile();
  const dep = markDeparture(p, NOW);
  const v = createVoyage(dep, { scenario: { conditions: CALM, schools: [] }, start: { x: 650, y: 1350, heading: 0 }, radio: [], method: 'jigging' });
  v.world.time = 7 * 3600;
  const log = fishFor(v, 90 * 60);
  assert.ok(log.jigsLost >= 1, `jigs lost ${log.jigsLost}`);
  const s = landAndSettle(dep, v);
  assert.ok(s.ok, s.reason);
  assert.equal(s.receipt.costs.jigs, log.jigsLost * EQUIPMENT.rod_jg1.rod.jigPrice);
  assert.equal(s.profile.ledger.at(-1).byMethod.jigging.jigCost, s.receipt.costs.jigs);
});

test('ジギング: サバ crowd a jig fished through their layer (cheap by-catch)', () => {
  const saba = { id: 'S', species: 'masaba', a: { x: 1300, y: 1700 }, counts: { s: 300, m: 600, l: 150 }, sigmaH: 60, sigmaZ: 3, depthFrac: 0.6, activityOverride: 1, orbitR: 0 };
  const v = voyageWith(jigProfile(), [saba], { x: 1300, y: 1700 });
  assert.ok(setMethod(v, 'jigging').ok);
  const log = fishFor(v, 30 * 60);
  assert.ok(log.bySpecies && log.bySpecies.masaba, JSON.stringify(log.bySpecies));
});

test('the 泳がせ checklist: no アジ → catch some first; with アジ, stopped → ready', () => {
  const p = createProfile({ worldSeed: 5, now: NOW });
  p.day = 12;
  const v = voyageWith(p, [], { x: 1300, y: 1700 }, 'oyogase');
  advanceVoyage(v, 5);
  let g = liveBaitSteps(v);
  assert.equal(g.method, 'oyogase');
  assert.equal(g.steps.find((x) => x.id === 'bait').ok, false);
  assert.match(g.steps.find((x) => x.id === 'bait').text, /一本釣りでアジを釣る/);
  assert.equal(g.ready, false);
  assert.match(canStartOperation(v).reason, /一本釣り/);
  // three アジ in the hold
  v.hold.counts.aji = { s: 0, m: 3, l: 0 };
  v.hold.count = 3;
  v.hold.kg = 0.75;
  g = liveBaitSteps(v);
  assert.equal(g.steps.find((x) => x.id === 'bait').ok, true);
  assert.equal(g.steps.find((x) => x.id === 'stop').ok, true);
  assert.equal(g.ready, true);
  assert.equal(liveBaitSteps({ ...v, method: 'handline' }), null);
});

test('bait at the surface but nothing on the troll: after a while the boat suggests 泳がせ (and ジギング with the rod)', () => {
  const p = createProfile({ worldSeed: 5, now: NOW });
  p.day = 12;
  p.boat.slots.stern_troll = { uid: 't1', itemId: 'troll_tr1' };
  p.boat.slots.rod_rack = { uid: 'r1', itemId: 'rod_jg1' };
  // a shallow bait school with 青物 under it, no サワラ for the lures
  const bait = { id: 'BAIT', species: 'iwashi', a: { x: 1300, y: 1800 }, counts: { s: 3000, m: 2000, l: 1000 }, sigmaH: 60, sigmaZ: 2, fixedDepth: 4, orbitR: 0 };
  const buri = { id: 'Y', species: 'buri', a: { x: 1300, y: 1800 }, counts: { s: 4, m: 6, l: 2 }, sigmaH: 50, sigmaZ: 4, depthFrac: 0.6, activityOverride: 1, orbitR: 0 };
  const v = voyageWith(p, [bait, buri], { x: 1300, y: 1500 }, 'troll');
  v.world.time = 7 * 3600;
  advanceVoyage(v, 5);
  assert.ok(startOperation(v).ok);
  advanceVoyage(v, 45 * 60);
  const hint = v.messages.find((m) => /ベイトはいるのに曳縄に食わない/.test(m.text));
  assert.ok(hint, v.messages.map((m) => m.text).slice(-6).join(' / '));
  assert.match(hint.text, /泳がせ/);
  assert.match(hint.text, /ジギング/);
  assert.equal(v.messages.filter((m) => /ベイトはいるのに/.test(m.text)).length, 1, 'said once');
});

test('extra longlines: bought one at a time, up to three, only with the gear and the money', () => {
  const p = createProfile({ worldSeed: 5, now: NOW });
  p.funds = 100000;
  assert.ok(!purchaseExtraLine(p).ok, 'no longline gear yet');
  p.boat.slots.stern_troll = { uid: 'L1', itemId: 'longline_ll1' };
  const a = purchaseExtraLine(p);
  assert.ok(a.ok);
  assert.equal(a.profile.extraLines, 1);
  assert.equal(a.profile.funds, 100000 - LONGLINE_LINES.extraPrice);
  assert.equal(p.extraLines, 0, 'pure: the old profile is unchanged');
  const b = purchaseExtraLine(a.profile);
  assert.ok(b.ok);
  assert.ok(!purchaseExtraLine(b.profile).ok, 'three is the most');
  assert.deepEqual(validateProfile(b.profile), []);
  const poor = { ...a.profile, funds: 100 };
  assert.ok(!purchaseExtraLine(poor).ok);
});

test('three lines laid in three places soak together; each is hauled and logged; going home hauls the rest first', () => {
  const p = createProfile({ worldSeed: 5, now: NOW });
  p.boat.slots.stern_troll = { uid: 'L1', itemId: 'longline_ll1' };
  p.extraLines = 2;
  const madai = { id: 'MD', species: 'madai', a: { x: 1150, y: 1900 }, counts: { s: 60, m: 100, l: 30 }, sigmaH: 300, sigmaZ: 2, activityOverride: 1, orbitR: 0 };
  const dep = markDeparture(p, NOW);
  const v = createVoyage(dep, { scenario: { conditions: CALM, schools: [madai] }, start: { x: 900, y: 1650, heading: 0 }, radio: [], method: 'longline' });
  v.world.time = 7 * 3600;
  assert.equal(v.equip.lineCount, 3);
  const lay = (x, y) => {
    if (x != null) {
      assert.ok(routeTo(v, { x, y }).ok);
      for (let i = 0; i < 2000 && v.autopilot; i++) advanceVoyage(v, 1);
      v.boat.heading = 0;
    }
    advanceVoyage(v, 3);
    const r = startOperation(v);
    assert.ok(r.ok && !r.haul, r.reason);
    for (let i = 0; i < 4000 && isOperating(v); i++) advanceVoyage(v, 1);
  };
  lay();
  assert.equal(freeLines(v), 2);
  lay(1150, 1650);
  lay(1400, 1650);
  assert.equal(linesInWater(v).length, 3);
  assert.equal(freeLines(v), 0);
  // no line free: Space goes to haul the nearest one
  assert.ok(canStartOperation(v).haul);
  advanceVoyage(v, 40 * 60);
  // a snapshot keeps the three lines (and which one is which)
  const snap = restoreVoyage(snapshotVoyage(v, NOW), dep.activeVoyage);
  assert.ok(snap.ok);
  assert.equal(snap.voyage.lines.length, 3);
  assert.ok(snap.voyage.lines.includes(snap.voyage.line));
  // haul line 2 by number, then go home: the other two are hauled first
  assert.ok(haulLongline(v, null, 2).ok);
  for (let i = 0; i < 8000 && (isOperating(v) || v.autopilot); i++) advanceVoyage(v, 1);
  assert.equal(soakingLines(v).length, 2);
  assert.equal(v.logs.filter((l) => l.methodId === 'longline').length, 1);
  assert.ok(returnToPort(v).ok);
  for (let i = 0; i < 40000 && v.phase !== 'docked'; i++) advanceVoyage(v, 1);
  assert.equal(v.phase, 'docked');
  assert.ok(!lineInWater(v));
  const logs = v.logs.filter((l) => l.methodId === 'longline');
  assert.equal(logs.length, 3);
  assert.ok(logs.reduce((a, l) => a + l.count, 0) > 0);
  assert.deepEqual(v.lines.map((l) => lineNo(v, l)), [1, 2, 3]);
  const s = settleVoyage(dep, summarizeVoyage(v));
  assert.ok(s.ok, s.reason);
});

test('a peer for ジギング too (R20), reporting from that day\'s sea', () => {
  assert.equal(PEERS.nakamura.method, 'jigging');
  let n = 0;
  for (let d = 3; d <= 30; d++) n += briefingReports(77, d).filter((r) => r.speaker === 'nakamura').length;
  assert.ok(n >= 25, `${n}`);
});
