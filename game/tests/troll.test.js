// 曳縄 (trolling): A02 route matters, A03 growth, A04 limits, gear and route rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { voyageWith, trollFor, sawaraSchool, denseSchool, totalFish, fishFor } from './helpers.js';
import { setMethod, startOperation, addRoutePoint, advanceVoyage, isOperating, stopOperation, setHelm, canStartOperation } from '../src/core/voyage.js';

const START = { x: 1500, y: 1100, heading: 0 };
const W30 = 1800;

function trollRun(opts, seconds = W30) {
  const { v } = voyageWith({ troll: true, method: 'troll', schools: [sawaraSchool()], start: START, ...opts });
  const log = trollFor(v, seconds);
  return { v, log };
}

test('A02 (曳縄): a route through the school catches; 300 m off catches nothing', () => {
  const on = trollRun({}).log;
  const near = trollRun({ start: { ...START, x: 1730 } }).log;
  const off = trollRun({ start: { ...START, x: 1800 } }).log;
  assert.ok(on.count >= 5, `on route ${on.count}`);
  assert.ok(near.count < on.count, `230 m off ${near.count} < ${on.count}`);
  assert.equal(off.count, 0);
  assert.equal(on.species, 'sawara');
  assert.equal(on.methodId, 'troll');
});

test('A03 (曳縄): through a dense school, a higher trolling level lands more in the same time', () => {
  const big = [sawaraSchool({ counts: { s: 55, m: 37, l: 8 } })];
  const lv1 = trollRun({ trollLevel: 1, schools: big }).log.count;
  const lv10 = trollRun({ trollLevel: 10, schools: big }).log.count;
  assert.ok(lv10 >= lv1 * 1.3, `Lv1 ${lv1} → Lv10 ${lv10}`);
});

test('A04 (曳縄): no サワラ -> no catch; アジ are never taken by trolling, サワラ never by handline', () => {
  const none = trollRun({ trollLevel: 10, schools: [denseSchool({ a: { x: 1500, y: 1500 } })] }).log;
  assert.equal(none.count, 0, 'a bottom アジ school under the route gives nothing to the trolling lures');
  const { v } = voyageWith({ schools: [sawaraSchool({ fixedDepth: 20 })], start: { x: 1500, y: 1500, heading: 0 } });
  const hl = fishFor(v, 1200);
  assert.equal(hl.count, 0, 'the handline rig does not take サワラ');
});

test('A04 (曳縄): fish are conserved and the hold is never exceeded', () => {
  const { v } = voyageWith({ troll: true, method: 'troll', trollLevel: 10, schools: [sawaraSchool()], start: START, capacityKg: 10 });
  const before = totalFish(v.world);
  addRoutePoint(v, { x: 1500, y: 1900 });
  advanceVoyage(v, 2);
  assert.ok(startOperation(v).ok);
  let maxKg = 0;
  for (let i = 0; i < 7200 && isOperating(v); i++) {
    advanceVoyage(v, 1);
    maxKg = Math.max(maxKg, v.hold.kg);
  }
  assert.ok(maxKg <= 10 + 1e-9, `hold ${maxKg} <= 10`);
  assert.equal(v.logs[0].endReason, 'hold_full');
  assert.equal(totalFish(v.world) + v.hold.count, before);
});

test('trolling needs the gear on board; without it the method cannot be chosen or started', () => {
  const { v } = voyageWith({ schools: [sawaraSchool()], start: START });
  const r = setMethod(v, 'troll');
  assert.equal(r.ok, false);
  assert.match(r.reason, /曳縄具/);
  v.method = 'troll';
  assert.equal(canStartOperation(v).ok, false);
});

test('the route is the player\'s: the boat follows it and never turns toward fish by itself', () => {
  // school is 400 m east of a north-south route
  const { v } = voyageWith({ troll: true, method: 'troll', schools: [sawaraSchool({ a: { x: 1900, y: 1500 } })], start: START });
  addRoutePoint(v, { x: 1500, y: 1900 });
  advanceVoyage(v, 2);
  assert.ok(startOperation(v).ok);
  let maxDx = 0;
  for (let i = 0; i < 1800; i++) {
    advanceVoyage(v, 1);
    maxDx = Math.max(maxDx, Math.abs(v.boat.x - 1500));
  }
  assert.ok(maxDx < 60, `stayed on the chosen line (max off-line ${maxDx.toFixed(0)} m)`);
  assert.equal(v.hold.count, 0);
  // helm input is refused while trolling (no continuous manual steering needed)
  assert.equal(setHelm(v, { rudder: 1 }).ok, false);
  // the route can be changed at any time without stopping
  assert.ok(addRoutePoint(v, { x: 1900, y: 1500 }).ok);
  for (let i = 0; i < 1200; i++) advanceVoyage(v, 1);
  assert.ok(v.hold.count > 0, 'after re-routing over the school, fish are caught');
  stopOperation(v);
  while (isOperating(v)) advanceVoyage(v, 1);
  assert.equal(v.logs[0].troll.routeChanges, 1);
});

test('routes over land or outside the area are refused', () => {
  const { v } = voyageWith({ troll: true, method: 'troll', schools: [], start: { x: 1500, y: 600, heading: Math.PI } });
  assert.equal(addRoutePoint(v, { x: 1500, y: 20 }).ok, false, 'onto land');
  assert.equal(addRoutePoint(v, { x: 3500, y: 600 }).ok, false, 'outside the area');
  assert.ok(addRoutePoint(v, { x: 1800, y: 900 }).ok);
});

test('stopping a troll retrieves both lines; hooked fish are landed, not lost', () => {
  for (const at of [100, 333, 777]) {
    const { v } = voyageWith({ troll: true, method: 'troll', schools: [sawaraSchool()], start: START });
    const before = totalFish(v.world);
    addRoutePoint(v, { x: 1500, y: 1900 });
    advanceVoyage(v, 2);
    startOperation(v);
    advanceVoyage(v, at);
    stopOperation(v);
    while (isOperating(v)) advanceVoyage(v, 1);
    assert.equal(totalFish(v.world) + v.hold.count, before);
    assert.equal(v.logs[0].count, v.hold.count);
  }
});
