// M2: boats and fitted gear change what the next operation can do; buying,
// trading in, moving, storing and selling never duplicate or lose anything.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createProfile, markDeparture, validateProfile, PROFILE_SCHEMA } from '../src/core/profile.js';
import { planBoatPurchase, buyBoat, boatOffers, unmountToStorage, sellStored, equipFromStorage, settleVoyage } from '../src/core/economy.js';
import { createVoyage, advanceVoyage, startOperation, stopOperation, isOperating, summarizeVoyage } from '../src/core/voyage.js';
import { handlineNeedsHands } from '../src/core/fishing.js';
import { trollNeedsHands } from '../src/core/troll.js';
import { pingColumn } from '../src/core/sounder.js';
import { similarLogs } from '../src/core/knowledge.js';
import { EQUIPMENT, BOATS, BOAT_OFFERS, PROGRESSION, sellValue } from '../src/core/data.js';
import { loadSave, writeSave, memoryStorage, KEYS } from '../src/core/save.js';
import { CALM, denseSchool, sawaraSchool, fishFor, trollFor, totalFish, simHash } from './helpers.js';

const NOW = '2026-11-23T00:00:00.000Z';

/** Every equipment instance the player owns (boat + storage). */
function owned(p) {
  return [...Object.values(p.boat.slots).filter(Boolean), ...p.storage].map((i) => i.uid).sort();
}

function cruiserProfile({ reels = ['reel_hand'], troll = null, sounder = 'sounder_es1', level = 1, trollLevel = 1 } = {}) {
  const p = createProfile({ worldSeed: 1, now: NOW });
  p.methods.handline.xp = PROGRESSION.xpTable[level - 1];
  p.methods.troll.xp = PROGRESSION.xpTable[trollLevel - 1];
  p.boat.model = 'cruiser_2';
  p.boat.slots = {
    helm_sounder: { uid: 'x1', itemId: sounder },
    starboard_reel: { uid: 'x2', itemId: reels[0] },
    port_reel: reels[1] ? { uid: 'x3', itemId: reels[1] } : null,
    stern_troll: troll ? { uid: 'x4', itemId: troll } : null,
    deck_longline: null,
    starboard_hauler: null,
    hull_sonar: null,
    roof_lights: null,
  };
  assert.deepEqual(validateProfile(p), []);
  return p;
}

function voyageOf(p, { schools, start, method } = {}) {
  const v = createVoyage(markDeparture(p, NOW), { scenario: { conditions: CALM, schools }, start, method });
  v.world.time = 8 * 3600;
  v.nextTrackT = v.world.time + 10;
  return v;
}

test('A11: buying a used boat — trade-in, included gear, own gear moved or stored, all in one step', () => {
  const p = createProfile({ worldSeed: 1, now: NOW });
  p.funds = 100000;
  p.boat.slots.stern_troll = { uid: 'eqT', itemId: 'troll_tr1' };
  const before = owned(p);
  const plan = planBoatPurchase(p, 'used_cruiser_a');
  assert.ok(plan.ok, plan.reason);
  assert.equal(plan.payable, plan.price - BOATS.skiff_1.tradeIn);
  assert.equal(plan.moves.length, 3, 'every fitted item has a destination');
  const res = buyBoat(p, 'used_cruiser_a');
  assert.ok(res.ok);
  const q = res.profile;
  assert.equal(q.funds, 100000 - plan.payable);
  assert.equal(q.boat.model, 'cruiser_2');
  assert.equal(q.boat.name, p.boat.name, 'the boat keeps its name');
  assert.equal(q.boatHistory.length, 1);
  assert.equal(q.boatHistory[0].model, 'skiff_1');
  // the offer's own gear is fitted; mine went to the free stern slot or to storage
  assert.equal(q.boat.slots.port_reel.itemId, 'reel_hand');
  assert.equal(q.boat.slots.stern_troll.uid, 'eqT');
  const included = Object.keys(BOAT_OFFERS.find((o) => o.id === 'used_cruiser_a').included).length;
  assert.equal(owned(q).length, before.length + included, 'nothing lost, nothing duplicated');
  for (const uid of before) assert.ok(owned(q).includes(uid));
  assert.equal(new Set(owned(q)).size, owned(q).length);
  assert.deepEqual(validateProfile(q), []);
  // the original profile is untouched
  assert.equal(p.boat.model, 'skiff_1');
  assert.equal(p.funds, 100000);
});

