// Simple, transactional economy: one-shot settlement after landing, and
// equipment purchase / swap. Each function returns a complete new profile
// (or a refusal) so a transaction is never half-applied (A11).
import { ECONOMY, EQUIPMENT, BOATS, BOAT_OFFERS, SPECIES, METHODS, fits, sellValue, LONGLINE_LINES } from './data.js';
import { addHeardReports } from './knowledge.js';
import { clone } from './profile.js';
import { xpForVoyage, levelFromXp } from './progress.js';
import { mergeBathy } from './bathy.js';
import { keepVoyageMarks } from './marks.js';

const MAX_LOGS = 500;

/** Sales lines per species and size (only sizes that were landed, plus totals). */
export function priceLines(holdCounts) {
  const lines = [];
  for (const [spId, sp] of Object.entries(SPECIES)) {
    const c = holdCounts[spId] || {};
    for (const k of sp.sizeOrder) {
      const count = c[k] || 0;
      if (!count) continue;
      const kg = Math.round(count * sp.sizes[k].kg * 100) / 100;
      lines.push({ species: spId, size: k, label: sp.sizes[k].label, count, kg, unitPrice: sp.sizes[k].pricePerKg, amount: Math.round(kg * sp.sizes[k].pricePerKg) });
    }
  }
  return lines;
}

export const MAX_LEDGER = 365;

/** Market value of a catch count table {s, m, l} of one species. */
function catchValue(spId, c) {
  const sp = SPECIES[spId];
  let v = 0;
  for (const k of sp.sizeOrder) v += Math.round((c[k] || 0) * sp.sizes[k].kg * sp.sizes[k].pricePerKg);
  return v;
}

/**
 * What each method earned on a voyage, at the market prices of what it
 * landed. Fish used as live bait are charged to the method that used them
 * (泳がせ), so the methods add up to the day's sales.
 */
export function methodEarnings(summary) {
  const out = {};
  const add = (m) => (out[m] = out[m] || { sales: 0, count: 0, kg: 0, minutes: 0, ops: 0 });
  for (const l of summary.logs) {
    const m = add(l.methodId || 'handline');
    const tables = l.bySpecies ? Object.entries(l.bySpecies) : [[l.species || 'aji', l.catches]];
    for (const [sp, c] of tables) m.sales += catchValue(sp, c);
    m.count += l.count;
    m.kg = Math.round((m.kg + l.kg) * 10) / 10;
    m.minutes += Math.round(l.durationS / 60);
    m.ops += 1;
  }
  for (const [sp, c] of Object.entries(summary.baitUsed || {})) {
    const v = catchValue(sp, c);
    if (!v) continue;
    const m = add('oyogase');
    m.sales -= v;
    m.baitCost = (m.baitCost || 0) + v;
  }
  // ジギング: jigs lost to snags are bought again — charged to the method that lost them
  const jigs = jigCost(summary);
  if (jigs) {
    const m = add('jigging');
    m.sales -= jigs;
    m.jigCost = (m.jigCost || 0) + jigs;
  }
  return out;
}

/** What the jigs lost today cost to replace (ジギング). */
export function jigCost(summary) {
  return (summary.jigsLost || 0) * (summary.jigPrice || 0);
}

