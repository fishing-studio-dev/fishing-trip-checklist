// Signs on the sea surface (海面の手掛かり), worked out from the same shared sea
// that the sounder and the catch read — never invented, never a hidden label:
//   - 鳥山 (birds): a bait school pushed up near the surface, birds over it.
//     Stronger when 青物 or サワラ are feeding right under it.
//   - ナブラ: predators chasing the bait at the surface — splashes.
//   - 潮目: a line where the tide runs hard against a slope (本作設定). It
//     shows where and when the water is moving, which wakes most fish up.
// Pure functions of the world at time t; they draw nothing at random.
import { SPECIES } from './data.js';
import { posesAt, schoolTotal, activityAt } from './world.js';
import { currentAt } from './sea.js';

// slopes where the tide piles up into a visible line when it runs (game setting)
export const SHIOME_LINES = [
  { id: 'kita', name: '北の瀬の肩', a: { x: 2120, y: 1960 }, b: { x: 2380, y: 2240 } },
  { id: 'higashi', name: '東の駆け上がり', a: { x: 2390, y: 1250 }, b: { x: 2420, y: 1900 } },
  { id: 'okise', name: '沖の瀬の肩', a: { x: 1420, y: 3880 }, b: { x: 1600, y: 3780 } },
];
export const CUE_RANGE = { birds: 1500, nabura: 500, shiome: 450 };
export const CUE_LABEL = { birds: '鳥山', nabura: 'ナブラ', shiome: '潮目' };

const isPredator = (s) => s.species === 'sawara' || (SPECIES[s.species] && SPECIES[s.species].habit === 'roam');

/** Every surface sign at time t: [{id, kind, x, y, strength 0..1, ...}]. */
export function surfaceCues(world, t = world.time) {
  const h = t / 3600;
  if (h < 4.8 || h > 18.2) return []; // too dark to see anything
  const cues = [];
  const poses = posesAt(world, t);
  const schools = world.schools;
  for (let i = 0; i < schools.length; i++) {
    const s = schools[i];
    if (!SPECIES[s.species].bait || schoolTotal(s) <= 0) continue;
    const p = poses[i];
    if (p.z > 9.5) continue; // the bait is too deep for birds to reach
    let pred = 0;
    for (let j = 0; j < schools.length; j++) {
      const q = schools[j];
      if (!isPredator(q) || schoolTotal(q) <= 0) continue;
      const pq = poses[j];
      if (pq.z > 18 || Math.hypot(pq.x - p.x, pq.y - p.y) > 90) continue;
      pred += schoolTotal(q) * activityAt(world, q, t);
    }
    const shallow = Math.min(1, (9.5 - p.z) / 5);
    const birds = shallow * (0.45 + 0.55 * Math.min(1, pred / 10));
    if (birds > 0.3) cues.push({ id: `birds-${s.id}`, kind: 'birds', x: p.x, y: p.y, strength: Math.round(birds * 100) / 100 });
    if (pred > 4 && p.z < 7.5) cues.push({ id: `nabura-${s.id}`, kind: 'nabura', x: p.x, y: p.y, strength: Math.round(Math.min(1, pred / 15) * 100) / 100 });
  }
  // サワラ feeding right at the surface make a ナブラ of their own
  for (let i = 0; i < schools.length; i++) {
    const s = schools[i];
    if (s.species !== 'sawara' || schoolTotal(s) <= 0) continue;
    const p = poses[i];
    const act = activityAt(world, s, t);
    if (p.z < 4 && act > 0.95) cues.push({ id: `nabura-${s.id}`, kind: 'nabura', x: p.x, y: p.y, strength: Math.round(Math.min(1, act - 0.6) * 100) / 100 });
  }
  // 潮目: when the tide runs hard, a line forms along the slopes, pushed a little downstream
  const c = currentAt(world.cond, t);
  const sp = Math.hypot(c.x, c.y);
  if (sp > 0.18) {
    for (const l of SHIOME_LINES) {
      const shift = 250 * Math.min(1, sp / 0.3);
      const ox = (c.x / sp) * shift;
      const oy = (c.y / sp) * shift * 0.5;
      cues.push({ id: `shiome-${l.id}`, kind: 'shiome', name: l.name, a: { x: l.a.x + ox, y: l.a.y + oy }, b: { x: l.b.x + ox, y: l.b.y + oy }, x: (l.a.x + l.b.x) / 2 + ox, y: (l.a.y + l.b.y) / 2 + oy, strength: Math.round(Math.min(1, (sp - 0.18) / 0.12) * 100) / 100 });
    }
  }
  return cues;
}

/** Distance from (x, y) to a cue (to its line for a 潮目). */
export function cueDistance(cue, x, y) {
  if (cue.kind !== 'shiome') return Math.hypot(cue.x - x, cue.y - y);
  const dx = cue.b.x - cue.a.x;
  const dy = cue.b.y - cue.a.y;
  const u = Math.max(0, Math.min(1, ((x - cue.a.x) * dx + (y - cue.a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(cue.a.x + dx * u - x, cue.a.y + dy * u - y);
}

/** The cues the crew can see from (x, y): within their sighting range. */
export function visibleCues(cues, x, y) {
  return cues.filter((c) => cueDistance(c, x, y) <= CUE_RANGE[c.kind] * (0.5 + 0.5 * c.strength));
}
