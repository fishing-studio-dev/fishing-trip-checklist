// Reports from fishing peers (漁師仲間). Every observation is computed from the
// actual world of the day and time it was made — no free-floating random
// rumours. A report that turns out "wrong" is wrong because time passed (the
// fish moved, the school thinned) or because it was a sighting/estimate, never
// because of an arbitrary lie. Predictions and rules of thumb are kept apart
// from observations (handover §7.2).
import { PEERS, SPECIES, BRIEFING_T, METHODS } from './data.js';
import { createWorld, schoolPose, schoolTotal, activityAt, offBottomAt, tidePhase } from './world.js';
import { HABITATS, SAWARA_ZONES, MADAI_GROUNDS } from './season.js';
import { dayTimes, daylightAt } from './calendar.js';
import { areaNameAt, fmtClock, makeDayConditions, forecastOf, tideClass, compass8, CHART_LABELS, weatherOf, currentAt } from './sea.js';
import { hashFloat } from './rng.js';

const cache = new Map();
function worldFor(seed, d) {
  const k = `${seed}:${d}`;
  if (!cache.has(k)) {
    if (cache.size > 40) cache.delete(cache.keys().next().value);
    cache.set(k, createWorld(seed, d, dayTimes(d).depart));
  }
  return cache.get(k);
}

const REEF_HABITATS = ['kita_e', 'kita_s', 'kita_w', 'nishi'];
const habitat = (id) => HABITATS.find((h) => h.id === id);
const round10min = (t) => Math.round(t / 600) * 600;
const roundPt = (p) => ({ x: Math.round(p.x / 25) * 25, y: Math.round(p.y / 25) * 25 });

/** "北の瀬の東側" style place name for a point (what a fisher would say). */
export function placeLabel(x, y) {
  const area = areaNameAt(x, y);
  const anchor = CHART_LABELS.find((l) => l.name === area);
  if (!anchor) return area;
  const dx = x - anchor.x;
  const dy = y - anchor.y;
  if (Math.hypot(dx, dy) < 110) return `${area}の真ん中あたり`;
  return `${area}の${compass8(dx, dy)}側`;
}

function sizeLabel(school) {
  const sp = SPECIES[school.species];
  let best = sp.sizeOrder[0];
  for (const k of sp.sizeOrder) if (school.counts[k] > school.counts[best]) best = k;
  return `${sp.sizes[best].label}主体`;
}

function layerText(school, t, pose, world = null) {
  if (school.species === 'sawara') return `表層から${Math.max(1, Math.round(pose.z))}mくらい`;
  if (school.species === 'madai') return '底べったり';
  return `底から${Math.max(1, Math.round(offBottomAt(school, t, world)))}mくらい`;
}

/**
 * What a peer noticed about the bite over the last couple of hours (from that
 * day's world at the time — never a hidden label): e.g. the echo was there
 * all morning but nothing bit until the stream started. Null when unremarkable.
 */
function biteRemark(w, school, t) {
  const now = activityAt(w, school, t);
  const before = activityAt(w, school, t - 5400);
  const tpNow = tidePhase(w.cond, t);
  const tpBefore = tidePhase(w.cond, t - 5400);
  if (before < 0.4 && now > before * 2.2) {
    if (tpBefore.slack > 0.5 && tpNow.slack < 0.5) return '潮が止まっている間は反応ばかりで全然食わなかった。潮が動き出したら急に食い始めた';
    if (tpBefore.running > 0.5 && tpNow.running < 0.5) return '潮が速いうちは食わなかったが、緩んできたら食い出した';
    return '朝のうちは反応があっても食わなかったが、途中から食いが立った';
  }
  if (now < 0.35) {
    if (tpNow.slack > 0.5) return '潮が止まっていて、反応はあるのに食いが渋かった';
    if (tpNow.running > 0.5 && tpNow.speed > 0.28) return '潮が速すぎて、仕掛けが落ち着かなかった';
    return '反応はあるのに、どうにも食いが渋かった';
  }
  if (now > 1.3 && tpNow.slack > 0.5) return '潮止まりなのに、なぜか食いがよかった';
  return null;
}

/**
 * 潮表: where a reef-tied school was, said the way a fisher would — which way
 * the stream ran and which face it held on (from that day's world).
 */
function faceRemark(w, school, t) {
  if (!school.holdTo) return null;
  const c = currentAt(w.cond, t);
  if (Math.hypot(c.x, c.y) < 0.08) return '潮止まりで、群れは瀬の上に散っていた';
  return `潮が${compass8(c.x, c.y)}へ流れていて、瀬の潮が当たる側（${compass8(-c.x, -c.y)}側）に付いていた`;
}

