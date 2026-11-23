// One voyage at sea: fixed-step simulation of world, boat, sounder and the
// automatic operation (一本釣り, 曳縄 or 延縄), plus the player's commands. The
// player decides where, which method, which route, when to move or stop; the
// repetitive work is automatic.
import { SIM, TIME, PORT, BOATS, EQUIPMENT, METHODS, SPECIES, CREW } from './data.js';
import { createWorld, normalizeSchool, schoolCenter, schoolTotal, takeFish } from './world.js';
import { createBoatRuntime, stepBoat, autopilotCommand, routeToPort, clearPath } from './boat.js';
import { createObservation, pingColumn, pushColumn } from './sounder.js';
import { sideColumn } from './sideview.js';
import { MARK_KINDS, MARK_LIMITS, cleanText, newVoyageMark, pushVoyageMark, bearingOf } from './marks.js';
import { surfaceCues, visibleCues, cueDistance } from './surface.js';
import { recordDepth } from './bathy.js';
import { createSonar, stepSonar } from './sonar.js';
import { createOperation, stepOperation, requestStop, inFlightKg } from './fishing.js';
import { createTrollOperation, stepTrollOperation, trollTargetSpeed, validateRoute, defaultRoute, routeLength, trollInFlightKg } from './troll.js';
import {
  createLonglineSet,
  createSetOperation,
  createHaulOperation,
  stepLonglineOperation,
  soakLongline,
  setInWater,
  hookedKg,
  nearestBuoy,
  validateLineRoute,
  longlineTargetSpeed,
  longlineHelmTarget,
} from './longline.js';
import { depthAt, areaNameAt, currentAt, windAt, fmtClock, bottomIsRocky, visibilityAt } from './sea.js';
import { levelFromXp } from './progress.js';
import { radioReports, peerName } from './reports.js';
import { logTags } from './knowledge.js';

export const MAX_ROUTE_POINTS = 6;

function emptyHold() {
  const counts = {};
  for (const sp of Object.keys(SPECIES)) counts[sp] = { s: 0, m: 0, l: 0 };
  return { counts, kg: 0, count: 0 };
}

export function createVoyage(profile, opts = {}) {
  const av = profile.activeVoyage;
  if (!av) throw new Error('createVoyage: profile has no active voyage');
  const model = BOATS[profile.boat.model];
  // an evening trip (イカ釣り) leaves at 16:00 and is home by 23:00
  const night = !!(opts.night != null ? opts.night : av.night);
  const world = createWorld(profile.worldSeed, av.day, night ? TIME.NIGHT.DEPART : TIME.DEPART, opts.scenario || null);
  const start = opts.start || { x: PORT.dock.x, y: PORT.dock.y + 20, heading: 0 };
  const slot = (id) => (profile.boat.slots[id] ? profile.boat.slots[id].itemId : null);
  const sounderId = slot('helm_sounder');
  // one handline rig per fitted reel (中型漁船 has two stations)
  const rigs = model.slots
    .filter((sl) => sl.rig && profile.boat.slots[sl.id] && EQUIPMENT[slot(sl.id)].type === 'reel')
    .map((sl) => ({ slotId: sl.id, label: sl.rig, reelId: slot(sl.id), reel: EQUIPMENT[slot(sl.id)].reel }));
  const reelId = rigs[0].reelId;
  const ofType = (type) => model.slots.map((sl) => slot(sl.id)).find((id) => id && EQUIPMENT[id].type === type) || null;
  const trollId = ofType('troll');
  const longlineId = ofType('longline');
  const haulerId = ofType('hauler');
  const sonarId = ofType('sonar');
  const lightsId = ofType('lights');
  // the peers' radio calls are in the morning: nobody hears them on an evening trip
  const radio = opts.radio !== undefined ? opts.radio : opts.scenario || night ? [] : radioReports(profile.worldSeed, av.day);
  const v = {
    id: av.id,
    day: av.day,
    world,
    modelId: model.id,
    boat: createBoatRuntime(model, start.x, start.y, start.heading || 0),
    equip: {
      sounderId,
      reelId,
      rigs,
      trollId,
      sounder: EQUIPMENT[sounderId].sounder,
      reel: EQUIPMENT[reelId].reel,
      troll: trollId ? EQUIPMENT[trollId].troll : null,
      longlineId,
      longline: longlineId ? EQUIPMENT[longlineId].longline : null,
      haulerId,
      hauler: haulerId ? EQUIPMENT[haulerId].hauler : null,
      sonarId,
      lightsId,
      lights: lightsId ? EQUIPMENT[lightsId].lights : null,
    },
    sonar: sonarId ? createSonar(EQUIPMENT[sonarId].sonar) : null,
    night,
    warnT: night ? TIME.NIGHT.WARN : TIME.WARN,
    endT: night ? TIME.NIGHT.END : TIME.END,
    levels: Object.fromEntries(Object.keys(METHODS).map((m) => [m, levelFromXp((profile.methods[m] || { xp: 0 }).xp)])),
    method: opts.method || planMethod(av.plan, { troll: trollId, longline: longlineId, lights: lightsId }),
    plan: av.plan || null,
    plannedRoute: [],
    obs: createObservation(),
    op: null,
    opSeq: 0,
    line: null, // the longline (延縄): lives here while it soaks, also when no operation runs
    lineSeq: 0,
    crew: opts.crew != null ? (opts.crew ? 1 : 0) : av.crew ? 1 : 0, // a hired deckhand on board
    bathy: { cells: {} }, // depths measured on this voyage by a mapping sounder (merged at landing)

    logs: [],
    hold: emptyHold(),
    capacityKg: model.holdKg,
    track: [{ x: start.x, y: start.y, t: world.time }],
    events: [],
    eventSeq: 1,
    messages: [],
    msgSeq: 1,
    radio: radio.map((r) => ({ ...r, delivered: false })),
    heard: [],
    autopilot: null,
    after: null, // what to do when the current operation ends: 'redrift' | 'return'
    phase: 'sea', // 'sea' | 'docked'
    flags: { warned: false, dayEnd: false },
    opSeconds: 0,
    nextTrackT: world.time + SIM.TRACK_EVERY_S,
  };
  say(v, v.plan ? `出港しました。今日の狙い：${v.plan.label}（根拠：${v.plan.basis}）` : '出港しました。魚探を見ながら漁場を探してください。');
  return v;
}

