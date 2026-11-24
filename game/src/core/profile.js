// Persistent player progress (what the save file holds).
// The live sea (WorldState) is NOT part of this; it is regenerated per voyage.
import { START_PROFILE, BOATS, EQUIPMENT, METHODS, DIFFICULTY, fits } from './data.js';
import { emptyBathy } from './bathy.js';

export const PROFILE_SCHEMA = 10;

export function createProfile({ worldSeed, now = new Date().toISOString(), difficulty = 'normal' } = {}) {
  const seed = worldSeed != null ? worldSeed >>> 0 : (Math.floor(Math.random() * 0xffffffff) >>> 0);
  let seq = 0;
  const inst = (itemId) => ({ uid: `eq${++seq}`, itemId });
  const slots = {};
  for (const [slotId, itemId] of Object.entries(START_PROFILE.slots)) slots[slotId] = itemId ? inst(itemId) : null;
  return {
    schema: PROFILE_SCHEMA,
    createdAt: now,
    worldSeed: seed,
    difficulty: DIFFICULTY[difficulty] ? difficulty : 'normal', // 難易度（R05）: fixed for this save
    funds: (DIFFICULTY[difficulty] || DIFFICULTY.normal).startFunds,
    day: 0, // number of days started
    methods: { handline: { xp: 0 }, troll: { xp: 0 }, longline: { xp: 0 }, negyo: { xp: 0 }, oyogase: { xp: 0 }, ika: { xp: 0 }, jigging: { xp: 0 } },
    extraLines: 0, // 延縄: lines bought beyond the one that comes with the gear (R07)
    orders: [], // 注文: accepted and not yet done {id, species, kg, filledKg, bonus, lastDay, from}
    records: {}, // 図鑑と大物記録: per fish {firstDay, firstArea, count, kg, max: {w, day, area, size}}
    years: { reviewed: 0 }, // the last year whose 振り返り has been shown
    boat: { uid: 'boat1', model: START_PROFILE.boatModel, name: START_PROFILE.boatName, slots },
    storage: [],
    equipSeq: seq,
    logs: [],
    settledVoyages: [],
    activeVoyage: null,
    interruptedVoyages: [],
    stats: { voyages: 0, fish: 0, kg: 0, sales: 0 },
    ledger: [], // 収支: one line per settled voyage (sales, costs, net, per method)
    knowledge: { reports: [], briefedDay: 0 },
    boatSeq: 1,
    boatHistory: [], // boats traded in: {uid, model, name, tradeIn, day}
    bathy: emptyBathy(), // the player's own depth map (デプスマッピング)
    marks: [], // the player's own marks, kept across days: {id, x, y, name, memo, day, t, kind, depth}
    markSeq: 0,
  };
}

/**
 * Schema 9 -> 10 (第2期・段4): the difficulty of a save made before it is 「ふつう」;
 * no orders yet; the records start from the catch logged so far (count and kg,
 * no biggest — fish had no weight of their own before); no year reviewed.
 */
export function migrateProfile9to10(p9) {
  const p = clone(p9);
  p.schema = 10;
  p.difficulty = DIFFICULTY[p.difficulty] ? p.difficulty : 'normal';
  p.orders = Array.isArray(p.orders) ? p.orders : [];
  if (!p.records || typeof p.records !== 'object') {
    p.records = {};
    for (const l of p.logs || []) {
      const tables = l.bySpecies ? Object.entries(l.bySpecies) : [[l.species || 'aji', l.catches || {}]];
      for (const [sp, c] of tables) {
        const n = (c.s || 0) + (c.m || 0) + (c.l || 0);
        if (!n) continue;
        const r = (p.records[sp] = p.records[sp] || { firstDay: l.day || null, firstArea: l.area || null, count: 0, kg: 0, max: null });
        r.count += n;
      }
    }
  }
  p.years = p.years && typeof p.years.reviewed === 'number' ? p.years : { reviewed: Math.floor(Math.max(0, p.day - 1) / 60) };
  return p;
}

/**
 * Schema 8 -> 9 (第2期・段2): ジギング experience from 0, the new rod rack on
 * every boat (empty), no extra longlines yet. Nothing else changes.
 */
export function migrateProfile8to9(p8) {
  const p = clone(p8);
  p.schema = 9;
  p.methods = { jigging: { xp: 0 }, ...p.methods };
  if (p.boat && p.boat.slots && !('rod_rack' in p.boat.slots)) p.boat.slots.rod_rack = null;
  p.extraLines = typeof p.extraLines === 'number' ? p.extraLines : 0;
  return p;
}

