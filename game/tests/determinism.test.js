// A05 shared world, A06 UI independence, A07 time consistency.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { voyageWith, simHash, fishFor } from './helpers.js';
import { advanceVoyage, startOperation, summarizeVoyage, setHelm, redrift } from '../src/core/voyage.js';
import { createWorld, posesAt, densityAt, schoolPose } from '../src/core/world.js';
import { readTana } from '../src/core/sounder.js';
import { recentPace } from '../src/core/fishing.js';
import { forecastText, makeDayConditions } from '../src/core/sea.js';
import { METHODS } from '../src/core/data.js';
import { rngNext, createRng } from '../src/core/rng.js';

function scripted(v, chunker) {
  // a fixed sequence of decisions at fixed game times
  const plan = [
    [2, () => setHelm(v, { throttle: 2 })],
    [12, () => setHelm(v, { throttle: 1 })],
    [20, () => setHelm(v, { rudder: 1 })],
    [23, () => setHelm(v, { rudder: 0 })],
    [45, () => startOperation(v)],
    [700, () => redrift(v)],
  ];
  let t = 0;
  for (const [at, act] of plan) {
    chunker(v, at - t);
    act();
    t = at;
  }
  chunker(v, 1600 - t);
}

test('A07: identical results for one big advance vs. many uneven frame sizes', () => {
  const a = voyageWith({ conditions: { tideAmp: 0.3, windSpeed: 4, waterTemp: 19 }, start: { x: 1480, y: 1440, heading: 0 } }).v;
  const b = voyageWith({ conditions: { tideAmp: 0.3, windSpeed: 4, waterTemp: 19 }, start: { x: 1480, y: 1440, heading: 0 } }).v;
  let carryA = 0;
  scripted(a, (v, s) => {
    carryA = advanceVoyage(v, s, carryA);
  });
  // b: random-ish frame sizes like a variable frame rate with fast-forward toggles
  let carryB = 0;
  const rng = createRng(7);
  scripted(b, (v, s) => {
    let left = s;
    while (left > 1e-9) {
      const frame = Math.min(left, (rngNext(rng) * 0.1 + 0.001) * [6, 15, 60][Math.floor(rngNext(rng) * 3)]);
      carryB = advanceVoyage(v, frame, carryB);
      left -= frame;
    }
  });
  // carry differences are below one step; flush both to the same game time
  assert.ok(Math.abs(a.world.time - b.world.time) < 0.11);
  assert.equal(a.world.step, b.world.step);
  assert.equal(simHash(a), simHash(b));
  assert.ok(a.hold.count > 0, 'the scripted run actually caught fish');
});

test('A06: read-only UI queries between steps never change the sea or the catch', () => {
  const a = voyageWith().v;
  const b = voyageWith().v;
  advanceVoyage(a, 3);
  advanceVoyage(b, 3);
  startOperation(a);
  startOperation(b);
  for (let i = 0; i < 600; i++) {
    advanceVoyage(a, 1);
    advanceVoyage(b, 1);
    // what the HUD, chart, sounder and dev overlay read every frame
    posesAt(b.world);
    densityAt(b.world, b.boat.x, b.boat.y, 30);
    for (const s of b.world.schools) schoolPose(s, b.world.time);
    readTana(b.obs, METHODS.handline, 80);
    if (b.op) recentPace(b.op, b.world.time);
    summarizeVoyage(b);
    forecastText(b.world.cond);
  }
  assert.equal(simHash(a), simHash(b));
});

test('A05: the same seed and day always produce the same sea; other days differ', () => {
  const w1 = createWorld(1234, 3, 5 * 3600);
  const w2 = createWorld(1234, 3, 5 * 3600);
  const w3 = createWorld(1234, 4, 5 * 3600);
  assert.deepEqual(JSON.stringify(w1.schools), JSON.stringify(w2.schools));
  assert.notEqual(JSON.stringify(w1.schools), JSON.stringify(w3.schools));
  assert.deepEqual(makeDayConditions(1234, 3), makeDayConditions(1234, 3));
});

test('A05: sounder echo, catches and the log describe the same school at the same place', () => {
  const { v } = voyageWith();
  const log = fishFor(v, 600);
  assert.ok(log.count > 0);
  assert.ok(log.sounder.echoRatio > 0.5);
  // echo depth reported by the sounder lies within the school's layer
  const pose = schoolPose(v.world.schools[0], v.world.time);
  assert.ok(Math.abs(log.sounder.echoDepth - pose.z) < 3, `echo ${log.sounder.echoDepth} vs school ${pose.z}`);
  // and the fishing depth (tana) was set from that echo, within the gear's range
  assert.ok(log.tana.max <= pose.bottom && log.tana.min >= pose.z - 3);
});

test('schools move continuously with game time (no teleports)', () => {
  const w = createWorld(99, 1, 5 * 3600);
  for (const s of w.schools) {
    let prev = schoolPose(s, 5 * 3600);
    for (let t = 5 * 3600 + 10; t < 16 * 3600; t += 10) {
      const p = schoolPose(s, t);
      assert.ok(Math.hypot(p.x - prev.x, p.y - prev.y) < 5, 'horizontal step < 5 m per 10 s');
      prev = p;
    }
  }
});
