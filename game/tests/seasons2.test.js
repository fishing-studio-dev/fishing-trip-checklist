// Second round, stage 1: the 60-day year, the sun, the 玄界灘-like water, the
// fish of each season, and feeding that follows the tide, the light and a
// daily mood (R03, R04, R13, R14, R17, R18 and the research notes in
// docs/REQUIREMENTS_R2.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calendarOf, dayTimes, sunTimes, YEAR_DAYS } from '../src/core/calendar.js';
import { makeDayConditions, seasonalTemp, depthAt, STRUCTURES } from '../src/core/sea.js';
import { almanacOf, abundanceOf, usualAbundance } from '../src/core/almanac.js';
import { dayPlan, moodOf } from '../src/core/season.js';
import { createWorld, densityAt, activityAt, schoolPose, tidePhase, normalizeSchool } from '../src/core/world.js';
import { createProfile, markDeparture } from '../src/core/profile.js';
import { createVoyage, advanceVoyage, startOperation, stopOperation, isOperating, setMethod } from '../src/core/voyage.js';
import { MOODS, SPECIES, METHODS, TIDE_PERIOD, PEERS, BRIEFING_T, PROGRESSION } from '../src/core/data.js';
import { briefingReports } from '../src/core/reports.js';
import { CALM } from './helpers.js';

const NOW = '2026-11-24T00:00:00.000Z';
const kinds = (seed, d) => new Set(dayPlan(seed, d).schools.map((s) => s.species));
const fishIn = (seed, d, sp) => dayPlan(seed, d).schools.filter((s) => s.species === sp).reduce((a, s) => a + s.counts.s + s.counts.m + s.counts.l, 0);

test('the calendar: 60 days a year, 15 per season, spring = April–June; day 1 is early April', () => {
  assert.equal(YEAR_DAYS, 60);
  const c1 = calendarOf(1);
  assert.equal(c1.seasonName, '春');
  assert.equal(c1.month, 4);
  assert.equal(c1.dayOfSeason, 1);
  assert.equal(calendarOf(16).seasonName, '夏');
  assert.equal(calendarOf(16).month, 7);
  assert.equal(calendarOf(31).seasonName, '秋');
  assert.equal(calendarOf(46).seasonName, '冬');
  assert.equal(calendarOf(46).month, 1);
  assert.equal(calendarOf(60).dayOfSeason, 15);
  assert.equal(calendarOf(61).year, 2);
  assert.deepEqual({ ...calendarOf(61), year: 1 }, calendarOf(1));
  assert.match(calendarOf(3).label, /^春 3日目（4月13日ごろ）$/);
});

test('the sun moves with the season, and so do the working hours (R18)', () => {
  const june = sunTimes(13);
  const jan = sunTimes(46);
  assert.ok(june.rise < 5.3 * 3600 && jan.rise > 7 * 3600, `${june.rise / 3600} ${jan.rise / 3600}`);
  assert.ok(june.set > 19.2 * 3600 && jan.set < 17.5 * 3600);
  for (const d of [1, 13, 30, 46]) {
    const h = dayTimes(d);
    assert.equal(h.depart, Math.round((h.sunrise - 3600) / 600) * 600);
    assert.ok(h.end <= h.sunset && h.end >= h.sunset - 2400);
    assert.ok(h.night.depart < h.sunset);
  }
  // the voyage starts and ends by the sun
  const p = createProfile({ worldSeed: 5, now: NOW });
  p.day = 45;
  const v = createVoyage(markDeparture(p, NOW), { radio: [] });
  assert.equal(v.world.time, dayTimes(46).depart);
  assert.equal(v.endT, dayTimes(46).end);
});

