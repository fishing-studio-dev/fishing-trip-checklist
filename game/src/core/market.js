// 相場と値段（R05・R19・本作設定）: what fish fetch on a given day, and what gear,
// boats and costs come to at the save's difficulty. Pure functions of (seed,
// day, species, difficulty) — the same for everyone who looks, never random.
import { SPECIES, EQUIPMENT, BOATS, DIFFICULTY, MARKET, LONGLINE_LINES, ECONOMY, CREW } from './data.js';
import { usualAbundance } from './almanac.js';
import { weatherOf } from './sea.js';
import { hashString, noise1 } from './rng.js';

export function difficultyOf(profile) {
  return DIFFICULTY[(profile && profile.difficulty) || 'normal'] || DIFFICULTY.normal;
}

const round100 = (v) => Math.round(v / 100) * 100;
const spKey = (sp) => parseInt(hashString(sp), 16) % 100000;

/** Equipment, boat and line prices at the save's difficulty (rounded to 100 G). */
export function itemPrice(profile, item) {
  return item.price > 0 ? round100(item.price * difficultyOf(profile).gear) : 0;
}
export function boatPrice(profile, offer) {
  return round100(offer.price * difficultyOf(profile).gear);
}
export function tradeInOf(profile, modelId) {
  return round100(BOATS[modelId].tradeIn * difficultyOf(profile).gear);
}
export function extraLinePrice(profile) {
  return round100(LONGLINE_LINES.extraPrice * difficultyOf(profile).gear);
}
/** What a stored item sells for (half of its price; a basic item 300 G). */
export function sellPrice(profile, item) {
  return item.price > 0 ? round100(item.price * 0.5 * difficultyOf(profile).gear) : 300;
}
export function jigPrice(profile) {
  return round100(EQUIPMENT.rod_jg1.rod.jigPrice * difficultyOf(profile).gear);
}
/** The day's fixed costs at the save's difficulty: ice and bait, fuel per km, the deckhand. */
export function costsOf(profile, fuelPerKm) {
  const k = difficultyOf(profile).cost;
  return { base: round100(ECONOMY.tripBaseCost * k), fuelPerKm: Math.round(fuelPerKm * k), wage: round100(CREW.wage * k) };
}

/**
 * The market's mood for a fish on day d (about 0.75–1.35): in season and
 * plentiful → cheaper, scarce → dearer, a smooth day-to-day wobble, dearer
 * after a rough day.
 */
export function marketFactor(worldSeed, day, species) {
  const season = 1 + MARKET.seasonSwing / 2 - MARKET.seasonSwing * Math.min(1, usualAbundance(species, day));
  const wobble = 1 + MARKET.dailySwing * noise1(worldSeed * 11 + spKey(species), day / 3);
  const rough = day > 1 && weatherOf(worldSeed, day - 1).rough ? MARKET.afterRough : 1;
  return season * wobble * rough;
}

/** Price per kg of one size of a fish on day d (G, rounded to 10). */
export function pricePerKg(profile, day, species, size) {
  const base = SPECIES[species].sizes[size].pricePerKg;
  if (!base) return 0;
  return Math.round((base * marketFactor(profile.worldSeed, day, species) * difficultyOf(profile).price) / 10) * 10;
}

/** The average price multiplier for selling `kg` of one fish in one day (the market's depth). */
export function depthMultiplier(species, kg) {
  const depth = MARKET.depthKg[species] || 40;
  if (kg <= depth) return 1;
  let left = kg;
  let value = 0;
  for (let i = 0; left > 0; i++) {
    const take = Math.min(left, depth);
    value += take * MARKET.tiers[Math.min(i, MARKET.tiers.length - 1)];
    left -= take;
  }
  return value / kg;
}

/** The port board: the market price per kg (the middle size) of each fish on day d. */
export function marketBoard(profile, day) {
  return Object.keys(SPECIES)
    .filter((sp) => !SPECIES[sp].bait)
    .map((sp) => {
      const mid = SPECIES[sp].sizeOrder[1] || SPECIES[sp].sizeOrder[0];
      const p = pricePerKg(profile, day, sp, mid);
      const base = SPECIES[sp].sizes[mid].pricePerKg * difficultyOf(profile).price;
      return { species: sp, name: SPECIES[sp].name, size: SPECIES[sp].sizes[mid].label, price: p, vsUsual: Math.round((p / base - 1) * 100) };
    });
}
