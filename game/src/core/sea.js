// Fixed geography of the fictional sea area and the day's sea conditions.
// Coordinates: metres, x = east, y = north. Port is on the south coast.
import { AREA, PORT, TIDE_CYCLE, TIDE_PERIOD, TIDE_OFFSET, SEASON_SCRIPT } from './data.js';
import { hashFloat, noise1 } from './rng.js';

export const FEATURES = {
  kitaNoSe: { name: '北の瀬', x: 2000, y: 2250, r: 220, h: 34 },
  nishiNoNe: { name: '西の根', x: 650, y: 1350, r: 120, h: 14 },
  okiDeep: { x: 600, y: 2650, r: 420, h: -9 },
  // 沖の瀬 (M5): a far reef rising from 70-80 m to about 20 m
  okiNoSe: { name: '沖の瀬', x: 1650, y: 4050, r: 240, h: 50 },
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
  // 沖の瀬: far reef with a rough top
  d -= FEATURES.okiNoSe.h * gauss2(x, y, FEATURES.okiNoSe) * (1 + 0.06 * Math.sin(x / 19) * Math.sin(y / 27));
  // fine roughness
  d += 0.5 * Math.sin(x / 37) * Math.sin(y / 53);
  return Math.max(1.5, d);
}

/** Bottom type used for sounder echo thickness (visual cue only). */
export function bottomIsRocky(x, y) {
  return gauss2(x, y, FEATURES.kitaNoSe) > 0.25 || gauss2(x, y, FEATURES.nishiNoNe) > 0.3 || gauss2(x, y, FEATURES.okiNoSe) > 0.3;
}

export function areaNameAt(x, y) {
  if (isLand(x, y)) return '陸';
  const dPort = Math.hypot(x - PORT.dock.x, y - PORT.dock.y);
  if (dPort < 450) return '港前';
  if (Math.hypot(x - FEATURES.okiNoSe.x, y - FEATURES.okiNoSe.y) < 520) return '沖の瀬';
  if (y > 3200) return '沖合';
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
  { name: '沖の瀬', x: 1650, y: 4050 },
];

// ---------------------------------------------------------------------------
// Sea conditions of one day. Closed-form functions of game time so that any
// view, replay or fast-forward reads the same values.

/** Water temperature trend: smooth over days so that warming is a multi-day signal. */
export function seasonalTemp(worldSeed, day) {
  // peak around day 7 so it continues from the warm early-season script
  return 18.6 + 1.1 * Math.sin((2 * Math.PI * day) / 34 + 0.28) + 0.25 * noise1(worldSeed * 3 + 5, day / 2);
}

export function tideOfDay(day) {
  return TIDE_CYCLE[(((day + TIDE_OFFSET) % 15) + 15) % 15];
}

/** The day's water temperature before rounding (season curve, or the early-season script). */
function rawTemp(worldSeed, day) {
  const script = SEASON_SCRIPT[day];
  return script && script.cond && script.cond.waterTemp != null ? script.cond.waterTemp : seasonalTemp(worldSeed, day);
}

/**
 * Season of the sea (本作設定), from the water temperature and how it has
 * moved over the last two days — public knowledge in port, like the tide table.
 * 乗っ込み: while the water is warming through 17.9-19.3 ℃, マダイ gather on the
 * flanks of 北の瀬 (game setting, not a biological claim).
 */
export function seasonOf(worldSeed, day) {
  const t = rawTemp(worldSeed, day);
  const trend = Math.round(((t - rawTemp(worldSeed, day - 2)) / 2) * 100) / 100;
  let label;
  if (trend >= 0.03) label = '水温の上がる時期';
  else if (trend <= -0.03) label = '水温の下がる時期';
  else if (t >= 19.2) label = '水温の高い時期';
  else if (t <= 18.0) label = '水温の低い時期';
  else label = '水温の落ち着いた時期';
  return { label, trend, nokkomi: trend >= 0.03 && t >= 17.9 && t <= 19.3 };
}

export function makeDayConditions(worldSeed, day) {
  const [tideName, tideAmp] = tideOfDay(day);
  const highWater = (day * 50 * 60 + Math.floor(hashFloat(worldSeed, day, 11) * 3600)) % TIDE_PERIOD;
  let windDir = hashFloat(worldSeed, day, 21) * Math.PI * 2; // direction wind blows TOWARD
  let windSpeed = 1 + hashFloat(worldSeed, day, 22) * 6.5;
  let waterTemp = seasonalTemp(worldSeed, day);
  const script = SEASON_SCRIPT[day];
  if (script && script.cond) {
    if (script.cond.windSpeed != null) windSpeed = script.cond.windSpeed;
    if (script.cond.windDirDeg != null) windDir = (script.cond.windDirDeg * Math.PI) / 180;
    if (script.cond.waterTemp != null) waterTemp = script.cond.waterTemp;
  }
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
    season: seasonOf(worldSeed, day),
  };
}

/**
 * The forecast the player reads in port: tides are exact (tables), wind and
 * water temperature carry a small, deterministic forecast error. Forecast and
 * the conditions met at sea are therefore not the same thing.
 */
export function forecastOf(cond) {
  const e1 = (hashFloat(cond.seed, cond.day, 91) - 0.5) * 2.4;
  const e2 = (hashFloat(cond.seed, cond.day, 92) - 0.5) * 0.6;
  return {
    ...cond,
    forecast: true,
    windSpeed: Math.max(0.5, Math.round((cond.windSpeed + e1) * 2) / 2),
    waterTemp: Math.round((cond.waterTemp + e2) * 10) / 10,
  };
}

export function tideClass(tideName) {
  if (tideName === '大潮') return '大潮';
  if (tideName === '中潮') return '中潮';
  return '小潮系';
}

export function windBand(speed) {
  if (speed < 4) return '弱';
  if (speed < 6.5) return 'やや強';
  return '強';
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
  const from = compass8(-Math.sin(cond.windDir), -Math.cos(cond.windDir));
  lines.push(`風：${from}の風 ${cond.windSpeed.toFixed(1)}m/s 前後`);
  lines.push(`水温：${cond.waterTemp.toFixed(1)}℃前後`);
  if (cond.season) lines.push(`季節：${cond.season.label}（ここ2日で水温${cond.season.trend >= 0 ? '+' : ''}${cond.season.trend.toFixed(2)}℃/日）${cond.season.nokkomi ? '・マダイの乗っ込みの頃' : ''}`);
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