function nearest(world, species, x, y, t, radius) {
  let best = null;
  for (const s of world.schools) {
    if (s.species !== species || schoolTotal(s) <= 0) continue;
    const pose = schoolPose(s, t, world);
    const dist = Math.hypot(pose.x - x, pose.y - y);
    if (dist <= radius && (!best || dist < best.dist)) best = { school: s, pose, dist };
  }
  return best;
}

function report(base) {
  return {
    relayedFrom: null,
    species: null,
    methodId: null,
    area: null,
    place: null,
    spot: null,
    count: null,
    layer: null,
    sizeLabel: null,
    opinion: null,
    opinionKind: null,
    via: 'port',
    ...base,
  };
}

/** Where 源さん goes: the reef habitat that held the most アジ two days before (his "known spot"). */
function genSpot(seed, d) {
  if (d - 2 < 0) return 'kita_e';
  const w = worldFor(seed, d - 2);
  let best = 'kita_e';
  let bestN = 0;
  for (const s of w.schools) if (s.species === 'aji' && REEF_HABITATS.includes(s.habitat) && schoolTotal(s) > bestN) {
    bestN = schoolTotal(s);
    best = s.habitat;
  }
  return best;
}

/** 源さん fishing his spot at time t on day od (an observation from that day's world). */
function genFishing(seed, od, spotId, t, idBase) {
  const w = worldFor(seed, od);
  const h = habitat(spotId);
  // he follows his own fish on the reef (they move from face to face with the tide)
  const own = w.schools.find((s) => s.species === 'aji' && s.habitat === spotId && schoolTotal(s) > 0);
  const hit = own ? { school: own, pose: schoolPose(own, t, w), dist: 0 } : nearest(w, 'aji', h.x, h.y, t, 230);
  const originId = `O${od}-gen-${idBase}`;
  if (!hit) {
    return report({
      originId, speaker: 'gen', kind: 'none', species: 'aji', methodId: 'handline',
      area: h.area, place: placeLabel(h.x, h.y), spot: roundPt(h), obsDay: od, obsT: t,
      text: `${placeLabel(h.x, h.y)}で一本釣りをしたが、アジの反応がなかった。`,
      opinion: 'どこかへ移ったんだろう。', opinionKind: '予想',
    });
  }
  const act = activityAt(w, hit.school, t);
  const count = Math.max(3, Math.min(70, Math.round((schoolTotal(hit.school) * act) / 14)));
  const place = placeLabel(hit.pose.x, hit.pose.y);
  const slow = count < 15;
  const other = REEF_HABITATS.filter((id) => id !== spotId).map(habitat).find((x) => x.area === h.area) || habitat('nishi');
  return report({
    originId, speaker: 'gen', kind: 'catch', species: 'aji', methodId: 'handline',
    area: hit.school.area, place, spot: roundPt(hit.pose), obsDay: od, obsT: t, count,
    layer: layerText(hit.school, t, hit.pose, w), sizeLabel: sizeLabel(hit.school),
    text: `${place}で${sizeLabel(hit.school)}に約${count}尾${slow ? '。食いが落ちていた' : ''}。${layerText(hit.school, t, hit.pose, w)}で食った。${remarkText(faceRemark(w, hit.school, t))}${remarkText(biteRemark(w, hit.school, t))}`,
    opinion: slow ? `群れが抜け始めたかもしれん。${placeLabel(other.x, other.y)}あたりも見てみる。` : 'しばらくは同じあたりに付いていると思う。',
    opinionKind: '予想',
  });
}

/** 浜田さん trolling his loop through the サワラ zones between t0 and t1 on day od. */
function hamadaTrolling(seed, od, t0, idBase, stepS = 2700) {
  const w = worldFor(seed, od);
  const order = ['higashi', 'kita_oki', 'oki'];
  const originId = `O${od}-hamada-${idBase}`;
  for (let k = 0; k < order.length; k++) {
    const z = SAWARA_ZONES.find((x) => x.id === order[k]);
    const t = round10min(t0 + k * stepS);
    const hit = nearest(w, 'sawara', z.x, z.y, t, 360);
    if (hit) {
      const act = activityAt(w, hit.school, t);
      const count = Math.max(1, Math.min(5, Math.round((schoolTotal(hit.school) * act) / 18)));
      const place = placeLabel(hit.pose.x, hit.pose.y);
      return report({
        originId, speaker: 'hamada', kind: 'catch', species: 'sawara', methodId: 'troll',
        area: hit.school.area, place, spot: roundPt(hit.pose), obsDay: od, obsT: t, count,
        layer: layerText(hit.school, t, hit.pose, w), sizeLabel: sizeLabel(hit.school),
        text: `${place}を曳いてサワラを${count}本。${layerText(hit.school, t, hit.pose, w)}の層に付いていた。`,
        opinion: count >= 3 ? '群れが入ってきている。何日かは楽しめそうだ。' : 'まだぽつぽつだな。',
        opinionKind: '予想',
      });
    }
  }
  return report({
    originId, speaker: 'hamada', kind: 'none', species: 'sawara', methodId: 'troll',
    area: '沖の平場', place: '沖（東の駆け上がり〜北の瀬の沖〜沖の平場）', spot: null, obsDay: od, obsT: round10min(t0),
    text: '沖を一回り曳いたが、サワラの気配はなかった。',
  });
}

