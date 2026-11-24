// M5: the far ground 沖の瀬, the small boat's navigation zone, and the line hauler.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProfile, markDeparture, validateProfile, PROFILE_SCHEMA } from '../src/core/profile.js';
import { createVoyage, advanceVoyage, setHelm, addRoutePoint, runRoute, startOperation, haulLongline, isOperating, lineInWater } from '../src/core/voyage.js';
import { purchaseEquipment, planBoatPurchase, buyBoat } from '../src/core/economy.js';
import { buildCandidates } from '../src/core/knowledge.js';
import { loadSave, writeSave, memoryStorage, KEYS, SAVE_SCHEMA } from '../src/core/save.js';
import { depthAt, areaNameAt, makeDayConditions, forecastOf } from '../src/core/sea.js';
import { dayPlan } from '../src/core/season.js';
import { hashString } from '../src/core/rng.js';
import { BOATS, PROGRESSION, AREA } from '../src/core/data.js';
import { CALM, totalFish } from './helpers.js';

const NOW = '2026-11-23T00:00:00.000Z';

function skiff() {
  return createProfile({ worldSeed: 5, now: NOW });
}

function cruiser({ longline = false, hauler = false, level = 1 } = {}) {
  const p = createProfile({ worldSeed: 5, now: NOW });
  p.methods.longline.xp = PROGRESSION.xpTable[level - 1];
  p.boat.model = 'cruiser_2';
  p.boat.slots = {
    helm_sounder: { uid: 'x1', itemId: 'sounder_es1' },
    starboard_reel: { uid: 'x2', itemId: 'reel_hand' },
    port_reel: null,
    stern_troll: null,
    deck_longline: longline ? { uid: 'x5', itemId: 'longline_ll1' } : null,
    starboard_hauler: hauler ? { uid: 'x6', itemId: 'hauler_lh1' } : null,
    hull_sonar: null,
    roof_lights: null,
  };
  assert.deepEqual(validateProfile(p), []);
  return p;
}

function voyage(p, { schools = [], start = { x: 1500, y: 2800, heading: 0 }, method } = {}) {
  const v = createVoyage(markDeparture(p, NOW), { scenario: { conditions: CALM, schools }, start, method });
  v.world.time = 7 * 3600;
  v.nextTrackT = v.world.time + 10;
  return v;
}

test('沖の瀬: a far reef (about 20-30 m on top, 60-80 m around), named on the chart, beyond the coastal zone', () => {
  assert.ok(AREA.H > 4000);
  const top = depthAt(1650, 4050);
  assert.ok(top > 15 && top < 32, `top ${top}`);
  assert.ok(depthAt(1650, 3500) > 55);
  assert.equal(areaNameAt(1650, 4050), '沖の瀬');
  assert.ok(4050 > BOATS.skiff_1.range.maxY);
  assert.equal(BOATS.cruiser_2.range.maxY, null);
});

test('the small boat is held at the edge of its navigation zone; it cannot plan a route beyond it', () => {
  const v = voyage(skiff());
  setHelm(v, { throttle: BOATS.skiff_1.steps.full });
  advanceVoyage(v, 120);
  assert.ok(v.boat.y <= BOATS.skiff_1.range.maxY + 1e-9);
  assert.ok(v.boat.atRangeLimit);
  const r = addRoutePoint(v, { x: 1650, y: 4050 });
  assert.equal(r.ok, false);
  assert.match(r.reason, /航行区域/);
});

test('the medium boat runs out to 沖の瀬 along a chart route', () => {
  const v = voyage(cruiser());
  assert.ok(addRoutePoint(v, { x: 1650, y: 3900 }).ok);
  assert.ok(runRoute(v).ok);
  for (let i = 0; i < 3000 && v.autopilot; i++) advanceVoyage(v, 1);
  assert.equal(areaNameAt(v.boat.x, v.boat.y), '沖の瀬');
  assert.ok(!v.boat.atRangeLimit);
});

test('fish on 沖の瀬: bigger アジ schools with more large fish than the coastal grounds; マダイ too', () => {
  let farN = 0;
  let farL = 0;
  let farDays = 0;
  let nearN = 0;
  let nearL = 0;
  let nearCount = 0;
  let madai = 0;
  for (const seed of [5, 77, 2026]) {
    for (let d = 7; d <= 36; d++) {
      for (const s of dayPlan(seed, d).schools) {
        const n = s.counts.s + s.counts.m + s.counts.l;
        if (s.species === 'aji' && s.habitat === 'okise') {
          farN += n;
          farL += s.counts.l;
          farDays += 1;
        } else if (s.species === 'aji') {
          nearN += n;
          nearL += s.counts.l;
          nearCount += 1;
        }
        if (s.species === 'madai' && s.habitat === 'okise') madai += 1;
      }
    }
  }
  assert.ok(farDays > 40, `アジ on 沖の瀬 on ${farDays} of 90 days`);
  assert.ok(farN / farDays > (nearN / nearCount) * 1.3, 'bigger schools');
  assert.ok(farL / farN > (nearL / nearN) * 1.4, 'more large fish');
  assert.ok(madai > 40);
});

