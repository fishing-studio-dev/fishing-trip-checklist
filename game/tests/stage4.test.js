// Second round, stage 4: difficulty (R05), the daily market (R19), orders,
// records and the yearly review (R02), and save format 10.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProfile, markDeparture, validateProfile, migrateProfile9to10, PROFILE_SCHEMA } from '../src/core/profile.js';
import { createVoyage, advanceVoyage, startOperation, stopOperation, isOperating, returnToPort, summarizeVoyage, setMethod } from '../src/core/voyage.js';
import { settleVoyage, priceLines, purchasePreview, planBoatPurchase } from '../src/core/economy.js';
import { pricePerKg, marketFactor, depthMultiplier, marketBoard, itemPrice, costsOf, difficultyOf } from '../src/core/market.js';
import { ordersOffered, acceptOrder, dropOrder, activeOrders } from '../src/core/orders.js';
import { yearSummary, reviewDue, markReviewed } from '../src/core/review.js';
import { createWorld, takeFish, normalizeSchool } from '../src/core/world.js';
import { DIFFICULTY, SPECIES, EQUIPMENT, ORDERS, MARKET } from '../src/core/data.js';
import { CALM } from './helpers.js';
import { weatherOf } from '../src/core/sea.js';

const NOW = '2026-11-24T00:00:00.000Z';

test('difficulty is chosen at the start and only changes the money', () => {
  const e = createProfile({ worldSeed: 4, now: NOW, difficulty: 'easy' });
  const n = createProfile({ worldSeed: 4, now: NOW });
  const h = createProfile({ worldSeed: 4, now: NOW, difficulty: 'hard' });
  assert.equal(n.difficulty, 'normal');
  assert.ok(e.funds > n.funds && n.funds > h.funds);
  assert.ok(pricePerKg(e, 10, 'aji', 'm') > pricePerKg(n, 10, 'aji', 'm') && pricePerKg(n, 10, 'aji', 'm') > pricePerKg(h, 10, 'aji', 'm'));
  assert.ok(itemPrice(e, EQUIPMENT.sonar_cs1) < itemPrice(h, EQUIPMENT.sonar_cs1));
  assert.ok(costsOf(e, 40).base < costsOf(h, 40).base);
  assert.equal(purchasePreview(h, 'reel_electric', 'starboard_reel').price, itemPrice(h, EQUIPMENT.reel_electric));
  // the sea is the same: the same world for every level
  assert.equal(JSON.stringify(createWorld(4, 10, 6 * 3600).schools), JSON.stringify(createWorld(4, 10, 6 * 3600).schools));
  assert.equal(difficultyOf({}).id, 'normal');
  for (const d of Object.values(DIFFICULTY)) assert.deepEqual(validateProfile(createProfile({ worldSeed: 1, now: NOW, difficulty: d.id })), []);
});

test('the market: in-season fish are cheaper, prices drift smoothly day to day, dearer after a rough day', () => {
  const p = createProfile({ worldSeed: 77, now: NOW });
  // イサキ: in season in June (day 13), out of season in January (day 48)
  const inSeason = SPECIES.isaki.sizes.m.pricePerKg * marketFactor(77, 13, 'isaki');
  const offSeason = SPECIES.isaki.sizes.m.pricePerKg * marketFactor(77, 48, 'isaki');
  assert.ok(inSeason < offSeason, `${inSeason} ${offSeason}`);
  // day to day the wobble is smooth (no big jumps), except the rise after a rough day
  let sawRough = false;
  for (let d = 2; d < 60; d++) {
    const roughBefore = weatherOf(77, d - 1).rough || weatherOf(77, d).rough;
    const a = marketFactor(77, d, 'madai');
    const b = marketFactor(77, d + 1, 'madai');
    if (!roughBefore && Math.abs(b / a - 1) > 0.2) assert.fail(`jump on day ${d}: ${a} → ${b}`);
    if (weatherOf(77, d).rough && !weatherOf(77, d - 1).rough) {
      sawRough = true;
      const plain = marketFactor(77, d + 1, 'madai') / MARKET.afterRough;
      assert.ok(marketFactor(77, d + 1, 'madai') > plain);
    }
  }
  assert.ok(sawRough);
  // the board lists every fish with its price and how it compares with the usual
  const board = marketBoard(p, 10);
  assert.equal(board.length, Object.values(SPECIES).filter((s) => !s.bait).length);
  assert.ok(board.every((r) => r.price > 0 && Number.isFinite(r.vsUsual)));
});