/** Schema 7 -> 8: the ledger (収支) starts empty; earlier voyages are only in the totals. */
export function migrateProfile7to8(p7) {
  const p = clone(p7);
  p.schema = 8;
  p.ledger = Array.isArray(p.ledger) ? p.ledger : [];
  return p;
}

/** Schema 6 -> 7: experience for the new methods (根魚釣り・泳がせ釣り・イカ釣り), all from 0. */
export function migrateProfile6to7(p6) {
  const p = clone(p6);
  p.schema = 7;
  p.methods = { negyo: { xp: 0 }, oyogase: { xp: 0 }, ika: { xp: 0 }, ...p.methods };
  return p;
}

/** Schema 5 (M5) -> 6: the own depth map and marks kept across days (both empty). */
export function migrateProfile5to6(p5) {
  const p = clone(p5);
  p.schema = 6;
  p.bathy = p.bathy || emptyBathy();
  // new mountings (empty): the sonar under the medium boat, lamps for night squid on every boat
  if (p.boat.model === 'cruiser_2' && !('hull_sonar' in p.boat.slots)) p.boat.slots.hull_sonar = null;
  if (!('roof_lights' in p.boat.slots)) p.boat.slots.roof_lights = null;
  p.marks = p.marks || [];
  p.markSeq = p.markSeq || 0;
  return p;
}

/** Schema 4 (M3/M4) -> 5 (M5): the line hauler's mounting (empty) on every boat. */
export function migrateProfile4to5(p4) {
  const p = clone(p4);
  p.schema = 5;
  if (!('starboard_hauler' in p.boat.slots)) p.boat.slots.starboard_hauler = null;
  return p;
}

/**
 * Schema 3 (M2) -> 4 (M3): the longline method (XP 0) and, on the medium boat,
 * the new optional deck slot for the longline gear (empty). Nothing else changes.
 */
export function migrateProfile3to4(p3) {
  const p = clone(p3);
  p.schema = 4;
  p.methods = { longline: { xp: 0 }, ...p.methods };
  if (p.boat.model === 'cruiser_2' && !('deck_longline' in p.boat.slots)) p.boat.slots.deck_longline = null;
  return p;
}

/** Schema 2 (M1) -> 3 (M2): boat ownership history; nothing else changes. */
export function migrateProfile2to3(p2) {
  const p = clone(p2);
  p.schema = 3;
  p.boatSeq = p.boatSeq || 1;
  p.boatHistory = p.boatHistory || [];
  return p;
}

/**
 * Schema 1 (M0) -> 2 (M1). Keeps funds, XP, boat, equipment, storage, logs
 * and history; adds the trolling method, the optional stern slot and the
 * knowledge store. M0 logs were all 一本釣り of マアジ.
 */
export function migrateProfile1to2(p1) {
  const p = clone(p1);
  p.schema = 2;
  p.methods = { handline: { xp: 0 }, troll: { xp: 0 }, ...p.methods };
  if (!('stern_troll' in p.boat.slots)) p.boat.slots.stern_troll = null;
  p.logs = p.logs.map((l) => ({ methodId: 'handline', species: 'aji', ...l }));
  p.knowledge = p.knowledge || { reports: [], briefedDay: 0 };
  // reports of days already passed were never heard; start hearing from the next day
  p.knowledge.briefedDay = Math.max(p.knowledge.briefedDay || 0, p.day);
  return p;
}

export function clone(p) {
  return JSON.parse(JSON.stringify(p));
}

/** Start a new day at sea. Returns a new profile with the active-voyage marker. */
export function markDeparture(profile, now = new Date().toISOString(), plan = null, { crew = 0, night = false } = {}) {
  if (profile.activeVoyage) throw new Error('すでに航海中です。');
  const p = clone(profile);
  p.day += 1;
  p.activeVoyage = { id: `V${p.day}`, day: p.day, departedAt: now, snapshot: null, plan, crew: crew ? 1 : 0, night: night ? 1 : 0 };
  return p;
}

/** Stay in port for the day (e.g. a storm): the day passes, nothing else changes. */
export function restDay(profile) {
  if (profile.activeVoyage) throw new Error('航海中です。');
  const p = clone(profile);
  p.day += 1;
  p.stats.restDays = (p.stats.restDays || 0) + 1;
  return p;
}