test('a new boat comes empty: all gear moves over, nothing to storage', () => {
  const p = { ...createProfile({ worldSeed: 1, now: NOW }), funds: 200000 };
  p.boat.slots.stern_troll = { uid: 'eqT', itemId: 'troll_tr1' };
  const res = buyBoat(p, 'new_cruiser');
  assert.ok(res.ok);
  const q = res.profile;
  assert.equal(q.storage.length, 0);
  assert.equal(q.boat.slots.helm_sounder.uid, p.boat.slots.helm_sounder.uid);
  assert.equal(q.boat.slots.starboard_reel.uid, p.boat.slots.starboard_reel.uid);
  assert.equal(q.boat.slots.stern_troll.uid, 'eqT');
  assert.equal(q.boat.slots.port_reel, null);
  assert.deepEqual(res.receipt.standard, []);
});

test('downsizing: gear that has no place on the smaller boat goes to storage, with the reason; a basic sounder is fitted', () => {
  const p = { ...cruiserProfile({ reels: ['reel_electric', 'reel_hand'], troll: 'troll_tr2', sounder: 'sounder_es2' }), funds: 100000 };
  const before = owned(p);
  const plan = planBoatPurchase(p, 'new_skiff');
  assert.ok(plan.ok, plan.reason);
  const why = Object.fromEntries(plan.moves.map((m) => [m.itemId, m]));
  assert.equal(why.sounder_es2.to, null);
  assert.match(why.sounder_es2.why, /付けられる位置がない/);
  assert.equal(why.troll_tr2.to, null);
  assert.equal(why.reel_electric.to, 'starboard_reel');
  assert.equal(why.reel_hand.to, null, 'only one reel station on the small boat');
  assert.deepEqual(plan.standard, [{ slotId: 'helm_sounder', itemId: 'sounder_es1' }]);
  const q = buyBoat(p, 'new_skiff').profile;
  assert.deepEqual(validateProfile(q), []);
  assert.equal(owned(q).length, before.length + 1);
  for (const uid of before) assert.ok(owned(q).includes(uid));
  assert.deepEqual(q.storage.map((x) => x.itemId).sort(), ['reel_hand', 'sounder_es2', 'troll_tr2']);
});

test('boat purchase is refused without changes when it cannot be paid, at sea, or for the same model', () => {
  const p = createProfile({ worldSeed: 1, now: NOW });
  const poor = buyBoat(p, 'used_cruiser_a');
  assert.equal(poor.ok, false);
  assert.match(poor.reason, /足りません/);
  assert.equal(buyBoat({ ...p, funds: 999999, activeVoyage: { id: 'V1' } }, 'used_cruiser_a').ok, false);
  assert.equal(buyBoat({ ...p, funds: 999999 }, 'new_skiff').ok, false);
  assert.ok(boatOffers(p).every((o) => o.model !== 'skiff_1'));
});

test('A11: unmount, re-fit and sell from storage — each item exists exactly once, money changes once', () => {
  const p = cruiserProfile({ reels: ['reel_hand', 'reel_electric'], troll: 'troll_tr1' });
  assert.equal(unmountToStorage(p, 'helm_sounder').ok, false, 'the sounder cannot be left empty');
  const a = unmountToStorage(p, 'port_reel');
  assert.ok(a.ok);
  assert.equal(a.profile.boat.slots.port_reel, null);
  const stored = a.profile.storage.find((x) => x.itemId === 'reel_electric');
  // move it to the other station (互換装備の移設)
  const b = equipFromStorage(a.profile, stored.uid, 'starboard_reel');
  assert.ok(b.ok);
  assert.equal(b.profile.boat.slots.starboard_reel.itemId, 'reel_electric');
  assert.deepEqual(b.profile.storage.map((x) => x.itemId), ['reel_hand']);
  assert.deepEqual(owned(b.profile), owned(p));
  const hand = b.profile.storage[0];
  const c = sellStored(b.profile, hand.uid);
  assert.ok(c.ok);
  assert.equal(c.profile.funds, b.profile.funds + sellValue(EQUIPMENT.reel_hand));
  assert.equal(sellStored(c.profile, hand.uid).ok, false, 'cannot sell twice');
  assert.deepEqual(validateProfile(c.profile), []);
});

