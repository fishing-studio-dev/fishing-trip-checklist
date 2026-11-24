// World state: game time, the day's conditions and fish schools.
// One shared state feeds the sounder, the catch and the logs (A05).
import { SPECIES, FEEDING, TIDE_PERIOD, ECHO } from './data.js';
import { createRng, rngNext, noise1 } from './rng.js';
import { dayPlan } from './season.js';
import { depthAt, makeDayConditions, currentAt } from './sea.js';
import { dayTimes, daylightAt, twilightAt } from './calendar.js';

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
    hug: SPECIES[s.species || 'aji'].habit === 'reef' || SPECIES[s.species || 'aji'].habit === 'burrow', // sits at a height above the local bottom
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

const smooth = (a, b, v) => {
  const u = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

/** The sun of the world's day (scenario worlds without one get the day's real sun). */
function sunOf(world) {
  const c = world.cond;
  if (!c.sun) c.sun = dayTimes(c.day || 1);
  return c.sun;
}

/**
 * The phase of the tidal stream at time t, as weights that add up to 1:
 * slack (潮止まり), starting (動き始め), running (効いている), easing (緩み始め).
 * Read from the closed-form stream, so the tide table and the current meter
 * show the same thing the fish feel. `speed` is the stream in m/s.
 */
export function tidePhase(cond, t) {
  const phase = (2 * Math.PI * (t - cond.highWater)) / TIDE_PERIOD;
  const sn = Math.sin(phase);
  const a = Math.abs(sn);
  const rising = sn * Math.cos(phase) > 0; // the stream is getting stronger
  const slack = 1 - smooth(0.1, 0.35, a);
  const running = smooth(0.65, 0.9, a);
  const mid = Math.max(0, 1 - slack - running);
  const c = currentAt(cond, t);
  return { slack, starting: rising ? mid : 0, running, easing: rising ? 0 : mid, a, rising, speed: Math.hypot(c.x, c.y) };
}

/** Height of the school's core above the bottom (m) — game settings per fish. */
export function offBottomAt(school, t, world = null) {
  if (school.fixedOffBottom != null) return school.fixedOffBottom;
  const sp = SPECIES[school.species];
  // 根魚（本作設定）: right on the rocks all day (オオモンハタ a little higher)
  if (school.reef) return Math.max(0.4, (sp.offBottom || 0.7) + 0.15 * noise1(school.noiseSeed, t / 1800) * (sp.offBottom || 0.7));
  // アマダイ: in their burrows on the mud
  if (sp.habit === 'burrow') return 0.3;
  const sun = world ? sunOf(world) : { sunrise: 5.5 * 3600, sunset: 18.5 * 3600 };
  const tw = twilightAt({ rise: sun.sunrise, set: sun.sunset }, t);
  const tp = world ? tidePhase(world.cond, t) : { slack: 0, running: 0 };
  // マダイ（本作設定）: hugs the bottom; in the 乗っ込み mornings it stands up well off it
  if (school.species === 'madai') {
    const up = school.nokkomi ? 9 * tw.dawn : 0;
    return Math.max(0.6, 1.1 + up + school.offBottomBias * 0.3 + 0.3 * noise1(school.noiseSeed, t / 1500));
  }
  // イサキ（本作設定）: stands up over the top of the reef, higher in the low light
  if (school.species === 'isaki') return Math.max(2.5, 4.5 + 3.5 * tw.dawn + 2.5 * tw.dusk + 1.2 * tp.slack + school.offBottomBias + 0.8 * noise1(school.noiseSeed, t / 1200));
  // マアジ（本作設定）: higher in the low light. In a hard-running stream they press
  // close to the bottom; as it eases and stops they rise as a looser cloud.
  const base = 2.6 + 5.5 * tw.dawn + 2.0 * tw.dusk + school.offBottomBias + 0.6 * noise1(school.noiseSeed, t / 1200);
  return Math.max(1.0, base * (1 - 0.45 * tp.running) + 1.6 * tp.slack);
}

/** How loose the school is vertically (multiplies sigmaZ): a slack-water アジ cloud spreads. */
function looseness(school, t, world) {
  if (!world || school.fixedOffBottom != null) return 1;
  if (school.species !== 'aji' && school.species !== 'isaki') return 1;
  const tp = tidePhase(world.cond, t);
  return 1 + 0.5 * tp.slack - 0.2 * tp.running;
}

/** Depth of a pelagic school's core below the surface (m) — game settings. */
export function pelagicDepthAt(school, t, world = null) {
  if (school.fixedDepth != null) return school.fixedDepth;
  const sun = world ? sunOf(world) : { sunrise: 5.5 * 3600, sunset: 18.5 * 3600 };
  const tw = twilightAt({ rise: sun.sunrise, set: sun.sunset }, t, 1.6 * 3600);
  const sp = SPECIES[school.species] || {};
  if (sp.surface) return Math.max(1, 2 + school.depthBias * 0.3 + 0.5 * noise1(school.noiseSeed, t / 900));
  if (school.species === 'yokowa') return Math.max(3, 7 - 3 * tw.dawn + school.depthBias + 1.2 * noise1(school.noiseSeed, t / 1100));
  return Math.max(2.5, 7.5 - 4 * tw.dawn - 1.5 * tw.dusk + school.depthBias + 0.8 * noise1(school.noiseSeed, t / 1500));
}

/** Full 3D centre: {x, y, z} with z = depth (m, positive down). `world` gives the sun and tide. */
export function schoolPose(school, t, world = null) {
  const c = schoolCenter(school, t);
  const bottom = depthAt(c.x, c.y);
  const habit = SPECIES[school.species].habit;
  if (habit === 'pelagic') {
    const z = Math.min(pelagicDepthAt(school, t, world), Math.max(2, bottom - 3));
    return { x: c.x, y: c.y, z, bottom };
  }
  if (habit === 'squid') {
    // イカ（本作設定）: near the bottom by day, rising from about sunset to a third of the depth at night
    const set = world ? sunOf(world).sunset : 18.5 * 3600;
    const u = Math.max(0, Math.min(1, (t - (set - 1800)) / 9000));
    const rise = u * u * (3 - 2 * u);
    const z = (bottom - 4) * (1 - rise) + bottom * (0.35 + 0.05 * noise1(school.noiseSeed, t / 1500)) * rise;
    return { x: c.x, y: c.y, z: Math.max(3, Math.min(bottom - 2, z)), bottom };
  }
  if (habit === 'roam') {
    // 青物（本作設定）: under the bait school they follow, or in mid water around a reef
    let z;
    if (school.baitDepth) z = pelagicDepthAt({ fixedDepth: null, species: 'iwashi', ...school.baitDepth }, t, world) + (school.below || 4);
    else z = bottom * ((school.depthFrac || 0.6) + 0.08 * noise1(school.noiseSeed, t / 1200));
    return { x: c.x, y: c.y, z: Math.max(3, Math.min(bottom - 2, z)), bottom };
  }
  if (habit === 'midwater') {
    // マサバ（本作設定）: a band in mid water, coming up in the low light
    const sun = world ? sunOf(world) : { sunrise: 5.5 * 3600, sunset: 18.5 * 3600 };
    const tw = twilightAt({ rise: sun.sunrise, set: sun.sunset }, t);
    const frac = (school.depthFrac || 0.5) - 0.2 * Math.max(tw.dawn, tw.dusk) + 0.05 * noise1(school.noiseSeed, t / 900);
    return { x: c.x, y: c.y, z: Math.max(4, Math.min(bottom - 4, bottom * frac)), bottom };
  }
  const off = offBottomAt(school, t, world);
  const z = Math.max(school.hug ? 1 : 3, bottom - off);
  return { x: c.x, y: c.y, z, bottom, off, zs: looseness(school, t, world) };
}

const NORMAL_MOOD = { id: 'usual', k: 1 };

/**
 * Feeding activity (本作設定), about 0.05..2: the phase of the tide, the light
 * (まずめ), the water temperature, the day after rough weather and the school's
 * mood of the day — see FEEDING and MOODS in data.js. 1 is an ordinary bite.
 */
export function activityAt(world, school, t) {
  if (school.activityOverride != null) return school.activityOverride;
  const F = FEEDING[school.species] || FEEDING.aji;
  const cond = world.cond;
  const mood = school.mood || NORMAL_MOOD;
  const tp = tidePhase(cond, t);
  let T = F.tide;
  if (mood.id === 'contrary') T = [T[2], T[3], T[0], T[1]];
  else if (mood.id === 'hot') {
    const m = (T[0] + T[1] + T[2] + T[3]) / 4;
    T = [m, m, m, m];
  }
  let tide = tp.slack * T[0] + tp.starting * T[1] + tp.running * T[2] + tp.easing * T[3];
  // fish that want a moving stream are duller on the small tides (小潮・長潮)
  if (T[2] > T[0]) tide *= 0.75 + 0.25 * Math.min(1, (cond.tideAmp || 0.2) / 0.22);
  const fast = 1 + (F.fast - 1) * smooth(0.28, 0.38, tp.speed);
  const sun = sunOf(world);
  const s2 = { rise: sun.sunrise, set: sun.sunset };
  const light = daylightAt(s2, t);
  const tw = twilightAt(s2, t);
  const lit = F.night + (F.day - F.night) * light + F.dawn * tw.dawn + F.dusk * tw.dusk;
  const wt = cond.waterTemp != null ? cond.waterTemp : 19;
  const out = wt < F.temp[0] ? F.temp[0] - wt : wt > F.temp[1] ? wt - F.temp[1] : 0;
  const temp = Math.max(0.45, 1 - 0.12 * out);
  const habit = SPECIES[school.species].habit;
  const stirred = cond.afterRough && (habit === 'bottom' || habit === 'reef' || habit === 'burrow') ? 0.8 : 1;
  const wobble = 1 + 0.15 * noise1(school.noiseSeed + 99, t / 900);
  return Math.max(0.04, Math.min(2, 0.95 * tide * fast * lit * temp * stirred * mood.k * wobble));
}

/** Density (fish / m^3) of one school at (x, y, z) given its pose p (0 beyond 3 sigma). */
export function schoolDensity(s, p, x, y, z) {
  const n = schoolTotal(s);
  if (n <= 0) return 0;
  const dx = x - p.x;
  const dy = y - p.y;
  const dh2 = (dx * dx + dy * dy) / (s.sigmaH * s.sigmaH);
  if (dh2 > 9) return 0;
  const sz = s.sigmaZ * (p.zs || 1);
  const pz = s.hug ? Math.max(1, depthAt(x, y) - p.off) : p.z;
  const dz = (z - pz) / sz;
  if (dz * dz > 9) return 0;
  return (n / (SQRT2PI3 * s.sigmaH * s.sigmaH * sz)) * Math.exp(-0.5 * (dh2 + dz * dz));
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
    // the instruments (no species asked) never see アマダイ in their burrows
    if (!species && SPECIES[s.species].habit === 'burrow') continue;
    const p = poses ? poses[i] : schoolPose(s, world.time, world);
    const rho = schoolDensity(s, p, x, y, z);
    if (rho <= 0) continue;
    total += rho;
    if (rho > bestRho) {
      bestRho = rho;
      best = i;
    }
  }
  return { total, best };
}

/**
 * What the sound comes back from at (x, y, z): density weighted by how
 * strongly each fish echoes (ECHO.ts) — for the sonar and the side view.
 */
export function echoDensityAt(world, x, y, z, poses) {
  let total = 0;
  for (let i = 0; i < world.schools.length; i++) {
    const s = world.schools[i];
    const e = ECHO[s.species];
    if (e && e.kind === 'none') continue;
    const rho = schoolDensity(s, poses ? poses[i] : schoolPose(s, world.time, world), x, y, z);
    if (rho > 0) total += rho * (e ? e.ts : 1);
  }
  return total;
}

export function posesAt(world, t = world.time) {
  return world.schools.map((s) => schoolPose(s, t, world));
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