/**
 * A voyage marker left in the save means the page closed at sea. M0 does not
 * restore voyages at sea: the voyage is recorded as interrupted (no catch, no
 * cost, no XP) and the day stays consumed.
 */
export function resolveInterruptedVoyage(profile) {
  if (!profile.activeVoyage) return { profile, interrupted: null };
  const p = clone(profile);
  const av = p.activeVoyage;
  p.interruptedVoyages.push({ id: av.id, day: av.day, departedAt: av.departedAt });
  if (p.interruptedVoyages.length > 50) p.interruptedVoyages.shift();
  p.activeVoyage = null;
  return { profile: p, interrupted: av };
}

/** Structural validation. Returns a list of problems (empty = valid). */
export function validateProfile(p) {
  const errs = [];
  const num = (v, k) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) errs.push(`${k} が数値ではありません`);
  };
  if (!p || typeof p !== 'object') return ['データがオブジェクトではありません'];
  if (p.schema !== PROFILE_SCHEMA) errs.push(`未対応のプロフィール版 ${p.schema}`);
  num(p.funds, 'funds');
  if (p.funds < 0) errs.push('funds が負です');
  num(p.day, 'day');
  num(p.worldSeed, 'worldSeed');
  if (!p.methods || typeof p.methods !== 'object') errs.push('methods がありません');
  else for (const id of Object.keys(METHODS)) if (!p.methods[id] || typeof p.methods[id].xp !== 'number') errs.push(`methods.${id}.xp がありません`);
  if (!p.boat || !BOATS[p.boat.model]) errs.push('boat.model が不正です');
  else {
    const model = BOATS[p.boat.model];
    for (const slot of model.slots) {
      const inst = p.boat.slots ? p.boat.slots[slot.id] : null;
      if (!inst) {
        // an optional mounting may be empty or not listed at all (a mounting added in a later version)
        if (!slot.optional) errs.push(`装備位置 ${slot.id} が空です`);
        continue;
      }
      const item = EQUIPMENT[inst.itemId];
      if (!item) errs.push(`未知の装備 ${inst.itemId}`);
      else if (!fits(item, slot)) errs.push(`${slot.id} に対応しない装備 ${inst.itemId}`);
    }
    for (const key of Object.keys(p.boat.slots || {})) if (!model.slots.some((s) => s.id === key)) errs.push(`この船にない取付位置 ${key}`);
  }
  if (typeof p.boatSeq !== 'number' || !Array.isArray(p.boatHistory)) errs.push('船の記録が不正です');
  if (!p.bathy || typeof p.bathy.tiles !== 'object' || !Array.isArray(p.marks) || typeof p.markSeq !== 'number') errs.push('海図の記録（水深・印）が不正です');
  if (!Array.isArray(p.ledger)) errs.push('収支の記録がありません');
  if (typeof p.extraLines !== 'number' || p.extraLines < 0 || p.extraLines > 2) errs.push('延縄の縄の数が不正です');
  if (!DIFFICULTY[p.difficulty]) errs.push('難易度が不正です');
  if (!Array.isArray(p.orders) || !p.records || typeof p.records !== 'object' || !p.years || typeof p.years.reviewed !== 'number') errs.push('注文・図鑑・振り返りの記録が不正です');
  if (!Array.isArray(p.storage)) errs.push('storage が配列ではありません');
  else for (const s of p.storage) if (!s || !EQUIPMENT[s.itemId]) errs.push('倉庫に未知の装備');
  if (!Array.isArray(p.logs)) errs.push('logs が配列ではありません');
  if (!Array.isArray(p.settledVoyages)) errs.push('settledVoyages が配列ではありません');
  if (!Array.isArray(p.interruptedVoyages)) errs.push('interruptedVoyages が配列ではありません');
  if (!p.stats || typeof p.stats !== 'object') errs.push('stats がありません');
  if (!p.knowledge || !Array.isArray(p.knowledge.reports) || typeof p.knowledge.briefedDay !== 'number') errs.push('knowledge が不正です');
  // equipment instances must be unique (no duplication through bugs)
  const uids = [];
  if (p.boat && p.boat.slots) for (const v of Object.values(p.boat.slots)) if (v) uids.push(v.uid);
  if (Array.isArray(p.storage)) for (const s of p.storage) if (s) uids.push(s.uid);
  if (new Set(uids).size !== uids.length) errs.push('同じ装備が重複しています');
  return errs;
}
