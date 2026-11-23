// Deterministic random numbers and hash-based noise.
// All simulation randomness must come from here so that the same seed and the
// same game-time steps always reproduce the same sea (no re-rolls from UI).

/** Create a serializable RNG state object. */
export function createRng(seed) {
  return { s: (seed >>> 0) || 0x9e3779b9 };
}

/** mulberry32: returns float in [0,1) and advances state in place. */
export function rngNext(rng) {
  rng.s = (rng.s + 0x6d2b79f5) >>> 0;
  let t = rng.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function rngRange(rng, a, b) {
  return a + (b - a) * rngNext(rng);
}

export function rngInt(rng, a, bInclusive) {
  return a + Math.floor(rngNext(rng) * (bInclusive - a + 1));
}

/** Stateless integer hash of any number of integers -> uint32. */
export function hashInts(...vals) {
  let h = 0x811c9dc5;
  for (const v of vals) {
    let x = (v | 0) >>> 0;
    for (let i = 0; i < 4; i++) {
      h ^= x & 0xff;
      h = Math.imul(h, 0x01000193) >>> 0;
      x >>>= 8;
    }
  }
  // final avalanche
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/** Stateless hash -> float in [0,1). */
export function hashFloat(...vals) {
  return hashInts(...vals) / 4294967296;
}

/** Smooth 1D value noise in [-1,1] over continuous t (cell size = 1). */
export function noise1(seed, t) {
  const i = Math.floor(t);
  const f = t - i;
  const a = hashFloat(seed, i) * 2 - 1;
  const b = hashFloat(seed, i + 1) * 2 - 1;
  const u = f * f * (3 - 2 * f);
  return a + (b - a) * u;
}

/** FNV-1a over a string -> 8 hex chars (used for save checksums & state hashes). */
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