test('a big landing of one fish lowers its price per kg (the market depth)', () => {
  assert.equal(depthMultiplier('aji', 20), 1);
  const d = MARKET.depthKg.aji;
  assert.ok(depthMultiplier('aji', d * 2) < 1 && depthMultiplier('aji', d * 4) < depthMultiplier('aji', d * 2));
  const p = createProfile({ worldSeed: 77, now: NOW });
  const small = priceLines({ aji: { s: 0, m: 40, l: 0 } }, p, 10);
  const big = priceLines({ aji: { s: 0, m: 800, l: 0 } }, p, 10);
  assert.ok(!small[0].depth);
  assert.ok(big[0].depth < 1);
  assert.ok(big[0].amount / big[0].kg < small[0].amount / small[0].kg);
});

test('orders: offered from the season, taken up to the limit, dropped freely; the same for everyone', () => {
  const offers = ordersOffered(9, 12);
  assert.deepEqual(offers, ordersOffered(9, 12));
  assert.ok(offers.length >= ORDERS.perDay[0] && offers.length <= ORDERS.perDay[1]);
  for (const o of offers) {
    assert.ok(o.kg > 0 && o.bonus >= ORDERS.bonus[0] && o.bonus <= ORDERS.bonus[1] && o.lastDay >= 12);
    assert.ok(!SPECIES[o.species].bait);
  }
  let p = createProfile({ worldSeed: 9, now: NOW });
  p.day = 11;
  let taken = 0;
  for (let d = 12; taken < ORDERS.maxActive + 1 && d < 40; d++) {
    for (const o of ordersOffered(9, d)) {
      const r = acceptOrder(p, { ...o, lastDay: 99 }, 12);
      if (taken < ORDERS.maxActive) {
        assert.ok(r.ok, r.reason);
        p = r.profile;
      } else assert.ok(!r.ok);
      taken += 1;
      if (taken > ORDERS.maxActive) break;
    }
  }
  assert.equal(activeOrders(p, 12).length, ORDERS.maxActive);
  const dropped = dropOrder(p, p.orders[0].id);
  assert.ok(dropped.ok && dropped.profile.orders.length === ORDERS.maxActive - 1);
});

/** A short handline trip over an アジ school; returns {dep, v}. */
function ajiTrip(p) {
  const dep = markDeparture(p, NOW);
  const aji = { id: 'A', species: 'aji', a: { x: 1500, y: 1500 }, counts: { s: 100, m: 300, l: 100 }, sigmaH: 30, sigmaZ: 3, fixedOffBottom: 3, activityOverride: 1, orbitR: 0 };
  const v = createVoyage(dep, { scenario: { conditions: CALM, schools: [aji] }, start: { x: 1500, y: 1500, heading: 0 }, radio: [], method: 'handline' });
  v.world.time = 7 * 3600;
  advanceVoyage(v, 20);
  assert.ok(startOperation(v).ok);
  advanceVoyage(v, 20 * 60);
  stopOperation(v, 'player');
  while (isOperating(v)) advanceVoyage(v, 1);
  returnToPort(v);
  for (let i = 0; i < 6000 && v.phase !== 'docked'; i++) advanceVoyage(v, 1);
  return { dep, v };
}

test('an accepted order is filled from the landing at a bonus; records note the first catch and the biggest', () => {
  let p = createProfile({ worldSeed: 9, now: NOW });
  p.day = 11;
  const order = { id: 'T1', species: 'aji', kg: 2, bonus: 0.5, lastDay: 14, from: '料理屋「磯政」', offeredDay: 12 };
  p = acceptOrder(p, order, 12).profile;
  const { dep, v } = ajiTrip(p);
  const s = settleVoyage(dep, summarizeVoyage(v));
  assert.ok(s.ok, s.reason);
  const o = s.receipt.orders[0];
  assert.ok(o && o.done && o.kg === 2 && o.bonusAmount > 0, JSON.stringify(s.receipt.orders));
  assert.equal(s.profile.orders.length, 0, 'a filled order is done');
  assert.equal(s.profile.stats.ordersDone, 1);
  const lineSum = s.receipt.lines.reduce((a, l) => a + l.amount, 0);
  assert.equal(s.receipt.sales, lineSum + o.bonusAmount);
  // records
  const r = s.profile.records.aji;
  assert.ok(r && r.firstDay === 12 && r.count === v.hold.count && r.max && r.max.w > 0);
  assert.ok(s.receipt.newRecords.some((x) => x.species === 'aji' && x.kind === 'first'));
  assert.ok(s.profile.ledger.at(-1).bySpecies.aji.n === v.hold.count);
});

