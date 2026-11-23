// 延縄 (bottom longline for マダイ). The player decides where the line lies
// (a route on the chart, as for trolling) and when to haul it. Paying out the
// baited hooks, soaking and hauling are automatic. While the line soaks the
// boat is free — the player can fish elsewhere and come back.
//
// Catch model (handover §6.3): the line is a fixed set of hooks lying on the
// bottom where the boat laid them. Each baited hook accumulates bite
// expectation from the マダイ density at its own position, on a fixed
// game-time cadence (no per-frame lottery, no fish created by time alone).
// Bait fades with soak time. A bite reserves one fish from the school at once;
// a bite is refused if the hold could not take it (hold + everything already
// hooked). Hauling brings the hooks up one by one; each fish takes a moment to
// unhook. Level only changes work speed (paying out, hauling, unhooking).
import { METHODS, longlineSkillForLevel } from './data.js';
import { densityAt, posesAt, takeFish, activityAt } from './world.js';
import { depthAt } from './sea.js';
import { rngNext } from './rng.js';
import { maxFishKg } from './fishing.js';
import { validateRoute, routeLength } from './troll.js';

const M = () => METHODS.longline;

/** The line itself (lives on the voyage, also while no operation runs). */
export function createLonglineSet({ id, gearId, gear, startT, start }) {
  return {
    id,
    gearId,
    gear: { ...gear },
    state: 'setting', // setting -> soaking -> hauling -> aboard
    hooks: [], // {i, x, y, bottom, z, setT, fish, acc, up}
    startT,
    setEndT: null,
    haulStartT: null,
    haulEndT: null,
    start: { x: start.x, y: start.y },
    end: null,
    bites: 0,
    holdBlocked: 0,
  };
}

export function setInWater(set) {
  return !!set && (set.state === 'setting' || set.state === 'soaking' || set.state === 'hauling');
}

/** Fish on the line not yet in the hold (counted against the hold). */
export function hookedKg(set) {
  let kg = 0;
  if (set) for (const h of set.hooks) if (h.fish) kg += h.fish.kg; // until it is unhooked into the hold
  return kg;
}

/** The two end buoys of a laid line. */
export function buoys(set) {
  if (!set || !set.hooks.length) return [];
  const a = set.hooks[0];
  const b = set.hooks[set.hooks.length - 1];
  return [
    { end: 'start', x: a.x, y: a.y },
    { end: 'end', x: b.x, y: b.y },
  ];
}

export function nearestBuoy(set, x, y) {
  let best = null;
  for (const b of buoys(set)) {
    const d = Math.hypot(b.x - x, b.y - y);
    if (!best || d < best.dist) best = { ...b, dist: d };
  }
  return best;
}

/** Check a planned line route: long enough for the whole line, deep enough everywhere. */
export function validateLineRoute(points, gear) {
  const chk = validateRoute(points);
  if (!chk.ok) return chk;
  const need = (gear.hooks - 1) * gear.spacing;
  const len = routeLength(points);
  if (len < need) return { ok: false, reason: `縄の長さ（約${Math.round(need)}m）より航路が短いです（${Math.round(len)}m）。海図で先の点を指定してください。` };
  // sample the bottom along the part of the route the line will cover
  let left = need;
  for (let i = 0; i < points.length - 1 && left > 0; i++) {
    const a = points[i];
    const b = points[i + 1];
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    const use = Math.min(L, left);
    for (let s = 0; s <= use; s += 20) {
      const x = a.x + ((b.x - a.x) * s) / Math.max(1, L);
      const y = a.y + ((b.y - a.y) * s) / Math.max(1, L);
      const d = depthAt(x, y);
      if (d < M().minDepth) return { ok: false, reason: `縄を張る途中に浅い場所（${d.toFixed(0)}m）があります。延縄は${M().minDepth}mより深い所に張ります。` };
      if (d > gear.maxDepth) return { ok: false, reason: `縄を張る途中が深すぎます（${d.toFixed(0)}m、対応${gear.maxDepth}mまで）。` };
    }
    left -= use;
  }
  return { ok: true, length: len };
}

