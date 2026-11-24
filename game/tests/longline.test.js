// M3: 延縄 (bottom longline for マダイ) and the new save format.
// Place (A02), level (A03), limits and conservation (A04), time consistency
// (A07), the line soaking while the boat does something else, returning with
// the line in the water, equipment slots, peers' reports and the migration.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProfile, markDeparture, validateProfile, PROFILE_SCHEMA } from '../src/core/profile.js';
import {
  createVoyage, advanceVoyage, startOperation, stopOperation, setMethod, haulLongline, isOperating, lineInWater, returnToPort, summarizeVoyage, addRoutePoint,
} from '../src/core/voyage.js';
import { settleVoyage, purchaseEquipment, equipFromStorage, planBoatPurchase, buyBoat } from '../src/core/economy.js';
import { loadSave, memoryStorage, KEYS, SAVE_SCHEMA } from '../src/core/save.js';
import { briefingReports, radioReports } from '../src/core/reports.js';
import { createWorld, schoolPose, schoolTotal } from '../src/core/world.js';
import { hashString } from '../src/core/rng.js';
import { PROGRESSION, TIME, PEERS, EQUIPMENT } from '../src/core/data.js';
import { CALM, denseSchool, totalFish, simHash } from './helpers.js';

const NOW = '2026-11-23T00:00:00.000Z';

function madai(extra = {}) {
  return { id: 'MD', species: 'madai', a: { x: 1150, y: 1900 }, counts: { s: 36, m: 66, l: 18 }, sigmaH: 150, sigmaZ: 2, activityOverride: 1, orbitR: 0, ...extra };
}

function llProfile({ level = 1, boat = 'skiff_1', seed = 5 } = {}) {
  const p = createProfile({ worldSeed: seed, now: NOW });
  p.methods.longline.xp = PROGRESSION.xpTable[level - 1];
  if (boat === 'skiff_1') p.boat.slots.stern_troll = { uid: 'L1', itemId: 'longline_ll1' };
  else {
    p.boat.model = 'cruiser_2';
    p.boat.slots = {
      helm_sounder: { uid: 'x1', itemId: 'sounder_es1' },
      starboard_reel: { uid: 'x2', itemId: 'reel_hand' },
      port_reel: null,
      stern_troll: null,
      deck_longline: { uid: 'L1', itemId: 'longline_ll1' },
      starboard_hauler: null,
      hull_sonar: null,
      roof_lights: null,
    };
  }
  assert.deepEqual(validateProfile(p), []);
  return p;
}

function voyageOf(p, { schools = [madai()], start = { x: 1150, y: 1580, heading: 0 }, time = 8 * 3600, method = 'longline' } = {}) {
  const v = createVoyage(markDeparture(p, NOW), { scenario: { conditions: CALM, schools }, start, method });
  v.world.time = time;
  v.nextTrackT = time + 10;
  return v;
}

function runUntil(v, done, max = 40000) {
  for (let i = 0; i < max && !done(); i++) advanceVoyage(v, 1);
}

/** Lay the line straight ahead, soak, haul; returns the longline log. */
function setSoakHaul(v, soakS) {
  advanceVoyage(v, 2);
  const r = startOperation(v);
  assert.ok(r.ok, r.reason);
  runUntil(v, () => !isOperating(v));
  assert.equal(v.line.state, 'soaking');
  advanceVoyage(v, soakS);
  assert.ok(haulLongline(v).ok);
  runUntil(v, () => !lineInWater(v) && !isOperating(v) && !v.autopilot);
  return v.logs[v.logs.length - 1];
}

