// World state: game time, the day's conditions and fish schools.
// One shared state feeds the sounder, the catch and the logs (A05).
import { SPECIES } from './data.js';
import { createRng, rngNext, rngRange, rngInt, noise1 } from './rng.js';
import { depthAt, makeDayConditions, currentAt } from './sea.js';

// Places where マアジ schools tend to hold in this fictional sea (game setting).
export const HABITATS = [
  { id: 'kita_e', area: '北の瀬', x: 2190, y: 2270, drift: [2120, 2330], weight: 1.0, big: 0.35 },
  { id: 'kita_s', area: '北の瀬', x: 1990, y: 2030, drift: [2040, 2110], weight: 1.0, big: 0.3 },
  { id: 'kita_w', area: '北の瀬', x: 1800, y: 2300, drift: [1880, 2240], weight: 0.8, big: 0.3 },
  { id: 'nishi', area: '西の根', x: 640, y: 1240, drift: [700, 1330], weight: 0.9, big: 0.25 },
  { id: 'higashi_s', area: '東の駆け上がり', x: 2460, y: 1450, drift: [2470, 1650], weight: 0.8, big: 0.2 },
  { id: 'higashi_n', area: '東の駆け上がり', x: 2480, y: 2000, drift: [2450, 1850], weight: 0.6, big: 0.2 },
  { id: 'minami', area: '南の浅場', x: 1050, y: 700, drift: [1150, 760], weight: 0.6, big: 0.05 },
];

const SQRT2PI3 = Math.pow(2 * Math.PI, 1.5);

/** Generate the day's world deterministically from (seed, day). */
export function createWorld(worldSeed, day, startTime, scenario = null) {
  const cond = makeDayConditions(worldSeed, day);
  if (scenario && scenario.conditions) Object.assign(cond, scenario.conditions);
  const rng = createRng((worldSeed * 7919 + day * 104729) >>> 0);
  let schools;
  if (scenario && scenario.schools) {
    schools = scenario.schools.map((s, i) => normalizeSchool({ ...s, id: s.id || `S${i + 1}` }));
  } else {
    schools = generateSchools(rng, day);
  }
  return {
    time: startTime,
    step: 0,
    cond,
    schools,
    rng, // simulation RNG (size draws, bite phases); never used by UI
    nextReservation: 1,
  };
}

function generateSchools(rng, day) {
  const pool = HABITATS.slice();
  const count = rngInt(rng, 3, 5);
  const out = [];
  for (let i = 0; i < count && pool.length; i++) {
    const total = pool.reduce((a, h) => a + h.weight, 0);
    let r = rngNext(rng) * total;
    let idx = 0;
    for (; idx < pool.length - 1; idx++) {
      r -= pool[idx].weight;
      if (r <= 0) break;
    }
    const h = pool.splice(idx, 1)[0];
    const n = Math.round(rngRange(rng, 300, 900));
    const big = Math.min(0.6, Math.max(0, h.big + rngRange(rng, -0.1, 0.15)));
    const small = Math.max(0.05, 0.55 - big - rngRange(rng, 0, 0.2));
    const med = Math.max(0, 1 - big - small);
    const counts = splitCounts(n, { s: small, m: med, l: big });
    out.push(
      normalizeSchool({
        id: `D${day}-${h.id}`,
        species: 'aji',
        habitat: h.id,
        area: h.area,
        a: { x: h.x + rngRange(rng, -60, 60), y: h.y + rngRange(rng, -60, 60) },
        b: { x: h.drift[0] + rngRange(rng, -60, 60), y: h.drift[1] + rngRange(rng, -60, 60) },
        moveStart: rngRange(rng, 6.5, 8.5) * 3600,
        moveEnd: rngRange(rng, 10, 12.5) * 3600,
        orbitR: rngRange(rng, 30, 90),
        orbitPeriod: rngRange(rng, 50, 110) * 60,
        orbitPhase: rngRange(rng, 0, Math.PI * 2),
        sigmaH: rngRange(rng, 35, 65),
        sigmaZ: rngRange(rng, 2.5, 4),
        offBottomBias: rngRange(rng, -0.6, 0.8),
        noiseSeed: Math.floor(rngNext(rng) * 1e9),
        counts,
      }),
    );
  }
  return out;
}

function splitCounts(n, frac) {
  const s = Math.round(n * frac.s);
  const l = Math.round(n * frac.l);
  const m = Math.max(0, n - s - l);
  return { s, m, l };
}

function normalizeSchool(s) {
  const counts = { s: 0, m: 0, l: 0, ...(s.counts || {}) };
  const b = s.b || s.a;
  return {
    species: 'aji',
    area: '',
    habitat: '',
    moveStart: 7 * 3600,
    moveEnd: 11 * 3600,
    orbitR: 0,
    orbitPeriod: 3600,
    orbitPhase: 0,
    sigmaH: 30,
    sigmaZ: 3,
    offBottomBias: 0,
    noiseSeed: 1,
    fixedOffBottom: null, // test scenarios can pin the layer
    activityOverride: null,
    ...s,
    b,
    counts,
    initial: { ...counts },
  };
}

