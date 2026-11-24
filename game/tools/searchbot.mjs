// Item 15: do the search tools make pinpoints and roaming fish easier to find?
// A survey boat runs the same lines with different instruments and notes what
// each instrument shows — it steers only along the fixed lines and decides
// "found" only from the instrument pictures (sounder bottom vs printed chart,
// side-view hard returns, sonar returns). The true positions are used only
// afterwards, to score the finds (a find within a tolerance of a real
// structure / school counts; otherwise it is a false find).
//
// Usage: node tools/searchbot.mjs [days, e.g. 10,11,12] [seed]
const C = new URL('../src/core/', import.meta.url).href;
const { createProfile, markDeparture } = await import(C + 'profile.js');
const V = await import(C + 'voyage.js');
const { STRUCTURES, baseDepthAt } = await import(C + 'sea.js');
const { schoolCenter, schoolTotal } = await import(C + 'world.js');
const { sideToWorld } = await import(C + 'sideview.js');
const { SONAR_BEAMS, SONAR_BINS } = await import(C + 'sonar.js');
const { SPECIES } = await import(C + 'data.js');

const NOW = '2026-11-24T00:00:00.000Z';
const SETUPS = {
  'ES-2のみ': { helm_sounder: 'sounder_es2', hull_sonar: null },
  'サイドビューSV-1': { helm_sounder: 'sounder_sv1', hull_sonar: null },
  'ES-2＋ソナー': { helm_sounder: 'sounder_es2', hull_sonar: 'sonar_cs1' },
  'SV-1＋ソナー': { helm_sounder: 'sounder_sv1', hull_sonar: 'sonar_cs1' },
};
// survey box over 沖の平場 – the west of 北の瀬, lines run north–south 200 m apart
const BOX = { x0: 1000, x1: 2400, y0: 1250, y1: 2350, spacing: 200 };

function voyageFor(seed, day, slots) {
  const p = createProfile({ worldSeed: seed, now: NOW });
  p.day = day - 1;
  p.boat.model = 'cruiser_2';
  const all = { helm_sounder: 'sounder_es2', starboard_reel: 'reel_electric', port_reel: null, stern_troll: null, deck_longline: null, starboard_hauler: null, hull_sonar: null, roof_lights: null, ...slots };
  let n = 0;
  p.boat.slots = Object.fromEntries(Object.entries(all).map(([k, id]) => [k, id ? { uid: `s${++n}`, itemId: id } : null]));
  const v = V.createVoyage(markDeparture(p, NOW), { radio: [], start: { x: BOX.x0, y: BOX.y0 - 60, heading: 0 } });
  v.world.time = 7 * 3600;
  return v;
}

const isBlue = (s) => SPECIES[s.species].bait || SPECIES[s.species].habit === 'roam';

/** What the instruments show right now, as candidate finds {kind:'rise'|'fish', x, y, by}. */
function look(v) {
  const out = [];
  const col = v.obs.cols[v.obs.cols.length - 1];
  if (col) {
    // sounder: the bottom is clearly shallower than the printed chart says (an uncharted rise)
    if (baseDepthAt(col.x, col.y) - col.bottomCenter > 2) out.push({ kind: 'rise', x: col.x, y: col.y, by: '魚探' });
    // sounder: a fish echo in mid water (bait / 青物), not on the bottom
    if (col.maxFish >= 0.3 && col.fishDepth != null && col.fishDepth < col.bottom - 5) out.push({ kind: 'fish', x: col.x, y: col.y, by: '魚探' });
  }
  const side = v.obs.side && v.obs.side[v.obs.side.length - 1];
  if (side && side.x != null) {
    // side view: a bright hard return standing out from the rest of the strip
    const vals = Array.from(side.vals);
    const sorted = vals.slice().sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const n = vals.length;
    for (let k = 0; k < n; k++) {
      if (Math.abs(k - (n - 1) / 2) < 2) continue; // right under the boat: the sounder's job
      if (vals[k] >= median + 70 && vals[k] >= 150) out.push({ kind: 'rise', ...sideToWorld(side, -60 + k * 5), by: 'サイドビュー' });
    }
  }
  if (v.sonar) {
    // sonar: strong returns around the boat (positions from bearing and range)
    const sn = v.sonar;
    for (let b = 0; b < SONAR_BEAMS; b++) {
      for (let k = 2; k < SONAR_BINS; k++) {
        const val = sn.data[b * SONAR_BINS + k];
        if (val < 110) continue;
        const rel = (b / SONAR_BEAMS) * Math.PI * 2;
        const dist = ((k + 0.5) / SONAR_BINS) * sn.range;
        const a = v.boat.heading + rel;
        out.push({ kind: val >= 140 ? 'fish' : 'rise', x: v.boat.x + Math.sin(a) * dist, y: v.boat.y + Math.cos(a) * dist, by: 'ソナー', any: true });
      }
    }
  }
  return out;
}