/** Paying out the line along the route (an operation: the boat is busy). */
export function createSetOperation({ id, voyageId, level, set, route, startT, x, y }) {
  return {
    id,
    voyageId,
    methodId: 'longline',
    kind: 'set',
    species: M().target,
    level,
    skill: longlineSkillForLevel(level),
    setId: set.id,
    state: 'running',
    endReason: null,
    startT,
    endT: null,
    start: { x, y },
    end: null,
    route: { points: route.map((p) => ({ x: p.x, y: p.y })), idx: route.length > 1 ? 1 : 0 },
    dist: 0,
    landed: { s: 0, m: 0, l: 0 },
    landedKg: 0,
    landedCount: 0,
    landings: [],
    stats: { pings: 0, echoPings: 0, maxEcho: 0, echoDepthSum: 0 },
  };
}

/** Hauling the line from one end (an operation: the boat follows the line). */
export function createHaulOperation({ id, voyageId, level, set, fromEnd, startT, x, y, hands = 1, machineHaul = 0 }) {
  const skill = longlineSkillForLevel(level);
  const n = set.hooks.length;
  const order = Array.from({ length: n }, (_, k) => (fromEnd === 'end' ? n - 1 - k : k));
  return {
    id,
    voyageId,
    methodId: 'longline',
    kind: 'haul',
    species: M().target,
    level,
    // a line hauler (揚げ縄機) winds the line at its own speed; unhooking stays handwork
    skill: { ...skill, haul: Math.max(skill.haul, machineHaul) },
    machine: machineHaul > 0,
    setId: set.id,
    fromEnd,
    order,
    pos: 0,
    hauled: 0,
    phase: 'haul', // haul | unhook (the fisher stops hauling to unhook)
    timer: 0,
    current: null,
    hands,
    crewJob: null, // with a deckhand: {hook, timer} — he unhooks while the hauling goes on
    state: 'running',
    endReason: null,
    startT,
    endT: null,
    start: { x, y },
    end: null,
    landed: { s: 0, m: 0, l: 0 },
    landedKg: 0,
    landedCount: 0,
    landings: [],
    stats: { pings: 0, echoPings: 0, maxEcho: 0, echoDepthSum: 0 },
  };
}

/** Speed the boat should hold for this longline operation (m/s). */
export function longlineTargetSpeed(op) {
  if (op.state === 'ended') return 0;
  if (op.kind === 'set') return op.skill.setSpeed;
  return op.phase === 'unhook' ? 0 : op.skill.haul;
}

/** Where the helm should point during a longline operation. */
export function longlineHelmTarget(op, set, boat) {
  if (op.kind === 'set') {
    const r = op.route;
    if (r.idx < r.points.length) return r.points[r.idx];
    // route used up but hooks remain: keep going straight ahead
    return { x: boat.x + Math.sin(boat.heading) * 60, y: boat.y + Math.cos(boat.heading) * 60 };
  }
  // follow the line a little ahead of the hook coming up
  const k = Math.min(op.order.length - 1, op.pos + 6);
  const h = set.hooks[op.order[k]];
  return h ? { x: h.x, y: h.y } : { x: boat.x, y: boat.y };
}