test('A02 (延縄): a line laid through the マダイ catches; the same line 400 m away catches nothing', () => {
  const on = setSoakHaul(voyageOf(llProfile()), 2700);
  const near = setSoakHaul(voyageOf(llProfile(), { start: { x: 1350, y: 1580, heading: 0 } }), 2700);
  const off = setSoakHaul(voyageOf(llProfile(), { start: { x: 1550, y: 1580, heading: 0 } }), 2700);
  assert.equal(on.methodId, 'longline');
  assert.equal(on.species, 'madai');
  assert.ok(on.count >= 6, `through the fish: ${on.count}`);
  assert.ok(near.count < on.count, `200 m off: ${near.count} < ${on.count}`);
  assert.equal(off.count, 0);
  assert.equal(on.longline.hooks, 100);
  assert.ok(on.longline.soakMin >= 44 && on.longline.soakMin <= 46);
});

test('A04 (延縄): an empty sea gives nothing at any soak; アジ are never caught; fish are conserved and the hold is never exceeded', () => {
  assert.equal(setSoakHaul(voyageOf(llProfile({ level: 10 }), { schools: [] }), 5400).count, 0);
  const ajiOnly = voyageOf(llProfile(), { schools: [denseSchool({ a: { x: 1150, y: 1900 } })] });
  assert.equal(setSoakHaul(ajiOnly, 3600).count, 0, 'the longline is for マダイ');
  for (const cap of [3, 1000]) {
    const v = voyageOf(llProfile());
    v.capacityKg = cap;
    const before = totalFish(v.world);
    advanceVoyage(v, 2);
    startOperation(v);
    for (let i = 0; i < 6000; i++) {
      advanceVoyage(v, 1);
      const hooked = v.line ? v.line.hooks.filter((h) => h.fish).length : 0;
      assert.equal(totalFish(v.world) + v.hold.count + hooked, before, 'every fish is in the sea, on a hook or in the hold');
      assert.ok(v.hold.kg <= cap + 1e-9, 'hold never exceeded');
      if (v.line && v.line.state === 'soaking' && i > 2400) haulLongline(v);
      if (v.line && v.line.state === 'aboard') break;
    }
    assert.equal(v.line.state, 'aboard');
    if (cap === 3) assert.ok(v.line.holdBlocked > 0, 'bites were refused when the hold was full');
  }
});

test('soak time matters but bait fades: more fish with a longer soak, with diminishing returns', () => {
  const at = (s) => setSoakHaul(voyageOf(llProfile({ level: 10 })), s).count;
  const c10 = at(600);
  const c60 = at(3600);
  const c150 = at(9000);
  assert.ok(c60 > c10, `10 min ${c10} < 60 min ${c60}`);
  assert.ok(c150 - c60 < c60 - c10, `gain 60→150 (${c150 - c60}) smaller than 10→60 (${c60 - c10})`);
});

test('A03 (延縄): in the same 3 hours a skilled hand sets and hauls more often and lands more', () => {
  const window3h = (level) => {
    const v = voyageOf(llProfile({ level }), { schools: [madai({ counts: { s: 60, m: 110, l: 30 } })], time: 7 * 3600 });
    const end = v.world.time + 3 * 3600;
    let sets = 0;
    advanceVoyage(v, 2);
    while (v.world.time < end) {
      v.autopilot = { kind: 'move', route: [{ x: 1150, y: 1560 }], leg: 0 };
      runUntil(v, () => !v.autopilot, 5000);
      v.boat.heading = 0;
      if (!startOperation(v).ok) break;
      runUntil(v, () => !isOperating(v));
      advanceVoyage(v, 1800);
      haulLongline(v);
      runUntil(v, () => !lineInWater(v) && !isOperating(v) && !v.autopilot);
      if (v.world.time <= end) sets += 1;
    }
    return { sets, fish: v.hold.count };
  };
  const lv1 = window3h(1);
  const lv10 = window3h(10);
  assert.ok(lv10.sets > lv1.sets, `sets ${lv1.sets} → ${lv10.sets}`);
  assert.ok(lv10.fish > lv1.fish * 1.15, `fish ${lv1.fish} → ${lv10.fish}`);
});

