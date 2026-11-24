// Item 10 (revised in the second round, R17): weather — やや時化 (strong wind,
// rough sea; winter monsoon, late-summer typhoon swell) and 霧 (morning fog
// that lifts). Nobody is kept in port by the weather. A pure function of (seed, day).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProfile, markDeparture, restDay } from '../src/core/profile.js';
import { createVoyage, advanceVoyage, startOperation } from '../src/core/voyage.js';
import { weatherOf, makeDayConditions, forecastOf, forecastText, visibilityAt } from '../src/core/sea.js';
import { briefingReports, radioReports } from '../src/core/reports.js';
import { SEASON_SCRIPT } from '../src/core/data.js';
import { CALM } from './helpers.js';
import { calendarOf } from '../src/core/calendar.js';

const NOW = '2026-11-23T00:00:00.000Z';

function findDay(seed, kind, from = 7) {
  for (let d = from; d < 400; d++) if (weatherOf(seed, d).kind === kind) return d;
  return null;
}

test('weather is a pure function of seed and day; the early season is fair; nothing ever keeps the boats in (R17)', () => {
  for (const d of Object.keys(SEASON_SCRIPT)) assert.equal(weatherOf(77, Number(d)).kind, 'fine');
  const n = { storm: 0, rough: 0, fog: 0 };
  for (let d = 7; d < 307; d++) {
    const w = weatherOf(77, d);
    assert.deepEqual(weatherOf(77, d), w);
    assert.equal(w.storm, false);
    if (n[w.kind] != null) n[w.kind] += 1;
  }
  assert.equal(n.storm, 0);
  assert.ok(n.rough >= 25 && n.rough <= 70, JSON.stringify(n));
  assert.ok(n.fog >= 15 && n.fog <= 60, JSON.stringify(n));
});

test('the weather follows the season: winter is rough with the north-west monsoon, spring has the fogs, late summer brings typhoon swell', () => {
  const by = [0, 0, 0, 0].map(() => ({ rough: 0, fog: 0, days: 0, typhoon: 0 }));
  for (let d = 61; d <= 61 + 60 * 5 - 1; d++) {
    const w = weatherOf(3, d);
    const b = by[calendarOf(d).seasonIndex];
    b.days += 1;
    if (w.rough) b.rough += 1;
    if (w.kind === 'fog') b.fog += 1;
    if (w.typhoon) b.typhoon += 1;
  }
  const [spring, summer, , winter] = by;
  assert.ok(winter.rough / winter.days > 2 * (summer.rough - summer.typhoon) / summer.days, JSON.stringify(by));
  assert.ok(spring.fog > winter.fog, JSON.stringify(by));
  assert.ok(summer.typhoon > 0, JSON.stringify(by));
  // winter's wind mostly blows from the north-west (toward the south-east)
  let nw = 0;
  let wd = 0;
  for (let d = 106; d <= 120; d++) {
    const c = makeDayConditions(3, d);
    wd += 1;
    const toward = ((c.windDir * 180) / Math.PI + 360) % 360;
    if (toward > 80 && toward < 190) nw += 1;
  }
  assert.ok(nw >= wd * 0.5, `${nw}/${wd}`);
});

test('a rough day blows 8–11.5 m/s; the forecast says so and the peers still go out', () => {
  const dr = findDay(77, 'rough');
  const wr = makeDayConditions(77, dr).windSpeed;
  assert.ok(wr >= 8 && wr <= 11.5, `${wr}`);
  assert.ok(forecastText(forecastOf(makeDayConditions(77, dr))).some((l) => /時化|うねり/.test(l)));
  assert.ok(radioReports(77, dr).length > 0);
  assert.ok(briefingReports(77, dr + 1).some((r) => r.obsDay === dr && r.kind !== 'rule'));
});

test('resting in port passes the day and changes nothing else; not while at sea', () => {
  const p = createProfile({ worldSeed: 77, now: NOW });
  const r = restDay(p);
  assert.equal(r.day, p.day + 1);
  assert.equal(r.funds, p.funds);
  assert.equal(p.day, 0);
  assert.throws(() => restDay(markDeparture(p, NOW)));
});

test('morning fog: the view closes in, then lifts; signs on the surface are only seen close by', () => {
  const df = findDay(77, 'fog');
  const cond = makeDayConditions(77, df);
  const f = cond.weather.fog;
  assert.ok(visibilityAt(cond, 6 * 3600) <= 400);
  assert.equal(visibilityAt(cond, f.until + 60), 3000);
  // a shallow bait school with birds 900 m away: seen on a clear morning, not in this fog
  const schools = [{ id: 'BAIT', species: 'iwashi', a: { x: 1500, y: 1500 }, counts: { s: 3000, m: 2000, l: 1000 }, sigmaH: 50, sigmaZ: 2, fixedDepth: 4, orbitR: 0 }];
  const run = (fog) => {
    const p = createProfile({ worldSeed: 77, now: NOW });
    p.day = df - 1;
    const dep = markDeparture(p, NOW);
    const v = createVoyage(dep, { scenario: { conditions: { ...CALM, weather: fog ? cond.weather : { kind: 'fine', fog: null } }, schools }, start: { x: 1500, y: 600, heading: 0 }, radio: [] });
    v.world.time = 6 * 3600;
    advanceVoyage(v, 30);
    return v.messages.some((m) => /鳥山/.test(m.text));
  };
  assert.equal(run(false), true);
  assert.equal(run(true), false);
});

test('a rough sea slows the hands: baiting and unhooking take a quarter longer', () => {
  const dr = findDay(77, 'rough');
  const p = createProfile({ worldSeed: 77, now: NOW });
  p.day = dr - 1;
  const dep = markDeparture(p, NOW);
  const v = createVoyage(dep, { start: { x: 1500, y: 1500, heading: 0 }, radio: [] });
  v.world.time = 7 * 3600;
  advanceVoyage(v, 3);
  const calm = createVoyage(markDeparture(createProfile({ worldSeed: 77, now: NOW }), NOW), { scenario: { conditions: CALM, schools: [] }, start: { x: 1500, y: 1500, heading: 0 }, radio: [] });
  calm.world.time = 7 * 3600;
  advanceVoyage(calm, 3);
  assert.ok(startOperation(v).ok && startOperation(calm).ok);
  assert.ok(Math.abs(v.op.skill.rebait / calm.op.skill.rebait - 1.25) < 1e-9);
});
