// A02 position matters, A03 growth matters, A04 catch limits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { voyageWith, fishFor, denseSchool, sparseSchool, totalFish } from './helpers.js';
import { advanceVoyage, startOperation, stopOperation, isOperating } from '../src/core/voyage.js';

const TEN_MIN = 600;

test('A02: same boat and level — on the school catches, 150 m off catches nothing', () => {
  const on = fishFor(voyageWith({ level: 1 }).v, TEN_MIN);
  const near = fishFor(voyageWith({ level: 1, start: { x: 1560, y: 1500, heading: 0 } }).v, TEN_MIN);
  const off = fishFor(voyageWith({ level: 1, start: { x: 1650, y: 1500, heading: 0 } }).v, TEN_MIN);
  assert.ok(on.count >= 5, `on-school catch ${on.count}`);
  assert.ok(near.count < on.count, `edge ${near.count} < centre ${on.count}`);
  assert.equal(off.count, 0);
  // the sounder saw the school where it was fished, and nothing where it wasn't
  assert.ok(on.sounder.echoRatio > 0.8);
  assert.equal(off.sounder.echoRatio, 0);
});

test('A03: with plenty of fish, higher level handles more in the same time', () => {
  const lv1 = fishFor(voyageWith({ level: 1 }).v, TEN_MIN).count;
  const lv5 = fishFor(voyageWith({ level: 5 }).v, TEN_MIN).count;
  const lv10 = fishFor(voyageWith({ level: 10 }).v, TEN_MIN).count;
  assert.ok(lv1 < lv5 && lv5 < lv10, `${lv1} < ${lv5} < ${lv10}`);
  assert.ok(lv10 / lv1 >= 1.4, `growth ratio ${lv10 / lv1}`);
});

test('A03: equipment (electric reel) raises handling at the same level', () => {
  const hand = fishFor(voyageWith({ level: 3, reel: 'reel_hand' }).v, TEN_MIN).count;
  const elec = fishFor(voyageWith({ level: 3, reel: 'reel_electric' }).v, TEN_MIN).count;
  assert.ok(elec > hand, `electric ${elec} > hand ${hand}`);
});

test('A03: where fish are scarce, level matters much less (bounded by candidates)', () => {
  const dense1 = fishFor(voyageWith({ level: 1 }).v, TEN_MIN * 2).count;
  const dense10 = fishFor(voyageWith({ level: 10 }).v, TEN_MIN * 2).count;
  const sparse1 = fishFor(voyageWith({ level: 1, schools: [sparseSchool()] }).v, TEN_MIN * 2).count;
  const sparse10 = fishFor(voyageWith({ level: 10, schools: [sparseSchool()] }).v, TEN_MIN * 2).count;
  assert.ok(dense10 - dense1 > sparse10 - sparse1, `dense gain ${dense10 - dense1} vs sparse gain ${sparse10 - sparse1}`);
  assert.ok(sparse10 < dense1, 'a good spot at Lv1 beats a poor spot at Lv10');
});

test('A04: no fish -> no catch at max level with the best reel', () => {
  const log = fishFor(voyageWith({ level: 10, reel: 'reel_electric', schools: [] }).v, TEN_MIN * 3);
  assert.equal(log.count, 0);
  assert.equal(log.kg, 0);
});

test('A04: catch never exceeds the school and fish are conserved (no double take)', () => {
  const { v } = voyageWith({ level: 10, reel: 'reel_electric', schools: [denseSchool({ counts: { s: 0, m: 6, l: 0 } })] });
  const before = totalFish(v.world);
  const log = fishFor(v, TEN_MIN * 4);
  assert.ok(log.count <= 6);
  assert.equal(totalFish(v.world) + v.hold.count, before);
  assert.equal(v.hold.count, log.count);
});

test('A04: hold capacity is never exceeded; operation stops itself when full', () => {
  const { v } = voyageWith({ level: 10, reel: 'reel_electric', capacityKg: 3 });
  advanceVoyage(v, 3);
  assert.ok(startOperation(v).ok);
  let maxKg = 0;
  for (let i = 0; i < 3600 && isOperating(v); i++) {
    advanceVoyage(v, 1);
    maxKg = Math.max(maxKg, v.hold.kg);
  }
  assert.equal(isOperating(v), false);
  assert.ok(maxKg <= 3 + 1e-9, `hold ${maxKg}kg <= 3kg`);
  assert.equal(v.logs[0].endReason, 'hold_full');
});

test('stop at any moment retrieves the rig: hooked fish are landed, not lost or duplicated', () => {
  for (const at of [12.3, 47.3, 61.9, 95.5, 140.1]) {
    const { v } = voyageWith({ level: 1 });
    const before = totalFish(v.world);
    advanceVoyage(v, 3);
    assert.ok(startOperation(v).ok);
    advanceVoyage(v, at);
    stopOperation(v, 'player');
    while (isOperating(v)) advanceVoyage(v, 1);
    assert.equal(totalFish(v.world) + v.hold.count, before, `conservation when stopped at ${at}s`);
    assert.equal(v.logs[0].count, v.hold.count);
  }
});
