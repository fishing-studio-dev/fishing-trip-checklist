// Items 2-3: small structures, the side-view sounder and the own depth map.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProfile, markDeparture, validateProfile, PROFILE_SCHEMA } from '../src/core/profile.js';
import { createVoyage, advanceVoyage, setHelm, summarizeVoyage, returnToPort } from '../src/core/voyage.js';
import { settleVoyage } from '../src/core/economy.js';
import { snapshotVoyage, restoreVoyage } from '../src/core/voyageSnapshot.js';
import { cellsFromBathy, cellIndex, depthOfByte, mergeBathy } from '../src/core/bathy.js';
import { loadSave, memoryStorage, KEYS, SAVE_SCHEMA } from '../src/core/save.js';
import { STRUCTURES, depthAt, baseDepthAt, structureAt } from '../src/core/sea.js';
import { hashString } from '../src/core/rng.js';
import { CALM } from './helpers.js';

const NOW = '2026-11-23T00:00:00.000Z';
const g1 = STRUCTURES.find((s) => s.id === 'g1');

function cruiser(sounder = 'sounder_sv1') {
  const p = createProfile({ worldSeed: 5, now: NOW });
  p.boat.model = 'cruiser_2';
  p.boat.slots = { helm_sounder: { uid: 'x1', itemId: sounder }, starboard_reel: { uid: 'x2', itemId: 'reel_hand' }, port_reel: null, stern_troll: null, deck_longline: null, starboard_hauler: null, hull_sonar: null, roof_lights: null };
  assert.deepEqual(validateProfile(p), []);
  return p;
}

/** Run north past the 漁礁 g1 with it `side` metres to starboard (+) or port (-). */
function passBy(p, side) {
  const dep = markDeparture(p, NOW);
  const v = createVoyage(dep, { scenario: { conditions: CALM, schools: [] }, start: { x: g1.x - side, y: g1.y - 200, heading: 0 } });
  v.world.time = 7 * 3600;
  setHelm(v, { throttle: 3 }); // 微速
  advanceVoyage(v, 180);
  return { dep, v };
}

test('small structures are in the real seabed but not on the printed chart', () => {
  for (const st of STRUCTURES) {
    assert.ok(baseDepthAt(st.x, st.y) - depthAt(st.x, st.y) > st.h * 0.6, st.id);
    assert.equal(structureAt(st.x, st.y), st);
    assert.equal(depthAt(st.x + st.r * 3, st.y), baseDepthAt(st.x + st.r * 3, st.y));
  }
});

test('the side view shows a 漁礁 off to starboard that the boat never passes over', () => {
  const { v } = passBy(cruiser(), 30);
  assert.ok(v.obs.side.length > 100);
  const n = v.obs.side[0].vals.length;
  const mid = (n - 1) / 2;
  const at = (offset) => Math.round(mid + offset / 5);
  // over the whole pass: the strip to starboard lit up where the reef was; the same strip to port did not
  const abeam = v.obs.side;
  const peak = Math.max(...abeam.map((r) => r.vals[at(30)]));
  const portSame = Math.max(...abeam.map((r) => r.vals[at(-30)]));
  assert.ok(peak > portSame + 40, `starboard ${peak} vs port ${portSame}`);
  // the down-looking sounder did not see it (the boat stayed 30 m away)
  assert.ok(v.obs.cols.every((c) => Math.abs(c.bottomCenter - baseDepthAt(c.x, c.y)) < 0.6));
});

