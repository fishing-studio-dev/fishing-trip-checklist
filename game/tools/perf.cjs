// Usage: node tools/perf.cjs  (headless Chromium; prints fps and main-thread time at sea, small and enlarged chart)
// Measure the page's main-thread work at sea (CDP Performance metrics), small and enlarged chart, with a depth map.
const { chromium, devices } = require('playwright');
const { spawn } = require('child_process');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const server = spawn(process.execPath, [require('path').join(__dirname, 'serve.mjs'), '8104'], { stdio: 'ignore' });
  await sleep(600);
  const browser = await chromium.launch();
  for (const [name, opts] of [['desktop', { viewport: { width: 1280, height: 800 } }], ['iphone13', devices['iPhone 13']], ['i13land', devices['iPhone 13 landscape']]]) {
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage();
    await page.goto('http://localhost:8104/?dev=1&seed=77');
    await page.click('[data-act=newGame]');
    await page.click('[data-act=startDiff][data-diff=normal]');
    await page.waitForSelector('#portChart');
    await page.click('[data-act=depart]');
    await page.waitForFunction(() => window.__ryoshi.state().screen === 'sea');
    // a big own depth map (synthetic cells) so the contour drawing has work to do
    await page.evaluate(() => { const v = window.__ryoshi.app.voyage; for (let j = 150; j < 260; j++) for (let i = 80; i < 260; i++) v.bathy.cells[j * 300 + i] = Math.round((30 + 15 * Math.sin(i / 9) * Math.cos(j / 11)) * 2); v.boat.x = 1700; v.boat.y = 2000; });
    await page.evaluate(() => window.__ryoshi.fastForward(20));
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Performance.enable');
    const measure = async (label) => {
      await sleep(1500);
      const m0 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
      const f0 = await page.evaluate(() => new Promise((r) => { let n = 0; const t0 = performance.now(); const tick = () => { n++; if (performance.now() - t0 < 4000) requestAnimationFrame(tick); else r(n); }; requestAnimationFrame(tick); }));
      const m1 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
      const span = m1.Timestamp - m0.Timestamp;
      console.log(name.padEnd(9), label.padEnd(10), 'fps', (f0 / 4).toFixed(0), 'script ms/s', ((m1.ScriptDuration - m0.ScriptDuration) / span * 1000).toFixed(0), 'task ms/s', ((m1.TaskDuration - m0.TaskDuration) / span * 1000).toFixed(0));
    };
    await measure('small');
    await page.click('#chartToggle');
    await page.click('[data-act=chartZoomIn]');
    await measure('big+zoom');
    await ctx.close();
  }
  await browser.close(); server.kill();
})();
