// Depth mapping (デプスマッピング): depths measured by a mapping sounder are
// remembered on a 10 m grid, across days. Only what the player's own sounder
// measured is stored — the printed chart is never filled in for them.
// Runtime form: { cells: { [cellIndex]: byte } } (byte = depth × 2, 1..255;
// 0 = not measured). Saved form (profile): { res, tiles: { 'tx,ty': base64 } }.
import { AREA } from './data.js';

export const RES = 10; // m per cell
export const TILE = 10; // cells per tile side (100 m)
const NX = Math.ceil(AREA.W / RES);
const NY = Math.ceil(AREA.H / RES);

export function cellIndex(x, y) {
  const i = Math.floor(x / RES);
  const j = Math.floor(y / RES);
  if (i < 0 || j < 0 || i >= NX || j >= NY) return -1;
  return j * NX + i;
}

export function cellCenter(idx) {
  return { x: (idx % NX) * RES + RES / 2, y: Math.floor(idx / NX) * RES + RES / 2 };
}

export function emptyBathy() {
  return { res: RES, tiles: {} };
}

/** Record one measured depth (voyage cells: plain object, JSON-ready). */
export function recordDepth(cells, x, y, depth) {
  const idx = cellIndex(x, y);
  if (idx < 0 || !(depth > 0)) return false;
  const b = Math.max(1, Math.min(255, Math.round(depth * 2)));
  const was = cells[idx];
  cells[idx] = b;
  return was !== b;
}

export function depthOfByte(b) {
  return b ? b / 2 : null;
}

const b64 = {
  enc: (bytes) => globalThis.btoa(String.fromCharCode(...bytes)),
  dec: (s) => Uint8Array.from(globalThis.atob(s), (c) => c.charCodeAt(0)),
};

/** Saved tiles -> runtime cells (only measured cells). */
export function cellsFromBathy(bathy) {
  const cells = {};
  if (!bathy || !bathy.tiles) return cells;
  for (const [key, s] of Object.entries(bathy.tiles)) {
    const [tx, ty] = key.split(',').map(Number);
    const bytes = b64.dec(s);
    for (let k = 0; k < bytes.length; k++) {
      if (!bytes[k]) continue;
      const i = tx * TILE + (k % TILE);
      const j = ty * TILE + Math.floor(k / TILE);
      if (i < NX && j < NY) cells[j * NX + i] = bytes[k];
    }
  }
  return cells;
}

/** Merge a voyage's measured cells into the saved map; returns a new bathy object. */
export function mergeBathy(bathy, cells) {
  const out = { res: RES, tiles: { ...((bathy && bathy.tiles) || {}) } };
  const byTile = new Map();
  for (const [k, b] of Object.entries(cells || {})) {
    const idx = Number(k);
    const i = idx % NX;
    const j = Math.floor(idx / NX);
    const key = `${Math.floor(i / TILE)},${Math.floor(j / TILE)}`;
    if (!byTile.has(key)) byTile.set(key, out.tiles[key] ? b64.dec(out.tiles[key]) : new Uint8Array(TILE * TILE));
    byTile.get(key)[(j % TILE) * TILE + (i % TILE)] = b;
  }
  for (const [key, bytes] of byTile) out.tiles[key] = b64.enc(bytes);
  return out;
}

export function bathyCellCount(bathy) {
  return Object.keys(cellsFromBathy(bathy)).length;
}
