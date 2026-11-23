// End-to-end playthrough in headless Chromium (M0 to M5).
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
  const schools = async (species) => (await page.evaluate(() => window.__ryoshi.schoolCenters())).filter((s) => !species || s.species === species);

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
      const want = dist > 220 ? 5 : dist > 90 ? 4 : 3; // 全速 / 半速 / 微速
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
    const p = await page.evaluate(([wx, wy]) => window.__ryoshi.chartPoint(wx, wy), [x, y]);
    await page.mouse.click(p.x, p.y);
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
    check('M4: the forecast tells the season (water temperature trend)', /季節：水温の/.test(portText));
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
    if (await page.isVisible('#modal [data-act=closeModal]').catch(() => false)) await page.click('#modal [data-act=closeModal]'); // the 'fitted' note
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

    // ---------------------------------------------------------------- closing at sea: resume (item 1)
    const preDay = (await st()).day;
    const preFunds = (await st()).funds;
    await page.click('[data-act=depart]');
    await waitFor((x) => x.screen === 'sea', 'at sea');
    await ff(1200);
    await sleep(5600); // the voyage is saved every few seconds
    const atSea = await st();
    await page.reload();
    await page.waitForFunction(() => window.__ryoshi && window.__ryoshi.state().screen === 'sea', null, { timeout: 20000 });
    s = await st();
    const dt = s.voyage.time - atSea.voyage.time;
    check('closing the page at sea and opening it again continues the voyage at sea', s.voyage.id === atSea.voyage.id && dt >= -600 && dt <= 60 && s.day === preDay + 1, `t ${Math.round(atSea.voyage.time)} → ${Math.round(s.voyage.time)}`);
    await shot('12b-resumed-at-sea');
    // without the at-sea save (another browser, cleared data): interrupted, no reward, day consumed
    await page.evaluate(() => {
      window.__ryoshi.app.voyage = null; // stop saving from this page before removing it
      localStorage.removeItem('ryoshi-game:voyage:current');
    });
    await page.reload();
    await page.waitForSelector('#portChart');
    s = await st();
    check('without the at-sea save: voyage interrupted, no reward, day consumed', s.day === preDay + 1 && s.funds === preFunds && /中断/.test(await page.textContent('#screen')));
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

  // ---------------------------------------------------------------- M2: buy a used boat, move gear, fish two rigs
  try {
    // same page as the main playthrough, so the keyboard skipper (driveTo) can be reused
    const pg = page;
    const st3 = st;
    await pg.goto(`http://localhost:${port}/?dev=1&seed=77`);
    await pg.waitForSelector('#portChart');
    const own = await st3(); // the player's own progress from the playthrough above
    const ownRaw = await pg.evaluate(() => localStorage.getItem('ryoshi-game:save:main'));
    // the playtest save: one button on the boat market screen
    await pg.click('[data-act=market]');
    await pg.click('[data-act=playtestLoad]');
    await pg.click('[data-act=playtestLoadConfirm]');
    await pg.waitForSelector('[data-act=playtestRestore]');
    let s3 = await st3();
    const kept = await pg.evaluate(() => localStorage.getItem('ryoshi-game:save:before-playtest'));
    const before = { funds: s3.funds, slots: s3.slots, storage: s3.storage };
    check('playtest save: one button switches to 300,000G on the small boat; own progress kept aside', s3.funds === 300000 && s3.boatModel === 'skiff_1' && s3.saveStatus.ok && kept === ownRaw, JSON.stringify(before));
    await pg.screenshot({ path: path.join(outDir, '14a-playtest-loaded.png') });
    await pg.waitForSelector('[data-act=boatQuote][data-offer=used_cruiser_a]');
    const mText = await pg.textContent('#screen');
    check('market compares new and used boats with the shown performance and price after trade-in', /新艇/.test(mText) && /中古/.test(mText) && /魚倉/.test(mText) && /一本釣りの竿受け/.test(mText) && /差引の支払い/.test(mText));
    await pg.screenshot({ path: path.join(outDir, '14-boat-market.png') });
    const plan = await pg.evaluate(() => import('/src/core/economy.js').then((m) => {
      const r = m.planBoatPurchase(window.__ryoshi.app.profile, 'used_cruiser_a');
      return { payable: r.payable, fundsAfter: r.fundsAfter, tradeIn: r.tradeIn, moves: r.moves };
    }));
    await pg.click('[data-act=boatQuote][data-offer=used_cruiser_a]');
    await pg.waitForSelector('[data-act=buyBoatConfirm]');
    const qText = await pg.textContent('#modal');
    const yen = (n) => `${n.toLocaleString('ja-JP')}G`;
    check('quote shows payment, funds after and where each item goes before buying', qText.includes(yen(plan.payable)) && qText.includes(yen(plan.fundsAfter)) && /装備の行き先/.test(qText) && /曳縄/.test(qText) && /倉庫/.test(qText), JSON.stringify(plan));
    await pg.screenshot({ path: path.join(outDir, '15-boat-quote.png') });
    await pg.click('[data-act=buyBoatConfirm]');
    await pg.waitForSelector('#portChart');
    s3 = await st3();
    const allItems = [...Object.values(s3.slots).filter(Boolean), ...s3.storage];
    const uids = allItems.map((x) => x.split('#')[1]);
    const oldUids = [...Object.values(before.slots).filter(Boolean), ...before.storage].map((x) => x.split('#')[1]);
    check('bought: one active boat (中型), paid exactly once, saved', s3.boatModel === 'cruiser_2' && s3.funds === 300000 - plan.payable && s3.boatHistory === 1 && s3.saveStatus.ok, `funds ${s3.funds}`);
    check('gear: the trolling gear moved to the new stern, replaced items kept in storage, nothing lost or duplicated', s3.slots.stern_troll === before.slots.stern_troll && oldUids.every((u) => uids.includes(u)) && new Set(uids).size === uids.length && s3.slots.port_reel, JSON.stringify({ slots: s3.slots, storage: s3.storage }));
    await pg.screenshot({ path: path.join(outDir, '16-bought-boat.png') });
    await pg.click('[data-act=closeModal]');
    await pg.reload();
    await pg.waitForSelector('#portChart');
    const s3r = await st3();
    check('reload after the purchase restores the same boat, funds, slots and storage', s3r.boatModel === s3.boatModel && s3r.funds === s3.funds && JSON.stringify(s3r.slots) === JSON.stringify(s3.slots) && JSON.stringify(s3r.storage) === JSON.stringify(s3.storage));
    // sell one stored item (confirm first)
    await pg.click('[data-act=equip]');
    const sellUid = s3r.storage[0].split('#')[1];
    await pg.waitForSelector(`[data-act=sell][data-uid=${sellUid}]`);
    await pg.screenshot({ path: path.join(outDir, '17-equip-cruiser.png'), fullPage: true });
    await pg.click(`[data-act=sell][data-uid=${sellUid}]`);
    await pg.waitForSelector('[data-act=sellConfirm]');
    await pg.click('[data-act=sellConfirm]');
    await sleep(200);
    const s3s = await st3();
    check('selling a stored item pays its shown value once and removes only that item', s3s.funds === s3r.funds + 300 && !s3s.storage.some((x) => x.endsWith(`#${sellUid}`)) && s3s.storage.length === s3r.storage.length - 1 && s3s.saveStatus.ok, `funds ${s3r.funds} → ${s3s.funds}`);
    await pg.click('[data-act=toPort]');
    await pg.waitForSelector('#portChart');
    // depart on the new boat and fish the handline with both rigs
    await pg.click('[data-act=depart]');
    await pg.waitForFunction(() => window.__ryoshi.state().screen === 'sea');
    s3 = await st3();
    check('the next voyage uses the new boat', s3.voyage.boatModel === 'cruiser_2');
    const sc = (await pg.evaluate(() => window.__ryoshi.schoolCenters())).filter((x) => x.species === 'aji').sort((a, b) => b.total - a.total)[0];
    const cur = await pg.evaluate(() => window.__ryoshi.current());
    const csp = Math.hypot(cur.x, cur.y) || 1;
    await driveTo({ x: sc.x - (cur.x / csp) * 60, y: sc.y - (cur.y / csp) * 60 }, 'M2 approach');
    await pg.keyboard.press('Space');
    await pg.waitForFunction(() => window.__ryoshi.state().voyage.operating);
    await pg.evaluate(() => window.__ryoshi.fastForward(240));
    s3 = await st3();
    const labels = (s3.voyage.opLines || []).map((l) => l.label);
    check('two handline rigs work from 右舷 and 左舷 (one fisher, taking turns)', labels.length === 2 && labels.includes('右舷') && labels.includes('左舷'), JSON.stringify(s3.voyage.opLines));
    const opText = await pg.textContent('#opPanel').catch(() => '');
    check('operation panel lists both rigs', /右舷/.test(opText) && /左舷/.test(opText), opText.slice(0, 120));
    await pg.screenshot({ path: path.join(outDir, '18-cruiser-two-rigs.png') });
    await pg.keyboard.press('v');
    await sleep(1200);
    await pg.screenshot({ path: path.join(outDir, '19-cruiser-deck.png') });
    // switching helm / deck views keeps the sea as it is (paused)
    await pg.keyboard.press('p');
    await sleep(300);
    const snapV = JSON.stringify((await st3()).voyage);
    for (const k of ['v', 'v', 'f', 'f', 'c', 'c', 'v']) {
      await pg.keyboard.press(k);
      await sleep(60);
    }
    await sleep(300);
    check('helm/deck view switching on the new boat changes nothing in the sea, boat or catch', snapV === JSON.stringify((await st3()).voyage));
    await pg.keyboard.press('v');
    await pg.keyboard.press('p');
    await pg.evaluate(() => window.__ryoshi.fastForward(900));
    s3 = await st3();
    check('the new boat lands アジ', s3.voyage.hold.count > 0, `${s3.voyage.hold.count} fish`);
    await pg.keyboard.press('h');
    await pg.evaluate(() => window.__ryoshi.fastForward(3000));
    await pg.waitForSelector('[data-act=toPort]', { timeout: 30000 });
    s3 = await st3();
    check('landing on the new boat settles and saves', s3.saveStatus.ok && s3.screen === 'receipt');
    await pg.click('[data-act=toPort]');
    await pg.click('[data-act=log]');
    await pg.waitForSelector('table.data');
    const lg = await pg.textContent('#screen');
    check('logbook records the boat and both reels for the trip', /中型漁船・手巻きリール＋手巻きリール/.test(lg), '');
    // back to the player's own progress
    await pg.click('[data-act=toPort]');
    await pg.click('[data-act=openSave]');
    await pg.click('[data-act=playtestRestore]');
    await pg.click('[data-act=playtestRestoreConfirm]');
    await pg.waitForSelector('#portChart');
    const back = await st3();
    const keptAfter = await pg.evaluate(() => localStorage.getItem('ryoshi-game:save:before-playtest'));
    check('「自分の進行に戻す」 restores the own progress exactly (funds, day, levels, boat, gear)', back.funds === own.funds && back.day === own.day && back.xp === own.xp && back.trollXp === own.trollXp && back.boatModel === own.boatModel && JSON.stringify(back.slots) === JSON.stringify(own.slots) && keptAfter === null && back.saveStatus.ok, JSON.stringify({ own: own.funds, back: back.funds }));
    await pg.reload();
    await pg.waitForSelector('#portChart');
    check('after reload the own progress is still there', (await st3()).funds === own.funds);
  } catch (e) {
    check('M2 boat purchase playthrough', false, e.message);
  }

  // ---------------------------------------------------------------- M3: 延縄 (longline) and walking the deck
  try {
    const pg = page;
    await pg.goto(`http://localhost:${port}/?dev=1&seed=77`);
    await pg.waitForSelector('#portChart');
    const own = await st();
    await pg.click('[data-act=market]');
    await pg.click('[data-act=playtestLoad]');
    await pg.click('[data-act=playtestLoadConfirm]');
    await pg.waitForSelector('[data-act=playtestRestore]');
    await pg.click('[data-act=equip]');
    await pg.waitForSelector('[data-act=buy][data-item=longline_ll1]');
    const eqText = await pg.textContent('#screen');
    check('M3: the longline gear is offered for the small boat\'s stern (instead of the trolling gear)', /延縄具 LL-1/.test(eqText) && /船尾（曳縄・延縄）/.test(eqText));
    await pg.click('[data-act=buy][data-item=longline_ll1][data-slot=stern_troll]');
    await pg.click('[data-act=buyConfirm]');
    if (await pg.isVisible('#modal [data-act=closeModal]').catch(() => false)) await pg.click('#modal [data-act=closeModal]'); // the 'fitted' note
    await sleep(200);
    let s4 = await st();
    check('bought the longline: on the stern, the trolling gear kept in storage, saved', s4.troll === null && s4.slots.stern_troll.startsWith('longline_ll1') && s4.storage.some((x) => x.startsWith('troll_tr1')) && s4.saveStatus.ok, JSON.stringify({ slots: s4.slots, storage: s4.storage }));
    await pg.click('[data-act=toPort]');
    await pg.waitForSelector('#portChart');
    // M4: hire a deckhand for this trip
    await pg.check('#hireCrew');
    check('M4: a deckhand can be hired at port (wage shown)', (await st()).hireCrew === true && /甲板員を乗せる（日当1,800G/.test(await pg.textContent('#screen')));
    await pg.click('[data-act=depart]');
    await waitFor((x) => x.screen === 'sea', 'at sea (M3)');
    check('M4: the deckhand is on board (HUD)', (await st()).voyage.crew === 1 && /2人（甲板員）/.test(await pg.textContent("#hudTop")));
    for (let i = 0; i < 4 && (await st()).voyage.method !== 'longline'; i++) await press('t'); // 一本釣り → 根魚釣り → 延縄
    s4 = await st();
    check('T switches to 延縄 (the gear on board)', s4.voyage.method === 'longline', s4.voyage.method);
    // run to the south side of the マダイ, then lay the line north through them (chart click = where the line goes)
    const md = (await pg.evaluate(() => window.__ryoshi.schoolCenters())).filter((x) => x.id.includes('madai')).sort((a, b) => b.total - a.total)[0];
    // move there along a route drawn on the chart (G), not by steering
    await press('c');
    await sleep(200);
    await clickChart(1650, 4050);
    const farRefused = (await st()).voyage.route.length === 0 && /航行区域/.test(await pg.textContent('#toast'));
    check('M5: the small boat cannot plan a route to 沖の瀬 (outside its navigation zone)', farRefused);
    await sleep(1200);
    await clickChart(md.x, md.y - 330);
    const planned = (await st()).voyage.route.slice(-1)[0];
    await press('c');
    await press('g');
    s4 = await waitFor((x) => x.voyage.autopilot === 'route', 'route movement started');
    for (let i = 0; i < 60 && (await st()).voyage.autopilot; i++) await ff(20); // stop as soon as it arrives (then it drifts with the tide)
    s4 = await waitFor((x) => !x.voyage.autopilot && Math.abs(x.voyage.boat.speed) < 0.5, 'route movement arrived');
    const off = Math.hypot(s4.voyage.boat.x - planned.x, s4.voyage.boat.y - planned.y);
    const clickErr = Math.hypot(planned.x - md.x, planned.y - (md.y - 330));
    check('chart route (G): the boat runs to the clicked point and stops there', off < 60 && clickErr < 30, `${Math.round(off)} m from the route end; click landed ${Math.round(clickErr)} m from the aim`);
    await press('c');
    await sleep(200);
    await clickChart(md.x, md.y + 360);
    await press('c');
    await press('Space');
    s4 = await waitFor((x) => x.voyage.line && x.voyage.line.state === 'setting', 'setting the line');
    await ff(900);
    s4 = await st();
    check('the line is laid automatically (100 hooks) and soaks with two end buoys; the boat is free again', s4.voyage.line.state === 'soaking' && s4.voyage.line.hooks === 100 && s4.voyage.line.buoys.length === 2 && !s4.voyage.operating, JSON.stringify(s4.voyage.line && s4.voyage.line.state));
    await shot('20-longline-soaking');
    // walking the deck while the line soaks: paused, nothing in the sea changes
    await press('p');
    await sleep(200);
    const frozen = JSON.stringify((await st()).voyage);
    await press('v');
    await press('v');
    s4 = await st();
    await pg.keyboard.down('w');
    await sleep(700);
    await pg.keyboard.up('w');
    await pg.keyboard.down('d');
    await sleep(400);
    await pg.keyboard.up('d');
    await pg.click('[data-act=walkTo][data-station=fishbox]');
    await sleep(400);
    await shot('21-walk-deck');
    const walkBar = await pg.textContent('#walkBar');
    check('甲板を歩く: walk view with work-position shortcuts; walking changes nothing in the sea, boat or catch', s4.view === 'walk' && /操舵席/.test(walkBar) && /魚倉/.test(walkBar) && frozen === JSON.stringify((await st()).voyage), walkBar);
    await pg.click('[data-act=walkTo][data-station=helm]');
    await press('v');
    await press('p');
    await ff(1500);
    // 揚げ縄: L runs to the nearer buoy and hauls
    // L asks first (an accidental press must not end the soak); Space cannot answer it
    await press('l');
    await pg.waitForSelector('[data-act=haulConfirm]');
    const askText = await pg.textContent('#modal');
    await press('Space');
    const stillSoaking = (await st()).voyage.line.state === 'soaking' && (await pg.isVisible('[data-act=haulConfirm]'));
    check('揚げ縄 asks once before starting (soak time, bait, distance); Space does not answer it', /よろしいですか/.test(askText) && /浸けた時間/.test(askText) && stillSoaking);
    await pg.click('[data-act=haulConfirm]');
    s4 = await waitFor((x) => (x.voyage.line && x.voyage.line.state === 'hauling') || x.voyage.autopilot === 'haul', 'haul started');
    await ff(400);
    await shot('22-longline-hauling');
    await ff(3000);
    s4 = await st();
    const madaiN = s4.voyage.hold.counts.madai.s + s4.voyage.hold.counts.madai.m + s4.voyage.hold.counts.madai.l;
    check('L hauls the line (going to the buoy first); マダイ come aboard', s4.voyage.line.state === 'aboard' && madaiN > 0, `${madaiN} madai`);
    s4 = await returnAndLand('M3');
    const rc = await pg.textContent('#screen');
    check('landing: マダイ sold, 延縄 experience', /マダイ/.test(rc) && /延縄/.test(rc) && s4.saveStatus.ok);
    check('M4: the deckhand\'s wage is paid once, shown with the costs', /甲板員の日当/.test(rc) && /1,800G/.test(rc));
    await shot('23-longline-receipt');
    await pg.click('[data-act=toPort]');
    await pg.click('[data-act=log]');
    await pg.waitForSelector('table.data');
    const lg4 = await pg.textContent('#screen');
    check('logbook: the longline with its soak time and gear (and the deckhand)', /延縄/.test(lg4) && /浸け\d+分/.test(lg4) && /延縄具 LL-1（針100本）＋甲板員/.test(lg4));
    await pg.click('[data-act=toPort]');
    await pg.click('[data-act=openSave]');
    await pg.click('[data-act=playtestRestore]');
    await pg.click('[data-act=playtestRestoreConfirm]');
    await pg.waitForSelector('#portChart');
    check('back to the own progress after the M3 playtest', (await st()).funds === own.funds);
  } catch (e) {
    check('M3 longline playthrough', false, e.message);
    await shot('99-m3-failure').catch(() => {});
  }

  // ---------------------------------------------------------------- M5: 沖の瀬 on the medium boat, with the line hauler
  try {
    const pg = page;
    await pg.goto(`http://localhost:${port}/?dev=1&seed=77`);
    await pg.waitForSelector('#portChart');
    const own = await st();
    await pg.click('[data-act=market]');
    await pg.click('[data-act=playtestLoad]');
    await pg.click('[data-act=playtestLoadConfirm]');
    await pg.waitForSelector('[data-act=boatQuote][data-offer=used_cruiser_b]');
    const mk = await pg.textContent('#screen');
    check('M5: the boat comparison shows where each boat can go', /行ける範囲/.test(mk) && /沖の瀬まで/.test(mk));
    await pg.click('[data-act=boatQuote][data-offer=used_cruiser_b]');
    await pg.click('[data-act=buyBoatConfirm]');
    await pg.click('[data-act=closeModal]');
    await pg.click('[data-act=equip]');
    await pg.click('[data-act=buy][data-item=longline_ll1][data-slot=deck_longline]');
    await pg.click('[data-act=buyConfirm]');
    if (await pg.isVisible('#modal [data-act=closeModal]').catch(() => false)) await pg.click('#modal [data-act=closeModal]'); // the 'fitted' note
    await pg.waitForSelector('[data-act=buy][data-item=hauler_lh1]');
    const eq5 = await pg.textContent('#screen');
    check('M5: the line hauler is offered for its own mounting with its effect', /右舷前（揚げ縄機）/.test(eq5) && /揚げ縄の速さ/.test(eq5));
    await pg.click('[data-act=buy][data-item=hauler_lh1]');
    const conf5 = await pg.textContent('#modal');
    await pg.click('[data-act=buyConfirm]');
    await sleep(200);
    const fitted5 = await pg.textContent('#modal');
    check('upgrades are explained: what changes before buying, what to look for after fitting', /何が変わるか/.test(conf5) && /次の航海での見どころ/.test(fitted5), fitted5.slice(0, 60));
    await pg.click('[data-act=closeModal]');
    let s5 = await st();
    check('M5: medium boat with longline deck and hauler, saved', s5.boatModel === 'cruiser_2' && s5.slots.deck_longline.startsWith('longline_ll1') && s5.slots.starboard_hauler.startsWith('hauler_lh1') && s5.saveStatus.ok, JSON.stringify(s5.slots));
    await pg.click('[data-act=toPort]');
    await pg.waitForSelector('#portChart');
    await pg.click('[data-act=depart]');
    await waitFor((x) => x.screen === 'sea', 'at sea (M5)');
    // out to 沖の瀬 along a chart route
    await press('c');
    await sleep(200);
    await clickChart(1600, 3820);
    await press('c');
    await press('g');
    await waitFor((x) => x.voyage.autopilot === 'route', 'route to 沖の瀬');
    for (let i = 0; i < 80 && (await st()).voyage.autopilot; i++) await ff(20);
    s5 = await st();
    const area5 = await pg.textContent('#hudTop');
    check('M5: the medium boat runs out to 沖の瀬 (beyond the small boat\'s zone)', s5.voyage.boat.y > 3500 && /沖の瀬/.test(area5), `y ${Math.round(s5.voyage.boat.y)}`);
    await shot('24-okinose');
    // lay the longline northward over the reef and haul it with the machine
    for (let i = 0; i < 5 && (await st()).voyage.method !== 'longline'; i++) await press('t');
    await pg.evaluate(() => {
      // face north for a straight line over the reef (a test convenience: the player would steer)
      window.__ryoshi.app.voyage.boat.heading = 0;
    });
    await press('Space');
    s5 = await waitFor((x) => x.voyage.line && x.voyage.line.state === 'setting', 'setting on 沖の瀬');
    await ff(900);
    await ff(1800);
    await press('l');
    await pg.click('[data-act=haulConfirm]');
    await waitFor((x) => x.voyage.line && x.voyage.line.state === 'hauling', 'hauling with the machine', 60000);
    await ff(60);
    const opText5 = await pg.textContent('#opPanel');
    check('M5: the line hauler winds the line (shown in the panel)', /揚げ縄機で巻き上げています/.test(opText5), opText5.slice(0, 80));
    await shot('25-hauler');
    await ff(2400);
    s5 = await returnAndLand('M5');
    await pg.click('[data-act=toPort]');
    await pg.click('[data-act=log]');
    await pg.waitForSelector('table.data');
    const lg5 = await pg.textContent('#screen');
    check('M5: the logbook records 沖の瀬 and the line hauler', /沖の瀬/.test(lg5) && /揚げ縄機 LH-1/.test(lg5));
    await pg.click('[data-act=toPort]');
    await pg.click('[data-act=openSave]');
    await pg.click('[data-act=playtestRestore]');
    await pg.click('[data-act=playtestRestoreConfirm]');
    await pg.waitForSelector('#portChart');
    check('back to the own progress after the M5 playtest', (await st()).funds === own.funds);
  } catch (e) {
    check('M5 playthrough', false, e.message);
    await shot('99-m5-failure').catch(() => {});
  }

  // ---------------------------------------------------------------- search tools: structures, side view + depth map, sonar (items 2-4)
  try {
    const pg = page;
    await pg.goto(`http://localhost:${port}/?dev=1&seed=77`);
    await pg.waitForSelector('#portChart');
    const own = await st();
    await pg.click('[data-act=market]');
    await pg.click('[data-act=playtestLoad]');
    await pg.click('[data-act=playtestLoadConfirm]');
    await pg.click('[data-act=boatQuote][data-offer=used_cruiser_a]');
    await pg.click('[data-act=buyBoatConfirm]');
    await pg.click('[data-act=closeModal]');
    await pg.click('[data-act=equip]');
    await pg.click('[data-act=buy][data-item=sonar_cs1][data-slot=hull_sonar]');
    const confS = await pg.textContent('#modal');
    await pg.click('[data-act=buyConfirm]');
    await sleep(200);
    if (await pg.isVisible('#modal [data-act=closeModal]').catch(() => false)) await pg.click('#modal [data-act=closeModal]');
    await pg.click('[data-act=buy][data-item=sounder_sv1][data-slot=helm_sounder]');
    const confV = await pg.textContent('#modal');
    await pg.click('[data-act=buyConfirm]');
    await sleep(200);
    if (await pg.isVisible('#modal [data-act=closeModal]').catch(() => false)) await pg.click('#modal [data-act=closeModal]');
    let s6 = await st();
    check('search tools: the sonar and the side-view sounder are explained before buying and fitted', /何が変わるか/.test(confS) && /ソナー/.test(confS) && /左右/.test(confV) && s6.slots.hull_sonar.startsWith('sonar_cs1') && s6.slots.helm_sounder.startsWith('sounder_sv1') && s6.saveStatus.ok, JSON.stringify(s6.slots));
    await pg.click('[data-act=toPort]');
    await pg.waitForSelector('#portChart');
    await pg.click('[data-act=depart]');
    await waitFor((x) => x.screen === 'sea', 'at sea (search tools)');
    check('search tools: the sonar button appears with the sonar fitted', await pg.isVisible('#btnSonar'));
    // run toward the big 根 west of 北の瀬 along a chart route, sonar open
    await press('o');
    await press('c');
    await sleep(200);
    await clickChart(1420, 2140);
    await press('c');
    await press('g');
    await waitFor((x) => x.voyage.autopilot === 'route', 'route toward the 根');
    for (let i = 0; i < 60 && (await st()).voyage.autopilot; i++) await ff(20);
    await ff(15);
    await sleep(400);
    const sonarFill = await pg.evaluate(() => window.__ryoshi.app.voyage.sonar.data.filter((x) => x > 60).length);
    check('search tools: the sonar picture fills in around the boat', (await pg.isVisible('#sonarPanel')) && sonarFill > 0, `${sonarFill} bright cells`);
    const box = await pg.locator('#sonar').boundingBox();
    await pg.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.25);
    await sleep(200);
    const sm = await pg.evaluate(() => window.__ryoshi.app.voyage.obs.marks.filter((m) => m.kind === 'sonar').length);
    check('search tools: tapping the sonar picture leaves a mark at that echo', sm === 1);
    await pg.click('[data-act=sonarRange]');
    check('search tools: the sonar range button steps the range', /600m/.test(await pg.textContent('#sonarRange')));
    await shot('26-sonar');
    await pg.click('#sideToggle');
    await press('w');
    await ff(120);
    await sleep(400);
    const sv = await pg.evaluate(() => ({ side: window.__ryoshi.app.voyage.obs.side.length, cells: Object.keys(window.__ryoshi.app.voyage.bathy.cells).length }));
    check('search tools: the side view draws port and starboard, and the depth map fills in while running', (await pg.isVisible('#sideview')) && sv.side > 50 && sv.cells > 100, JSON.stringify(sv));
    await shot('27-sideview');
    // marks (item 5): tap the brightest starboard echo on the side view, name it in the list, run to it
    const tapAt = await pg.evaluate(() => {
      const rows = window.__ryoshi.app.voyage.obs.side;
      let best = null;
      for (let r = 0; r < rows.length; r++) {
        const row = rows[rows.length - 1 - r];
        const n = row.vals.length;
        for (let k = 0; k < n; k++) if (!best || row.vals[k] > best.v) best = { v: row.vals[k], r, k, n };
      }
      const c = document.getElementById('sideview');
      return { px: ((best.k + 0.5) / best.n) * c.clientWidth, py: (best.r + 0.5) * (c.clientHeight / 240) };
    });
    const sideBox = await pg.locator('#sideview').boundingBox();
    await pg.mouse.click(sideBox.x + tapAt.px, sideBox.y + tapAt.py);
    await sleep(200);
    const sideMark = await pg.evaluate(() => window.__ryoshi.app.voyage.obs.marks.find((m) => m.kind === 'side'));
    check('marks: a tap on the side view leaves a mark on that echo, off the boat\'s track', !!sideMark && Math.hypot(sideMark.x - (await st()).voyage.boat.x, sideMark.y - (await st()).voyage.boat.y) > 5, JSON.stringify(sideMark && [Math.round(sideMark.x), Math.round(sideMark.y)]));
    await press('k');
    await pg.waitForSelector('.mk-list');
    const sideKey = `v:${sideMark.id}`;
    await pg.click(`[data-act=markEdit][data-key="${sideKey}"]`);
    await pg.fill('#markName', '右の硬い反応');
    await pg.fill('#markMemo', 'サイドビューで発見');
    await pg.click(`[data-act=markSave][data-key="${sideKey}"]`);
    const listText = await pg.textContent('#modal');
    check('marks: the list shows today\'s marks with distance and bearing; a name and memo can be written', /右の硬い反応/.test(listText) && /サイドビューで発見/.test(listText) && /\d+m (北|北東|東|南東|南|南西|西|北西)/.test(listText), listText.slice(0, 120));
    await shot('28-marks-list');
    await pg.click(`[data-act=markGo][data-key="${sideKey}"]`);
    for (let i = 0; i < 40 && (await st()).voyage.autopilot; i++) await ff(10);
    const atMark = await st();
    check('marks: 「ここへ」 runs the boat to the mark and stops there', !atMark.voyage.autopilot && Math.hypot(atMark.voyage.boat.x - sideMark.x, atMark.voyage.boat.y - sideMark.y) < 40, `${Math.round(Math.hypot(atMark.voyage.boat.x - sideMark.x, atMark.voyage.boat.y - sideMark.y))} m`);
    s6 = await returnAndLand('search tools');
    const kept6 = await pg.evaluate(() => ({ marks: window.__ryoshi.app.profile.marks.filter((m) => m.kind === 'sonar').length, tiles: Object.keys(window.__ryoshi.app.profile.bathy.tiles || {}).length }));
    check('search tools: the depth map and the sonar mark are kept in the profile after landing', kept6.marks === 1 && kept6.tiles > 0, JSON.stringify(kept6));
    await pg.click('[data-act=toPort]');
    await pg.waitForSelector('#portChart');
    await pg.click('#screen [data-act=marks]');
    await pg.waitForSelector('.mk-list');
    const portList = await pg.textContent('#modal');
    const named = await pg.evaluate(() => window.__ryoshi.app.profile.marks.find((m) => m.name === '右の硬い反応'));
    check('marks: next morning in port the named mark is in the list (kept across days)', /右の硬い反応/.test(portList) && !!named && named.memo === 'サイドビューで発見');
    await shot('29-marks-port');
    const nBefore = await pg.evaluate(() => window.__ryoshi.app.profile.marks.length);
    await pg.click(`[data-act=markDel][data-key="s:${named.id}"]`);
    await pg.click(`[data-act=markDelYes][data-key="s:${named.id}"]`);
    const afterDel = await st();
    const nAfter = await pg.evaluate(() => window.__ryoshi.app.profile.marks.length);
    check('marks: a mark can be deleted (asked once) and the change is saved', nAfter === nBefore - 1 && afterDel.saveStatus.ok);
    await pg.click('#modal [data-act=closeModal]');
    await pg.click('[data-act=openSave]');
    await pg.click('[data-act=playtestRestore]');
    await pg.click('[data-act=playtestRestoreConfirm]');
    await pg.waitForSelector('#portChart');
    check('back to the own progress after the search-tools playtest', (await st()).funds === own.funds);
  } catch (e) {
    check('search tools playthrough', false, e.message);
    await shot('99-search-failure').catch(() => {});
  }

  // ---------------------------------------------------------------- 根魚釣り (item 6): pinpoint fishing over a 漁礁
  try {
    const pg = page;
    await pg.goto(`http://localhost:${port}/?dev=1&seed=77`);
    await pg.waitForSelector('#portChart');
    await pg.click('[data-act=depart]');
    await waitFor((x) => x.screen === 'sea', 'at sea (根魚)');
    await press('c');
    await sleep(200);
    await clickChart(1300, 1040);
    await press('c');
    await press('g');
    await waitFor((x) => x.voyage.autopilot === 'route', 'route to the 漁礁');
    for (let i = 0; i < 40 && (await st()).voyage.autopilot; i++) await ff(20);
    await ff(10);
    // watch which way the boat drifts, then set up 25 m up-current of the 漁礁 (the rig reaches the bottom before the pinpoint)
    const p0 = (await st()).voyage.boat;
    await ff(20);
    const p1 = (await st()).voyage.boat;
    const dl = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
    await press('c');
    await sleep(200);
    await clickChart(1300 - ((p1.x - p0.x) / dl) * 25, 1050 - ((p1.y - p0.y) / dl) * 25);
    await press('c');
    await press('g');
    for (let i = 0; i < 20 && (await st()).voyage.autopilot; i++) await ff(10);
    for (let i = 0; i < 4 && (await st()).voyage.method !== 'negyo'; i++) await press('t');
    check('根魚: T switches to 根魚釣り (no extra gear needed)', (await st()).voyage.method === 'negyo');
    await press('Space');
    await waitFor((x) => x.voyage.operating, 'negyo started');
    // drift across the 漁礁; when the boat has drifted off, 流し直し (R) back up — as a player would
    const caught = () => pg.evaluate(() => {
      const v = window.__ryoshi.app.voyage;
      return [...new Set([...(v.op ? Object.keys(v.op.landedBy) : []), ...v.logs.filter((l) => l.bySpecies).flatMap((l) => Object.keys(l.bySpecies))])];
    });
    let opN = '';
    for (let i = 0; i < 8 && !(await caught()).length; i++) {
      for (let k = 0; k < 8 && !(await caught()).length; k++) {
        await ff(20);
        if ((await st()).voyage.operating) opN = await pg.textContent('#opPanel');
      }
      if ((await caught()).length) break;
      await press('r');
      await waitFor((x) => x.voyage.operating, 'drifting again after 流し直し', 60000);
    }
    if ((await st()).voyage.operating) opN = await pg.textContent('#opPanel');
    const landedN = await caught();
    check('根魚: over the 漁礁 the rig is kept just off the bottom and rockfish come up', /根魚釣り/.test(opN) && /底を切/.test(opN) && landedN.some((sp) => ['kasago', 'kijihata', 'ara'].includes(sp)), `${landedN} | ${opN.slice(0, 80)}`);
    await shot('30-negyo');
    await press('r');
    await waitFor((x) => !x.voyage.operating, 'retrieved for the redrift');
    await waitFor((x) => x.voyage.autopilot === null, 'back up for the redrift', 60000).catch(() => {});
    const logN = await pg.evaluate(() => window.__ryoshi.app.voyage.logs.at(-1));
    check('根魚: the log keeps what came up of each species', logN.methodId === 'negyo' && !!logN.bySpecies, JSON.stringify(logN.bySpecies));
    const sN = await returnAndLand('根魚');
    const rcN = await pg.textContent('#screen');
    check('根魚: rockfish are sold at landing and 根魚釣り gains experience', /カサゴ|キジハタ|アラ/.test(rcN) && /根魚釣り/.test(rcN), rcN.slice(0, 80));
    void sN;
    await pg.click('[data-act=toPort]');
    await pg.click('[data-act=log]');
    await pg.waitForSelector('table.data');
    check('根魚: the logbook shows 根魚釣り with the species', /根魚釣り/.test(await pg.textContent('#screen')) && /カサゴ|キジハタ|アラ/.test(await pg.textContent('#screen')));
    await pg.click('[data-act=toPort]');
  } catch (e) {
    check('根魚 playthrough', false, e.message);
    await shot('99-negyo-failure').catch(() => {});
  }

  // ---------------------------------------------------------------- 泳がせ釣り (item 7): アジ first, then live bait for 青物
  try {
    const pg = page;
    await pg.goto(`http://localhost:${port}/?dev=1&seed=77`);
    await pg.waitForSelector('#portChart');
    await pg.click('[data-act=depart]');
    await waitFor((x) => x.screen === 'sea', 'at sea (泳がせ)');
    // item 8: at dawn the lookout calls out birds over bait pushed up by fish (dev: the sign's place read only to head there)
    await ff(900);
    const bird = await pg.evaluate(() => window.__ryoshi.cues().filter((c) => c.kind === 'birds' && c.y < 2900).sort((a, b) => b.strength - a.strength)[0]);
    if (bird) {
      await press('c');
      await sleep(200);
      await clickChart(bird.x, bird.y);
      await press('c');
      await press('g');
      for (let i = 0; i < 40 && (await st()).voyage.autopilot && !/鳥山が見えます/.test(await pg.textContent('#msgs')); i++) await ff(10);
      await press('s');
      await press('s');
      await press('s');
      await sleep(300);
      check('海面の手掛かり: the lookout calls out a 鳥山 when it comes into sight (from the sea itself)', /鳥山が見えます（/.test(await pg.textContent('#msgs')), (await pg.textContent('#msgs')).slice(-80));
      await shot('32-birds');
    } else check('海面の手掛かり: a 鳥山 at dawn (seed 77, day of this section)', false, 'no birds in the sea this morning');
    // the biggest アジ school within reach (dev: positions read only to drive there)
    const aji = await pg.evaluate(() => window.__ryoshi.schoolCenters().filter((s) => s.species === 'aji' && s.y < 2900 && s.total > 50).sort((a, b) => b.total - a.total)[0]);
    await press('c');
    await sleep(200);
    await clickChart(aji.x, aji.y);
    await press('c');
    await press('g');
    for (let i = 0; i < 60 && (await st()).voyage.autopilot; i++) await ff(20);
    for (let i = 0; i < 6 && (await st()).voyage.method !== 'oyogase'; i++) await press('t');
    const noBait = await pg.evaluate(() => window.__ryoshi.app.voyage.method);
    await press('Space');
    await sleep(200);
    const refused = !(await st()).voyage.operating && /活きエサ/.test(await pg.textContent('#toast'));
    check('泳がせ: without アジ in the hold it does not start (live bait comes from the handline)', noBait === 'oyogase' && refused);
    for (let i = 0; i < 6 && (await st()).voyage.method !== 'handline'; i++) await press('t');
    await press('Space');
    await waitFor((x) => x.voyage.operating, 'handline for bait');
    await ff(420);
    await press('Space');
    await waitFor((x) => !x.voyage.operating, 'handline stopped', 60000);
    const ajiN = await pg.evaluate(() => { const c = window.__ryoshi.app.voyage.hold.counts.aji; return c.s + c.m + c.l; });
    for (let i = 0; i < 6 && (await st()).voyage.method !== 'oyogase'; i++) await press('t');
    await press('Space');
    await waitFor((x) => x.voyage.operating, '泳がせ started');
    await ff(120);
    const opO = await pg.textContent('#opPanel');
    const ajiLeft = await pg.evaluate(() => { const c = window.__ryoshi.app.voyage.hold.counts.aji; return c.s + c.m + c.l; });
    check('泳がせ: a live アジ from the hold goes on the hook (the hold count drops, shown in the panel)', ajiN > 0 && ajiLeft === ajiN - 1 && /泳がせ釣り/.test(opO) && /活きアジ残り/.test(opO), `アジ ${ajiN} → ${ajiLeft} | ${opO.slice(0, 70)}`);
    await shot('31-oyogase');
    await ff(600);
    const swaps = await pg.evaluate(() => window.__ryoshi.app.voyage.op ? window.__ryoshi.app.voyage.op.stats.baits : 0);
    check('泳がせ: a tired bait is changed for a fresh アジ after a while', swaps >= 2, `${swaps} baits`);
    await returnAndLand('泳がせ');
    const rcO = await pg.textContent('#screen');
    check('泳がせ: at landing the アジ used as bait are listed and not sold', /活きエサに使った魚：マアジ\d+尾/.test(rcO), rcO.slice(0, 100));
    await pg.click('[data-act=toPort]');
  } catch (e) {
    check('泳がせ playthrough', false, e.message);
    await shot('99-oyogase-failure').catch(() => {});
  }

  check('no page errors or console errors', errors.length === 0, errors.slice(0, 5).join(' | '));
  await browser.close();
  server.kill();
  const failed = results.filter((r) => !r.ok);
  fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots: ${outDir}`);
  process.exit(failed.length ? 1 : 0);
})();
