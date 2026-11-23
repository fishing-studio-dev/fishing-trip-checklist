// The side-view strip of a mapping sounder: port on the left, starboard on
// the right, newest line at the top (a waterfall). Reads obs.side only.
const LUT = new Uint8Array(256 * 3);
for (let i = 0; i < 256; i++) {
  const v = i / 255;
  // dark sea → amber seabed → white hard returns
  LUT[i * 3] = Math.round(Math.min(255, 20 + v * 300));
  LUT[i * 3 + 1] = Math.round(Math.min(255, 14 + v * 220));
  LUT[i * 3 + 2] = Math.round(Math.min(255, 10 + v * 120));
}

export function drawSideView(canvas, side, range = 60) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = canvas.clientWidth || canvas.width;
  const H = canvas.clientHeight || canvas.height;
  if (canvas.width !== Math.round(W * dpr)) {
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const rows = side || [];
  const n = rows.length ? rows[0].vals.length : 1;
  const off = document.createElement('canvas');
  off.width = n;
  off.height = Math.max(1, rows.length);
  const octx = off.getContext('2d');
  if (rows.length) {
    const img = octx.createImageData(n, rows.length);
    for (let r = 0; r < rows.length; r++) {
      const row = rows[rows.length - 1 - r]; // newest at the top
      for (let k = 0; k < n; k++) {
        const v = row.vals[k];
        const p = (r * n + k) * 4;
        img.data[p] = LUT[v * 3];
        img.data[p + 1] = LUT[v * 3 + 1];
        img.data[p + 2] = LUT[v * 3 + 2];
        img.data[p + 3] = 255;
      }
    }
    octx.putImageData(img, 0, 0);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#0b0a08';
  ctx.fillRect(0, 0, W, H);
  ctx.imageSmoothingEnabled = true;
  // keep the time scale fixed: one line per pixel row at most
  const h = Math.min(H, rows.length * (H / 240));
  if (rows.length) ctx.drawImage(off, 0, 0, W, h);
  // the boat's track (centre) and the distance marks
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.moveTo(W / 2, 0);
  ctx.lineTo(W / 2, H);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`左舷 ${range}m`, 4, H - 5);
  ctx.textAlign = 'right';
  ctx.fillText(`右舷 ${range}m`, W - 4, H - 5);
  ctx.textAlign = 'center';
  ctx.fillText('船', W / 2, 11);
  ctx.textAlign = 'left';
  ctx.fillText('↓ 過去', 4, 12);
}
