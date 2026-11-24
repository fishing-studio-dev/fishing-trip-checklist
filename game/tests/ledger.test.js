// Item 13: the ledger (収支) — one line per voyage, with what each method earned.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProfile, markDeparture, validateProfile, migrateProfile7to8 } from '../src/core/profile.js';
import { createVoyage, advanceVoyage, startOperation, stopOperation, isOperating, setMethod, summarizeVoyage, returnToPort } from '../src/core/voyage.js';
import { settleVoyage, methodEarnings } from '../src/core/economy.js';
import { loadSave, memoryStorage, KEYS, writeSave } from '../src/core/save.js';
import { CALM, denseSchool } from './helpers.js';

const NOW = '2026-11-24T00:00:00.000Z';

function fishAndLand(p, { methods = ['handline'], schools = [denseSchool()] } = {}) {
  const dep = markDeparture(p, NOW);
  const v = createVoyage(dep, { scenario: { conditions: CALM, schools }, start: { x: 1500, y: 1500, heading: 0 }, radio: [] });
  v.world.time = 7 * 3600;
  for (const m of methods) {
    setMethod(v, m);
    advanceVoyage(v, 3);
    if (startOperation(v).ok) {
      advanceVoyage(v, 600);
      stopOperation(v, 'player');
      while (isOperating(v)) advanceVoyage(v, 1);
    }
  }
  returnToPort(v);
  for (let i = 0; i < 6000 && v.phase !== 'docked'; i++) advanceVoyage(v, 1);
  const s = settleVoyage(dep, summarizeVoyage(v));
  assert.ok(s.ok, s.reason);
  return s;
}

test('each landing adds one ledger line: sales, costs, net and what each method earned (adding up to the sales)', () => {
  const p0 = createProfile({ worldSeed: 4, now: NOW });
  const s1 = fishAndLand(p0);
  const line = s1.profile.ledger.at(-1);
  assert.equal(s1.profile.ledger.length, 1);
  assert.equal(line.sales, s1.receipt.sales);
  assert.equal(line.costs.total, s1.receipt.costs.total);
  assert.equal(line.net, s1.receipt.net);
  const sum = Object.values(line.byMethod).reduce((a, m) => a + m.sales, 0);
  assert.equal(sum, line.sales);
  assert.ok(line.byMethod.handline.count > 0 && line.byMethod.handline.minutes > 0);
  const s2 = fishAndLand(s1.profile);
  assert.equal(s2.profile.ledger.length, 2);
  assert.deepEqual(validateProfile(s2.profile), []);
});

test('live bait is charged to 泳がせ, so the methods still add up to the sales', () => {
  const e = methodEarnings({
    logs: [
      { methodId: 'handline', species: 'aji', catches: { s: 10, m: 0, l: 0 }, count: 10, kg: 1.2, durationS: 600 },
      { methodId: 'oyogase', species: 'buri', bySpecies: { buri: { s: 1, m: 0, l: 0 } }, catches: { s: 1, m: 0, l: 0 }, count: 1, kg: 2.5, durationS: 1200 },
    ],
    baitUsed: { aji: { s: 4, m: 0, l: 0 } },
  });
  const ajiValue = Math.round(0.12 * 400) * 10; // 10 small アジ
  const bait = Math.round(4 * 0.12 * 400);
  assert.equal(e.handline.sales, ajiValue);
  assert.equal(e.oyogase.baitCost, bait);
  assert.equal(e.oyogase.sales, Math.round(2.5 * 600) - bait);
});

test('A12 (移行): a format-7 save opens with an empty ledger, nothing else changes', () => {
  const p7 = createProfile({ worldSeed: 1, now: NOW });
  p7.schema = 7;
  delete p7.ledger;
  p7.funds = 12345;
  const p8 = migrateProfile7to8(p7);
  assert.deepEqual(p8.ledger, []);
  assert.equal(p8.funds, 12345);
  assert.deepEqual(validateProfile(p8), []);
  // through the save loader as well
  const store = memoryStorage();
  writeSave(store, p8, 0);
  const r = loadSave(store);
  assert.equal(r.status, 'ok');
  void KEYS;
});