/**
 * Which ground 松じい lays his line on, on day od: his own habit — in the
 * 乗っ込み season (known from the water temperature, like everyone in port)
 * he goes to the flank of 北の瀬. Not a fish lookup.
 */
function matsuGround(seed, od) {
  if (makeDayConditions(seed, od).season.nokkomi) return MADAI_GROUNDS.find((g) => g.nokkomi);
  const usual = MADAI_GROUNDS.filter((g) => !g.nokkomi && !g.far); // his old boat stays near the coast
  return usual[Math.floor(hashFloat(seed, od, 501) * usual.length)];
}

/** 松じい's longline on day od, hauled at time t: what it caught where it lay. */
function matsuLongline(seed, od, t, idBase) {
  const w = worldFor(seed, od);
  const g = matsuGround(seed, od);
  const originId = `O${od}-matsu-${idBase}`;
  const hit = nearest(w, 'madai', g.x, g.y, t, 380);
  if (!hit) {
    return report({
      originId, speaker: 'matsu', kind: 'none', species: 'madai', methodId: 'longline',
      area: g.area, place: placeLabel(g.x, g.y), spot: roundPt(g), obsDay: od, obsT: t,
      text: `${placeLabel(g.x, g.y)}に縄を入れたが、マダイは掛からなかった。`,
      opinion: 'あそこからは離れたようだ。', opinionKind: '予想',
    });
  }
  const act = activityAt(w, hit.school, t);
  const count = Math.max(1, Math.min(15, Math.round((schoolTotal(hit.school) * act) / 14)));
  const place = placeLabel(hit.pose.x, hit.pose.y);
  return report({
    originId, speaker: 'matsu', kind: 'catch', species: 'madai', methodId: 'longline',
    area: hit.school.area, place, spot: roundPt(hit.pose), obsDay: od, obsT: t, count,
    layer: '底べったり', sizeLabel: sizeLabel(hit.school),
    text: `${place}に縄を入れて、マダイを${count}枚（${sizeLabel(hit.school)}）。${remarkText(biteRemark(w, hit.school, t))}`,
    opinion: count >= 6 ? 'あの辺りの底にはしばらく居着いている。' : '数は薄い。広く散っているようだ。',
    opinionKind: '予想',
  });
}

const remarkText = (r) => (r ? `${r}。` : '');

/** Where 黒木さん fishes on day od: one of the rocky grounds or a 漁礁 he knows (his habit, not a fish lookup). */
const KUROKI_SPOTS = [
  { id: 'nishi_rock', x: 650, y: 1350 },
  { id: 'kita_rock', x: 2000, y: 2250 },
  { id: 'g1', x: 1300, y: 1050 },
  { id: 'g4', x: 900, y: 850 },
  { id: 'k3', x: 480, y: 1150 },
];
const NEGYO = ['kasago', 'kijihata', 'ara', 'oomonhata', 'akahata'];

/** 黒木さん's 根魚釣り on day od around time t: what came up, and how the bite went with the tide. */
function kurokiNegyo(seed, od, t, idBase) {
  const w = worldFor(seed, od);
  const spot = KUROKI_SPOTS[Math.floor(hashFloat(seed, od, 521) * KUROKI_SPOTS.length)];
  const originId = `O${od}-kuroki-${idBase}`;
  const here = w.schools.filter((s) => NEGYO.includes(s.species) && schoolTotal(s) > 0 && Math.hypot(s.a.x - spot.x, s.a.y - spot.y) < 80);
  const place = placeLabel(spot.x, spot.y);
  if (!here.length) {
    return report({
      originId, speaker: 'kuroki', kind: 'none', species: 'kasago', methodId: 'negyo',
      area: areaNameAt(spot.x, spot.y), place, spot: roundPt(spot), obsDay: od, obsT: t,
      text: `${place}の根を回ったが、根魚の当たりはなかった。`,
    });
  }
  const by = {};
  let total = 0;
  let main = here[0];
  for (const s of here) {
    const n = Math.round((schoolTotal(s) * activityAt(w, s, t)) / 5);
    if (n > 0) by[s.species] = (by[s.species] || 0) + n;
    total += n;
    if (schoolTotal(s) > schoolTotal(main)) main = s;
  }
  const list = Object.entries(by).map(([sp, n]) => `${SPECIES[sp].name}${n}`).join('・');
  return report({
    originId, speaker: 'kuroki', kind: total > 0 ? 'catch' : 'none', species: main.species, methodId: 'negyo',
    area: areaNameAt(spot.x, spot.y), place, spot: roundPt(spot), obsDay: od, obsT: t, count: total,
    text: total > 0 ? `${place}の根で${list}尾。${remarkText(biteRemark(w, main, t))}` : `${place}の根で粘ったが、食わなかった。${remarkText(biteRemark(w, main, t))}`,
    opinion: total > 0 ? '根魚は居着きだから、根さえ外さなければまた食う。' : '潮の具合が合わんかったな。', opinionKind: '予想',
  });
}