test('the water follows the 玄界灘 year: about 14 ℃ in late winter, about 27 ℃ at the end of summer; years differ a little', () => {
  let min = 99;
  let max = 0;
  let minD = 0;
  let maxD = 0;
  for (let d = 61; d <= 120; d++) {
    const t = makeDayConditions(7, d).waterTemp;
    if (t < min) [min, minD] = [t, d];
    if (t > max) [max, maxD] = [t, d];
  }
  assert.ok(min >= 12.8 && min <= 15.2, `min ${min}`);
  assert.ok(max >= 25.8 && max <= 28.2, `max ${max}`);
  assert.ok(calendarOf(minD).seasonName === '冬' || calendarOf(minD).month === 4, calendarOf(minD).label);
  assert.ok([8, 9].includes(calendarOf(maxD).month), calendarOf(maxD).label);
  // two years are not the same
  const y1 = seasonalTemp(7, 50);
  const y3 = seasonalTemp(7, 170);
  assert.notEqual(Math.round(y1 * 10), Math.round(y3 * 10));
});

test('what is in season (general knowledge): イサキ in June, ブリ in January; ヤリイカ not in summer', () => {
  const june = almanacOf(1, 13).inSeason.map((f) => f.id);
  const jan = almanacOf(1, 48).inSeason.map((f) => f.id);
  assert.ok(june.includes('isaki'), june.join());
  assert.ok(jan.includes('buri'), jan.join());
  assert.ok(usualAbundance('yari', 23) === 0);
  assert.ok(almanacOf(1, 16).calendar.firstOfSeason);
  assert.match(almanacOf(1, 16).turnNote, /シイラ/);
});

test('the fish change with the season: シイラ in summer only, ヨコワ and マサバ in autumn–winter, アマダイ all year', () => {
  for (const seed of [3, 77]) {
    let summerShiira = 0;
    let winterShiira = 0;
    let autumnYokowa = 0;
    let summerYokowa = 0;
    for (let k = 0; k < 15; k++) {
      summerShiira += fishIn(seed, 76 + k, 'shiira');
      winterShiira += fishIn(seed, 106 + k, 'shiira');
      autumnYokowa += fishIn(seed, 91 + k, 'yokowa');
      if (k < 12) summerYokowa += fishIn(seed, 76 + k, 'yokowa'); // July to mid-September
    }
    assert.ok(summerShiira > 50 && winterShiira === 0, `${summerShiira} ${winterShiira}`);
    assert.ok(autumnYokowa > 30 && summerYokowa === 0, `${autumnYokowa} ${summerYokowa}`);
    assert.ok(fishIn(seed, 100, 'masaba') > fishIn(seed, 75, 'masaba'));
    for (const d of [65, 80, 95, 110]) assert.ok(kinds(seed, d).has('akaamadai'), `day ${d}`);
  }
});

test('アカハタ only on the shallow structures; the 根魚 numbers follow the season', () => {
  const p = dayPlan(77, 80).schools.filter((s) => s.species === 'akahata');
  assert.ok(p.length > 0);
  for (const s of p) {
    const st = STRUCTURES.find((x) => x.id === s.habitat);
    if (st) assert.ok(depthAt(st.x, st.y) <= SPECIES.akahata.maxDepth, s.habitat);
  }
  assert.ok(fishIn(77, 80, 'kijihata') > fishIn(77, 110, 'kijihata'), 'キジハタ: more in summer than winter');
});

test('a warm year: fewer 寒ブリ than a cold one (暖冬は寒ブリが薄い)', () => {
  // the same winter day under different seeds: compare the abundance factor against the warmth
  const rows = [];
  for (let seed = 1; seed <= 40; seed++) rows.push({ warm: seasonalTemp(seed, 108) - 16, buri: abundanceOf(seed, 'buri', 108) });
  rows.sort((a, b) => a.warm - b.warm);
  const cold = rows.slice(0, 10).reduce((a, r) => a + r.buri, 0);
  const warm = rows.slice(-10).reduce((a, r) => a + r.buri, 0);
  assert.ok(cold > warm, `${cold} ${warm}`);
});

test('アマダイ live in burrows: the instruments never see them, the longline does', () => {
  const sch = normalizeSchool({ id: 'A', species: 'akaamadai', a: { x: 620, y: 2680 }, counts: { s: 30, m: 40, l: 10 }, sigmaH: 40, sigmaZ: 0.8, orbitR: 0 });
  const w = createWorld(1, 70, 8 * 3600, { conditions: CALM, schools: [sch] });
  const z = depthAt(620, 2680) - 0.3;
  assert.equal(densityAt(w, 620, 2680, z, null).total, 0);
  assert.ok(densityAt(w, 620, 2680, z, null, METHODS.longline.targets).total > 0);
});

