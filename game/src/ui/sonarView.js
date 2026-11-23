// The sonar picture: seen from above, bow up, the boat in the middle.
// Reads v.sonar only (built by the simulation one bearing per step).
import { SONAR_BEAMS, SONAR_BINS } from '../core/sonar.js';

const STOPS = [
  [0.0, [6, 20, 44]],
  [0.12, [20, 60, 140]],
  [0.3, [40, 150, 200]],
  [0.5, [80, 210, 110]],
  [0.7, [240, 220, 60]],
  [0.85, [245, 130, 40]],
  [1.0, [220, 40, 40]],
];
const LUT = new Uint8Array(256 * 3);
for (let i = 0; i < 256; i++) {
  const v = i / 255;
  let k = 0;
  while (k < STOPS.length - 2 && v > STOPS[k + 1][0]) k++;
  const [a, ca] = STOPS[k];
  const [b, cb] = STOPS[k + 1];
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  for (let c = 0; c < 3; c++) LUT[i * 3 + c] = Math.round(ca[c] + (cb[c] - ca[c]) * t);
}

let off = null;
let img = null;

/** marks: [{x, y}] in world coordinates (shown as small triangles). */
export function drawSonar(canvas, sonar, boat, marks = []) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = canvas.clientWidth || canvas.width;
  const H = canvas.clientHeight || canvas.height;
  if (canvas.width !== Math.round(W * dpr)) {
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }
  const N = 160; // picture resolution
  if (!off) {
    off = document.createElement('canvas');
    off.width = N;
    off.height = N;
    img = off.getContext('2d').createImageData(N, N);
  }
  const c = N / 2;
  for (let py = 0; py < N; py++) {
    for (let px = 0; px < N; px++) {
      const dx = px + 0.5 - c;
      const dy = py + 0.5 - c;
      const r = Math.hypot(dx, dy) / c;
      const p = (py * N + px) * 4;
      if (r > 1) {
        img.data[p + 3] = 0;
        continue;
      }
      let ang = Math.atan2(dx, -dy); // from the bow, clockwise
      if (ang < 0) ang += Math.PI * 2;
      const b = Math.floor((ang / (Math.PI * 2)) * SONAR_BEAMS) % SONAR_BEAMS;
      const k = Math.min(SONAR_BINS - 1, Math.floor(r * SONAR_BINS));
      const v = sonar.data[b * SONAR_BINS + k];
      img.data[p] = LUT[v * 3];
      img.data[p + 1] = LUT[v * 3 + 1];
      img.data[p + 2] = LUT[v * 3 + 2];
      img.data[p + 3] = 255;
    }
  }
  off.getContext('2d').putImageData(img, 0, 0);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const R = Math.min(W, H) / 2 - 2;
  const cx = W / 2;
  const cy = H / 2;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(off, cx - R, cy - R, 2 * R, 2 * R);
  // range rings and the bow line
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1;
  for (const f of [1 / 3, 2 / 3, 1]) {
    ctx.beginPath();
    ctx.arc(cx, cy, R * f, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx, cy - R);
  ctx.stroke();
  // the turning beam
  const sweep = (sonar.beam / SONAR_BEAMS) * Math.PI * 2;
  ctx.strokeStyle = 'rgba(160,255,200,0.8)';
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.sin(sweep) * R, cy - Math.cos(sweep) * R);
  ctx.stroke();
  // marks within range
  ctx.fillStyle = '#ffe14d';
  for (const m of marks) {
    const dxw = m.x - boat.x;
    const dyw = m.y - boat.y;
    const d = Math.hypot(dxw, dyw);
    if (d > sonar.range) continue;
    const a = Math.atan2(dxw, dyw) - boat.heading;
    const sx = cx + Math.sin(a) * (d / sonar.range) * R;
    const sy = cy - Math.cos(a) * (d / sonar.range) * R;
    ctx.beginPath();
    ctx.moveTo(sx, sy - 5);
    ctx.lineTo(sx + 4, sy + 3);
    ctx.lineTo(sx - 4, sy + 3);
    ctx.fill();
  }
  // the boat
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(cx, cy - 6);
  ctx.lineTo(cx + 4, cy + 5);
  ctx.lineTo(cx - 4, cy + 5);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`${sonar.range}m`, cx + 3, cy - R + 11);
  ctx.textAlign = 'right';
  ctx.fillText('タップで印', W - 4, H - 4);
}

/** Bearing from the bow and distance (m) of a tap on the sonar picture. */
export function sonarTap(canvas, sonar, px, py) {
  const W = canvas.clientWidth || canvas.width;
  const H = canvas.clientHeight || canvas.height;
  const R = Math.min(W, H) / 2 - 2;
  const dx = px - W / 2;
  const dy = py - H / 2;
  const r = Math.hypot(dx, dy);
  if (r > R) return null;
  return { rel: Math.atan2(dx, -dy), dist: (r / R) * sonar.range };
}