/** 小田さん's 泳がせ on day od around time t: around the reefs and under the bait. */
function odaOyogase(seed, od, t, idBase) {
  const w = worldFor(seed, od);
  const originId = `O${od}-oda-${idBase}`;
  const isBlue = (s) => SPECIES[s.species].habit === 'roam' && schoolTotal(s) > 0;
  const inReach = (s) => s.a.y < 3000; // his boat stays inside the coastal zone
  const blue = w.schools.filter((s) => isBlue(s) && inReach(s));
  const pick = blue.length ? blue[Math.floor(hashFloat(seed, od, 531) * blue.length)] : null;
  if (!pick) {
    const bait = w.schools.find((s) => SPECIES[s.species].bait && schoolTotal(s) > 0 && inReach(s));
    const at = bait ? schoolPose(bait, t, w) : { x: 1350, y: 1700 };
    return report({
      originId, speaker: 'oda', kind: 'none', species: 'buri', methodId: 'oyogase',
      area: areaNameAt(at.x, at.y), place: placeLabel(at.x, at.y), spot: roundPt(at), obsDay: od, obsT: t,
      text: bait ? `${placeLabel(at.x, at.y)}でベイトの反応は見たが、下に青物は付いていなかった。` : '根の周りもベイトも探したが、青物の反応はなかった。',
    });
  }
  const pose = schoolPose(pick, t, w);
  const act = activityAt(w, pick, t);
  const count = Math.max(0, Math.min(6, Math.round((schoolTotal(pick) * act) / 7)));
  const place = placeLabel(pose.x, pose.y);
  const under = pick.baitDepth ? (pick.holdTo ? '瀬に溜まったベイトの下で' : 'ベイトの下で') : '根の周りで';
  return report({
    originId, speaker: 'oda', kind: count > 0 ? 'catch' : 'echo', species: pick.species, methodId: 'oyogase',
    area: pick.area || areaNameAt(pose.x, pose.y), place, spot: roundPt(pose), obsDay: od, obsT: t, count,
    layer: `表層から${Math.round(pose.z)}mくらい`,
    text: count > 0
      ? `${place}の${under}、活きアジで${SPECIES[pick.species].name}を${count}本。${remarkText(faceRemark(w, pick, t))}${remarkText(biteRemark(w, pick, t))}`
      : `${place}の${under}青物の反応は出ていたが、活きアジに食わなかった。${remarkText(faceRemark(w, pick, t))}${remarkText(biteRemark(w, pick, t))}`,
    opinion: pick.baitDepth ? '曳縄で食わん日でも、ベイトの下に活きエサを落とすと食うことがある。' : '根に付いた青物はしばらく居る。', opinionKind: '見立て',
  });
}

