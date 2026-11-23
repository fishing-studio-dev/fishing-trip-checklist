// Which fish are in the area on a given day. The sea continues from day to
// day: マアジ hold around a habitat for several days (an "episode") and thin
// out before leaving; サワラ come in waves while the water is warm enough.
// Days covered by SEASON_SCRIPT use scripted fish; later days are procedural.
// Everything is a pure function of (worldSeed, day) — no stored world state.
import { SEASON_SCRIPT, SPECIES } from './data.js';
import { hashFloat, hashString } from './rng.js';
import { makeDayConditions, STRUCTURES, areaNameAt } from './sea.js';

// Places where マアジ schools tend to hold in this fictional sea (game setting).
export const HABITATS = [
  { id: 'kita_e', area: '北の瀬', x: 2190, y: 2270, drift: [2120, 2330], weight: 1.0, big: 0.35 },
  { id: 'kita_s', area: '北の瀬', x: 1990, y: 2030, drift: [2040, 2110], weight: 1.0, big: 0.3 },
  { id: 'kita_w', area: '北の瀬', x: 1800, y: 2300, drift: [1880, 2240], weight: 0.8, big: 0.3 },
  { id: 'nishi', area: '西の根', x: 640, y: 1240, drift: [700, 1330], weight: 0.9, big: 0.25 },
  { id: 'higashi_s', area: '東の駆け上がり', x: 2460, y: 1450, drift: [2470, 1650], weight: 0.8, big: 0.2 },
  { id: 'higashi_n', area: '東の駆け上がり', x: 2480, y: 2000, drift: [2450, 1850], weight: 0.6, big: 0.2 },
  { id: 'minami', area: '南の浅場', x: 1050, y: 700, drift: [1150, 760], weight: 0.6, big: 0.05 },
  // 沖の瀬 (M5): far, lightly fished — bigger schools with more large fish (game setting)
  { id: 'okise', area: '沖の瀬', x: 1650, y: 4080, drift: [1740, 3990], weight: 1.2, big: 0.5, rich: 1.5, far: true },
];

// Open-water zones where サワラ waves pass (game setting).
export const SAWARA_ZONES = [
  { id: 'higashi', area: '東の駆け上がり', x: 2620, y: 1800, spread: 260 },
  { id: 'oki', area: '沖の平場', x: 1450, y: 1750, spread: 320 },
  { id: 'kita_oki', area: '北の瀬', x: 2050, y: 2700, spread: 240 },
];

// Bottoms where マダイ spread thinly for many days (game setting).
export const MADAI_GROUNDS = [
  { id: 'hira', area: '沖の平場', x: 1150, y: 1900, spread: 300, weight: 0.85 },
  { id: 'kake', area: '東の駆け上がり', x: 2470, y: 1250, spread: 220, weight: 0.8 },
  { id: 'nishi', area: '西の根', x: 820, y: 1520, spread: 150, weight: 0.6 },
  // only in the 乗っ込み season (warming water): マダイ gather on the flank of 北の瀬
  { id: 'kita', area: '北の瀬', x: 2150, y: 2060, spread: 180, weight: 0, nokkomi: true },
  // 沖の瀬 (M5): around the far reef, more large fish
  { id: 'okise', area: '沖の瀬', x: 1560, y: 3930, spread: 260, weight: 0.9, big: 0.3, far: true },
];

// 根魚（本作設定）: how many live on each kind of small structure (a range; the
// day's number varies a little around the structure's own level), and the
// rocky tops of the named reefs where they are spread more thinly.
export const REEF_STOCK = {
  gyosho: { kasago: [8, 18], kijihata: [2, 6], ara: [0, 0] },
  koboreze: { kasago: [5, 12], kijihata: [3, 8], ara: [0, 0] },
  ne: { kasago: [2, 6], kijihata: [4, 9], ara: [0, 3] },
};
export const ROCK_GROUNDS = [
  { id: 'nishi_rock', area: '西の根', x: 650, y: 1350, sigmaH: 70, stock: { kasago: [10, 22], kijihata: [2, 6] } },
  { id: 'kita_rock', area: '北の瀬', x: 2000, y: 2250, sigmaH: 90, stock: { kasago: [8, 18], kijihata: [3, 7] } },
  { id: 'okise_rock', area: '沖の瀬', x: 1650, y: 4050, sigmaH: 90, stock: { kasago: [6, 14], kijihata: [4, 9], ara: [0, 2] } },
];
const REEF_BIG = { kasago: 0.2, kijihata: 0.2, ara: 0.3 };
const keyOf = (str) => parseInt(hashString(str), 16); // a stable integer per place and species