test('each fish has its own weight around its size (a few big ones), without touching the random draws', () => {
  const w = createWorld(3, 10, 8 * 3600, { conditions: CALM, schools: [normalizeSchool({ id: 'B', species: 'buri', a: { x: 1500, y: 1500 }, counts: { s: 0, m: 0, l: 400 } })] });
  const fish = [];
  for (let i = 0; i < 400; i++) fish.push(takeFish(w, 0));
  const base = SPECIES.buri.sizes.l.kg;
  assert.ok(fish.every((f) => f.w >= base * 0.8 && f.w <= base * 1.9));
  assert.ok(fish.some((f) => f.w > base * 1.3), 'now and then a big one');
  assert.ok(fish.every((f) => f.kg === base), 'the hold and the market use the size weight');
  // the same as a world whose fish carry no weight would draw (sizes come from the same draws)
  const w2 = createWorld(3, 10, 8 * 3600, { conditions: CALM, schools: [normalizeSchool({ id: 'B', species: 'buri', a: { x: 1500, y: 1500 }, counts: { s: 100, m: 100, l: 200 } })] });
  const sizes = Array.from({ length: 50 }, () => takeFish(w2, 0).size).join('');
  const w3 = createWorld(3, 10, 8 * 3600, { conditions: CALM, schools: [normalizeSchool({ id: 'B', species: 'buri', a: { x: 1500, y: 1500 }, counts: { s: 100, m: 100, l: 200 } })] });
  assert.equal(Array.from({ length: 50 }, () => takeFish(w3, 0).size).join(''), sizes);
});

test('the yearly review: totals and seasons from the ledger, shown once on the first morning of a new year', () => {
  const p = createProfile({ worldSeed: 9, now: NOW });
  p.ledger = [
    { day: 3, sales: 20000, costs: { total: 3000 }, net: 17000, bySpecies: { aji: { n: 50, kg: 12, sales: 9000 } }, best: { aji: 0.5 } },
    { day: 20, sales: 30000, costs: { total: 4000 }, net: 26000, bySpecies: { shiira: { n: 3, kg: 12, sales: 5000 } }, best: { shiira: 13 } },
    { day: 70, sales: 5000, costs: { total: 4000 }, net: 1000, bySpecies: {} },
  ];
  const y1 = yearSummary(p, 1);
  assert.equal(y1.voyages, 2);
  assert.equal(y1.net, 43000);
  assert.equal(y1.seasons[0].net, 17000);
  assert.equal(y1.seasons[1].top.species, 'shiira');
  assert.equal(y1.biggest.species, 'shiira'); // 13 kg against a 9 kg large size
  assert.equal(y1.bestDay.day, 20);
  p.day = 60; // preparing day 61: the first morning of year 2
  assert.equal(reviewDue(p, 61), 1);
  const seen = markReviewed(p, 1);
  assert.equal(reviewDue(seen, 61), 0);
  assert.equal(reviewDue(p, 30), 0);
});

test('format 10: an older save becomes 「ふつう」 with records from its logs and the year reviews caught up', () => {
  const p9 = createProfile({ worldSeed: 2, now: NOW });
  p9.schema = 9;
  delete p9.difficulty;
  delete p9.orders;
  delete p9.records;
  delete p9.years;
  p9.day = 75;
  p9.logs = [{ id: 'V3-op1', day: 3, area: '北の瀬', methodId: 'handline', species: 'aji', catches: { s: 2, m: 5, l: 1 }, count: 8, kg: 2 }];
  const p = migrateProfile9to10(p9);
  assert.equal(p.schema, PROFILE_SCHEMA);
  assert.equal(p.difficulty, 'normal');
  assert.deepEqual(p.orders, []);
  assert.equal(p.records.aji.count, 8);
  assert.equal(p.records.aji.max, null);
  assert.equal(p.years.reviewed, 1, 'the year already past is not reviewed again');
  assert.deepEqual(validateProfile(p), []);
});

test('boat prices and the trade-in follow the difficulty', () => {
  const e = createProfile({ worldSeed: 1, now: NOW, difficulty: 'easy' });
  const h = createProfile({ worldSeed: 1, now: NOW, difficulty: 'hard' });
  e.funds = h.funds = 1e7;
  const pe = planBoatPurchase(e, 'used_cruiser_a');
  const ph = planBoatPurchase(h, 'used_cruiser_a');
  assert.ok(pe.ok && ph.ok);
  assert.ok(pe.price < ph.price && pe.tradeIn < ph.tradeIn);
  void setMethod;
});
