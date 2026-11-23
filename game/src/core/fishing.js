// Automatic handline operation (自動操業: 投入 → タナ取り → 誘い/待ち → 合わせ → 回収 → 取り込み).
//
// Catch model (handover §6.1):
//   - Candidates: bites arise only where the hook depth overlaps school density
//     at the boat's position; bite expectation accumulates with game time
//     (no per-frame lottery). Empty water -> zero bites at any level (A04).
//   - Handling capacity: hooks per cycle and cycle time (drop, retrieve,
//     unhook, rebait). Level shortens handling (手際); equipment changes reel speed.
//   - Remaining fish: a bite reserves one fish from the school immediately.
//   - Hold: a bite is only accepted if hold + fish already on hooks fits.
// => landed <= min(candidates, capacity, school remaining, hold space).
import { METHODS, skillForLevel, SPECIES } from './data.js';
import { densityAt, posesAt, takeFish, activityAt } from './world.js';
import { depthAt } from './sea.js';
import { readTana } from './sounder.js';
import { rngNext } from './rng.js';

export function maxFishKg(species) {
  return Math.max(...Object.values(SPECIES[species].sizes).map((s) => s.kg));
}
const MAX_FISH_KG = maxFishKg('aji');

/**
 * rigs: one per fitted reel, e.g. [{label:'右舷', reelId, reel}, {label:'左舷', ...}].
 * One fisher works all rigs: baiting, unhooking and hand-cranking need their
 * hands, so with two rigs those steps take turns (op.worker). Dropping,
 * waiting for bites and electric retrieval do not.
 */
export function createOperation({ id, voyageId, methodId, level, rigs, startT, x, y }) {
  const method = METHODS[methodId];
  const skill = skillForLevel(level);
  const lines = rigs.map((r) => newLine(method, skill, r));
  return {
    id,
    voyageId,
    methodId,
    species: method.target,
    level,
    reelId: rigs[0].reelId,
    retrieveSpeed: lines[0].retrieveSpeed,
    maxDepth: lines[0].maxDepth,
    worker: null,
    queue: [],
    skill,
    state: 'running',
    endReason: null,
    startT,
    endT: null,
    start: { x, y },
    end: null,
    lines,
    landed: { s: 0, m: 0, l: 0 },
    landedKg: 0,
    landedCount: 0,
    landings: [], // {t, n, kg}
    stats: {
      pings: 0,
      echoPings: 0,
      maxEcho: 0,
      echoDepthSum: 0,
      tanaMin: null,
      tanaMax: null,
      bottomMin: null,
      bottomMax: null,
      bites: 0,
      cycles: 0,
      holdBlocked: 0,
      lastTanaSource: null,
    },
  };
}

function newLine(method, skill, rig) {
  const hand = rig.reel.retrieve == null;
  return {
    label: rig.label,
    reelId: rig.reelId,
    handReel: hand,
    retrieveSpeed: hand ? skill.handRetrieve : rig.reel.retrieve,
    maxDepth: rig.reel.maxDepth,
    waiting: false,
    phase: 'prep',
    timer: skill.rebait,
    depth: 0,
    tana: null,
    target: null,
    tanaSource: null,
    hooks: Array.from({ length: method.hooks }, () => ({ fish: null, acc: 0 })),
    firstBiteT: null,
    sinceRetune: 0,
  };
}

/** Steps that need the fisher's hands (others run on their own). */
export function handlineNeedsHands(line) {
  return line.phase === 'prep' || line.phase === 'unhook' || (line.phase === 'retrieve' && line.handReel);
}

export function fishOnLine(line) {
  return line.hooks.filter((h) => h.fish).map((h) => h.fish);
}

export function inFlightKg(op) {
  let kg = 0;
  for (const line of op.lines) for (const h of line.hooks) if (h.fish) kg += h.fish.kg;
  return kg;
}

export function requestStop(op, reason) {
  if (op.state !== 'running') return false;
  op.state = 'stopping';
  op.endReason = reason;
  return true;
}

/**
 * Advance the operation by dt. ctx = { world, boat, obs, hold, capacityKg, onLand(fish[]) }.
 */
