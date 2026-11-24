// Down-looking echo sounder (魚探). Each ping samples the shared world state in
// the beam footprint under the boat. Pings are taken by the simulation on a
// fixed schedule whether or not the sounder panel is visible (A06).
import { depthAt, bottomIsRocky } from './sea.js';
import { schoolDensity, posesAt, schoolTotal } from './world.js';
import { hashFloat, noise1 } from './rng.js';
import { ECHO } from './data.js';

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

const isPredator = (sp) => sp === 'masaba' || (ECHO[sp] && ECHO[sp].fast);

/** A standard normal number from two hashed uniforms (deterministic). */
function gauss(seed, k, j) {
  const u = Math.max(1e-9, hashFloat(seed, k, j, 71));
  const v = hashFloat(seed, k, j, 72);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const MAX_SINGLES = 120;

/**
 * Where the big fish of a 'single' school are at time t: each fish has its own
 * place in the school (hashed, stable) and wanders slowly around it — fast
 * swimmers (青物) quicker. Only as many as are still in the school.
 */
export function singlesOf(school, pose, t) {
  const n = Math.min(MAX_SINGLES, Math.round(schoolTotal(school)));
  const e = ECHO[school.species];
  const tau = e && e.fast ? 90 : 400;
  const out = [];
  for (let k = 0; k < n; k++) {
    const sd = school.noiseSeed + k * 7919;
    const x = pose.x + school.sigmaH * (gauss(school.noiseSeed, k, 1) + 0.5 * noise1(sd, t / tau));
    const y = pose.y + school.sigmaH * (gauss(school.noiseSeed, k, 2) + 0.5 * noise1(sd + 3, t / tau));
    const dz = school.sigmaZ * (pose.zs || 1) * (gauss(school.noiseSeed, k, 3) * 0.8 + 0.3 * noise1(sd + 5, t / tau));
    const z = school.hug ? depthAt(x, y) - pose.off - Math.abs(dz) * 0.5 : pose.z + dz;
    out.push({ x, y, z: Math.max(1, z) });
  }
  return out;
}

/** Compute one sounder column at (x, y) for the world's current time. */
export function pingColumn(world, x, y, spec, pingIndex) {
  const nBins = Math.round(spec.maxRange / spec.binSize);
  const bins = new Uint8Array(nBins);
  const fishV = new Float32Array(nBins);
  const tanA = Math.tan((spec.halfAngleDeg * Math.PI) / 180);
  const bottom = depthAt(x, y);
  const t = world.time;
  // first bottom return comes from the shallowest point inside the footprint
  const rb = bottom * tanA * 0.8;
  let bTop = bottom;
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    bTop = Math.min(bTop, depthAt(x + Math.cos(a) * rb, y + Math.sin(a) * rb));
  }
  const rocky = bottomIsRocky(x, y);
  const poses = posesAt(world);
  // schools that can be inside the beam at all, by how they show
  const clouds = [];
  const singles = [];
  for (let i = 0; i < world.schools.length; i++) {
    const s = world.schools[i];
    if (schoolTotal(s) <= 0) continue;
    const e = ECHO[s.species] || { kind: 'school', ts: 1 };
    if (e.kind === 'none') continue;
    const p = poses[i];
    const reach = 3 * s.sigmaH + bottom * tanA;
    if (Math.hypot(p.x - x, p.y - y) > reach) continue;
    if (e.kind === 'single') singles.push({ s, p, e });
    else {
      // bait chased by predators breaks up: ragged edges, holes, uneven density
      let chased = false;
      if (e.bait) {
        for (let j = 0; j < world.schools.length; j++) {
          const q = world.schools[j];
          if (!isPredator(q.species) || schoolTotal(q) <= 0) continue;
          if (Math.hypot(poses[j].x - p.x, poses[j].y - p.y) < 2 * s.sigmaH + q.sigmaH) {
            chased = true;
            break;
          }
        }
      }
      clouds.push({ s, p, ts: e.ts, chased });
    }
  }
  const gainN = spec.gainK / 350;
  // clouds of small fish: density over the footprint, weighted by echo strength
  if (clouds.length) {
    for (let i = 0; i < nBins; i++) {
      const z = (i + 0.5) * spec.binSize;
      if (z >= bTop) break;
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
        for (const c of clouds) {
          let rho = schoolDensity(c.s, c.p, px, py, z) * c.ts;
          if (rho > 0 && c.chased) {
            const u = 0.5 * (noise1(c.s.noiseSeed + 17, px * 0.12 + t / 45) + 1);
            const w = 0.5 * (noise1(c.s.noiseSeed + 29, z * 0.6 + py * 0.1 - t / 70) + 1);
            rho *= Math.max(0, Math.min(1.4, 2.4 * u * w - 0.2));
          }
          sum += rho;
        }
      }
      const rho = sum / 7;
      if (rho <= 0) continue;
      // grainy texture so a school reads as many targets, not a solid slab
      const grain = 0.68 + 0.32 * hashFloat(pingIndex >> 1, i, 11);
      fishV[i] = (1 - Math.exp(-rho * spec.gainK)) * grain;
    }
  }
  // big fish one by one: the slant range from the transducer draws an arch
  if (singles.length) {
    const halfBins = Math.max(1, Math.round(0.35 / spec.binSize));
    for (const { s, p, e } of singles) {
      for (const f of singlesOf(s, p, t)) {
        const r = Math.hypot(f.x - x, f.y - y);
        const edge = f.z * tanA;
        if (r > edge) continue;
        const R = Math.hypot(r, f.z);
        if (R >= bTop) continue;
        const beam = Math.exp(-2 * (r / Math.max(0.5, edge)) ** 2); // strongest straight below
        const v = 1 - Math.exp(-e.ts * beam * 1.9 * Math.sqrt(gainN));
        const c = Math.floor(R / spec.binSize);
        const thick = Math.max(halfBins, Math.round((e.size || 0.5) / spec.binSize / 2));
        for (let d = -thick; d <= thick; d++) {
          const bi = c + d;
          if (bi < 0 || bi >= nBins) continue;
          const w = 1 - Math.abs(d) / (thick + 1);
          fishV[bi] = Math.max(fishV[bi], v * w);
        }
      }
    }
  }
  let maxFish = 0;
  let fishDepthSum = 0;
  let fishWeight = 0;
  for (let i = 0; i < nBins; i++) {
    const z = (i + 0.5) * spec.binSize;
    let v = z < bTop ? fishV[i] : 0;
    if (v > maxFish) maxFish = v;
    if (v > 0.05) {
      fishDepthSum += z * v;
      fishWeight += v;
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