test('the methods catch the new fish: イサキ on the handline over a reef top', () => {
  const p = createProfile({ worldSeed: 9, now: NOW });
  p.day = 12;
  const dep = markDeparture(p, NOW);
  const isaki = { id: 'I', species: 'isaki', a: { x: 1500, y: 2200 }, counts: { s: 60, m: 140, l: 40 }, sigmaH: 25, sigmaZ: 3, fixedOffBottom: 6, activityOverride: 1, orbitR: 0 };
  const v = createVoyage(dep, { scenario: { conditions: CALM, schools: [isaki] }, start: { x: 1500, y: 2200, heading: 0 }, radio: [] });
  v.world.time = 7 * 3600;
  assert.ok(setMethod(v, 'handline').ok);
  advanceVoyage(v, 20);
  assert.ok(startOperation(v).ok);
  advanceVoyage(v, 15 * 60);
  stopOperation(v, 'player');
  while (isOperating(v)) advanceVoyage(v, 1);
  const log = v.logs.at(-1);
  assert.ok(log.count >= 5, `${log.count}`);
  assert.ok(log.bySpecies && log.bySpecies.isaki, JSON.stringify(log.bySpecies));
});

test('the tide phase: slack, starting, running and easing come round in turn with the tidal stream', () => {
  const cond = { ...makeDayConditions(3, 20), tideAmp: 0.3, highWater: 0 };
  const seen = [];
  for (let t = 0; t < TIDE_PERIOD; t += 300) {
    const p = tidePhase(cond, t);
    const sum = p.slack + p.starting + p.running + p.easing;
    assert.ok(Math.abs(sum - 1) < 1e-9);
    const top = ['slack', 'starting', 'running', 'easing'].reduce((a, k) => (p[k] > p[a] ? k : a), 'slack');
    if (seen.at(-1) !== top) seen.push(top);
  }
  assert.deepEqual(seen.slice(0, 5), ['slack', 'starting', 'running', 'easing', 'slack']);
});

/** Activity of a school of `species` at the strongest phase of each kind. */
function byPhase(species, mood = null) {
  const cond = { ...makeDayConditions(3, 20), tideAmp: 0.25, highWater: 0, waterTemp: 21, afterRough: false };
  const w = { cond, schools: [] };
  const s = normalizeSchool({ id: 'X', species, a: { x: 1500, y: 1500 }, counts: { s: 1, m: 1, l: 1 }, noiseSeed: 5, mood });
  const at = (k) => {
    let best = null;
    for (let t = 10 * 3600; t < 10 * 3600 + TIDE_PERIOD; t += 120) {
      const p = tidePhase(cond, t);
      if (!best || p[k] > best.v) best = { v: p[k], t };
    }
    return activityAt(w, s, best.t);
  };
  return { slack: at('slack'), starting: at('starting'), running: at('running'), easing: at('easing') };
}

test('アジ: an echo at slack water hardly bites; it comes on as the stream starts', () => {
  const a = byPhase('aji');
  assert.ok(a.slack < a.starting * 0.3, JSON.stringify(a));
  assert.ok(a.starting > a.running);
});

test('根魚: easiest when the stream eases or stops; マダイ: at the start and before it stops', () => {
  const r = byPhase('kasago');
  assert.ok(r.slack > r.running && r.easing > r.running, JSON.stringify(r));
  const m = byPhase('madai');
  assert.ok(m.starting > m.running && m.easing > m.running && m.slack < m.running, JSON.stringify(m));
});

