// Which fish are in the area on a given day. The sea continues from day to
// day: マアジ hold around a habitat for several days (an "episode") and thin
// out before leaving; サワラ come in waves while the water is warm enough.
// Days covered by SEASON_SCRIPT use scripted fish; later days are procedural.
// Everything is a pure function of (worldSeed, day) — no stored world state.
import { SEASON_SCRIPT, SPECIES, MOODS } from './data.js';
import { hashFloat, hashString } from './rng.js';
import { makeDayConditions, STRUCTURES, FEATURES, areaNameAt, depthAt } from './sea.js';
import { abundanceOf, bigShareOf } from './almanac.js';
import { calendarOf } from './calendar.js';

// Places where マアジ schools tend to hold in this fictional sea (game setting).
export const HABITATS = [
  { id: 'kita_e', hold: 'kita', area: '北の瀬', x: 2190, y: 2270, drift: [2120, 2330], weight: 1.0, big: 0.35 },
  { id: 'kita_s', hold: 'kita', area: '北の瀬', x: 1990, y: 2030, drift: [2040, 2110], weight: 1.0, big: 0.3 },
  { id: 'kita_w', hold: 'kita', area: '北の瀬', x: 1800, y: 2300, drift: [1880, 2240], weight: 0.8, big: 0.3 },
  { id: 'nishi', hold: 'nishi', area: '西の根', x: 640, y: 1240, drift: [700, 1330], weight: 0.9, big: 0.25 },
  { id: 'higashi_s', area: '東の駆け上がり', x: 2460, y: 1450, drift: [2470, 1650], weight: 0.8, big: 0.2 },
  { id: 'higashi_n', area: '東の駆け上がり', x: 2480, y: 2000, drift: [2450, 1850], weight: 0.6, big: 0.2 },
  { id: 'minami', area: '南の浅場', x: 1050, y: 700, drift: [1150, 760], weight: 0.6, big: 0.05 },
  // 沖の瀬 (M5): far, lightly fished — bigger schools with more large fish (game setting)
  { id: 'okise', hold: 'okise', area: '沖の瀬', x: 1650, y: 4080, drift: [1740, 3990], weight: 1.2, big: 0.5, rich: 1.5, far: true },
];

// 潮表（本作設定・漁の基本に沿う）: where the tidal stream meets a reef it is
// pushed up the slope; plankton gathers on that face, the bait (イワシ・アジ)
// feeds there and the big fish follow the bait. Fish tied to a reef sit on
// its up-current face while the stream runs, cross over the top around slack
// water, and go to the other face when the tide turns (world.js holdOffset).
// face: how far from the reef's centre that face lies (m).
const ne = (id) => STRUCTURES.find((st) => st.id === id);
export const HOLDS = {
  kita: { id: 'kita', area: '北の瀬', x: FEATURES.kitaNoSe.x, y: FEATURES.kitaNoSe.y, face: Math.round(FEATURES.kitaNoSe.r * 0.78) },
  nishi: { id: 'nishi', area: '西の根', x: FEATURES.nishiNoNe.x, y: FEATURES.nishiNoNe.y, face: Math.round(FEATURES.nishiNoNe.r * 0.8) },
  okise: { id: 'okise', area: '沖の瀬', x: FEATURES.okiNoSe.x, y: FEATURES.okiNoSe.y, face: Math.round(FEATURES.okiNoSe.r * 0.78) },
  n1: { id: 'n1', x: ne('n1').x, y: ne('n1').y, face: ne('n1').r + 15 },
  n2: { id: 'n2', x: ne('n2').x, y: ne('n2').y, face: ne('n2').r + 15 },
  n3: { id: 'n3', x: ne('n3').x, y: ne('n3').y, face: ne('n3').r + 15 },
};
// the stream's axis (flood toward NE, ebb toward SW: sea.js makeDayConditions)
const FLOOD = { x: Math.sin((40 * Math.PI) / 180), y: Math.cos((40 * Math.PI) / 180) };

