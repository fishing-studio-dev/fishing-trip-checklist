// 旬と季節の暦（本作設定）: how plentiful each fish is on a given day, and what the
// port knows about the season. The general seasonal table (SEASONALITY) is
// public knowledge — "what is said" — and is what the season card shows. The
// sea itself also follows how warm or cold this year runs, so a year can
// differ from what is said.
import { SPECIES, SEASONALITY, SIZE_SEASON } from './data.js';
import { calendarOf, yearPos, dayTimes } from './calendar.js';
import { seasonalTemp, seasonCurve } from './sea.js';

/** The general table value at a year position (0..1 from 1 April), smooth between months. */
export function tableAt(months, pos) {
  const n = months.length;
  const x = (((pos * n - 0.5) % n) + n) % n;
  const i = Math.floor(x);
  const u = x - i;
  const k = u * u * (3 - 2 * u);
  return months[i] * (1 - k) + months[(i + 1) % n] * k;
}

/** What is said about a fish on this day (0..1), ignoring this year's water. */
export function usualAbundance(species, day) {
  const s = SEASONALITY[species];
  return s ? tableAt(s.months, yearPos(day)) : 1;
}

/** How warm the water runs today against the usual curve (℃). */
export function warmthOf(worldSeed, day) {
  return seasonalTemp(worldSeed, day) - seasonCurve(yearPos(day));
}

/**
 * How plentiful a fish really is in this sea on this day (0..~1.3): the usual
 * season, shifted by a warm or cold year (`warm` per ℃).
 */
export function abundanceOf(worldSeed, species, day) {
  const s = SEASONALITY[species];
  if (!s) return 1;
  const base = tableAt(s.months, yearPos(day));
  const fit = Math.max(0.4, Math.min(1.4, 1 + (s.warm || 0) * warmthOf(worldSeed, day)));
  return Math.max(0, Math.min(1.3, base * fit));
}

/** Share multiplier for the large fish this season (1 = the species' usual). */
export function bigShareOf(species, day) {
  const t = SIZE_SEASON[species];
  return t ? tableAt(t, yearPos(day)) : 1;
}

const sellable = () => Object.keys(SEASONALITY).filter((sp) => SPECIES[sp] && !SPECIES[sp].bait);

/** The port's season card: date, sun, and the fish in season (general knowledge). */
export function almanacOf(worldSeed, day) {
  const calendar = calendarOf(day);
  const sun = dayTimes(day);
  const now = (sp) => usualAbundance(sp, day);
  const later = (sp) => usualAbundance(sp, day + 7);
  const fish = (sp) => ({ id: sp, name: SPECIES[sp].name });
  const inSeason = sellable().filter((sp) => now(sp) >= 0.88).map(fish);
  const arriving = sellable().filter((sp) => now(sp) < 0.88 && later(sp) - now(sp) >= 0.25).map(fish);
  const leaving = sellable().filter((sp) => now(sp) >= 0.5 && now(sp) - later(sp) >= 0.3).map(fish);
  const turnNote = SEASON_TURN[calendar.season];
  return { calendar, sun, inSeason, arriving, leaving, turnNote };
}

// What the old hands say when a season turns (general knowledge, game setting).
const SEASON_TURN = {
  spring: '水温が上がり始める。マダイの乗っ込み、春のサワラとヒラマサ。梅雨が近づけばイサキが瀬に付く。',
  summer: '水温が高い。日が長く、朝は4時台に出られる。シイラ・カンパチ・ケンサキイカ、根ではキジハタやアカハタ。夏の終わりには台風のうねりが来ることがある。',
  autumn: '水温が下がり始める。サバが群れ、サワラやヨコワが入り、アマダイも良くなる。日が短くなる。',
  winter: '水温が一年でいちばん低い。北西の季節風で荒れる日が多い。寒ブリ・ヒラマサ・ヤリイカ・アラの頃。',
};
