// M4: a deckhand (second pair of hands) and the seasons of the sea.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProfile, markDeparture, validateProfile } from '../src/core/profile.js';
import { createVoyage, advanceVoyage, startOperation, haulLongline, isOperating, lineInWater, summarizeVoyage, returnToPort, stopOperation } from '../src/core/voyage.js';
import { settleVoyage } from '../src/core/economy.js';
import { handlineNeedsHands } from '../src/core/fishing.js';
import { trollNeedsHands } from '../src/core/troll.js';
import { makeDayConditions, forecastOf, forecastText, seasonOf } from '../src/core/sea.js';
import { dayPlan } from '../src/core/season.js';
import { briefingReports, radioReports } from '../src/core/reports.js';
import { buildCandidates, acquireBriefing } from '../src/core/knowledge.js';
import { CREW, PROGRESSION, PEERS, ECONOMY } from '../src/core/data.js';
import { CALM, denseSchool, sawaraSchool, totalFish, simHash } from './helpers.js';

const NOW = '2026-11-23T00:00:00.000Z';

function cruiser({ reels = ['reel_hand', 'reel_hand'], troll = null, longline = null, level = 1 } = {}) {
  const p = createProfile({ worldSeed: 1, now: NOW });
  for (const m of ['handline', 'troll', 'longline']) p.methods[m].xp = PROGRESSION.xpTable[level - 1];
  p.boat.model = 'cruiser_2';
  p.boat.slots = {
    helm_sounder: { uid: 'x1', itemId: 'sounder_es1' },
    starboard_reel: { uid: 'x2', itemId: reels[0] },
    port_reel: reels[1] ? { uid: 'x3', itemId: reels[1] } : null,
    stern_troll: troll ? { uid: 'x4', itemId: troll } : null,
    deck_longline: longline ? { uid: 'x5', itemId: longline } : null,
    starboard_hauler: null,
    hull_sonar: null,
    roof_lights: null,
  };
  assert.deepEqual(validateProfile(p), []);
  return p;
}

function voyage(p, crew, { schools, start = { x: 1500, y: 1500, heading: 0 }, method } = {}) {
  const v = createVoyage(markDeparture(p, NOW, null, { crew }), { scenario: { conditions: CALM, schools }, start, method });
  v.world.time = 8 * 3600;
  v.nextTrackT = v.world.time + 10;
  return v;
}

function fish(v, secs) {
  advanceVoyage(v, 3);
  assert.ok(startOperation(v).ok);
  advanceVoyage(v, secs);
  stopOperation(v);
  while (isOperating(v)) advanceVoyage(v, 1);
  return v.logs[v.logs.length - 1];
}

test('a deckhand is a second pair of hands: two hand-reel rigs land more, and never more than two hand jobs at once', () => {
  const alone = fish(voyage(cruiser(), 0, { schools: [denseSchool()] }), 600).count;
  const v = voyage(cruiser(), 1, { schools: [denseSchool()] });
  const before = totalFish(v.world);
  advanceVoyage(v, 3);
  startOperation(v);
  assert.equal(v.op.hands, 2);
  let both = 0;
  for (let i = 0; i < 6000; i++) {
    advanceVoyage(v, 0.1);
    const busy = v.op.lines.filter((l) => handlineNeedsHands(l) && !l.waiting && l.phase !== 'idle').length;
    assert.ok(busy <= 2);
    if (busy === 2) both += 1;
  }
  assert.ok(both > 0, 'both pairs of hands were working at the same time sometimes');
  stopOperation(v);
  while (isOperating(v)) advanceVoyage(v, 1);
  const withCrew = v.logs[0].count;
  assert.ok(withCrew > alone, `alone ${alone} → with a deckhand ${withCrew}`);
  assert.equal(totalFish(v.world) + v.hold.count, before);
  assert.equal(v.logs[0].crew, 1);
});