function reefSchool(seed, d, place, species, n, sigmaH) {
  const k = keyOf(`${place.id}:${species}`);
  return {
    id: `D${d}-reef-${place.id}-${species}`,
    species,
    habitat: place.id,
    area: place.area || areaNameAt(place.x, place.y),
    a: { x: place.x, y: place.y },
    b: { x: place.x, y: place.y },
    orbitR: 0,
    sigmaH,
    sigmaZ: 1.0,
    noiseSeed: Math.floor(hashFloat(seed, k, 31) * 1e9),
    counts: splitCounts(n, REEF_BIG[species], 0.35),
  };
}

/** The 根魚 of day d: resident on every structure and reef top (a pure function of seed and day). */
export function reefSchools(seed, d) {
  const out = [];
  const count = (place, species, [lo, hi]) => {
    if (hi <= 0) return 0;
    const k = keyOf(`${place.id}:${species}`);
    const own = hashFloat(seed, k, 41); // the structure's own level
    const day = hashFloat(seed, k, d, 42); // a little change from day to day
    return Math.round(lo + (hi - lo) * (0.65 * own + 0.35 * day));
  };
  for (const st of STRUCTURES) {
    const stock = REEF_STOCK[st.kind];
    for (const sp of Object.keys(stock)) {
      const n = count(st, sp, stock[sp]);
      if (n > 0) out.push(reefSchool(seed, d, st, sp, n, Math.max(10, st.r * 0.7 + 4)));
    }
  }
  for (const g of ROCK_GROUNDS) {
    for (const [sp, range] of Object.entries(g.stock)) {
      const n = count(g, sp, range);
      if (n > 0) out.push(reefSchool(seed, d, g, sp, n, g.sigmaH));
    }
  }
  return out;
}

// 青物（本作設定）: grounds they roam around (reefs, pinnacles, the far reef), and
// open-water zones where bait (イワシ) schools pass. Away from the アジ grounds.
export const BLUE_GROUNDS = [
  { id: 'n1', x: 1500, y: 2200, spread: 120 },
  { id: 'n2', x: 2700, y: 2300, spread: 120 },
  { id: 'kita_kata', x: 2250, y: 2480, spread: 160 },
  { id: 'okise', x: 1650, y: 4050, spread: 200, rich: 1.5 },
  { id: 'n3', x: 1900, y: 3800, spread: 120 },
];
export const BAIT_ZONES = [
  { id: 'oki', x: 1350, y: 1700, spread: 300 },
  { id: 'kita_oki', x: 2050, y: 2800, spread: 250 },
  { id: 'okise_oki', x: 1450, y: 3650, spread: 250 },
  { id: 'higashi_oki', x: 2750, y: 2050, spread: 200 },
];

function baitSchool(seed, d, zone, k) {
  const zi = BAIT_ZONES.indexOf(zone);
  const r = (j) => hashFloat(seed, zi, d, k, j, 501);
  const ang = r(1) * Math.PI * 2;
  const run = 300 + r(2) * 200;
  const ax = zone.x + (r(3) - 0.5) * zone.spread;
  const ay = zone.y + (r(4) - 0.5) * zone.spread;
  const n = Math.round(3000 + r(5) * 5000);
  return {
    id: `D${d}-bait-${zone.id}-${k}`,
    species: 'iwashi',
    habitat: zone.id,
    area: areaNameAt(ax, ay),
    a: { x: ax, y: ay },
    b: { x: ax + Math.sin(ang) * run, y: ay + Math.cos(ang) * run },
    moveStart: (5 + r(6) * 2) * 3600,
    moveEnd: (12 + r(7) * 3) * 3600,
    orbitR: 40 + r(8) * 60,
    orbitPeriod: (30 + r(9) * 30) * 60,
    orbitPhase: r(10) * Math.PI * 2,
    sigmaH: 40 + r(11) * 30,
    sigmaZ: 2 + r(12) * 1.5,
    depthBias: 1.5 + r(13) * 3,
    noiseSeed: Math.floor(r(14) * 1e9),
    counts: splitCounts(n, 0.2, 0.4),
  };
}