test('gear needing a larger mount cannot be fitted to the small boat', () => {
  const p = createProfile({ worldSeed: 1, now: NOW });
  p.storage.push({ uid: 'L1', itemId: 'sounder_es2' }, { uid: 'L2', itemId: 'troll_tr2' });
  assert.equal(equipFromStorage(p, 'L1', 'helm_sounder').ok, false);
  assert.equal(equipFromStorage(p, 'L2', 'stern_troll').ok, false);
});

test('the bigger hold and the boat\'s own fuel use apply to the next voyage', () => {
  const v = voyageOf(cruiserProfile(), { schools: [] });
  assert.equal(v.capacityKg, BOATS.cruiser_2.holdKg);
  v.boat.distance = 10000;
  const p = markDeparture(cruiserProfile(), NOW);
  const res = settleVoyage(p, { ...summarizeVoyage(v), id: p.activeVoyage.id });
  assert.ok(res.ok, res.reason);
  assert.equal(res.receipt.costs.fuel, 10 * BOATS.cruiser_2.fuelPerKm);
});

test('two reel stations land more; one fisher means hand reels share hands, electric reels free them', () => {
  const run = (reels, level = 1) => fishFor(voyageOf(cruiserProfile({ reels, level }), { schools: [denseSchool()], start: { x: 1500, y: 1500, heading: 0 } }), 600).count;
  const one = run(['reel_hand']);
  const twoHand = run(['reel_hand', 'reel_hand']);
  const twoElec = run(['reel_electric', 'reel_electric']);
  assert.ok(twoHand > one * 1.3, `${one} → ${twoHand}`);
  assert.ok(twoHand < one * 2, 'shared hands: less than double');
  assert.ok(twoElec > twoHand * 1.3, `electric pair ${twoElec} vs hand pair ${twoHand}`);
});

test('with two rigs the fisher never does two hand jobs at once, and fish are conserved', () => {
  for (const at of [77, 222, 431]) {
    const v = voyageOf(cruiserProfile({ reels: ['reel_hand', 'reel_hand'] }), { schools: [denseSchool()], start: { x: 1500, y: 1500, heading: 0 } });
    const before = totalFish(v.world);
    advanceVoyage(v, 3);
    assert.ok(startOperation(v).ok);
    assert.equal(v.op.lines.length, 2);
    for (let i = 0; i < at * 10; i++) {
      advanceVoyage(v, 0.1);
      const busy = v.op.lines.filter((l) => handlineNeedsHands(l) && !l.waiting && l.phase !== 'idle');
      assert.ok(busy.length <= 1, 'at most one hand job in progress');
    }
    stopOperation(v);
    while (isOperating(v)) advanceVoyage(v, 1);
    assert.equal(totalFish(v.world) + v.hold.count, before);
    assert.equal(v.logs[0].count, v.hold.count);
    assert.deepEqual(v.logs[0].gear.reels, ['reel_hand', 'reel_hand']);
  }
});

test('TR-2 (four lines) lands more than TR-1 through a dense school; hands are shared', () => {
  const big = [sawaraSchool({ counts: { s: 55, m: 37, l: 8 } })];
  const run = (troll, trollLevel) => {
    const v = voyageOf(cruiserProfile({ troll, trollLevel }), { schools: big, start: { x: 1500, y: 1100, heading: 0 }, method: 'troll' });
    const log = trollFor(v, 1800);
    return log.count;
  };
  const t1 = run('troll_tr1', 10);
  const t2 = run('troll_tr2', 10);
  assert.ok(t2 > t1, `TR-1 ${t1} → TR-2 ${t2}`);
  // never more than one line being handled at a time
  const v = voyageOf(cruiserProfile({ troll: 'troll_tr2' }), { schools: big, start: { x: 1500, y: 1100, heading: 0 }, method: 'troll' });
  const before = totalFish(v.world);
  trollFor(v, 600);
  assert.equal(v.op, null);
  assert.equal(totalFish(v.world) + v.hold.count, before);
  const v2 = voyageOf(cruiserProfile({ troll: 'troll_tr2' }), { schools: big, start: { x: 1500, y: 1100, heading: 0 }, method: 'troll' });
  v2.plannedRoute = [{ x: 1500, y: 1900 }];
  advanceVoyage(v2, 2);
  startOperation(v2);
  for (let i = 0; i < 6000; i++) {
    advanceVoyage(v2, 0.1);
    assert.ok(v2.op.lines.filter((l) => trollNeedsHands(l) && !l.waiting && l.phase !== 'idle').length <= 1);
  }
});

