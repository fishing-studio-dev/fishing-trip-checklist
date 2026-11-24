// Searchlight / scanning sonar (ソナー): looks sideways through the water all
// around the boat, out to hundreds of metres. A beam turns step by step (one
// bearing per simulation step), so the picture builds up the same way at any
// frame rate. Each cell reads the shared world: fish density in the water
// column, and hard returns where a small structure stands up off the bottom.
// It shows where something is — never what species it is.
import { depthAt, baseDepthAt } from './sea.js';
import { echoDensityAt, posesAt } from './world.js';

export const SONAR_BEAMS = 72; // 5° each
export const SONAR_BINS = 40;

export function createSonar(spec) {
  return { range: spec.ranges[1], ranges: spec.ranges.slice(), beam: 0, data: new Array(SONAR_BEAMS * SONAR_BINS).fill(0), gain: spec.gain, heading: 0 };
}

/** Turn the beam one step and fill that bearing (relative to the bow). */
export function stepSonar(sonar, world, boat) {
  const b = sonar.beam;
  const rel = (b / SONAR_BEAMS) * Math.PI * 2;
  const ang = boat.heading + rel;
  const sx = Math.sin(ang);
  const sy = Math.cos(ang);
  const poses = posesAt(world);
  for (let k = 0; k < SONAR_BINS; k++) {
    const r = ((k + 0.5) / SONAR_BINS) * sonar.range;
    const x = boat.x + sx * r;
    const y = boat.y + sy * r;
    const bottom = depthAt(x, y);
    // the water column at three depths
    let rho = 0;
    for (const f of [0.25, 0.55, 0.85]) rho += echoDensityAt(world, x, y, Math.max(1.5, bottom * f), poses);
    let v = 1 - Math.exp(-(rho / 3) * sonar.gain);
    // hard return from a structure standing up off the bottom
    const relief = baseDepthAt(x, y) - bottom;
    if (relief > 2) v = Math.max(v, Math.min(0.9, 0.35 + relief * 0.03));
    sonar.data[b * SONAR_BINS + k] = Math.round(Math.min(1, v) * 255);
  }
  sonar.beam = (b + 1) % SONAR_BEAMS;
}

/** World position of a point on the sonar picture (bearing from the bow, distance). */
export function sonarToWorld(boat, relAngle, dist) {
  const a = boat.heading + relAngle;
  return { x: boat.x + Math.sin(a) * dist, y: boat.y + Math.cos(a) * dist };
}
