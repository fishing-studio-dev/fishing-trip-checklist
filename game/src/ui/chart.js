// 2D chart (GPS plotter). Shows fixed geography and what the player has
// observed (track, marks, operation spots). Fish are only drawn in dev mode,
// clearly labelled, and never in normal play.
import { AREA, PORT } from '../core/data.js';
import { depthAt, isLand, CHART_LABELS, fmtClock } from '../core/sea.js';
import { schoolCenter, schoolTotal } from '../core/world.js';

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
      depths[j * w + i] = isLand(x, y) ? -1 : depthAt(x, y);
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

/**
 * Draw the chart. view: {big:boolean}. data: {voyage, dev}
 */
function viewOf(v, big, W) {
  const span = big ? AREA.W : 1300;
  return { cx: big ? AREA.W / 2 : v.boat.x, cy: big ? AREA.H / 2 : v.boat.y, scale: W / span };
}

/** World coordinates of a click on the chart canvas (CSS pixels). */
export function chartToWorld(canvas, v, big, px, py) {
  const W = canvas.clientWidth || canvas.width;
  const H = canvas.clientHeight || canvas.height;
  const { cx, cy, scale } = viewOf(v, big, W);
  return { x: (px - W / 2) / scale + cx, y: cy - (py - H / 2) / scale };
}

const SPECIES_COLOR = { aji: '#ffd84d', sawara: '#ff8a5c' };

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

/**
 * Draw the chart at sea. opts: { big, dev, reports: [{r, label}], route: {points, live}, hint }
 */
export function drawChart(canvas, staticMap, v, { big = false, dev = false, reports = [], route = null, hint = '' } = {}) {
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
  const { cx, cy, scale } = viewOf(v, big, W);
  const toPx = (x, y) => [(x - cx) * scale + W / 2, H / 2 - (y - cy) * scale];
  ctx.fillStyle = '#0a244e';
  ctx.fillRect(0, 0, W, H);
  // static map: map pixel (i,j) covers world x=i*RES, y=AREA.H-j*RES
  const [ox, oy] = toPx(0, AREA.H);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(staticMap, ox, oy, AREA.W * scale, AREA.H * scale);

  ctx.font = `${big ? 13 : 10}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  for (const l of CHART_LABELS) {
    const [px, py] = toPx(l.x, l.y);
    ctx.fillText(l.name, px, py);
  }
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
  // operation spots of this voyage
  const ops = v.logs.map((l) => ({ x: l.start.x, y: l.start.y, ex: l.end.x, ey: l.end.y, n: l.count }));
  if (v.op) ops.push({ x: v.op.start.x, y: v.op.start.y, ex: v.boat.x, ey: v.boat.y, n: v.op.landedCount, live: true });
  ctx.lineWidth = 2;
  ops.forEach((o, i) => {
    const [px, py] = toPx(o.x, o.y);
    const [ex, ey] = toPx(o.ex, o.ey);
    ctx.strokeStyle = o.live ? '#3fc1b0' : 'rgba(63,193,176,0.6)';
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.fillStyle = '#3fc1b0';
    ctx.beginPath();
    ctx.arc(px, py, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#d9fff9';
    ctx.textAlign = 'left';
    ctx.fillText(`#${i + 1} ${o.n}尾`, px + 6, py - 5);
  });
  // marks: observation points with their time (not current fish positions)
  ctx.textAlign = 'left';
  for (const m of v.obs.marks) {
    const [px, py] = toPx(m.x, m.y);
    if (px < -20 || py < -20 || px > W + 20 || py > H + 20) continue;
    ctx.fillStyle = m.kind === 'auto' ? '#ff9f43' : '#ffe14d';
    ctx.beginPath();
    if (m.kind === 'auto') ctx.arc(px, py, 3.5, 0, Math.PI * 2);
    else {
      ctx.moveTo(px, py - 6);
      ctx.lineTo(px + 5, py + 3);
      ctx.lineTo(px - 5, py + 3);
    }
    ctx.fill();
    ctx.fillStyle = 'rgba(255,230,190,0.95)';
    ctx.fillText(fmtClock(m.t), px + 5, py + 11);
  }
  // peers' observations (where and when they were made)
  for (const { r, label } of reports) {
    if (!r.spot) continue;
    const [px, py] = toPx(r.spot.x, r.spot.y);
    if (px < -40 || py < -20 || px > W + 40 || py > H + 20) continue;
    drawReportMarker(ctx, r, px, py, big ? label : '', !big);
  }
  // trolling route (planned or being run)
  if (route) drawRoute(ctx, route.points, toPx, route.live ? { color: '#7cf2d6', width: 2.5 } : { color: 'rgba(124,242,214,0.85)', dash: [6, 4] });
  // dev overlay
  if (dev) {
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
  // boat
  {
    const [px, py] = toPx(v.boat.x, v.boat.y);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(v.boat.heading);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(5, 6);
    ctx.lineTo(-5, 6);
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
  if (hint) {
    ctx.textAlign = 'left';
    ctx.font = `${big ? 13 : 10}px sans-serif`;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    const w = ctx.measureText(hint).width + 12;
    ctx.fillRect(6, 6, w, big ? 22 : 16);
    ctx.fillStyle = '#bff7ea';
    ctx.fillText(hint, 12, big ? 22 : 18);
  }
}

/** Port briefing chart: whole area, candidates, peers' observations and own operation spots. */
export function drawBriefingChart(canvas, staticMap, { candidates = [], reports = [], logs = [] }) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = canvas.clientWidth || canvas.width;
  const cssH = canvas.clientHeight || canvas.height;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = cssW;
  const H = cssH;
  const scale = W / AREA.W;
  const toPx = (x, y) => [x * scale, H - y * scale];
  ctx.drawImage(staticMap, 0, 0, W, H);
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
  // own operation spots
  ctx.fillStyle = 'rgba(160,240,255,0.8)';
  for (const l of logs.slice(-40)) {
    const [px, py] = toPx(l.start.x, l.start.y);
    ctx.fillRect(px - 2.5, py - 2.5, 5, 5);
  }
  for (const { r, label } of reports) {
    if (!r.spot) continue;
    const [px, py] = toPx(r.spot.x, r.spot.y);
    drawReportMarker(ctx, r, px, py, label, true);
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