/**
 * Tie a school to a reef: its own place is kept across the stream (schools
 * line up along the face), the part along the stream is replaced by the
 * tide's swing from face to face. The morning drift and wide circling stop.
 * `share`: how far toward the face it goes (1 = right on it).
 */
export function holdToReef(school, holdId, share = 1, maxOrbit = 25) {
  const h = HOLDS[holdId];
  if (!h) return school;
  const rx = school.a.x - h.x;
  const ry = school.a.y - h.y;
  const along = rx * FLOOD.x + ry * FLOOD.y;
  // across the stream, kept within the face (a reef's face is about as wide as the reef)
  const lat = Math.max(-h.face, Math.min(h.face, 0.6 * (rx * FLOOD.y - ry * FLOOD.x)));
  void along;
  const base = { x: h.x + lat * FLOOD.y, y: h.y - lat * FLOOD.x };
  school.a = base;
  school.b = { ...base };
  school.orbitR = Math.min(school.orbitR || 0, maxOrbit);
  school.holdTo = { id: h.id, x: h.x, y: h.y, face: Math.round(h.face * share) };
  return school;
}

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
  { id: 'nishi', hold: 'nishi', area: '西の根', x: 820, y: 1520, spread: 150, weight: 0.6 },
  // only in the 乗っ込み season (warming water): マダイ gather on the flank of 北の瀬
  { id: 'kita', hold: 'kita', area: '北の瀬', x: 2150, y: 2060, spread: 180, weight: 0, nokkomi: true },
  // 沖の瀬 (M5): around the far reef, more large fish
  { id: 'okise', hold: 'okise', area: '沖の瀬', x: 1560, y: 3930, spread: 260, weight: 0.9, big: 0.3, far: true },
];

