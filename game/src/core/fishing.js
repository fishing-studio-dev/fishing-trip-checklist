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
import { densityAt, posesAt, takeFish, returnFish, activityAt } from './world.js';
import { depthAt, bottomIsRocky } from './sea.js';
import { readTana } from './sounder.js';
import { rngNext } from './rng.js';
import { initHands, fillHands, takeHands, releaseHands } from './hands.js';

export function maxFishKg(species) {
  if (Array.isArray(species)) return Math.max(...species.map(maxFishKg));
  return Math.max(...Object.values(SPECIES[species].sizes).map((s) => s.kg));
}

/** The species a hook-and-line method fishes for (one, or the 根魚 group). */
export function methodSpecies(method) {
  return method.targets || method.target;
}

/** Depth of hook k for a sinker at `tana` (hooks above the sinker). */
function hookDepthOf(method, tana, k) {
  return tana - (method.firstHook != null ? method.firstHook : 1.0) - k * method.hookSpacing;
}

/** The tana read from the sounder; with no echo, methods that fish mid water use their share of the depth. */
function readMethodTana(obs, method, maxDepth, bottom) {
  const r = readTana(obs, method, maxDepth);
  if (r.tana != null && r.source === 'bottom' && method.defaultFrac) r.tana = Math.min(maxDepth, bottom * method.defaultFrac + 1, bottom - 2);
  return r;
}

/** Where the sinker sits when it is kept just off the bottom (根魚釣り). */
function bottomTana(method, bottom, maxDepth) {
  return Math.max(1, Math.min(maxDepth, bottom - method.bottomLift));
}

/**
 * rigs: one per fitted reel, e.g. [{label:'右舷', reelId, reel}, {label:'左舷', ...}].
 * One fisher works all rigs: baiting, unhooking and hand-cranking need their
 * hands, so with two rigs those steps take turns (op.worker). Dropping,
 * waiting for bites and electric retrieval do not.
 */
export function createOperation({ id, voyageId, methodId, level, rigs, startT, x, y, hands = 1 }) {
  const method = METHODS[methodId];
  const skill = skillForLevel(level);
  const lines = rigs.map((r) => newLine(method, skill, r));
  const op = {
    id,
    voyageId,
    methodId,
    species: method.target,
    level,
    reelId: rigs[0].reelId,
    retrieveSpeed: lines[0].retrieveSpeed,
    maxDepth: lines[0].maxDepth,
    skill,
    state: 'running',
    endReason: null,
    startT,
    endT: null,
    start: { x, y },
    end: null,
    lines,
    landed: { s: 0, m: 0, l: 0 },
    landedBy: {}, // per species when the method fishes several (根魚): {kasago: {s, m, l}}
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
      snags: 0,
      lostFish: 0,
      baits: 0, // live baits put on (泳がせ: one アジ each)
      baitSwaps: 0, // tired baits changed without a bite
    },
  };
  initHands(op, hands);
  return op;
}

