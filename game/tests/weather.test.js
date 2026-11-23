// Item 10: weather — 時化 (nobody goes out), やや時化 (strong wind, rough sea),
// 霧 (morning fog that lifts). A pure function of (seed, day).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProfile, markDeparture, restDay } from '../src/core/profile.js';
import { createVoyage, advanceVoyage, startOperation } from '../src/core/voyage.js';
import { weatherOf, makeDayConditions, forecastOf, forecastText, visibilityAt } from '../src/core/sea.js';
import { briefingReports, radioReports } from '../src/core/reports.js';
import { SEASON_SCRIPT } from '../src/core/data.js';
import { CALM } from './helpers.js';

const NOW = '2026-11-23T00:00:00.000Z';

function findDay(seed, kind, from = 7) {
  for (let d = from; d < 400; d++) if (weatherOf(seed, d).kind === kind) return d;
  return null;
}

test('weather is a pure function of seed and day; the early season is fair; storms, rough days and fog all happen', () => {
  for (const d of Object.keys(SEASON_SCRIPT)) assert.equal(weatherOf(77, Number(d)).kind, 'fine');
  const n = { storm: 0, rough: 0, fog: 0 };
  for (let d = 7; d < 307; d++) {
    const w = weatherOf(77, d);
    assert.deepEqual(weatherOf(77, d), w);
    if (n[w.kind] != null) n[w.kind] += 1;
  }
  assert.ok(n.storm >= 10 && n.storm <= 40, JSON.stringify(n));
  assert.ok(n.rough >= 15 && n.rough <= 50, JSON.stringify(n));
  assert.ok(n.fog >= 20 && n.fog <= 60, JSON.stringify(n));
});

test('a storm blows ≥ 11 m/s, a rough day 8–10.5 m/s; the forecast says so', () => {
  const ds = findDay(77, 'storm');
  const dr = findDay(77, 'rough');
  assert.ok(makeDayConditions(77, ds).windSpeed >= 11);
  const wr = makeDayConditions(77, dr).windSpeed;
  assert.ok(wr >= 8 && wr <= 10.5);
  assert.ok(forecastText(forecastOf(makeDayConditions(77, ds))).some((l) => /時化/.test(l)));
});

test('on a storm day the peers stay in: no radio, no catches that day, and they say so the next morning', () => {
  const ds = findDay(77, 'storm');
  assert.equal(radioReports(77, ds).length, 0);
  const today = briefingReports(77, ds);
  assert.ok(today.some((r) => /時化/.test(r.text)));
  assert.ok(!today.some((r) => r.kind === 'catch' || r.kind === 'echo' || r.kind === 'sighting'));
  if (!weatherOf(77, ds + 1).storm) {
    const next = briefingReports(77, ds + 1);
    assert.ok(next.some((r) => /昨日は時化/.test(r.text)));
    assert.ok(!next.some((r) => r.obsDay === ds && r.kind !== 'rule'));
  }
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
