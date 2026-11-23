// What the player knows, and today's candidates built ONLY from it:
// acquired peer reports, the player's own logbook and today's forecast.
// Nothing here may read the live world (fish positions) — candidates must not
// reveal unobserved fish (handover §7.4, A10).
import { METHODS, SPECIES, EQUIPMENT, BOATS, TIME_BANDS, BRIEFING_T, fits } from './data.js';
import { tideClass, windBand, CHART_LABELS } from './sea.js';
import { briefingReports, dayWord, peerName, KIND_LABEL } from './reports.js';
import { levelFromXp } from './progress.js';

export const MAX_REPORTS = 150;

export function timeBandOf(t) {
  const h = t / 3600;
  return (TIME_BANDS.find((b) => h >= b.from && h < b.to) || TIME_BANDS[TIME_BANDS.length - 1]).id;
}
export function timeBandLabel(id) {
  return (TIME_BANDS.find((b) => b.id === id) || {}).label || id;
}

/** Condition tags of a log (derived from stored fields, so M0 logs work too). */
export function logTags(log) {
  const c = log.conditions || {};
  return {
    timeBand: timeBandOf(log.startT),
    tideClass: tideClass(c.tideName),
    windBand: windBand(c.wind ? c.wind.speed : 0),
  };
}

export function emptyKnowledge() {
  return { reports: [], briefedDay: 0 };
}

function addReports(knowledge, reports) {
  const have = new Set(knowledge.reports.map((r) => r.id));
  for (const r of reports) if (!have.has(r.id)) knowledge.reports.push(r);
  if (knowledge.reports.length > MAX_REPORTS) knowledge.reports.splice(0, knowledge.reports.length - MAX_REPORTS);
}

/**
 * Hear the port talk for day d (once). Returns a new profile. Acquisition time
 * is stamped here; the observation time stays whatever it was.
 */
export function acquireBriefing(profile, d) {
  if (profile.knowledge.briefedDay >= d) return profile;
  const p = JSON.parse(JSON.stringify(profile));
  const reps = briefingReports(p.worldSeed, d).map((r) => ({ ...r, acqDay: d, acqT: BRIEFING_T }));
  addReports(p.knowledge, reps);
  p.knowledge.briefedDay = d;
  return p;
}

/** Radio reports heard at sea, stamped with the time they were heard. */
export function addHeardReports(profile, heard) {
  addReports(profile.knowledge, heard);
}

export function todaysReports(knowledge, d) {
  return knowledge.reports.filter((r) => r.acqDay === d).sort((a, b) => a.obsDay - b.obsDay || a.obsT - b.obsT);
}

// ---------------------------------------------------------------------------
// Logbook comparison

export function opRate(log) {
  return log.durationS > 0 ? (log.count / log.durationS) * 3600 : 0;
}

export function isGood(log) {
  const m = METHODS[log.methodId || 'handline'];
  return log.durationS >= 600 && opRate(log) >= m.goodRate;
}

/** Items of a type fitted on the boat now, in slot order (e.g. both reels). */
export function gearOfType(profile, type) {
  const model = BOATS[profile.boat.model];
  return model.slots.map((sl) => profile.boat.slots[sl.id]).filter((inst) => inst && EQUIPMENT[inst.itemId].type === type).map((inst) => inst.itemId);
}

/** A comparable signature of the gear a method uses: boat + its rigs. */
function gearSig(boat, items) {
  return `${boat}:${items.join('+')}`;
}

/** The items fitted now that a method uses (the longline also counts the line hauler). */
export function methodGear(profile, methodId) {
  const items = gearOfType(profile, METHODS[methodId].gearType);
  return methodId === 'longline' ? [...items, ...gearOfType(profile, 'hauler')] : items;
}

function currentGearSig(profile, methodId) {
  return gearSig(profile.boat.model, methodGear(profile, methodId));
}

/** The items a logged operation used for its method (old logs: one reel). */
export function logGearItems(log) {
  const g = log.gear || {};
  if (log.methodId === 'troll') return [g.troll].filter(Boolean);
  if (log.methodId === 'longline') return [g.longline, g.hauler].filter(Boolean);
  return g.reels || [g.reel].filter(Boolean);
}

