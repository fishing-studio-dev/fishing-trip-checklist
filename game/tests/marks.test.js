// Item 5: the player's own marks — made from the boat, the sounder, the side
// view and the sonar; named, noted, listed, deleted, kept across days, and a
// route straight to one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProfile, markDeparture, validateProfile } from '../src/core/profile.js';
import { createVoyage, advanceVoyage, setHelm, summarizeVoyage, returnToPort, addManualMark, addMarkAt, editVoyageMark, removeVoyageMark, routeTo } from '../src/core/voyage.js';
import { settleVoyage } from '../src/core/economy.js';
import { snapshotVoyage, restoreVoyage } from '../src/core/voyageSnapshot.js';
import { editSavedMark, removeSavedMark, markList, markTitle, pushVoyageMark, MARK_LIMITS } from '../src/core/marks.js';
import { sideToWorld } from '../src/core/sideview.js';
import { STRUCTURES } from '../src/core/sea.js';
import { CALM } from './helpers.js';

const NOW = '2026-11-23T00:00:00.000Z';
const g1 = STRUCTURES.find((s) => s.id === 'g1');

function cruiser() {
  const p = createProfile({ worldSeed: 5, now: NOW });
  p.boat.model = 'cruiser_2';
  p.boat.slots = { helm_sounder: { uid: 'x1', itemId: 'sounder_sv1' }, starboard_reel: { uid: 'x2', itemId: 'reel_hand' }, port_reel: null, stern_troll: null, deck_longline: null, starboard_hauler: null, hull_sonar: { uid: 'x3', itemId: 'sonar_cs1' }, roof_lights: null };
  assert.deepEqual(validateProfile(p), []);
  return p;
}

function voyage(p, start) {
  const dep = markDeparture(p, NOW);
  const v = createVoyage(dep, { scenario: { conditions: CALM, schools: [] }, start });
  v.world.time = 7 * 3600;
  return { dep, v };
}

function landAndSettle(dep, v) {
  returnToPort(v);
  for (let i = 0; i < 6000 && v.phase !== 'docked'; i++) advanceVoyage(v, 1);
  assert.equal(v.phase, 'docked');
  const s = settleVoyage(dep, summarizeVoyage(v));
  assert.ok(s.ok, s.reason);
  assert.deepEqual(validateProfile(s.profile), []);
  return s.profile;
}

test('marks made at sea are kept at landing with their names and memos, and still there the next day; auto marks are not', () => {
  const { dep, v } = voyage(cruiser(), { x: 1200, y: 1200, heading: 0 });
  const a = addManualMark(v);
  const b = addMarkAt(v, 1300, 1400, 'sonar');
  const c = addMarkAt(v, 1250, 1300, 'sounder', { echo: 21.4, bottom: 33 });
  v.obs.marks.push({ id: v.obs.markSeq++, kind: 'auto', x: 1, y: 1, t: 0, depth: null, bottom: 30 });
  assert.ok(editVoyageMark(v, b.id, { name: '沖の反応', memo: '朝 群れ大きい' }).ok);
  assert.ok(removeVoyageMark(v, a.id).ok);
  assert.ok(!removeVoyageMark(v, a.id).ok);
  const p = landAndSettle(dep, v);
  assert.equal(p.marks.length, 2);
  const sb = p.marks.find((m) => m.kind === 'sonar');
  assert.equal(sb.name, '沖の反応');
  assert.equal(sb.memo, '朝 群れ大きい');
  assert.equal(sb.day, v.day);
  const sc = p.marks.find((m) => m.kind === 'sounder');
  assert.equal(sc.echo, 21.4);
  assert.equal(sc.depth, 33);
  assert.equal(markTitle(sc), `魚探${sc.id.slice(1)}`);
  void c;
  // the next voyage sees them in the list, with the distance and bearing from the boat
  const next = voyage(p, { x: 1300, y: 1300, heading: 0 }).v;
  const rows = markList(p, next);
  const rb = rows.find((r) => r.id === sb.id);
  assert.ok(Math.abs(rb.dist - 100) < 1);
  assert.equal(rb.bearing.name, '北');
  assert.equal(rows.filter((r) => r.source === 'saved').length, 2);
});