/** 中村さん's ジギング on day od around time t: 青物 round the reefs and under the bait — and the サバ. */
function nakamuraJigging(seed, od, t, idBase) {
  const w = worldFor(seed, od);
  const originId = `O${od}-nakamura-${idBase}`;
  const inReach = (s) => s.a.y < 3000;
  const blue = w.schools.filter((s) => (SPECIES[s.species].habit === 'roam' || s.species === 'sawara' || s.species === 'yokowa') && schoolTotal(s) > 0 && inReach(s));
  const saba = w.schools.find((s) => s.species === 'masaba' && schoolTotal(s) > 0 && inReach(s));
  const pick = blue.length ? blue[Math.floor(hashFloat(seed, od, 551) * blue.length)] : null;
  if (!pick) {
    const at = saba ? schoolPose(saba, t, w) : { x: 1400, y: 1800 };
    return report({
      originId, speaker: 'nakamura', kind: saba ? 'catch' : 'none', species: saba ? 'masaba' : 'buri', methodId: 'jigging',
      area: areaNameAt(at.x, at.y), place: placeLabel(at.x, at.y), spot: roundPt(at), obsDay: od, obsT: t, count: saba ? 10 : 0,
      text: saba ? `${placeLabel(at.x, at.y)}でしゃくったが、中層のサバばかりだった。青物の反応はなかった。` : 'あちこちしゃくって回ったが、青物の気配がなかった。',
    });
  }
  const pose = schoolPose(pick, t, w);
  const count = Math.max(0, Math.min(5, Math.round((schoolTotal(pick) * activityAt(w, pick, t)) / 9)));
  const place = placeLabel(pose.x, pose.y);
  const nearSaba = saba && Math.hypot(schoolPose(saba, t, w).x - pose.x, schoolPose(saba, t, w).y - pose.y) < 500;
  return report({
    originId, speaker: 'nakamura', kind: count > 0 ? 'catch' : 'echo', species: pick.species, methodId: 'jigging',
    area: pick.area || areaNameAt(pose.x, pose.y), place, spot: roundPt(pose), obsDay: od, obsT: t, count,
    layer: `表層から${Math.round(pose.z)}mくらい`,
    text: count > 0
      ? `${place}でジギング、${SPECIES[pick.species].name}を${count}本。${nearSaba ? '途中サバに邪魔された。' : ''}${remarkText(faceRemark(w, pick, t))}${remarkText(biteRemark(w, pick, t))}`
      : `${place}で青物の反応は出ていたが、ジグには食わなかった。${remarkText(faceRemark(w, pick, t))}${remarkText(biteRemark(w, pick, t))}`,
    opinion: pick.baitDepth ? 'ベイトの下を通すように、反応の少し上までしゃくるといい。' : '根の周りは根掛かりに気をつけろ。ジグがいくつあっても足りん。', opinionKind: '見立て',
  });
}

/** 吉村さん's night under the lamps (day od, about 21:00): told in port the next morning. */
function yoshimuraIka(seed, od, idBase) {
  const w = worldFor(seed, od);
  const t = 21 * 3600;
  const originId = `O${od}-yoshimura-${idBase}`;
  const squid = w.schools.filter((s) => SPECIES[s.species].habit === 'squid' && schoolTotal(s) > 0 && s.a.y < 3000);
  if (!squid.length) {
    return report({
      originId, speaker: 'yoshimura', kind: 'none', species: 'kensaki', methodId: 'ika',
      area: '沖の深み', place: '沖の深み', spot: roundPt({ x: 650, y: 2600 }), obsDay: od, obsT: t,
      text: '昨夜は沖の深みで灯を点けたが、イカは寄ってこなかった。',
    });
  }
  const s = squid[Math.floor(hashFloat(seed, od, 541) * squid.length)];
  const pose = schoolPose(s, t, w);
  const count = Math.max(0, Math.min(90, Math.round((schoolTotal(s) * activityAt(w, s, t)) / 18)));
  return report({
    originId, speaker: 'yoshimura', kind: count > 0 ? 'catch' : 'none', species: s.species, methodId: 'ika',
    area: areaNameAt(pose.x, pose.y), place: placeLabel(pose.x, pose.y), spot: roundPt(pose), obsDay: od, obsT: t, count,
    text: count > 0 ? `昨夜、${placeLabel(pose.x, pose.y)}で灯を点けて、${SPECIES[s.species].name}を${count}杯。暗くなって1〜2時間で寄ってきた。` : `昨夜、${placeLabel(pose.x, pose.y)}で灯を点けたが、ほとんど乗らなかった。`,
    opinion: count >= 30 ? 'しばらくはあの辺りに付いていると思う。' : null, opinionKind: count >= 30 ? '予想' : null,
  });
}

