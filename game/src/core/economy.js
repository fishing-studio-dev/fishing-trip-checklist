// Simple, transactional economy: one-shot settlement after landing, and
// equipment purchase / swap. Each function returns a complete new profile
// (or a refusal) so a transaction is never half-applied (A11).
import { ECONOMY, EQUIPMENT, BOATS, BOAT_OFFERS, SPECIES, METHODS, fits, LONGLINE_LINES } from './data.js';
import { addHeardReports } from './knowledge.js';
import { clone } from './profile.js';
import { xpForVoyage, levelFromXp } from './progress.js';
import { mergeBathy } from './bathy.js';
import { keepVoyageMarks } from './marks.js';
import { pricePerKg, depthMultiplier, costsOf, jigPrice, itemPrice, boatPrice, tradeInOf, extraLinePrice, sellPrice } from './market.js';

const MAX_LOGS = 500;

/**
 * Sales lines per species and size at the day's market (R19): the price per
 * kg of that day, and — when much of one fish is landed — the market's depth
 * lowers it (`depth` < 1 on those lines). Without a profile: the list prices.
 */
export function priceLines(holdCounts, profile = null, day = null) {
  const lines = [];
  for (const [spId, sp] of Object.entries(SPECIES)) {
    const c = holdCounts[spId] || {};
    const spLines = [];
    for (const k of sp.sizeOrder) {
      const count = c[k] || 0;
      if (!count) continue;
      const kg = Math.round(count * sp.sizes[k].kg * 100) / 100;
      const unitPrice = profile ? pricePerKg(profile, day, spId, k) : sp.sizes[k].pricePerKg;
      spLines.push({ species: spId, size: k, label: sp.sizes[k].label, count, kg, unitPrice, amount: Math.round(kg * unitPrice) });
    }
    if (!spLines.length) continue;
    const totalKg = spLines.reduce((a, l) => a + l.kg, 0);
    const depth = profile ? depthMultiplier(spId, totalKg) : 1;
    for (const l of spLines) {
      if (depth < 1) {
        l.depth = Math.round(depth * 100) / 100;
        l.amount = Math.round(l.amount * depth);
      }
      lines.push(l);
    }
  }
  return lines;
}

export const MAX_LEDGER = 365;

/** Market value of a catch count table {s, m, l} of one species (the day's prices when a profile is given). */
function catchValue(spId, c, profile = null, day = null) {
  const sp = SPECIES[spId];
  let v = 0;
  for (const k of sp.sizeOrder) v += Math.round((c[k] || 0) * sp.sizes[k].kg * (profile ? pricePerKg(profile, day, spId, k) : sp.sizes[k].pricePerKg));
  return v;
}

/**
 * What each method earned on a voyage, at the market prices of what it
 * landed. Fish used as live bait are charged to the method that used them
 * (泳がせ), so the methods add up to the day's sales.
 */
