// M1 information: A05 reports come from the shared world, A08 freshness and
// observation vs acquisition time, A09 logs, A10 candidates use only what the
// player knows, plus the three information scenarios of handover §7.5.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { briefingReports, radioReports, reportLine } from '../src/core/reports.js';
import { acquireBriefing, buildCandidates, similarLogs, logTags } from '../src/core/knowledge.js';
import { createProfile, markDeparture } from '../src/core/profile.js';
import { createWorld, schoolPose, schoolTotal } from '../src/core/world.js';
import { makeDayConditions, forecastOf } from '../src/core/sea.js';
import { createVoyage, advanceVoyage, returnToPort, summarizeVoyage } from '../src/core/voyage.js';
import { settleVoyage } from '../src/core/economy.js';
import { BRIEFING_T, TIME } from '../src/core/data.js';

const NOW = '2026-11-23T00:00:00.000Z';

function schoolNear(seed, day, species, spot, t, radius) {
  const w = createWorld(seed, day, TIME.DEPART);
  return w.schools.some((s) => s.species === species && schoolTotal(s) > 0 && Math.hypot(schoolPose(s, t).x - spot.x, schoolPose(s, t).y - spot.y) <= radius);
}

test('A05: every peer observation matches the world at the time it was made', () => {
  for (const seed of [5, 2026]) {
    for (let d = 1; d <= 25; d++) {
      for (const r of [...briefingReports(seed, d), ...radioReports(seed, d)]) {
        if (r.kind === 'catch' || r.kind === 'echo' || r.kind === 'sighting') {
          assert.ok(schoolNear(seed, r.obsDay, r.species, r.spot, r.obsT, 120), `${r.id} ${r.text} — a ${r.species} school was there at ${r.obsDay}/${r.obsT}`);
        }
        if (r.kind === 'none' && r.speaker === 'gen' && r.species === 'aji') {
          assert.ok(!schoolNear(seed, r.obsDay, 'aji', r.spot, r.obsT, 200), `${r.id}: "no fish" really had no school`);
        }
      }
    }
  }
});

test('A08: observations are never newer than when they were heard; hearing does not re-date them', () => {
  let p = createProfile({ worldSeed: 11, now: NOW });
  for (let d = 1; d <= 12; d++) {
    const before = briefingReports(11, d);
    p = acquireBriefing(p, d);
    for (const r of before) {
      const got = p.knowledge.reports.find((x) => x.id === r.id);
      assert.ok(got, 'acquired');
      assert.equal(got.obsDay, r.obsDay);
      assert.equal(got.obsT, r.obsT);
      assert.equal(got.acqDay, d);
      assert.equal(got.acqT, BRIEFING_T);
      assert.ok(got.obsDay < d || got.obsT <= BRIEFING_T, 'observed before it was heard');
    }
    // hearing the same day twice changes nothing
    assert.equal(acquireBriefing(p, d), p);
  }
  for (const r of radioReports(11, 3)) assert.ok(r.deliverAt >= r.obsT);
});

test('A08: observations, estimates, predictions and rules of thumb stay separate', () => {
  for (let d = 1; d <= 20; d++) {
    for (const r of briefingReports(3, d)) {
      assert.ok(['catch', 'none', 'echo', 'sighting', 'rule'].includes(r.kind));
      if (r.kind === 'echo' || r.kind === 'sighting') assert.equal(r.opinionKind, '見立て', 'species from a sighting is an estimate');
      if (r.opinion) assert.ok(!r.text.includes(r.opinion), 'opinion is not mixed into the observation text');
      const line = reportLine({ ...r, acqDay: d, acqT: BRIEFING_T }, d);
      if (r.kind !== 'rule') assert.match(line.when, /\d\d:\d\d/);
    }
  }
});

function fakeLog({ id, day, area, methodId = 'handline', count, durationS = 3600, tideName, wind, reel = 'reel_hand', level = 1 }) {
  return {
    id, voyageId: `V${day}`, day, methodId, species: methodId === 'troll' ? 'sawara' : 'aji', startT: 6 * 3600, endT: 6 * 3600 + durationS, durationS,
    start: { x: 2100, y: 2250 }, end: { x: 2150, y: 2300 }, area, bottom: { min: 18, max: 22 }, tana: { min: 15, max: 18 },
    catches: { s: 0, m: count, l: 0 }, count, kg: count * 0.25, endReason: 'player',
    conditions: { t: 6 * 3600, tideName, current: { x: 0.1, y: 0.1, speed: 0.15 }, wind: { x: 1, y: 1, speed: wind }, waterTemp: 18.3 },
    sounder: { pings: 100, echoRatio: 0.5, maxEcho: 0.8, echoDepth: 16 }, gear: { boat: 'skiff_1', sounder: 'sounder_es1', reel, troll: null }, level,
  };
}