/** Morning passes on the way out: sounder echo or surface signs (with an estimate, not a catch). */
function morningPass(seed, d, who, x, y, t, label, idBase) {
  const w = worldFor(seed, d);
  const originId = `O${d}-${who}-${idBase}`;
  const saw = nearest(w, 'sawara', x, y, t, 380);
  const light = daylightAt({ rise: w.cond.sun.sunrise, set: w.cond.sun.sunset }, t);
  if (saw && light < 0.3) {
    // before dawn nothing shows on the surface — but the sounder picks up the school passing under
    return report({
      originId, speaker: who, kind: 'echo', species: 'sawara', methodId: 'troll',
      area: saw.school.area, place: placeLabel(saw.pose.x, saw.pose.y), spot: roundPt(saw.pose), obsDay: d, obsT: t,
      layer: layerText(saw.school, t, saw.pose, w),
      text: `暗いうちに${placeLabel(saw.pose.x, saw.pose.y)}を通ったら、魚探の${layerText(saw.school, t, saw.pose, w)}に大きめの魚の反応が点々と出ていた。`,
      opinion: 'あの層を走る群れなら、サワラが入っているのかもしれない。', opinionKind: '見立て',
    });
  }
  if (saw && saw.pose.z < 6.5) {
    return report({
      originId, speaker: who, kind: 'sighting', species: 'sawara', methodId: 'troll',
      area: saw.school.area, place: placeLabel(saw.pose.x, saw.pose.y), spot: roundPt(saw.pose), obsDay: d, obsT: t,
      text: `${placeLabel(saw.pose.x, saw.pose.y)}で鳥が騒いで、表層で小魚が跳ねていた。`,
      opinion: 'サワラが小魚を追っているのかもしれない。', opinionKind: '見立て',
    });
  }
  const aji = nearest(w, 'aji', x, y, t, 200);
  if (aji) {
    return report({
      originId, speaker: who, kind: 'echo', species: 'aji', methodId: 'handline',
      area: aji.school.area, place: placeLabel(aji.pose.x, aji.pose.y), spot: roundPt(aji.pose), obsDay: d, obsT: t,
      layer: layerText(aji.school, t, aji.pose, w),
      text: `${placeLabel(aji.pose.x, aji.pose.y)}を通ったら、魚探に${layerText(aji.school, t, aji.pose, w)}の反応があった。竿は出していない。`,
      opinion: 'あの付き方ならアジだろう。', opinionKind: '見立て',
    });
  }
  return report({
    originId, speaker: who, kind: 'none', species: null, methodId: null,
    area: areaNameAt(x, y), place: label, spot: roundPt({ x, y }), obsDay: d, obsT: t,
    text: `${label}を通ったが、魚探に目立つ反応はなかった。`,
  });
}

/** Rules of thumb (経験則): tied to today's forecast, never to hidden fish. */
function rules(seed, d, hadSawara) {
  const fc = forecastOf(makeDayConditions(seed, d));
  const out = [];
  if (tideClass(fc.tideName) === '大潮') {
    out.push(report({ originId: `O${d}-gen-rule-tide`, speaker: 'gen', kind: 'rule', methodId: 'handline', obsDay: d, obsT: BRIEFING_T, text: '大潮は潮が速い。流しが短くなるから、こまめに流し直すといい。' }));
  }
  if (fc.windSpeed >= 6) {
    out.push(report({ originId: `O${d}-gen-rule-wind`, speaker: 'gen', kind: 'rule', methodId: 'handline', obsDay: d, obsT: BRIEFING_T, text: '今日みたいに風が強い日は、船が流されて瀬の上に留まりにくい。' }));
  }
  if (d >= PEERS.matsu.fromDay) {
    if (fc.season && fc.season.nokkomi) {
      out.push(report({ originId: `O${d}-matsu-rule-nokkomi`, speaker: 'matsu', kind: 'rule', species: 'madai', methodId: 'longline', obsDay: d, obsT: BRIEFING_T, text: '水温が上がってきた。この頃はマダイが瀬の肩に寄ってくる（乗っ込み）。北の瀬の裾あたりだな。' }));
    } else if (tideClass(fc.tideName) === '小潮系') {
      out.push(report({ originId: `O${d}-matsu-rule-tide`, speaker: 'matsu', kind: 'rule', species: 'madai', methodId: 'longline', obsDay: d, obsT: BRIEFING_T, text: '潮の緩い日のマダイは、潮が動き出すころにならんと食わん。' }));
    } else if (hashFloat(seed, d, 502) < 0.5) {
      out.push(report({ originId: `O${d}-matsu-rule-soak`, speaker: 'matsu', kind: 'rule', species: 'madai', methodId: 'longline', obsDay: d, obsT: BRIEFING_T, text: '延縄は餌が持つうちに揚げるもんだ。浸けて1時間前後が目安だな。' }));
    }
  }
  if (d >= PEERS.kuroki.fromDay && tideClass(fc.tideName) === '大潮' && hashFloat(seed, d, 524) < 0.6) {
    out.push(report({ originId: `O${d}-kuroki-rule-tide`, speaker: 'kuroki', kind: 'rule', methodId: 'negyo', obsDay: d, obsT: BRIEFING_T, text: '大潮は潮が速くて底が取りにくい。根魚は潮の緩む時間に勝負だ。潮止まりの前後を狙え。' }));
  }
  if (d >= PEERS.oda.fromDay) {
    if (hashFloat(seed, d, 534) < 0.5) {
      out.push(report({ originId: `O${d}-oda-rule-bait`, speaker: 'oda', kind: 'rule', methodId: 'oyogase', obsDay: d, obsT: BRIEFING_T, text: '表層にベイトがいて曳縄に食わん日は、まず一本釣りでアジを釣って生け簀に入れとく。ベイトの下に太い山形の反応が出たら、そこで止めて泳がせだ。' }));
    } else {
      out.push(report({ originId: `O${d}-oda-rule-face`, speaker: 'oda', kind: 'rule', methodId: 'oyogase', obsDay: d, obsT: BRIEFING_T, text: '瀬や大きな根に潮が当たると、その面にエサが溜まってイワシが寄る。青物はその下だ。潮表でベイトの反応を探して、潮が動いとるうちに活きアジを落とせ。潮が止まったら食わん。' }));
    }
  }
  if (hashFloat(seed, d, 535) < 0.35) {
    out.push(report({ originId: `O${d}-gen-rule-face`, speaker: 'gen', kind: 'rule', methodId: 'handline', obsDay: d, obsT: BRIEFING_T, text: '瀬のアジは潮の当たる側（潮表）に付く。北東へ流れる上げ潮なら南西側、南西へ流れる下げ潮なら北東側だ。潮が変われば反対の面へ回れ。' }));
  }
  if (tideClass(fc.tideName) === '小潮系' && hashFloat(seed, d, 308) < 0.6) {
    out.push(report({ originId: `O${d}-gen-rule-slack`, speaker: 'gen', kind: 'rule', methodId: 'handline', obsDay: d, obsT: BRIEFING_T, text: 'アジは潮が止まると、反応があっても食わん。潮が動き出す時間を潮汐表で見ておけ。' }));
  }
  if (!hadSawara && fc.season && fc.season.id === 'spring' && fc.waterTemp >= SPECIES.sawara.arriveTemp - 0.3 && fc.waterTemp < SPECIES.sawara.arriveTemp + 1.5) {
    out.push(report({ originId: `O${d}-hamada-rule-temp`, speaker: 'hamada', kind: 'rule', species: 'sawara', methodId: 'troll', obsDay: d, obsT: BRIEFING_T, text: `春は水温が${SPECIES.sawara.arriveTemp.toFixed(0)}℃を超えてくると、サワラが沖に入ってくる。秋から冬はまた別の群れが来る。` }));
  }
  return out;
}

