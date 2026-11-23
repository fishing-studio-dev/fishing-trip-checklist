// World state: game time, the day's conditions and fish schools.
// One shared state feeds the sounder, the catch and the logs (A05).
import { SPECIES } from './data.js';
import { createRng, rngNext, noise1 } from './rng.js';
import { dayPlan } from './season.js';
import { depthAt, makeDayConditions, currentAt } from './sea.js';

export { HABITATS } from './season.js';

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
    schools = dayPlan(worldSeed, day).schools.map(normalizeSchool);
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

export function normalizeSchool(s) {
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
    depthBias: 0,
    noiseSeed: 1,
    fixedDepth: null, // pelagic test scenarios can pin the depth
    fixedOffBottom: null, // test scenarios can pin the layer
    activityOverride: null,
    ...s,
    b,
    counts,
    initial: { ...counts },
    reef: SPECIES[s.species || 'aji'].habit === 'reef', // 根魚: depth follows the local bottom
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
  // 根魚（本作設定）: right on the rocks all day
  if (school.reef) return Math.max(0.4, 0.7 + 0.15 * noise1(school.noiseSeed, t / 1800));
  // マダイ（本作設定）: hugs the bottom all day
  if (school.species === 'madai') return Math.max(0.6, 1.1 + school.offBottomBias * 0.3 + 0.3 * noise1(school.noiseSeed, t / 1500));
  const h = t / 3600;
  // early morning higher in the water column, settling near the bottom by day
  const morning = 5.5 * Math.exp(-(((h - 5.5) / 1.4) ** 2));
  const evening = 2.0 * Math.exp(-(((h - 16.5) / 1.5) ** 2));
  return Math.max(1.2, 2.6 + morning + evening + school.offBottomBias + 0.6 * noise1(school.noiseSeed, t / 1200));
}

/** Depth of a pelagic school's core below the surface (m) — game setting for サワラ. */
export function pelagicDepthAt(school, t) {
  if (school.fixedDepth != null) return school.fixedDepth;
  const h = t / 3600;
  const morning = Math.exp(-(((h - 6) / 1.6) ** 2));
  return Math.max(2.5, 7.5 - 4 * morning + school.depthBias + 0.8 * noise1(school.noiseSeed, t / 1500));
}

/** Full 3D centre: {x, y, z} with z = depth (m, positive down). */
export function schoolPose(school, t) {
  const c = schoolCenter(school, t);
  const bottom = depthAt(c.x, c.y);
  if (SPECIES[school.species].habit === 'pelagic') {
    const z = Math.min(pelagicDepthAt(school, t), Math.max(2, bottom - 3));
    return { x: c.x, y: c.y, z, bottom };
  }
  if (SPECIES[school.species].habit === 'squid') {
    // イカ（本作設定）: near the bottom by day, rising at dusk to about a third of the depth at night
    const h = t / 3600;
    const u = Math.max(0, Math.min(1, (h - 17) / 2.5));
    const rise = u * u * (3 - 2 * u);
    const z = (bottom - 4) * (1 - rise) + bottom * (0.35 + 0.05 * noise1(school.noiseSeed, t / 1500)) * rise;
    return { x: c.x, y: c.y, z: Math.max(3, Math.min(bottom - 2, z)), bottom };
  }
  if (SPECIES[school.species].habit === 'roam') {
    // 青物（本作設定）: under the bait school they follow, or in mid water around a reef
    let z;
    if (school.baitDepth) z = pelagicDepthAt({ fixedDepth: null, ...school.baitDepth }, t) + (school.below || 4);
    else z = bottom * ((school.depthFrac || 0.6) + 0.08 * noise1(school.noiseSeed, t / 1200));
    return { x: c.x, y: c.y, z: Math.max(3, Math.min(bottom - 2, z)), bottom };
  }
  const off = offBottomAt(school, t);
  const z = Math.max(school.reef ? 1 : 3, bottom - off);
  return { x: c.x, y: c.y, z, bottom, off };
}

