// 暦（本作設定）: a game year of 60 days, four seasons of 15 days. Seasons follow
// the sea, which runs about a month behind the land (R14): 春 = April–June
// (the water warms), 夏 = July–September (warm), 秋 = October–December (it
// cools), 冬 = January–March (cold). One game day stands for about six days of
// the real calendar, five game days to a month. Day 1 of a save is 春の1日目
// (early April). Everything here is a pure function of the day number.

export const YEAR_DAYS = 60;
export const SEASON_DAYS = 15;
export const SEASONS = [
  { id: 'spring', name: '春', months: '4〜6月', water: '水温の上がる時期' },
  { id: 'summer', name: '夏', months: '7〜9月', water: '水温の高い時期' },
  { id: 'autumn', name: '秋', months: '10〜12月', water: '水温の下がる時期' },
  { id: 'winter', name: '冬', months: '1〜3月', water: '水温の低い時期' },
];
const MONTHS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3];

/** Day within the year, 0..59 (day 1 → 0). */
export function yearDay(day) {
  return ((((day - 1) % YEAR_DAYS) + YEAR_DAYS) % YEAR_DAYS);
}

/** Which game year (1, 2, …) the day falls in. */
export function yearOf(day) {
  return Math.floor((Math.max(1, day) - 1) / YEAR_DAYS) + 1;
}

/** The date the day stands for: month 1..12 and day of month (1, 7, 13, 19, 25). */
export function dateOf(day) {
  const yd = yearDay(day);
  return { month: MONTHS[Math.floor(yd / 5)], date: 1 + (yd % 5) * 6 };
}

/**
 * Position in the year as a fraction 0..1 at game time t of the day (0 =
 * 1 April, 0.5 = 1 October). Continuous across days, for smooth seasonal curves.
 */
export function yearPos(day, t = 12 * 3600) {
  return (yearDay(day) + t / 86400) / YEAR_DAYS;
}

/** Everything the screens say about the date. */
export function calendarOf(day) {
  const yd = yearDay(day);
  const si = Math.floor(yd / SEASON_DAYS);
  const season = SEASONS[si];
  const { month, date } = dateOf(day);
  const dayOfSeason = (yd % SEASON_DAYS) + 1;
  const part = dayOfSeason <= 5 ? 'はじめ' : dayOfSeason <= 10 ? 'なかば' : 'おわり';
  return {
    year: yearOf(day),
    yearDay: yd,
    seasonIndex: si,
    season: season.id,
    seasonName: season.name,
    dayOfSeason,
    part, // はじめ / なかば / おわり of the season
    month,
    date,
    dateLabel: `${month}月${date}日ごろ`,
    label: `${season.name} ${dayOfSeason}日目（${month}月${date}日ごろ）`,
    firstOfSeason: dayOfSeason === 1,
    lastOfYear: yd === YEAR_DAYS - 1,
  };
}

/** Day of the real year (1..365) the game day stands for — used for the sun. */
export function realDayOfYear(day) {
  // 1 April = day 91 of the year; each game day covers six real days (its middle is +3)
  return ((91 + yearDay(day) * 6 + 3 - 1) % 365) + 1;
}

// The sun over the fictional port (本作設定: about the latitude of northern
// Kyushu, clock time JST). A standard approximation — good to a few minutes.
const LAT = (33.6 * Math.PI) / 180;
const LON = 130.4;

/** Sunrise and sunset (game seconds since midnight) for the day. */
export function sunTimes(day) {
  const n = realDayOfYear(day);
  const g = (2 * Math.PI * (n - 1)) / 365;
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const eot = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g)); // minutes
  const zen = (90.833 * Math.PI) / 180;
  const cosH = (Math.cos(zen) - Math.sin(LAT) * Math.sin(decl)) / (Math.cos(LAT) * Math.cos(decl));
  const H = (Math.acos(Math.max(-1, Math.min(1, cosH))) * 180) / Math.PI; // degrees
  const noon = 720 - 4 * (LON - 135) - eot; // minutes, JST
  const rise = (noon - 4 * H) * 60;
  const set = (noon + 4 * H) * 60;
  return { rise: Math.round(rise), set: Math.round(set) };
}

const roundTo = (t, step) => Math.round(t / step) * step;

/**
 * The working hours of the day (R18): out an hour before sunrise, home by
 * sunset — the return warning an hour before the automatic return, which
 * starts half an hour before sunset. The evening trip (イカ釣り) leaves an hour
 * before sunset and fishes into the night, home by 23:30 at the latest.
 */
export function dayTimes(day) {
  const sun = sunTimes(day);
  const depart = roundTo(sun.rise - 3600, 600);
  const end = roundTo(sun.set - 1800, 600);
  const nightDepart = roundTo(sun.set - 3600, 600);
  const nightEnd = Math.min(23.5 * 3600, roundTo(sun.set + 5 * 3600, 600));
  return {
    sunrise: sun.rise,
    sunset: sun.set,
    depart,
    warn: end - 3600,
    end,
    night: { depart: nightDepart, warn: nightEnd - 3600, end: nightEnd },
  };
}

/** How light it is at time t (0 = night, 1 = full day): twilight lasts about 40 minutes. */
export function daylightAt(sun, t) {
  const tw = 2400;
  const up = Math.max(0, Math.min(1, (t - (sun.rise - tw * 0.5)) / tw));
  const down = Math.max(0, Math.min(1, ((sun.set + tw * 0.5) - t) / tw));
  return Math.min(up, down);
}

/**
 * Low-light feeding windows (まずめ) around sunrise and sunset: 1 at the
 * centre, falling off over about an hour and a half. Returns {dawn, dusk}.
 */
export function twilightAt(sun, t, width = 1.4 * 3600) {
  const dawn = Math.exp(-(((t - (sun.rise + 900)) / width) ** 2));
  const dusk = Math.exp(-(((t - (sun.set - 900)) / width) ** 2));
  return { dawn, dusk };
}