test('depth mapping: the reef is measured on a 10 m grid, kept at landing and across days; ES-2 maps nothing', () => {
  const p = cruiser();
  const { dep, v } = passBy(p, 30);
  const cells = v.bathy.cells;
  const idx = cellIndex(g1.x, g1.y);
  assert.ok(cells[idx], 'the reef cell was measured from the side');
  // the cell holds a depth actually found inside that 10 m square
  const inCell = [];
  for (let i = 0; i <= 10; i += 1) for (let j = 0; j <= 10; j += 1) inCell.push(depthAt(Math.floor(g1.x / 10) * 10 + i, Math.floor(g1.y / 10) * 10 + j));
  const got = depthOfByte(cells[idx]);
  assert.ok(got >= Math.min(...inCell) - 0.5 && got <= Math.max(...inCell) + 0.5, `${got} in ${Math.min(...inCell).toFixed(1)}..${Math.max(...inCell).toFixed(1)}`);
  // somewhere on the reef the map is clearly shallower than the printed chart (the blocks stand up)
  const onReef = [];
  for (let dx = -g1.r; dx <= g1.r; dx += 10) for (let dy = -g1.r; dy <= g1.r; dy += 10) {
    const c = cells[cellIndex(g1.x + dx, g1.y + dy)];
    if (c) onReef.push(depthOfByte(c));
  }
  assert.ok(Math.min(...onReef) < baseDepthAt(g1.x, g1.y) - 3, `reef top ${Math.min(...onReef)} vs chart ${baseDepthAt(g1.x, g1.y).toFixed(1)}`);
  returnToPort(v);
  for (let i = 0; i < 4000 && v.phase !== 'docked'; i++) advanceVoyage(v, 1);
  const s = settleVoyage(dep, summarizeVoyage(v));
  assert.ok(s.ok, s.reason);
  const saved = cellsFromBathy(s.profile.bathy);
  assert.equal(saved[idx], cells[idx]);
  assert.ok(Object.keys(saved).length >= Object.keys(cells).length * 0.99);
  assert.deepEqual(validateProfile(s.profile), []);
  // a second voyage adds to the same map
  const merged = mergeBathy(s.profile.bathy, { [cellIndex(100, 100)]: 20 });
  assert.equal(cellsFromBathy(merged)[idx], cells[idx]);
  const es2 = passBy(cruiser('sounder_es2'), 30).v;
  assert.equal(Object.keys(es2.bathy.cells).length, 0);
  assert.ok(!es2.obs.side);
});

test('saving at sea keeps the side view and the depths measured so far', () => {
  const { dep, v } = passBy(cruiser(), 30);
  const r = restoreVoyage(JSON.stringify(snapshotVoyage(v, NOW)), dep.activeVoyage);
  assert.ok(r.ok, r.reason);
  assert.deepEqual(Object.keys(r.voyage.bathy.cells).sort(), Object.keys(v.bathy.cells).sort());
  assert.deepEqual(Array.from(r.voyage.obs.side.at(-1).vals), Array.from(v.obs.side.at(-1).vals));
});

test('A12 (移行): an M5 save (format 5) opens with an empty depth map and no marks, everything else kept', () => {
  const p = { ...cruiser('sounder_es2'), funds: 777 };
  const v5 = JSON.parse(JSON.stringify(p));
  v5.schema = 5;
  delete v5.bathy;
  delete v5.marks;
  delete v5.markSeq;
  delete v5.boat.slots.hull_sonar;
  delete v5.boat.slots.roof_lights;
  const data = JSON.stringify(v5);
  const raw = JSON.stringify({ format: 'ryoshi-game-save', schemaVersion: 5, app: 'M5', revision: 2, savedAt: NOW, checksum: hashString(data), data: v5 });
  const st = memoryStorage({ [KEYS.main]: raw });
  const r = loadSave(st);
  assert.equal(r.status, 'ok', r.error);
  assert.equal(r.migratedFrom, 5);
  assert.ok(SAVE_SCHEMA >= 6);
  assert.equal(r.profile.schema, PROFILE_SCHEMA);
  assert.equal(r.profile.funds, 777);
  assert.deepEqual(r.profile.marks, []);
  assert.deepEqual(r.profile.bathy.tiles, {});
  assert.equal(r.profile.boat.slots.hull_sonar, null);
  assert.equal(r.profile.boat.slots.roof_lights, null);
  assert.equal(st.getItem(r.preMigrationKey), raw);
});