/** Reports a player hears in port on the morning of day d (before acquisition stamps). */
export function briefingReports(seed, d) {
  const out = [];
  const stormYesterday = d - 1 >= 1 && weatherOf(seed, d - 1).storm;
  const stormToday = weatherOf(seed, d).storm;
  if (stormYesterday) out.push(report({ originId: `O${d}-gen-storm-y`, speaker: 'gen', kind: 'rule', methodId: null, obsDay: d - 1, obsT: BRIEFING_T, text: '昨日は時化で、誰も出られなかった。' }));
  if (stormToday) {
    out.push(report({ originId: `O${d}-gen-storm`, speaker: 'gen', kind: 'rule', methodId: null, obsDay: d, obsT: BRIEFING_T, text: '今日は時化だ。こんな日に出るもんじゃない。' }));
    return out.map((r, i) => ({ ...r, id: `R${d}-${i}-${r.speaker}` }));
  }
  if (d - 1 >= 0 && !stormYesterday) {
    const spot = genSpot(seed, d);
    const tGen = round10min((7 + hashFloat(seed, d, 301) * 2.5) * 3600);
    out.push(genFishing(seed, d - 1, spot, tGen, 'y'));
    const tHam = (6 + hashFloat(seed, d, 302) * 0.8) * 3600;
    out.push(hamadaTrolling(seed, d - 1, tHam, 'y'));
  }
  if (d >= PEERS.matsu.fromDay && !stormYesterday) {
    const tMat = round10min((9 + hashFloat(seed, d, 503) * 1.5) * 3600);
    out.push(matsuLongline(seed, d - 1, tMat, 'y'));
  }
  if (d >= PEERS.kuroki.fromDay && d - 1 >= 1) out.push(kurokiNegyo(seed, d - 1, round10min((8 + hashFloat(seed, d, 522) * 4) * 3600), 'y'));
  if (d >= PEERS.oda.fromDay && d - 1 >= 1) out.push(odaOyogase(seed, d - 1, round10min((6 + hashFloat(seed, d, 532) * 3) * 3600), 'y'));
  if (d >= PEERS.nakamura.fromDay && d - 1 >= 1) out.push(nakamuraJigging(seed, d - 1, round10min((6 + hashFloat(seed, d, 552) * 4) * 3600), 'y'));
  if (d >= PEERS.yoshimura.fromDay && d - 1 >= 1) out.push(yoshimuraIka(seed, d - 1, 'y'));
  // this morning: 源さん passes another reef, 浜田さん the slope on the way out
  const reefs = REEF_HABITATS.filter((id) => id !== genSpot(seed, d));
  const pass = habitat(reefs[Math.floor(hashFloat(seed, d, 303) * reefs.length)]);
  out.push(morningPass(seed, d, 'gen', pass.x, pass.y, round10min(BRIEFING_T - 2400 + hashFloat(seed, d, 304) * 1200), placeLabel(pass.x, pass.y), 'm')); // out in the dark, before the briefing
  const z = SAWARA_ZONES[0];
  out.push(morningPass(seed, d, 'hamada', z.x, z.y, round10min(BRIEFING_T - 1800 + hashFloat(seed, d, 305) * 900), '東の駆け上がりの沖', 'm'));
  const hadSawara = out.some((r) => r.species === 'sawara' && (r.kind === 'catch' || r.kind === 'sighting'));
  out.push(...rules(seed, d, hadSawara));
  // a relay: one peer passes on the other's report (same origin = not independent evidence)
  const ham = out.find((r) => r.speaker === 'hamada' && r.kind === 'catch');
  const gen = out.find((r) => r.speaker === 'gen' && r.kind === 'catch' && r.obsDay === d - 1);
  if (ham && hashFloat(seed, d, 306) < 0.6) {
    out.push({ ...ham, speaker: 'gen', relayedFrom: 'hamada', text: `浜田が言うには、${ham.text}`, opinion: null, opinionKind: null });
  } else if (gen && hashFloat(seed, d, 307) < 0.5) {
    out.push({ ...gen, speaker: 'hamada', relayedFrom: 'gen', text: `源さんの話だと、${gen.text}`, opinion: null, opinionKind: null });
  }
  return out.map((r, i) => ({ ...r, id: `R${d}-${i}-${r.speaker}` }));
}

