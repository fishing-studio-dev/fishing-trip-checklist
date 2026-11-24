// Item 6: 根魚（カサゴ・キジハタ・アラ） on the small structures, and 根魚釣り —
// a pinpoint method: over the structure it catches, a little way off it does not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProfile, markDeparture, validateProfile, migrateProfile6to7, migrateProfile7to8, PROFILE_SCHEMA } from '../src/core/profile.js';
import { createVoyage, advanceVoyage, startOperation, stopOperation, isOperating, setMethod, summarizeVoyage, returnToPort, redrift } from '../src/core/voyage.js';
import { settleVoyage } from '../src/core/economy.js';
import { reefSchools } from '../src/core/season.js';
import { createWorld, densityAt, schoolTotal } from '../src/core/world.js';
import { STRUCTURES, depthAt, bottomIsRocky } from '../src/core/sea.js';
import { PROGRESSION, METHODS, TIME } from '../src/core/data.js';
import { CALM } from './helpers.js';

const NOW = '2026-11-23T00:00:00.000Z';
const SEED = 77;
const DAY = 9;
const g1 = STRUCTURES.find((s) => s.id === 'g1');
const n2 = STRUCTURES.find((s) => s.id === 'n2');

function profile(level = 1, reel = 'reel_hand') {
  const p = createProfile({ worldSeed: SEED, now: NOW });
  p.day = DAY - 1;
  p.methods.negyo.xp = PROGRESSION.xpTable[level - 1];
  p.boat.slots.starboard_reel.itemId = reel;
  return p;
}