/** Land and sell the whole catch, pay the trip cost, gain XP. Exactly once per voyage. */
export function settleVoyage(profile, summary) {
  if (profile.settledVoyages.includes(summary.id)) return { ok: false, reason: 'この航海はすでに精算済みです。' };
  if (!profile.activeVoyage || profile.activeVoyage.id !== summary.id) return { ok: false, reason: '精算対象の航海が見つかりません。' };
  // the hold must match the operation logs (every landed fish came from an operation),
  // less the fish taken from the hold as live bait (泳がせ)
  for (const spId of Object.keys(SPECIES)) {
    const fromLogs = { s: 0, m: 0, l: 0 };
    for (const l of summary.logs) {
      const c = l.bySpecies ? l.bySpecies[spId] : (l.species || 'aji') === spId ? l.catches : null;
      if (c) for (const k of Object.keys(fromLogs)) fromLogs[k] += c[k] || 0;
    }
    const bait = (summary.baitUsed || {})[spId];
    if (bait) for (const k of Object.keys(fromLogs)) fromLogs[k] -= bait[k] || 0;
    const held = summary.hold.counts[spId] || {};
    for (const k of Object.keys(fromLogs)) {
      if (fromLogs[k] !== (held[k] || 0)) return { ok: false, reason: '魚倉と操業記録が一致しません（精算を中止しました）。' };
    }
  }

  const p = clone(profile);
  const lines = priceLines(summary.hold.counts);
  const sales = lines.reduce((a, l) => a + l.amount, 0);
  const fuel = Math.round((summary.distanceM / 1000) * (summary.fuelPerKm || ECONOMY.fuelPerKm));
  const crew = summary.crewWage || 0;
  const jigs = jigCost(summary);
  const costTotal = ECONOMY.tripBaseCost + fuel + crew + jigs;
  // never leave the player unable to go out again (A13): unpaid cost is waived
  const payable = Math.min(costTotal, p.funds + sales);
  const waived = costTotal - payable;
  const fundsBefore = p.funds;
  p.funds = p.funds + sales - payable;

  // experience per method: from what that method landed and the time it was worked
  const xp = {};
  for (const mId of Object.keys(METHODS)) {
    const logs = summary.logs.filter((l) => (l.methodId || 'handline') === mId);
    if (!logs.length) continue;
    const fish = logs.reduce((a, l) => a + l.count, 0);
    const secs = logs.reduce((a, l) => a + l.durationS, 0);
    const before = p.methods[mId].xp;
    const g = xpForVoyage(fish, secs);
    p.methods[mId].xp = before + g.total;
    xp[mId] = { ...g, fish, before, after: p.methods[mId].xp, levelBefore: levelFromXp(before), levelAfter: levelFromXp(p.methods[mId].xp) };
  }

  const known = new Set(p.logs.map((l) => l.id));
  for (const l of summary.logs) if (!known.has(l.id)) p.logs.push(l);
  if (p.logs.length > MAX_LOGS) p.logs.splice(0, p.logs.length - MAX_LOGS);
  if (summary.heard && summary.heard.length) addHeardReports(p, summary.heard);
  // the own depth map and the marks made at sea are kept across days
  if (summary.bathyCells && Object.keys(summary.bathyCells).length) p.bathy = mergeBathy(p.bathy, summary.bathyCells);
  keepVoyageMarks(p, summary.marks, summary.day);

  p.settledVoyages.push(summary.id);
  if (p.settledVoyages.length > 200) p.settledVoyages.shift();
  p.activeVoyage = null;
  p.stats.voyages += 1;
  p.stats.fish += summary.hold.count;
  p.stats.kg = Math.round((p.stats.kg + summary.hold.kg) * 100) / 100;
  p.stats.sales += sales;

  // the ledger (収支): one line per voyage — what was sold and paid, and what each method earned
  const byMethod = methodEarnings(summary);
  if (!Array.isArray(p.ledger)) p.ledger = [];
  p.ledger.push({
    voyageId: summary.id,
    day: summary.day,
    night: !!summary.night,
    sales,
    costs: { base: ECONOMY.tripBaseCost, fuel, crew, jigs, total: costTotal },
    net: sales - payable,
    paid: payable,
    byMethod,
  });
  if (p.ledger.length > MAX_LEDGER) p.ledger.splice(0, p.ledger.length - MAX_LEDGER);

  const receipt = {
    voyageId: summary.id,
    day: summary.day,
    lines,
    sales,
    costs: { base: ECONOMY.tripBaseCost, fuel, crew, jigs, jigsLost: summary.jigsLost || 0, total: costTotal, paid: payable, waived },
    net: sales - payable,
    fundsBefore,
    fundsAfter: p.funds,
    xp,
    opCount: summary.logs.length,
    opSeconds: summary.opSeconds,
    distanceM: summary.distanceM,
    plan: summary.plan || null,
    heardCount: summary.heard ? summary.heard.length : 0,
    baitUsed: summary.baitUsed || {}, // fish taken from the hold as live bait (not sold)
  };
  return { ok: true, profile: p, receipt };
}

/** What a purchase would do, for the confirmation screen. */
export function purchasePreview(profile, itemId, slotId) {
  const item = EQUIPMENT[itemId];
  const model = BOATS[profile.boat.model];
  const slot = model.slots.find((s) => s.id === slotId);
  const current = profile.boat.slots[slotId];
  const res = { item, slot, price: item ? item.price : 0, fundsBefore: profile.funds, fundsAfter: profile.funds - (item ? item.price : 0), removed: current ? EQUIPMENT[current.itemId] : null, destination: '倉庫' };
  if (!item || !slot) return { ...res, ok: false, reason: '装備または取付位置が不正です。' };
  if (!fits(item, slot)) return { ...res, ok: false, reason: `${slot.label}には取り付けられません。` };
  if (profile.activeVoyage) return { ...res, ok: false, reason: '航海中は購入できません。' };
  if (current && current.itemId === itemId) return { ...res, ok: false, reason: 'すでに取り付けています。' };
  if (profile.storage.some((s) => s.itemId === itemId)) return { ...res, ok: false, reason: '倉庫に同じ装備があります。倉庫から取り付けてください。' };
  if (profile.funds < item.price) return { ...res, ok: false, reason: `資金が${(item.price - profile.funds).toLocaleString()}${ECONOMY.currency}足りません。` };
  return { ...res, ok: true };
}

