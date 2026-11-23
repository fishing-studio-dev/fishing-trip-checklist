// Which fish are in the area on a given day. The sea continues from day to
// day: マアジ hold around a habitat for several days (an "episode") and thin
// out before leaving; サワラ come in waves while the water is warm enough.
// Days covered by SEASON_SCRIPT use scripted fish; later days are procedural.
// Everything is a pure function of (worldSeed, day) — no stored world state.
import { SEASON_SCRIPT, SPECIES } from './data.js';
import { hashFloat } from './rng.js';
import { makeDayConditions } from './sea.js';

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

// Open-water zones where サワラ waves pass (game setting).
export const SAWARA_ZONES = [
  { id: 'higashi', area: '東の駆け上がり', x: 2620, y: 1800, spread: 260 },
  { id: 'oki', area: '沖の平場', x: 1450, y: 1750, spread: 320 },
  { id: 'kita_oki', area: '北の瀬', x: 2050, y: 2700, spread: 240 },
];

const habIndex = (id) => HABITATS.findIndex((h) => h.id === id);
const zoneIndex = (id) => SAWARA_ZONES.findIndex((z) => z.id === id);

/** Procedural episode of habitat h covering day d. */
function ajiEpisode(seed, hi, d) {
  let start = 1;
  for (let i = 0; i < 2000; i++) {
    const len = 3 + Math.floor(hashFloat(seed, hi, i, 101) * 6);
    if (d < start + len) {
      const present = hashFloat(seed, hi, i, 102) < HABITATS[hi].weight * 0.55 + 0.15;
      return { i, start, len, present, last: d === start + len - 1 };
    }
    start += len;
  }
  return { i: 0, start: d, len: 1, present: false, last: false };
}

/** Procedural サワラ wave covering day d (shared by all zones). */
function sawaraWave(seed, d) {
  let start = 1;
  for (let i = 0; i < 2000; i++) {
    const len = 2 + Math.floor(hashFloat(seed, i, 201) * 5);
    if (d < start + len) return { i, present: hashFloat(seed, i, 202) < 0.55 };
    start += len;
  }
  return { i: 0, present: false };
}

function splitCounts(n, big, smallBase) {
  const l = Math.round(n * big);
  const s = Math.round(n * smallBase);
  return { s, m: Math.max(0, n - s - l), l };
}

/** School spec for a マアジ episode at a habitat on day d. `ep` keys the episode-stable shape. */
export function ajiSchool(seed, d, habitatId, n, big, ep) {
  const hi = habIndex(habitatId);
  const h = HABITATS[hi];
  const r = (k) => hashFloat(seed, hi, ep, k);
  const day = (k) => hashFloat(seed, hi, d, k);
  const small = Math.max(0.05, 0.55 - big - r(7) * 0.2);
  return {
    id: `D${d}-${habitatId}`,
    species: 'aji',
    habitat: habitatId,
    area: h.area,
    a: { x: h.x + (r(1) - 0.5) * 120 + (day(2) - 0.5) * 50, y: h.y + (r(3) - 0.5) * 120 + (day(4) - 0.5) * 50 },
    b: { x: h.drift[0] + (r(5) - 0.5) * 120, y: h.drift[1] + (r(6) - 0.5) * 120 },
    moveStart: (6.5 + day(8) * 2) * 3600,
    moveEnd: (10 + day(9) * 2.5) * 3600,
    orbitR: 30 + day(10) * 60,
    orbitPeriod: (50 + day(11) * 60) * 60,
    orbitPhase: day(12) * Math.PI * 2,
    sigmaH: 35 + r(13) * 30,
    sigmaZ: 2.5 + r(14) * 1.5,
    offBottomBias: (r(15) - 0.4) * 1.4,
    noiseSeed: Math.floor(day(16) * 1e9),
    counts: splitCounts(n, big, small),
  };
}

/** School spec for a サワラ school in a zone on day d. */
export function sawaraSchool(seed, d, zoneId, n, k) {
  const zi = zoneIndex(zoneId);
  const z = SAWARA_ZONES[zi];
  const r = (j) => hashFloat(seed, zi, d, k, j);
  const ang = r(1) * Math.PI * 2;
  const run = 250 + r(2) * 400; // metres travelled during the day
  const ax = z.x + (r(3) - 0.5) * z.spread;
  const ay = z.y + (r(4) - 0.5) * z.spread;
  return {
    id: `D${d}-sawara-${zoneId}-${k}`,
    species: 'sawara',
    habitat: zoneId,
    area: z.area,
    a: { x: ax, y: ay },
    b: { x: ax + Math.sin(ang) * run, y: ay + Math.cos(ang) * run },
    moveStart: (5 + r(5) * 1.5) * 3600,
    moveEnd: (11 + r(6) * 3) * 3600,
    orbitR: 80 + r(7) * 120,
    orbitPeriod: (40 + r(8) * 40) * 60,
    orbitPhase: r(9) * Math.PI * 2,
    sigmaH: 70 + r(10) * 50,
    sigmaZ: 3 + r(11) * 1.5,
    depthBias: (r(12) - 0.5) * 2,
    noiseSeed: Math.floor(r(13) * 1e9),
    counts: splitCounts(n, 0.08, 0.55),
  };
}

/** All school specs for day d. */
export function dayPlan(seed, d) {
  const script = SEASON_SCRIPT[d];
  const schools = [];
  if (script) {
    for (const [hid, n, big] of script.aji) schools.push(ajiSchool(seed, d, hid, n, big, 'script'));
    script.sawara.forEach(([zid, n], k) => schools.push(sawaraSchool(seed, d, zid, n, k)));
    return { schools, scripted: true };
  }
  HABITATS.forEach((h, hi) => {
    const ep = ajiEpisode(seed, hi, d);
    if (!ep.present) return;
    const base = 300 + hashFloat(seed, hi, ep.i, 103) * 600;
    let n = base * (0.9 + 0.2 * hashFloat(seed, hi, d, 104));
    if (ep.last) n *= 0.45; // thinning out before leaving
    const big = Math.min(0.6, Math.max(0, h.big + (hashFloat(seed, hi, ep.i, 105) - 0.4) * 0.25));
    schools.push(ajiSchool(seed, d, h.id, Math.round(n), big, ep.i));
  });
  const temp = makeDayConditions(seed, d).waterTemp;
  const wave = sawaraWave(seed, d);
  if (wave.present && temp >= SPECIES.sawara.arriveTemp) {
    const k = 1 + Math.floor(hashFloat(seed, wave.i, 203) * 3);
    for (let j = 0; j < k; j++) {
      const zone = SAWARA_ZONES[Math.floor(hashFloat(seed, wave.i, j, 204) * SAWARA_ZONES.length)];
      const n = Math.round((20 + hashFloat(seed, wave.i, j, 205) * 35) * (0.85 + 0.3 * hashFloat(seed, d, j, 206)));
      schools.push(sawaraSchool(seed, d, zone.id, n, j));
    }
  }
  return { schools, scripted: false };
}
