// Side view (サイドビュー) of a mapping sounder: a strip across the boat's
// track, port to starboard. Each sample reads the shared seabed and fish
// (never hidden labels): the bottom's hardness and slope give the picture,
// fish close over the bottom show as bright points. The same samples feed the
// depth map.
import { depthAt, bottomIsRocky } from './sea.js';
import { densityAt, posesAt } from './world.js';
import { hashFloat } from './rng.js';

/** World position of a point on a stored side-view line (offset < 0 = port). */
export function sideToWorld(row, offset) {
  return { x: row.x + Math.cos(row.h) * offset, y: row.y - Math.sin(row.h) * offset };
}

/** One across-track line: {vals: Uint8Array(n), depths: number[], offsets: number[]}. */
export function sideColumn(world, x, y, heading, spec, pingIndex) {
  const R = spec.side.range;
  const step = spec.side.res;
  const n = Math.round((2 * R) / step) + 1;
  const rx = Math.cos(heading);
  const ry = -Math.sin(heading);
  const vals = new Uint8Array(n);
  const depths = new Array(n);
  const offsets = new Array(n);
  let poses = null;
  let prev = null;
  for (let k = 0; k < n; k++) {
    const o = -R + k * step; // negative = port
    const px = x + rx * o;
    const py = y + ry * o;
    const d = depthAt(px, py);
    depths[k] = d;
    offsets[k] = o;
    // slope toward the boat lights up, slope away leaves a shadow
    const outward = prev == null ? 0 : (Math.abs(o) > Math.abs(o - step) ? prev - d : d - prev);
    let v = 0.22 + (bottomIsRocky(px, py) ? 0.28 : 0) + Math.max(-0.2, Math.min(0.45, outward * 0.35));
    v *= 0.85 + 0.3 * hashFloat(pingIndex, k, 17);
    // fish just over the bottom (rockfish, schools near the bottom)
    if (!poses) poses = posesAt(world);
    const rho = densityAt(world, px, py, Math.max(1, d - 2), poses).total;
    if (rho > 0) v = Math.max(v, Math.min(1, 0.55 + (1 - Math.exp(-rho * spec.gainK)) * 0.9));
    vals[k] = Math.max(0, Math.min(255, Math.round(v * 255)));
    prev = d;
  }
  return { t: world.time, vals, depths, offsets, x, y, heading };
}
