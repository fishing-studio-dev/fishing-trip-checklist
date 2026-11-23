// A12 save / restore, corruption handling, interrupted voyages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProfile, markDeparture, resolveInterruptedVoyage } from '../src/core/profile.js';
import { settleVoyage, purchaseEquipment } from '../src/core/economy.js';
import { summarizeVoyage } from '../src/core/voyage.js';
import { loadSave, writeSave, memoryStorage, KEYS, exportSave, checkImport, SAVE_SCHEMA } from '../src/core/save.js';
import { voyageWith, fishFor } from './helpers.js';

const NOW = '2026-11-23T00:00:00.000Z';

function progressedProfile() {
  const { p, v } = voyageWith({ level: 1 });
  fishFor(v, 900);
  const s = settleVoyage(p, summarizeVoyage(v));
  const rich = { ...s.profile, funds: s.profile.funds + 20000 };
  return purchaseEquipment(rich, 'reel_electric', 'starboard_reel').profile;
}

test('A12: funds, XP, boat, equipment, storage and logs survive a save/load round trip', () => {
  const st = memoryStorage();
  const p = progressedProfile();
  const w = writeSave(st, p, 0, NOW);
  assert.ok(w.ok);
  const r = loadSave(st);
  assert.equal(r.status, 'ok');
  assert.deepEqual(r.profile, p);
  assert.equal(r.revision, 1);
  assert.ok(r.profile.logs.length > 0);
  assert.equal(r.profile.boat.slots.starboard_reel.itemId, 'reel_electric');
});

test('the previous save is kept as a backup', () => {
  const st = memoryStorage();
  const a = createProfile({ worldSeed: 1, now: NOW });
  const b = { ...a, funds: 1234 };
  writeSave(st, a, 0, NOW);
  writeSave(st, b, 1, NOW);
  assert.equal(JSON.parse(st.getItem(KEYS.backup)).data.funds, a.funds);
  assert.equal(JSON.parse(st.getItem(KEYS.main)).data.funds, 1234);
});

test('a corrupted main save is quarantined (not deleted) and the backup is used', () => {
  const st = memoryStorage();
  const a = createProfile({ worldSeed: 1, now: NOW });
  writeSave(st, a, 0, NOW);
  writeSave(st, { ...a, funds: 999 }, 1, NOW);
  st.setItem(KEYS.main, st.getItem(KEYS.main).replace('"funds":999', '"funds":999999'));
  const r = loadSave(st, 42);
  assert.equal(r.status, 'recovered');
  assert.equal(r.profile.funds, a.funds);
  assert.equal(r.quarantineKey, KEYS.quarantinePrefix + 42);
  assert.ok(st.getItem(r.quarantineKey).includes('999999'));
  assert.ok(st.getItem(KEYS.main).includes('999999'), 'main is left as it was until the next successful save');
});

test('unreadable data with no backup is reported, quarantined, and nothing is overwritten', () => {
  const st = memoryStorage({ [KEYS.main]: '{not json' });
  const r = loadSave(st, 7);
  assert.equal(r.status, 'unreadable');
  assert.equal(st.getItem(KEYS.main), '{not json');
  assert.equal(st.getItem(KEYS.quarantinePrefix + 7), '{not json');
});

test('a save from a newer version is not loaded and not overwritten', () => {
  const st = memoryStorage();
  writeSave(st, createProfile({ worldSeed: 1, now: NOW }), 0, NOW);
  const env = JSON.parse(st.getItem(KEYS.main));
  env.schemaVersion = SAVE_SCHEMA + 1;
  const raw = JSON.stringify(env);
  st.setItem(KEYS.main, raw);
  const r = loadSave(st);
  assert.equal(r.status, 'newer');
  assert.equal(st.getItem(KEYS.main), raw);
});

test('an invalid profile is never written', () => {
  const st = memoryStorage();
  const p = createProfile({ worldSeed: 1, now: NOW });
  p.funds = -5;
  const w = writeSave(st, p, 0, NOW);
  assert.equal(w.ok, false);
  assert.equal(st.getItem(KEYS.main), null);
});

test('a storage failure is reported and the existing save stays intact', () => {
  const st = memoryStorage();
  const a = createProfile({ worldSeed: 1, now: NOW });
  writeSave(st, a, 0, NOW);
  const before = st.getItem(KEYS.main);
  const failing = { ...st, getItem: st.getItem, setItem: () => { throw new Error('QuotaExceededError'); } };
  const w = writeSave(failing, { ...a, funds: 1 }, 1, NOW);
  assert.equal(w.ok, false);
  assert.match(w.error, /Quota/);
  assert.equal(st.getItem(KEYS.main), before);
});

test('a voyage left open in the save (page closed at sea) gives no reward and is recorded', () => {
  const st = memoryStorage();
  const p0 = createProfile({ worldSeed: 1, now: NOW });
  const p1 = markDeparture(p0, NOW);
  writeSave(st, p1, 0, NOW);
  const r = loadSave(st);
  const fixed = resolveInterruptedVoyage(r.profile);
  assert.equal(fixed.interrupted.id, 'V1');
  assert.equal(fixed.profile.activeVoyage, null);
  assert.equal(fixed.profile.funds, p0.funds);
  assert.equal(fixed.profile.methods.handline.xp, 0);
  assert.equal(fixed.profile.day, 1, 'the day stays used up (no scouting by reloading)');
  assert.deepEqual(fixed.profile.interruptedVoyages.map((v) => v.id), ['V1']);
  // and that voyage can no longer be settled
  const s = settleVoyage(fixed.profile, { id: 'V1', day: 1, hold: { counts: { s: 0, m: 0, l: 0 }, kg: 0, count: 0 }, logs: [], distanceM: 0, opSeconds: 0 });
  assert.equal(s.ok, false);
});

test('export / import: valid files round-trip, broken files are rejected', () => {
  const p = progressedProfile();
  const text = exportSave(p, 3);
  const ok = checkImport(text);
  assert.ok(ok.ok);
  assert.deepEqual(ok.profile, p);
  assert.equal(checkImport('hello').ok, false);
  assert.equal(checkImport(JSON.stringify({ format: 'something-else' })).ok, false);
  const tampered = JSON.parse(text);
  tampered.data.funds += 1;
  assert.equal(checkImport(JSON.stringify(tampered)).ok, false);
});

test('save keys never collide with the checklist app in the same origin', () => {
  for (const k of Object.values(KEYS)) assert.ok(k.startsWith('ryoshi-game:'));
  assert.ok(!Object.values(KEYS).includes('fishing-checklist-v1'));
});