// 根魚（本作設定）: how many live on each kind of small structure (a range; the
// day's number varies a little around the structure's own level), and the
// rocky tops of the named reefs where they are spread more thinly.
// The numbers are at the height of each fish's season; through the year they
// follow SEASONALITY (キジハタ・アカハタ in summer, アラ best in winter).
export const REEF_STOCK = {
  gyosho: { kasago: [8, 18], kijihata: [2, 6], ara: [0, 0], akahata: [2, 6], oomonhata: [1, 3] },
  koboreze: { kasago: [5, 12], kijihata: [3, 8], ara: [0, 0], akahata: [2, 6], oomonhata: [2, 5] },
  ne: { kasago: [2, 6], kijihata: [4, 9], ara: [0, 3], oomonhata: [3, 7] },
};
export const ROCK_GROUNDS = [
  { id: 'nishi_rock', area: '西の根', x: 650, y: 1350, sigmaH: 70, stock: { kasago: [10, 22], kijihata: [2, 6], akahata: [4, 10] } },
  { id: 'kita_rock', area: '北の瀬', x: 2000, y: 2250, sigmaH: 90, stock: { kasago: [8, 18], kijihata: [3, 7], oomonhata: [3, 8] } },
  { id: 'okise_rock', area: '沖の瀬', x: 1650, y: 4050, sigmaH: 90, stock: { kasago: [6, 14], kijihata: [4, 9], ara: [0, 2], oomonhata: [3, 7] } },
];
const REEF_BIG = { kasago: 0.2, kijihata: 0.2, ara: 0.3, akahata: 0.2, oomonhata: 0.25 };
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
    const season = 0.35 + 0.65 * Math.min(1, abundanceOf(seed, species, d));
    return Math.round((lo + (hi - lo) * (0.65 * own + 0.35 * day)) * season);
  };
  for (const st of STRUCTURES) {
    const stock = REEF_STOCK[st.kind];
    for (const sp of Object.keys(stock)) {
      if (SPECIES[sp].maxDepth && depthAt(st.x, st.y) > SPECIES[sp].maxDepth) continue; // アカハタ: shallow rocks only
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
  { id: 'n1', hold: 'n1', x: 1500, y: 2200, spread: 120 },
  { id: 'n2', hold: 'n2', x: 2700, y: 2300, spread: 120 },
  { id: 'kita_kata', hold: 'kita', x: 2250, y: 2480, spread: 160 },
  { id: 'okise', hold: 'okise', x: 1650, y: 4050, spread: 200, rich: 1.5 },
  { id: 'n3', hold: 'n3', x: 1900, y: 3800, spread: 120 },
];
export const BAIT_ZONES = [
  { id: 'oki', x: 1350, y: 1700, spread: 300 },
  { id: 'kita_oki', x: 2050, y: 2800, spread: 250 },
  { id: 'okise_oki', x: 1450, y: 3650, spread: 250 },
  { id: 'higashi_oki', x: 2750, y: 2050, spread: 200 },
];

// ベイトの溜まる瀬（本作設定）: in the bait season, イワシ gather over the
// up-current face of the reefs to feed on what the stream brings up the slope,
// and the reef's 青物 stay under them (blueSchools).
export const REEF_BAIT = ['kita', 'okise', 'nishi', 'n1', 'n2', 'n3'];

function reefBait(seed, d, holdId, k) {
  const h = HOLDS[holdId];
  const r = (j) => hashFloat(seed, k, d, j, 541);
  const n = Math.round(2000 + r(1) * 4000);
  const ax = h.x + (r(2) - 0.5) * h.face * 0.8;
  const ay = h.y + (r(3) - 0.5) * h.face * 0.8;
  const school = {
    id: `D${d}-rbait-${holdId}`,
    species: 'iwashi',
    habitat: `reef-${holdId}`,
    area: h.area || areaNameAt(h.x, h.y),
    a: { x: ax, y: ay },
    b: { x: ax, y: ay },
    orbitR: 15 + r(4) * 20,
    orbitPeriod: (20 + r(5) * 20) * 60,
    orbitPhase: r(6) * Math.PI * 2,
    sigmaH: 28 + r(7) * 18,
    sigmaZ: 2 + r(8) * 1.5,
    depthBias: 5 + r(9) * 6, // deeper than the open-water bait: in the up-welling over the face
    noiseSeed: Math.floor(r(10) * 1e9),
    counts: splitCounts(n, 0.2, 0.4),
  };
  return holdToReef(school, holdId, 1.05, 20);
}

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

/**
 * Which 青物 the season brings today, weighted by how plentiful each is (寒ブリ in
 * winter, ヒラマサ late winter to spring, カンパチ summer to autumn). Returns null
 * when the draw says none is about. `reefOnly`: カンパチ keep to the 根.
 */
const BLUE = ['buri', 'hiramasa', 'kanpachi'];
function blueSpecies(seed, d, k, reefOnly = true) {
  const w = BLUE.map((sp) => (sp === 'kanpachi' && !reefOnly ? 0.5 : 1) * abundanceOf(seed, sp, d));
  const total = w.reduce((a, b) => a + b, 0);
  if (hashFloat(seed, d, k, 512) > Math.min(1, total * 0.9)) return null;
  let r = hashFloat(seed, d, k, 511) * total;
  for (let i = 0; i < BLUE.length; i++) {
    r -= w[i];
    if (r < 0) return BLUE[i];
  }
  return BLUE[BLUE.length - 1];
}

/** Bait schools and 青物 for day d (a pure function of seed and day). */
export function blueSchools(seed, d) {
  const out = [];
  const baitP = 0.7 * Math.min(1, abundanceOf(seed, 'iwashi', d));
  BAIT_ZONES.forEach((z, zi) => {
    if (hashFloat(seed, zi, d, 502) > baitP) return; // no bait in this zone today
    const bait = baitSchool(seed, d, z, 0);
    out.push(bait);
    // some bait schools have 青物 underneath, following them
    const sp = hashFloat(seed, zi, d, 503) < 0.45 ? blueSpecies(seed, d, zi + 10, false) : null;
    if (sp) {
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
        follows: bait.id,
        below: 4 + hashFloat(seed, zi, d, 506) * 4,
        noiseSeed: Math.floor(hashFloat(seed, zi, d, 507) * 1e9),
        counts: splitCounts(n, Math.min(0.6, 0.25 * bigShareOf(sp, d)), 0.4),
      });
    }
  });
  // bait over the reefs' up-current faces
  const reefBaits = {};
  const reefBaitP = 0.55 * Math.min(1, abundanceOf(seed, 'iwashi', d));
  REEF_BAIT.forEach((hid, k) => {
    if (hashFloat(seed, k, d, 542) > reefBaitP) return;
    reefBaits[hid] = reefBait(seed, d, hid, k + 20);
    out.push(reefBaits[hid]);
  });
  // 青物 around the reefs: multi-day stays, and visits to a reef that has bait
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
    const bait = g.hold ? reefBaits[g.hold] : null;
    if (!(ep && ep.present) && !(bait && hashFloat(seed, gi, d, 524) < 0.4)) return;
    const species = blueSpecies(seed, d, gi);
    if (!species) return;
    const r = (j) => hashFloat(seed, gi, d, j, 531);
    const n = Math.round((6 + hashFloat(seed, gi, ep.i, 523) * 14) * (g.rich || 1));
    const cx = g.x + (r(1) - 0.5) * g.spread;
    const cy = g.y + (r(2) - 0.5) * g.spread;
    const school = {
      id: `D${d}-blue-${g.id}`,
      species,
      habitat: g.id,
      area: areaNameAt(g.x, g.y),
      a: { x: cx, y: cy },
      b: { x: cx, y: cy },
      orbitR: 80 + r(3) * 80,
      orbitPeriod: (15 + r(4) * 15) * 60,
      orbitPhase: r(5) * Math.PI * 2,
      sigmaH: 45 + r(6) * 25,
      sigmaZ: 8,
      depthFrac: species === 'kanpachi' ? 0.7 + r(7) * 0.15 : 0.5 + r(7) * 0.25, // カンパチ keep lower, close to the 根
      noiseSeed: Math.floor(r(8) * 1e9),
      counts: splitCounts(n, Math.min(0.6, (0.25 + (g.rich ? 0.1 : 0)) * bigShareOf(species, d)), 0.35),
    };
    if (bait) {
      // under the bait on the up-current face, following it from face to face with the tide
      school.a = { ...bait.a };
      school.b = { ...bait.a };
      school.orbitR = 20 + r(9) * 25;
      school.baitDepth = { depthBias: bait.depthBias, noiseSeed: bait.noiseSeed };
      school.follows = bait.id;
      school.below = 3 + r(10) * 5;
      school.holdTo = { ...bait.holdTo };
    } else if (g.hold) holdToReef(school, g.hold, 1, 45); // no bait: patrolling the up-current side, deeper
    out.push(school);
  });
  return out;
}