function planMethod(plan, gear) {
  const m = plan && plan.methodId;
  if (m === 'troll' && gear.troll) return 'troll';
  if (m === 'longline' && gear.longline) return 'longline';
  if (m === 'negyo' || m === 'oyogase') return m; // the reels are always on board (泳がせ needs アジ in the hold)
  if (m === 'ika' && gear.lights) return 'ika';
  return 'handline';
}

export function say(v, text, level = 'info') {
  v.messages.push({ id: v.msgSeq++, t: v.world.time, text, level });
  if (v.messages.length > 60) v.messages.shift();
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

export function isTrolling(v) {
  return isOperating(v) && v.op.methodId === 'troll';
}

export function isLonglining(v) {
  return isOperating(v) && v.op.methodId === 'longline';
}

/** The longline is in the water (being set, soaking or being hauled). */
export function lineInWater(v) {
  return setInWater(v.line);
}

/** What the hold can still take, counting every fish already hooked anywhere. */
export function roomKg(v) {
  let busy = hookedKg(v.line);
  if (isOperating(v)) {
    if (METHODS[v.op.methodId].drift) busy += inFlightKg(v.op);
    else if (v.op.methodId === 'troll') busy += trollInFlightKg(v.op);
  }
  return v.capacityKg - v.hold.kg - busy;
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

  // helm: movement assistance, or the trolling route / longline, or the player's hands
  if (isTrolling(v)) runTrollHelm(v, model);
  else if (isLonglining(v)) runLonglineHelm(v, model);
  else {
    v.boat.speedOverride = null;
    if (v.autopilot && !isOperating(v)) runAutopilot(v, model);
  }

  const mode = isOperating(v) && METHODS[v.op.methodId].drift ? (METHODS[v.op.methodId].lights ? 'anchor' : 'drift') : 'manual';
  stepBoat(v.boat, model, w.cond, w.time, dt, mode);

  // the sonar turns one bearing per step (display only; it reads the world, never changes it)
  if (v.sonar) stepSonar(v.sonar, w, v.boat);

  // sounder pings on a fixed schedule, regardless of what the UI shows
  if (w.step % SIM.PING_EVERY_STEPS === 0) {
    const col = pingColumn(w, v.boat.x, v.boat.y, v.equip.sounder, v.obs.pingCount);
    pushColumn(v.obs, col);
    // a mapping sounder: the strip to port and starboard, and the depths it measured
    if (v.equip.sounder.side) {
      const side = sideColumn(w, v.boat.x, v.boat.y, v.boat.heading, v.equip.sounder, v.obs.pingCount);
      if (!v.obs.side) v.obs.side = [];
      // where each line was taken, so a tap on the picture can be put back on the chart
      v.obs.side.push({ t: side.t, vals: side.vals, x: Math.round(v.boat.x * 10) / 10, y: Math.round(v.boat.y * 10) / 10, h: Math.round(v.boat.heading * 1000) / 1000 });
      if (v.obs.side.length > 240) v.obs.side.shift();
      if (v.equip.sounder.mapping) {
        recordDepth(v.bathy.cells, v.boat.x, v.boat.y, col.bottomCenter);
        side.depths.forEach((d, k) => {
          if (k % 2 === 0) recordDepth(v.bathy.cells, v.boat.x + Math.cos(v.boat.heading) * side.offsets[k], v.boat.y - Math.sin(v.boat.heading) * side.offsets[k], d);
        });
      }
    }
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

  // the longline's hooks fish on a fixed game-time cadence wherever the boat is
  const soakEvery = METHODS.longline.soakEvery;
  if (setInWater(v.line) && w.step % Math.round(soakEvery / SIM.STEP) === 0) {
    soakLongline(v.line, { world: w, roomKg: () => roomKg(v) }, soakEvery);
  }

  if (v.op) {
    if (v.op.state !== 'ended') {
      const ctx = { world: w, boat: v.boat, obs: v.obs, hold: v.hold, capacityKg: v.capacityKg, reservedKg: hookedKg(v.line), onLand: (fish) => landFish(v, fish), takeBait: (sp) => takeLiveBait(v, sp) };
      if (v.op.methodId === 'troll') stepTrollOperation(v.op, ctx, dt);
      else if (v.op.methodId === 'longline') stepLonglineOperation(v.op, v.line, ctx, dt);
      else stepOperation(v.op, ctx, dt);
      v.opSeconds += dt;
      // イカ釣り: the squid drawn in follow the lit boat; every 10 s more come in from the water around
      if (METHODS[v.op.methodId].lights && v.op.state !== 'ended') {
        for (const s of w.schools) if (s.light && s.opId === v.op.id) s.a = s.b = { x: v.boat.x, y: v.boat.y };
        if (v.op.state === 'running' && w.step % 100 === 0) gatherSquid(v);
      }
      // 根魚釣り: tell once per drift when the boat has drifted off the rocks (the sounder's bottom echo thins)
      if (v.op.methodId === 'negyo' && v.op.state === 'running' && w.step % 10 === 0) {
        const rock = bottomIsRocky(v.boat.x, v.boat.y);
        if (rock) v.op.wasOnRock = true;
        else if (v.op.wasOnRock && !v.op.offRockSaid) {
          v.op.offRockSaid = true;
          say(v, '底が岩から砂地に変わりました（魚探の底の反応が薄くなった）。根から外れたら R で流し直し。');
        }
      }
    }
    if (v.op.state === 'ended') finishOperation(v);
  }

  // the lookout: signs on the surface (鳥山・ナブラ・潮目) are called out when they come into sight
  if (w.step % 100 === 0) lookout(v);

  // radio calls from peers become known when they are made
  for (const r of v.radio) {
    if (r.delivered || w.time < r.deliverAt) continue;
    r.delivered = true;
    const heard = { ...r, acqDay: v.day, acqT: w.time };
    delete heard.delivered;
    delete heard.deliverAt;
    v.heard.push(heard);
    say(v, `無線（${peerName(r.speaker)}・${fmtClock(r.obsT)}の話）：${r.text}`, 'radio');
    emit(v, { type: 'radio', reportId: r.id });
  }

  if (w.time >= v.nextTrackT) {
    v.track.push({ x: v.boat.x, y: v.boat.y, t: w.time });
    if (v.track.length > 2000) v.track.shift();
    v.nextTrackT += SIM.TRACK_EVERY_S;
  }

  if (!v.flags.warned && w.time >= (v.warnT || TIME.WARN)) {
    v.flags.warned = true;
    say(v, `${fmtClock(v.warnT || TIME.WARN)}です。${fmtClock(v.endT || TIME.END)}には帰港を始めます。`, 'warn');
  }
  if (!v.flags.dayEnd && w.time >= (v.endT || TIME.END)) {
    v.flags.dayEnd = true;
    say(v, v.night ? '夜も更けたので帰港します。' : '日暮れが近いので帰港します。', 'warn');
    returnToPort(v, true);
  }
}

/** The school of squid gathered under this operation's light (one per species). */
function lightSchool(v, species) {
  const id = `LIGHT-${v.op.id}-${species}`;
  let s = v.world.schools.find((x) => x.id === id);
  if (!s) {
    s = normalizeSchool({ id, species, light: true, opId: v.op.id, habitat: 'light', area: areaNameAt(v.boat.x, v.boat.y), a: { x: v.boat.x, y: v.boat.y }, counts: { s: 0, m: 0, l: 0 }, sigmaH: 25, sigmaZ: 5, orbitR: 0, noiseSeed: 7 });
    v.world.schools.push(s);
  }
  return s;
}

/**
 * 集魚灯: once it is dark, squid from the water around are drawn in under the
 * boat — taken from their school one by one (expected numbers accumulate with
 * game time), so the light never makes squid out of nothing.
 */
function gatherSquid(v) {
  const w = v.world;
  const m = METHODS.ika;
  const dark = Math.max(0, Math.min(1, (w.time / 3600 - 17.3) / 1.2));
  const power = v.equip.lights ? v.equip.lights.power : 0;
  if (dark <= 0 || power <= 0) return;
  if (!v.op.gatherAcc) v.op.gatherAcc = {};
  for (let i = 0; i < w.schools.length; i++) {
    const s = w.schools[i];
    if (s.light || SPECIES[s.species].habit !== 'squid' || schoolTotal(s) <= 0) continue;
    const c = schoolCenter(s, w.time);
    const reach = s.sigmaH + m.gatherReach;
    const d = Math.hypot(c.x - v.boat.x, c.y - v.boat.y);
    const wgt = Math.exp(-(d * d) / (2 * reach * reach));
    if (wgt < 0.01) continue;
    let acc = (v.op.gatherAcc[s.id] || 0) + m.gatherRate * 10 * schoolTotal(s) * wgt * dark * power;
    while (acc >= 1 && schoolTotal(s) > 0) {
      const f = takeFish(w, i);
      if (!f) break;
      lightSchool(v, s.species).counts[f.size] += 1;
      v.op.stats.gathered = (v.op.stats.gathered || 0) + 1;
      acc -= 1;
    }
    v.op.gatherAcc[s.id] = acc;
  }
}

/** Call out surface signs that have just come into sight (once per sighting, again after 30 min). */
function lookout(v) {
  if (!v.seenCues) v.seenCues = {};
  const t = v.world.time;
  const vis = visibilityAt(v.world.cond, t); // in fog only what is close can be seen
  for (const c of visibleCues(surfaceCues(v.world, t), v.boat.x, v.boat.y).filter((x) => cueDistance(x, v.boat.x, v.boat.y) <= vis)) {
    const last = v.seenCues[c.id];
    v.seenCues[c.id] = t;
    if (last != null && t - last < 1800) continue;
    const d = cueDistance(c, v.boat.x, v.boat.y);
    const where = d < 60 ? 'すぐそば' : `${bearingOf(v.boat, c).name}・約${Math.round(d / 50) * 50}m`;
    const what = c.kind === 'birds' ? '鳥山が見えます' : c.kind === 'nabura' ? 'ナブラ（魚が水面で小魚を追っている）が見えます' : `潮目が出ています（${c.name}）`;
    say(v, `${what}（${where}）。`, 'sight');
    emit(v, { type: 'sighting', kind: c.kind, x: c.x, y: c.y });
  }
}

/** How many fish of a species are in the hold (live bait for 泳がせ). */
export function baitInHold(v, species) {
  const c = v.hold.counts[species];
  return c ? c.s + c.m + c.l : 0;
}

/** Take one fish from the hold as live bait (smallest first). Recorded so settlement stays consistent. */
function takeLiveBait(v, species) {
  const c = v.hold.counts[species];
  if (!c) return false;
  const size = SPECIES[species].sizeOrder.find((k) => c[k] > 0);
  if (!size) return false;
  c[size] -= 1;
  v.hold.count -= 1;
  v.hold.kg = Math.max(0, v.hold.kg - SPECIES[species].sizes[size].kg);
  if (!v.baitUsed) v.baitUsed = {};
  if (!v.baitUsed[species]) v.baitUsed[species] = { s: 0, m: 0, l: 0 };
  v.baitUsed[species][size] += 1;
  return true;
}

function landFish(v, fish) {
  for (const f of fish) {
    v.hold.counts[f.species][f.size] += 1;
    v.hold.kg += f.kg;
    v.hold.count += 1;
  }
  emit(v, { type: 'landed', fish: fish.map((f) => ({ species: f.species, size: f.size, kg: f.kg })) });
}

function maybeAutoMark(v, col) {
  const o = v.obs;
  if (col.maxFish < 0.5) return;
  const last = o.marks.filter((m) => m.kind === 'auto').slice(-1)[0];
  if (last && v.world.time - last.t < 90 && Math.hypot(last.x - col.x, last.y - col.y) < 120) return;
  pushVoyageMark(o, { id: o.markSeq++, kind: 'auto', x: col.x, y: col.y, t: col.t, depth: col.fishDepth, bottom: col.bottom });
}

/** Next sonar range (the old picture was drawn at another scale, so it is cleared). */
export function cycleSonarRange(v) {
  const sn = v.sonar;
  if (!sn) return null;
  sn.range = sn.ranges[(sn.ranges.indexOf(sn.range) + 1) % sn.ranges.length];
  sn.data.fill(0);
  return sn.range;
}

/**
 * A mark at a chosen point: a sonar echo, a side-view echo or a past sounder
 * column (the boat has moved on since). The depths are what the instruments
 * showed — the bottom there, and the echo depth when the player picked one.
 */
export function addMarkAt(v, x, y, kind = 'manual', { echo = null, bottom = null } = {}) {
  const o = v.obs;
  const m = newVoyageMark(o, MARK_KINDS[kind] ? kind : 'manual', x, y, v.world.time, { echo, bottom });
  pushVoyageMark(o, m);
  say(v, `${(MARK_KINDS[m.kind] || MARK_KINDS.manual).label}の位置に印を付けました。`);
  return m;
}

/** M: a mark where the boat is now, with what the sounder shows under it. */
export function addManualMark(v) {
  const o = v.obs;
  const col = o.cols[o.cols.length - 1];
  const m = newVoyageMark(o, 'manual', v.boat.x, v.boat.y, v.world.time, { echo: col ? col.fishDepth : null, bottom: col ? col.bottom : null });
  pushVoyageMark(o, m);
  say(v, '現在地に印を付けました。');
  return m;
}

/** Name / memo for one of today's marks. */
export function editVoyageMark(v, id, { name, memo }) {
  const m = v.obs.marks.find((x) => x.id === id && x.kind !== 'auto');
  if (!m) return { ok: false, reason: 'その印は見つかりません。' };
  if (name !== undefined) m.name = cleanText(name, MARK_LIMITS.name);
  if (memo !== undefined) m.memo = cleanText(memo, MARK_LIMITS.memo);
  return { ok: true };
}

/** Delete one of today's marks. */
export function removeVoyageMark(v, id) {
  const i = v.obs.marks.findIndex((x) => x.id === id && x.kind !== 'auto');
  if (i < 0) return { ok: false, reason: 'その印は見つかりません。' };
  v.obs.marks.splice(i, 1);
  return { ok: true };
}

/**
 * Run straight to a point (a mark): the planned route is replaced by this one
 * point and the boat runs there and stops (movement assistance; steering
 * cancels it). It never looks for fish.
 */
export function routeTo(v, p) {
  if (isTrolling(v)) return { ok: false, reason: '曳縄中は使えません（曳く航路は海図で決めてください）。' };
  if (isLonglining(v)) return { ok: false, reason: v.op.kind === 'set' ? '投縄中です。' : '揚げ縄中です。' };
  const keepRoute = v.plannedRoute;
  const keepAp = v.autopilot;
  v.plannedRoute = [];
  if (v.autopilot && v.autopilot.kind === 'route') v.autopilot = null;
  const r = addRoutePoint(v, p);
  if (!r.ok) {
    v.plannedRoute = keepRoute;
    v.autopilot = keepAp;
    return r;
  }
  const run = runRoute(v);
  if (!run.ok) {
    v.plannedRoute = keepRoute;
    v.autopilot = keepAp;
  }
  return run;
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
    v.boat.throttle = model.steps.stop;
    v.boat.rudder = 0;
    if (Math.abs(v.boat.speed) > 0.4) return; // wait until the boat has stopped
    v.autopilot = null;
    if (ap.kind === 'return') {
      v.phase = 'docked';
      v.boat.x = PORT.dock.x;
      v.boat.y = PORT.dock.y + 20;
      v.boat.speed = 0;
      say(v, '帰港しました。水揚げします。');
    } else if (ap.kind === 'redrift') {
      const r = startOperation(v);
      if (!r.ok) say(v, r.reason, 'warn');
    } else if (ap.kind === 'haul') {
      const r = startHaul(v);
      if (!r.ok) say(v, r.reason, 'warn');
    } else if (ap.kind === 'route') {
      v.plannedRoute = [];
      say(v, '航路の終点に着きました（停止）。');
    }
    return;
  }
  v.boat.rudder = cmd.rudder;
  v.boat.throttle = cmd.throttle;
}

/** Lay the line along the chosen route, or follow it while hauling. */
function runLonglineHelm(v, model) {
  const op = v.op;
  if (op.kind === 'set') {
    const r = op.route;
    if (r.idx < r.points.length) {
      const cmd = autopilotCommand(v.boat, model, r.points[r.idx], 0, 25);
      if (cmd.arrived) r.idx += 1;
    }
  }
  const target = longlineHelmTarget(op, v.line, v.boat);
  const cmd = autopilotCommand(v.boat, model, target, 0, 3);
  v.boat.rudder = cmd.arrived ? 0 : cmd.rudder;
  v.boat.speedOverride = longlineTargetSpeed(op);
  v.boat.throttle = model.steps.deadSlow;
}

/** Follow the chosen trolling route back and forth at towing speed. */
function runTrollHelm(v, model) {
  const op = v.op;
  const r = op.route;
  const target = r.points[r.idx];
  const cmd = autopilotCommand(v.boat, model, target, 0, 40);
  if (cmd.arrived) {
    let next = r.idx + r.dir;
    if (next < 0 || next >= r.points.length) {
      r.dir = -r.dir;
      next = r.idx + r.dir;
    }
    r.idx = Math.max(0, Math.min(r.points.length - 1, next));
  }
  v.boat.rudder = cmd.arrived ? 0 : cmd.rudder;
  v.boat.speedOverride = trollTargetSpeed(op);
  v.boat.throttle = model.steps.slow; // shown on the HUD; the speed itself is speedOverride
}

// ---------------------------------------------------------------------------
// Player commands (decisions). Each returns {ok, reason?}.

export function setHelm(v, { throttle, rudder }) {
  if (v.phase !== 'sea') return { ok: false, reason: '停泊中です。' };
  if (isTrolling(v)) return { ok: false, reason: '曳縄中は決めた航路を自動で走ります。航路は海図（C）で変更、止めるときは Space。' };
  if (isLonglining(v)) return { ok: false, reason: v.op.kind === 'set' ? '投縄中は決めた航路に沿って自動で縄を張ります。' : '揚げ縄中は縄に沿って自動で進みます。' };
  if (isOperating(v)) return { ok: false, reason: '操業中は船を流しています。動かすには「回収・終了」してください。' };
  if (v.autopilot) {
    if (v.flags.dayEnd && (v.autopilot.kind === 'return' || v.autopilot.kind === 'haul')) return { ok: false, reason: v.autopilot.kind === 'haul' ? '日暮れが近いので、縄を揚げて帰港します。' : '帰港中です。' };
    const kind = v.autopilot.kind;
    v.autopilot = null;
    say(v, { return: '自動帰港を取り消しました。', haul: 'ブイへの移動を取り消しました（縄は浸けたまま）。', route: '航路の移動を取り消しました（航路は残しています）。' }[kind] || '流し直しの移動を取り消しました。');
  }
  const model = boatModel(v);
  if (throttle != null) v.boat.throttle = Math.max(0, Math.min(model.speeds.length - 1, throttle));
  if (rudder != null) v.boat.rudder = Math.max(-1, Math.min(1, rudder));
  return { ok: true };
}

/** Choose the method for the next operation (only gear that is on board). */
export function setMethod(v, methodId) {
  if (!METHODS[methodId]) return { ok: false, reason: '不明な漁法です。' };
  if (isOperating(v)) return { ok: false, reason: '操業中は漁法を変えられません。回収してからにしてください。' };
  if (methodId === 'troll' && !v.equip.troll) return { ok: false, reason: '曳縄具を積んでいません（港の「装備・船」で取り付け）。' };
  if (methodId === 'longline' && !v.equip.longline) return { ok: false, reason: '延縄具を積んでいません（港の「装備」で取り付け）。' };
  if (methodId === 'ika' && !v.equip.lights) return { ok: false, reason: '集魚灯を積んでいません（港の「装備」で屋根に取り付け）。' };
  v.method = methodId;
  return { ok: true };
}

export function canStartOperation(v) {
  if (v.phase !== 'sea') return { ok: false, reason: '海上でのみ操業できます。' };
  if (isOperating(v)) return { ok: false, reason: 'すでに操業中です。' };
  if (v.autopilot && v.autopilot.kind === 'return') return { ok: false, reason: '帰港中です。' };
  if (Math.hypot(v.boat.x - PORT.dock.x, v.boat.y - PORT.dock.y) < 300) return { ok: false, reason: '港の中では操業できません。' };
  const depth = depthAt(v.boat.x, v.boat.y);
  if (v.method === 'longline') {
    if (!v.equip.longline) return { ok: false, reason: '延縄具を積んでいません。' };
    if (lineInWater(v)) return { ok: true, haul: true };
    const route = lineRouteFrom(v);
    if (!route.ok) return route;
    return { ok: true };
  }
  if (v.method === 'troll') {
    if (!v.equip.troll) return { ok: false, reason: '曳縄具を積んでいません。' };
    if (depth < 6) return { ok: false, reason: '浅すぎて曳縄を流せません。' };
    const route = trollRouteFrom(v);
    if (!route.ok) return route;
    return { ok: true };
  }
  const m = METHODS[v.method] && METHODS[v.method].drift ? METHODS[v.method] : METHODS.handline;
  if (Math.abs(v.boat.speed) > m.maxStartSpeed) return { ok: false, reason: '船を止めてから操業を始めます（停止まで減速）。' };
  if (!v.obs.cols.length) return { ok: false, reason: '魚探の反応を待っています。' };
  if (depth < 6) return { ok: false, reason: `浅すぎて${m.name}の仕掛けを流せません。` };
  if (m.lights && !v.equip.lights) return { ok: false, reason: '集魚灯を積んでいません。' };
  if (m.liveBait && baitInHold(v, m.liveBait) < 1) return { ok: false, reason: '活きエサのアジがありません。先に一本釣りでアジを釣ってください（魚倉のアジを1尾ずつ使います）。' };
  return { ok: true };
}

/** The route trolling would use now: the planned points, or straight ahead and back. */
export function trollRouteFrom(v) {
  const here = { x: v.boat.x, y: v.boat.y };
  if (v.plannedRoute.length) {
    const pts = [here, ...v.plannedRoute];
    const chk = validateRoute(pts);
    return chk.ok ? { ok: true, points: pts, planned: true } : chk;
  }
  const pts = defaultRoute(v.boat);
  return pts ? { ok: true, points: pts, planned: false } : { ok: false, reason: 'この向きでは航路が取れません。向きを変えるか、海図で航路を決めてください。' };
}

/** The route the longline would be laid along now: the planned points, or straight ahead. */
export function lineRouteFrom(v) {
  const gear = v.equip.longline;
  const here = { x: v.boat.x, y: v.boat.y };
  if (v.plannedRoute.length) {
    const pts = [here, ...v.plannedRoute];
    const chk = validateLineRoute(pts, gear);
    return chk.ok ? { ok: true, points: pts, planned: true } : chk;
  }
  const len = (gear.hooks - 1) * gear.spacing + 40;
  const end = { x: v.boat.x + Math.sin(v.boat.heading) * len, y: v.boat.y + Math.cos(v.boat.heading) * len };
  const chk = validateLineRoute([here, end], gear);
  if (!chk.ok) return { ok: false, reason: `今の向きでは縄を張れません：${chk.reason}` };
  return { ok: true, points: [here, end], planned: false };
}

export function startOperation(v) {
  const c = canStartOperation(v);
  if (!c.ok) return c;
  if (c.haul) return haulLongline(v);
  v.autopilot = null;
  v.opSeq += 1;
  const depth = depthAt(v.boat.x, v.boat.y);
  if (v.method === 'longline') {
    const route = lineRouteFrom(v);
    v.lineSeq += 1;
    v.line = createLonglineSet({ id: `${v.id}-ll${v.lineSeq}`, gearId: v.equip.longlineId, gear: v.equip.longline, startT: v.world.time, start: { x: v.boat.x, y: v.boat.y } });
    v.line.startConditions = conditionsSnapshot(v);
    v.line.plan = v.plan ? { key: v.plan.key, label: v.plan.label, basis: v.plan.basis } : null;
    v.op = createSetOperation({ id: `${v.id}-op${v.opSeq}`, voyageId: v.id, level: v.levels.longline, set: v.line, route: route.points, startT: v.world.time, x: v.boat.x, y: v.boat.y });
    v.plannedRoute = [];
    say(v, `投縄開始（${areaNameAt(v.boat.x, v.boat.y)}・水深${depth.toFixed(0)}m${route.planned ? '' : '・今の向きにまっすぐ'}）。針${v.equip.longline.hooks}本を張ります。`);
    return { ok: true };
  }
  if (v.method === 'troll') {
    const route = trollRouteFrom(v);
    v.op = createTrollOperation({
      id: `${v.id}-op${v.opSeq}`,
      voyageId: v.id,
      level: v.levels.troll,
      gear: v.equip.troll,
      gearId: v.equip.trollId,
      startT: v.world.time,
      x: v.boat.x,
      y: v.boat.y,
      route: route.points,
      hands: 1 + v.crew,
    });
    v.op.startConditions = conditionsSnapshot(v);
    say(v, `曳縄開始（${areaNameAt(v.boat.x, v.boat.y)}・航路${Math.round(routeLength(route.points))}m${route.planned ? '' : '：今の向きで往復'}）。航行と仕掛けの作業は自動です。`);
    return { ok: true };
  }
  v.boat.throttle = boatModel(v).steps.stop;
  v.boat.rudder = 0;
  const hookMethod = METHODS[v.method] && METHODS[v.method].drift ? v.method : 'handline';
  v.op = createOperation({
    id: `${v.id}-op${v.opSeq}`,
    voyageId: v.id,
    methodId: hookMethod,
    level: v.levels[hookMethod],
    rigs: v.equip.rigs,
    startT: v.world.time,
    x: v.boat.x,
    y: v.boat.y,
    hands: 1 + v.crew,
  });
  v.op.startConditions = conditionsSnapshot(v);
  // a rough sea (やや時化): the boat pitches, baiting and unhooking take longer
  if (v.world.cond.weather && v.world.cond.weather.rough) {
    v.op.skill = { ...v.op.skill, rebait: v.op.skill.rebait * 1.25, unhook: v.op.skill.unhook * 1.25 };
    say(v, '海が荒れていて、手元の作業に時間がかかります。', 'warn');
  }
  if (depth > v.equip.reel.maxDepth) say(v, `水深${depth.toFixed(0)}mはリールの対応水深${v.equip.reel.maxDepth}mを超えています。届く深さまでで操業します。`, 'warn');
  if (hookMethod === 'ika') say(v, `パラアンカーを入れ、集魚灯を点けてイカ釣り開始（${areaNameAt(v.boat.x, v.boat.y)}・水深${depth.toFixed(0)}m）。${v.world.time < 17.5 * 3600 ? 'まだ明るいので灯の効きは弱い。暗くなるにつれて寄ってくる。' : '暗くなるにつれて、まわりのイカが船の下に寄ってくる。'}`);
  else if (hookMethod === 'oyogase') say(v, `泳がせ釣り開始（${areaNameAt(v.boat.x, v.boat.y)}・水深${depth.toFixed(0)}m）。魚倉の活きアジ（残り${baitInHold(v, 'aji')}尾）を1尾ずつ使います。`);
  else if (hookMethod === 'negyo') say(v, `根魚釣り開始（${areaNameAt(v.boat.x, v.boat.y)}・水深${depth.toFixed(0)}m）。底を切って流します。根の真上を通るように流し直し（R）を使ってください。`);
  else say(v, `操業開始（${areaNameAt(v.boat.x, v.boat.y)}・水深${depth.toFixed(0)}m）。投入から回収まで自動で行います。`);
  return { ok: true };
}

/**
 * 揚げ縄: haul the soaking line. If another operation runs it is finished
 * first; if the boat is away from the line it runs to the nearer end buoy
 * (movement assistance) and starts hauling there.
 */
export function haulLongline(v, after = null) {
  if (!v.line || v.line.state !== 'soaking') {
    if (v.line && (v.line.state === 'setting' || v.line.state === 'hauling')) return { ok: false, reason: v.line.state === 'setting' ? '投縄中です。張り終えてから揚げます。' : 'すでに揚げ縄中です。' };
    return { ok: false, reason: '海に入っている縄がありません。' };
  }
  if (after) v.afterHaul = after;
  if (isOperating(v)) {
    if (v.op.state === 'running') requestStop(v.op, 'haul');
    v.after = 'haul';
    say(v, '今の仕掛けを回収してから、縄を揚げに向かいます。');
    return { ok: true };
  }
  const b = nearestBuoy(v.line, v.boat.x, v.boat.y);
  if (b.dist <= METHODS.longline.nearBuoy) return startHaul(v);
  v.autopilot = { kind: 'haul', route: [{ x: b.x, y: b.y }], leg: 0 };
  say(v, `縄の${b.end === 'start' ? '入れ始め' : '入れ終わり'}のブイへ向かい、着いたら揚げます（移動補助。操船すると取り消し）。`);
  return { ok: true };
}

function startHaul(v) {
  if (!v.line || v.line.state !== 'soaking') return { ok: false, reason: '揚げる縄がありません。' };
  const b = nearestBuoy(v.line, v.boat.x, v.boat.y);
  if (b.dist > METHODS.longline.nearBuoy * 1.5) return { ok: false, reason: 'ブイから離れています。' };
  v.autopilot = null;
  v.opSeq += 1;
  v.op = createHaulOperation({ id: `${v.id}-op${v.opSeq}`, voyageId: v.id, level: v.levels.longline, set: v.line, fromEnd: b.end, startT: v.world.time, x: v.boat.x, y: v.boat.y, hands: 1 + v.crew, machineHaul: v.equip.hauler ? v.equip.hauler.haul : 0 });
  if (v.afterHaul) {
    v.after = v.afterHaul;
    v.afterHaul = null;
  }
  const soakMin = Math.round((v.world.time - v.line.setEndT) / 60);
  say(v, `揚げ縄開始（浸け${soakMin}分）。縄に沿って進みながら自動で揚げます。`);
  return { ok: true };
}

export function stopOperation(v, reason = 'player') {
  if (isLonglining(v)) return { ok: false, reason: v.op.kind === 'set' ? '投縄は最後まで張ります（数分）。' : '揚げ縄は最後まで揚げます。' };
  if (!isOperating(v)) return { ok: false, reason: '操業していません。' };
  if (v.op.state === 'stopping') return { ok: false, reason: '回収中です。' };
  requestStop(v.op, reason);
  say(v, '仕掛けを回収しています…');
  return { ok: true };
}

/** Route points the boat can run to from where it is (the boat's own spot is not checked for depth). */
function checkRoutePoints(points, from) {
  if (!points.length) return { ok: false, reason: '航路の点がありません。' };
  // validateRoute wants two or more points: a single point is checked as a zero-length route
  return validateRoute(points.length === 1 ? [points[0], points[0]] : points, { x: from.x, y: from.y });
}

/** Add a waypoint to the route (trolling / where the longline goes / plain movement; applied at once while trolling). */
/** Is this point inside the boat's navigation zone (航行区域)? */
export function inRange(v, p) {
  const r = boatModel(v).range;
  return !r || r.maxY == null || p.y <= r.maxY;
}

export function addRoutePoint(v, p) {
  if (v.plannedRoute.length >= MAX_ROUTE_POINTS) return { ok: false, reason: `航路の点は${MAX_ROUTE_POINTS}つまでです。` };
  if (!inRange(v, p)) return { ok: false, reason: `${boatModel(v).name}の航行区域（${boatModel(v).range.label}）の外です。沖の瀬へは中型漁船で行けます。` };
  const pt = { x: Math.round(p.x), y: Math.round(p.y) };
  let next = [...v.plannedRoute, pt];
  // from inside the harbour, a route goes out through the harbour mouth first
  const mouth = { x: PORT.entrance.x, y: PORT.entrance.y + 40 };
  if (!v.plannedRoute.length && !isTrolling(v) && Math.hypot(v.boat.x - PORT.entrance.x, v.boat.y - PORT.entrance.y) < 420 && !clearPath({ x: v.boat.x, y: v.boat.y }, pt) && clearPath(mouth, pt)) {
    next = [mouth, pt];
  }
  const chk = checkRoutePoints(next, v.boat);
  if (!chk.ok) return chk;
  v.plannedRoute = next;
  if (isTrolling(v)) applyRouteNow(v);
  if (v.autopilot && v.autopilot.kind === 'route') v.autopilot.route.push({ ...next[next.length - 1] });
  return { ok: true };
}

export function clearRoute(v) {
  v.plannedRoute = [];
  if (v.autopilot && v.autopilot.kind === 'route') {
    v.autopilot = null;
    v.boat.throttle = boatModel(v).steps.stop;
    v.boat.rudder = 0;
    say(v, '航路を消し、移動をやめました。');
  }
  if (isTrolling(v)) {
    const pts = defaultRoute(v.boat);
    if (pts) {
      v.op.route = { points: pts, idx: 1, dir: 1, changes: v.op.route.changes + 1 };
      say(v, '航路を消しました。今の向きで往復します。');
    }
  }
  return { ok: true };
}

function applyRouteNow(v) {
  v.op.route = { points: [{ x: v.boat.x, y: v.boat.y }, ...v.plannedRoute], idx: 1, dir: 1, changes: v.op.route.changes + 1 };
  say(v, `航路を変更しました（経由点${v.plannedRoute.length}）。`);
}

/**
 * Run the planned chart route (movement assistance, any method): the boat
 * steers through the points and stops at the last one. Steering cancels it.
 * An operation in progress is retrieved first. It never looks for fish.
 */
export function runRoute(v) {
  if (v.phase !== 'sea') return { ok: false, reason: '海上でのみ使えます。' };
  if (!v.plannedRoute.length) return { ok: false, reason: '航路がありません。海図（C）を拡大してクリックで経由点を置いてください。' };
  if (isTrolling(v)) return { ok: false, reason: '曳縄中は、この航路に沿って曳いています。' };
  if (isLonglining(v)) return { ok: false, reason: v.op.kind === 'set' ? '投縄中です。' : '揚げ縄中です。' };
  if (v.autopilot && v.autopilot.kind === 'return' && v.flags.dayEnd) return { ok: false, reason: '帰港中です。' };
  const chk = checkRoutePoints(v.plannedRoute, v.boat);
  if (!chk.ok) return chk;
  if (isOperating(v)) {
    if (v.op.state === 'running') requestStop(v.op, 'move');
    v.after = 'route';
    say(v, '仕掛けを回収してから、航路に沿って移動します。');
    return { ok: true };
  }
  v.autopilot = { kind: 'route', route: v.plannedRoute.map((p) => ({ ...p })), leg: 0 };
  say(v, `航路に沿って移動します（経由点${v.plannedRoute.length}・移動補助。操船すると取り消し）。`);
  return { ok: true };
}

/** 流し直し (一本釣り): retrieve, run back up to where this drift started, and start again. */
export function redrift(v) {
  if (isTrolling(v) || (!isOperating(v) && v.method === 'troll')) return { ok: false, reason: '曳縄では流し直しの代わりに航路を変えます（海図 C で経由点を指定）。' };
  if (isLonglining(v) || (!isOperating(v) && v.method === 'longline')) return { ok: false, reason: '延縄に流し直しはありません。縄を張る場所は海図（C）で決めます。' };
  if (isOperating(v)) {
    if (v.op.state === 'running') requestStop(v.op, 'redrift');
    v.after = 'redrift';
    v.redriftTarget = { ...v.op.start };
    say(v, '回収して、流し始めた地点へ戻ります。');
    return { ok: true };
  }
  const last = [...v.logs].reverse().find((l) => l.methodId === v.method) || [...v.logs].reverse().find((l) => METHODS[l.methodId] && METHODS[l.methodId].drift);
  if (!last) return { ok: false, reason: 'まだ流した地点がありません。' };
  v.autopilot = { kind: 'redrift', route: [{ ...last.start }], leg: 0 };
  say(v, '前回流し始めた地点へ戻ります。');
  return { ok: true };
}

export function returnToPort(v, forced = false) {
  if (v.phase !== 'sea') return { ok: false, reason: 'すでに港にいます。' };
  if (isLonglining(v)) {
    v.after = 'return';
    if (v.op.kind === 'set') v.afterSetHaul = true;
    say(v, v.op.kind === 'set' ? '縄を張り終えたら、そのまま揚げて帰港します。' : '揚げ終えたら帰港します。');
    return { ok: true };
  }
  if (isOperating(v)) {
    if (v.op.state === 'running') requestStop(v.op, forced ? 'day_end' : 'return');
    v.after = 'return';
    say(v, '回収してから帰港します。');
    return { ok: true };
  }
  if (lineInWater(v)) {
    // the line is never left behind: haul it first, then go home
    say(v, '縄を揚げてから帰港します。');
    return haulLongline(v, 'return');
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
  v.op = null;
  v.boat.speedOverride = null;
  v.boat.throttle = boatModel(v).steps.stop;
  v.boat.rudder = 0;
  const after = v.after;
  v.after = null;
  if (op.methodId === 'longline' && op.kind === 'set') {
    // the line now soaks; the log is written when it is hauled
    v.line.setStats = op.stats;
    v.line.setS = op.endT - op.startT;
    say(v, `投縄完了（${v.equip.longline.hooks}本・${areaNameAt(v.line.end.x, v.line.end.y)}）。浸けている間は自由に動けます。揚げるときは「揚げ縄」（L）。`);
    emit(v, { type: 'lineSet', lineId: v.line.id });
    if (after === 'return' || v.afterSetHaul) {
      v.afterSetHaul = false;
      haulLongline(v, 'return');
    }
    return;
  }
  const log = op.methodId === 'longline' ? makeLonglineLog(v, op, v.line) : makeOperationLog(v, op);
  v.logs.push(log);
  const mins = Math.round(log.durationS / 60);
  const unit = SPECIES[op.species].unit;
  if (op.methodId === 'longline') say(v, `揚げ縄終了：浸け${log.longline.soakMin}分、${log.count}${unit}（${log.kg.toFixed(1)}kg）。`);
  else say(v, `操業終了：${mins}分で${log.count}${unit}（${log.kg.toFixed(1)}kg）。${endReasonText(log.endReason)}`);
  emit(v, { type: 'opEnded', logId: log.id });
  if (log.endReason === 'hold_full') say(v, '魚倉が満杯です。帰港して水揚げしましょう。', 'warn');
  if (after === 'redrift') v.autopilot = { kind: 'redrift', route: [v.redriftTarget], leg: 0 };
  else if (after === 'route') runRoute(v);
  else if (after === 'haul') haulLongline(v);
  else if (after === 'return') returnToPort(v, true);
}

export function endReasonText(r) {
  return (
    {
      player: '',
      redrift: '流し直します。',
      return: '帰港します。',
      day_end: '時間切れで終了。',
      hold_full: '魚倉が満杯になりました。',
      haul: '縄を揚げに向かいます。',
      move: '航路に沿って移動します。',
      no_bait: '活きエサのアジがなくなりました。',
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

function round1(x) {
  return x == null ? null : Math.round(x * 10) / 10;
}

function makeOperationLog(v, op) {
  const st = op.stats;
  const log = {
    id: op.id,
    voyageId: v.id,
    day: v.day,
    methodId: op.methodId,
    species: op.species,
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
    gear: { boat: v.modelId, sounder: v.equip.sounderId, reel: v.equip.reelId, reels: v.equip.rigs.map((r) => r.reelId), troll: v.equip.trollId },
    level: op.level,
    plan: v.plan ? { key: v.plan.key, label: v.plan.label, basis: v.plan.basis } : null,
    crew: v.crew,
  };
  if (op.methodId === 'troll') {
    log.troll = { routeLength: Math.round(routeLength(op.route.points)), routeChanges: op.route.changes, towDistance: Math.round(st.towDistance) };
  }
  if (METHODS[op.methodId].targets) {
    // several species on one method (根魚): what came up of each, and the snags
    log.bySpecies = Object.fromEntries(Object.entries(op.landedBy || {}).map(([sp, c]) => [sp, { ...c }]));
    log.snags = st.snags || 0;
    log.lostFish = st.lostFish || 0;
    if (METHODS[op.methodId].liveBait) log.baits = st.baits || 0;
    if (METHODS[op.methodId].lights) log.gathered = st.gathered || 0;
  }
  log.tags = logTags(log);
  return log;
}

/** One logbook record per longline: laid, soaked and hauled. */
function makeLonglineLog(v, op, set) {
  const hooks = set.hooks;
  const bottoms = hooks.map((h) => h.bottom);
  const zs = hooks.map((h) => h.z);
  const mid = hooks[Math.floor(hooks.length / 2)] || set.start;
  const ss = set.setStats || { pings: 0, echoPings: 0, maxEcho: 0, echoDepthSum: 0 };
  const hs = op.stats;
  const pings = ss.pings + hs.pings;
  const echoPings = ss.echoPings + hs.echoPings;
  const soakS = set.haulStartT - set.setEndT;
  const meanSoakS = hooks.length ? hooks.reduce((a, h) => a + (set.haulStartT - h.setT), 0) / hooks.length : 0;
  const log = {
    id: set.id,
    voyageId: v.id,
    day: v.day,
    methodId: 'longline',
    species: op.species,
    startT: set.startT,
    endT: op.endT,
    durationS: Math.round(op.endT - set.startT),
    start: { x: Math.round(set.start.x), y: Math.round(set.start.y) },
    end: { x: Math.round(set.end.x), y: Math.round(set.end.y) },
    area: areaNameAt(mid.x, mid.y),
    bottom: { min: round1(Math.min(...bottoms)), max: round1(Math.max(...bottoms)) },
    tana: { min: round1(Math.min(...zs)), max: round1(Math.max(...zs)) },
    catches: { ...op.landed },
    count: op.landedCount,
    kg: Math.round(op.landedKg * 100) / 100,
    endReason: op.endReason || 'player',
    conditions: set.startConditions,
    sounder: {
      pings,
      echoRatio: pings ? Math.round((echoPings / pings) * 100) / 100 : 0,
      maxEcho: Math.round(Math.max(ss.maxEcho, hs.maxEcho) * 100) / 100,
      echoDepth: echoPings ? round1((ss.echoDepthSum + hs.echoDepthSum) / echoPings) : null,
    },
    gear: { boat: v.modelId, sounder: v.equip.sounderId, reel: v.equip.reelId, reels: v.equip.rigs.map((r) => r.reelId), troll: v.equip.trollId, longline: set.gearId, hauler: v.equip.haulerId },
    level: op.level,
    plan: set.plan || null,
    crew: v.crew,
    longline: {
      hooks: hooks.length,
      lineLength: Math.round(routeLength(hooks.map((h) => ({ x: h.x, y: h.y })))),
      soakMin: Math.round(soakS / 60),
      meanSoakMin: Math.round(meanSoakS / 60),
      setMin: Math.round((set.setS || 0) / 60),
      haulMin: Math.round((op.endT - op.startT) / 60),
      hooksWithFish: op.landedCount,
      fromEnd: op.fromEnd,
    },
  };
  log.tags = logTags(log);
  return log;
}

/** Everything settlement needs from a finished voyage. */
export function summarizeVoyage(v) {
  const counts = {};
  for (const [sp, c] of Object.entries(v.hold.counts)) counts[sp] = { ...c };
  return {
    id: v.id,
    day: v.day,
    hold: { counts, kg: Math.round(v.hold.kg * 100) / 100, count: v.hold.count },
    logs: v.logs.map((l) => ({ ...l })),
    heard: v.heard.map((r) => ({ ...r })),
    distanceM: Math.round(v.boat.distance),
    fuelPerKm: boatModel(v).fuelPerKm,
    crew: v.crew,
    crewWage: v.crew ? CREW.wage : 0,
    baitUsed: v.baitUsed ? JSON.parse(JSON.stringify(v.baitUsed)) : {},
    bathyCells: v.bathy ? v.bathy.cells : {},
    marks: v.obs.marks.filter((m) => m.kind !== 'auto').map((m) => ({ ...m })),
    opSeconds: Math.round(v.opSeconds),
    plan: v.plan,
  };
}