test('A07 (延縄): one big advance equals many uneven frames (set, soak, haul)', () => {
  const run = (chunks) => {
    const v = voyageOf(llProfile({ level: 4 }));
    advanceVoyage(v, 2);
    startOperation(v);
    let carry = 0;
    let left = 3000;
    let i = 0;
    while (left > 1e-9) {
      const d = Math.min(chunks[i++ % chunks.length], left);
      carry = advanceVoyage(v, d, carry);
      left -= d;
    }
    haulLongline(v);
    left = 2400;
    i = 0;
    while (left > 1e-9) {
      const d = Math.min(chunks[i++ % chunks.length], left);
      carry = advanceVoyage(v, d, carry);
      left -= d;
    }
    return simHash(v) + JSON.stringify(v.line.hooks.map((h) => [Math.round(h.x), Math.round(h.y), h.fish ? h.fish.rid : 0, h.up]));
  };
  assert.equal(run([3000]), run([0.37, 1.13, 0.05, 2.9]));
});

test('while the line soaks the boat is free: handline elsewhere, then haul — both catches are logged and settled once', () => {
  const p = llProfile();
  const v = voyageOf(p, { schools: [madai(), denseSchool({ a: { x: 1150, y: 1450 } })] });
  advanceVoyage(v, 2);
  assert.ok(startOperation(v).ok);
  runUntil(v, () => !isOperating(v));
  // run back to the アジ and fish them while the line soaks
  v.autopilot = { kind: 'move', route: [{ x: 1150, y: 1450 }], leg: 0 };
  runUntil(v, () => !v.autopilot);
  assert.ok(setMethod(v, 'handline').ok);
  advanceVoyage(v, 5);
  assert.ok(startOperation(v).ok, 'handline while the line is in the water');
  advanceVoyage(v, 900);
  // 揚げ縄: finishes the handline first, then goes to the buoy and hauls
  assert.ok(haulLongline(v).ok);
  runUntil(v, () => !lineInWater(v) && !isOperating(v) && !v.autopilot);
  const methods = v.logs.map((l) => l.methodId).sort();
  assert.deepEqual(methods, ['handline', 'longline']);
  assert.ok(v.logs.every((l) => l.count > 0), v.logs.map((l) => `${l.methodId}:${l.count}`).join(' '));
  returnToPort(v);
  runUntil(v, () => v.phase === 'docked');
  const s = settleVoyage(markDeparture(p, NOW), summarizeVoyage(v));
  assert.ok(s.ok, s.reason);
  assert.ok(s.receipt.xp.longline && s.receipt.xp.handline);
  assert.equal(s.profile.methods.longline.xp, PROGRESSION.xpTable[0] + s.receipt.xp.longline.total);
  assert.ok(s.receipt.lines.some((l) => l.species === 'madai') && s.receipt.lines.some((l) => l.species === 'aji'));
});

test('going home with the line in the water hauls it first; at day end too — the line is never left behind', () => {
  for (const forced of [false, true]) {
    const v = voyageOf(llProfile());
    advanceVoyage(v, 2);
    startOperation(v);
    runUntil(v, () => !isOperating(v));
    advanceVoyage(v, 600);
    v.autopilot = { kind: 'move', route: [{ x: 1500, y: 1300 }], leg: 0 };
    runUntil(v, () => !v.autopilot);
    if (forced) {
      v.world.time = TIME.END - 5;
      advanceVoyage(v, 10);
    } else assert.ok(returnToPort(v).ok);
    runUntil(v, () => v.phase === 'docked', 60000);
    assert.equal(v.phase, 'docked');
    assert.equal(v.line.state, 'aboard');
    assert.equal(v.logs.filter((l) => l.methodId === 'longline').length, 1);
    const fromLogs = v.logs.reduce((a, l) => a + l.count, 0);
    assert.equal(v.hold.count, fromLogs);
  }
});