test('one rig gains nothing from a deckhand (the extra hands only help when jobs overlap)', () => {
  const a = fish(voyage(cruiser({ reels: ['reel_hand'] }), 0, { schools: [denseSchool()] }), 600).count;
  const b = fish(voyage(cruiser({ reels: ['reel_hand'] }), 1, { schools: [denseSchool()] }), 600).count;
  assert.equal(a, b);
});

test('TR-2 with a deckhand: hand jobs on the four lines overlap at most two at a time', () => {
  const big = [sawaraSchool({ counts: { s: 55, m: 37, l: 8 } })];
  const v = voyage(cruiser({ troll: 'troll_tr2' }), 1, { schools: big, start: { x: 1500, y: 1100, heading: 0 }, method: 'troll' });
  v.plannedRoute = [{ x: 1500, y: 1900 }];
  advanceVoyage(v, 2);
  startOperation(v);
  for (let i = 0; i < 9000; i++) {
    advanceVoyage(v, 0.1);
    assert.ok(v.op.lines.filter((l) => trollNeedsHands(l) && !l.waiting && l.phase !== 'idle').length <= 2);
  }
});

test('longline with a deckhand: he unhooks while the hauling goes on — the haul is shorter, the catch the same', () => {
  const madai = { id: 'MD', species: 'madai', a: { x: 1150, y: 1900 }, counts: { s: 36, m: 66, l: 18 }, sigmaH: 150, sigmaZ: 2, activityOverride: 1, orbitR: 0 };
  const run = (crew) => {
    const v = voyage(cruiser({ longline: 'longline_ll1' }), crew, { schools: [madai], start: { x: 1150, y: 1580, heading: 0 }, method: 'longline' });
    advanceVoyage(v, 2);
    startOperation(v);
    while (isOperating(v)) advanceVoyage(v, 1);
    advanceVoyage(v, 2700);
    haulLongline(v);
    const before = totalFish(v.world) + v.line.hooks.filter((h) => h.fish).length + v.hold.count;
    for (let i = 0; i < 40000 && (lineInWater(v) || isOperating(v) || v.autopilot); i++) advanceVoyage(v, 1);
    assert.equal(totalFish(v.world) + v.hold.count, before, 'conserved');
    const log = v.logs[v.logs.length - 1];
    return { n: log.count, haulMin: log.longline.haulMin };
  };
  const a = run(0);
  const b = run(1);
  assert.ok(a.n > 0);
  assert.equal(a.n, b.n, 'the deckhand does not change what was on the hooks');
  assert.ok(b.haulMin < a.haulMin, `haul ${a.haulMin} min → ${b.haulMin} min`);
});

test('the deckhand is paid once at landing, shown as a cost; going alone costs nothing extra; it is recorded in the logs', () => {
  for (const crew of [0, 1]) {
    const p = { ...cruiser({ reels: ['reel_hand'] }), funds: 50000 };
    const dep = markDeparture(p, NOW, null, { crew });
    assert.equal(dep.activeVoyage.crew, crew);
    const v = createVoyage(dep, { scenario: { conditions: CALM, schools: [denseSchool()] }, start: { x: 1500, y: 1500, heading: 0 } });
    v.world.time = 8 * 3600;
    fish(v, 300);
    const s = settleVoyage(dep, summarizeVoyage(v));
    assert.ok(s.ok, s.reason);
    assert.equal(s.receipt.costs.crew, crew ? CREW.wage : 0);
    assert.equal(s.receipt.costs.total, ECONOMY.tripBaseCost + s.receipt.costs.fuel + (crew ? CREW.wage : 0));
    assert.equal(s.profile.funds, 50000 + s.receipt.sales - s.receipt.costs.paid);
    assert.equal(settleVoyage(s.profile, summarizeVoyage(v)).ok, false, 'not twice');
    assert.equal(s.profile.logs[s.profile.logs.length - 1].crew, crew);
  }
});