test('candidates: 沖の瀬 is marked as needing a bigger boat for the small boat (never "unsuitable"), and is open to the medium boat', () => {
  const log = { id: 'L1', voyageId: 'V1', day: 1, methodId: 'handline', species: 'aji', startT: 21600, endT: 23400, durationS: 1800, start: { x: 1650, y: 4000 }, end: { x: 1660, y: 4010 }, area: '沖の瀬', bottom: { min: 25, max: 30 }, tana: { min: 20, max: 22 }, catches: { s: 1, m: 20, l: 20 }, count: 41, kg: 14, endReason: 'player', conditions: { t: 21600, tideName: '中潮', current: { x: 0, y: 0, speed: 0.1 }, wind: { x: 1, y: 1, speed: 2 }, waterTemp: 18.5 }, sounder: { pings: 100, echoRatio: 0.5, maxEcho: 1, echoDepth: 20 }, gear: { boat: 'cruiser_2', reels: ['reel_hand'] }, level: 1 };
  const fc = forecastOf(makeDayConditions(5, 9));
  for (const [p, ok] of [[skiff(), false], [cruiser(), true]]) {
    const c = buildCandidates({ knowledge: { reports: [], briefedDay: 9 }, logs: [log], today: 9, forecast: fc, profile: p }).find((x) => x.area === '沖の瀬');
    assert.ok(c, 'own record makes it a candidate');
    assert.equal(c.feasible.ok, ok);
    if (!ok) {
      assert.ok(c.labels.includes('船の買い替えが必要'));
      assert.match(c.feasible.reason, /航行区域/);
    }
    assert.ok(c.notes.some((n) => /沖の瀬：港から約4km/.test(n)));
  }
});

test('the line hauler winds the line faster than hands (at any level); the catch stays about the same; it is logged', () => {
  const madai = { id: 'MD', species: 'madai', a: { x: 1150, y: 1900 }, counts: { s: 36, m: 66, l: 18 }, sigmaH: 150, sigmaZ: 2, activityOverride: 1, orbitR: 0 };
  const run = (hauler, level) => {
    const v = voyage(cruiser({ longline: true, hauler, level }), { schools: [madai], start: { x: 1150, y: 1580, heading: 0 }, method: 'longline' });
    const before = totalFish(v.world);
    advanceVoyage(v, 2);
    assert.ok(startOperation(v).ok);
    while (isOperating(v)) advanceVoyage(v, 1);
    advanceVoyage(v, 2700);
    haulLongline(v);
    for (let i = 0; i < 3000 && !isOperating(v); i++) advanceVoyage(v, 1); // to the buoy
    assert.equal(!!v.op.machine, hauler);
    for (let i = 0; i < 40000 && (lineInWater(v) || isOperating(v) || v.autopilot); i++) advanceVoyage(v, 1);
    assert.equal(totalFish(v.world) + v.hold.count, before);
    return v.logs[v.logs.length - 1];
  };
  for (const level of [1, 10]) {
    const hand = run(false, level);
    const machine = run(true, level);
    assert.ok(machine.longline.haulMin < hand.longline.haulMin, `Lv${level}: ${hand.longline.haulMin} → ${machine.longline.haulMin} min`);
    // a slower hand haul leaves the last hooks soaking a little longer, so it may land one or two more
    assert.ok(Math.abs(machine.count - hand.count) <= 2, `${hand.count} vs ${machine.count}`);
    assert.equal(machine.gear.hauler, 'hauler_lh1');
    assert.equal(hand.gear.hauler, null);
  }
});

test('the hauler mounts on both boats (its own place); buying a boat moves it; it is not offered for other places', () => {
  let p = { ...skiff(), funds: 2000000 };
  const r = purchaseEquipment(p, 'hauler_lh1', 'starboard_hauler');
  assert.ok(r.ok, r.reason);
  p = r.profile;
  assert.equal(purchaseEquipment(p, 'hauler_lh1', 'stern_troll').ok, false);
  const plan = planBoatPurchase(p, 'new_cruiser');
  assert.equal(plan.moves.find((m) => m.itemId === 'hauler_lh1').to, 'starboard_hauler');
  const q = buyBoat(p, 'new_cruiser').profile;
  assert.deepEqual(validateProfile(q), []);
  assert.equal(q.boat.slots.starboard_hauler.itemId, 'hauler_lh1');
});

test('A12 (移行): an M3/M4 save (format 4) opens in M5 with an empty hauler mounting, everything else kept; the original is kept aside', () => {
  const p = { ...cruiser({ longline: true }), funds: 4321 };
  const v4 = JSON.parse(JSON.stringify(p));
  v4.schema = 4;
  delete v4.boat.slots.starboard_hauler;
  delete v4.boat.slots.hull_sonar;
  delete v4.boat.slots.roof_lights;
  const data = JSON.stringify(v4);
  const raw = JSON.stringify({ format: 'ryoshi-game-save', schemaVersion: 4, app: 'M4', revision: 9, savedAt: NOW, checksum: hashString(data), data: v4 });
  const st = memoryStorage({ [KEYS.main]: raw });
  const res = loadSave(st);
  assert.equal(res.status, 'ok', res.error);
  assert.equal(res.migratedFrom, 4);
  assert.ok(SAVE_SCHEMA >= 5);
  assert.equal(res.profile.schema, PROFILE_SCHEMA);
  assert.equal(res.profile.funds, 4321);
  assert.equal(res.profile.boat.slots.starboard_hauler, null);
  assert.deepEqual(res.profile.boat.slots.deck_longline, v4.boat.slots.deck_longline);
  assert.equal(st.getItem(res.preMigrationKey), raw);
  assert.ok(writeSave(st, res.profile, res.revision, NOW).ok);
  assert.equal(loadSave(st).migratedFrom, null);
});
