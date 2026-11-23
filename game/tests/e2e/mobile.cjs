// Phone playtest of the published single page (dist/ryoshi-game.test.html:
// host-like wrapper + strict CSP). Touch-only: taps and press-and-hold.
// Checks layout (nothing important overlaps, no sideways scroll) in portrait
// and landscape on several phone sizes, and that a voyage can be played.
//
// Usage: npm run build:page && node tests/e2e/mobile.cjs [outDir]
'use strict';
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

function loadPlaywright() {
  try {
    return require('playwright');
  } catch {
    return require('/opt/node-tools/node_modules/playwright');
  }
}
const { chromium, devices } = loadPlaywright();
const root = path.resolve(__dirname, '..', '..');
const outDir = path.resolve(process.argv[2] || path.join(root, 'tests', 'e2e', 'out', 'mobile'));
fs.mkdirSync(outDir, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const overlap = (a, b) => a && b && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;

async function layout(page) {
  return page.evaluate(() => {
    const r = (sel) => {
      const el = document.querySelector(sel);
      if (!el || el.hidden || el.offsetParent === null) return null;
      const b = el.getBoundingClientRect();
      return { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
    };
    return {
      vw: window.innerWidth,
      vh: window.innerHeight,
      scrollW: document.documentElement.scrollWidth,
      chart: r('#chartPanel'),
      sounder: r('#sounderPanel'),
      top: r('#hudTop'),
      op: r('#opPanel'),
      controls: r('#controls'),
    };
  });
}

(async () => {
  const testPage = path.join(root, 'dist', 'ryoshi-game.test.html');
  if (!fs.existsSync(testPage)) {
    console.error('dist/ryoshi-game.test.html がありません。先に npm run build:page を実行してください。');
    process.exit(1);
  }
  const port = 8600 + Math.floor(Math.random() * 300);
  const server = spawn(process.execPath, [path.join(root, 'tools', 'serve.mjs'), String(port)], { stdio: 'ignore' });
  await sleep(600);
  const url = `http://localhost:${port}/dist/ryoshi-game.test.html?dev=1&seed=77`;
  const browser = await chromium.launch();
  const phones = [
    ['iPhone 13', devices['iPhone 13']],
    ['iPhone 13 landscape', devices['iPhone 13 landscape']],
    ['iPhone SE', devices['iPhone SE']],
    ['Pixel 7', devices['Pixel 7']],
  ];
  for (const [name, dev] of phones) {
    const ctx = await browser.newContext({ ...dev });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error' || /Content Security Policy/i.test(m.text())) errors.push(m.text());
    });
    const slug = name.replace(/\s+/g, '-');
    try {
      await page.goto(url);
      await page.waitForSelector('[data-act=newGame]', { timeout: 20000 });
      await page.tap('[data-act=newGame]');
      await page.waitForSelector('#portChart');
      const lp = await layout(page);
      check(`${name}: port screen fits the width`, lp.scrollW <= lp.vw, `${lp.scrollW}/${lp.vw}`);
      await page.screenshot({ path: path.join(outDir, `${slug}-1-port.png`) });
      await page.tap('[data-act=departPlan][data-key="handline:北の瀬"]');
      await page.waitForFunction(() => window.__ryoshi.state().screen === 'sea');
      for (let i = 0; i < 3; i++) await page.tap('[data-act=throttleUp]');
      await sleep(1500);
      const h0 = (await page.evaluate(() => window.__ryoshi.state())).voyage.boat.heading;
      const btn = page.locator('[data-hold=right]');
      await btn.dispatchEvent('pointerdown', { pointerId: 7, pointerType: 'touch', isPrimary: true, bubbles: true });
      await sleep(900);
      await btn.dispatchEvent('pointerup', { pointerId: 7, pointerType: 'touch', isPrimary: true, bubbles: true });
      await sleep(300);
      const s1 = await page.evaluate(() => window.__ryoshi.state());
      check(`${name}: press-and-hold rudder turns the boat; release centres it`, Math.abs(s1.voyage.boat.heading - h0) > 0.05, `heading ${h0.toFixed(2)} → ${s1.voyage.boat.heading.toFixed(2)}`);
      const ls = await layout(page);
      const clashes = [];
      for (const [a, b] of [['chart', 'sounder'], ['chart', 'top'], ['sounder', 'top'], ['controls', 'top'], ['controls', 'chart'], ['controls', 'sounder']]) if (overlap(ls[a], ls[b])) clashes.push(`${a}/${b}`);
      check(`${name}: HUD panels and controls don't overlap; controls on screen`, !clashes.length && ls.controls && ls.controls.bottom <= ls.vh + 1 && ls.scrollW <= ls.vw, clashes.join(', ') || `controls bottom ${ls.controls && Math.round(ls.controls.bottom)}/${ls.vh}`);
      await page.screenshot({ path: path.join(outDir, `${slug}-2-sea.png`) });
      // run on out of the harbour (fishing is refused within 300 m of the dock), then stop with taps
      await page.evaluate(() => window.__ryoshi.fastForward(150));
      for (let i = 0; i < 4; i++) await page.tap('[data-act=throttleDown]');
      await page.tap('[data-act=throttleUp]');
      await page.waitForFunction(() => Math.abs(window.__ryoshi.state().voyage.boat.speed) < 0.5, null, { timeout: 30000 });
      await page.tap('#btnOp');
      await page.waitForFunction(() => window.__ryoshi.state().voyage.operating, null, { timeout: 10000 });
      await sleep(1200);
      const lo = await layout(page);
      check(`${name}: operation panel visible without covering the controls`, lo.op && !overlap(lo.op, lo.controls), JSON.stringify(lo.op));
      await page.screenshot({ path: path.join(outDir, `${slug}-3-operating.png`) });
      await page.tap('#btnPort');
      await page.evaluate(() => window.__ryoshi.fastForward(4000));
      await page.waitForSelector('[data-act=toPort]', { timeout: 20000 });
      const st = await page.evaluate(() => window.__ryoshi.state());
      check(`${name}: return, landing and save work by touch`, st.saveStatus && st.saveStatus.ok && st.day === 1);
      await page.screenshot({ path: path.join(outDir, `${slug}-4-receipt.png`) });
      // save copy on the hosted page (clipboard may be refused; the text area must appear either way)
      await page.tap('[data-act=toPort]');
      await page.waitForSelector('[data-act=openSave]');
      await page.tap('[data-act=openSave]');
      await page.tap('[data-act=copySave]');
      await sleep(300);
      const copied = await page.evaluate(() => {
        const a = document.getElementById('copyArea');
        return a && !a.hidden && a.value.startsWith('{');
      });
      check(`${name}: save can be copied as text on the hosted page`, copied);
    } catch (e) {
      check(`${name}: playtest ran`, false, e.message);
      await page.screenshot({ path: path.join(outDir, `${slug}-99-failure.png`) }).catch(() => {});
    }
    check(`${name}: no page errors / CSP violations`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }
  await browser.close();
  server.kill();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots: ${outDir}`);
  process.exit(failed.length ? 1 : 0);
})();
