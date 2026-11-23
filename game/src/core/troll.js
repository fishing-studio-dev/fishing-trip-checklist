// Automatic trolling (曳縄): the player picks a route; the boat runs it at
// towing speed and the character sets the lines, fights, hauls, unhooks and
// re-sets them. The autopilot only follows the chosen route — it never looks
// for or chases fish by itself (handover §6.3).
//
// Catch model: a lure towed behind the boat meets fish only where the サワラ
// school's density at the lure's position and depth is non-zero. Strike
// expectation accumulates with game time; a strike reserves one fish. Each
// line is out of the water while fighting/hauling/unhooking (handling
// capacity), and the hold check includes fish already on the lines.
import { METHODS, trollSkillForLevel } from './data.js';
import { densityAt, posesAt, takeFish, activityAt } from './world.js';
import { depthAt, isLand, inBounds } from './sea.js';
import { rngNext } from './rng.js';
import { maxFishKg, requestStop } from './fishing.js';
import { clearPath } from './boat.js';
import { initHands, fillHands, takeHands, releaseHands } from './hands.js';

export function createTrollOperation({ id, voyageId, level, gear, gearId, startT, x, y, route, hands = 1 }) {
  const skill = trollSkillForLevel(level);
  const op = {
    id,
    voyageId,
    methodId: 'troll',
    species: 'sawara',
    level,
    gearId,
    gear,
    skill,
    state: 'running',
    endReason: null,
    startT,
    endT: null,
    start: { x, y },
    end: null,
    route: { points: route.map((p) => ({ x: p.x, y: p.y })), idx: route.length > 1 ? 1 : 0, dir: 1, changes: 0 },
    lines: gear.lureDepths.map((depth, i) => {
      const side = i % 2 ? 1 : -1;
      const outer = gear.lines > 2 && i >= 2;
      return {
        phase: 'deploy',
        timer: skill.deploy,
        side,
        offset: side * (gear.spread ? gear.spread[i] : 3),
        label: `${side < 0 ? '左舷' : '右舷'}${gear.lines > 2 ? (outer ? '外' : '内') : ''}`,
        lureDepth: depth,
        fish: null,
        acc: 0,
        haulLeft: 0,
        waiting: false,
      };
    }),
    landed: { s: 0, m: 0, l: 0 },
    landedKg: 0,
    landedCount: 0,
    landings: [],
    stats: {
      pings: 0,
      echoPings: 0,
      maxEcho: 0,
      echoDepthSum: 0,
      tanaMin: Math.min(...gear.lureDepths),
      tanaMax: Math.max(...gear.lureDepths),
      bottomMin: null,
      bottomMax: null,
      bites: 0,
      cycles: 0,
      holdBlocked: 0,
      towDistance: 0,
      lastTanaSource: 'lure',
    },
  };
  initHands(op, hands);
  return op;
}

export function trollNeedsHands(line) {
  return line.phase === 'deploy' || line.phase === 'fight' || line.phase === 'haul' || line.phase === 'unhook';
}

export function trollInFlightKg(op) {
  let kg = 0;
  for (const l of op.lines) if (l.fish) kg += l.fish.kg;
  return kg;
}

/** Speed the boat should hold while trolling (m/s). */
export function trollTargetSpeed(op) {
  if (op.state === 'ended') return 0;
  if (op.state === 'stopping') return METHODS.troll.haulBoatSpeed;
  const hauling = op.lines.some((l) => l.fish && (l.phase === 'fight' || l.phase === 'haul'));
  return hauling ? METHODS.troll.haulBoatSpeed : op.gear.towSpeed;
}

/** World position of a line's lure (behind the boat, a little to its side). */
export function lurePosition(boat, gear, line) {
  const back = gear.lineLength;
  const sideOff = line.offset != null ? line.offset : line.side * 3;
  return {
    x: boat.x - Math.sin(boat.heading) * back + Math.cos(boat.heading) * sideOff,
    y: boat.y - Math.cos(boat.heading) * back - Math.sin(boat.heading) * sideOff,
  };
}