function newLine(method, skill, rig) {
  const hand = rig.reel.retrieve == null;
  return {
    label: rig.label,
    reelId: rig.reelId,
    handReel: hand,
    bottomMode: !!method.bottomMode,
    liveBait: !!method.liveBait,
    snagAcc: 0,
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
  return line.phase === 'prep' || line.phase === 'unhook' || line.phase === 'snag' || line.phase === 'fight' || (line.phase === 'retrieve' && line.handReel);
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
  const targets = methodSpecies(method);
  const maxKg = maxFishKg(targets);
  const { world, boat } = ctx;
  const t = world.time;
  const bottom = depthAt(boat.x, boat.y);
  op.stats.bottomMin = op.stats.bottomMin == null ? bottom : Math.min(op.stats.bottomMin, bottom);
  op.stats.bottomMax = op.stats.bottomMax == null ? bottom : Math.max(op.stats.bottomMax, bottom);
  let poses = null;
  const stopping = op.state === 'stopping';
  fillHands(op);

  for (let li = 0; li < op.lines.length; li++) {
    const line = op.lines[li];
    if (stopping && line.phase === 'prep') line.phase = 'idle';
    // the hands on deck: the steps that need them take turns when all hands are busy
    if (handlineNeedsHands(line) && !takeHands(op, li)) {
      line.waiting = true;
      continue;
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
          if (method.liveBait) {
            // 泳がせ: a live アジ from the hold goes on the hook; none left → nothing to fish with
            if (!ctx.takeBait || !ctx.takeBait(method.liveBait)) {
              line.phase = 'idle';
              op.noBait = true;
              break;
            }
            op.stats.baits += 1;
            line.baitT = 0;
          }
          if (method.bottomMode) {
            // 根魚釣り: down to the bottom, then the sinker is kept just off it
            setTana(op, line, { tana: bottomTana(method, bottom, line.maxDepth), source: 'bottom' });
            line.phase = 'drop';
            break;
          }
          const r = readMethodTana(ctx.obs, method, line.maxDepth, bottom);
          if (r.tana == null) break; // no sounder reading yet
          setTana(op, line, r);
          line.phase = 'drop';
        }
        break;
      }
      case 'fight': {
        // やり取り: a big fish is played (hands busy) before it can be wound up
        line.timer -= dt;
        if (line.timer <= 0) line.phase = 'retrieve';
        break;
      }
      case 'snag': {
        // 根掛かり: the line is cut and a new rig tied on (hands needed)
        line.timer -= dt;
        if (line.timer <= 0) {
          if (stopping) line.phase = 'idle';
          else {
            line.phase = 'prep';
            line.timer = op.skill.rebait;
          }
        }
        break;
      }
      case 'drop': {
        if (stopping) {
          line.phase = 'retrieve';
          break;
        }
        line.tana = method.bottomMode ? bottomTana(method, bottom, line.maxDepth) : Math.min(line.tana, bottom - 0.5, line.maxDepth);
        line.depth += op.skill.dropSpeed * dt;
        if (line.depth >= line.tana) {
          line.depth = line.tana;
          line.phase = 'fish';
          line.sinceRetune = 0;
          for (const h of line.hooks) h.acc = rngNext(world.rng) * 0.6;
          if (method.bottomMode && !line.snagSeeded) {
            // where in the snag cycle this rig starts (once; it carries over between drops)
            line.snagAcc = rngNext(world.rng) * 0.6;
            line.snagSeeded = true;
          }
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
        if (method.bottomMode) {
          // 底取り: the rig follows the bottom up and down as the boat drifts over the rocks
          line.tana = bottomTana(method, bottom, line.maxDepth);
          line.depth = line.tana;
          trackTana(op, line.tana, 'bottom');
          // 根掛かり on hard bottom (only when the sinker is down near it)
          if (!stopping && line.tana >= bottom - method.bottomLift - 0.05 && bottomIsRocky(boat.x, boat.y)) {
            line.snagAcc = (line.snagAcc || 0) + method.snagRate * op.skill.snagMul * dt;
            if (line.snagAcc >= 1) {
              line.snagAcc = 0;
              for (const h of line.hooks) {
                if (h.fish) {
                  returnFish(world, h.fish); // the fish on the hooks are lost with the rig
                  op.stats.lostFish += 1;
                  h.fish = null;
                }
              }
              line.firstBiteT = null;
              op.stats.snags += 1;
              line.depth = 0;
              line.phase = 'snag';
              line.timer = op.skill.rerig;
              break;
            }
          }
        } else if (line.tana > bottom - 0.5) {
          // the sinker follows the bottom when the boat drifts over shallower ground
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
          const hookDepth = hookDepthOf(method, line.tana, k);
          if (hookDepth < 0.5) continue;
          const d = densityAt(world, boat.x, boat.y, hookDepth, poses, targets);
          if (d.total <= 0 || d.best == null) continue;
          const act = activityAt(world, world.schools[d.best], t);
          const lambda = method.biteRateMax * act * (d.total / (d.total + method.densityHalf));
          h.acc += lambda * dt;
          if (h.acc >= 1) {
            const room = ctx.capacityKg - ctx.hold.kg - inFlightKg(op) - (ctx.reservedKg || 0);
            if (room < maxKg) {
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
            (op.biteTimes || (op.biteTimes = [])).push(t);
            if (op.biteTimes.length > 400) op.biteTimes.shift();
            if (line.firstBiteT == null) line.firstBiteT = t;
          }
        }
        if (stopping) {
          line.phase = 'retrieve';
          break;
        }
        if (anyFish && method.fight) {
          const kg = fishOnLine(line).reduce((a, f) => a + f.kg, 0);
          line.phase = 'fight';
          line.timer = op.skill.fight * Math.sqrt(kg / 6);
          break;
        }
        if (anyFish && (allFull || t - line.firstBiteT >= method.oiWait)) {
          line.phase = 'retrieve';
          break;
        }
        if (method.liveBait && !anyFish) {
          // a live bait tires: change it for a fresh one after a while
          line.baitT = (line.baitT || 0) + dt;
          if (line.baitT >= method.baitLife) {
            op.stats.baitSwaps += 1;
            line.phase = 'retrieve';
            break;
          }
        }
        if (!anyFish) {
          line.sinceRetune += dt;
          if (line.sinceRetune >= method.retuneAfter) {
            line.sinceRetune = 0;
            const r = readMethodTana(ctx.obs, method, line.maxDepth, bottom);
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
              if (!op.landedBy[f.species]) op.landedBy[f.species] = { s: 0, m: 0, l: 0 };
              op.landedBy[f.species][f.size] += 1;
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
    // just stepped into a hand job: take hands if free, otherwise wait in turn; done: pass them on
    if (handlineNeedsHands(line)) {
      if (!takeHands(op, li)) line.waiting = true;
    } else releaseHands(op, li);
  }

  if (op.state === 'running' && op.stats.holdBlocked > 0 && inFlightKg(op) === 0) {
    requestStop(op, 'hold_full');
  }
  if (op.state === 'running' && op.noBait && op.lines.every((l) => l.phase === 'idle')) {
    requestStop(op, 'no_bait');
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
  if (line.waiting) return `手が空くのを待っている（${{ prep: '餌付け', unhook: '取り込み', retrieve: '巻上げ', snag: '仕掛けの付け直し', fight: 'やり取り' }[line.phase] || line.phase}）`;
  switch (line.phase) {
    case 'prep':
      return line.liveBait ? '活きアジを針に付ける' : '餌付け・準備';
    case 'drop':
      return `投入中 ${line.depth.toFixed(0)}m / タナ${line.tana.toFixed(0)}m`;
    case 'adjust':
      return `タナ調整 ${line.depth.toFixed(0)}m → ${line.target.toFixed(0)}m`;
    case 'fish': {
      const n = fishOnLine(line).length;
      if (line.bottomMode) return n ? `掛かった！根から引き離す（${n}尾）` : `底を切って待つ 水深${line.tana.toFixed(0)}m`;
      if (line.liveBait) return `活きアジを泳がせて待つ タナ${line.tana.toFixed(0)}m（エサ${Math.floor((line.baitT || 0) / 60)}分）`;
      return n ? `アタリ！追い食い待ち（${n}尾）` : `誘い中 タナ${line.tana.toFixed(0)}m`;
    }
    case 'snag':
      return '根掛かり：糸を切って仕掛けを付け直し';
    case 'fight':
      return `掛かった！やり取り中（${fishOnLine(line).map((f) => f.kg.toFixed(0)).join('・')}kg級）`;
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
