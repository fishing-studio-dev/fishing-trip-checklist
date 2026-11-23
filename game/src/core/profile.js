// Persistent player progress (what the save file holds).
// The live sea (WorldState) is NOT part of this; it is regenerated per voyage.
import { ECONOMY, START_PROFILE, BOATS, EQUIPMENT, METHODS } from './data.js';

export const PROFILE_SCHEMA = 1;

export function createProfile({ worldSeed, now = new Date().toISOString() } = {}) {
  const seed = worldSeed != null ? worldSeed >>> 0 : (Math.floor(Math.random() * 0xffffffff) >>> 0);
  let seq = 0;
  const inst = (itemId) => ({ uid: `eq${++seq}`, itemId });
  const slots = {};
  for (const [slotId, itemId] of Object.entries(START_PROFILE.slots)) slots[slotId] = inst(itemId);
  return {
    schema: PROFILE_SCHEMA,
    createdAt: now,
    worldSeed: seed,
    funds: ECONOMY.startFunds,
    day: 0, // number of days started
    methods: { handline: { xp: 0 } },
    boat: { uid: 'boat1', model: START_PROFILE.boatModel, name: START_PROFILE.boatName, slots },
    storage: [],
    equipSeq: seq,
    logs: [],
    settledVoyages: [],
    activeVoyage: null,
    interruptedVoyages: [],
    stats: { voyages: 0, fish: 0, kg: 0, sales: 0 },
  };
}

export function clone(p) {
  return JSON.parse(JSON.stringify(p));
}

/** Start a new day at sea. Returns a new profile with the active-voyage marker. */
export function markDeparture(profile, now = new Date().toISOString()) {
  if (profile.activeVoyage) throw new Error('すでに航海中です。');
  const p = clone(profile);
  p.day += 1;
  p.activeVoyage = { id: `V${p.day}`, day: p.day, departedAt: now, snapshot: null };
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
        errs.push(`装備位置 ${slot.id} が空です`);
        continue;
      }
      const item = EQUIPMENT[inst.itemId];
      if (!item) errs.push(`未知の装備 ${inst.itemId}`);
      else if (item.type !== slot.accepts) errs.push(`${slot.id} に対応しない装備 ${inst.itemId}`);
    }
  }
  if (!Array.isArray(p.storage)) errs.push('storage が配列ではありません');
  else for (const s of p.storage) if (!s || !EQUIPMENT[s.itemId]) errs.push('倉庫に未知の装備');
  if (!Array.isArray(p.logs)) errs.push('logs が配列ではありません');
  if (!Array.isArray(p.settledVoyages)) errs.push('settledVoyages が配列ではありません');
  if (!Array.isArray(p.interruptedVoyages)) errs.push('interruptedVoyages が配列ではありません');
  if (!p.stats || typeof p.stats !== 'object') errs.push('stats がありません');
  // equipment instances must be unique (no duplication through bugs)
  const uids = [];
  if (p.boat && p.boat.slots) for (const v of Object.values(p.boat.slots)) if (v) uids.push(v.uid);
  if (Array.isArray(p.storage)) for (const s of p.storage) if (s) uids.push(s.uid);
  if (new Set(uids).size !== uids.length) errs.push('同じ装備が重複しています');
  return errs;
}
