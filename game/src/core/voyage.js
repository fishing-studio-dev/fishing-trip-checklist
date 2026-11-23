// One voyage at sea: fixed-step simulation of world, boat, sounder and the
// automatic operation, plus the player's commands (decisions only).
import { SIM, TIME, PORT, BOATS, EQUIPMENT, METHODS } from './data.js';
import { createWorld } from './world.js';
import { createBoatRuntime, stepBoat, autopilotCommand, routeToPort } from './boat.js';
import { createObservation, pingColumn, pushColumn } from './sounder.js';
import { createOperation, stepOperation, requestStop } from './fishing.js';
import { depthAt, areaNameAt, currentAt, windAt, fmtClock } from './sea.js';
import { levelFromXp } from './progress.js';

export function createVoyage(profile, opts = {}) {
  const av = profile.activeVoyage;
  if (!av) throw new Error('createVoyage: profile has no active voyage');
  const model = BOATS[profile.boat.model];
  const world = createWorld(profile.worldSeed, av.day, TIME.DEPART, opts.scenario || null);
  const start = opts.start || { x: PORT.dock.x, y: PORT.dock.y + 20, heading: 0 };
  const sounderId = profile.boat.slots.helm_sounder?.itemId;
  const reelId = profile.boat.slots.starboard_reel?.itemId;
  const v = {
    id: av.id,
    day: av.day,
    world,
    modelId: model.id,
    boat: createBoatRuntime(model, start.x, start.y, start.heading || 0),
    equip: {
      sounderId,
      reelId,
      sounder: EQUIPMENT[sounderId].sounder,
      reel: EQUIPMENT[reelId].reel,
    },
    level: levelFromXp(profile.methods.handline.xp),
    obs: createObservation(),
    op: null,
    opSeq: 0,
    logs: [],
    hold: { counts: { s: 0, m: 0, l: 0 }, kg: 0, count: 0 },
    capacityKg: model.holdKg,
    track: [{ x: start.x, y: start.y, t: world.time }],
    events: [],
    eventSeq: 1,
    messages: [],
    msgSeq: 1,
    autopilot: null,
    after: null, // what to do when the current operation ends: 'redrift' | 'return'
    phase: 'sea', // 'sea' | 'docked'
    flags: { warned: false, dayEnd: false },
    opSeconds: 0,
    nextTrackT: world.time + SIM.TRACK_EVERY_S,
  };
  say(v, '出港しました。魚探を見ながら漁場を探してください。');
  return v;
}

export function say(v, text, level = 'info') {
  v.messages.push({ id: v.msgSeq++, t: v.world.time, text, level });
  if (v.messages.length > 50) v.messages.shift();
}

function emit(v, ev) {
  v.events.push({ id: v.eventSeq++, t: v.world.time, ...ev });
  if (v.events.length > 100) v.events.shift();
}

export function boatModel(v) {
  return BOATS[v.modelId];
}

export function isOperating(v) {
  return !!(v.op && v.op.state !== 'ended');
}

/**
 * Advance by an arbitrary amount of game time using fixed steps. The leftover
 * (< one step, or anything beyond maxSteps) is returned as carry so no game
 * time is ever lost; the UI passes a per-frame maxSteps to stay responsive.
 */
export function advanceVoyage(v, gameSeconds, carry = 0, maxSteps = Infinity) {
  let acc = carry + gameSeconds;
  let steps = 0;
  while (acc >= SIM.STEP - 1e-9 && steps < maxSteps) {
    stepVoyage(v);
    acc -= SIM.STEP;
    steps++;
  }
  return Math.max(0, acc);
}

