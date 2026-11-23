// Shared fixtures for core tests: fixed sea conditions and schools so that the
// effect of position and level can be compared separately (handover §12).
import { createProfile, markDeparture } from '../src/core/profile.js';
import { createVoyage, advanceVoyage, startOperation, stopOperation, isOperating, addRoutePoint } from '../src/core/voyage.js';
import { PROGRESSION } from '../src/core/data.js';
import { hashString } from '../src/core/rng.js';

export const CALM = { tideAmp: 0, windSpeed: 0, waterTemp: 19 };

export function denseSchool(extra = {}) {
  return { id: 'T', a: { x: 1500, y: 1500 }, counts: { s: 100, m: 300, l: 100 }, sigmaH: 30, sigmaZ: 3, fixedOffBottom: 3, activityOverride: 1, orbitR: 0, ...extra };
}

export function sparseSchool(extra = {}) {
  return denseSchool({ counts: { s: 10, m: 30, l: 10 }, ...extra });
}

export function profileAt(level = 1, reel = 'reel_hand', seed = 42, { troll = false, trollLevel = 1 } = {}) {
  const p = createProfile({ worldSeed: seed, now: '2026-11-23T00:00:00.000Z' });
  p.methods.handline.xp = PROGRESSION.xpTable[level - 1];
  p.methods.troll.xp = PROGRESSION.xpTable[trollLevel - 1];
  p.boat.slots.starboard_reel.itemId = reel;
  if (troll) p.boat.slots.stern_troll = { uid: 'eqT', itemId: 'troll_tr1' };
  return p;
}

export function sawaraSchool(extra = {}) {
  return { id: 'SW', species: 'sawara', a: { x: 1500, y: 1500 }, counts: { s: 33, m: 22, l: 5 }, sigmaH: 95, sigmaZ: 4, fixedDepth: 5, activityOverride: 1, orbitR: 0, ...extra };
}

export function voyageWith({ level = 1, reel = 'reel_hand', schools = [denseSchool()], conditions = CALM, start = { x: 1500, y: 1500, heading: 0 }, time = 8 * 3600, capacityKg, troll = false, trollLevel = 1, method } = {}) {
  const p = markDeparture(profileAt(level, reel, 42, { troll, trollLevel }), '2026-11-23T00:00:00.000Z');
  const v = createVoyage(p, { scenario: { conditions, schools }, start, method });
  v.world.time = time;
  v.nextTrackT = time + 10;
  if (capacityKg != null) v.capacityKg = capacityKg;
  return { p, v };
}

/** Start at the current spot, fish for `seconds`, then retrieve and finish. */
export function fishFor(v, seconds) {
  advanceVoyage(v, 3); // a few pings first
  const r = startOperation(v);
  if (!r.ok) throw new Error(r.reason);
  advanceVoyage(v, seconds);
  if (isOperating(v) && v.op.state === 'running') stopOperation(v, 'player');
  let guard = 0;
  while (isOperating(v) && guard++ < 2000) advanceVoyage(v, 1);
  return v.logs[v.logs.length - 1];
}

export function totalFish(world) {
  return world.schools.reduce((a, s) => a + s.counts.s + s.counts.m + s.counts.l, 0);
}

/** Hash of everything the simulation owns (not UI). */
export function simHash(v) {
  return hashString(
    JSON.stringify({
      t: v.world.time.toFixed(6),
      step: v.world.step,
      rng: v.world.rng.s,
      schools: v.world.schools.map((s) => s.counts),
      boat: [v.boat.x.toFixed(6), v.boat.y.toFixed(6), v.boat.heading.toFixed(6), v.boat.speed.toFixed(6)],
      hold: v.hold,
      pings: v.obs.pingCount,
      lastCol: v.obs.cols.length ? Array.from(v.obs.cols[v.obs.cols.length - 1].bins).join(',') : '',
      logs: v.logs,
      op: v.op ? { lines: v.op.lines, landed: v.op.landed } : null,
    }),
  );
}

/** Troll back and forth between the start and (start.x, toY) for `seconds`, then retrieve. */
export function trollFor(v, seconds, toY = 1900) {
  addRoutePoint(v, { x: v.boat.x, y: toY });
  advanceVoyage(v, 2);
  const r = startOperation(v);
  if (!r.ok) throw new Error(r.reason);
  advanceVoyage(v, seconds);
  if (isOperating(v) && v.op.state === 'running') stopOperation(v, 'player');
  let guard = 0;
  while (isOperating(v) && guard++ < 3000) advanceVoyage(v, 1);
  return v.logs[v.logs.length - 1];
}