function logGearSig(log) {
  return gearSig((log.gear && log.gear.boat) || 'skiff_1', logGearItems(log));
}

function gearText(boatId, items) {
  const names = items.map((id) => (EQUIPMENT[id] ? EQUIPMENT[id].name : id));
  return `${BOATS[boatId] ? BOATS[boatId].name : boatId}・${names.join('＋') || 'なし'}`;
}

/**
 * Own records for a method at an area, and the subset recorded under conditions
 * like today's (same tide class and wind band). Text never states a probability.
 */
export function similarLogs(logs, { methodId, area, forecast, profile }) {
  const same = logs.filter((l) => (l.methodId || 'handline') === methodId && l.area === area);
  const tc = tideClass(forecast.tideName);
  const wb = windBand(forecast.windSpeed);
  const similar = same.filter((l) => {
    const g = logTags(l);
    return g.tideClass === tc && g.windBand === wb;
  });
  const good = similar.filter(isGood).length;
  const withCatch = same.filter((l) => l.count > 0).length;
  const lines = [];
  const m = METHODS[methodId];
  if (!same.length) lines.push('自分の記録なし（未経験）');
  else if (!similar.length) lines.push(`この場所の記録${same.length}回（漁獲あり${withCatch}回）。今日と同じ潮・風（${tc}・風${wb}）の記録はなし`);
  else if (similar.length === 1) lines.push(`似た条件（${tc}・風${wb}）の記録は1回だけ：${good ? '好調' : '振るわず'}（1回の実績で、傾向とまでは言えない）`);
  else lines.push(`似た条件（${tc}・風${wb}）で${similar.length}回操業し、${good}回は好調（${m.goodRate}${SPECIES[m.target].unit}/時以上）`);
  const ref = similar[similar.length - 1] || same[same.length - 1];
  if (ref && profile) {
    const cur = currentGearSig(profile, methodId);
    const was = logGearSig(ref);
    if (was !== cur) {
      const [wb, wi] = was.split(':');
      const [cb, ci] = cur.split(':');
      lines.push(`前回の装備は${gearText(wb, wi ? wi.split('+') : [])}（現在は${gearText(cb, ci ? ci.split('+') : [])}）`);
    }
    const lvNow = levelFromXp(profile.methods[methodId].xp);
    if (ref.level != null && Math.abs(lvNow - ref.level) >= 2) lines.push(`前回は${m.name}Lv${ref.level}（現在Lv${lvNow}）`);
  }
  return { same, similar, good, withCatch, lines, tags: { tideClass: tc, windBand: wb } };
}

// ---------------------------------------------------------------------------
// Today's candidates

// Fishing grounds known to everybody (geography + general knowledge, not fish).
const GROUNDS = {
  handline: ['北の瀬', '西の根', '東の駆け上がり', '沖の瀬'],
  troll: ['東の駆け上がり', '沖の平場', '北の瀬'],
  longline: ['沖の平場', '東の駆け上がり', '西の根', '北の瀬', '沖の瀬'],
  negyo: ['西の根', '北の瀬', '沖の瀬'],
  oyogase: ['北の瀬', '沖の瀬'],
};
// grounds outside the coastal zone (general knowledge: geography, not fish)
const FAR_NOTE = { 沖の瀬: '沖の瀬：港から約4km。遠くて人が少なく、群れが大きく大型が多いと言われる（一般的な目安）。中型漁船でないと行けない' };
const GENERAL = {
  handline: 'アジは瀬・根・駆け上がりなど起伏のある場所に付きやすい（一般的な目安）',
  troll: 'サワラは水温が上がると沖や駆け上がりに回ってくる（一般的な目安）',
  longline: 'マダイは水深30〜60mの平場や駆け上がりの底に、広く散って付く（一般的な目安）',
  oyogase: '青物（ブリ・ヒラマサ）は瀬や大きな根の周り、ベイト（イワシ）の群れの下を回る。先に一本釣りでアジを釣って活きエサにする（一般的な目安）',
  negyo: 'カサゴ・キジハタは岩礁・根・漁礁の際の底に居着く。海図にない小さな根や漁礁は、魚探・ソナー・サイドビューで探して印を付ける（一般的な目安）',
};
// a peer's catch count regarded as good / poor for the method (for weighting only)
const REPORT_COUNTS = { handline: [25, 15], troll: [3, 2], longline: [6, 3], negyo: [8, 4], oyogase: [3, 1] };
const KIND_W = { catch: 3, echo: 2, sighting: 2 };