// イカ（本作設定）: the deeper offshore water where squid spread for a few days
export const SQUID_GROUNDS = [
  { id: 'okideep', x: 650, y: 2600, spread: 400 },
  { id: 'kita_oki', x: 2350, y: 2700, spread: 250 },
  { id: 'oki_n', x: 1150, y: 3500, spread: 400 },
];

/** Squid on day d (a pure function of seed and day). */
export function squidSchools(seed, d) {
  const out = [];
  const aK = abundanceOf(seed, 'kensaki', d);
  const aY = abundanceOf(seed, 'yari', d);
  SQUID_GROUNDS.forEach((g, gi) => {
    let start = 0;
    let ep = null;
    for (let i = 0; i < 2000; i++) {
      const len = 3 + Math.floor(hashFloat(seed, gi, i, 601) * 5);
      if (d < start + len) {
        ep = { i, present: hashFloat(seed, gi, i, 602) < 0.6 };
        break;
      }
      start += len;
    }
    if (!ep || !ep.present) return;
    // ケンサキイカ in early summer to autumn, ヤリイカ in winter and spring (by how plentiful each is today)
    if (hashFloat(seed, gi, d, 605) > Math.min(1, (aK + aY) * 1.1)) return;
    const r = (j) => hashFloat(seed, gi, d, j, 611);
    const species = hashFloat(seed, gi, ep.i, 603) * (aK + aY) < aK ? 'kensaki' : 'yari';
    const n = Math.round((400 + hashFloat(seed, gi, ep.i, 604) * 600) * (0.5 + 0.5 * Math.min(1, species === 'kensaki' ? aK : aY)));
    const cx = g.x + (r(1) - 0.5) * g.spread;
    const cy = g.y + (r(2) - 0.5) * g.spread;
    out.push({
      id: `D${d}-squid-${g.id}`,
      species,
      habitat: g.id,
      area: areaNameAt(cx, cy),
      a: { x: cx, y: cy },
      b: { x: cx + (r(3) - 0.5) * 300, y: cy + (r(4) - 0.5) * 300 },
      moveStart: 8 * 3600,
      moveEnd: 20 * 3600,
      orbitR: 40 + r(5) * 60,
      orbitPeriod: (60 + r(6) * 60) * 60,
      orbitPhase: r(7) * Math.PI * 2,
      sigmaH: 120 + r(8) * 80,
      sigmaZ: 4,
      noiseSeed: Math.floor(r(9) * 1e9),
      counts: splitCounts(n, 0.2, 0.35),
    });
  });
  return out;
}