/** Radio calls during day d; each becomes known at deliverAt. */
export function radioReports(seed, d) {
  // calls made over the radio while the player is out: what each peer has right now
  const out = [];
  if (weatherOf(seed, d).storm) return out; // nobody is out in a storm
  const tH = round10min((6 + hashFloat(seed, d, 311) * 1.2) * 3600);
  out.push(hamadaTrolling(seed, d, tH, 'r', 0));
  const spot = genSpot(seed, d + 1); // today's choice: where he did well yesterday
  const tG = round10min((6.8 + hashFloat(seed, d, 312) * 1.2) * 3600);
  out.push(genFishing(seed, d, spot, tG, 'r'));
  if (d >= PEERS.matsu.fromDay) {
    const tM = round10min((7.6 + hashFloat(seed, d, 504) * 1.0) * 3600);
    out.push(matsuLongline(seed, d, tM, 'r'));
  }
  if (d >= PEERS.kuroki.fromDay) out.push(kurokiNegyo(seed, d, round10min((8.5 + hashFloat(seed, d, 523) * 2) * 3600), 'r'));
  if (d >= PEERS.oda.fromDay) out.push(odaOyogase(seed, d, round10min((7 + hashFloat(seed, d, 533) * 2) * 3600), 'r'));
  if (d >= PEERS.nakamura.fromDay) out.push(nakamuraJigging(seed, d, round10min((6.5 + hashFloat(seed, d, 553) * 2) * 3600), 'r'));
  return out.map((r, i) => ({ ...r, via: 'radio', id: `W${d}-${i}-${r.speaker}`, deliverAt: r.obsT + 600 }));
}

export function peerName(id) {
  return PEERS[id] ? PEERS[id].name : id;
}

export const KIND_LABEL = { catch: '水揚げ', none: '反応なし', echo: '魚探の反応', sighting: '目撃', rule: '経験則' };

export function methodName(id) {
  return METHODS[id] ? METHODS[id].name : '';
}

/** One-line rendering with observation time and when the player heard it. */
export function reportLine(r, today) {
  const when = r.kind === 'rule' ? '経験則' : `${dayWord(r.obsDay, today, r.obsT)}${fmtClock(r.obsT)}の${KIND_LABEL[r.kind]}`;
  const heard = r.acqDay != null ? `${dayWord(r.acqDay, today, r.acqT)}${fmtClock(r.acqT)}に${r.via === 'radio' ? '無線で' : '港で'}聞いた` : '';
  const relay = r.relayedFrom ? `〔${peerName(r.relayedFrom)}の話の又聞き〕` : '';
  return { who: peerName(r.speaker), when, heard, relay, text: r.text, opinion: r.opinion ? `${r.opinionKind}：${r.opinion}` : null };
}

export function dayWord(d, today, t = null) {
  if (d === today) return t != null && t < 9 * 3600 ? '今朝' : '今日';
  if (d === today - 1) return '昨日';
  if (d < today) return `${today - d}日前`;
  return `${d}日目`;
}