test('setting needs the gear, enough deep water and a long enough route; setting and hauling cannot be abandoned midway', () => {
  const plain = createVoyage(markDeparture(createProfile({ worldSeed: 5, now: NOW }), NOW), { scenario: { conditions: CALM, schools: [] }, start: { x: 1150, y: 1580, heading: 0 } });
  assert.equal(setMethod(plain, 'longline').ok, false);
  // toward the shallows near the port: refused
  const v = voyageOf(llProfile(), { start: { x: 1500, y: 700, heading: Math.PI } });
  advanceVoyage(v, 2);
  const r = startOperation(v);
  assert.equal(r.ok, false);
  assert.match(r.reason, /浅い|陸|短い|張れません/);
  // a planned route that is too short
  const w = voyageOf(llProfile());
  assert.ok(addRoutePoint(w, { x: 1150, y: 1800 }).ok);
  advanceVoyage(w, 2);
  const r2 = startOperation(w);
  assert.equal(r2.ok, false);
  assert.match(r2.reason, /短い/);
  // a long enough planned route is used
  assert.ok(addRoutePoint(w, { x: 1300, y: 2250 }).ok);
  assert.ok(startOperation(w).ok);
  assert.equal(stopOperation(w).ok, false, 'setting is finished, not abandoned');
});

test('slots: the small boat carries trolling gear OR the longline on the stern; the medium boat has its own longline deck; gear moves with the boat', () => {
  let p = { ...createProfile({ worldSeed: 1, now: NOW }), funds: 2000000 };
  p = purchaseEquipment(p, 'troll_tr1', 'stern_troll').profile;
  const r = purchaseEquipment(p, 'longline_ll1', 'stern_troll');
  assert.ok(r.ok, r.reason);
  p = r.profile;
  assert.equal(p.boat.slots.stern_troll.itemId, 'longline_ll1');
  assert.deepEqual(p.storage.map((x) => x.itemId), ['troll_tr1'], 'the trolling gear went to storage');
  const back = equipFromStorage(p, p.storage[0].uid, 'stern_troll');
  assert.ok(back.ok);
  assert.equal(back.profile.boat.slots.stern_troll.itemId, 'troll_tr1');
  assert.deepEqual(back.profile.storage.map((x) => x.itemId), ['longline_ll1']);
  // buying the medium boat: the longline goes to its deck slot, the trolling gear to the stern
  const both = equipFromStorage(back.profile, back.profile.storage[0].uid, 'stern_troll').profile; // longline back on
  const q = { ...both, storage: [...both.storage] };
  const plan = planBoatPurchase(q, 'new_cruiser');
  assert.ok(plan.ok, plan.reason);
  const ll = plan.moves.find((m) => m.itemId === 'longline_ll1');
  assert.equal(ll.to, 'deck_longline');
  const bought = buyBoat(q, 'new_cruiser').profile;
  assert.deepEqual(validateProfile(bought), []);
  assert.equal(bought.boat.slots.deck_longline.itemId, 'longline_ll1');
  assert.ok(EQUIPMENT.longline_ll1.price > 0);
});

test('the medium boat sets and hauls from its longline deck as well', () => {
  const log = setSoakHaul(voyageOf(llProfile({ boat: 'cruiser_2' })), 2700);
  assert.ok(log.count > 0);
  assert.equal(log.gear.boat, 'cruiser_2');
  assert.equal(log.gear.longline, 'longline_ll1');
});

test('松じい talks from day 7 only; his reports match the world at the time (catch: マダイ were there; none: none within reach)', () => {
  const from = PEERS.matsu.fromDay;
  for (const seed of [5, 2026, 77]) {
    for (let d = 1; d <= 30; d++) {
      const reps = [...briefingReports(seed, d), ...radioReports(seed, d)].filter((r) => r.speaker === 'matsu' && !r.relayedFrom);
      if (d < from) {
        assert.equal(reps.length, 0, `day ${d}: not yet`);
        continue;
      }
      for (const r of reps) {
        if (r.kind === 'rule') continue;
        const w = createWorld(seed, r.obsDay, TIME.DEPART);
        const near = (radius) => w.schools.some((s) => s.species === 'madai' && schoolTotal(s) > 0 && Math.hypot(schoolPose(s, r.obsT).x - r.spot.x, schoolPose(s, r.obsT).y - r.spot.y) <= radius);
        if (r.kind === 'catch') assert.ok(near(60), `${r.id}: マダイ at ${r.spot.x},${r.spot.y}`);
        if (r.kind === 'none') assert.ok(!near(380), `${r.id}: really none`);
      }
    }
  }
});