export function schoolTotal(school) {
  return school.counts.s + school.counts.m + school.counts.l;
}

/** Horizontal centre of a school at game time t (continuous). */
export function schoolCenter(school, t) {
  const u = Math.max(0, Math.min(1, (t - school.moveStart) / Math.max(1, school.moveEnd - school.moveStart)));
  const k = u * u * (3 - 2 * u);
  const ang = school.orbitPhase + (2 * Math.PI * t) / school.orbitPeriod;
  return {
    x: school.a.x + (school.b.x - school.a.x) * k + Math.cos(ang) * school.orbitR,
    y: school.a.y + (school.b.y - school.a.y) * k + Math.sin(ang) * school.orbitR * 0.7,
  };
}

/** Height of the school's core above the bottom (m) — game setting for マアジ. */
export function offBottomAt(school, t) {
  if (school.fixedOffBottom != null) return school.fixedOffBottom;
  const h = t / 3600;
  // early morning higher in the water column, settling near the bottom by day
  const morning = 5.5 * Math.exp(-(((h - 5.5) / 1.4) ** 2));
  const evening = 2.0 * Math.exp(-(((h - 16.5) / 1.5) ** 2));
  return Math.max(1.2, 2.6 + morning + evening + school.offBottomBias + 0.6 * noise1(school.noiseSeed, t / 1200));
}

/** Full 3D centre: {x, y, z} with z = depth (m, positive down). */
export function schoolPose(school, t) {
  const c = schoolCenter(school, t);
  const bottom = depthAt(c.x, c.y);
  const z = Math.max(3, bottom - offBottomAt(school, t));
  return { x: c.x, y: c.y, z, bottom };
}

/** Feeding activity 0.3..1.4 (game setting): time of day, moving water, temperature. */
export function activityAt(world, school, t) {
  if (school.activityOverride != null) return school.activityOverride;
  const h = t / 3600;
  const tod = 0.65 + 0.4 * Math.exp(-(((h - 6) / 1.3) ** 2)) + 0.2 * Math.exp(-(((h - 16) / 1.2) ** 2));
  const c = currentAt(world.cond, t);
  const sp = Math.hypot(c.x, c.y);
  const tide = 0.7 + 0.45 * Math.min(1, sp / 0.22);
  const temp = 1 - 0.06 * Math.abs(world.cond.waterTemp - 19);
  const wobble = 1 + 0.15 * noise1(school.noiseSeed + 99, t / 900);
  return Math.max(0.3, Math.min(1.4, tod * tide * temp * wobble));
}

/**
 * Fish density (fish / m^3) contributed by each school at (x, y, depth z).
 * Truncated at 3 sigma so that empty water is exactly empty (A04).
 * `poses` may be precomputed for time t.
 */
export function densityAt(world, x, y, z, poses) {
  let total = 0;
  let best = null;
  let bestRho = 0;
  for (let i = 0; i < world.schools.length; i++) {
    const s = world.schools[i];
    const n = schoolTotal(s);
    if (n <= 0) continue;
    const p = poses ? poses[i] : schoolPose(s, world.time);
    const dx = x - p.x;
    const dy = y - p.y;
    const dh2 = (dx * dx + dy * dy) / (s.sigmaH * s.sigmaH);
    if (dh2 > 9) continue;
    const dz = (z - p.z) / s.sigmaZ;
    if (dz * dz > 9) continue;
    const rho = (n / (SQRT2PI3 * s.sigmaH * s.sigmaH * s.sigmaZ)) * Math.exp(-0.5 * (dh2 + dz * dz));
    total += rho;
    if (rho > bestRho) {
      bestRho = rho;
      best = i;
    }
  }
  return { total, best };
}

export function posesAt(world, t = world.time) {
  return world.schools.map((s) => schoolPose(s, t));
}

/** Remove one fish from a school (reservation). Picks size by remaining counts. */
export function takeFish(world, schoolIndex) {
  const s = world.schools[schoolIndex];
  const n = schoolTotal(s);
  if (n <= 0) return null;
  let r = rngNext(world.rng) * n;
  let size = 'l';
  for (const k of SPECIES[s.species].sizeOrder) {
    r -= s.counts[k];
    if (r < 0) {
      size = k;
      break;
    }
  }
  if (s.counts[size] <= 0) size = SPECIES[s.species].sizeOrder.find((k) => s.counts[k] > 0);
  s.counts[size] -= 1;
  return { schoolId: s.id, species: s.species, size, kg: SPECIES[s.species].sizes[size].kg, rid: world.nextReservation++ };
}

/** Give a reserved fish back (e.g. if a hooked fish is released). */
export function returnFish(world, fish) {
  const s = world.schools.find((x) => x.id === fish.schoolId);
  if (s) s.counts[fish.size] += 1;
}