/** Exactly one fixed simulation step. */
export function stepVoyage(v) {
  const dt = SIM.STEP;
  const w = v.world;
  const model = boatModel(v);
  w.time += dt;
  w.step += 1;

  if (v.phase === 'docked') {
    stepBoat(v.boat, model, w.cond, w.time, dt, 'docked');
    return;
  }

  // movement assistance
  if (v.autopilot && !isOperating(v)) runAutopilot(v, model);

  const mode = isOperating(v) ? 'drift' : 'manual';
  stepBoat(v.boat, model, w.cond, w.time, dt, mode);

  // sounder pings on a fixed schedule, regardless of what the UI shows
  if (w.step % SIM.PING_EVERY_STEPS === 0) {
    const col = pingColumn(w, v.boat.x, v.boat.y, v.equip.sounder, v.obs.pingCount);
    pushColumn(v.obs, col);
    if (isOperating(v)) {
      const st = v.op.stats;
      st.pings += 1;
      if (col.maxFish >= METHODS.handline.echoThreshold) {
        st.echoPings += 1;
        st.echoDepthSum += col.fishDepth || 0;
      }
      st.maxEcho = Math.max(st.maxEcho, col.maxFish);
    }
    maybeAutoMark(v, col);
  }

  if (v.op) {
    if (v.op.state !== 'ended') {
      stepOperation(
        v.op,
        {
          world: w,
          boat: v.boat,
          obs: v.obs,
          hold: v.hold,
          capacityKg: v.capacityKg,
          onLand: (fish) => landFish(v, fish),
        },
        dt,
      );
      v.opSeconds += dt;
    }
    if (v.op.state === 'ended') finishOperation(v);
  }

  if (w.time >= v.nextTrackT) {
    v.track.push({ x: v.boat.x, y: v.boat.y, t: w.time });
    if (v.track.length > 2000) v.track.shift();
    v.nextTrackT += SIM.TRACK_EVERY_S;
  }

  if (!v.flags.warned && w.time >= TIME.WARN) {
    v.flags.warned = true;
    say(v, `${fmtClock(TIME.WARN)}です。${fmtClock(TIME.END)}には帰港を始めます。`, 'warn');
  }
  if (!v.flags.dayEnd && w.time >= TIME.END) {
    v.flags.dayEnd = true;
    say(v, '日暮れが近いので帰港します。', 'warn');
    returnToPort(v, true);
  }
}

function landFish(v, fish) {
  for (const f of fish) {
    v.hold.counts[f.size] += 1;
    v.hold.kg += f.kg;
    v.hold.count += 1;
  }
  emit(v, { type: 'landed', fish: fish.map((f) => ({ size: f.size, kg: f.kg })) });
}

function maybeAutoMark(v, col) {
  const o = v.obs;
  if (col.maxFish < 0.5) return;
  const last = o.marks.filter((m) => m.kind === 'auto').slice(-1)[0];
  if (last && v.world.time - last.t < 90 && Math.hypot(last.x - col.x, last.y - col.y) < 120) return;
  o.marks.push({ id: o.markSeq++, kind: 'auto', x: col.x, y: col.y, t: col.t, depth: col.fishDepth, bottom: col.bottom });
  if (o.marks.length > 80) o.marks.shift();
}

export function addManualMark(v) {
  const o = v.obs;
  const col = o.cols[o.cols.length - 1];
  o.marks.push({ id: o.markSeq++, kind: 'manual', x: v.boat.x, y: v.boat.y, t: v.world.time, depth: col ? col.fishDepth : null, bottom: col ? col.bottom : null });
  if (o.marks.length > 80) o.marks.shift();
  say(v, `${fmtClock(v.world.time)} 現在地に印を付けました。`);
}

function runAutopilot(v, model) {
  const ap = v.autopilot;
  const target = ap.route[ap.leg];
  const isLast = ap.leg === ap.route.length - 1;
  const cmd = autopilotCommand(v.boat, model, target, isLast ? 140 : 60, isLast ? 15 : 40);
  if (cmd.arrived) {
    if (!isLast) {
      ap.leg += 1;
      return;
    }
    v.boat.throttle = 1;
    v.boat.rudder = 0;
    if (Math.abs(v.boat.speed) > 0.4) return; // wait until the boat has stopped
    v.autopilot = null;
    if (ap.kind === 'return') {
      v.phase = 'docked';
      v.boat.x = PORT.dock.x;
      v.boat.y = PORT.dock.y + 20;
      v.boat.speed = 0;
      say(v, '帰港しました。水揚げしましょう。');
    } else if (ap.kind === 'redrift') {
      const r = startOperation(v);
      if (!r.ok) say(v, r.reason, 'warn');
    }
    return;
  }
  v.boat.rudder = cmd.rudder;
  v.boat.throttle = cmd.throttle;
}