/** Which 青物 the water suits today (ブリ cooler, ヒラマサ warmer; both in between). */
function blueSpecies(seed, d, k) {
  const temp = makeDayConditions(seed, d).waterTemp;
  const pBuri = Math.max(0.15, Math.min(0.85, 0.5 - (temp - 18.6) * 0.6));
  return hashFloat(seed, d, k, 511) < pBuri ? 'buri' : 'hiramasa';
}

/** Bait schools and 青物 for day d (a pure function of seed and day). */
export function blueSchools(seed, d) {
  const out = [];
  BAIT_ZONES.forEach((z, zi) => {
    if (hashFloat(seed, zi, d, 502) > 0.7) return; // no bait in this zone today
    const bait = baitSchool(seed, d, z, 0);
    out.push(bait);
    // some bait schools have 青物 underneath, following them
    if (hashFloat(seed, zi, d, 503) < 0.45) {
      const sp = blueSpecies(seed, d, zi + 10);
      const n = Math.round(6 + hashFloat(seed, zi, d, 504) * 12);
      out.push({
        id: `D${d}-blue-${z.id}`,
        species: sp,
        habitat: z.id,
        area: bait.area,
        a: { ...bait.a },
        b: { ...bait.b },
        moveStart: bait.moveStart,
        moveEnd: bait.moveEnd,
        orbitR: bait.orbitR,
        orbitPeriod: bait.orbitPeriod,
        orbitPhase: bait.orbitPhase,
        sigmaH: 45 + hashFloat(seed, zi, d, 505) * 20,
        sigmaZ: 7,
        baitDepth: { depthBias: bait.depthBias, noiseSeed: bait.noiseSeed },
        below: 4 + hashFloat(seed, zi, d, 506) * 4,
        noiseSeed: Math.floor(hashFloat(seed, zi, d, 507) * 1e9),
        counts: splitCounts(n, 0.25, 0.4),
      });
    }
  });
  // 青物 roaming around the reefs: multi-day stays
  BLUE_GROUNDS.forEach((g, gi) => {
    let start = 0;
    let ep = null;
    for (let i = 0; i < 2000; i++) {
      const len = 2 + Math.floor(hashFloat(seed, gi, i, 521) * 4);
      if (d < start + len) {
        ep = { i, present: hashFloat(seed, gi, i, 522) < 0.4 };
        break;
      }
      start += len;
    }
    if (!ep || !ep.present) return;
    const r = (j) => hashFloat(seed, gi, d, j, 531);
    const n = Math.round((6 + hashFloat(seed, gi, ep.i, 523) * 14) * (g.rich || 1));
    const cx = g.x + (r(1) - 0.5) * g.spread;
    const cy = g.y + (r(2) - 0.5) * g.spread;
    out.push({
      id: `D${d}-blue-${g.id}`,
      species: blueSpecies(seed, d, gi),
      habitat: g.id,
      area: areaNameAt(g.x, g.y),
      a: { x: cx, y: cy },
      b: { x: cx, y: cy },
      orbitR: 80 + r(3) * 80,
      orbitPeriod: (15 + r(4) * 15) * 60,
      orbitPhase: r(5) * Math.PI * 2,
      sigmaH: 45 + r(6) * 25,
      sigmaZ: 8,
      depthFrac: 0.5 + r(7) * 0.25,
      noiseSeed: Math.floor(r(8) * 1e9),
      counts: splitCounts(n, 0.25 + (g.rich ? 0.1 : 0), 0.35),
    });
  });
  return out;
}

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

/** Long procedural stay of マダイ on a ground covering day d. */
function madaiEpisode(seed, gi, d) {
  let start = 0;
  for (let i = 0; i < 2000; i++) {
    const len = 4 + Math.floor(hashFloat(seed, gi, i, 401) * 7);
    if (d < start + len) return { i, present: hashFloat(seed, gi, i, 402) < MADAI_GROUNDS[gi].weight, last: d === start + len - 1 };
    start += len;
  }
  return { i: 0, present: false, last: false };
}