test('A07 with a deckhand: one big advance equals many uneven frames', () => {
  const run = (chunks) => {
    const v = voyage(cruiser({ reels: ['reel_hand', 'reel_electric'] }), 1, { schools: [denseSchool()] });
    advanceVoyage(v, 3);
    startOperation(v);
    let carry = 0;
    let left = 900;
    let i = 0;
    while (left > 1e-9) {
      const d = Math.min(chunks[i++ % chunks.length], left);
      carry = advanceVoyage(v, d, carry);
      left -= d;
    }
    return simHash(v);
  };
  assert.equal(run([900]), run([0.37, 1.9, 0.05]));
});

test('seasons: a label and a trend every day from the water temperature; 乗っ込み only while warming through 14.6-18.2 ℃', () => {
  let seen = 0;
  for (let d = 1; d <= 60; d++) {
    const c = makeDayConditions(5, d);
    const s = seasonOf(5, d);
    assert.deepEqual(c.season, s);
    assert.ok(/水温の/.test(s.label));
    if (s.nokkomi) {
      seen += 1;
      assert.ok(s.trend >= 0.12 && c.waterTemp >= 14.55 && c.waterTemp <= 18.25);
    }
    assert.ok(forecastText(forecastOf(c)).some((l) => l.startsWith('季節：')));
  }
  assert.ok(seen >= 5 && seen <= 20, `${seen} days of 乗っ込み in a year`);
});

test('乗っ込み: マダイ gather on the flank of 北の瀬 (more, and bigger) only in that season', () => {
  for (const seed of [5, 77, 2026]) {
    for (let d = 1; d <= 40; d++) {
      const kita = dayPlan(seed, d).schools.find((s) => s.species === 'madai' && s.habitat === 'kita');
      const nk = makeDayConditions(seed, d).season.nokkomi;
      assert.equal(!!kita, nk, `seed ${seed} day ${d}`);
      if (kita) {
        const n = kita.counts.s + kita.counts.m + kita.counts.l;
        assert.ok(n >= 110 && kita.counts.l >= n * 0.25, `big gathering ${n}`);
      }
    }
  }
});

test('松じい knows the season: in 乗っ込み he fishes 北の瀬 and says so; his reports stay true to the world', () => {
  let saidIt = 0;
  for (const seed of [5, 77]) {
    for (let d = PEERS.matsu.fromDay; d <= 40; d++) {
      const nk = makeDayConditions(seed, d).season.nokkomi;
      const reps = briefingReports(seed, d).filter((r) => r.speaker === 'matsu' && !r.relayedFrom);
      if (nk && reps.some((r) => r.kind === 'rule' && /乗っ込み/.test(r.text))) saidIt += 1;
      const radio = radioReports(seed, d).find((r) => r.speaker === 'matsu');
      if (nk && radio && radio.kind === 'catch') assert.equal(radio.area, '北の瀬'); // (no radio on a storm day)
    }
  }
  assert.ok(saidIt > 0);
});

test('A10 still holds: the 乗っ込み note comes from the forecast, not from the fish', () => {
  let p = createProfile({ worldSeed: 5, now: NOW });
  let day = null;
  for (let d = 1; d <= 40 && day == null; d++) if (makeDayConditions(5, d).season.nokkomi && d >= 7) day = d;
  for (let d = 1; d <= day; d++) p = acquireBriefing(p, d);
  const args = { knowledge: p.knowledge, logs: [], today: day, forecast: forecastOf(makeDayConditions(5, day)), profile: p };
  const a = buildCandidates(args);
  const b = buildCandidates({ ...args, profile: { ...p, worldSeed: 999 } });
  assert.deepEqual(a.map((c) => [c.key, c.labels, c.notes]), b.map((c) => [c.key, c.labels, c.notes]));
  const ll = a.find((c) => c.methodId === 'longline');
  if (ll) assert.ok(ll.notes.some((n) => /乗っ込み/.test(n)));
});

test('a voyage with a deckhand that is interrupted costs nothing (the wage is paid only at landing)', () => {
  const p = { ...cruiser(), funds: 10000 };
  const dep = markDeparture(p, NOW, null, { crew: 1 });
  assert.equal(dep.funds, 10000);
  const v = createVoyage(dep, { scenario: { conditions: CALM, schools: [] } });
  returnToPort(v);
  assert.equal(v.crew, 1);
});
