// Renders the sounder history (newest ping at the right edge).
// Reads obs.cols only; drawing or hiding the panel never affects pings.

const STOPS = [
  [0.0, [7, 23, 53]],
  [0.08, [18, 52, 128]],
  [0.2, [40, 120, 210]],
  [0.35, [60, 190, 120]],
  [0.5, [230, 220, 60]],
  [0.7, [245, 140, 40]],
  [0.86, [220, 50, 40]],
  [1.0, [130, 30, 30]],
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

export function createSounderView(canvas) {
  let range = 40;
  let img = null;
  let off = null;
  function chooseRange(bottom) {
    const want = Math.max(20, Math.min(100, Math.ceil((bottom + 8) / 10) * 10));
    if (want > range || want < range - 10) range = want; // hysteresis
    return range;
  }
  function draw(obs, opts = {}) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = canvas.clientWidth || canvas.width;
    const cssH = canvas.clientHeight || canvas.height;
    if (canvas.width !== Math.round(cssW * dpr)) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const cols = obs.cols;
    const plotW = Math.max(60, Math.floor(cssW - 34));
    const plotH = Math.floor(cssH);
    if (!off || off.width !== plotW || off.height !== plotH) {
      off = document.createElement('canvas');
      off.width = plotW;
      off.height = plotH;
      img = off.getContext('2d').createImageData(plotW, plotH);
    }
    const last = cols[cols.length - 1];
    const r = chooseRange(last ? last.bottom : 30);
    const data = img.data;
    data.fill(0);
    // normally the newest pings at the right edge; opts.fit squeezes the whole history in (examples)
    const n = opts.fit ? cols.length : Math.min(cols.length, plotW);
    for (let c = 0; c < plotW; c++) {
      const colIdx = opts.fit ? Math.floor((c * cols.length) / plotW) : cols.length - plotW + c;
      const col = colIdx >= 0 ? cols[colIdx] : null;
      for (let yPx = 0; yPx < plotH; yPx++) {
        const k = (yPx * plotW + c) * 4;
        let val = 0;
        if (col) {
          const z = ((yPx + 0.5) / plotH) * r;
          const bi = Math.floor(z / col.binSize);
          val = bi < col.bins.length ? col.bins[bi] : 0;
        }
        data[k] = LUT[val * 3];
        data[k + 1] = LUT[val * 3 + 1];
        data[k + 2] = LUT[val * 3 + 2];
        data[k + 3] = 255;
      }
    }
    off.getContext('2d').putImageData(img, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#05122b';
    ctx.fillRect(0, 0, cssW, cssH);
    ctx.drawImage(off, 0, 0, plotW, plotH);
    // depth scale
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'left';
    for (let d = 10; d <= r; d += 10) {
      const y = (d / r) * plotH;
      ctx.fillRect(plotW, y - 0.5, 5, 1);
      ctx.fillText(`${d}`, plotW + 7, Math.min(plotH - 2, y + 3));
    }
    // tana marker (where the automatic rig is fishing)
    if (opts.lines) {
      for (const l of opts.lines) {
        if (l.phase === 'idle' || l.phase === 'prep' || l.phase === 'unhook') continue;
        const y = (l.depth / r) * plotH;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(plotW - 1, y);
        ctx.lineTo(plotW - 9, y - 5);
        ctx.lineTo(plotW - 9, y + 5);
        ctx.fill();
        if (l.tana != null) {
          const ty = (l.tana / r) * plotH;
          ctx.strokeStyle = 'rgba(255,255,255,0.45)';
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(plotW - 60, ty);
          ctx.lineTo(plotW - 10, ty);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillText('タナ', plotW - 84, ty + 3);
        }
      }
    }
    // readouts
    ctx.font = 'bold 18px sans-serif';
    ctx.fillStyle = '#fff';
    ctx.fillText(last ? `${last.bottom.toFixed(1)}m` : '--.-m', 6, 20);
    ctx.font = '10px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText(`レンジ ${r}m`, 6, 34);
    if (opts.waterTemp != null) ctx.fillText(`水温 ${opts.waterTemp.toFixed(1)}℃`, 6, 47);
    ctx.textAlign = 'right';
    ctx.fillText(`← ${Math.round(n / 2)}秒`, plotW - 4, plotH - 5);
    // ES-2: the depth of the echo layer as numbers (from what the sounder shows)
    if (opts.readout && cols.length) {
      let top = null;
      let bot = null;
      let bottom = last.bottom;
      for (const col of cols.slice(-6)) {
        for (let i = 0; i < col.bins.length; i++) {
          const z = (i + 0.5) * col.binSize;
          if (z < 2.5 || z > col.bottom - 0.4) continue;
          if (col.bins[i] >= 40) {
            top = top == null ? z : Math.min(top, z);
            bot = bot == null ? z : Math.max(bot, z);
          }
        }
        bottom = Math.min(bottom, col.bottom);
      }
      ctx.textAlign = 'left';
      ctx.font = 'bold 11px sans-serif';
      const txt = top != null ? `反応 ${top.toFixed(0)}〜${bot.toFixed(0)}m・底から${Math.max(0, bottom - bot).toFixed(0)}m` : '反応なし';
      const w = ctx.measureText(txt).width + 10;
      // top right, clear of the depth readout and of the bottom echo
      const x0 = Math.max(4, plotW - w - 4);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(x0, 4, w, 16);
      ctx.fillStyle = top != null ? '#ffe680' : 'rgba(255,255,255,0.6)';
      ctx.fillText(txt, x0 + 5, 16);
    }
  }
  return { draw };
}