function freshW(obsDay, today) {
  const age = today - obsDay;
  if (age <= 0) return 1;
  if (age === 1) return 0.8;
  if (age === 2) return 0.25;
  return 0.05;
}

const isOutcome = (r) => r.kind === 'catch' || r.kind === 'none';

/** A peer's newer fishing result at a ground replaces his older ones there. */
function markSuperseded(entries) {
  const newest = new Map();
  for (const e of entries) {
    const r = e.origin;
    if (!isOutcome(r)) continue;
    const prev = newest.get(r.speaker);
    if (!prev || r.obsDay > prev.obsDay || (r.obsDay === prev.obsDay && r.obsT > prev.obsT)) newest.set(r.speaker, r);
  }
  for (const e of entries) {
    const r = e.origin;
    e.superseded = isOutcome(r) && newest.get(r.speaker) !== r;
  }
}

function anchor(area) {
  const a = CHART_LABELS.find((l) => l.name === area);
  return a ? { x: a.x, y: a.y } : null;
}

/**
 * Build 2-4 candidates (target fish × method × area) from knowledge only.
 * Inputs: { knowledge, logs, today, forecast, profile }.
 */
export function buildCandidates({ knowledge, logs, today, forecast, profile }) {
  const byKey = new Map();
  const get = (methodId, area) => {
    const key = `${methodId}:${area}`;
    if (!byKey.has(key)) {
      byKey.set(key, { key, methodId, species: METHODS[methodId].target, area, positives: new Map(), negatives: new Map(), rules: [], spots: [], ownSpots: [] });
    }
    return byKey.get(key);
  };
  for (const m of Object.keys(GROUNDS)) for (const a of GROUNDS[m]) get(m, a);
  // 根魚 are pinpoint fish: wherever the player has caught them is a place to try again
  for (const l of logs) if (l.methodId === 'negyo' && l.count > 0 && l.area) get('negyo', l.area).ownSpots.push({ x: l.start.x, y: l.start.y, count: l.count });
  // reports the player has actually heard (acquired), grouped by original observation
  for (const r of knowledge.reports) {
    if (r.acqDay == null || r.acqDay > today) continue;
    if (r.kind === 'rule') {
      if (r.acqDay === today && r.methodId) for (const a of GROUNDS[r.methodId]) get(r.methodId, a).rules.push(r);
      continue;
    }
    if (!r.methodId || !r.area || !GROUNDS[r.methodId]) continue;
    const c = get(r.methodId, r.area);
    const bucket = r.kind === 'none' ? c.negatives : c.positives;
    const prev = bucket.get(r.originId);
    if (!prev) bucket.set(r.originId, { origin: r, heardFrom: [r] });
    else prev.heardFrom.push(r); // a relay of the same observation: not new evidence
    if (r.spot && r.kind !== 'none') c.spots.push(r.spot);
  }
  const out = [];
  for (const c of byKey.values()) {
    const own = similarLogs(logs, { methodId: c.methodId, area: c.area, forecast, profile });
    let score = 0.3;
    const evidence = [];
    markSuperseded([...c.positives.values(), ...c.negatives.values()]);
    for (const e of c.positives.values()) {
      const r = e.origin;
      if (e.superseded) {
        evidence.push(e); // kept as history, not counted
        continue;
      }
      let w = (KIND_W[r.kind] || 1) * freshW(r.obsDay, today);
      const [good, poor] = REPORT_COUNTS[c.methodId];
      if (r.kind === 'catch' && r.count != null) w *= r.count >= good ? 1.2 : r.count < poor ? 0.6 : 1;
      score += w;
      evidence.push(e);
    }
    const negatives = [...c.negatives.values()];
    for (const e of negatives) if (!e.superseded) score -= 2 * freshW(e.origin.obsDay, today);
    score += Math.min(3, own.similar.filter(isGood).length * 1.5);
    score -= Math.min(1.5, (own.similar.length - own.good) * 0.5);
    if (own.withCatch) score += 0.8;
    if ((c.methodId === 'negyo' || c.methodId === 'oyogase') && !own.same.length) score -= 0.05; // without own records it is a long shot
    const ruleNotes = c.rules.map((r) => r);
    if (ruleNotes.length) score += 0.4;
    // feasibility with the current boat & gear
    const type = METHODS[c.methodId].gearType;
    let feasible = { ok: true, reason: '' };
    if (!gearOfType(profile, type).length) {
      const model = BOATS[profile.boat.model];
      const item = Object.values(EQUIPMENT)
        .filter((it) => it.type === type && model.slots.some((sl) => fits(it, sl)))
        .sort((a, b) => a.price - b.price)[0];
      feasible = { ok: false, reason: item ? `${item.name}が必要（未搭載・${item.price.toLocaleString('ja-JP')}G）` : 'この船ではできない漁法です' };
    }
    // can the boat reach the ground? (small boats keep to the coastal zone)
    const a = anchor(c.area);
    const range = BOATS[profile.boat.model].range;
    if (feasible.ok && a && range && range.maxY != null && a.y > range.maxY) feasible = { ok: false, reason: `${BOATS[profile.boat.model].name}の航行区域の外（中型漁船が必要）` };
    const live = evidence.filter((e) => !e.superseded);
    const freshest = live.reduce((a, e) => Math.max(a, e.origin.obsDay), -1);
    const labels = [];
    if (live.some((e) => e.origin.obsDay === today)) labels.push('今朝の確認情報あり');
    else if (live.some((e) => e.origin.obsDay === today - 1)) labels.push('昨日の情報あり');
    if (own.withCatch) labels.push('自分の実績あり');
    if (own.similar.length) labels.push('似た条件の記録あり');
    if (live.length && freshest <= today - 2) labels.push('情報が古い');
    if (negatives.some((e) => !e.superseded && e.origin.obsDay >= today - 1)) labels.push('反応なしの報告あり');
    if (live.length <= 1 && !own.same.length) labels.push('情報が少ない');
    if (!own.same.length) labels.push('未経験');
    if (!feasible.ok) labels.push(/航行区域/.test(feasible.reason) ? '船の買い替えが必要' : '装備が必要');
    const notes = conditionNotes(c.methodId, forecast);
    if (FAR_NOTE[c.area]) notes.push(FAR_NOTE[c.area]);
    const best = c.ownSpots.slice().sort((a, b) => b.count - a.count)[0];
    const spot = c.spots.length ? { x: c.spots.reduce((a, p) => a + p.x, 0) / c.spots.length, y: c.spots.reduce((a, p) => a + p.y, 0) / c.spots.length } : best ? { x: best.x, y: best.y } : anchor(c.area);
    out.push({
      key: c.key,
      methodId: c.methodId,
      species: c.species,
      area: c.area,
      spot,
      evidence: evidence.sort((a, b) => b.origin.obsDay - a.origin.obsDay || b.origin.obsT - a.origin.obsT),
      negatives,
      rules: ruleNotes,
      general: GENERAL[c.methodId],
      own,
      labels,
      notes,
      feasible,
      score,
      hasInfo: live.length > 0 || own.same.length > 0,
    });
  }
  return pickCandidates(out);
}

