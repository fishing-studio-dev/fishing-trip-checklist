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

// ---- the own depth map (デプスマッピング): fine 2 m contours where the player measured
const MAP_NX = Math.ceil(AREA.W / 10);
const MAP_NY = Math.ceil(AREA.H / 10);
let bathyLayer = null;
let bathyKey = '';

/** Build (when changed) a 10 m-per-pixel layer from measured cells (profile + this voyage). */
export function bathyCanvas(baseCells, voyCells) {
  const nV = voyCells ? Object.keys(voyCells).length : 0;
  const nB = baseCells ? Object.keys(baseCells).length : 0;
  const key = `${nB}:${nV}`;
  if (bathyLayer && key === bathyKey) return bathyLayer;
  if (!nB && !nV) return null;
  bathyKey = key;
  if (!bathyLayer) {
    bathyLayer = document.createElement('canvas');
    bathyLayer.width = MAP_NX;
    bathyLayer.height = MAP_NY;
  }
  const ctx = bathyLayer.getContext('2d');
  const img = ctx.createImageData(MAP_NX, MAP_NY);
  const get = (idx) => (voyCells && voyCells[idx]) || (baseCells && baseCells[idx]) || 0;
  const all = new Set([...Object.keys(baseCells || {}), ...Object.keys(voyCells || {})]);
  for (const k of all) {
    const idx = Number(k);
    const b = get(idx);
    if (!b) continue;
    const d = b / 2;
    const i = idx % MAP_NX;
    const j = Math.floor(idx / MAP_NX);
    let col = depthColor(d);
    // hill shade from the north-west: a raised spot is lit on its NW side
    const nw = get(idx - 1 + MAP_NX) || b;
    const shade = Math.max(-0.35, Math.min(0.35, (nw - b) / 2 * 0.12));
    col = col.map((c) => Math.max(0, Math.min(255, c + 255 * shade)));
    // 2 m contours
    const band = Math.floor(d / 2);
    for (const n of [get(idx + 1), get(idx + MAP_NX)]) {
      if (n && Math.floor(n / 2 / 2) !== band) col = col.map((c) => Math.min(255, c + 70));
    }
    const p = ((MAP_NY - 1 - j) * MAP_NX + i) * 4;
    img.data[p] = col[0];
    img.data[p + 1] = col[1];
    img.data[p + 2] = col[2];
    img.data[p + 3] = 235;
  }
  ctx.putImageData(img, 0, 0);
  return bathyLayer;
}

/**
 * Draw the chart. view: {big:boolean}. data: {voyage, dev}
 */
function viewOf(v, big, W, H = W) {
  // enlarged: the whole sea fitted into the canvas; small: 1.3 km around the boat
  if (big) return { cx: AREA.W / 2, cy: AREA.H / 2, scale: Math.min(W / AREA.W, H / AREA.H) };
  return { cx: v.boat.x, cy: v.boat.y, scale: W / 1300 };
}

/** World coordinates of a click on the chart canvas (CSS pixels). */
export function chartToWorld(canvas, v, big, px, py) {
  const W = canvas.clientWidth || canvas.width;
  const H = canvas.clientHeight || canvas.height;
  const { cx, cy, scale } = viewOf(v, big, W, H);
  return { x: (px - W / 2) / scale + cx, y: cy - (py - H / 2) / scale };
}

/** Canvas position (CSS pixels) of a world point (the inverse of chartToWorld). */
export function worldToChart(canvas, v, big, x, y) {
  const W = canvas.clientWidth || canvas.width;
  const H = canvas.clientHeight || canvas.height;
  const { cx, cy, scale } = viewOf(v, big, W, H);
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
export function drawChart(canvas, staticMap, v, { big = false, dev = false, reports = [], route = null, hint = '', line = null, lineLabel = '', bathy = null, saved = [], selected = null } = {}) {
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
  const { cx, cy, scale } = viewOf(v, big, W, H);
  const toPx = (x, y) => [(x - cx) * scale + W / 2, H / 2 - (y - cy) * scale];
  ctx.fillStyle = '#0a244e';
  ctx.fillRect(0, 0, W, H);
  // static map: map pixel (i,j) covers world x=i*RES, y=AREA.H-j*RES
  const [ox, oy] = toPx(0, AREA.H);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(staticMap, ox, oy, AREA.W * scale, AREA.H * scale);
  if (bathy) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bathy, ox, oy, AREA.W * scale, AREA.H * scale);
    ctx.imageSmoothingEnabled = true;
  }

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
  // boat: a bold yellow arrow from the bow shows where it is heading
  {
    const [px, py] = toPx(v.boat.x, v.boat.y);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(v.boat.heading);
    const hl = big ? 64 : 52;
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
    // the boat itself, bow pointed
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
  const bar = big ? 500 : 200;
  ctx.fillRect(8, H - 12, bar * scale, 2);
  ctx.fillText(`${bar}m`, 8, H - 16);
  ctx.textAlign = 'right';
  ctx.fillText('N↑', W - 6, 14);
  // boat speed, large, top left
  const kt = Math.abs(v.boat.speed) * 1.944;
  const drift = Math.hypot(v.boat.vx || 0, v.boat.vy || 0) * 1.944;
  const sp = `船速 ${kt.toFixed(1)}kt`;
  ctx.textAlign = 'left';
  ctx.font = `bold ${big ? 20 : 16}px sans-serif`;
  const spW = ctx.measureText(sp).width;
  const sub = kt < 0.3 && drift >= 0.2 ? `流され ${drift.toFixed(1)}kt` : '';
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(6, 6, spW + 14, big ? 30 : 25);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(sp, 13, big ? 28 : 24);
  let hintY = 6 + (big ? 30 : 25) + 4;
  if (sub) {
    ctx.font = `${big ? 12 : 10}px sans-serif`;
    const w2 = ctx.measureText(sub).width;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(6, hintY, w2 + 12, big ? 18 : 15);
    ctx.fillStyle = '#ffd9b0';
    ctx.fillText(sub, 12, hintY + (big ? 13 : 11));
    hintY += (big ? 18 : 15) + 4;
  }
  if (hint) {
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
  if (bathy) ctx.drawImage(bathy, ox, oy, AREA.W * scale, AREA.H * scale);
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