// ---------------------------------------------------------------------------
// Player commands (decisions). Each returns {ok, reason?}.

export function setHelm(v, { throttle, rudder }) {
  if (v.phase !== 'sea') return { ok: false, reason: '停泊中です。' };
  if (isOperating(v)) return { ok: false, reason: '操業中は船を流しています。動かすには「回収・終了」してください。' };
  if (v.autopilot) {
    if (v.flags.dayEnd && v.autopilot.kind === 'return') return { ok: false, reason: '帰港中です。' };
    const kind = v.autopilot.kind;
    v.autopilot = null;
    say(v, kind === 'return' ? '自動帰港を取り消しました。' : '流し直しの移動を取り消しました。');
  }
  const model = boatModel(v);
  if (throttle != null) v.boat.throttle = Math.max(0, Math.min(model.speeds.length - 1, throttle));
  if (rudder != null) v.boat.rudder = Math.max(-1, Math.min(1, rudder));
  return { ok: true };
}

export function canStartOperation(v) {
  if (v.phase !== 'sea') return { ok: false, reason: '海上でのみ操業できます。' };
  if (isOperating(v)) return { ok: false, reason: 'すでに操業中です。' };
  if (v.autopilot && v.autopilot.kind === 'return') return { ok: false, reason: '帰港中です。' };
  if (Math.hypot(v.boat.x - PORT.dock.x, v.boat.y - PORT.dock.y) < 300) return { ok: false, reason: '港の中では操業できません。' };
  if (Math.abs(v.boat.speed) > METHODS.handline.maxStartSpeed) return { ok: false, reason: '船を止めてから操業を始めます（停止まで減速）。' };
  if (!v.obs.cols.length) return { ok: false, reason: '魚探の反応を待っています。' };
  const depth = depthAt(v.boat.x, v.boat.y);
  if (depth < 6) return { ok: false, reason: '浅すぎて一本釣りの仕掛けを流せません。' };
  return { ok: true };
}

export function startOperation(v) {
  const c = canStartOperation(v);
  if (!c.ok) return c;
  v.autopilot = null;
  v.boat.throttle = 1;
  v.boat.rudder = 0;
  v.opSeq += 1;
  v.op = createOperation({
    id: `${v.id}-op${v.opSeq}`,
    voyageId: v.id,
    methodId: 'handline',
    level: v.level,
    reel: v.equip.reel,
    reelId: v.equip.reelId,
    startT: v.world.time,
    x: v.boat.x,
    y: v.boat.y,
  });
  v.op.startConditions = conditionsSnapshot(v);
  const depth = depthAt(v.boat.x, v.boat.y);
  if (depth > v.equip.reel.maxDepth) say(v, `水深${depth.toFixed(0)}mはリールの対応水深${v.equip.reel.maxDepth}mを超えています。届く深さまでで操業します。`, 'warn');
  say(v, `${fmtClock(v.world.time)} 操業開始（${areaNameAt(v.boat.x, v.boat.y)}・水深${depth.toFixed(0)}m）。投入から回収まで自動で行います。`);
  return { ok: true };
}

export function stopOperation(v, reason = 'player') {
  if (!isOperating(v)) return { ok: false, reason: '操業していません。' };
  if (v.op.state === 'stopping') return { ok: false, reason: '回収中です。' };
  requestStop(v.op, reason);
  say(v, '仕掛けを回収しています…');
  return { ok: true };
}

/** 流し直し: retrieve, run back up to where this drift started, and start again. */
export function redrift(v) {
  if (isOperating(v)) {
    if (v.op.state === 'running') requestStop(v.op, 'redrift');
    v.after = 'redrift';
    v.redriftTarget = { ...v.op.start };
    say(v, '回収して、流し始めた地点へ戻ります。');
    return { ok: true };
  }
  const last = v.logs[v.logs.length - 1];
  if (!last) return { ok: false, reason: 'まだ流した地点がありません。' };
  v.autopilot = { kind: 'redrift', route: [{ ...last.start }], leg: 0 };
  say(v, '前回流し始めた地点へ戻ります。');
  return { ok: true };
}