function candidatesFor(p, d) {
  return buildCandidates({ knowledge: p.knowledge, logs: p.logs, today: d, forecast: forecastOf(makeDayConditions(p.worldSeed, d)), profile: p });
}

test('scenario 1 (day 1): a fresh peer report points to a place the player has never fished', () => {
  const p = acquireBriefing(createProfile({ worldSeed: 77, now: NOW }), 1);
  const c = candidatesFor(p, 1);
  const kita = c.find((x) => x.key === 'handline:北の瀬');
  assert.ok(kita, '北の瀬・一本釣り is a candidate');
  assert.equal(c[0].key, 'handline:北の瀬', 'and the strongest one');
  assert.ok(kita.labels.includes('昨日の情報あり'));
  assert.ok(kita.labels.includes('未経験'), 'untried is shown as missing information…');
  assert.ok(!kita.labels.some((l) => /不適|低評価|不向き/.test(l)), '…never as unsuitable');
  assert.equal(kita.evidence[0].origin.speaker, 'gen');
  assert.ok(c.length >= 2 && c.length <= 3);
});

test('scenario 2 (day 2): a past success under similar conditions is recognised', () => {
  let p = createProfile({ worldSeed: 77, now: NOW });
  p = acquireBriefing(p, 1);
  p.logs.push(fakeLog({ id: 'V1-op1', day: 1, area: '北の瀬', count: 32, tideName: '中潮', wind: 2.4 }));
  p = acquireBriefing(p, 2);
  const kita = candidatesFor(p, 2).find((x) => x.key === 'handline:北の瀬');
  assert.ok(kita.labels.includes('自分の実績あり'));
  assert.ok(kita.labels.includes('似た条件の記録あり'));
  assert.match(kita.own.lines[0], /1回だけ/, 'one good result is a first result, not a trend');
  for (const l of kita.own.lines) assert.ok(!/%|確率/.test(l), 'no made-up probabilities');
});

test('scenario 3 (day 5): the record is there but today differs, and fresher info points elsewhere', () => {
  let p = createProfile({ worldSeed: 77, now: NOW });
  for (let d = 1; d <= 5; d++) p = acquireBriefing(p, d);
  p.logs.push(fakeLog({ id: 'V1-op1', day: 1, area: '北の瀬', count: 32, tideName: '中潮', wind: 2.4 }));
  p.logs.push(fakeLog({ id: 'V2-op1', day: 2, area: '北の瀬', count: 30, tideName: '中潮', wind: 3.2 }));
  const c = candidatesFor(p, 5);
  const kita = c.find((x) => x.key === 'handline:北の瀬');
  const troll = c.find((x) => x.methodId === 'troll' && x.area === '東の駆け上がり');
  assert.ok(troll, 'trolling on 東の駆け上がり is offered');
  assert.ok(troll.labels.includes('今朝の確認情報あり'));
  assert.ok(troll.labels.includes('装備が必要') && !troll.feasible.ok, 'needs gear the player does not have — shown, not hidden');
  assert.ok(kita, '北の瀬 is still shown (with what changed)');
  assert.ok(kita.labels.includes('自分の実績あり'));
  assert.ok(!kita.labels.includes('似た条件の記録あり'), 'today (大潮・強風) is not like the past successes');
  assert.ok(kita.notes.some((n) => /大潮/.test(n)) && kita.notes.some((n) => /風/.test(n)));
  // 源さん's newest result there says the bite dropped; his older reports no longer count
  const genLatest = kita.evidence.find((e) => !e.superseded && e.origin.speaker === 'gen' && e.origin.kind === 'catch');
  assert.ok(genLatest && genLatest.origin.obsDay === 4 && /食いが落ちて/.test(genLatest.origin.text));
  assert.ok(kita.evidence.filter((e) => e.origin.speaker === 'gen' && e.origin.kind === 'catch' && !e.superseded).length === 1);
});

