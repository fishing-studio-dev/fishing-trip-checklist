// Item 1: saving at sea and resuming continues the voyage exactly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProfile, markDeparture } from '../src/core/profile.js';
import { createVoyage, advanceVoyage, startOperation, haulLongline, setMethod, summarizeVoyage, returnToPort } from '../src/core/voyage.js';
import { snapshotVoyage, restoreVoyage } from '../src/core/voyageSnapshot.js';
import { settleVoyage } from '../src/core/economy.js';
import { PROGRESSION } from '../src/core/data.js';
import { CALM, denseSchool, simHash } from './helpers.js';

const NOW = '2026-11-23T00:00:00.000Z';
const madai = { id: 'MD', species: 'madai', a: { x: 1150, y: 1900 }, counts: { s: 36, m: 66, l: 18 }, sigmaH: 150, sigmaZ: 2, activityOverride: 1, orbitR: 0 };

function setup() {
  const p = createProfile({ worldSeed: 5, now: NOW });
  p.methods.longline.xp = PROGRESSION.xpTable[3];
  p.boat.slots.stern_troll = { uid: 'L1', itemId: 'longline_ll1' };
  const dep = markDeparture(p, NOW, null, { crew: 1 });
  const v = createVoyage(dep, { scenario: { conditions: CALM, schools: [madai, denseSchool({ a: { x: 1150, y: 1450 } })] }, start: { x: 1150, y: 1580, heading: 0 }, method: 'longline' });
  v.world.time = 8 * 3600;
  v.nextTrackT = v.world.time + 10;
  return { dep, v };
}

/** A busy day: set a line, handline while it soaks, haul, go home. `pauseAt` = where the page closes. */
function day(pauseAt) {
  const { dep, v: v0 } = setup();
  let v = v0;
  const stages = [
    (x) => {
      advanceVoyage(x, 2);
      startOperation(x);
    },
    (x) => advanceVoyage(x, 700), // laying and soaking
    (x) => {
      x.autopilot = { kind: 'move', route: [{ x: 1150, y: 1450 }], leg: 0 };
      advanceVoyage(x, 300);
    },
    (x) => {
      setMethod(x, 'handline');
      advanceVoyage(x, 5);
      const r = startOperation(x);
      assert.ok(r.ok, r.reason);
      advanceVoyage(x, 433.3);
    },
    (x) => {
      haulLongline(x); // retrieves the handline first, then goes to the buoy and hauls
      advanceVoyage(x, 1500);
    },
    (x) => {
      returnToPort(x);
      advanceVoyage(x, 1800);
    },
  ];
  stages.forEach((stage, i) => {
    stage(v);
    if (i === pauseAt) {
      const raw = JSON.stringify(snapshotVoyage(v, NOW));
      const r = restoreVoyage(raw, dep.activeVoyage);
      assert.ok(r.ok, r.reason);
      v = r.voyage;
    }
  });
  return { dep, v };
}

test('closing the page at sea and coming back continues the voyage exactly (any moment)', () => {
  const straight = day(-1);
  for (let k = 0; k < 5; k++) {
    const resumed = day(k);
    assert.equal(simHash(resumed.v), simHash(straight.v), `paused after stage ${k}`);
    // compared as saved (JSON): a logged -0 and 0 are the same value
    assert.equal(JSON.stringify(resumed.v.logs), JSON.stringify(straight.v.logs));
    assert.equal(JSON.stringify(resumed.v.hold), JSON.stringify(straight.v.hold));
  }
  assert.equal(straight.v.phase, 'docked');
  assert.ok(straight.v.logs.length >= 2);
  const s = settleVoyage(straight.dep, summarizeVoyage(straight.v));
  assert.ok(s.ok, s.reason);
});

test('a snapshot only restores the voyage it belongs to, and a damaged one is refused', () => {
  const { dep, v } = setup();
  advanceVoyage(v, 30);
  const snap = snapshotVoyage(v, NOW);
  assert.ok(restoreVoyage(snap, dep.activeVoyage).ok);
  assert.equal(restoreVoyage(snap, { ...dep.activeVoyage, id: 'V9' }).ok, false);
  assert.equal(restoreVoyage(snap, null).ok, false);
  const bad = JSON.parse(JSON.stringify(snap));
  bad.data.hold.count += 5;
  assert.equal(restoreVoyage(bad, dep.activeVoyage).ok, false);
  assert.equal(restoreVoyage('{nope', dep.activeVoyage).ok, false);
});

test('the snapshot stays small enough for browser storage', () => {
  const { v } = day(-1);
  const size = JSON.stringify(snapshotVoyage(v, NOW)).length;
  assert.ok(size < 400000, `${size} bytes`);
});