export function purchaseEquipment(profile, itemId, slotId) {
  const pv = purchasePreview(profile, itemId, slotId);
  if (!pv.ok) return { ok: false, reason: pv.reason };
  const p = clone(profile);
  p.equipSeq += 1;
  const inst = { uid: `eq${p.equipSeq}`, itemId };
  const old = p.boat.slots[slotId];
  if (old) p.storage.push(old);
  p.boat.slots[slotId] = inst;
  p.funds -= pv.price;
  return { ok: true, profile: p, receipt: { itemId, slotId, price: pv.price, fundsBefore: profile.funds, fundsAfter: p.funds, removedItemId: old ? old.itemId : null } };
}

/**
 * 延縄の縄を買い足す（R07）: one more line, each laid on its own; at most
 * LONGLINE_LINES.max in all (the one with the gear counts). Pure: a new profile.
 */
export function purchaseExtraLine(profile) {
  if (profile.activeVoyage) return { ok: false, reason: '航海中は買えません。' };
  const hasGear = Object.values(profile.boat.slots).some((x) => x && EQUIPMENT[x.itemId].type === 'longline') || profile.storage.some((x) => EQUIPMENT[x.itemId].type === 'longline');
  if (!hasGear) return { ok: false, reason: '先に延縄具を手に入れてください（縄の1本目は延縄具に付いています）。' };
  const have = 1 + (profile.extraLines || 0);
  if (have >= LONGLINE_LINES.max) return { ok: false, reason: `縄は${LONGLINE_LINES.max}本までです。` };
  if (profile.funds < LONGLINE_LINES.extraPrice) return { ok: false, reason: `資金が足りません（${LONGLINE_LINES.extraPrice.toLocaleString('ja-JP')}G）。` };
  const p = clone(profile);
  p.extraLines = (p.extraLines || 0) + 1;
  p.funds -= LONGLINE_LINES.extraPrice;
  return { ok: true, profile: p, receipt: { price: LONGLINE_LINES.extraPrice, lines: 1 + p.extraLines, fundsBefore: profile.funds, fundsAfter: p.funds } };
}

/** Swap a stored item onto its slot; the removed item goes to storage. Free. */
export function equipFromStorage(profile, uid, slotId) {
  if (profile.activeVoyage) return { ok: false, reason: '航海中は換装できません。' };
  const idx = profile.storage.findIndex((s) => s.uid === uid);
  if (idx < 0) return { ok: false, reason: '倉庫に見つかりません。' };
  const model = BOATS[profile.boat.model];
  const slot = model.slots.find((s) => s.id === slotId);
  const item = EQUIPMENT[profile.storage[idx].itemId];
  if (!slot || !fits(item, slot)) return { ok: false, reason: 'この位置には取り付けられません。' };
  const p = clone(profile);
  const [inst] = p.storage.splice(idx, 1);
  const old = p.boat.slots[slotId];
  if (old) p.storage.push(old);
  p.boat.slots[slotId] = inst;
  return { ok: true, profile: p };
}

/** Take an item off an optional slot and keep it in storage. */
export function unmountToStorage(profile, slotId) {
  if (profile.activeVoyage) return { ok: false, reason: '航海中は外せません。' };
  const slot = BOATS[profile.boat.model].slots.find((x) => x.id === slotId);
  const inst = profile.boat.slots[slotId];
  if (!slot || !inst) return { ok: false, reason: '外す装備がありません。' };
  if (!slot.optional) return { ok: false, reason: `${slot.label}は空にできません（付け替えは倉庫の装備から）。` };
  const p = clone(profile);
  p.storage.push(p.boat.slots[slotId]);
  p.boat.slots[slotId] = null;
  return { ok: true, profile: p };
}

/** Sell a stored item (simple fixed value). */
export function sellStored(profile, uid) {
  if (profile.activeVoyage) return { ok: false, reason: '航海中は売れません。' };
  const idx = profile.storage.findIndex((x) => x.uid === uid);
  if (idx < 0) return { ok: false, reason: '倉庫に見つかりません。' };
  const p = clone(profile);
  const [inst] = p.storage.splice(idx, 1);
  const value = sellValue(EQUIPMENT[inst.itemId]);
  p.funds += value;
  return { ok: true, profile: p, receipt: { itemId: inst.itemId, value, fundsBefore: profile.funds, fundsAfter: p.funds } };
}

/** Boats on offer to this player (other models than the one they run). */
export function boatOffers(profile) {
  return BOAT_OFFERS.filter((o) => o.model !== profile.boat.model);
}