export function stepOperation(op, ctx, dt) {
  if (op.state === 'ended') return;
  const method = METHODS[op.methodId];
  const { world, boat } = ctx;
  const t = world.time;
  const bottom = depthAt(boat.x, boat.y);
  op.stats.bottomMin = op.stats.bottomMin == null ? bottom : Math.min(op.stats.bottomMin, bottom);
  op.stats.bottomMax = op.stats.bottomMax == null ? bottom : Math.max(op.stats.bottomMax, bottom);
  let poses = null;
  const stopping = op.state === 'stopping';
  if (op.worker == null && op.queue.length) op.worker = op.queue.shift();

  for (let li = 0; li < op.lines.length; li++) {
    const line = op.lines[li];
    if (stopping && line.phase === 'prep') line.phase = 'idle';
    // the fisher's hands: one rig at a time for the steps that need them
    if (handlineNeedsHands(line)) {
      if (op.worker == null) op.worker = li;
      if (op.worker !== li) {
        if (!op.queue.includes(li)) op.queue.push(li);
        line.waiting = true;
        continue;
      }
    }
    line.waiting = false;
    switch (line.phase) {
      case 'prep': {
        line.timer -= dt;
        if (stopping) {
          line.phase = 'idle';
          break;
        }
        if (line.timer <= 0) {
          const r = readTana(ctx.obs, method, line.maxDepth);
          if (r.tana == null) break; // no sounder reading yet
          setTana(op, line, r);
          line.phase = 'drop';
        }
        break;
      }
      case 'drop': {
        if (stopping) {
          line.phase = 'retrieve';
          break;
        }
        line.tana = Math.min(line.tana, bottom - 0.5, line.maxDepth);
        line.depth += op.skill.dropSpeed * dt;
        if (line.depth >= line.tana) {
          line.depth = line.tana;
          line.phase = 'fish';
          line.sinceRetune = 0;
          for (const h of line.hooks) h.acc = rngNext(world.rng) * 0.6;
        }
        break;
      }
      case 'adjust': {
        if (stopping) {
          line.phase = 'retrieve';
          break;
        }
        const dir = Math.sign(line.target - line.depth);
        line.depth += dir * op.skill.dropSpeed * dt;
        if ((dir >= 0 && line.depth >= line.target) || (dir < 0 && line.depth <= line.target)) {
          line.depth = line.target;
          line.tana = line.target;
          line.phase = 'fish';
          line.sinceRetune = 0;
        }
        break;
      }
      case 'fish': {
        // the sinker follows the bottom when the boat drifts over shallower ground
        if (line.tana > bottom - 0.5) {
          line.tana = Math.max(1, bottom - 0.5);
          line.depth = line.tana;
        }
        if (!poses) poses = posesAt(world);
        let anyFish = false;
        let allFull = true;
        for (let k = 0; k < line.hooks.length; k++) {
          const h = line.hooks[k];
          if (h.fish) {
            anyFish = true;
            continue;
          }
          allFull = false;
          if (stopping) continue;
          const hookDepth = line.tana - 1.0 - k * method.hookSpacing;
          if (hookDepth < 0.5) continue;
          const d = densityAt(world, boat.x, boat.y, hookDepth, poses, 'aji');
          if (d.total <= 0 || d.best == null) continue;
          const act = activityAt(world, world.schools[d.best], t);
          const lambda = method.biteRateMax * act * (d.total / (d.total + method.densityHalf));
          h.acc += lambda * dt;
          if (h.acc >= 1) {
            const room = ctx.capacityKg - ctx.hold.kg - inFlightKg(op) - (ctx.reservedKg || 0);
            if (room < MAX_FISH_KG) {
              h.acc = 1;
              op.stats.holdBlocked += 1;
              continue;
            }
            const fish = takeFish(world, d.best);
            if (!fish) continue;
            h.fish = fish;
            h.acc -= 1;
            anyFish = true;
            op.stats.bites += 1;
            if (line.firstBiteT == null) line.firstBiteT = t;
          }
        }
        if (stopping) {
          line.phase = 'retrieve';
          break;
        }
        if (anyFish && (allFull || t - line.firstBiteT >= method.oiWait)) {
          line.phase = 'retrieve';
          break;
        }
        if (!anyFish) {
          line.sinceRetune += dt;
          if (line.sinceRetune >= method.retuneAfter) {
            line.sinceRetune = 0;
            const r = readTana(ctx.obs, method, line.maxDepth);
            if (r.tana != null && Math.abs(r.tana - line.tana) > 2.5) {
              line.target = Math.min(r.tana, bottom - 0.5);
              line.tanaSource = r.source;
              trackTana(op, line.target, r.source);
              line.phase = 'adjust';
            }
          }
        }
        break;
      }
      case 'retrieve': {
        line.depth -= line.retrieveSpeed * dt;
        if (line.depth <= 0) {
          line.depth = 0;
          line.phase = 'unhook';
          line.timer = fishOnLine(line).length * op.skill.unhook;
        }
        break;
      }
      case 'unhook': {
        line.timer -= dt;
        if (line.timer <= 0) {
          const fish = fishOnLine(line);
          if (fish.length) {
            let kg = 0;
            for (const f of fish) {
              op.landed[f.size] += 1;
              kg += f.kg;
            }
            op.landedKg += kg;
            op.landedCount += fish.length;
            op.landings.push({ t, n: fish.length, kg });
            ctx.onLand(fish);
          }
          for (const h of line.hooks) h.fish = null;
          line.firstBiteT = null;
          op.stats.cycles += 1;
          if (op.state === 'stopping') {
            line.phase = 'idle';
          } else {
            line.phase = 'prep';
            line.timer = op.skill.rebait;
          }
        }
        break;
      }
      default:
        break;
    }
    if (handlineNeedsHands(line) && op.worker !== li) {
      // just stepped into a hand job: take the hands if free, otherwise wait in turn
      if (op.worker == null) op.worker = li;
      else {
        line.waiting = true;
        if (!op.queue.includes(li)) op.queue.push(li);
      }
    }
    if (op.worker === li && !handlineNeedsHands(line)) op.worker = op.queue.length ? op.queue.shift() : null;
  }

  if (op.state === 'running' && op.stats.holdBlocked > 0 && inFlightKg(op) === 0) {
    requestStop(op, 'hold_full');
  }
  if (op.state === 'stopping' && op.lines.every((l) => l.phase === 'idle')) {
    op.state = 'ended';
    op.endT = t;
    op.end = { x: boat.x, y: boat.y };
  }
}