export function methodEarnings(summary, profile = null) {
  const day = summary.day;
  const out = {};
  const add = (m) => (out[m] = out[m] || { sales: 0, count: 0, kg: 0, minutes: 0, ops: 0 });
  for (const l of summary.logs) {
    const m = add(l.methodId || 'handline');
    const tables = l.bySpecies ? Object.entries(l.bySpecies) : [[l.species || 'aji', l.catches]];
    for (const [sp, c] of tables) m.sales += catchValue(sp, c, profile, day);
    m.count += l.count;
    m.kg = Math.round((m.kg + l.kg) * 10) / 10;
    m.minutes += Math.round(l.durationS / 60);
    m.ops += 1;
  }
  for (const [sp, c] of Object.entries(summary.baitUsed || {})) {
    const v = catchValue(sp, c, profile, day);
    if (!v) continue;
    const m = add('oyogase');
    m.sales -= v;
    m.baitCost = (m.baitCost || 0) + v;
  }
  // ジギング: jigs lost to snags are bought again — charged to the method that lost them
  const jigs = profile ? (summary.jigsLost || 0) * jigPrice(profile) : jigCost(summary);
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

/**
 * Fill the accepted orders (注文) from the day's catch: for each order of a
 * fish that was landed, the kg still wanted is taken at the day's price plus
 * the order's bonus. Orders past their last day are dropped (no penalty).
 * Changes p.orders in place (p is the settlement's own copy). Returns the lines.
 */
function fillOrders(p, lines, day) {
  const out = [];
  const keep = [];
  const leftKg = {};
  for (const l of lines) leftKg[l.species] = (leftKg[l.species] || 0) + l.kg;
  for (const o of p.orders) {
    if (o.done || day > o.lastDay) continue; // finished or expired: let go
    const have = leftKg[o.species] || 0;
    const want = Math.max(0, o.kg - o.filledKg);
    const take = Math.min(have, want);
    if (take > 0) {
      const spLines = lines.filter((l) => l.species === o.species);
      const kg = spLines.reduce((a, l) => a + l.kg, 0);
      const avg = kg ? spLines.reduce((a, l) => a + l.amount, 0) / kg : 0;
      const bonusAmount = Math.round(take * avg * o.bonus);
      leftKg[o.species] = have - take;
      o.filledKg = Math.round((o.filledKg + take) * 100) / 100;
      out.push({ id: o.id, species: o.species, from: o.from, kg: Math.round(take * 100) / 100, bonus: o.bonus, bonusAmount, done: o.filledKg >= o.kg - 1e-9 });
    }
    if (o.filledKg >= o.kg - 1e-9) {
      p.stats.ordersDone = (p.stats.ordersDone || 0) + 1;
      continue;
    }
    keep.push(o);
  }
  p.orders = keep;
  return out;
}

/**
 * 図鑑と大物記録: the first catch of each fish (day and area), how many and how
 * much in all, and the biggest one (its own weight, day, area). Changes p.records
 * in place. Returns what is new this voyage: [{species, kind: 'first'|'biggest', w}].
 */
function updateRecords(p, summary, lines) {
  if (!p.records) p.records = {};
  const out = [];
  const bySp = {};
  for (const l of lines) {
    const b = (bySp[l.species] = bySp[l.species] || { n: 0, kg: 0 });
    b.n += l.count;
    b.kg += l.kg;
  }
  for (const [sp, b] of Object.entries(bySp)) {
    const best = (summary.best || {})[sp] || null;
    let r = p.records[sp];
    if (!r) {
      r = p.records[sp] = { firstDay: summary.day, firstArea: best ? best.area : null, count: 0, kg: 0, max: null };
      out.push({ species: sp, kind: 'first' });
    }
    r.count += b.n;
    r.kg = Math.round((r.kg + b.kg) * 100) / 100;
    if (best && (!r.max || best.w > r.max.w)) {
      if (r.max) out.push({ species: sp, kind: 'biggest', w: best.w, before: r.max.w });
      r.max = { w: best.w, day: summary.day, area: best.area, size: best.size };
    }
  }
  return out;
}

// The hold must match the operation logs (every landed fish came from an
// operation), less the fish taken from the hold as live bait (泳がせ).
// Logs written before the longline kept a per-species split (a by-catch of
// アマダイ recorded as マダイ) are accepted when the sizes add up across species.
function holdMatchesLogs(summary) {
  const SZ = ['s', 'm', 'l'];
  const perSpecies = (spId) => {
    const fromLogs = { s: 0, m: 0, l: 0 };
    for (const l of summary.logs) {
      const c = l.bySpecies ? l.bySpecies[spId] : (l.species || 'aji') === spId ? l.catches : null;
      if (c) for (const k of SZ) fromLogs[k] += c[k] || 0;
    }
    const bait = (summary.baitUsed || {})[spId];
    if (bait) for (const k of SZ) fromLogs[k] -= bait[k] || 0;
    return fromLogs;
  };
  const held = (spId, k) => (summary.hold.counts[spId] || {})[k] || 0;
  const species = Object.keys(SPECIES);
  if (species.every((spId) => { const f = perSpecies(spId); return SZ.every((k) => f[k] === held(spId, k)); })) return true;
  if (!summary.logs.some((l) => l.methodId === 'longline' && !l.bySpecies)) return false;
  return SZ.every((k) => species.reduce((a, spId) => a + perSpecies(spId)[k], 0) === species.reduce((a, spId) => a + held(spId, k), 0));
}

/** Land and sell the whole catch, pay the trip cost, gain XP. Exactly once per voyage. */
export function settleVoyage(profile, summary) {
  if (profile.settledVoyages.includes(summary.id)) return { ok: false, reason: 'この航海はすでに精算済みです。' };
  if (!profile.activeVoyage || profile.activeVoyage.id !== summary.id) return { ok: false, reason: '精算対象の航海が見つかりません。' };
  if (!holdMatchesLogs(summary)) return { ok: false, reason: '魚倉と操業記録が一致しません（精算を中止しました）。' };

  const p = clone(profile);
  if (!p.orders) p.orders = [];
  const lines = priceLines(summary.hold.counts, p, summary.day);
  // 注文（R02）: the accepted orders are filled first from what was landed, at a bonus
  const orderLines = fillOrders(p, lines, summary.day);
  const sales = lines.reduce((a, l) => a + l.amount, 0) + orderLines.reduce((a, o) => a + o.bonusAmount, 0);
  const costs = costsOf(p, summary.fuelPerKm || ECONOMY.fuelPerKm);
  const fuel = Math.round((summary.distanceM / 1000) * costs.fuelPerKm);
  const crew = summary.crew ? costs.wage : 0;
  const jigs = (summary.jigsLost || 0) * jigPrice(p);
  const costTotal = costs.base + fuel + crew + jigs;
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

  // 図鑑と大物記録: first catch, totals and the biggest of each fish
  const newRecords = updateRecords(p, summary, lines);
  // the ledger (収支): one line per voyage — what was sold and paid, and what each method earned
  const byMethod = methodEarnings(summary, p);
  const bySpecies = {};
  for (const l of lines) {
    const b = (bySpecies[l.species] = bySpecies[l.species] || { n: 0, kg: 0, sales: 0 });
    b.n += l.count;
    b.kg = Math.round((b.kg + l.kg) * 100) / 100;
    b.sales += l.amount;
  }
  for (const o of orderLines) if (bySpecies[o.species]) bySpecies[o.species].sales += o.bonusAmount;
  if (!Array.isArray(p.ledger)) p.ledger = [];
  p.ledger.push({
    voyageId: summary.id,
    day: summary.day,
    night: !!summary.night,
    sales,
    costs: { base: costs.base, fuel, crew, jigs, total: costTotal },
    net: sales - payable,
    paid: payable,
    byMethod,
    bySpecies,
    best: Object.fromEntries(Object.entries(summary.best || {}).map(([sp, b]) => [sp, b.w])),
  });
  if (p.ledger.length > MAX_LEDGER) p.ledger.splice(0, p.ledger.length - MAX_LEDGER);

  const receipt = {
    voyageId: summary.id,
    day: summary.day,
    lines,
    sales,
    costs: { base: costs.base, fuel, crew, jigs, jigsLost: summary.jigsLost || 0, total: costTotal, paid: payable, waived },
    orders: orderLines,
    newRecords,
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
  const price = item ? itemPrice(profile, item) : 0;
  const res = { item, slot, price, fundsBefore: profile.funds, fundsAfter: profile.funds - price, removed: current ? EQUIPMENT[current.itemId] : null, destination: '倉庫' };
  if (!item || !slot) return { ...res, ok: false, reason: '装備または取付位置が不正です。' };
  if (!fits(item, slot)) return { ...res, ok: false, reason: `${slot.label}には取り付けられません。` };
  if (profile.activeVoyage) return { ...res, ok: false, reason: '航海中は購入できません。' };
  if (current && current.itemId === itemId) return { ...res, ok: false, reason: 'すでに取り付けています。' };
  if (profile.storage.some((s) => s.itemId === itemId)) return { ...res, ok: false, reason: '倉庫に同じ装備があります。倉庫から取り付けてください。' };
  if (profile.funds < price) return { ...res, ok: false, reason: `資金が${(price - profile.funds).toLocaleString()}${ECONOMY.currency}足りません。` };
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
  const price = extraLinePrice(profile);
  if (profile.funds < price) return { ok: false, reason: `資金が足りません（${price.toLocaleString('ja-JP')}G）。` };
  const p = clone(profile);
  p.extraLines = (p.extraLines || 0) + 1;
  p.funds -= price;
  return { ok: true, profile: p, receipt: { price, lines: 1 + p.extraLines, fundsBefore: profile.funds, fundsAfter: p.funds } };
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
  const value = sellPrice(profile, EQUIPMENT[inst.itemId]);
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
  const tradeIn = tradeInOf(profile, profile.boat.model);
  const price = boatPrice(profile, offer);
  const payable = price - tradeIn;
  const res = { offer, model, oldModel, price, tradeIn, payable, fundsBefore: profile.funds, fundsAfter: profile.funds - payable };
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
