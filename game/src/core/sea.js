// Fixed geography of the fictional sea area and the day's sea conditions.
// Coordinates: metres, x = east, y = north. Port is on the south coast.
import { AREA, PORT, TIDE_CYCLE, TIDE_PERIOD } from './data.js';
import { hashFloat, noise1 } from './rng.js';

export const FEATURES = {
  kitaNoSe: { name: '北の瀬', x: 2000, y: 2250, r: 220, h: 34 },
  nishiNoNe: { name: '西の根', x: 650, y: 1350, r: 120, h: 14 },
  okiDeep: { x: 600, y: 2650, r: 420, h: -9 },
};

/** y of the coastline at x (land is south of it). */
export function coastY(x) {
  const bay = 75 * Math.exp(-(((x - PORT.dock.x) / 150) ** 2));
  return 150 + 45 * Math.sin(x / 520 + 0.7) + 22 * Math.sin(x / 190 + 1.3) - bay;
}

export function isLand(x, y) {
  return y < coastY(x);
}

export function inBounds(x, y) {
  return x >= 0 && x <= AREA.W && y >= 0 && y <= AREA.H;
}

function gauss2(x, y, f) {
  const dx = x - f.x;
  const dy = y - f.y;
  return Math.exp(-(dx * dx + dy * dy) / (f.r * f.r));
}

function smoothstep(a, b, v) {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Water depth (m, positive) at a point. Land returns 0. */
export function depthAt(x, y) {
  const s = y - coastY(x);
  if (s <= 0) return 0;
  let d = 3 + 22 * (1 - Math.exp(-s / 700)) + 0.012 * s;
  // 北の瀬: reef rising to ~16 m, with a rough top
  const reef = gauss2(x, y, FEATURES.kitaNoSe);
  d -= FEATURES.kitaNoSe.h * reef * (1 + 0.08 * Math.sin(x / 23) * Math.sin(y / 31));
  // 西の根: rocky patch
  d -= FEATURES.nishiNoNe.h * gauss2(x, y, FEATURES.nishiNoNe);
  // 東の駆け上がり: drop-off east of x≈2450 north of y≈900
  d += 12 * smoothstep(2380, 2560, x) * smoothstep(800, 1100, y);
  // 沖の深み
  d -= FEATURES.okiDeep.h * gauss2(x, y, FEATURES.okiDeep);
  // fine roughness
  d += 0.5 * Math.sin(x / 37) * Math.sin(y / 53);
  return Math.max(1.5, d);
}

/** Bottom type used for sounder echo thickness (visual cue only). */
export function bottomIsRocky(x, y) {
  return gauss2(x, y, FEATURES.kitaNoSe) > 0.25 || gauss2(x, y, FEATURES.nishiNoNe) > 0.3;
}

export function areaNameAt(x, y) {
  if (isLand(x, y)) return '陸';
  const dPort = Math.hypot(x - PORT.dock.x, y - PORT.dock.y);
  if (dPort < 450) return '港前';
  if (Math.hypot(x - FEATURES.kitaNoSe.x, y - FEATURES.kitaNoSe.y) < 420) return '北の瀬';
  if (Math.hypot(x - FEATURES.nishiNoNe.x, y - FEATURES.nishiNoNe.y) < 280) return '西の根';
  if (x > 2330 && y > 850) return '東の駆け上がり';
  if (Math.hypot(x - FEATURES.okiDeep.x, y - FEATURES.okiDeep.y) < 500) return '沖の深み';
  if (y - coastY(x) < 600) return '南の浅場';
  return '沖の平場';
}

/** Chart labels (fixed public knowledge — the geography, not fish). */
export const CHART_LABELS = [
  { name: '北の瀬', x: 2000, y: 2250 },
  { name: '西の根', x: 650, y: 1350 },
  { name: '東の駆け上がり', x: 2620, y: 1700 },
  { name: '沖の深み', x: 600, y: 2650 },
  { name: '沖の平場', x: 1350, y: 1700 },
  { name: '南の浅場', x: 700, y: 520 },
];

// ---------------------------------------------------------------------------
// Sea conditions of one day. Closed-form functions of game time so that any
// view, replay or fast-forward reads the same values.

export function makeDayConditions(worldSeed, day) {
  const [tideName, tideAmp] = TIDE_CYCLE[((day % 15) + 15) % 15];
  const highWater = (day * 50 * 60 + Math.floor(hashFloat(worldSeed, day, 11) * 3600)) % TIDE_PERIOD;
  const windDir = hashFloat(worldSeed, day, 21) * Math.PI * 2; // direction wind blows TOWARD
  const windSpeed = 1 + hashFloat(worldSeed, day, 22) * 6.5;
  const waterTemp = 17 + hashFloat(worldSeed, day, 31) * 4;
  const axis = (40 * Math.PI) / 180; // flood current flows toward NE
  return {
    day,
    tideName,
    tideAmp,
    highWater,
    windDir,
    windSpeed,
    waterTemp: Math.round(waterTemp * 10) / 10,
    axis,
    seed: worldSeed,
  };
}

/** Tidal current vector (m/s) at time t (seconds since midnight). */
export function currentAt(cond, t) {
  const phase = (2 * Math.PI * (t - cond.highWater)) / TIDE_PERIOD;
  // flood flows NE for half the cycle, ebb SW; slack at turning points
  const s = cond.tideAmp * Math.sin(phase);
  return {
    x: Math.sin(cond.axis) * s + 0.03,
    y: Math.cos(cond.axis) * s,
  };
}

/** Wind vector (m/s, the direction it blows toward). Slow variation over the day. */
export function windAt(cond, t) {
  const v = 1 + 0.2 * noise1(cond.seed * 7 + cond.day, t / 3600);
  const d = cond.windDir + 0.25 * noise1(cond.seed * 13 + cond.day, t / 5400);
  return { x: Math.sin(d) * cond.windSpeed * v, y: Math.cos(d) * cond.windSpeed * v };
}

/** Compass label for a vector direction (toward). */
export function compass8(vx, vy) {
  const names = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'];
  const ang = Math.atan2(vx, vy); // 0 = north, clockwise
  const i = Math.round(((ang + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8;
  return names[i];
}

/** Short human forecast for the port screen (from the day's conditions only). */
export function forecastText(cond) {
  const lines = [];
  lines.push(`潮回り：${cond.tideName}`);
  const w = windAt(cond, 8 * 3600);
  const from = compass8(-w.x, -w.y);
  lines.push(`風：${from}の風 ${cond.windSpeed.toFixed(1)}m/s 前後`);
  lines.push(`水温：${cond.waterTemp.toFixed(1)}℃前後`);
  // describe the tide between 05:00 and 12:00 by sampling the closed form
  const parts = [];
  let prev = null;
  for (let h = 5; h <= 12; h += 0.5) {
    const c = currentAt(cond, h * 3600);
    const sp = Math.hypot(c.x, c.y);
    const label = sp < 0.1 ? '潮止まり' : `${compass8(c.x, c.y)}へ流れる`;
    if (label !== prev) {
      parts.push(`${fmtClock(h * 3600)} ${label}`);
      prev = label;
    }
  }
  lines.push(`潮流（予報）：${parts.join(' → ')}`);
  return lines;
}

export function fmtClock(t) {
  const h = Math.floor(t / 3600) % 24;
  const m = Math.floor((t % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