function setTana(op, line, r) {
  line.tana = r.tana;
  line.tanaSource = r.source;
  trackTana(op, r.tana, r.source);
}

function trackTana(op, tana, source) {
  op.stats.tanaMin = op.stats.tanaMin == null ? tana : Math.min(op.stats.tanaMin, tana);
  op.stats.tanaMax = op.stats.tanaMax == null ? tana : Math.max(op.stats.tanaMax, tana);
  op.stats.lastTanaSource = source;
}

/** Fish landed per minute over the last `window` game seconds. */
export function recentPace(op, t, window = 600) {
  let n = 0;
  let kg = 0;
  for (const l of op.landings) {
    if (t - l.t <= window) {
      n += l.n;
      kg += l.kg;
    }
  }
  const span = Math.min(window, Math.max(1, t - op.startT));
  return { n, kg, perMin: (n / span) * 60, span };
}

/** Human label for the current state of a line (for the HUD). */
export function linePhaseLabel(line) {
  if (line.waiting) return `手が空くのを待っている（${{ prep: '餌付け', unhook: '取り込み', retrieve: '巻上げ' }[line.phase] || line.phase}）`;
  switch (line.phase) {
    case 'prep':
      return '餌付け・準備';
    case 'drop':
      return `投入中 ${line.depth.toFixed(0)}m / タナ${line.tana.toFixed(0)}m`;
    case 'adjust':
      return `タナ調整 ${line.depth.toFixed(0)}m → ${line.target.toFixed(0)}m`;
    case 'fish': {
      const n = fishOnLine(line).length;
      return n ? `アタリ！追い食い待ち（${n}尾）` : `誘い中 タナ${line.tana.toFixed(0)}m`;
    }
    case 'retrieve':
      return `回収中 ${line.depth.toFixed(0)}m（${fishOnLine(line).length}尾）`;
    case 'unhook':
      return `取り込み（${fishOnLine(line).length}尾）`;
    case 'idle':
      return '仕掛け回収済み';
    default:
      return line.phase;
  }
}
