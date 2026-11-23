// Down-looking echo sounder (魚探). Each ping samples the shared world state in
// the beam footprint under the boat. Pings are taken by the simulation on a
// fixed schedule whether or not the sounder panel is visible (A06).
import { depthAt, bottomIsRocky } from './sea.js';
import { densityAt, posesAt, schoolTotal } from './world.js';
import { hashFloat } from './rng.js';

export const HISTORY_COLS = 360; // 180 game seconds at 2 pings/s

export function createObservation() {
  return {
    cols: [], // newest last
    pingCount: 0,
    lastBottom: null,
    marks: [], // chart marks: {id, x, y, t, kind:'auto'|'manual', depth}
    lastAutoMarkT: -1e9,
    markSeq: 1,
  };
}

/** Compute one sounder column at (x, y) for the world's current time. */
export function pingColumn(world, x, y, spec, pingIndex) {
  const nBins = Math.round(spec.maxRange / spec.binSize);
  const bins = new Uint8Array(nBins);
  const tanA = Math.tan((spec.halfAngleDeg * Math.PI) / 180);
  const bottom = depthAt(x, y);
  // first bottom return comes from the shallowest point inside the footprint
  const rb = bottom * tanA * 0.8;
  let bTop = bottom;
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    bTop = Math.min(bTop, depthAt(x + Math.cos(a) * rb, y + Math.sin(a) * rb));
  }
  const rocky = bottomIsRocky(x, y);
  const poses = posesAt(world);
  // schools that can be inside the beam at all
  const near = [];
  for (let i = 0; i < world.schools.length; i++) {
    const s = world.schools[i];
    if (schoolTotal(s) <= 0) continue;
    const p = poses[i];
    const reach = 3 * s.sigmaH + bottom * tanA;
    if (Math.hypot(p.x - x, p.y - y) <= reach) near.push(i);
  }
  let maxFish = 0;
  let fishDepthSum = 0;
  let fishWeight = 0;
  for (let i = 0; i < nBins; i++) {
    const z = (i + 0.5) * spec.binSize;
    let v = 0;
    if (z < bTop && near.length) {
      const r = z * tanA * 0.6;
      let sum = 0;
      for (let k = 0; k < 7; k++) {
        let px = x;
        let py = y;
        if (k > 0) {
          const a = ((k - 1) * Math.PI) / 3;
          px += Math.cos(a) * r;
          py += Math.sin(a) * r;
        }
        sum += densityAt(world, px, py, z, poses).total;
      }
      const rho = sum / 7;
      // grainy texture so a school reads as many targets, not a solid slab
      const grain = 0.68 + 0.32 * hashFloat(pingIndex >> 1, i, 11);
      const fish = (1 - Math.exp(-rho * spec.gainK)) * grain;
      if (fish > maxFish) maxFish = fish;
      if (fish > 0.05) {
        fishDepthSum += z * fish;
        fishWeight += fish;
      }
      v = fish;
    }
    // bottom echo
    if (z >= bTop && z < bottom) v = Math.max(v, 0.72);
    const thick = rocky ? 2.4 : 1.3;
    if (z >= bottom && z < bottom + thick) v = 1;
    else if (z >= bottom + thick) v = Math.max(v, 0.75 * Math.exp(-(z - bottom - thick) / 2.5));
    // surface clutter and speckle noise (deterministic per ping/bin; display texture only)
    if (z < 2.5) v = Math.max(v, 0.35 * (1 - z / 2.5) * hashFloat(pingIndex, i, 7));
    // sparse speckle: most cells stay dark, a few faint dots
    const n = hashFloat(pingIndex, i, 3);
    v = Math.max(v, spec.noise * Math.pow(n, 8) * 1.6);
    bins[i] = Math.max(0, Math.min(255, Math.round(v * 255)));
  }
  return {
    t: world.time,
    x,
    y,
    bottom: bTop,
    bottomCenter: bottom,
    binSize: spec.binSize,
    bins,
    maxFish,
    fishDepth: fishWeight > 0 ? fishDepthSum / fishWeight : null,
  };
}

export function pushColumn(obs, col) {
  obs.cols.push(col);
  if (obs.cols.length > HISTORY_COLS) obs.cols.shift();
  obs.pingCount += 1;
  obs.lastBottom = col.bottom;
}

/**
 * Automatic tana (fishing depth) from what the sounder has shown recently.
 * Uses observed columns only — never the hidden school state.
 * Returns the sinker depth; hooks sit 1.0–4.0 m above it.
 */
export function readTana(obs, method, maxDepth, nCols = 12) {
  const cols = obs.cols.slice(-nCols);
  if (!cols.length) return { tana: null, source: 'none', echoDepth: null };
  const last = cols[cols.length - 1];
  const bottom = last.bottom;
  const bin = last.binSize;
  const nBins = last.bins.length;
  const avg = new Float32Array(nBins);
  for (const c of cols) for (let i = 0; i < nBins; i++) avg[i] += c.bins[i] / 255 / cols.length;
  let best = -1;
  let bestV = 0;
  for (let i = 0; i < nBins; i++) {
    const z = (i + 0.5) * bin;
    if (z < 2.5 || z > bottom - 0.8) continue;
    if (avg[i] > bestV) {
      bestV = avg[i];
      best = i;
    }
  }
  const floor = Math.min(bottom - 0.5, maxDepth);
  if (best >= 0 && bestV >= method.echoThreshold) {
    const echoDepth = (best + 0.5) * bin;
    const hookCentre = 1.0 + ((method.hooks - 1) * method.hookSpacing) / 2;
    return { tana: Math.min(echoDepth + hookCentre, floor), source: 'echo', echoDepth, strength: bestV };
  }
  return { tana: Math.min(bottom - method.defaultOffBottom, maxDepth), source: 'bottom', echoDepth: null, strength: bestV };
}