function pickCandidates(all) {
  const sorted = all.slice().sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  const picked = sorted.slice(0, 3);
  const has = (fn) => picked.some(fn);
  const replaceLast = (cand) => {
    if (picked.includes(cand)) return;
    picked[picked.length - 1] = cand;
  };
  // keep a second method in view when someone actually reported it
  const otherMethod = sorted.find((c) => c.evidence.some((e) => !e.superseded) && !has((p) => p.methodId === c.methodId));
  if (otherMethod) replaceLast(otherMethod);
  // keep one "new to try" option (untried by the player but with fresh evidence)
  if (!has((p) => !p.own.same.length)) {
    const fresh = sorted.find((c) => !c.own.same.length && c.evidence.some((e) => !e.superseded));
    if (fresh) replaceLast(fresh);
  }
  // with three methods, a third one somebody reported is added as a fourth candidate
  const third = sorted.find((c) => c.evidence.some((e) => !e.superseded) && !has((p) => p.methodId === c.methodId));
  if (third) picked.push(third);
  const result = picked.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  return result.map((c, i) => ({ ...c, letter: 'ABCD'[i] }));
}

function conditionNotes(methodId, fc) {
  const notes = [];
  const tc = tideClass(fc.tideName);
  if (methodId === 'handline') {
    if (tc === '大潮') notes.push('大潮：潮が速く、一回の流しが短くなりやすい');
    else if (tc === '小潮系') notes.push(`${fc.tideName}：潮がゆるく流しやすいが、潮が動かない時間は食いが落ちやすい`);
    else notes.push('中潮：ほどよく潮が動く');
    if (fc.windSpeed >= 6) notes.push(`風${fc.windSpeed}m/s（予報）：船が流されやすい`);
  } else if (methodId === 'oyogase') {
    if (tc === '小潮系') notes.push(`${fc.tideName}：潮が緩く、青物の食いが立ちにくい`);
    else notes.push(`${tc}：潮が動き、青物の食いが立ちやすい`);
    notes.push(fc.waterTemp <= 18.6 ? `水温${fc.waterTemp}℃：ブリの多い頃（一般的な目安）` : `水温${fc.waterTemp}℃：ヒラマサの多い頃（一般的な目安）`);
    notes.push('活きエサのアジを先に釣っておく');
  } else if (methodId === 'negyo') {
    if (tc === '大潮') notes.push('大潮：流れが速く、根の真上を一瞬で通り過ぎやすい。潮上から何度も流し直す');
    else if (tc === '小潮系') notes.push(`${fc.tideName}：流れが緩く、根の上に長く留まれる`);
    else notes.push('中潮：ほどよく流れる');
    notes.push('根魚は朝夕の薄暗い時間によく食う（一般的な目安）');
  } else if (methodId === 'longline') {
    if (fc.season && fc.season.nokkomi) notes.push('水温が上がる時期：マダイが瀬の肩に寄る「乗っ込み」の頃（一般的な目安）');
    if (tc === '大潮') notes.push('大潮：潮がよく動き、マダイの食いが立ちやすい');
    else if (tc === '小潮系') notes.push(`${fc.tideName}：潮が緩い。潮が動く時間に浸けたい`);
    else notes.push('中潮：ほどよく潮が動く');
  } else {
    const t = fc.waterTemp;
    notes.push(t >= SPECIES.sawara.arriveTemp ? `水温${t}℃（予報）：サワラが回ってくる水温` : `水温${t}℃（予報）：サワラにはまだ低め`);
    if (fc.windSpeed >= 6) notes.push(`風${fc.windSpeed}m/s（予報）：曳縄は走れるが波に注意`);
  }
  return notes;
}

/** Short reason text the player can carry to sea and into the log (計画). */
export function planSummary(c, today) {
  const e = c.evidence.find((x) => !x.superseded);
  const basis = e ? `${peerName(e.origin.speaker)}の${dayWord(e.origin.obsDay, today)}の${KIND_LABEL[e.origin.kind]}情報` : c.own.similar.length ? '自分の似た条件の記録' : c.own.same.length ? '自分の記録' : '一般的な目安';
  return { key: c.key, label: `${c.area}・${SPECIES[c.species].name}・${METHODS[c.methodId].name}`, basis, labels: c.labels.slice() };
}

export function methodLevel(profile, methodId) {
  return levelFromXp(profile.methods[methodId].xp);
}