/** One step of the set / haul operation. ctx = { world, boat, onLand(fish[]) }. */
export function stepLonglineOperation(op, set, ctx, dt) {
  if (op.state === 'ended') return;
  const { world, boat } = ctx;
  const t = world.time;
  if (op.kind === 'set') {
    op.dist += Math.abs(boat.speed) * dt;
    const want = Math.min(set.gear.hooks, Math.floor(op.dist / set.gear.spacing) + 1);
    while (set.hooks.length < want) {
      const bottom = depthAt(boat.x, boat.y);
      set.hooks.push({
        i: set.hooks.length,
        x: boat.x,
        y: boat.y,
        bottom,
        z: Math.max(0.5, bottom - M().hookAboveBottom),
        setT: t,
        fish: null,
        acc: rngNext(world.rng), // uniform start: the share of hooks that bite follows the expected bites
        up: false,
      });
    }
    if (set.hooks.length >= set.gear.hooks) {
      set.state = 'soaking';
      set.setEndT = t;
      set.end = { x: boat.x, y: boat.y };
      endOp(op, t, boat, 'player');
    }
    return;
  }
  // hauling
  if (set.state !== 'hauling') {
    set.state = 'hauling';
    set.haulStartT = t;
  }
  const land = (h) => {
    const f = h.fish;
    h.fish = null;
    op.landed[f.size] += 1;
    op.landedKg += f.kg;
    op.landedCount += 1;
    op.landings.push({ t, n: 1, kg: f.kg });
    ctx.onLand([f]);
  };
  if (op.crewJob) {
    op.crewJob.timer -= dt;
    if (op.crewJob.timer <= 0) {
      land(op.crewJob.hook);
      op.crewJob = null;
    }
  }
  if (op.phase === 'unhook') {
    op.timer -= dt;
    if (op.timer <= 0) {
      land(op.current);
      op.current = null;
      op.phase = 'haul';
      op.pos += 1;
    }
  } else {
    op.hauled += op.skill.haul * dt;
    while (op.pos < op.order.length && op.pos * set.gear.spacing <= op.hauled) {
      const h = set.hooks[op.order[op.pos]];
      h.up = true;
      if (h.fish) {
        if ((op.hands || 1) > 1 && !op.crewJob) {
          // the deckhand takes it off; the line keeps coming
          op.crewJob = { hook: h, timer: op.skill.unhook };
          op.pos += 1;
          continue;
        }
        op.phase = 'unhook';
        op.timer = op.skill.unhook;
        op.current = h;
        break;
      }
      op.pos += 1;
    }
  }
  if (op.pos >= op.order.length && op.phase === 'haul' && !op.crewJob) {
    set.state = 'aboard';
    set.haulEndT = t;
    endOp(op, t, boat, op.endReason || 'player');
  }
}

function endOp(op, t, boat, reason) {
  op.state = 'ended';
  op.endT = t;
  op.end = { x: boat.x, y: boat.y };
  op.endReason = op.endReason || reason;
}

/**
 * Hooks on the bottom fish on a fixed game-time cadence (every METHODS.longline.soakEvery s).
 * ctx = { world, roomKg() } — roomKg returns what the hold can still take,
 * counting everything already hooked anywhere.
 */
export function soakLongline(set, ctx, dt) {
  if (!setInWater(set)) return;
  const m = M();
  const { world } = ctx;
  const t = world.time;
  let poses = null;
  const fishMax = maxFishKg(m.target);
  for (const h of set.hooks) {
    if (h.up || h.fish) continue;
    if (!poses) poses = posesAt(world);
    const d = densityAt(world, h.x, h.y, h.z, poses, m.target);
    if (d.total <= 0 || d.best == null) continue;
    const act = activityAt(world, world.schools[d.best], t);
    const bait = Math.exp(-(t - h.setT) / m.baitLife);
    h.acc += m.biteRateMax * act * bait * (d.total / (d.total + m.densityHalf)) * dt;
    if (h.acc >= 1) {
      if (ctx.roomKg() < fishMax) {
        h.acc = 1;
        set.holdBlocked += 1;
        continue;
      }
      const fish = takeFish(world, d.best);
      if (!fish) continue;
      h.fish = fish;
      h.acc -= 1;
      set.bites += 1;
    }
  }
}

/** Bait still working on the hooks in the water (0..1, a rough gauge for the HUD). */
export function baitLeft(set, t) {
  const inWater = set.hooks.filter((h) => !h.up && !h.fish);
  if (!inWater.length) return 0;
  return inWater.reduce((a, h) => a + Math.exp(-(t - h.setT) / M().baitLife), 0) / set.gear.hooks;
}

/** Human label for the line (HUD / chart). */
export function longlineLabel(set, op, t) {
  if (!set) return '';
  switch (set.state) {
    case 'setting':
      return `投縄中 ${set.hooks.length}/${set.gear.hooks}本`;
    case 'soaking':
      return `浸け ${Math.floor((t - set.setEndT) / 60)}分`;
    case 'hauling':
      if (op && op.kind === 'haul') return op.phase === 'unhook' ? `取り込み（${op.pos + 1}/${set.gear.hooks}本目）` : `揚げ縄 ${op.pos}/${set.gear.hooks}本`;
      return '揚げ縄';
    case 'aboard':
      return '縄は船上';
    default:
      return '';
  }
}
