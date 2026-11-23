// A fixed example pass for the equipment screen: the same water, at the same
// time, seen through two sounders. Its own little world (not the player's sea,
// not the voyage RNG) so the comparison is fair and identical every time.
import { createWorld } from '../core/world.js';
import { createObservation, pingColumn, pushColumn } from '../core/sounder.js';

const DEMO_SCHOOLS = [
  // a compact アジ school 6 m over the bottom
  { id: 'A', species: 'aji', a: { x: 1465, y: 1300 }, counts: { s: 30, m: 90, l: 30 }, sigmaH: 10, sigmaZ: 1.8, fixedOffBottom: 6, activityOverride: 1, orbitR: 0 },
  // a small school higher up, a little further on
  { id: 'B', species: 'aji', a: { x: 1500, y: 1300 }, counts: { s: 10, m: 20, l: 5 }, sigmaH: 6, sigmaZ: 1.2, fixedOffBottom: 15, activityOverride: 1, orbitR: 0 },
  // マダイ thinly spread just over the bottom
  { id: 'C', species: 'madai', a: { x: 1560, y: 1300 }, counts: { s: 15, m: 30, l: 10 }, sigmaH: 45, sigmaZ: 1.4, fixedOffBottom: 1.2, activityOverride: 1, orbitR: 0 },
];

const cache = new Map();

/** Observation of a 180 s pass at 1 m/s over the example schools. */
export function demoObservation(spec) {
  const key = JSON.stringify(spec);
  if (cache.has(key)) return cache.get(key);
  const world = createWorld(1, 50, 8 * 3600, { conditions: { tideAmp: 0, windSpeed: 0, waterTemp: 19 }, schools: DEMO_SCHOOLS });
  const obs = createObservation();
  for (let i = 0; i < 360; i++) {
    world.time = 8 * 3600 + i * 0.5;
    pushColumn(obs, pingColumn(world, 1420 + i * 0.5, 1300, spec, i));
  }
  cache.set(key, obs);
  return obs;
}
