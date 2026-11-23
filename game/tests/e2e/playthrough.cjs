// End-to-end playthrough in headless Chromium (A01, A06, A12 in the real UI).
// Steering, stopping, starting/stopping the operation, re-drifting, returning,
// landing, buying and departing are all done with the game's own keys/buttons.
// Dev mode (?dev=1) is used only to READ positions for the scripted skipper
// and to fast-forward the same fixed-step simulation instead of waiting.
//
// Usage: node tests/e2e/playthrough.cjs [outDir]
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
const { chromium } = loadPlaywright();
const root = path.resolve(__dirname, '..', '..');
const outDir = path.resolve(process.argv[2] || path.join(root, 'tests', 'e2e', 'out'));
fs.mkdirSync(outDir, { recursive: true });

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const port = 8100 + Math.floor(Math.random() * 500);
  const server = spawn(process.execPath, [path.join(root, 'tools', 'serve.mjs'), String(port)], { stdio: 'ignore' });
  await sleep(600);
  const base = `http://localhost:${port}/?dev=1&seed=2026`;
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  const shot = (name) => page.screenshot({ path: path.join(outDir, `${name}.png`) });
  const st = () => page.evaluate(() => window.__ryoshi.state());
  const ff = (s) => page.evaluate((x) => window.__ryoshi.fastForward(x), s);
  const press = (k) => page.keyboard.press(k);
  async function waitFor(fn, label, timeoutMs = 60000) {
    const t0 = Date.now();
    for (;;) {
      const s = await st();
      if (fn(s)) return s;
      if (Date.now() - t0 > timeoutMs) throw new Error(`timeout: ${label}`);
      await sleep(100);
    }
  }

  /** Steer with A/D, set speed with W/S, stop at the target (keyboard only). */
  async function driveTo(target, label) {
    await press('2'); // time ×2 for the drive
    let s = await st();
    for (let i = 0; i < 6000; i++) {
      s = await st();
      const b = s.voyage.boat;
      const dx = target.x - b.x;
      const dy = target.y - b.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 22) break;
      let err = Math.atan2(dx, dy) - b.heading;
      while (err > Math.PI) err -= 2 * Math.PI;
      while (err < -Math.PI) err += 2 * Math.PI;
      const want = dist > 220 ? 4 : dist > 90 ? 3 : 2;
      if (b.throttle < want) await press('w');
      else if (b.throttle > want) await press('s');
      const key = err > 0.06 ? 'd' : err < -0.06 ? 'a' : null;
      if (key) {
        await page.keyboard.down(key);
        await sleep(Math.min(120, 20 + Math.abs(err) * 120));
        await page.keyboard.up(key);
      } else await sleep(40);
    }
    // stop the boat
    for (let i = 0; i < 6; i++) {
      s = await st();
      if (s.voyage.boat.throttle > 1) await press('s');
      if (s.voyage.boat.throttle < 1) await press('w');
    }
    s = await waitFor((x) => Math.abs(x.voyage.boat.speed) < 0.5, `${label}: boat stopped`);
    return s;
  }

  try {
    // ---------------------------------------------------------------- start
    await page.goto(base);
    await page.waitForSelector('[data-act=newGame]');
    await shot('01-title');
    await page.click('[data-act=newGame]');
    await page.waitForSelector('[data-act=depart]');
    let s = await st();
    check('new game saved to storage', s.saveStatus && s.saveStatus.ok, JSON.stringify(s.saveStatus));
    await shot('02-port');

    // ---------------------------------------------------------------- voyage 1
    await page.click('[data-act=depart]');
    await waitFor((x) => x.screen === 'sea', 'at sea');
    await sleep(800);
    s = await st();
    check('departure marker saved (voyage V1)', s.day === 1 && s.saveStatus.ok);
    // search: drive toward the biggest school (positions read via dev overlay)
    const schools = await page.evaluate(() => window.__ryoshi.schoolCenters());
    const best = schools.sort((a, b) => b.total - a.total)[0];
    const cur = await page.evaluate(() => window.__ryoshi.current());
    const sp = Math.hypot(cur.x, cur.y) || 1;
    const target = { x: best.x - (cur.x / sp) * 60, y: best.y - (cur.y / sp) * 60 };
    await shot('03-departing');
    s = await driveTo(target, 'voyage1');
    const pingsBefore = s.voyage.pings;
    check('sounder pings while driving', pingsBefore > 50, `pings=${pingsBefore}`);
    await shot('04-on-the-spot');
    await press('Space');
    s = await waitFor((x) => x.voyage.operating, 'operation started');
    check('operation started with Space after stopping', s.voyage.operating);
    await press('3'); // ×4
    await sleep(6000);
    await shot('05-operating-helm');
    await press('v');
    await sleep(700);
    await shot('06-operating-deck-view');
    await press('v');

    // A06 in the real UI: while paused, toggling views/panels changes nothing
    await press('p');
    await sleep(300);
    const before = JSON.stringify((await st()).voyage);
    for (const k of ['f', 'f', 'v', 'v', 'c', 'c', 'f', 'v']) {
      await press(k);
      await sleep(60);
    }
    await sleep(400);
    const after = JSON.stringify((await st()).voyage);
    check('A06: view/sounder/chart toggles do not change the sea, boat or catch', before === after);
    await press('p');

    await ff(420);
    await sleep(300);
    s = await st();
    const firstPass = s.voyage.hold.count;
    check('caught fish on the first drift', firstPass > 0, `hold=${firstPass} fish`);
    await press('r'); // 流し直し
    await waitFor((x) => x.voyage.autopilot === 'redrift' || (x.voyage.operating && x.voyage.opState === 'stopping'), 'redrift accepted');
    await ff(400);
    s = await waitFor((x) => x.voyage.operating, 're-drift restarted operation', 30000);
    check('re-drift: retrieved, ran back and restarted automatically', s.voyage.logs >= 1 && s.voyage.operating);
    await ff(480);
    await press('h'); // return (retrieves first)
    await ff(60);
    s = await st();
    check('return command retrieved the rig first', !s.voyage.operating);
    s = await st();
    const fundsBefore = s.funds;
    const xpBefore = s.xp;
    const catch1 = s.voyage.hold.count;
    await ff(1800);
    await page.waitForSelector('[data-act=toPort]', { timeout: 30000 });
    s = await st();
    check('docking landed, sold and paid once; XP gained', s.funds > fundsBefore && s.xp > xpBefore, `funds ${fundsBefore}→${s.funds}, xp ${xpBefore}→${s.xp}, fish ${catch1}`);
    check('saved after landing', s.saveStatus.ok && s.saveStatus.reason === '水揚げ・精算', JSON.stringify(s.saveStatus));
    await shot('08-receipt');
    const snap = { funds: s.funds, xp: s.xp, day: s.day, reel: s.reel };

    // ---------------------------------------------------------------- reload -> restore
    await page.reload();
    await page.waitForSelector('[data-act=depart]');
    s = await st();
    check('A12: reload restores funds/XP/day/equipment', s.funds === snap.funds && s.xp === snap.xp && s.day === snap.day && s.reel === snap.reel, JSON.stringify({ snap, now: { funds: s.funds, xp: s.xp, day: s.day, reel: s.reel } }));
    await page.click('[data-act=log]');
    await page.waitForSelector('table.data');
    const logRows = await page.$$eval('table.data tr', (r) => r.length - 1);
    check('logbook restored after reload', logRows >= 2, `${logRows} operations`);
    await shot('09-logbook');
    await page.click('[data-act=toPort]');

    // ---------------------------------------------------------------- more voyages until the upgrade
    let voyages = 1;
    while ((await st()).funds < 15000 && voyages < 8) {
      voyages++;
      await page.click('[data-act=depart]');
      await waitFor((x) => x.screen === 'sea', 'at sea');
      const sc = (await page.evaluate(() => window.__ryoshi.schoolCenters())).sort((a, b) => b.total - a.total)[0];
      const c2 = await page.evaluate(() => window.__ryoshi.current());
      const sp2 = Math.hypot(c2.x, c2.y) || 1;
      await driveTo({ x: sc.x - (c2.x / sp2) * 60, y: sc.y - (c2.y / sp2) * 60 }, `voyage${voyages}`);
      await press('Space');
      await waitFor((x) => x.voyage.operating, 'operating');
      for (let pass = 0; pass < 3; pass++) {
        await ff(480);
        if (pass < 2) {
          await press('r');
          await ff(400);
          await waitFor((x) => x.voyage.operating, 'redrift', 30000);
        }
      }
      await press('h');
      await ff(2400);
      await page.waitForSelector('[data-act=toPort]', { timeout: 30000 });
      await page.click('[data-act=toPort]');
      await page.waitForSelector('[data-act=depart]');
    }
    s = await st();
    check('earned enough for the electric reel by playing', s.funds >= 15000, `funds=${s.funds} after ${voyages} voyages, Lv${s.level}`);

    // ---------------------------------------------------------------- upgrade
    await page.click('[data-act=equip]');
    await page.waitForSelector('[data-act=buy]');
    await shot('10-equipment');
    const fundsPre = (await st()).funds;
    await page.click('[data-act=buy]');
    await page.waitForSelector('[data-act=buyConfirm]');
    await shot('11-purchase-confirm');
    await page.click('[data-act=buyConfirm]');
    await sleep(300);
    s = await st();
    check('purchase: reel installed, price paid once, saved', s.reel === 'reel_electric' && s.funds === fundsPre - 15000 && s.saveStatus.ok, `funds ${fundsPre}→${s.funds}`);
    await page.click('[data-act=toPort]');
    await page.reload();
    await page.waitForSelector('[data-act=depart]');
    s = await st();
    check('upgrade survives reload', s.reel === 'reel_electric');
    await shot('12-port-after-upgrade');

    // ---------------------------------------------------------------- re-depart with the upgrade
    await page.click('[data-act=depart]');
    await waitFor((x) => x.screen === 'sea', 'at sea');
    const sc = (await page.evaluate(() => window.__ryoshi.schoolCenters())).sort((a, b) => b.total - a.total)[0];
    await driveTo({ x: sc.x, y: sc.y }, 'upgraded');
    await press('Space');
    await waitFor((x) => x.voyage.operating, 'operating');
    const retrieve = await page.evaluate(() => window.__ryoshi.app.voyage.op.retrieveSpeed);
    check('next operation uses the electric reel', retrieve === 2.6, `retrieve=${retrieve} m/s`);
    await press('v');
    await ff(200);
    await sleep(900);
    await shot('13-upgraded-deck-view');
    await press('v');
    await sleep(500);
    await shot('14-upgraded-operating');

    // ---------------------------------------------------------------- close the page at sea
    const preDay = (await st()).day;
    const preFunds = (await st()).funds;
    await ff(300);
    await page.reload();
    await page.waitForSelector('[data-act=depart]');
    s = await st();
    const notice = await page.textContent('#screen');
    check('closing at sea: voyage marked interrupted, no reward, day consumed', s.day === preDay && s.funds === preFunds && /中断/.test(notice), `day=${s.day} funds=${s.funds}`);
    await shot('15-port-after-interrupted');
  } catch (e) {
    check('playthrough ran to the end', false, e.message);
    await shot('99-failure').catch(() => {});
  }
  check('no page errors or console errors', errors.length === 0, errors.slice(0, 5).join(' | '));
  await browser.close();
  server.kill();
  const failed = results.filter((r) => !r.ok);
  fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots: ${outDir}`);
  process.exit(failed.length ? 1 : 0);
})();
