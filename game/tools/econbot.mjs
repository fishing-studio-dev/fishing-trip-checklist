// A simple automatic fisher for balance checks: knows where the fish are (a
// test convenience) and plays one method for a whole day, then settles.
const G = new URL('../src/core/', import.meta.url).href;
const { createProfile, markDeparture } = await import(G + 'profile.js');
const V = await import(G + 'voyage.js');
const { settleVoyage } = await import(G + 'economy.js');
const { schoolCenter, schoolTotal } = await import(G + 'world.js');
const { currentAt, STRUCTURES, depthAt } = await import(G + 'sea.js');
const { PROGRESSION, TIME } = await import(G + 'data.js');

const NOW = '2026-11-24T00:00:00.000Z';

function profileFor({ seed, day, level, boat, slots }) {
  const p = createProfile({ worldSeed: seed, now: NOW });
  p.day = day - 1;
  for (const m of Object.keys(p.methods)) p.methods[m].xp = PROGRESSION.xpTable[level - 1];
  p.boat.model = boat;
  const base = boat === 'cruiser_2'
    ? { helm_sounder: 'sounder_es2', starboard_reel: 'reel_electric', port_reel: 'reel_electric', stern_troll: null, deck_longline: null, starboard_hauler: null, hull_sonar: null, roof_lights: null }
    : { helm_sounder: 'sounder_es1', starboard_reel: 'reel_hand', stern_troll: null, starboard_hauler: null, roof_lights: null };
  const all = { ...base, ...slots };
  let n = 0;
  p.boat.slots = Object.fromEntries(Object.entries(all).map(([k, id]) => [k, id ? { uid: `b${++n}`, itemId: id } : null]));
  return p;
}

const adv = (v, s) => V.advanceVoyage(v, s);
function goto(v, x, y, maxS = 2400) {
  const r = V.routeTo(v, { x, y });
  if (!r.ok) return false;
  for (let t = 0; t < maxS && v.autopilot; t += 5) adv(v, 5);
  return true;
}
function fishFor(v, secs) {
  if (!V.startOperation(v).ok) return false;
  adv(v, secs);
  V.stopOperation(v, 'player');
  for (let i = 0; i < 600 && V.isOperating(v); i++) adv(v, 1);
  return true;
}
const upTide = (v, x, y, d) => {
  const c = currentAt(v.world.cond, v.world.time);
  const s = Math.hypot(c.x, c.y) || 1;
  return { x: x - (c.x / s) * d, y: y - (c.y / s) * d };
};
const inZone = (v, p) => V.inRange(v, p) && p.y > 300;
const best = (v, pred) => v.world.schools.filter((s) => pred(s) && schoolTotal(s) > 0).map((s) => ({ s, c: schoolCenter(s, v.world.time) })).filter((o) => inZone(v, o.c)).sort((a, b) => schoolTotal(b.s) - schoolTotal(a.s))[0];

const PLAYS = {
  handline(v, endT) {
    V.setMethod(v, 'handline');
    while (v.world.time < endT) {
      const b = best(v, (s) => s.species === 'aji');
      if (!b) break;
      const p = upTide(v, b.c.x, b.c.y, 40);
      goto(v, p.x, p.y);
      if (!fishFor(v, 600)) adv(v, 120);
      if (V.roomKg(v) < 2) break;
    }
  },
  negyo(v, endT) {
    V.setMethod(v, 'negyo');
    const spots = STRUCTURES.filter((st) => inZone(v, st)).sort((a, b) => a.y - b.y);
    let k = 0;
    while (v.world.time < endT && spots.length) {
      const st = spots[k++ % spots.length];
      for (let pass = 0; pass < 2; pass++) {
        const p = upTide(v, st.x, st.y, 25);
        goto(v, p.x, p.y);
        fishFor(v, 240);
      }
    }
  },
  oyogase(v, endT) {
    PLAYS.handline(v, v.world.time + 1800);
    V.setMethod(v, 'oyogase');
    while (v.world.time < endT && V.baitInHold(v, 'aji') > 0) {
      const b = best(v, (s) => s.species === 'buri' || s.species === 'hiramasa');
      if (!b) break;
      goto(v, b.c.x, b.c.y);
      fishFor(v, 1200);
    }
  },
  troll(v, endT) {
    V.setMethod(v, 'troll');
    while (v.world.time < endT) {
      const b = best(v, (s) => s.species === 'sawara');
      if (!b) break;
      goto(v, b.c.x, b.c.y - 300);
      V.clearRoute(v);
      V.addRoutePoint(v, { x: b.c.x, y: b.c.y + 300 });
      if (!fishFor(v, 1800)) adv(v, 300);
      V.clearRoute(v);
    }
  },
  longline(v, endT) {
    V.setMethod(v, 'longline');
    while (v.world.time < endT - 5400) {
      const b = best(v, (s) => s.species === 'madai');
      if (!b) break;
      goto(v, b.c.x, b.c.y - 300);
      v.boat.heading = 0;
      if (!V.startOperation(v).ok) break;
      for (let i = 0; i < 3600 && V.isOperating(v); i += 5) adv(v, 5);
      adv(v, 2700); // soak
      V.haulLongline(v);
      for (let i = 0; i < 7200 && (V.isOperating(v) || v.autopilot); i += 5) adv(v, 5);
    }
  },
  ika(v, endT) {
    V.setMethod(v, 'ika');
    const b = best(v, (s) => s.species === 'kensaki' || s.species === 'yari');
    if (!b) return;
    goto(v, b.c.x, b.c.y);
    if (V.startOperation(v).ok) {
      while (v.world.time < endT && V.isOperating(v)) adv(v, 60);
      V.stopOperation(v, 'player');
      for (let i = 0; i < 600 && V.isOperating(v); i++) adv(v, 1);
    }
  },
};

export function runDay({ seed = 77, day, method, level = 1, boat = 'skiff_1', slots = {} }) {
  const p = profileFor({ seed, day, level, boat, slots });
  const dep = markDeparture(p, NOW, null, { night: method === 'ika' });
  const v = V.createVoyage(dep, { radio: [] });
  if (v.world.cond.weather && v.world.cond.weather.storm) return { day, method, storm: true };
  const endT = (v.endT || TIME.END) - 2400;
  PLAYS[method](v, endT);
  V.returnToPort(v);
  for (let i = 0; i < 20000 && v.phase !== 'docked'; i++) adv(v, 2);
  const s = settleVoyage(dep, V.summarizeVoyage(v));
  if (!s.ok) return { day, method, error: s.reason };
  const r = s.receipt;
  return { day, method, sales: r.sales, cost: r.costs.total, net: r.net, kg: Math.round(v.logs.reduce((a, l) => a + l.kg, 0)), n: v.logs.reduce((a, l) => a + l.count, 0) };
}

void depthAt;