// ---- 第2期の魚種（本作設定） ----
// イサキ: on the tops of the high reefs and pinnacles, for a few days at a time.
export const ISAKI_GROUNDS = [
  { id: 'kita_top', hold: 'kita', area: '北の瀬', x: 2010, y: 2260, spread: 90, weight: 1.0 },
  { id: 'n1', hold: 'n1', area: '沖の平場', x: 1500, y: 2200, spread: 30, weight: 0.7 },
  { id: 'n2', hold: 'n2', area: '東の駆け上がり', x: 2700, y: 2300, spread: 30, weight: 0.7 },
  { id: 'n3', hold: 'n3', area: '沖合', x: 1900, y: 3800, spread: 35, weight: 0.8 },
  { id: 'okise_top', hold: 'okise', area: '沖の瀬', x: 1650, y: 4050, spread: 100, weight: 1.1, far: true },
];
// マサバ: big schools crossing the open flats in mid water.
export const MASABA_ZONES = [
  { id: 'hira', x: 1300, y: 1800, spread: 500 },
  { id: 'kita_oki', x: 2100, y: 2800, spread: 450 },
  { id: 'oki', x: 1300, y: 3400, spread: 500 },
];
// シイラ: along the tide lines (潮目) and drifting weed in summer.
export const SHIIRA_LINES = [
  { id: 'kita', x: 2250, y: 2100, spread: 260 },
  { id: 'higashi', x: 2400, y: 1580, spread: 300 },
  { id: 'okise', x: 1510, y: 3830, spread: 220 },
];
// ヨコワ: fast schools of the offshore upper layer in autumn and winter.
export const YOKOWA_ZONES = [
  { id: 'kita_oki', x: 2200, y: 2900, spread: 500 },
  { id: 'oki', x: 1200, y: 3500, spread: 600 },
];
// アマダイ: resident in burrows on the mud (アカアマダイ, deeper) and sand (シロアマダイ, shallower).
export const AMADAI_GROUNDS = [
  { id: 'okideep', species: 'akaamadai', area: '沖の深み', x: 620, y: 2680, spread: 320, n: [60, 120] },
  { id: 'oki_mud', species: 'akaamadai', area: '沖合', x: 1050, y: 3450, spread: 380, n: [70, 140] },
  { id: 'oki_mud_e', species: 'akaamadai', area: '沖合', x: 2500, y: 3500, spread: 300, n: [50, 100] },
  { id: 'hira_sand', species: 'shiroamadai', area: '沖の平場', x: 1150, y: 1550, spread: 260, n: [8, 22] },
  { id: 'kake_sand', species: 'shiroamadai', area: '東の駆け上がり', x: 2600, y: 1150, spread: 200, n: [6, 16] },
];