test('the large sounder (ES-2) shows a school\'s edge more strongly than ES-1 at the same spot', () => {
  const v = voyageOf(cruiserProfile(), { schools: [denseSchool()], start: { x: 1560, y: 1500, heading: 0 } });
  const a = pingColumn(v.world, 1560, 1500, EQUIPMENT.sounder_es1.sounder, 1);
  const b = pingColumn(v.world, 1560, 1500, EQUIPMENT.sounder_es2.sounder, 1);
  assert.ok(b.maxFish > a.maxFish + 0.05, `${a.maxFish} → ${b.maxFish}`);
  assert.equal(b.binSize, 0.25);
  // no school -> nothing for either
  const e = voyageOf(cruiserProfile(), { schools: [] });
  assert.ok(pingColumn(e.world, 1500, 1500, EQUIPMENT.sounder_es2.sounder, 1).maxFish === 0);
});

test('A07 on the medium boat with two rigs: one big advance equals many uneven frames', () => {
  const mk = () => voyageOf(cruiserProfile({ reels: ['reel_hand', 'reel_electric'] }), { schools: [denseSchool()], start: { x: 1500, y: 1500, heading: 0 } });
  const a = mk();
  const b = mk();
  advanceVoyage(a, 3);
  advanceVoyage(b, 3);
  startOperation(a);
  startOperation(b);
  let carry = advanceVoyage(a, 900);
  let cb = 0;
  for (let left = 900; left > 1e-9; left -= 0.37) cb = advanceVoyage(b, Math.min(0.37, left), cb);
  assert.ok(Math.abs(a.world.step - b.world.step) <= 1);
  while (a.world.step < b.world.step) carry = advanceVoyage(a, 0.1, carry);
  while (b.world.step < a.world.step) cb = advanceVoyage(b, 0.1, cb);
  assert.equal(simHash(a), simHash(b));
});

test('the logbook marks records made with a different boat or rigs', () => {
  const p = cruiserProfile({ reels: ['reel_electric', 'reel_electric'] });
  const old = { id: 'L1', day: 1, methodId: 'handline', area: '北の瀬', startT: 21600, durationS: 1800, count: 20, conditions: { tideName: '中潮', wind: { speed: 2 } }, gear: { boat: 'skiff_1', reel: 'reel_hand' }, level: 1 };
  const s = similarLogs([old], { methodId: 'handline', area: '北の瀬', forecast: { tideName: '中潮', windSpeed: 2 }, profile: p });
  assert.ok(s.lines.some((l) => /小型和船/.test(l) && /中型漁船/.test(l)), s.lines.join(' / '));
});

test('an M1 save (format 2) opens in the current format with everything kept, and the original is kept aside', () => {
  const raw = readFileSync(new URL('./e2e/fixtures/m1-save.json', import.meta.url), 'utf8');
  const st = memoryStorage({ [KEYS.main]: raw });
  const r = loadSave(st);
  assert.equal(r.status, 'ok', r.error);
  assert.equal(r.migratedFrom, 2);
  const p = r.profile;
  const orig = JSON.parse(raw).data;
  assert.equal(p.schema, PROFILE_SCHEMA);
  assert.equal(p.funds, orig.funds);
  assert.deepEqual(p.methods, { ...orig.methods, longline: { xp: 0 }, negyo: { xp: 0 }, oyogase: { xp: 0 }, ika: { xp: 0 } });
  assert.deepEqual(p.boat, { ...orig.boat, slots: { ...orig.boat.slots, starboard_hauler: null, roof_lights: null } }, 'the boat as it was, plus the new (empty) mountings');
  assert.deepEqual(p.logs, orig.logs);
  assert.deepEqual(p.knowledge, orig.knowledge);
  assert.deepEqual(p.boatHistory, []);
  assert.equal(st.getItem(r.preMigrationKey), raw);
  assert.ok(writeSave(st, p, r.revision, NOW).ok);
  assert.equal(loadSave(st).status, 'ok');
});
