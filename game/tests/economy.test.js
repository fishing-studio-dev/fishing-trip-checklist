// A11 transactions, A13 progress never blocked, XP rules, equipment effect.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProfile, markDeparture, validateProfile } from '../src/core/profile.js';
import { settleVoyage, purchaseEquipment, purchasePreview, equipFromStorage } from '../src/core/economy.js';
import { createVoyage, summarizeVoyage, advanceVoyage, startOperation, stopOperation, isOperating } from '../src/core/voyage.js';
import { EQUIPMENT, ECONOMY, PROGRESSION } from '../src/core/data.js';
import { voyageWith, fishFor, CALM } from './helpers.js';

const NOW = '2026-11-23T00:00:00.000Z';

function caughtVoyage(level = 1) {
  const { p, v } = voyageWith({ level });
  fishFor(v, 900);
  return { p, v, summary: summarizeVoyage(v) };
}

test('A11: settlement pays the catch once and records logs/XP', () => {
  const { p, summary } = caughtVoyage();
  assert.ok(summary.hold.count > 0);
  const res = settleVoyage(p, summary);
  assert.ok(res.ok);
  const r = res.receipt;
  assert.equal(r.sales, r.lines.reduce((a, l) => a + l.amount, 0));
  assert.equal(res.profile.funds, p.funds + r.sales - r.costs.paid);
  assert.equal(res.profile.methods.handline.xp, p.methods.handline.xp + r.xp.total);
  assert.equal(res.profile.logs.length, summary.logs.length);
  assert.equal(res.profile.activeVoyage, null);
  assert.deepEqual(validateProfile(res.profile), []);
  // the original profile is untouched (no half-applied state)
  assert.equal(p.funds, ECONOMY.startFunds);
  // second settlement of the same voyage is refused
  const again = settleVoyage(res.profile, summary);
  assert.equal(again.ok, false);
});

test('A11: settlement refuses a hold that does not match the operation logs', () => {
  const { p, summary } = caughtVoyage();
  const forged = { ...summary, hold: { ...summary.hold, counts: { ...summary.hold.counts, l: summary.hold.counts.l + 10 } } };
  const res = settleVoyage(p, forged);
  assert.equal(res.ok, false);
});

test('A13: a broke player with an empty hold can still go out again', () => {
  let p = createProfile({ worldSeed: 5, now: NOW });
  p.funds = 0;
  p = markDeparture(p, NOW);
  const v = createVoyage(p, { scenario: { conditions: CALM, schools: [] } });
  v.boat.distance = 12000;
  const res = settleVoyage(p, summarizeVoyage(v));
  assert.ok(res.ok);
  assert.equal(res.profile.funds, 0);
  assert.ok(res.receipt.costs.waived > 0);
  assert.doesNotThrow(() => markDeparture(res.profile, NOW));
});

test('XP cannot be farmed by start/stop spam or idling where there are no fish', () => {
  const { p, v } = voyageWith({ level: 1, schools: [] });
  advanceVoyage(v, 3);
  for (let i = 0; i < 30; i++) {
    startOperation(v);
    advanceVoyage(v, 5);
    stopOperation(v);
    while (isOperating(v)) advanceVoyage(v, 1);
  }
  // then idle with the rig down for three game hours
  startOperation(v);
  advanceVoyage(v, 3 * 3600);
  stopOperation(v);
  while (isOperating(v)) advanceVoyage(v, 1);
  const res = settleVoyage(p, summarizeVoyage(v));
  assert.ok(res.ok);
  assert.equal(res.receipt.xp.fishXp, 0);
  assert.ok(res.receipt.xp.total <= PROGRESSION.xpOpCapPerVoyage);
  // every operation is logged (no-catch ones included), each with a unique id
  const ids = res.profile.logs.map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.length, 31);
  assert.ok(res.profile.logs.every((l) => l.count === 0));
});

test('A11: purchase is all-or-nothing and the old item goes to storage', () => {
  const p = createProfile({ worldSeed: 1, now: NOW });
  const poor = purchaseEquipment(p, 'reel_electric', 'starboard_reel');
  assert.equal(poor.ok, false);
  assert.equal(p.funds, ECONOMY.startFunds);
  const rich = { ...p, funds: 20000 };
  const pv = purchasePreview(rich, 'reel_electric', 'starboard_reel');
  assert.ok(pv.ok);
  assert.equal(pv.fundsAfter, 20000 - EQUIPMENT.reel_electric.price);
  const res = purchaseEquipment(rich, 'reel_electric', 'starboard_reel');
  assert.ok(res.ok);
  assert.equal(res.profile.funds, 20000 - EQUIPMENT.reel_electric.price);
  assert.equal(res.profile.boat.slots.starboard_reel.itemId, 'reel_electric');
  assert.deepEqual(res.profile.storage.map((s) => s.itemId), ['reel_hand']);
  assert.deepEqual(validateProfile(res.profile), []);
  // buying the same thing again is refused
  assert.equal(purchaseEquipment(res.profile, 'reel_electric', 'starboard_reel').ok, false);
  // wrong slot type is refused
  assert.equal(purchaseEquipment(rich, 'reel_electric', 'helm_sounder').ok, false);
  // swapping from storage keeps every item exactly once
  const sw = equipFromStorage(res.profile, res.profile.storage[0].uid, 'starboard_reel');
  assert.ok(sw.ok);
  assert.equal(sw.profile.boat.slots.starboard_reel.itemId, 'reel_hand');
  assert.deepEqual(sw.profile.storage.map((s) => s.itemId), ['reel_electric']);
  assert.deepEqual(validateProfile(sw.profile), []);
});

test('purchases are refused while at sea', () => {
  const p = markDeparture({ ...createProfile({ worldSeed: 1, now: NOW }), funds: 50000 }, NOW);
  assert.equal(purchaseEquipment(p, 'reel_electric', 'starboard_reel').ok, false);
});

test('the purchased reel is what the next voyage actually fishes with', () => {
  const rich = { ...createProfile({ worldSeed: 1, now: NOW }), funds: 20000 };
  const bought = purchaseEquipment(rich, 'reel_electric', 'starboard_reel').profile;
  const p = markDeparture(bought, NOW);
  const v = createVoyage(p, { scenario: { conditions: CALM, schools: [] }, start: { x: 1500, y: 1500, heading: 0 } });
  advanceVoyage(v, 3);
  assert.ok(startOperation(v).ok);
  assert.equal(v.op.retrieveSpeed, EQUIPMENT.reel_electric.reel.retrieve);
  assert.equal(v.op.maxDepth, EQUIPMENT.reel_electric.reel.maxDepth);
});
