// End-to-end playthrough in headless Chromium (M0 + M1).
// Steering, stopping, choosing a plan, switching method, setting a trolling
// route on the chart, starting/stopping operations, returning, buying and
// departing are all done with the game's own keys/buttons/clicks.
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
  const base = `http://localhost:${port}/?dev=1&seed=77`;
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await context.newPage();
  const errors = [];
  const watch = (pg) => {
    pg.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    pg.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
    });
  };
  watch(page);
  const shot = (name, pg = page) => pg.screenshot({ path: path.join(outDir, `${name}.png`) });
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
  const schools = async (species) => (await page.evaluate(() => window.__ryoshi.schoolCenters())).filter((s) => !species || s.id.includes('sawara') === (species === 'sawara'));

  /** Steer with A/D, set speed with W/S, stop at the target (keyboard only). */
  async function driveTo(target, label, { stop = true } = {}) {
    await press('2');
    let s;
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
    if (!stop) return s;
    for (let i = 0; i < 6; i++) {
      s = await st();
      if (s.voyage.boat.throttle > 1) await press('s');
      if (s.voyage.boat.throttle < 1) await press('w');
    }
    return waitFor((x) => Math.abs(x.voyage.boat.speed) < 0.5, `${label}: boat stopped`);
  }

  /** Handline day: go up-current of the aji school nearest `near`, drift 3 passes, return. */
  async function handlineDay(near, label) {
    const sc = (await schools('aji')).sort((a, b) => Math.hypot(a.x - near.x, a.y - near.y) - Math.hypot(b.x - near.x, b.y - near.y))[0];
    const c = await page.evaluate(() => window.__ryoshi.current());
    const sp = Math.hypot(c.x, c.y) || 1;
    await driveTo({ x: sc.x - (c.x / sp) * 60, y: sc.y - (c.y / sp) * 60 }, label);
    await press('Space');
    await waitFor((x) => x.voyage.operating, `${label}: operating`);
    for (let pass = 0; pass < 3; pass++) {
      await ff(480);
      if (pass < 2) {
        await press('r');
        await ff(400);
        await waitFor((x) => x.voyage.operating, `${label}: redrift`, 30000);
      }
    }
  }

  async function returnAndLand(label) {
    await press('h');
    await ff(60);
    await ff(2400);
    await page.waitForSelector('[data-act=toPort]', { timeout: 30000 });
    await sleep(200);
    return st();
  }

  /** Click a world point on the enlarged chart (the player's route input). */
  async function clickChart(x, y) {
    const box = await page.evaluate(() => {
      const r = document.getElementById('chart').getBoundingClientRect();
      return { left: r.left, top: r.top, w: r.width, h: r.height };
    });
    const scale = box.w / 3000;
    await page.mouse.click(box.left + (x - 1500) * scale + box.w / 2, box.top + box.h / 2 - (y - 1500) * scale);
    await sleep(150);
  }

  try {
    // ---------------------------------------------------------------- start (day 1 briefing)
    await page.goto(base);
    await page.waitForSelector('[data-act=newGame]');
    await shot('01-title');
    await page.click('[data-act=newGame]');
    await page.waitForSelector('#portChart');
    let s = await st();
    check('new game saved; morning talk heard and saved', s.saveStatus.ok && s.reports >= 3, `${s.reports} reports, ${JSON.stringify(s.saveStatus.reason)}`);
    const a1 = s.candidates.find((c) => c.key === 'handline:北の瀬');
    check('M1 scenario 1: 北の瀬 is a candidate from a peer\'s report, shown as untried (not unsuitable)', a1 && a1.labels.includes('昨日の情報あり') && a1.labels.includes('未経験'), JSON.stringify(s.candidates));
    const portText = await page.textContent('#screen');
    check('peers\' talk shows observation time and the time it was heard', /昨日\d\d:\d\dの水揚げ/.test(portText) && /今朝04:30に港で聞いた/.test(portText));
    await shot('02-port-briefing');

    // ---------------------------------------------------------------- day 1: plan A, handline at 北の瀬
    await page.click('[data-act=departPlan][data-key="handline:北の瀬"]');
    await waitFor((x) => x.screen === 'sea', 'at sea');
    s = await st();
    check('departed with a plan (target and basis carried to sea)', s.voyage.plan && /北の瀬/.test(s.voyage.plan.label) && /源さん/.test(s.voyage.plan.basis), JSON.stringify(s.voyage.plan));
    await handlineDay({ x: 2190, y: 2270 }, 'day1');
    await shot('03-day1-handline');
    s = await st();
    const day1Fish = s.voyage.hold.count;
    check('caught アジ at the place the peer reported', day1Fish > 0, `${day1Fish} fish`);
    // A06 in the real UI: while paused, toggling views/panels changes nothing
    await press('p');
    await sleep(300);
    const before = JSON.stringify((await st()).voyage);
    for (const k of ['f', 'f', 'v', 'v', 'c', 'c', 'f', 'f', 'v', 'v']) {
      await press(k);
      await sleep(60);
    }
    await sleep(300);
    check('A06: view/sounder/chart toggles do not change the sea, boat or catch', before === JSON.stringify((await st()).voyage));
    await press('p');
    s = await returnAndLand('day1');
    const receiptText = await page.textContent('#screen');
    check('landing settled and saved; receipt shows the plan vs result', s.saveStatus.ok && /今日の狙いと結果/.test(receiptText) && /北の瀬/.test(receiptText), `funds ${s.funds}`);
    await shot('04-day1-receipt');
    await page.click('[data-act=toPort]');
    await page.waitForSelector('#portChart');

    // ---------------------------------------------------------------- day 2: own record recognised
    s = await st();
    const k2 = s.candidates.find((c) => c.key === 'handline:北の瀬');
    check('M1 scenario 2: next morning the past success under similar conditions is shown', k2 && k2.labels.includes('自分の実績あり') && k2.labels.includes('似た条件の記録あり'), JSON.stringify(k2));
    await shot('05-day2-briefing');
    await page.click('[data-act=departPlan][data-key="handline:北の瀬"]');
    await waitFor((x) => x.screen === 'sea', 'at sea');
    await handlineDay({ x: 2190, y: 2270 }, 'day2');
    s = await returnAndLand('day2');
    await page.click('[data-act=toPort]');
    await page.waitForSelector('#portChart');
    s = await st();
    check('earned enough for the trolling gear by playing', s.funds >= 9000, `funds ${s.funds}, Lv${s.level}`);

    // ---------------------------------------------------------------- day 3 morning: trolling candidate needs gear
    const t3 = s.candidates.find((c) => c.key.startsWith('troll:'));
    check('day 3: a trolling candidate appears from fresh signs, marked as needing gear', t3 && t3.labels.includes('装備が必要') && !t3.feasible, JSON.stringify(s.candidates));
    await shot('06-day3-briefing');
    await page.click('[data-act=equip]');
    await page.waitForSelector('[data-act=buy][data-item=troll_tr1]');
    const fundsPre = (await st()).funds;
    await page.click('[data-act=buy][data-item=troll_tr1]');
    await page.waitForSelector('[data-act=buyConfirm]');
    await shot('07-buy-troll-gear');
    await page.click('[data-act=buyConfirm]');
    await sleep(300);
    s = await st();
    check('bought trolling gear: installed on the stern slot, paid once, saved', s.troll === 'troll_tr1' && s.funds === fundsPre - 9000 && s.saveStatus.ok);
    await page.click('[data-act=toPort]');
    await page.waitForSelector('#portChart');
    s = await st();
    const t3b = s.candidates.find((c) => c.key.startsWith('troll:'));
    check('with the gear the trolling candidate becomes feasible', t3b && t3b.feasible, JSON.stringify(t3b));

    // ---------------------------------------------------------------- day 3: trolling
    await page.click(`[data-act=departPlan][data-key="${t3b.key}"]`);
    await waitFor((x) => x.screen === 'sea', 'at sea');
    s = await st();
    check('plan sets the method to 曳縄 (gear on board)', s.voyage.method === 'troll');
    const sw = (await schools('sawara')).sort((a, b) => b.total - a.total)[0];
    // run toward the school, then lay a route straight through it on the chart
    const startS = await st();
    const dirx = sw.x - startS.voyage.boat.x;
    const diry = sw.y - startS.voyage.boat.y;
    const dl = Math.hypot(dirx, diry);
    await driveTo({ x: sw.x - (dirx / dl) * 450, y: sw.y - (diry / dl) * 450 }, 'troll approach', { stop: false });
    await press('c');
    await sleep(200);
    await clickChart(sw.x + (dirx / dl) * 450, sw.y + (diry / dl) * 450);
    s = await st();
    check('chart click adds a trolling waypoint', s.voyage.route.length === 1, JSON.stringify(s.voyage.route));
    await shot('08-troll-route-planned');
    await press('c');
    await press('Space');
    s = await waitFor((x) => x.voyage.trolling, 'trolling started');
    check('Space starts trolling while under way', s.voyage.trolling);
    // helm keys are not needed (and are refused) while trolling
    await page.keyboard.down('d');
    await sleep(200);
    await page.keyboard.up('d');
    await press('3');
    await sleep(3000);
    await shot('09-trolling-helm');
    await press('v');
    await sleep(1500);
    await shot('10-trolling-deck');
    await press('v');
    await ff(1500);
    s = await st();
    const trollFish = s.voyage.hold.counts.sawara.s + s.voyage.hold.counts.sawara.m + s.voyage.hold.counts.sawara.l;
    check('trolling the route through the school lands サワラ', trollFish > 0, `${trollFish} sawara`);
    // change the route without stopping
    await press('c');
    await sleep(200);
    const sw2 = (await schools('sawara')).sort((a, b) => b.total - a.total)[0];
    await clickChart(sw2.x, sw2.y + 300);
    await press('c');
    s = await st();
    check('route changed while trolling (still trolling)', s.voyage.trolling && s.voyage.route.length >= 2);
    for (let i = 0; i < 40 && (await st()).voyage.heard < 1; i++) await ff(300);
    s = await st();
    const msgs = await page.textContent('#msgs');
    check('radio calls from peers were heard at sea (with the time of the observation)', s.voyage.heard >= 1 && /無線（.+・\d\d:\d\dの話）/.test(msgs), `${s.voyage.heard} radio reports at ${Math.floor(s.voyage.time / 3600)}h`);
    s = await returnAndLand('day3');
    check('trolling XP gained at landing', s.trollXp > 0, `troll xp ${s.trollXp}`);
    await shot('11-day3-receipt');
    const snap = { funds: s.funds, xp: s.xp, trollXp: s.trollXp, troll: s.troll, reports: s.reports, day: s.day };

    // ---------------------------------------------------------------- reload -> restore
    await page.reload();
    await page.waitForSelector('#portChart');
    s = await st();
    check('A12: reload restores funds, both method levels, gear and knowledge', s.funds === snap.funds && s.xp === snap.xp && s.trollXp === snap.trollXp && s.troll === snap.troll && s.reports >= snap.reports && s.day === snap.day, JSON.stringify({ snap, now: s }));
    await page.click('[data-act=log]');
    await page.waitForSelector('table.data');
    await page.selectOption('select[data-filter=method]', 'handline');
    await page.waitForSelector('select[data-filter=area]');
    await page.selectOption('select[data-filter=area]', '北の瀬');
    await sleep(200);
    const logText = await page.textContent('#screen');
    check('logbook: filter + comparison with today\'s conditions + plan column + heard reports', /北の瀬・一本釣りの記録（今日の予報/.test(logText) && /(似た条件|同じ潮・風)/.test(logText) && /狙い/.test(logText) && /聞いた話の記録/.test(logText) && /無線で聞いた/.test(logText), '');
    await shot('12-logbook');
    await page.click('[data-act=toPort]');

    // ---------------------------------------------------------------- closing at sea
    const preDay = (await st()).day;
    const preFunds = (await st()).funds;
    await page.click('[data-act=depart]');
    await waitFor((x) => x.screen === 'sea', 'at sea');
    await ff(1200);
    await page.reload();
    await page.waitForSelector('#portChart');
    s = await st();
    check('closing at sea: voyage interrupted, no reward, day consumed', s.day === preDay + 1 && s.funds === preFunds && /中断/.test(await page.textContent('#screen')));
  } catch (e) {
    check('playthrough ran to the end', false, e.message);
    await shot('99-failure').catch(() => {});
  }

  // ---------------------------------------------------------------- an M0 save opens in M1
  try {
    const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const pg = await ctx2.newPage();
    watch(pg);
    await pg.goto(`http://localhost:${port}/?dev=1`);
    await pg.waitForSelector('[data-act=newGame]');
    const m0 = fs.readFileSync(path.join(__dirname, 'fixtures', 'm0-save.json'), 'utf8');
    await pg.evaluate((raw) => localStorage.setItem('ryoshi-game:save:main', raw), m0);
    await pg.reload();
    await pg.waitForSelector('#portChart');
    const r = await pg.evaluate(() => ({ s: window.__ryoshi.state(), pre: localStorage.getItem('ryoshi-game:save:pre-migration:v1') }));
    check('M0 save loads in M1: funds/XP/logs kept, original kept aside', r.s.funds === 12345 && r.s.xp === 95 && r.s.trollXp === 0 && r.pre === m0, JSON.stringify({ funds: r.s.funds, xp: r.s.xp }));
    await shot('13-m0-save-migrated', pg);
    await ctx2.close();
  } catch (e) {
    check('M0 save migration in the browser', false, e.message);
  }

  check('no page errors or console errors', errors.length === 0, errors.slice(0, 5).join(' | '));
  await browser.close();
  server.kill();
  const failed = results.filter((r) => !r.ok);
  fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots: ${outDir}`);
  process.exit(failed.length ? 1 : 0);
})();
