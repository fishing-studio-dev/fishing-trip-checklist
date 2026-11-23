// 2D chart (GPS plotter). Shows fixed geography and what the player has
// observed (track, marks, operation spots). Fish are only drawn in dev mode,
// clearly labelled, and never in normal play.
import { AREA, PORT, BOATS } from '../core/data.js';
import { baseDepthAt, isLand, CHART_LABELS, fmtClock, STRUCTURES, STRUCTURE_LABEL } from '../core/sea.js';
import { schoolCenter, schoolTotal } from '../core/world.js';
import { markTitle } from '../core/marks.js';

/**
 * One of the player's marks: the shape tells how it was made (▲ the boat's
 * place, ■ a sounder echo, ◆ a side-view echo, ✚ a sonar echo). Marks from
 * earlier days are a little darker. `label` is drawn beside it when given.
 */
export function drawMarkSymbol(ctx, m, px, py, { old = false, label = '', selected = false } = {}) {
  ctx.save();
  ctx.fillStyle = old ? '#d9b93a' : '#ffe14d';
  ctx.strokeStyle = 'rgba(10,16,30,0.9)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  if (m.kind === 'sounder') ctx.rect(px - 4, py - 4, 8, 8);
  else if (m.kind === 'side') {
    ctx.moveTo(px, py - 6);
    ctx.lineTo(px + 5, py);
    ctx.lineTo(px, py + 6);
    ctx.lineTo(px - 5, py);
    ctx.closePath();
  } else if (m.kind === 'sonar') {
    ctx.rect(px - 1.8, py - 6, 3.6, 12);
    ctx.rect(px - 6, py - 1.8, 12, 3.6);
  } else {
    ctx.moveTo(px, py - 6);
    ctx.lineTo(px + 5, py + 3);
    ctx.lineTo(px - 5, py + 3);
    ctx.closePath();
  }
  ctx.stroke();
  ctx.fill();
  if (selected) {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px, py, 11, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (label) {
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(6,14,28,0.85)';
    ctx.strokeText(label, px + 7, py + 4);
    ctx.fillStyle = old ? 'rgba(240,222,160,0.95)' : 'rgba(255,240,190,0.98)';
    ctx.fillText(label, px + 7, py + 4);
  }
  ctx.restore();
}

const RES = 10; // metres per pixel of the static map

function depthColor(d) {
  // shallow -> light teal, deep -> navy
  const t = Math.max(0, Math.min(1, (d - 2) / 65));
  const a = [128, 196, 205];
  const b = [10, 36, 78];
  return a.map((v, i) => Math.round(v + (b[i] - v) * Math.pow(t, 0.8)));
}

export function buildStaticMap() {
  const w = AREA.W / RES;
  const h = AREA.H / RES;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const depths = new Float32Array(w * h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const x = (i + 0.5) * RES;
      const y = AREA.H - (j + 0.5) * RES;
      depths[j * w + i] = isLand(x, y) ? -1 : baseDepthAt(x, y); // the printed chart: small structures are not on it
    }
  }
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const d = depths[j * w + i];
      const k = (j * w + i) * 4;
      let col;
      if (d < 0) col = [116, 132, 96];
      else {
        col = depthColor(d);
        // 10 m contour lines
        const band = Math.floor(d / 10);
        const nb = [depths[j * w + Math.min(w - 1, i + 1)], depths[Math.min(h - 1, j + 1) * w + i]];
        if (nb.some((n) => n >= 0 && Math.floor(n / 10) !== band)) col = col.map((v) => Math.min(255, v + 45));
        if (nb.some((n) => n < 0)) col = [210, 200, 170];
      }
      img.data[k] = col[0];
      img.data[k + 1] = col[1];
      img.data[k + 2] = col[2];
      img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// ---- the own depth map (デプスマッピング), shown like a plotter's own-chart
// layer: depth shading in colour (shallow red → yellow → green → cyan → blue →
// violet deep), contour lines every 2 m and bold every 10 m with the depth.
// Only cells the player's sounder measured are drawn.
const MAP_NX = Math.ceil(AREA.W / 10);
const MAP_NY = Math.ceil(AREA.H / 10);
const DEPTH_STOPS = [
  [0, [215, 38, 30]],
  [5, [245, 115, 25]],
  [10, [250, 205, 35]],
  [18, [110, 200, 70]],
  [28, [35, 190, 185]],
  [40, [40, 125, 225]],
  [55, [62, 64, 205]],
  [75, [100, 45, 160]],
];
export const DEPTH_LEGEND = [0, 10, 20, 30, 40, 60, 80];

/** Colour of a depth on the own depth map. */
export function depthShade(d) {
  if (d <= DEPTH_STOPS[0][0]) return DEPTH_STOPS[0][1];
  for (let i = 0; i < DEPTH_STOPS.length - 1; i++) {
    const [d0, c0] = DEPTH_STOPS[i];
    const [d1, c1] = DEPTH_STOPS[i + 1];
    if (d <= d1) {
      const u = (d - d0) / (d1 - d0);
      return c0.map((c, k) => Math.round(c + (c1[k] - c) * u));
    }
  }
  return DEPTH_STOPS[DEPTH_STOPS.length - 1][1];
}

let bathyCache = null;
let bathyKey = '';

/**
 * Build (when the measured cells change) the colour layer (10 m per pixel) and
 * the contour lines (world coordinates, marching squares over the measured
 * grid). Returns { layer, minor: [x1,y1,x2,y2,...], major: [...], majorLevel: [...] } or null.
 */
export function bathyCanvas(baseCells, voyCells) {
  const nV = voyCells ? Object.keys(voyCells).length : 0;
  const nB = baseCells ? Object.keys(baseCells).length : 0;
  const key = `${nB}:${nV}`;
  if (bathyCache && key === bathyKey) return bathyCache;
  if (!nB && !nV) return null;
  bathyKey = key;
  const depth = new Float32Array(MAP_NX * MAP_NY).fill(NaN);
  for (const src of [baseCells, voyCells]) for (const k in src || {}) if (src[k]) depth[Number(k)] = src[k] / 2;
  const layer = document.createElement('canvas');
  layer.width = MAP_NX;
  layer.height = MAP_NY;
  const ctx = layer.getContext('2d');
  const img = ctx.createImageData(MAP_NX, MAP_NY);
  const minor = [];
  const major = [];
  const majorLevel = [];
  for (let idx = 0; idx < depth.length; idx++) {
    const d = depth[idx];
    if (Number.isNaN(d)) continue;
    const i = idx % MAP_NX;
    const j = Math.floor(idx / MAP_NX);
    const col = depthShade(d);
    const p = ((MAP_NY - 1 - j) * MAP_NX + i) * 4;
    img.data[p] = col[0];
    img.data[p + 1] = col[1];
    img.data[p + 2] = col[2];
    img.data[p + 3] = 230;
    // contours: the square between this cell's centre and its east / north / north-east neighbours
    if (i + 1 >= MAP_NX || j + 1 >= MAP_NY) continue;
    const a = d; // (i, j)
    const b = depth[idx + 1]; // (i+1, j)
    const c = depth[idx + 1 + MAP_NX]; // (i+1, j+1)
    const e = depth[idx + MAP_NX]; // (i, j+1)
    if (Number.isNaN(b) || Number.isNaN(c) || Number.isNaN(e)) continue;
    const lo = Math.min(a, b, c, e);
    const hi = Math.max(a, b, c, e);
    const x0 = i * 10 + 5;
    const y0 = j * 10 + 5;
    for (let L = Math.ceil(lo / 2) * 2; L < hi; L += 2) {
      if (L <= lo) continue;
      // crossing points on the edges, in order: bottom, right, top, left
      const pts = [];
      const cross = (va, vb, xa, ya, xb, yb) => {
        if ((va < L) !== (vb < L)) {
          const u = (L - va) / (vb - va);
          pts.push(xa + (xb - xa) * u, ya + (yb - ya) * u);
        }
      };
      cross(a, b, x0, y0, x0 + 10, y0);
      cross(b, c, x0 + 10, y0, x0 + 10, y0 + 10);
      cross(e, c, x0, y0 + 10, x0 + 10, y0 + 10);
      cross(a, e, x0, y0, x0, y0 + 10);
      const out = L % 10 === 0 ? major : minor;
      for (let q = 0; q + 3 < pts.length; q += 4) {
        out.push(pts[q], pts[q + 1], pts[q + 2], pts[q + 3]);
        if (out === major) majorLevel.push(L);
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  bathyCache = { layer, minor, major, majorLevel };
  return bathyCache;
}

/** Draw the own depth map (colour, contours, depth labels) with a world→screen transform. */
function drawDepthMap(ctx, bathy, toPx, scale, W, H, { labels = true } = {}) {
  const [ox, oy] = toPx(0, AREA.H);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.globalAlpha = 0.92;
  ctx.drawImage(bathy.layer, ox, oy, AREA.W * scale, AREA.H * scale);
  ctx.globalAlpha = 1;
  const seg = (arr, i) => {
    const [x1, y1] = toPx(arr[i], arr[i + 1]);
    const [x2, y2] = toPx(arr[i + 2], arr[i + 3]);
    if ((x1 < -2 && x2 < -2) || (x1 > W + 2 && x2 > W + 2) || (y1 < -2 && y2 < -2) || (y1 > H + 2 && y2 > H + 2)) return null;
    return [x1, y1, x2, y2];
  };
  // fine 2 m lines only when they are far enough apart to read
  if (scale * 10 >= 1.4) {
    ctx.strokeStyle = 'rgba(15,20,35,0.42)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (let i = 0; i < bathy.minor.length; i += 4) {
      const s = seg(bathy.minor, i);
      if (!s) continue;
      ctx.moveTo(s[0], s[1]);
      ctx.lineTo(s[2], s[3]);
    }
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(8,10,22,0.85)';
  ctx.lineWidth = scale * 10 >= 1.4 ? 1.6 : 1;
  ctx.beginPath();
  for (let i = 0; i < bathy.major.length; i += 4) {
    const s = seg(bathy.major, i);
    if (!s) continue;
    ctx.moveTo(s[0], s[1]);
    ctx.lineTo(s[2], s[3]);
  }
  ctx.stroke();
  if (labels && scale * 10 >= 0.8) {
    // depth numbers on the bold lines, spread out
    const placed = [];
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 3;
    for (let i = 0, n = 0; i < bathy.major.length; i += 4, n++) {
      const s = seg(bathy.major, i);
      if (!s) continue;
      const mx = (s[0] + s[2]) / 2;
      const my = (s[1] + s[3]) / 2;
      if (mx < 14 || mx > W - 14 || my < 40 || my > H - 20) continue;
      if (placed.some((p) => Math.hypot(p[0] - mx, p[1] - my) < 90)) continue;
      placed.push([mx, my]);
      const t = `${bathy.majorLevel[n]}`;
      ctx.strokeStyle = 'rgba(8,10,22,0.85)';
      ctx.strokeText(t, mx, my + 3);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(t, mx, my + 3);
    }
  }
  ctx.restore();
}

/** The colour key for the own depth map (bottom right). */
function drawDepthLegend(ctx, W, H) {
  const w = 150;
  const x = W - w - 10;
  const y = H - 30;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(x - 6, y - 15, w + 12, 32);
  const grad = ctx.createLinearGradient(x, 0, x + w, 0);
  for (let k = 0; k <= 16; k++) {
    const d = (k / 16) * 80;
    const c = depthShade(d);
    grad.addColorStop(k / 16, `rgb(${c[0]},${c[1]},${c[2]})`);
  }
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, w, 7);
  ctx.fillStyle = '#ffffff';
  ctx.font = '9px sans-serif';
  ctx.textAlign = 'center';
  for (const d of DEPTH_LEGEND) ctx.fillText(`${d}`, x + (d / 80) * w, y + 16);
  ctx.textAlign = 'left';
  ctx.fillText('自分の水深図（m）', x, y - 4);
  ctx.restore();
}

/**
 * Draw the chart. view: {big:boolean}. data: {voyage, dev}
 */
// zoom steps of the enlarged chart: null = the whole sea, else metres across the shorter side, centred on the boat
export const CHART_SPANS = [null, 3000, 1500, 600];

function viewOf(v, big, W, H = W, span = null) {
  // enlarged: the whole sea fitted into the canvas, or a zoom around the boat; small: 1.3 km around the boat
  if (big && !span) return { cx: AREA.W / 2, cy: AREA.H / 2, scale: Math.min(W / AREA.W, H / AREA.H) };
  if (big) {
    // centred on the boat, but kept inside the sea so no screen is wasted past its edge
    const scale = Math.min(W, H) / span;
    const hw = W / 2 / scale;
    const hh = H / 2 / scale;
    const cx = hw * 2 >= AREA.W ? AREA.W / 2 : Math.max(hw, Math.min(AREA.W - hw, v.boat.x));
    const cy = hh * 2 >= AREA.H ? AREA.H / 2 : Math.max(hh, Math.min(AREA.H - hh, v.boat.y));
    return { cx, cy, scale };
  }
  return { cx: v.boat.x, cy: v.boat.y, scale: W / 1300 };
}

/** World coordinates of a click on the chart canvas (CSS pixels). */
export function chartToWorld(canvas, v, big, px, py, span = null) {
  const W = canvas.clientWidth || canvas.width;
  const H = canvas.clientHeight || canvas.height;
  const { cx, cy, scale } = viewOf(v, big, W, H, span);
  return { x: (px - W / 2) / scale + cx, y: cy - (py - H / 2) / scale };
}

/** Canvas position (CSS pixels) of a world point (the inverse of chartToWorld). */
export function worldToChart(canvas, v, big, x, y, span = null) {
  const W = canvas.clientWidth || canvas.width;
  const H = canvas.clientHeight || canvas.height;
  const { cx, cy, scale } = viewOf(v, big, W, H, span);
  return { px: (x - cx) * scale + W / 2, py: H / 2 - (y - cy) * scale };
}

/** The navigation-zone line of a boat model (only small boats have one). */
function drawRangeLimit(ctx, modelId, toPx, W, small) {
  const r = BOATS[modelId] && BOATS[modelId].range;
  if (!r || r.maxY == null) return;
  const [, py] = toPx(0, r.maxY);
  if (py < -10 || py > ctx.canvas.height) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(255,150,120,0.9)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(0, py);
  ctx.lineTo(W, py);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(255,190,170,0.95)';
  ctx.font = `${small ? 10 : 11}px sans-serif`;
  ctx.textAlign = 'left';
  ctx.fillText(`${BOATS[modelId].name}の航行区域の境`, 6, py - 4);
  ctx.restore();
}

const SPECIES_COLOR = { aji: '#ffd84d', sawara: '#ff8a5c', madai: '#ff6f91' };

/** Marker for an observation report: where and when it was seen (not where fish are now). */
export function drawReportMarker(ctx, r, px, py, label, small = false) {
  const col = r.species ? SPECIES_COLOR[r.species] : '#cfe3ea';
  const s = small ? 4 : 5.5;
  ctx.save();
  ctx.strokeStyle = col;
  ctx.fillStyle = col;
  ctx.lineWidth = 2;
  ctx.beginPath();
  if (r.kind === 'catch') ctx.arc(px, py, s, 0, Math.PI * 2), ctx.fill();
  else if (r.kind === 'echo') {
    ctx.arc(px, py, s, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(px, py, s * 0.4, 0, Math.PI * 2);
    ctx.fill();
  } else if (r.kind === 'sighting') {
    ctx.moveTo(px, py - s - 1);
    ctx.lineTo(px + s, py + s - 1);
    ctx.lineTo(px - s, py + s - 1);
    ctx.closePath();
    ctx.stroke();
  } else {
    ctx.moveTo(px - s, py - s);
    ctx.lineTo(px + s, py + s);
    ctx.moveTo(px + s, py - s);
    ctx.lineTo(px - s, py + s);
    ctx.stroke();
  }
  if (label) {
    ctx.font = `${small ? 9 : 10}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.fillText(label, px + s + 3, py + 3);
  }
  ctx.restore();
}

function drawRoute(ctx, pts, toPx, style) {
  if (!pts || pts.length < 2) return;
  ctx.save();
  ctx.strokeStyle = style.color;
  ctx.lineWidth = style.width || 2;
  if (style.dash) ctx.setLineDash(style.dash);
  ctx.beginPath();
  pts.forEach((p, i) => {
    const [x, y] = toPx(p.x, p.y);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = style.color;
  pts.forEach((p, i) => {
    if (i === 0) return;
    const [x, y] = toPx(p.x, p.y);
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
}

/** The longline lying on the bottom: the hooks laid so far and the two end buoys. */
function drawLongline(ctx, line, toPx, label) {
  if (!line || !line.hooks.length) return;
  const down = line.hooks.filter((h) => !h.up);
  if (!down.length) return;
  line = { ...line, hooks: down };
  ctx.save();
  ctx.strokeStyle = '#ffc65c';
  ctx.lineWidth = 2.2;
  ctx.setLineDash([2, 3]);
  ctx.beginPath();
  line.hooks.forEach((h, i) => {
    const [x, y] = toPx(h.x, h.y);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.setLineDash([]);
  const ends = [line.hooks[0], line.hooks[line.hooks.length - 1]];
  ends.forEach((h, i) => {
    if (i === 1 && line.hooks.length < 2) return;
    const [x, y] = toPx(h.x, h.y);
    ctx.fillStyle = '#ff7a1a';
    ctx.beginPath();
    ctx.arc(x, y, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffd400';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y - 11);
    ctx.stroke();
    ctx.fillStyle = '#ffd400';
    ctx.fillRect(x, y - 11, 6, 4);
  });
  if (label) {
    const [x, y] = toPx(ends[0].x, ends[0].y);
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffe0a0';
    ctx.fillText(label, x + 8, y + 12);
  }
  ctx.restore();
}

/**
 * Draw the chart at sea. opts: { big, dev, reports: [{r, label}], route: {points, live}, hint, line, lineLabel }
 */
export function drawChart(canvas, staticMap, v, { big = false, span = null, dev = false, reports = [], route = null, hint = '', line = null, lineLabel = '', bathy = null, saved = [], selected = null } = {}) {
  if (!canvas.getClientRects().length) return; // not on screen (display:none): its size would read as 0
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = canvas.clientWidth || canvas.width;
  const cssH = canvas.clientHeight || canvas.height;
  if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = cssW;
  const H = cssH;
  const { cx, cy, scale } = viewOf(v, big, W, H, span);
  const toPx = (x, y) => [(x - cx) * scale + W / 2, H / 2 - (y - cy) * scale];
  ctx.fillStyle = '#0a244e';
  ctx.fillRect(0, 0, W, H);
  // static map: map pixel (i,j) covers world x=i*RES, y=AREA.H-j*RES
  const [ox, oy] = toPx(0, AREA.H);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(staticMap, ox, oy, AREA.W * scale, AREA.H * scale);
  if (bathy) drawDepthMap(ctx, bathy, toPx, scale, W, H);

  ctx.font = `${big ? 13 : 10}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  for (const l of CHART_LABELS) {
    const [px, py] = toPx(l.x, l.y);
    ctx.fillText(l.name, px, py);
  }
  drawRangeLimit(ctx, v.modelId, toPx, W, !big);
  // port
  {
    const [px, py] = toPx(PORT.dock.x, PORT.dock.y);
    ctx.fillStyle = '#ffd25e';
    ctx.fillRect(px - 4, py - 4, 8, 8);
    ctx.fillStyle = '#fff';
    ctx.fillText('港', px, py + 16);
  }
  // track
  if (v.track.length > 1) {
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    v.track.forEach((p, i) => {
      const [px, py] = toPx(p.x, p.y);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    const [bx, by] = toPx(v.boat.x, v.boat.y);
    ctx.lineTo(bx, by);
    ctx.stroke();
  }
  // (no automatic catch records on the chart: the player marks what matters with M)
  // marks: observation points with their time (not current fish positions)
  // (labels only on the enlarged chart, or when the player named the mark)
  ctx.textAlign = 'left';
  const off = (px, py) => px < -20 || py < -20 || px > W + 20 || py > H + 20;
  for (const m of saved) {
    const [px, py] = toPx(m.x, m.y);
    if (off(px, py)) continue;
    drawMarkSymbol(ctx, m, px, py, { old: true, label: big || m.name ? markTitle(m) : '', selected: selected === `s:${m.id}` });
  }
  for (const m of v.obs.marks) {
    const [px, py] = toPx(m.x, m.y);
    if (off(px, py)) continue;
    if (m.kind === 'auto') {
      ctx.fillStyle = '#ff9f43';
      ctx.beginPath();
      ctx.arc(px, py, 3.5, 0, Math.PI * 2);
      ctx.fill();
      if (big) {
        ctx.fillStyle = 'rgba(255,230,190,0.9)';
        ctx.fillText(fmtClock(m.t), px + 5, py + 11);
      }
      continue;
    }
    drawMarkSymbol(ctx, m, px, py, { label: big || m.name ? markTitle(m, true) : '', selected: selected === `v:${m.id}` });
  }
  // peers' observations (where and when they were made)
  for (const { r, label } of reports) {
    if (!r.spot) continue;
    const [px, py] = toPx(r.spot.x, r.spot.y);
    if (px < -40 || py < -20 || px > W + 40 || py > H + 20) continue;
    drawReportMarker(ctx, r, px, py, big ? label : '', !big);
  }
  // trolling route / where the longline would be laid (planned or being run)
  if (route) drawRoute(ctx, route.points, toPx, route.live ? { color: '#7cf2d6', width: 2.5 } : { color: route.color || 'rgba(124,242,214,0.85)', dash: [6, 4] });
  if (line) drawLongline(ctx, line, toPx, lineLabel);
  // dev overlay
  if (dev) {
    ctx.strokeStyle = '#ff5cf0';
    ctx.fillStyle = '#ffb3f6';
    for (const st of STRUCTURES) {
      const [px, py] = toPx(st.x, st.y);
      ctx.beginPath();
      ctx.arc(px, py, Math.max(3, st.r * scale), 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillText(`開発表示:${STRUCTURE_LABEL[st.kind]}`, px + 5, py + 12);
    }
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = '#ff5c5c';
    ctx.fillStyle = '#ff9b9b';
    for (const s of v.world.schools) {
      const c = schoolCenter(s, v.world.time);
      const [px, py] = toPx(c.x, c.y);
      ctx.beginPath();
      ctx.arc(px, py, Math.max(3, 2 * s.sigmaH * scale), 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillText(`開発表示:${schoolTotal(s)}`, px + 6, py);
    }
    ctx.setLineDash([]);
  }
  // boat: the white hull points where the bow is; the bold yellow arrow shows where
  // the boat is actually moving over the ground (under way or drifting with tide and wind)
  const sog = Math.hypot(v.boat.vx || 0, v.boat.vy || 0);
  if (sog >= 0.04) {
    const [px, py] = toPx(v.boat.x, v.boat.y);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(Math.atan2(v.boat.vx, v.boat.vy));
    // longer when faster (a slow drift still shows clearly)
    const hl = (big ? 34 : 28) + Math.min(1, sog / 4) * (big ? 34 : 26);
    const shaft = () => {
      ctx.beginPath();
      ctx.moveTo(0, -12);
      ctx.lineTo(0, -hl + 6);
      ctx.stroke();
    };
    const head = () => {
      ctx.beginPath();
      ctx.moveTo(0, -hl - 10);
      ctx.lineTo(9, -hl + 6);
      ctx.lineTo(-9, -hl + 6);
      ctx.closePath();
    };
    // dark outline first so the arrow stands out on light shallow water too
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.lineWidth = 7.5;
    shaft();
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.lineWidth = 3;
    head();
    ctx.stroke();
    ctx.strokeStyle = '#ffd84d';
    ctx.lineWidth = 4.5;
    shaft();
    ctx.fillStyle = '#ffd84d';
    head();
    ctx.fill();
    ctx.restore();
  }
  {
    // the boat itself, bow pointed
    const [px, py] = toPx(v.boat.x, v.boat.y);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(v.boat.heading);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#0b2236';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -12);
    ctx.lineTo(6, -2);
    ctx.lineTo(5, 8);
    ctx.lineTo(-5, 8);
    ctx.lineTo(-6, -2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  // scale bar
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.textAlign = 'left';
  const bar = big ? (span && span <= 1000 ? 100 : span && span <= 2000 ? 200 : 500) : 200;
  ctx.fillRect(8, H - 12, bar * scale, 2);
  ctx.fillText(`${bar}m`, 8, H - 16);
  ctx.textAlign = 'right';
  ctx.fillText('N↑', W - 6, 14);
  if (bathy && big) drawDepthLegend(ctx, W, H);
  // boat speed, large, top left: how fast the boat moves over the ground, under way or drifting alike
  const sp = `船速 ${(sog * 1.944).toFixed(1)}kt`;
  ctx.textAlign = 'left';
  ctx.font = `bold ${big ? 20 : 16}px sans-serif`;
  const spW = ctx.measureText(sp).width;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(6, 6, spW + 14, big ? 30 : 25);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(sp, 13, big ? 28 : 24);
  const hintY = 6 + (big ? 30 : 25) + 4;
  if (hint && !big) {
    ctx.textAlign = 'left';
    // shrink the hint until it fits the chart's width (narrow phones)
    let fs = big ? 13 : 10;
    ctx.font = `${fs}px sans-serif`;
    while (fs > 8 && ctx.measureText(hint).width + 24 > W) {
      fs -= 0.5;
      ctx.font = `${fs}px sans-serif`;
    }
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    const w = ctx.measureText(hint).width + 12;
    ctx.fillRect(6, hintY, w, big ? 22 : 16);
    ctx.fillStyle = '#bff7ea';
    ctx.fillText(hint, 12, hintY + (big ? 16 : 12));
  }
}

/** Port briefing chart: whole area, candidates, peers' observations and own operation spots. */
export function drawBriefingChart(canvas, staticMap, { candidates = [], reports = [], boatModel = null, bathy = null, marks = [], selected = null }) {
  if (!canvas.getClientRects().length) return; // not on screen (display:none): its size would read as 0
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = canvas.clientWidth || canvas.width;
  const cssH = canvas.clientHeight || canvas.height;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = cssW;
  const H = cssH;
  // the whole sea, fitted and centred (it is taller than it is wide)
  const scale = Math.min(W / AREA.W, H / AREA.H);
  const ox = (W - AREA.W * scale) / 2;
  const oy = (H - AREA.H * scale) / 2;
  const toPx = (x, y) => [ox + x * scale, oy + (AREA.H - y) * scale];
  ctx.fillStyle = '#0a244e';
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(staticMap, ox, oy, AREA.W * scale, AREA.H * scale);
  if (bathy) drawDepthMap(ctx, bathy, toPx, scale, W, H, { labels: false });
  if (boatModel) drawRangeLimit(ctx, boatModel, toPx, W, true);
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  for (const l of CHART_LABELS) {
    const [px, py] = toPx(l.x, l.y);
    ctx.fillText(l.name, px, py - 12);
  }
  const [hx, hy] = toPx(PORT.dock.x, PORT.dock.y);
  ctx.fillStyle = '#ffd25e';
  ctx.fillRect(hx - 4, hy - 8, 8, 8);
  for (const { r, label } of reports) {
    if (!r.spot) continue;
    const [px, py] = toPx(r.spot.x, r.spot.y);
    drawReportMarker(ctx, r, px, py, label, true);
  }
  // the player's own marks (names only when given, to keep the chart readable)
  for (const m of marks) {
    const [px, py] = toPx(m.x, m.y);
    drawMarkSymbol(ctx, m, px, py, { old: true, label: m.name || selected === `s:${m.id}` ? markTitle(m) : '', selected: selected === `s:${m.id}` });
  }
  for (const c of candidates) {
    if (!c.spot) continue;
    const [px, py] = toPx(c.spot.x, c.spot.y);
    ctx.strokeStyle = c.feasible.ok ? '#7cf2d6' : '#f2b45a';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.arc(px, py, 22, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(6,20,33,0.85)';
    ctx.beginPath();
    ctx.arc(px - 16, py - 16, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(c.letter, px - 16, py - 12);
  }
}