/** A multi-day stay: which episode covers day d, and is the fish there? */
function episode(seed, key, d, minLen, spread, pPresent) {
  let start = 0;
  for (let i = 0; i < 2000; i++) {
    const len = minLen + Math.floor(hashFloat(seed, key, i, 801) * spread);
    if (d < start + len) return { i, present: hashFloat(seed, key, i, 802) < pPresent, last: d === start + len - 1 };
    start += len;
  }
  return { i: 0, present: false, last: false };
}

function isakiSchools(seed, d) {
  const out = [];
  const a = Math.min(1.2, abundanceOf(seed, 'isaki', d));
  ISAKI_GROUNDS.forEach((g, gi) => {
    const ep = episode(seed, keyOf(`isaki:${g.id}`), d, 3, 4, (0.25 + 0.6 * a) * g.weight);
    if (!ep.present || a < 0.08) return;
    const r = (j) => hashFloat(seed, gi, d, j, 811);
    const e = (j) => hashFloat(seed, gi, ep.i, j, 812);
    let n = (150 + e(1) * 350) * (0.4 + 0.6 * a) * (g.far ? 1.4 : 1);
    if (ep.last) n *= 0.5;
    const cx = g.x + (r(1) - 0.5) * g.spread;
    const cy = g.y + (r(2) - 0.5) * g.spread;
    const school = {
      id: `D${d}-isaki-${g.id}`,
      species: 'isaki',
      habitat: g.id,
      area: g.area,
      a: { x: cx, y: cy },
      b: { x: cx + (r(3) - 0.5) * 40, y: cy + (r(4) - 0.5) * 40 },
      orbitR: 10 + r(5) * 20,
      orbitPeriod: (40 + r(6) * 40) * 60,
      orbitPhase: r(7) * Math.PI * 2,
      sigmaH: 18 + e(2) * 14, // a tall, narrow column over the top of the reef
      sigmaZ: 3 + e(3) * 1.5,
      offBottomBias: (e(4) - 0.5) * 2,
      noiseSeed: Math.floor(r(8) * 1e9),
      counts: splitCounts(Math.round(n), 0.15 + e(5) * 0.15, 0.35),
    };
    // over the up-current shoulder of the reef top (潮表の肩)
    out.push(g.hold ? holdToReef(school, g.hold, 0.6, 15) : school);
  });
  return out;
}

function masabaSchools(seed, d) {
  const out = [];
  const a = Math.min(1.2, abundanceOf(seed, 'masaba', d));
  MASABA_ZONES.forEach((z, zi) => {
    if (hashFloat(seed, zi, d, 821) > 0.75 * a) return;
    const r = (j) => hashFloat(seed, zi, d, j, 822);
    const ang = r(1) * Math.PI * 2;
    const run = 700 + r(2) * 900; // they cover a lot of ground in a day
    const ax = z.x + (r(3) - 0.5) * z.spread;
    const ay = z.y + (r(4) - 0.5) * z.spread;
    const n = Math.round((1200 + r(5) * 2800) * (0.5 + 0.5 * a));
    out.push({
      id: `D${d}-masaba-${z.id}`,
      species: 'masaba',
      habitat: z.id,
      area: areaNameAt(ax, ay),
      a: { x: ax, y: ay },
      b: { x: ax + Math.sin(ang) * run, y: ay + Math.cos(ang) * run },
      moveStart: (5 + r(6) * 2) * 3600,
      moveEnd: (13 + r(7) * 3) * 3600,
      orbitR: 60 + r(8) * 80,
      orbitPeriod: (25 + r(9) * 25) * 60,
      orbitPhase: r(10) * Math.PI * 2,
      sigmaH: 60 + r(11) * 40, // a wide band
      sigmaZ: 2.5 + r(12) * 2,
      depthFrac: 0.4 + r(13) * 0.2,
      noiseSeed: Math.floor(r(14) * 1e9),
      counts: splitCounts(n, 0.15, 0.4),
    });
  });
  return out;
}

