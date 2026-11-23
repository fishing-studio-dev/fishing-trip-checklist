// Simple, transactional economy: one-shot settlement after landing, and
// equipment purchase / swap. Each function returns a complete new profile
// (or a refusal) so a transaction is never half-applied (A11).
import { ECONOMY, EQUIPMENT, BOATS, SPECIES, METHODS } from './data.js';
import { addHeardReports } from './knowledge.js';
import { clone } from './profile.js';
import { xpForVoyage, levelFromXp } from './progress.js';

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

/** Land and sell the whole catch, pay the trip cost, gain XP. Exactly once per voyage. */
export function settleVoyage(profile, summary) {
  if (profile.settledVoyages.includes(summary.id)) return { ok: false, reason: 'この航海はすでに精算済みです。' };
  if (!profile.activeVoyage || profile.activeVoyage.id !== summary.id) return { ok: false, reason: '精算対象の航海が見つかりません。' };
  // the hold must match the operation logs (every landed fish came from an operation)
  for (const spId of Object.keys(SPECIES)) {
    const fromLogs = { s: 0, m: 0, l: 0 };
    for (const l of summary.logs) if ((l.species || 'aji') === spId) for (const k of Object.keys(fromLogs)) fromLogs[k] += l.catches[k] || 0;
    const held = summary.hold.counts[spId] || {};
    for (const k of Object.keys(fromLogs)) {
      if (fromLogs[k] !== (held[k] || 0)) return { ok: false, reason: '魚倉と操業記録が一致しません（精算を中止しました）。' };
    }
  }

  const p = clone(profile);
  const lines = priceLines(summary.hold.counts);
  const sales = lines.reduce((a, l) => a + l.amount, 0);
  const fuel = Math.round((summary.distanceM / 1000) * ECONOMY.fuelPerKm);
  const costTotal = ECONOMY.tripBaseCost + fuel;
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

  p.settledVoyages.push(summary.id);
  if (p.settledVoyages.length > 200) p.settledVoyages.shift();
  p.activeVoyage = null;
  p.stats.voyages += 1;
  p.stats.fish += summary.hold.count;
  p.stats.kg = Math.round((p.stats.kg + summary.hold.kg) * 100) / 100;
  p.stats.sales += sales;

  const receipt = {
    voyageId: summary.id,
    day: summary.day,
    lines,
    sales,
    costs: { base: ECONOMY.tripBaseCost, fuel, total: costTotal, paid: payable, waived },
    net: sales - payable,
    fundsBefore,
    fundsAfter: p.funds,
    xp,
    opCount: summary.logs.length,
    opSeconds: summary.opSeconds,
    distanceM: summary.distanceM,
    plan: summary.plan || null,
    heardCount: summary.heard ? summary.heard.length : 0,
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
  if (item.type !== slot.accepts) return { ...res, ok: false, reason: `${slot.label}には取り付けられません。` };
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

/** Swap a stored item onto its slot; the removed item goes to storage. Free. */
export function equipFromStorage(profile, uid, slotId) {
  if (profile.activeVoyage) return { ok: false, reason: '航海中は換装できません。' };
  const idx = profile.storage.findIndex((s) => s.uid === uid);
  if (idx < 0) return { ok: false, reason: '倉庫に見つかりません。' };
  const model = BOATS[profile.boat.model];
  const slot = model.slots.find((s) => s.id === slotId);
  const item = EQUIPMENT[profile.storage[idx].itemId];
  if (!slot || item.type !== slot.accepts) return { ok: false, reason: 'この位置には取り付けられません。' };
  const p = clone(profile);
  const [inst] = p.storage.splice(idx, 1);
  const old = p.boat.slots[slotId];
  if (old) p.storage.push(old);
  p.boat.slots[slotId] = inst;
  return { ok: true, profile: p };
}