function survey(seed, day, name) {
  const v = voyageFor(seed, day, SETUPS[name]);
  const t0 = v.world.time;
  const truthS = STRUCTURES.filter((s) => s.x >= BOX.x0 - 80 && s.x <= BOX.x1 + 80 && s.y >= BOX.y0 - 80 && s.y <= BOX.y1 + 80);
  const foundS = new Map(); // structure id -> first time
  const foundF = new Map(); // school id -> first time
  let falseFinds = 0;
  let otherFish = 0;
  const seenFalse = [];
  const lines = [];
  for (let x = BOX.x0, k = 0; x <= BOX.x1; x += BOX.spacing, k++) lines.push(k % 2 ? [{ x, y: BOX.y1 }, { x, y: BOX.y0 }] : [{ x, y: BOX.y0 }, { x, y: BOX.y1 }]);
  for (const [a, b] of lines) {
    V.routeTo(v, a);
    for (let i = 0; i < 900 && v.autopilot; i++) V.advanceVoyage(v, 2);
    V.routeTo(v, b);
    for (let i = 0; i < 2400 && v.autopilot; i++) {
      V.advanceVoyage(v, 2);
      if (i % 3) continue;
      const t = v.world.time;
      const schools = v.world.schools.filter((s) => isBlue(s) && schoolTotal(s) > 0).map((s) => ({ s, c: schoolCenter(s, t) }));
      for (const f of look(v)) {
        const st = truthS.find((s) => Math.hypot(s.x - f.x, s.y - f.y) <= s.r + 30);
        const sc = schools.find((o) => Math.hypot(o.c.x - f.x, o.c.y - f.y) <= o.s.sigmaH * 1.5 + 30);
        if (st && (f.kind === 'rise' || f.any)) {
          if (!foundS.has(st.id)) foundS.set(st.id, t - t0);
        } else if (sc && (f.kind === 'fish' || f.any)) {
          if (!foundF.has(sc.s.id)) foundF.set(sc.s.id, t - t0);
        } else if (v.world.schools.some((s) => schoolTotal(s) > 0 && Math.hypot(schoolCenter(s, t).x - f.x, schoolCenter(s, t).y - f.y) <= s.sigmaH * 1.5 + 30)) {
          otherFish += 1; // other fish (アジ・根魚・マダイ…): a real echo, just not the target
        } else if (!seenFalse.some((p) => Math.hypot(p.x - f.x, p.y - f.y) < 80)) {
          seenFalse.push(f);
          falseFinds += 1;
        }
      }
    }
  }
  const blueIn = v.world.schools.filter((s) => isBlue(s)).filter((s) => {
    const c = schoolCenter(s, t0 + 1800);
    return c.x >= BOX.x0 - 300 && c.x <= BOX.x1 + 300 && c.y >= BOX.y0 - 300 && c.y <= BOX.y1 + 300;
  }).length;
  const first = (m) => (m.size ? Math.round(Math.min(...m.values()) / 60) : null);
  return { name, day, minutes: Math.round((v.world.time - t0) / 60), structures: `${foundS.size}/${truthS.length}`, firstStructureMin: first(foundS), schools: `${foundF.size}/${blueIn}`, firstSchoolMin: first(foundF), falseFinds, otherFishEchoes: otherFish };
}

const days = (process.argv[2] || '10,11,12').split(',').map(Number);
const seed = Number(process.argv[3] || 77);
for (const name of Object.keys(SETUPS)) {
  const rows = days.map((d) => survey(seed, d, name));
  for (const r of rows) console.log(JSON.stringify(r));
}