export function returnToPort(v, forced = false) {
  if (v.phase !== 'sea') return { ok: false, reason: 'すでに港にいます。' };
  if (isOperating(v)) {
    if (v.op.state === 'running') requestStop(v.op, forced ? 'day_end' : 'return');
    v.after = 'return';
    say(v, '回収してから帰港します。');
    return { ok: true };
  }
  v.autopilot = { kind: 'return', route: routeToPort(v.boat), leg: 0 };
  if (!forced) say(v, '港へ向かいます（移動補助）。操船するといつでも取り消せます。');
  return { ok: true };
}

export function nearPort(v) {
  return Math.hypot(v.boat.x - PORT.entrance.x, v.boat.y - PORT.entrance.y) < PORT.approachRadius;
}

function finishOperation(v) {
  const op = v.op;
  const log = makeOperationLog(v, op);
  v.logs.push(log);
  v.op = null;
  const mins = Math.round(log.durationS / 60);
  say(v, `操業終了：${mins}分で${log.count}尾（${log.kg.toFixed(1)}kg）。${endReasonText(log.endReason)}`);
  emit(v, { type: 'opEnded', logId: log.id });
  const after = v.after;
  v.after = null;
  if (log.endReason === 'hold_full') {
    say(v, '魚倉が満杯です。帰港して水揚げしましょう。', 'warn');
  }
  if (after === 'redrift') {
    v.autopilot = { kind: 'redrift', route: [v.redriftTarget], leg: 0 };
  } else if (after === 'return') {
    v.autopilot = { kind: 'return', route: routeToPort(v.boat), leg: 0 };
  }
}

export function endReasonText(r) {
  return (
    {
      player: '',
      redrift: '流し直します。',
      return: '帰港します。',
      day_end: '時間切れで終了。',
      hold_full: '魚倉が満杯になりました。',
    }[r] || ''
  );
}

export function conditionsSnapshot(v) {
  const t = v.world.time;
  const c = currentAt(v.world.cond, t);
  const w = windAt(v.world.cond, t);
  return {
    t,
    tideName: v.world.cond.tideName,
    current: { x: round2(c.x), y: round2(c.y), speed: round2(Math.hypot(c.x, c.y)) },
    wind: { x: round2(w.x), y: round2(w.y), speed: round2(Math.hypot(w.x, w.y)) },
    waterTemp: v.world.cond.waterTemp,
  };
}

function round2(x) {
  return Math.round(x * 100) / 100;
}

function makeOperationLog(v, op) {
  const st = op.stats;
  return {
    id: op.id,
    voyageId: v.id,
    day: v.day,
    methodId: op.methodId,
    startT: op.startT,
    endT: op.endT,
    durationS: Math.round(op.endT - op.startT),
    start: { x: Math.round(op.start.x), y: Math.round(op.start.y) },
    end: { x: Math.round(op.end.x), y: Math.round(op.end.y) },
    area: areaNameAt(op.start.x, op.start.y),
    bottom: { min: round1(st.bottomMin), max: round1(st.bottomMax) },
    tana: { min: round1(st.tanaMin), max: round1(st.tanaMax) },
    catches: { ...op.landed },
    count: op.landedCount,
    kg: Math.round(op.landedKg * 100) / 100,
    endReason: op.endReason,
    conditions: op.startConditions,
    sounder: {
      pings: st.pings,
      echoRatio: st.pings ? Math.round((st.echoPings / st.pings) * 100) / 100 : 0,
      maxEcho: Math.round(st.maxEcho * 100) / 100,
      echoDepth: st.echoPings ? round1(st.echoDepthSum / st.echoPings) : null,
    },
    gear: { boat: v.modelId, sounder: v.equip.sounderId, reel: v.equip.reelId },
    level: op.level,
  };
}

function round1(x) {
  return x == null ? null : Math.round(x * 10) / 10;
}

/** Everything settlement needs from a finished voyage. */
export function summarizeVoyage(v) {
  return {
    id: v.id,
    day: v.day,
    hold: { counts: { ...v.hold.counts }, kg: Math.round(v.hold.kg * 100) / 100, count: v.hold.count },
    logs: v.logs.map((l) => ({ ...l })),
    distanceM: Math.round(v.boat.distance),
    opSeconds: Math.round(v.opSeconds),
  };
}
