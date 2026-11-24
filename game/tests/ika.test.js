// Item 9: イカ釣り in the evening with a 集魚灯 — the light draws squid in from
// the water around (taken from their school, never created), and an evening
// trip runs 16:00–23:00.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayTimes } from '../src/core/calendar.js';
import { createProfile, markDeparture, validateProfile } from '../src/core/profile.js';
import { createVoyage, advanceVoyage, startOperation, stopOperation, isOperating, setMethod, summarizeVoyage, returnToPort } from '../src/core/voyage.js';
import { settleVoyage } from '../src/core/economy.js';
import { squidSchools } from '../src/core/season.js';
import { createWorld, schoolPose, schoolTotal } from '../src/core/world.js';
import { TIME } from '../src/core/data.js';
import { CALM } from './helpers.js';

const NOW = '2026-11-23T00:00:00.000Z';
const squid = (extra = {}) => ({ id: 'SQ', species: 'kensaki', a: { x: 1400, y: 1800 }, counts: { s: 150, m: 250, l: 100 }, sigmaH: 150, sigmaZ: 4, orbitR: 0, ...extra });

function voyage({ lights = true, night = true, schools = [squid()], x = 1400, y = 1800 } = {}) {
  const p = createProfile({ worldSeed: 9, now: NOW });
  if (lights) p.boat.slots.roof_lights = { uid: 'L1', itemId: 'lights_ld1' };
  assert.deepEqual(validateProfile(p), []);
  const dep = markDeparture(p, NOW, null, { night });
  const v = createVoyage(dep, { scenario: { conditions: CALM, schools }, start: { x, y, heading: 0 } });
  return { dep, v };
}

const total = (v) => v.world.schools.reduce((a, s) => a + schoolTotal(s), 0);

test('squid lie near the bottom by day and rise at night', () => {
  const s = squidSchools(9, 1).concat(squidSchools(9, 2), squidSchools(9, 3))[0];
  assert.ok(s, 'squid on some day');
  const w = createWorld(9, 1, 12 * 3600, { conditions: CALM, schools: [s] });
  const day = schoolPose(w.schools[0], 12 * 3600);
  const night = schoolPose(w.schools[0], 21 * 3600);
  assert.ok(day.bottom - day.z < 6, `day ${day.z.toFixed(1)} of ${day.bottom.toFixed(1)}`);
  assert.ok(night.z < day.z - 10, `night ${night.z.toFixed(1)}`);
});

test('an evening trip leaves an hour before sunset and turns for home late at night (no morning radio)', () => {
  const { v } = voyage();
  const hours = dayTimes(v.day);
  assert.equal(v.world.time, hours.night.depart);
  assert.ok(v.world.time < hours.sunset && v.world.time >= hours.sunset - 3600 - 600);
  assert.equal(v.radio.length, 0);
  assert.equal(v.endT, hours.night.end);
  assert.ok(v.endT > hours.sunset + 3 * 3600 && v.endT <= 23.5 * 3600);
  const day = voyage({ night: false }).v;
  assert.equal(day.world.time, hours.depart);
  void TIME;
});

test('イカ釣り needs the lamp; with it, squid are drawn in once it is dark and caught; nothing is created', () => {
  const none = voyage({ lights: false }).v;
  assert.ok(!setMethod(none, 'ika').ok);
  const { v } = voyage();
  assert.ok(setMethod(v, 'ika').ok);
  const before = total(v);
  v.world.time = 18 * 3600;
  advanceVoyage(v, 3);
  assert.ok(startOperation(v).ok);
  advanceVoyage(v, 2 * 3600);
  const gathered = v.op.stats.gathered;
  stopOperation(v, 'player');
  while (isOperating(v)) advanceVoyage(v, 1);
  const log = v.logs.at(-1);
  assert.ok(gathered >= 20, `drawn in ${gathered}`);
  assert.ok(log.count >= 10, `caught ${log.count}`);
  assert.ok(log.bySpecies.kensaki);
  // conservation: in the sea (incl. under the light) + landed = what there was
  assert.equal(total(v) + v.hold.count, before);
});

test('in daylight the lamp draws nothing', () => {
  const { v } = voyage();
  setMethod(v, 'ika');
  v.world.time = 13 * 3600;
  advanceVoyage(v, 3);
  assert.ok(startOperation(v).ok);
  advanceVoyage(v, 1800);
  assert.equal(v.op.stats.gathered || 0, 0);
});

test('far from any squid the lamp draws nothing; the gathered squid follow the drifting boat', () => {
  const far = voyage({ x: 2600, y: 600 }).v;
  setMethod(far, 'ika');
  far.world.time = 19 * 3600;
  advanceVoyage(far, 3);
  startOperation(far);
  advanceVoyage(far, 1800);
  assert.equal(far.op.stats.gathered || 0, 0);
  const { v } = voyage();
  v.world.cond.tideAmp = 0.25;
  setMethod(v, 'ika');
  v.world.time = 19 * 3600;
  advanceVoyage(v, 3);
  startOperation(v);
  advanceVoyage(v, 1800);
  const light = v.world.schools.find((s) => s.light);
  assert.ok(light);
  assert.ok(Math.hypot(light.a.x - v.boat.x, light.a.y - v.boat.y) < 1);
});

test('settlement of an evening trip: squid sold by the 杯, experience to イカ釣り', () => {
  const { dep, v } = voyage();
  setMethod(v, 'ika');
  v.world.time = 18.5 * 3600;
  advanceVoyage(v, 3);
  startOperation(v);
  advanceVoyage(v, 3600);
  returnToPort(v);
  for (let i = 0; i < 8000 && v.phase !== 'docked'; i++) advanceVoyage(v, 1);
  const s = settleVoyage(dep, summarizeVoyage(v));
  assert.ok(s.ok, s.reason);
  assert.ok(s.receipt.lines.some((l) => l.species === 'kensaki'));
  assert.ok(s.profile.methods.ika.xp > 0);
  assert.deepEqual(validateProfile(s.profile), []);
});