test('editing and deleting saved marks returns a new profile and leaves the old one as it was', () => {
  const p0 = cruiser();
  p0.marks = [{ id: 'M1', x: 10, y: 20, name: '', memo: '', day: 1, t: 100, kind: 'manual', depth: 30, echo: null }];
  p0.markSeq = 1;
  const r = editSavedMark(p0, 'M1', { name: '  根の頭\u0007ここ  ', memo: 'x'.repeat(200) });
  assert.ok(r.ok);
  assert.equal(p0.marks[0].name, '');
  assert.equal(r.profile.marks[0].name, '根の頭 ここ');
  assert.equal(r.profile.marks[0].memo.length, MARK_LIMITS.memo);
  assert.equal(editSavedMark(p0, 'M1', { name: 'あ'.repeat(40) }).profile.marks[0].name.length, MARK_LIMITS.name);
  assert.deepEqual(validateProfile(r.profile), []);
  const d = removeSavedMark(r.profile, 'M1');
  assert.ok(d.ok);
  assert.equal(d.profile.marks.length, 0);
  assert.equal(r.profile.marks.length, 1);
  assert.ok(!removeSavedMark(d.profile, 'M1').ok);
});

test('a tap on a side-view echo puts the mark on the reef itself, though the boat passed 30 m away', () => {
  const { v } = voyage(cruiser(), { x: g1.x - 30, y: g1.y - 200, heading: 0 });
  setHelm(v, { throttle: 3 });
  advanceVoyage(v, 180);
  // the brightest point of the starboard half over the whole pass (what the player would tap)
  let best = null;
  for (const row of v.obs.side) {
    const n = row.vals.length;
    for (let k = Math.ceil(n / 2) + 1; k < n; k++) if (!best || row.vals[k] > best.v) best = { v: row.vals[k], row, offset: -60 + k * 5 };
  }
  const p = sideToWorld(best.row, best.offset);
  assert.ok(Math.hypot(p.x - g1.x, p.y - g1.y) < g1.r + 8, `mark at ${Math.round(p.x)},${Math.round(p.y)} vs reef ${g1.x},${g1.y}`);
  const m = addMarkAt(v, p.x, p.y, 'side');
  assert.equal(m.kind, 'side');
  assert.ok(m.bottom < 40);
});

test('the player\'s marks are not pushed out by the automatic sounder marks', () => {
  const { v } = voyage(cruiser(), { x: 1200, y: 1200, heading: 0 });
  const mine = addManualMark(v);
  for (let i = 0; i < 300; i++) pushVoyageMark(v.obs, { id: v.obs.markSeq++, kind: 'auto', x: i, y: 0, t: i });
  assert.ok(v.obs.marks.includes(mine));
  assert.equal(v.obs.marks.filter((m) => m.kind === 'auto').length, MARK_LIMITS.auto);
  // the player's own marks have their own (larger) cap, oldest first
  for (let i = 0; i < MARK_LIMITS.voyage; i++) addMarkAt(v, 1000 + i, 1000, 'sonar');
  assert.ok(!v.obs.marks.includes(mine));
  assert.equal(v.obs.marks.filter((m) => m.kind !== 'auto').length, MARK_LIMITS.voyage);
});

test('「ここへ」: the boat runs straight to a mark and stops on it', () => {
  const { v } = voyage(cruiser(), { x: 1200, y: 1200, heading: 0 });
  const r = routeTo(v, { x: g1.x, y: g1.y });
  assert.ok(r.ok, r.reason);
  for (let i = 0; i < 600 && v.autopilot; i++) advanceVoyage(v, 1);
  assert.ok(!v.autopilot, 'arrived');
  assert.ok(Math.hypot(v.boat.x - g1.x, v.boat.y - g1.y) < 30, `${Math.round(v.boat.x)},${Math.round(v.boat.y)}`);
  // outside the small boat's zone it is refused and the old route stays
  const p = createProfile({ worldSeed: 5, now: NOW });
  const { v: s } = voyage(p, { x: 1200, y: 1200, heading: 0 });
  s.plannedRoute = [{ x: 1300, y: 1300 }];
  const no = routeTo(s, { x: 1650, y: 4050 });
  assert.ok(!no.ok);
  assert.deepEqual(s.plannedRoute, [{ x: 1300, y: 1300 }]);
});

test('names and memos of today\'s marks survive closing the page at sea', () => {
  const { dep, v } = voyage(cruiser(), { x: 1200, y: 1200, heading: 0 });
  const m = addMarkAt(v, 1250, 1250, 'sonar');
  editVoyageMark(v, m.id, { name: '反応A', memo: 'メモ' });
  const r = restoreVoyage(JSON.stringify(snapshotVoyage(v, NOW)), dep.activeVoyage);
  assert.ok(r.ok, r.reason);
  const back = r.voyage.obs.marks.find((x) => x.id === m.id);
  assert.equal(back.name, '反応A');
  assert.equal(back.memo, 'メモ');
});
