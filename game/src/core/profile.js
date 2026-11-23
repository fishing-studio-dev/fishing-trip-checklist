// Persistent player progress (what the save file holds).
// The live sea (WorldState) is NOT part of this; it is regenerated per voyage.
import { ECONOMY, START_PROFILE, BOATS, EQUIPMENT, METHODS, fits } from './data.js';

export const PROFILE_SCHEMA = 4;

export function createProfile({ worldSeed, now = new Date().toISOString() } = {}) {
  const seed = worldSeed != null ? worldSeed >>> 0 : (Math.floor(Math.random() * 0xffffffff) >>> 0);
  let seq = 0;
  const inst = (itemId) => ({ uid: `eq${++seq}`, itemId });
  const slots = {};
  for (const [slotId, itemId] of Object.entries(START_PROFILE.slots)) slots[slotId] = itemId ? inst(itemId) : null;
  return {
    schema: PROFILE_SCHEMA,
    createdAt: now,
    worldSeed: seed,
    funds: ECONOMY.startFunds,
    day: 0, // number of days started
    methods: { handline: { xp: 0 }, troll: { xp: 0 }, longline: { xp: 0 } },
    boat: { uid: 'boat1', model: START_PROFILE.boatModel, name: START_PROFILE.boatName, slots },
    storage: [],
    equipSeq: seq,
    logs: [],
    settledVoyages: [],
    activeVoyage: null,
    interruptedVoyages: [],
    stats: { voyages: 0, fish: 0, kg: 0, sales: 0 },
    knowledge: { reports: [], briefedDay: 0 },
    boatSeq: 1,
    boatHistory: [], // boats traded in: {uid, model, name, tradeIn, day}
  };
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
export function markDeparture(profile, now = new Date().toISOString(), plan = null) {
  if (profile.activeVoyage) throw new Error('すでに航海中です。');
  const p = clone(profile);
  p.day += 1;
  p.activeVoyage = { id: `V${p.day}`, day: p.day, departedAt: now, snapshot: null, plan };
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
        if (!slot.optional || !p.boat.slots || !(slot.id in p.boat.slots)) errs.push(`装備位置 ${slot.id} が空です`);
        continue;
      }
      const item = EQUIPMENT[inst.itemId];
      if (!item) errs.push(`未知の装備 ${inst.itemId}`);
      else if (!fits(item, slot)) errs.push(`${slot.id} に対応しない装備 ${inst.itemId}`);
    }
    for (const key of Object.keys(p.boat.slots || {})) if (!model.slots.some((s) => s.id === key)) errs.push(`この船にない取付位置 ${key}`);
  }
  if (typeof p.boatSeq !== 'number' || !Array.isArray(p.boatHistory)) errs.push('船の記録が不正です');
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