/** A save exactly as M2 (format 3) wrote it, with the medium boat. */
function m2Save() {
  const p = llProfile({ boat: 'cruiser_2' });
  const v3 = JSON.parse(JSON.stringify(p));
  v3.schema = 3;
  delete v3.methods.longline;
  delete v3.boat.slots.deck_longline;
  delete v3.boat.slots.starboard_hauler;
  delete v3.boat.slots.hull_sonar;
  delete v3.boat.slots.roof_lights;
  v3.methods.handline.xp = 222;
  v3.funds = 43210;
  const data = JSON.stringify(v3);
  return { v3, raw: JSON.stringify({ format: 'ryoshi-game-save', schemaVersion: 3, app: 'M2', revision: 4, savedAt: NOW, checksum: hashString(data), data: v3 }) };
}

test('A12 (移行): an M2 save (format 3) opens in the current format: the longline method starts at 0, the medium boat gets an empty longline deck (and hauler mounting), everything else kept', () => {
  const st = memoryStorage();
  const { v3, raw } = m2Save();
  st.setItem(KEYS.main, raw);
  const r = loadSave(st);
  assert.equal(r.status, 'ok', r.error);
  assert.equal(r.migratedFrom, 3);
  assert.ok(SAVE_SCHEMA >= 4);
  const p = r.profile;
  assert.equal(p.schema, PROFILE_SCHEMA);
  assert.equal(p.funds, 43210);
  assert.equal(p.methods.handline.xp, 222);
  assert.equal(p.methods.longline.xp, 0);
  assert.equal(p.boat.slots.deck_longline, null);
  assert.equal(p.boat.slots.starboard_hauler, null);
  assert.deepEqual(p.boat.slots.starboard_reel, v3.boat.slots.starboard_reel);
  assert.deepEqual(validateProfile(p), []);
  assert.equal(st.getItem(r.preMigrationKey), raw);
});

test('a longline that brings up マダイ and アマダイ settles: the log keeps each fish by species (older logs without the split still settle)', () => {
  const amadai = { id: 'SA', species: 'shiroamadai', a: { x: 1150, y: 1900 }, counts: { s: 10, m: 30, l: 10 }, sigmaH: 150, sigmaZ: 2, activityOverride: 1, orbitR: 0 };
  const p = llProfile();
  const dep = markDeparture(p, NOW);
  const v = createVoyage(dep, { scenario: { conditions: CALM, schools: [madai(), amadai] }, start: { x: 1150, y: 1580, heading: 0 }, method: 'longline' });
  v.world.time = 8 * 3600;
  v.nextTrackT = v.world.time + 10;
  const log = setSoakHaul(v, 2700);
  assert.ok(log.bySpecies && log.bySpecies.madai && log.bySpecies.shiroamadai, JSON.stringify(log.bySpecies));
  for (const sp of ['madai', 'shiroamadai']) assert.deepEqual(log.bySpecies[sp], v.hold.counts[sp]);
  returnToPort(v);
  runUntil(v, () => v.phase === 'docked');
  const sum = summarizeVoyage(v);
  const s = settleVoyage(dep, sum);
  assert.ok(s.ok, s.reason);
  assert.ok(s.profile.records.shiroamadai && s.profile.records.madai);
  // a log written before the split (everything under マダイ) still settles when the sizes add up …
  const old = JSON.parse(JSON.stringify(sum));
  for (const l of old.logs) delete l.bySpecies;
  assert.ok(settleVoyage(dep, old).ok);
  // … but a hold that does not match the logs is still refused
  old.hold.counts.madai.m += 1;
  assert.equal(settleVoyage(dep, old).ok, false);
});
