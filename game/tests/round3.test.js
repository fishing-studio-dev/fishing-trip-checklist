// Third round: fish on the up-current face of the reefs (潮表), クエ, the 青物
// steps, four rods on the medium boat, later squid trips.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, schoolCenter, schoolPose, holdOffset } from '../src/core/world.js';
import { currentAt } from '../src/core/sea.js';
import { HOLDS } from '../src/core/season.js';

const upCurrentShare = (w, s, t) => {
  // >0: the school stands on the side the stream comes from
  const c = currentAt(w.cond, t);
  const sp = Math.hypot(c.x, c.y) || 1;
  const p = schoolCenter(s, t);
  return -((p.x - s.holdTo.x) * c.x + (p.y - s.holdTo.y) * c.y) / sp;
};

test('潮表: fish tied to a reef sit on the face the stream meets, cross at slack and change face when the tide turns', () => {
  let checked = 0;
  for (let d = 10; d <= 40 && checked < 6; d += 3) {
    const w = createWorld(77, d, 5 * 3600);
    for (const s of w.schools.filter((x) => x.holdTo && (x.species === 'aji' || x.species === 'iwashi'))) {
      // sample the running stream on both tides of the day
      let flood = null;
      let ebb = null;
      for (let t = 6 * 3600; t < 18 * 3600; t += 600) {
        const c = currentAt(w.cond, t);
        const sp = Math.hypot(c.x, c.y);
        if (sp < 0.15) continue;
        if (c.y > 0 && !flood) flood = t;
        if (c.y < 0 && !ebb) ebb = t;
      }
      if (!flood || !ebb) continue;
      assert.ok(upCurrentShare(w, s, flood) > s.holdTo.face * 0.6, `${s.id} on the up-current face at the flood`);
      assert.ok(upCurrentShare(w, s, ebb) > s.holdTo.face * 0.6, `${s.id} on the (other) up-current face at the ebb`);
      const pf = schoolCenter(s, flood);
      const pe = schoolCenter(s, ebb);
      assert.ok(Math.hypot(pf.x - pe.x, pf.y - pe.y) > s.holdTo.face, `${s.id} moved across the reef with the turn`);
      checked++;
    }
  }
  assert.ok(checked >= 6, `${checked} reef schools checked`);
  // the offset is a pure function of time: smooth (no jumps) and zero without a tie
  const w = createWorld(77, 20, 5 * 3600);
  const s = w.schools.find((x) => x.holdTo);
  for (let t = 5 * 3600; t < 18 * 3600; t += 60) {
    const a = holdOffset(s, t);
    const b = holdOffset(s, t + 60);
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 12, 'moves at most a few metres a minute');
  }
  assert.deepEqual(holdOffset({ a: { x: 0, y: 0 } }, 3600), { x: 0, y: 0 });
});

test('bait gathers over the reefs in its season, and the reef 青物 stay under it on the same face', () => {
  let pairs = 0;
  for (let d = 1; d <= 60; d++) {
    const w = createWorld(77, d, 5 * 3600);
    for (const s of w.schools.filter((x) => x.follows && x.holdTo)) {
      const bait = w.schools.find((x) => x.id === s.follows);
      assert.equal(bait.holdTo.id, s.holdTo.id);
      assert.ok(HOLDS[s.holdTo.id]);
      for (const t of [7 * 3600, 12 * 3600]) assert.ok(schoolPose(s, t, w).z > schoolPose(bait, t, w).z);
      pairs++;
    }
  }
  assert.ok(pairs >= 3, `${pairs} reef bait with 青物 in a year`);
});