test('A10: candidates depend only on what the player knows (same knowledge, different hidden sea → same result)', () => {
  let a = createProfile({ worldSeed: 1, now: NOW });
  for (let d = 1; d <= 4; d++) a = acquireBriefing(a, d);
  const b = { ...JSON.parse(JSON.stringify(a)), worldSeed: 999999 };
  const fc = forecastOf(makeDayConditions(1, 4));
  const ca = buildCandidates({ knowledge: a.knowledge, logs: a.logs, today: 4, forecast: fc, profile: a });
  const cb = buildCandidates({ knowledge: b.knowledge, logs: b.logs, today: 4, forecast: fc, profile: b });
  assert.equal(JSON.stringify(ca), JSON.stringify(cb));
  // with no information at all, candidates exist but say so
  const empty = buildCandidates({ knowledge: { reports: [], briefedDay: 0 }, logs: [], today: 1, forecast: fc, profile: createProfile({ worldSeed: 3, now: NOW }) });
  assert.ok(empty.length >= 2);
  for (const c of empty) assert.ok(c.labels.includes('情報が少ない') && c.labels.includes('未経験'));
});

test('relayed reports are not counted as independent evidence', () => {
  let p = createProfile({ worldSeed: 77, now: NOW });
  p = acquireBriefing(p, 5);
  const relays = p.knowledge.reports.filter((r) => r.relayedFrom);
  assert.ok(relays.length >= 1, 'day 5 has a relay in the early season');
  const relay = relays[0];
  const c = candidatesFor(p, 5).find((x) => x.methodId === relay.methodId && x.area === relay.area);
  const entry = c.evidence.find((e) => e.origin.originId === relay.originId);
  assert.equal(entry.heardFrom.length, 2, 'heard twice');
  assert.equal(c.evidence.filter((e) => e.origin.originId === relay.originId).length, 1, 'but one piece of evidence');
  const withoutRelay = { ...p, knowledge: { ...p.knowledge, reports: p.knowledge.reports.filter((r) => !r.relayedFrom) } };
  const c2 = candidatesFor(withoutRelay, 5).find((x) => x.key === c.key);
  assert.equal(c2.score, c.score, 'the relay does not raise the score');
});

test('A09: log tags are derived from what was recorded, for old M0 logs too', () => {
  const t = logTags(fakeLog({ id: 'x', day: 1, area: '西の根', count: 0, tideName: '若潮', wind: 7 }));
  assert.deepEqual(t, { timeBand: 'dawn', tideClass: '小潮系', windBand: '強' });
  const sim = similarLogs([fakeLog({ id: 'x', day: 1, area: '西の根', count: 0, tideName: '若潮', wind: 7 })], { methodId: 'handline', area: '西の根', forecast: { tideName: '小潮', windSpeed: 8 }, profile: createProfile({ worldSeed: 1, now: NOW }) });
  assert.equal(sim.similar.length, 1);
  assert.equal(sim.good, 0);
});

test('radio reports heard at sea are kept with the time they were heard (and only if the voyage is landed)', () => {
  let p = createProfile({ worldSeed: 21, now: NOW });
  p = markDeparture(p, NOW);
  const v = createVoyage(p);
  advanceVoyage(v, 5 * 3600); // wait by the harbour until late morning
  assert.ok(v.heard.length >= 1, 'radio calls arrived');
  for (const r of v.heard) {
    assert.equal(r.acqDay, 1);
    assert.ok(r.acqT >= r.obsT);
    assert.equal(r.via, 'radio');
  }
  returnToPort(v);
  for (let i = 0; i < 600 && v.phase !== 'docked'; i++) advanceVoyage(v, 5);
  const s = settleVoyage(p, summarizeVoyage(v));
  assert.ok(s.ok);
  for (const r of v.heard) assert.ok(s.profile.knowledge.reports.some((x) => x.id === r.id));
});

test('the early-season scenarios hold for any world seed', () => {
  for (let k = 1; k <= 20; k++) {
    let p = createProfile({ worldSeed: k * 7919, now: NOW });
    const C = {};
    for (let d = 1; d <= 5; d++) {
      p = acquireBriefing(p, d);
      C[d] = candidatesFor(p, d);
    }
    assert.equal(C[1][0].key, 'handline:北の瀬', `seed ${k}: day 1 points to 北の瀬`);
    const fresh = (d) => C[d].find((c) => c.methodId === 'troll' && (c.labels.includes('今朝の確認情報あり') || c.labels.includes('昨日の情報あり')));
    assert.ok(fresh(4), `seed ${k}: day 4 has trolling news`);
    assert.ok(fresh(5), `seed ${k}: day 5 has trolling news`);
  }
});