/** A voyage stopped at (x, y) in still water with only the 根魚 of that day in the sea. */
function atSpot(x, y, { level = 1, reel = 'reel_hand', tide = 0 } = {}) {
  const dep = markDeparture(profile(level, reel), NOW);
  const schools = reefSchools(SEED, dep.activeVoyage.day);
  const v = createVoyage(dep, { scenario: { conditions: { ...CALM, tideAmp: tide }, schools }, start: { x, y, heading: 0 }, radio: [] });
  v.world.time = 7 * 3600;
  assert.ok(setMethod(v, 'negyo').ok);
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

const reefTotal = (v, placeId) => v.world.schools.filter((s) => s.habitat === placeId).reduce((a, s) => a + schoolTotal(s), 0);
const initialTotal = (v, placeId) => v.world.schools.filter((s) => s.habitat === placeId).reduce((a, s) => a + s.initial.s + s.initial.m + s.initial.l, 0);

test('根魚 sit right on the structures: dense just over the rocks, nothing a little way off, invisible to the アジ handline', () => {
  const w = createWorld(SEED, DAY, 7 * 3600);
  const on = densityAt(w, g1.x, g1.y, depthAt(g1.x, g1.y) - 0.7, null, ['kasago', 'kijihata', 'ara']);
  assert.ok(on.total > 0.002, `on the reef ${on.total}`);
  // up in the water column over the same spot: nothing
  assert.equal(densityAt(w, g1.x, g1.y, depthAt(g1.x, g1.y) - 8, null, ['kasago', 'kijihata', 'ara']).total, 0);
  // 60 m off the 漁礁: nothing
  assert.equal(densityAt(w, g1.x + 60, g1.y, depthAt(g1.x + 60, g1.y) - 0.7, null, ['kasago', 'kijihata', 'ara']).total, 0);
  // the アジ handline only ever reads マアジ
  assert.equal(densityAt(w, g1.x, g1.y, depthAt(g1.x, g1.y) - 0.7, null, 'aji').total, 0);
  // アラ only on the big 根
  const ara = w.schools.filter((s) => s.species === 'ara');
  assert.ok(ara.length > 0 && ara.every((s) => /^n\d|okise_rock/.test(s.habitat)), ara.map((s) => s.habitat).join(','));
});

test('根魚釣り is pinpoint: over the 漁礁 it catches, 50 m off it catches nothing', () => {
  const over = atSpot(g1.x, g1.y).v;
  const logOver = fish(over, 15 * 60);
  assert.ok(logOver.count >= 4, `over the reef ${logOver.count}`);
  assert.ok(logOver.bySpecies && (logOver.bySpecies.kasago || logOver.bySpecies.kijihata));
  const off = atSpot(g1.x + 50, g1.y).v;
  const logOff = fish(off, 15 * 60);
  assert.equal(logOff.count, 0);
  // landed never exceeds what lived there; the rest is still on the reef
  assert.ok(logOver.count + reefTotal(over, 'g1') === initialTotal(over, 'g1'));
});

test('the rig follows the bottom: the sinker stays just off the rocks as the boat drifts across the 根', () => {
  const { v } = atSpot(n2.x - 30, n2.y, { tide: 0.25 });
  assert.ok(startOperation(v).ok);
  const seen = [];
  for (let i = 0; i < 240; i++) {
    advanceVoyage(v, 1);
    const line = v.op.lines[0];
    if (line.phase === 'fish') seen.push(depthAt(v.boat.x, v.boat.y) - line.tana);
  }
  assert.ok(seen.length > 30);
  assert.ok(seen.every((d) => Math.abs(d - METHODS.negyo.bottomLift) < 0.01), `gap ${Math.min(...seen)}..${Math.max(...seen)}`);
});

test('根掛かり: on rock the rig sometimes snags and is re-tied (time lost), less often with skill; hooked fish go back to the reef', () => {
  // the wide rocky top of 西の根: the boat stays over rock for the whole hour
  const runs = [1, 10].map((level) => {
    const { v } = atSpot(650, 1350, { level });
    const log = fish(v, 60 * 60);
    assert.ok(bottomIsRocky(v.boat.x, v.boat.y));
    return { level, snags: log.snags, count: log.count, lost: log.lostFish, v };
  });
  const [lo, hi] = runs;
  assert.ok(lo.snags >= 4, `Lv1 snags ${lo.snags}`);
  assert.ok(hi.snags < lo.snags, `Lv1 ${lo.snags} vs Lv10 ${hi.snags}`);
  for (const r of runs) assert.equal(r.count + reefTotal(r.v, 'nishi_rock'), initialTotal(r.v, 'nishi_rock'), 'lost fish are back on the rocks');
});

test('drifting off the pinpoint stops the bites; 流し直し brings the boat back up to where the drift began', () => {
  const { v } = atSpot(g1.x, g1.y - 15, { tide: 0.3 });
  const first = fish(v, 10 * 60);
  const drifted = Math.hypot(v.boat.x - g1.x, v.boat.y - g1.y);
  assert.ok(drifted > 60, `drifted ${Math.round(drifted)} m`);
  const r = redrift(v);
  assert.ok(r.ok, r.reason);
  for (let i = 0; i < 300 && v.autopilot; i++) advanceVoyage(v, 1);
  assert.ok(Math.hypot(v.boat.x - first.start.x, v.boat.y - first.start.y) < 40);
});

test('landing: 根魚 are sold at their own prices, logged by species, and the experience goes to 根魚釣り', () => {
  const { dep, v } = atSpot(g1.x, g1.y);
  const log = fish(v, 20 * 60);
  assert.ok(log.count > 0);
  returnToPort(v);
  for (let i = 0; i < 6000 && v.phase !== 'docked'; i++) advanceVoyage(v, 1);
  const s = settleVoyage(dep, summarizeVoyage(v));
  assert.ok(s.ok, s.reason);
  assert.ok(s.receipt.lines.some((l) => /カサゴ|キジハタ/.test(l.label || l.name || JSON.stringify(l))), JSON.stringify(s.receipt.lines).slice(0, 200));
  assert.ok(s.profile.methods.negyo.xp > dep.methods.negyo.xp);
  assert.equal(s.profile.methods.handline.xp, dep.methods.handline.xp);
  assert.deepEqual(validateProfile(s.profile), []);
  void TIME;
});

test('A12 (移行): a format-6 save gets 根魚釣り・泳がせ・イカ釣り experience at 0, nothing else changes', () => {
  const p6 = createProfile({ worldSeed: 1, now: NOW });
  p6.schema = 6;
  delete p6.methods.negyo;
  delete p6.methods.oyogase;
  delete p6.methods.ika;
  p6.methods.handline.xp = 123;
  const p7 = migrateProfile6to7(p6);
  assert.equal(p7.schema, 7);
  assert.ok(PROFILE_SCHEMA >= 7);
  assert.deepEqual(p7.methods.negyo, { xp: 0 });
  assert.equal(p7.methods.handline.xp, 123);
  assert.deepEqual(validateProfile(migrateProfile7to8(p7)), []); // valid once brought to the current format
});

test('a 根魚 log with several species settles: each species is matched against the hold and sold', () => {
  const reef = (species) => ({ id: `R-${species}`, species, a: { x: g1.x, y: g1.y }, counts: { s: 4, m: 4, l: 2 }, sigmaH: 15, sigmaZ: 1, activityOverride: 1, orbitR: 0 });
  const dep = markDeparture(profile(), NOW);
  const v = createVoyage(dep, { scenario: { conditions: CALM, schools: [reef('kasago'), reef('kijihata')] }, start: { x: g1.x, y: g1.y, heading: 0 }, radio: [] });
  v.world.time = 7 * 3600;
  assert.ok(setMethod(v, 'negyo').ok);
  advanceVoyage(v, 3);
  const log = fish(v, 30 * 60);
  assert.ok(Object.keys(log.bySpecies).length >= 2, JSON.stringify(log.bySpecies));
  returnToPort(v);
  for (let i = 0; i < 6000 && v.phase !== 'docked'; i++) advanceVoyage(v, 1);
  const s = settleVoyage(dep, summarizeVoyage(v));
  assert.ok(s.ok, s.reason);
  const species = new Set(s.receipt.lines.map((l) => l.species));
  assert.ok(species.has('kasago') && species.has('kijihata'), [...species].join(','));
});