export function stepTrollOperation(op, ctx, dt) {
  if (op.state === 'ended') return;
  const m = METHODS.troll;
  const { world, boat } = ctx;
  const t = world.time;
  const speed = Math.abs(boat.speed);
  const bottom = depthAt(boat.x, boat.y);
  op.stats.bottomMin = op.stats.bottomMin == null ? bottom : Math.min(op.stats.bottomMin, bottom);
  op.stats.bottomMax = op.stats.bottomMax == null ? bottom : Math.max(op.stats.bottomMax, bottom);
  if (op.state === 'running') op.stats.towDistance += speed * dt;
  const stopping = op.state === 'stopping';
  let poses = null;
  fillHands(op);

  for (let li = 0; li < op.lines.length; li++) {
    const line = op.lines[li];
    if (stopping && line.phase === 'deploy') line.phase = 'idle';
    // setting, playing, hauling and unhooking take hands; they take turns when all hands are busy
    if (trollNeedsHands(line) && !takeHands(op, li)) {
      line.waiting = true;
      continue;
    }
    line.waiting = false;
    switch (line.phase) {
      case 'deploy': {
        line.timer -= dt;
        if (stopping) {
          line.phase = 'idle';
          break;
        }
        if (line.timer <= 0) {
          line.phase = 'tow';
          line.acc = rngNext(world.rng) * 0.5;
        }
        break;
      }
      case 'tow': {
        if (stopping) {
          line.phase = 'haul';
          line.haulLeft = op.gear.lineLength;
          break;
        }
        if (speed < m.minTowSpeed) break;
        const lp = lurePosition(boat, op.gear, line);
        const depth = Math.min(line.lureDepth, Math.max(0.5, depthAt(lp.x, lp.y) - 1));
        if (!poses) poses = posesAt(world);
        const d = densityAt(world, lp.x, lp.y, depth, poses, 'sawara');
        if (d.total <= 0 || d.best == null) break;
        const act = activityAt(world, world.schools[d.best], t);
        // encounters scale with how fast the lure sweeps through the water
        const sweep = Math.min(1.2, speed / op.gear.towSpeed);
        line.acc += m.biteRateMax * act * sweep * (d.total / (d.total + m.densityHalf)) * dt;
        if (line.acc >= 1) {
          const room = ctx.capacityKg - ctx.hold.kg - trollInFlightKg(op) - (ctx.reservedKg || 0);
          if (room < maxFishKg('sawara')) {
            line.acc = 1;
            op.stats.holdBlocked += 1;
            break;
          }
          const fish = takeFish(world, d.best);
          if (!fish) break;
          line.fish = fish;
          line.acc -= 1;
          op.stats.bites += 1;
          line.phase = 'fight';
          line.timer = op.skill.fight;
        }
        break;
      }
      case 'fight': {
        line.timer -= dt;
        if (line.timer <= 0) {
          line.phase = 'haul';
          line.haulLeft = op.gear.lineLength;
        }
        break;
      }
      case 'haul': {
        line.haulLeft -= op.skill.haul * dt;
        if (line.haulLeft <= 0) {
          line.haulLeft = 0;
          line.phase = 'unhook';
          line.timer = line.fish ? op.skill.unhook : 0;
        }
        break;
      }
      case 'unhook': {
        line.timer -= dt;
        if (line.timer <= 0) {
          if (line.fish) {
            const f = line.fish;
            op.landed[f.size] += 1;
            op.landedKg += f.kg;
            op.landedCount += 1;
            op.landings.push({ t, n: 1, kg: f.kg });
            ctx.onLand([f]);
          }
          line.fish = null;
          op.stats.cycles += 1;
          if (op.state === 'stopping') line.phase = 'idle';
          else {
            line.phase = 'deploy';
            line.timer = op.skill.deploy;
          }
        }
        break;
      }
      default:
        break;
    }
    if (trollNeedsHands(line)) {
      if (!takeHands(op, li)) line.waiting = true;
    } else releaseHands(op, li);
  }

  if (op.state === 'running' && op.stats.holdBlocked > 0 && trollInFlightKg(op) === 0) requestStop(op, 'hold_full');
  if (op.state === 'stopping' && op.lines.every((l) => l.phase === 'idle')) {
    op.state = 'ended';
    op.endT = t;
    op.end = { x: boat.x, y: boat.y };
  }
}

/** Check a planned route (list of points the boat runs back and forth along). */
export function validateRoute(points, from = null) {
  if (!points || points.length < 2) return { ok: false, reason: '航路には2点以上が必要です。' };
  for (const p of points) {
    if (!inBounds(p.x, p.y) || isLand(p.x, p.y)) return { ok: false, reason: '航路の点が漁場の外か陸の上です。' };
    if (depthAt(p.x, p.y) < 6) return { ok: false, reason: '浅すぎる場所が航路に入っています。' };
  }
  const legs = from ? [from, ...points] : points;
  for (let i = 0; i < legs.length - 1; i++) if (!clearPath(legs[i], legs[i + 1])) return { ok: false, reason: '航路が陸にかかっています。' };
  return { ok: true };
}

/** Default route: straight ahead from the boat and back (shortened if it would hit land). */
export function defaultRoute(boat) {
  for (const len of [700, 500, 350]) {
    const end = { x: boat.x + Math.sin(boat.heading) * len, y: boat.y + Math.cos(boat.heading) * len };
    const pts = [{ x: boat.x, y: boat.y }, end];
    if (validateRoute(pts).ok) return pts;
  }
  return null;
}

export function routeLength(points) {
  let L = 0;
  for (let i = 0; i < points.length - 1; i++) L += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
  return L;
}

export function trollLineLabel(line) {
  const side = line.label || (line.side < 0 ? '左舷' : '右舷');
  if (line.waiting) return `${side}：手が空くのを待っている${line.fish ? '（魚が掛かったまま）' : ''}`;
  switch (line.phase) {
    case 'deploy':
      return `${side}：仕掛けを出している`;
    case 'tow':
      return `${side}：曳航中（${line.lureDepth}m）`;
    case 'fight':
      return `${side}：掛かった！やり取り中`;
    case 'haul':
      return `${side}：手繰り寄せ ${line.haulLeft.toFixed(0)}m${line.fish ? '' : '（回収）'}`;
    case 'unhook':
      return `${side}：取り込み`;
    case 'idle':
      return `${side}：回収済み`;
    default:
      return side;
  }
}