/** School spec for the マダイ spread over a ground on day d. */
export function madaiSchool(seed, d, groundId, n, ep) {
  const gi = MADAI_GROUNDS.findIndex((g) => g.id === groundId);
  const g = MADAI_GROUNDS[gi];
  const r = (k) => hashFloat(seed, gi, ep, k, 7);
  const day = (k) => hashFloat(seed, gi, d, k, 8);
  const ax = g.x + (r(1) - 0.5) * g.spread + (day(2) - 0.5) * 80;
  const ay = g.y + (r(3) - 0.5) * g.spread + (day(4) - 0.5) * 80;
  const ang = day(5) * Math.PI * 2;
  const run = 80 + day(6) * 180;
  return {
    id: `D${d}-madai-${groundId}`,
    species: 'madai',
    habitat: groundId,
    area: g.area,
    a: { x: ax, y: ay },
    b: { x: ax + Math.sin(ang) * run, y: ay + Math.cos(ang) * run },
    moveStart: (6 + day(7) * 2) * 3600,
    moveEnd: (13 + day(8) * 3) * 3600,
    orbitR: 30 + day(9) * 50,
    orbitPeriod: (60 + day(10) * 60) * 60,
    orbitPhase: day(11) * Math.PI * 2,
    sigmaH: 120 + r(12) * 70,
    sigmaZ: 1.6 + r(13) * 0.6,
    offBottomBias: r(14) - 0.5,
    noiseSeed: Math.floor(day(15) * 1e9),
    counts: splitCounts(n, 0.15, 0.3),
  };
}

function madaiSchools(seed, d) {
  const out = [];
  const { nokkomi } = makeDayConditions(seed, d).season;
  MADAI_GROUNDS.forEach((g, gi) => {
    if (g.nokkomi) {
      if (!nokkomi) return;
      // 乗っ込み: a bigger gathering with more large fish
      const n = (130 + hashFloat(seed, gi, d, 405) * 80) * (0.9 + 0.2 * hashFloat(seed, gi, d, 406));
      const s = madaiSchool(seed, d, g.id, Math.round(n), 1000 + Math.floor(d / 6));
      s.counts = splitCounts(Math.round(n), 0.3, 0.2);
      out.push(s);
      return;
    }
    const ep = madaiEpisode(seed, gi, d);
    if (!ep.present) return;
    let n = (70 + hashFloat(seed, gi, ep.i, 403) * 90) * (0.9 + 0.2 * hashFloat(seed, gi, d, 404));
    if (ep.last) n *= 0.6;
    if (nokkomi && !g.far) n *= 0.6; // many have moved up onto the reef flank
    const s = madaiSchool(seed, d, g.id, Math.round(n), ep.i);
    if (g.big) s.counts = splitCounts(Math.round(n), g.big, 0.2);
    out.push(s);
  });
  return out;
}

/** The マアジ of one habitat on day d, from its multi-day episodes ([] when absent). */
function ajiFromEpisode(seed, d, h, hi) {
  const ep = ajiEpisode(seed, hi, d);
  if (!ep.present) return [];
  const base = 300 + hashFloat(seed, hi, ep.i, 103) * 600;
  let n = base * (0.9 + 0.2 * hashFloat(seed, hi, d, 104)) * (h.rich || 1);
  if (ep.last) n *= 0.45; // thinning out before leaving
  if (makeDayConditions(seed, d).waterTemp <= 18.0) n *= 0.7; // fewer アジ on the grounds in cold water (本作設定)
  const big = Math.min(0.6, Math.max(0, h.big + (hashFloat(seed, hi, ep.i, 105) - 0.4) * 0.25));
  return [ajiSchool(seed, d, h.id, Math.round(n), big, ep.i)];
}

/** All school specs for day d. */
export function dayPlan(seed, d) {
  const script = SEASON_SCRIPT[d];
  const schools = [];
  if (script) {
    for (const [hid, n, big] of script.aji) schools.push(ajiSchool(seed, d, hid, n, big, 'script'));
    // the far ground is not part of the early-season script: it follows its own episodes
    HABITATS.forEach((h, hi) => {
      if (h.far) schools.push(...ajiFromEpisode(seed, d, h, hi));
    });
    script.sawara.forEach(([zid, n], k) => schools.push(sawaraSchool(seed, d, zid, n, k)));
    schools.push(...madaiSchools(seed, d));
    schools.push(...reefSchools(seed, d));
    schools.push(...blueSchools(seed, d));
    return { schools, scripted: true };
  }
  HABITATS.forEach((h, hi) => schools.push(...ajiFromEpisode(seed, d, h, hi)));
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
  schools.push(...madaiSchools(seed, d));
  schools.push(...reefSchools(seed, d));
  schools.push(...blueSchools(seed, d));
  return { schools, scripted: false };
}