/** Feeding activity 0.3..1.4 (game setting): time of day, moving water, temperature. */
export function activityAt(world, school, t) {
  if (school.activityOverride != null) return school.activityOverride;
  const h = t / 3600;
  const tod = 0.65 + 0.4 * Math.exp(-(((h - 6) / 1.3) ** 2)) + 0.2 * Math.exp(-(((h - 16) / 1.2) ** 2));
  const c = currentAt(world.cond, t);
  const sp = Math.hypot(c.x, c.y);
  const tide = 0.7 + 0.45 * Math.min(1, sp / 0.22);
  const wobble = 1 + 0.15 * noise1(school.noiseSeed + 99, t / 900);
  if (school.species === 'sawara') {
    // サワラ（本作設定）: strongest at dawn and evening, likes warmer water
    const todS = 0.6 + 0.6 * Math.exp(-(((h - 6) / 1.5) ** 2)) + 0.35 * Math.exp(-(((h - 16.5) / 1.3) ** 2));
    const warm = Math.max(0.6, Math.min(1.2, 0.8 + (world.cond.waterTemp - 18.8) * 0.3));
    return Math.max(0.3, Math.min(1.4, todS * (0.8 + 0.25 * Math.min(1, sp / 0.22)) * warm * wobble));
  }
  if (SPECIES[school.species].habit === 'squid') {
    // イカ（本作設定）: feed after dark; a gentle tide is best
    const night = Math.max(0, Math.min(1, (h - 17.5) / 1.5));
    const tideI = 0.8 + 0.3 * Math.min(1, sp / 0.2) - 0.3 * Math.max(0, (sp - 0.25) / 0.1);
    return Math.max(0.3, Math.min(1.4, (0.35 + 0.85 * night) * Math.max(0.5, tideI) * wobble));
  }
  if (SPECIES[school.species].habit === 'roam') {
    // 青物（本作設定）: strongest at dawn and dusk and when the tide runs; ブリ like it
    // cooler, ヒラマサ warmer
    const todA = 0.55 + 0.6 * Math.exp(-(((h - 5.8) / 1.4) ** 2)) + 0.45 * Math.exp(-(((h - 16.8) / 1.4) ** 2));
    const tideA = 0.6 + 0.55 * Math.min(1, sp / 0.22);
    const dt = world.cond.waterTemp - 18.8;
    const temp = Math.max(0.7, Math.min(1.2, 1 + 0.15 * (school.species === 'buri' ? -dt : dt)));
    return Math.max(0.3, Math.min(1.4, todA * tideA * temp * wobble));
  }
  if (school.reef) {
    // 根魚（本作設定）: feed best in low light (dawn, dusk); a moderate tide helps.
    // アラ wants moving water; カサゴ・キジハタ turn off when it runs too hard.
    const todR = 0.7 + 0.45 * Math.exp(-(((h - 5.5) / 1.3) ** 2)) + 0.45 * Math.exp(-(((h - 17) / 1.3) ** 2));
    const tideR = school.species === 'ara' ? 0.6 + 0.6 * Math.min(1, sp / 0.22) : 0.85 + 0.3 * Math.min(1, sp / 0.2) - 0.35 * Math.max(0, (sp - 0.25) / 0.1);
    return Math.max(0.3, Math.min(1.4, todR * Math.max(0.4, tideR) * wobble));
  }
  if (school.species === 'madai') {
    // マダイ（本作設定）: feeds when the tide moves, better in the morning and evening
    const todM = 0.7 + 0.35 * Math.exp(-(((h - 6) / 1.6) ** 2)) + 0.3 * Math.exp(-(((h - 16.5) / 1.5) ** 2));
    const tideM = 0.55 + 0.6 * Math.min(1, sp / 0.22);
    return Math.max(0.3, Math.min(1.4, todM * tideM * wobble));
  }
  const temp = 1 - 0.06 * Math.abs(world.cond.waterTemp - 19);
  return Math.max(0.3, Math.min(1.4, tod * tide * temp * wobble));
}

/**
 * Fish density (fish / m^3) at (x, y, depth z), optionally for one species
 * (or a list of species). Truncated at 3 sigma so that empty water is exactly
 * empty (A04). `poses` may be precomputed for time t. 根魚 sit at a height
 * above the local bottom, wherever on the structure that is.
 */
export function densityAt(world, x, y, z, poses, species = null) {
  let total = 0;
  let best = null;
  let bestRho = 0;
  const many = Array.isArray(species);
  for (let i = 0; i < world.schools.length; i++) {
    const s = world.schools[i];
    if (species && (many ? !species.includes(s.species) : s.species !== species)) continue;
    const n = schoolTotal(s);
    if (n <= 0) continue;
    const p = poses ? poses[i] : schoolPose(s, world.time);
    const dx = x - p.x;
    const dy = y - p.y;
    const dh2 = (dx * dx + dy * dy) / (s.sigmaH * s.sigmaH);
    if (dh2 > 9) continue;
    const pz = s.reef ? Math.max(1, depthAt(x, y) - p.off) : p.z;
    const dz = (z - pz) / s.sigmaZ;
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
