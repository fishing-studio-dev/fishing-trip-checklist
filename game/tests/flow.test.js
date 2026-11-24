// A01 (core level): depart -> search -> operate -> return -> settle -> upgrade
// -> depart again, over several voyages in generated seas, with a save/load
// between every voyage. The test "skipper" peeks at school positions only to
// choose where to go (standing in for the player's search).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProfile, markDeparture, validateProfile } from '../src/core/profile.js';
import { settleVoyage, purchaseEquipment } from '../src/core/economy.js';
import { createVoyage, advanceVoyage, isOperating, redrift, returnToPort, summarizeVoyage } from '../src/core/voyage.js';
import { schoolCenter, schoolTotal } from '../src/core/world.js';
import { writeSave, loadSave, memoryStorage } from '../src/core/save.js';
import { levelFromXp } from '../src/core/progress.js';
import { EQUIPMENT } from '../src/core/data.js';
import { currentAt } from '../src/core/sea.js';

const NOW = '2026-11-23T00:00:00.000Z';

function runUntil(v, cond, maxS) {
  let t = 0;
  while (!cond() && t < maxS) {
    advanceVoyage(v, 5);
    t += 5;
  }
  return cond();
}

function playVoyage(profile) {
  const p = markDeparture(profile, NOW);
  const v = createVoyage(p);
  advanceVoyage(v, 5);
  // choose the biggest school; set up 70 m up-current of it so the drift
  // carries the boat across it (what the port screen advises the player)
  // (the skiff keeps to its coastal zone, so only schools it can reach count)
  const best = v.world.schools
    .filter((s) => s.species === 'aji' && schoolCenter(s, v.world.time).y < 2900)
    .sort((a, b) => schoolTotal(b) - schoolTotal(a))[0];
  const eta = v.world.time + 400;
  const c = schoolCenter(best, eta);
  const cur = currentAt(v.world.cond, eta);
  const sp = Math.hypot(cur.x, cur.y) || 1;
  const target = { x: c.x - (cur.x / sp) * 70, y: c.y - (cur.y / sp) * 70 };
  v.autopilot = { kind: 'redrift', route: [target], leg: 0 };
  assert.ok(runUntil(v, () => isOperating(v), 3600), 'reached the spot and started');
  for (let pass = 0; pass < 4; pass++) {
    advanceVoyage(v, 480);
    if (pass === 3) break;
    redrift(v);
    assert.ok(runUntil(v, () => !isOperating(v), 600));
    assert.ok(runUntil(v, () => isOperating(v), 1800), 're-drift restarted the operation');
  }
  returnToPort(v);
  assert.ok(runUntil(v, () => v.phase === 'docked', 4 * 3600), 'docked');
  return { p, v };
}

test('A01: several full voyages with growth, purchase and save/load between them', () => {
  const st = memoryStorage();
  // these voyages fish only half an hour each, so the save starts with the reel's price at hand (段4の値段)
  let profile = { ...createProfile({ worldSeed: 2026, now: NOW }), funds: EQUIPMENT.reel_electric.price + 5000 };
  let rev = writeSave(st, profile, 0, NOW).revision;
  const history = [];
  for (let i = 0; i < 5; i++) {
    const { p, v } = playVoyage(profile);
    const res = settleVoyage(p, summarizeVoyage(v));
    assert.ok(res.ok, res.reason);
    profile = res.profile;
    if (profile.boat.slots.starboard_reel.itemId !== 'reel_electric' && profile.funds >= EQUIPMENT.reel_electric.price) {
      const b = purchaseEquipment(profile, 'reel_electric', 'starboard_reel');
      assert.ok(b.ok);
      profile = b.profile;
    }
    rev = writeSave(st, profile, rev, NOW).revision;
    const loaded = loadSave(st);
    assert.equal(loaded.status, 'ok');
    assert.deepEqual(loaded.profile, profile);
    assert.deepEqual(validateProfile(profile), []);
    history.push({ day: profile.day, fish: v.hold.count, funds: profile.funds, level: levelFromXp(profile.methods.handline.xp), reel: profile.boat.slots.starboard_reel.itemId, ops: v.logs.length });
  }
  console.log(history);
  assert.equal(profile.day, 5);
  assert.ok(history.reduce((a, h) => a + h.fish, 0) > 50, 'caught fish over the voyages');
  assert.ok(history[4].level > history[0].level - 0 && history[4].level >= 3, 'method level grew');
  assert.equal(profile.boat.slots.starboard_reel.itemId, 'reel_electric', 'bought and installed the upgrade');
  assert.equal(profile.logs.length, history.reduce((a, h) => a + h.ops, 0));
  assert.ok(profile.funds >= 0);
});
