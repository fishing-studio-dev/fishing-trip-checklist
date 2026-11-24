// 注文（R02・本作設定）: requests from the market and the cooks, offered each
// morning — so many kg of a fish by a given day, at a bonus on the day's price.
// Taking one is up to the player; an order not filled by its last day simply
// lapses (no penalty). Offers are a pure function of (seed, day): the same for
// everyone who looks. Accepting returns a new profile.
import { SPECIES, ORDERS, MARKET } from './data.js';
import { usualAbundance } from './almanac.js';
import { hashFloat } from './rng.js';
import { clone } from './profile.js';

const BUYERS = ['仲買の山下さん', '料理屋「磯政」', '旅館「玄海荘」', '寿司「辰巳」', '鮮魚店「魚弥」'];

/** The orders offered on the morning of day d. */
export function ordersOffered(worldSeed, day) {
  const r = (k, j = 0) => hashFloat(worldSeed, day, k, j, 971);
  const n = ORDERS.perDay[0] + Math.floor(r(1) * (ORDERS.perDay[1] - ORDERS.perDay[0] + 1));
  // fish that are about at this time of year (what is said), the dearer ones more often
  const pool = Object.keys(SPECIES).filter((sp) => !SPECIES[sp].bait && usualAbundance(sp, day) >= 0.35);
  const weight = (sp) => usualAbundance(sp, day) * Math.sqrt(SPECIES[sp].sizes[SPECIES[sp].sizeOrder[1]].pricePerKg / 500);
  const out = [];
  for (let i = 0; i < n && pool.length; i++) {
    const total = pool.reduce((a, sp) => a + weight(sp), 0);
    let x = r(2, i) * total;
    let sp = pool[0];
    for (const s of pool) {
      x -= weight(s);
      if (x < 0) {
        sp = s;
        break;
      }
    }
    pool.splice(pool.indexOf(sp), 1);
    const depth = MARKET.depthKg[sp] || 40;
    const kg = Math.max(1, Math.round(depth * (0.12 + 0.25 * r(3, i))));
    const days = ORDERS.days[0] + Math.floor(r(4, i) * (ORDERS.days[1] - ORDERS.days[0] + 1));
    const bonus = Math.round((ORDERS.bonus[0] + (ORDERS.bonus[1] - ORDERS.bonus[0]) * r(5, i)) * 20) / 20;
    out.push({ id: `O${day}-${i + 1}`, species: sp, kg, bonus, lastDay: day + days - 1, from: BUYERS[Math.floor(r(6, i) * BUYERS.length)], offeredDay: day });
  }
  return out;
}

/** Take an offered order (in port, before going out). Returns {ok, profile} or a refusal. */
export function acceptOrder(profile, offer, today) {
  if (profile.activeVoyage) return { ok: false, reason: '航海中は受けられません。' };
  const active = (profile.orders || []).filter((o) => !o.done && o.lastDay >= today);
  if (active.length >= ORDERS.maxActive) return { ok: false, reason: `注文は同時に${ORDERS.maxActive}件までです。` };
  if ((profile.orders || []).some((o) => o.id === offer.id)) return { ok: false, reason: 'すでに受けています。' };
  if (offer.lastDay < today) return { ok: false, reason: '期限が過ぎています。' };
  const p = clone(profile);
  p.orders = [...active, { ...offer, filledKg: 0 }];
  return { ok: true, profile: p };
}

/** Let an accepted order go (no penalty). */
export function dropOrder(profile, id) {
  if (profile.activeVoyage) return { ok: false, reason: '航海中は取り消せません。' };
  const p = clone(profile);
  p.orders = (p.orders || []).filter((o) => o.id !== id);
  return { ok: true, profile: p };
}

/** The orders that still count on day d (accepted, not done, not past their last day). */
export function activeOrders(profile, day) {
  return (profile.orders || []).filter((o) => !o.done && o.lastDay >= day);
}
