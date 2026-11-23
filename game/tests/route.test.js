// Chart routes for plain movement (any method): movement assistance only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProfile, markDeparture } from '../src/core/profile.js';
import { createVoyage, advanceVoyage, addRoutePoint, runRoute, setHelm, startOperation, isOperating, clearRoute } from '../src/core/voyage.js';
import { CALM, denseSchool, simHash } from './helpers.js';

const NOW = '2026-11-23T00:00:00.000Z';

function voyage(schools = []) {
  const p = createProfile({ worldSeed: 3, now: NOW });
  const v = createVoyage(markDeparture(p, NOW), { scenario: { conditions: CALM, schools }, start: { x: 1500, y: 900, heading: 0 } });
  v.world.time = 7 * 3600;
  v.nextTrackT = v.world.time + 10;
  return v;
}

function runUntil(v, done, max = 20000) {
  for (let i = 0; i < max && !done(); i++) advanceVoyage(v, 1);
}

test('a route drawn on the chart takes the boat through its points and stops at the end (一本釣りのときも)', () => {
  const v = voyage();
  assert.equal(v.method, 'handline');
  assert.ok(addRoutePoint(v, { x: 1500, y: 1400 }).ok);
  assert.ok(addRoutePoint(v, { x: 1900, y: 1700 }).ok);
  assert.ok(runRoute(v).ok);
  assert.equal(v.autopilot.kind, 'route');
  let passedFirst = false;
  runUntil(v, () => {
    if (Math.hypot(v.boat.x - 1500, v.boat.y - 1400) < 60) passedFirst = true;
    return !v.autopilot;
  });
  assert.ok(passedFirst, 'went through the first point');
  assert.ok(Math.hypot(v.boat.x - 1900, v.boat.y - 1700) < 40, `stopped at the end (${Math.round(v.boat.x)},${Math.round(v.boat.y)})`);
  assert.ok(Math.abs(v.boat.speed) < 0.5);
  assert.deepEqual(v.plannedRoute, [], 'the route is used up');
});

test('steering cancels the route movement but keeps the route; clearing the route stops it', () => {
  const v = voyage();
  addRoutePoint(v, { x: 1500, y: 2000 });
  runRoute(v);
  advanceVoyage(v, 30);
  assert.ok(setHelm(v, { rudder: 1 }).ok);
  assert.equal(v.autopilot, null);
  assert.equal(v.plannedRoute.length, 1);
  assert.ok(runRoute(v).ok);
  advanceVoyage(v, 10);
  clearRoute(v);
  assert.equal(v.autopilot, null);
  assert.equal(v.plannedRoute.length, 0);
});

test('during a handline drift, G retrieves first and then moves; routes over land are refused', () => {
  const v = voyage([denseSchool({ a: { x: 1500, y: 900 } })]);
  advanceVoyage(v, 5);
  assert.ok(startOperation(v).ok);
  advanceVoyage(v, 120);
  assert.ok(addRoutePoint(v, { x: 1700, y: 1300 }).ok, 'points can be planned while fishing');
  assert.ok(runRoute(v).ok);
  assert.ok(isOperating(v), 'retrieving first');
  runUntil(v, () => !isOperating(v));
  assert.equal(v.logs.length, 1);
  assert.equal(v.logs[0].endReason, 'move');
  assert.equal(v.autopilot.kind, 'route');
  runUntil(v, () => !v.autopilot);
  assert.ok(Math.hypot(v.boat.x - 1700, v.boat.y - 1300) < 40);
  const w = voyage();
  assert.equal(addRoutePoint(w, { x: 1500, y: 60 }).ok, false, 'on land');
  assert.equal(runRoute(w).ok, false, 'no route');
});

test('A07: route movement gives the same result for one big advance or many uneven frames', () => {
  const run = (chunks) => {
    const v = voyage();
    addRoutePoint(v, { x: 1300, y: 1500 });
    addRoutePoint(v, { x: 1800, y: 1900 });
    runRoute(v);
    let carry = 0;
    let left = 900;
    let i = 0;
    while (left > 1e-9) {
      const d = Math.min(chunks[i++ % chunks.length], left);
      carry = advanceVoyage(v, d, carry);
      left -= d;
    }
    return simHash(v);
  };
  assert.equal(run([900]), run([0.37, 2.1, 0.05]));
});

test('a route can be started from the dock (the shallow berth itself is not a route point)', () => {
  const p = createProfile({ worldSeed: 3, now: NOW });
  const v = createVoyage(markDeparture(p, NOW), { scenario: { conditions: CALM, schools: [] } });
  v.world.time = 6 * 3600;
  const target = { x: 900, y: 1500 };
  const r = addRoutePoint(v, target);
  assert.ok(r.ok, r.reason);
  assert.ok(runRoute(v).ok);
  runUntil(v, () => !v.autopilot, 30000);
  assert.ok(Math.hypot(v.boat.x - target.x, v.boat.y - target.y) < 40);
  assert.ok(!v.boat.grounded);
});