test('nature does not always follow the rule: a contrary day bites at slack, a dull day hardly bites at all', () => {
  const usual = byPhase('aji');
  const contrary = byPhase('aji', { id: 'contrary', k: 1 });
  const dull = byPhase('aji', { id: 'dull', k: 0.4 });
  assert.ok(contrary.slack > usual.slack * 3, JSON.stringify({ usual, contrary }));
  assert.ok(dull.starting < usual.starting * 0.5);
  // moods are drawn for each school and day, mostly usual
  const n = { usual: 0, contrary: 0, dull: 0, hot: 0 };
  for (let d = 1; d <= 400; d++) n[moodOf(5, d, `S${d % 7}`).id] += 1;
  assert.ok(n.usual > 240 && n.contrary > 20 && n.dull > 15 && n.hot > 5, JSON.stringify(n));
  assert.equal(MOODS.reduce((a, m) => a + m.p, 0).toFixed(6), '1.000000');
  // scripted early days: every school follows the rule
  assert.ok(dayPlan(77, 3).schools.every((s) => !s.mood));
});

test('アジ press to the bottom in a hard-running stream and rise as a loose cloud at slack water', () => {
  const cond = { ...makeDayConditions(3, 20), tideAmp: 0.3, highWater: 0 };
  const s = normalizeSchool({ id: 'X', species: 'aji', a: { x: 1500, y: 1500 }, counts: { s: 100, m: 100, l: 100 }, noiseSeed: 5 });
  const w = { cond, schools: [s] };
  const tSlack = 12 * 3600 - ((12 * 3600) % (TIDE_PERIOD / 2)); // a turn of the tide around midday
  const tRun = tSlack + TIDE_PERIOD / 4;
  const slack = schoolPose(s, tSlack, w);
  const run = schoolPose(s, tRun, w);
  assert.ok(slack.off > run.off + 1, `${slack.off} ${run.off}`);
  assert.ok(slack.zs > run.zs);
});

test('a peer for every method (R20), and what they say comes from that day\'s sea', () => {
  const methods = new Set(Object.values(PEERS).map((p) => p.method));
  for (const m of ['handline', 'troll', 'longline', 'negyo', 'oyogase', 'ika']) assert.ok(methods.has(m), m);
  let kuroki = 0;
  let oda = 0;
  let yoshimura = 0;
  let remark = 0;
  for (let d = 4; d <= 64; d++) {
    for (const r of briefingReports(77, d)) {
      if (r.speaker === 'kuroki' && r.kind !== 'rule') kuroki += 1;
      if (r.speaker === 'oda' && r.kind !== 'rule') oda += 1;
      if (r.speaker === 'yoshimura') yoshimura += 1;
      if (/潮が動き出したら|食いが渋かった|緩んできたら|なぜか食いがよかった/.test(r.text)) remark += 1;
      if (r.kind !== 'rule') assert.ok(r.obsDay < d || r.obsT <= BRIEFING_T, r.id);
    }
  }
  assert.ok(kuroki >= 55 && oda >= 55 && yoshimura >= 55, JSON.stringify({ kuroki, oda, yoshimura }));
  assert.ok(remark >= 5, `bite remarks ${remark}`);
});

function hunchRun(level, act) {
  const p = createProfile({ worldSeed: 9, now: NOW });
  p.day = 12;
  p.methods.handline.xp = PROGRESSION.xpTable[level - 1];
  const dep = markDeparture(p, NOW);
  const aji = { id: 'A', species: 'aji', a: { x: 1500, y: 1500 }, counts: { s: 100, m: 300, l: 100 }, sigmaH: 30, sigmaZ: 3, fixedOffBottom: 3, activityOverride: act, orbitR: 0 };
  const v = createVoyage(dep, { scenario: { conditions: CALM, schools: [aji] }, start: { x: 1500, y: 1500, heading: 0 }, radio: [] });
  v.world.time = 9 * 3600;
  advanceVoyage(v, 20);
  assert.ok(startOperation(v).ok);
  advanceVoyage(v, 25 * 60);
  return v.messages.filter((m) => /（勘）/.test(m.text)).map((m) => m.text);
}

test('漁師の勘 (Lv5+): a strong echo that hardly bites is called out; a beginner gets no such hint', () => {
  const pro = hunchRun(6, 0.01);
  assert.ok(pro.some((t) => /反応はあるのに当たりが遠い/.test(t)), pro.join('/'));
  assert.equal(hunchRun(1, 0.01).length, 0);
  // biting well: no "dull" call
  assert.ok(!hunchRun(6, 1).some((t) => /当たりが遠い/.test(t)));
});
