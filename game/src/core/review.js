// 1年の振り返り（R02）: what a game year (60 days) came to, from the ledger and
// the records — totals, the seasons, the best fish and days — next to the year
// before. Nothing ends: the next year simply begins.
import { SPECIES } from './data.js';
import { YEAR_DAYS, SEASONS, calendarOf } from './calendar.js';

const yearOfDay = (d) => Math.floor((d - 1) / YEAR_DAYS) + 1;

/** The summary of game year `year` (1, 2, …) from the profile's ledger. */
export function yearSummary(profile, year) {
  const lines = (profile.ledger || []).filter((l) => yearOfDay(l.day) === year);
  const sum = (arr, k) => arr.reduce((a, l) => a + (l[k] || 0), 0);
  const seasons = SEASONS.map((s, i) => {
    const ls = lines.filter((l) => calendarOf(l.day).seasonIndex === i);
    const sp = {};
    for (const l of ls) for (const [k, v] of Object.entries(l.bySpecies || {})) sp[k] = (sp[k] || 0) + v.sales;
    const top = Object.entries(sp).sort((a, b) => b[1] - a[1])[0];
    return { id: s.id, name: s.name, voyages: ls.length, sales: sum(ls, 'sales'), net: sum(ls, 'net'), top: top ? { species: top[0], name: SPECIES[top[0]].name, sales: top[1] } : null };
  });
  const bySp = {};
  for (const l of lines) {
    for (const [k, v] of Object.entries(l.bySpecies || {})) {
      const b = (bySp[k] = bySp[k] || { n: 0, kg: 0, sales: 0 });
      b.n += v.n;
      b.kg = Math.round((b.kg + v.kg) * 10) / 10;
      b.sales += v.sales;
    }
  }
  const topSpecies = Object.entries(bySp)
    .sort((a, b) => b[1].sales - a[1].sales)
    .slice(0, 5)
    .map(([sp, b]) => ({ species: sp, name: SPECIES[sp].name, ...b }));
  let biggest = null;
  for (const l of lines) {
    for (const [sp, w] of Object.entries(l.best || {})) {
      const ratio = w / SPECIES[sp].sizes[SPECIES[sp].sizeOrder[SPECIES[sp].sizeOrder.length - 1]].kg;
      if (!biggest || ratio > biggest.ratio) biggest = { species: sp, name: SPECIES[sp].name, w, day: l.day, ratio };
    }
  }
  const bestDay = lines.reduce((b, l) => (!b || l.net > b.net ? l : b), null);
  const kg = Math.round(Object.values(bySp).reduce((a, b) => a + b.kg, 0) * 10) / 10;
  return {
    year,
    voyages: lines.length,
    sales: sum(lines, 'sales'),
    costs: lines.reduce((a, l) => a + (l.costs ? l.costs.total : 0), 0),
    net: sum(lines, 'net'),
    kg,
    seasons,
    topSpecies,
    biggest,
    bestDay: bestDay ? { day: bestDay.day, label: calendarOf(bestDay.day).dateLabel, net: bestDay.net } : null,
    kinds: Object.keys(bySp).length,
  };
}

/** Is a year review due on day `today` (the first day of a new year, not yet shown)? Returns the year to review or 0. */
export function reviewDue(profile, today) {
  const year = yearOfDay(today) - 1;
  if (year < 1) return 0;
  return (profile.years ? profile.years.reviewed : 0) < year ? year : 0;
}

/** Mark the year's review as shown (pure). */
export function markReviewed(profile, year) {
  return { ...profile, years: { ...(profile.years || {}), reviewed: Math.max(year, (profile.years && profile.years.reviewed) || 0) } };
}