/**
 * What buying a boat would do — every number and every item's destination,
 * for the confirmation screen. Pure; nothing changes until buyBoat().
 * Gear on the old boat moves to an empty fitting slot on the new one
 * (same position first), otherwise to storage. The old hull is traded in.
 */
export function planBoatPurchase(profile, offerId) {
  const offer = BOAT_OFFERS.find((o) => o.id === offerId);
  if (!offer) return { ok: false, reason: '売り物が見つかりません。' };
  const model = BOATS[offer.model];
  const oldModel = BOATS[profile.boat.model];
  const tradeIn = oldModel.tradeIn;
  const payable = offer.price - tradeIn;
  const res = { offer, model, oldModel, price: offer.price, tradeIn, payable, fundsBefore: profile.funds, fundsAfter: profile.funds - payable };
  if (offer.model === profile.boat.model) return { ...res, ok: false, reason: '今と同じ型の船です。' };
  if (profile.activeVoyage) return { ...res, ok: false, reason: '航海中は買い替えできません。' };
  // new boat's slots: the offer's included gear first
  const slots = {};
  for (const sl of model.slots) slots[sl.id] = offer.included[sl.id] ? { included: offer.included[sl.id] } : null;
  const moves = [];
  const oldSlots = oldModel.slots.filter((sl) => profile.boat.slots[sl.id]);
  for (const sl of oldSlots) {
    const inst = profile.boat.slots[sl.id];
    const item = EQUIPMENT[inst.itemId];
    const same = model.slots.find((x) => x.id === sl.id && !slots[x.id] && fits(item, x));
    const any = same || model.slots.find((x) => !slots[x.id] && fits(item, x));
    if (any) {
      slots[any.id] = { uid: inst.uid, itemId: inst.itemId };
      moves.push({ uid: inst.uid, itemId: inst.itemId, from: sl.label, to: any.id, toLabel: `新しい船の${any.label}` });
    } else {
      const fitsSomewhere = model.slots.some((x) => fits(item, x));
      moves.push({ uid: inst.uid, itemId: inst.itemId, from: sl.label, to: null, toLabel: '倉庫', why: fitsSomewhere ? '付けられる位置が付属の装備で埋まっている' : 'この船には付けられる位置がない' });
    }
  }
  // a boat cannot go out without a sounder: fit a basic one if none of yours fits
  const standard = [];
  for (const sl of model.slots) {
    if (!sl.optional && !slots[sl.id]) {
      const basic = Object.values(EQUIPMENT).find((it) => it.price === 0 && fits(it, sl));
      slots[sl.id] = { included: basic.id };
      standard.push({ slotId: sl.id, itemId: basic.id });
    }
  }
  const included = Object.entries(offer.included).map(([slotId, itemId]) => ({ slotId, itemId, label: model.slots.find((x) => x.id === slotId).label }));
  if (profile.funds < payable) return { ...res, slots, moves, included, standard, ok: false, reason: `資金が${(payable - profile.funds).toLocaleString('ja-JP')}${ECONOMY.currency}足りません（下取り後）。` };
  return { ...res, slots, moves, included, standard, ok: true };
}

/** Buy the boat as one transaction: pay, trade in, move/store gear, keep one active boat. */
export function buyBoat(profile, offerId) {
  const plan = planBoatPurchase(profile, offerId);
  if (!plan.ok) return { ok: false, reason: plan.reason };
  const p = clone(profile);
  const old = p.boat;
  const slots = {};
  for (const [slotId, v] of Object.entries(plan.slots)) {
    if (!v) slots[slotId] = null;
    else if (v.included) {
      p.equipSeq += 1;
      slots[slotId] = { uid: `eq${p.equipSeq}`, itemId: v.included };
    } else slots[slotId] = { uid: v.uid, itemId: v.itemId };
  }
  for (const m of plan.moves) if (!m.to) p.storage.push({ uid: m.uid, itemId: m.itemId });
  p.boatSeq += 1;
  p.boatHistory.push({ uid: old.uid, model: old.model, name: old.name, tradeIn: plan.tradeIn, day: p.day });
  p.boat = { uid: `boat${p.boatSeq}`, model: plan.offer.model, name: old.name, slots, acquired: { offerId, kind: plan.offer.kind, day: p.day } };
  p.funds -= plan.payable;
  return {
    ok: true,
    profile: p,
    receipt: { offerId, model: plan.offer.model, price: plan.price, tradeIn: plan.tradeIn, payable: plan.payable, fundsBefore: profile.funds, fundsAfter: p.funds, moves: plan.moves, included: plan.included, standard: plan.standard },
  };
}