function shiiraSchools(seed, d) {
  const out = [];
  const a = Math.min(1.2, abundanceOf(seed, 'shiira', d));
  if (a < 0.05) return out;
  SHIIRA_LINES.forEach((z, zi) => {
    if (hashFloat(seed, zi, d, 831) > 0.8 * a) return;
    const r = (j) => hashFloat(seed, zi, d, j, 832);
    const ax = z.x + (r(1) - 0.5) * z.spread;
    const ay = z.y + (r(2) - 0.5) * z.spread;
    const n = Math.round((8 + r(3) * 22) * (0.5 + 0.5 * a));
    out.push({
      id: `D${d}-shiira-${z.id}`,
      species: 'shiira',
      habitat: z.id,
      area: areaNameAt(ax, ay),
      a: { x: ax, y: ay },
      b: { x: ax + (r(4) - 0.5) * 500, y: ay + (r(5) - 0.5) * 500 },
      moveStart: (5 + r(6)) * 3600,
      moveEnd: (14 + r(7) * 3) * 3600,
      orbitR: 60 + r(8) * 80,
      orbitPeriod: (20 + r(9) * 20) * 60,
      orbitPhase: r(10) * Math.PI * 2,
      sigmaH: 40 + r(11) * 30,
      sigmaZ: 1.2,
      depthBias: (r(12) - 0.5) * 2,
      noiseSeed: Math.floor(r(13) * 1e9),
      counts: splitCounts(n, 0.15, 0.4),
    });
  });
  return out;
}

function yokowaSchools(seed, d) {
  const out = [];
  const a = Math.min(1.2, abundanceOf(seed, 'yokowa', d));
  if (a < 0.05) return out;
  YOKOWA_ZONES.forEach((z, zi) => {
    if (hashFloat(seed, zi, d, 841) > 0.65 * a) return;
    const r = (j) => hashFloat(seed, zi, d, j, 842);
    const ang = r(1) * Math.PI * 2;
    const run = 1000 + r(2) * 1200; // fast: they cross the whole ground in a day
    const ax = z.x + (r(3) - 0.5) * z.spread;
    const ay = z.y + (r(4) - 0.5) * z.spread;
    const n = Math.round((15 + r(5) * 30) * (0.5 + 0.5 * a));
    out.push({
      id: `D${d}-yokowa-${z.id}`,
      species: 'yokowa',
      habitat: z.id,
      area: areaNameAt(ax, ay),
      a: { x: ax, y: ay },
      b: { x: ax + Math.sin(ang) * run, y: ay + Math.cos(ang) * run },
      moveStart: (5 + r(6)) * 3600,
      moveEnd: (12 + r(7) * 4) * 3600,
      orbitR: 100 + r(8) * 120,
      orbitPeriod: (20 + r(9) * 20) * 60,
      orbitPhase: r(10) * Math.PI * 2,
      sigmaH: 55 + r(11) * 35,
      sigmaZ: 2.5,
      depthBias: (r(12) - 0.5) * 3,
      noiseSeed: Math.floor(r(13) * 1e9),
      counts: splitCounts(n, 0.15, 0.45),
    });
  });
  return out;
}

