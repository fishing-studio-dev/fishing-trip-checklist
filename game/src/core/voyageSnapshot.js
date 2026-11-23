// Saving a voyage at sea and picking it up again (海上での途中保存).
// The whole voyage is plain data (world counts, RNG state, boat, operation,
// longline, sounder history), so a snapshot restores it exactly: continuing a
// restored voyage gives the same sea, catch and logs as never having stopped.
// Sounder history keeps only its newest columns (what the screen and the
// automatic tana reading need); everything else is kept whole.
import { hashString } from './rng.js';
import { mergeBathy, cellsFromBathy } from './bathy.js';

export const SNAPSHOT_VERSION = 1;
const KEEP_COLS = 40;

function encodeCol(c) {
  return { ...c, bins: Array.from(c.bins) };
}
function decodeCol(c) {
  return { ...c, bins: Uint8Array.from(c.bins) };
}

/** A JSON-ready copy of the voyage (with a checksum). */
export function snapshotVoyage(v, savedAt = new Date().toISOString()) {
  const obs = { ...v.obs, cols: v.obs.cols.slice(-KEEP_COLS).map(encodeCol), side: (v.obs.side || []).slice(-KEEP_COLS).map((c) => ({ t: c.t, vals: Array.from(c.vals) })) };
  // the track is only drawn on the chart: whole metres are enough
  const track = v.track.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y), t: Math.round(p.t) }));
  // measured depths: packed as map tiles (compact)
  const bathy = { tiles: mergeBathy(null, (v.bathy && v.bathy.cells) || {}).tiles };
  const data = JSON.parse(JSON.stringify({ ...v, obs, track, bathy }));
  const body = JSON.stringify(data);
  return { format: 'ryoshi-game-voyage', version: SNAPSHOT_VERSION, voyageId: v.id, day: v.day, savedAt, checksum: hashString(body), data };
}

/** Check a stored snapshot against the profile's open voyage. Returns {ok, voyage} or {ok:false, reason}. */
export function restoreVoyage(raw, activeVoyage) {
  let snap;
  try {
    snap = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return { ok: false, reason: '海上の保存データを読めません' };
  }
  if (!snap || snap.format !== 'ryoshi-game-voyage') return { ok: false, reason: '海上の保存データの形式が違います' };
  if (snap.version !== SNAPSHOT_VERSION) return { ok: false, reason: '海上の保存データの版が違います' };
  if (!activeVoyage || snap.voyageId !== activeVoyage.id || snap.day !== activeVoyage.day) return { ok: false, reason: '今の航海の保存データではありません' };
  if (hashString(JSON.stringify(snap.data)) !== snap.checksum) return { ok: false, reason: '海上の保存データが壊れています' };
  const v = JSON.parse(JSON.stringify(snap.data));
  v.obs.cols = v.obs.cols.map(decodeCol);
  v.obs.side = (v.obs.side || []).map((c) => ({ t: c.t, vals: Uint8Array.from(c.vals) }));
  v.bathy = { cells: cellsFromBathy(v.bathy) };
  return { ok: true, voyage: v, savedAt: snap.savedAt };
}