function amadaiSchools(seed, d) {
  const out = [];
  AMADAI_GROUNDS.forEach((g, gi) => {
    const a = Math.min(1.1, abundanceOf(seed, g.species, d));
    const own = hashFloat(seed, keyOf(`amadai:${g.id}`), 851);
    const day = hashFloat(seed, gi, d, 852);
    const n = Math.round((g.n[0] + (g.n[1] - g.n[0]) * (0.7 * own + 0.3 * day)) * (0.4 + 0.6 * a));
    if (n <= 0) return;
    out.push({
      id: `D${d}-amadai-${g.id}`,
      species: g.species,
      habitat: g.id,
      area: g.area,
      a: { x: g.x, y: g.y },
      b: { x: g.x, y: g.y },
      orbitR: 0,
      sigmaH: g.spread,
      sigmaZ: 0.8,
      noiseSeed: Math.floor(hashFloat(seed, gi, 853) * 1e9),
      counts: splitCounts(n, 0.2, 0.35),
    });
  });
  return out;
}

/** The mood of a school for the day (MOODS): most follow the rule, some do not. */
export function moodOf(seed, d, schoolId) {
  let r = hashFloat(seed, d, keyOf(schoolId), 861);
  for (const m of MOODS) {
    r -= m.p;
    if (r < 0) return { id: m.id, k: m.k };
  }
  return { id: 'usual', k: 1 };
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
  const school = {
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
  // on a reef the アジ feed on the up-current face (潮表) and follow the tide from face to face
  return h.hold ? holdToReef(school, h.hold, 1, 25) : school;
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
  const school = {
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
  // on a reef's flank they lean toward the up-current side (spread widely over the bottom)
  return g.hold ? holdToReef(school, g.hold, 0.5, 40) : school;
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
      s.nokkomi = true; // the gathering stands well off the bottom in the mornings
      out.push(s);
      return;
    }
    const ep = madaiEpisode(seed, gi, d);
    if (!ep.present) return;
    let n = (70 + hashFloat(seed, gi, ep.i, 403) * 90) * (0.9 + 0.2 * hashFloat(seed, gi, d, 404)) * (0.45 + 0.55 * Math.min(1, abundanceOf(seed, 'madai', d)));
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
  n *= 0.35 + 0.65 * Math.min(1, abundanceOf(seed, 'aji', d)); // fewer アジ on the grounds in the cold months (本作設定)
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
    schools.push(...squidSchools(seed, d));
    schools.push(...secondRound(seed, d));
    // the scripted first days teach the basics: every school follows the rule
    return { schools, scripted: true };
  }
  HABITATS.forEach((h, hi) => schools.push(...ajiFromEpisode(seed, d, h, hi)));
  const temp = makeDayConditions(seed, d).waterTemp;
  const wave = sawaraWave(seed, d);
  const aS = abundanceOf(seed, 'sawara', d);
  // spring: the waves come once the water warms past arriveTemp; autumn–winter: while it cools
  const spring = calendarOf(d).season === 'spring';
  if (wave.present && aS > 0.12 && (!spring || temp >= SPECIES.sawara.arriveTemp)) {
    const k = 1 + Math.floor(hashFloat(seed, wave.i, 203) * (1 + 2 * Math.min(1, aS)));
    for (let j = 0; j < k; j++) {
      const zone = SAWARA_ZONES[Math.floor(hashFloat(seed, wave.i, j, 204) * SAWARA_ZONES.length)];
      const n = Math.round((20 + hashFloat(seed, wave.i, j, 205) * 35) * (0.85 + 0.3 * hashFloat(seed, d, j, 206)));
      schools.push(sawaraSchool(seed, d, zone.id, n, j));
    }
  }
  schools.push(...madaiSchools(seed, d));
  schools.push(...reefSchools(seed, d));
  schools.push(...blueSchools(seed, d));
  schools.push(...squidSchools(seed, d));
  schools.push(...secondRound(seed, d));
  for (const s of schools) s.mood = moodOf(seed, d, s.id);
  return { schools, scripted: false };
}

/** The fish added in the second round (本作設定). */
function secondRound(seed, d) {
  return [...isakiSchools(seed, d), ...masabaSchools(seed, d), ...shiiraSchools(seed, d), ...yokowaSchools(seed, d), ...amadaiSchools(seed, d)];
}
